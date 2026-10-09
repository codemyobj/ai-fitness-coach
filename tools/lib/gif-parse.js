/**
 * tools/lib/gif-parse.js — GIF 解析 + 帧合成（生产侧用，与 gif-decode.js 分开维护）
 *
 * 为什么需要它：数据集里的教学 GIF 都是「差分帧」——
 *   第一帧是 0,0 全幅，之后每帧只是一个「变化区域的小矩形」，矩形外的内容靠 canvas 累积保留。
 *   直接按帧矩形逐张看会以为动画在乱跳，必须按 GIF 的 disposal 语义合成出完整画面。
 *
 * 支持的 disposal：0/1（不处置，保留）、2（恢复背景）、3（恢复上一保存状态）
 * 支持：透明索引、局部色表
 */

function parseGIF(buf) {
  const sig = buf.toString('ascii', 0, 6);
  if (sig !== 'GIF89a' && sig !== 'GIF87a') throw new Error('文件头非法: ' + sig);
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  const packed = buf[10];
  const bgIndex = buf[11];
  let p = 13;
  let palette = null;
  if (packed & 0x80) {
    const n = 2 << (packed & 0x07);
    palette = [];
    for (let i = 0; i < n; i++) { palette.push([buf[p], buf[p + 1], buf[p + 2]]); p += 3; }
  }
  const frames = [];
  let gce = null;
  while (p < buf.length) {
    const b = buf[p++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = buf[p++];
      if (label === 0xf9) {
        const size = buf[p++];
        const flags = buf[p];
        gce = {
          disposal: (flags >> 2) & 0x07,
          transparent: !!(flags & 0x01),
          transIdx: buf[p + 3],
          delay: buf.readUInt16LE(p + 1),
        };
        p += size + 1;
      } else {
        while (p < buf.length) { const n = buf[p++]; if (n === 0) break; p += n; }
      }
      continue;
    }
    if (b === 0x2c) {
      const left = buf.readUInt16LE(p);
      const top = buf.readUInt16LE(p + 2);
      const fw = buf.readUInt16LE(p + 4);
      const fh = buf.readUInt16LE(p + 6);
      p += 8;
      const iflags = buf[p++];
      let local = null;
      if (iflags & 0x80) {
        const n = 2 << (iflags & 0x07);
        local = [];
        for (let i = 0; i < n; i++) { local.push([buf[p], buf[p + 1], buf[p + 2]]); p += 3; }
      }
      if (iflags & 0x40) throw new Error('隔行扫描 GIF 未支持');
      const minCodeSize = buf[p++];
      const data = [];
      while (p < buf.length) {
        const n = buf[p++];
        if (n === 0) break;
        for (let i = 0; i < n; i++) data.push(buf[p + i]);
        p += n;
      }
      frames.push({
        left, top, w: fw, h: fh,
        minCodeSize, data,
        localPalette: local,
        delay: gce ? gce.delay : 0,
        disposal: gce ? gce.disposal : 0,
        transparent: gce ? gce.transparent : false,
        transIdx: gce ? gce.transIdx : -1,
      });
      gce = null;
      continue;
    }
    throw new Error(`未知块 0x${b.toString(16)} @ ${p - 1}`);
  }
  return { width, height, palette, bgIndex, frames };
}

/**
 * 合成完整帧序列
 * @returns {{width:number,height:number,palette:Array,frames:Uint8Array[],delays:number[]}}
 */
function composeFrames(buf, lzwDecode) {
  const parsed = parseGIF(buf);
  const { width: w, height: h, palette } = parsed;
  const bg = (palette && palette[parsed.bgIndex]) || [255, 255, 255];
  const canvas = new Uint8Array(w * h * 3);
  const fillBg = (r) => {
    for (let y = r.top; y < r.top + r.h; y++) {
      if (y < 0 || y >= h) continue;
      for (let x = r.left; x < r.left + r.w; x++) {
        if (x < 0 || x >= w) continue;
        const i = (y * w + x) * 3;
        canvas[i] = bg[0]; canvas[i + 1] = bg[1]; canvas[i + 2] = bg[2];
      }
    }
  };
  for (let i = 0; i < w * h; i++) {
    canvas[i * 3] = bg[0]; canvas[i * 3 + 1] = bg[1]; canvas[i * 3 + 2] = bg[2];
  }

  const frames = [];
  const delays = [];
  let prevDisposal = 0;
  let prevRect = null;
  let saved = null;

  for (const f of parsed.frames) {
    if (prevDisposal === 2 && prevRect) fillBg(prevRect);
    else if (prevDisposal === 3 && saved) canvas.set(saved);
    if (f.disposal === 3) saved = Uint8Array.from(canvas);

    const pal = f.localPalette || palette;
    const indices = lzwDecode(f.minCodeSize, f.data, f.w * f.h);
    if (indices.length !== f.w * f.h) throw new Error(`帧像素数不符 ${indices.length}≠${f.w * f.h}`);
    for (let y = 0; y < f.h; y++) {
      const cy = f.top + y;
      if (cy < 0 || cy >= h) continue;
      for (let x = 0; x < f.w; x++) {
        const cx = f.left + x;
        if (cx < 0 || cx >= w) continue;
        const si = y * f.w + x;
        if (f.transparent && indices[si] === f.transIdx) continue; // 透明：保留 canvas
        const c = pal[indices[si]] || bg;
        const di = (cy * w + cx) * 3;
        canvas[di] = c[0]; canvas[di + 1] = c[1]; canvas[di + 2] = c[2];
      }
    }
    frames.push(Uint8Array.from(canvas));
    delays.push(f.delay * 10); // → ms
    prevDisposal = f.disposal === 0 ? 1 : f.disposal;
    prevRect = { left: f.left, top: f.top, w: f.w, h: f.h };
  }
  return { width: w, height: h, palette, frames, delays };
}

module.exports = { parseGIF, composeFrames };
