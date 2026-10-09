/**
 * tools/lib/gif-decode.js — 按 GIF89a 规范实现的解码器（与自研编码器互相独立）
 * 用途：对生成的 GIF 做 roundtrip 校验 —— 编码器写出的结构若不符合规范，这里会炸
 */
const { encodePNG } = require('./png.js');

class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
    this.cur = 0;
    this.bits = 0;
  }
  read(len) {
    while (this.bits < len) {
      if (this.pos >= this.bytes.length) return -1; // 数据不足
      this.cur |= this.bytes[this.pos++] << this.bits;
      this.bits += 8;
    }
    const v = this.cur & ((1 << len) - 1);
    this.cur >>= len;
    this.bits -= len;
    return v;
  }
}

// 变长 LZW 解码（规范方向：字典增长 → 码长在 next 达到 2^codeSize 时 +1）
function lzwDecode(minCodeSize, data, expectedPixels, log) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const br = new BitReader(data);
  let codeSize = minCodeSize + 1;
  // 只存「新增」条目：码号 < clear 的是根码（单像素），不能混进同一数组里按下标取
  let table = new Map();
  let next;
  const reset = () => {
    table = new Map();
    next = eoi + 1;
    codeSize = minCodeSize + 1; // 关键：clear 后码长必须回到初始值
  };
  reset();

  const out = [];
  let prev = null;
  let code;
  while ((code = br.read(codeSize)) !== -1) {
    if (log) log.push({ dir: 'D', code, size: codeSize, next });
    if (code === clear) { reset(); prev = null; continue; }
    if (code === eoi) break;
    let entry;
    if (code < clear) {
      entry = [code]; // 根码
    } else if (code < next) {
      entry = table.get(code);
      if (!entry) throw new Error(`码 ${code} 在字典中是空位（next=${next}）→ 字典索引错位`);
    } else if (code === next && prev) {
      entry = prev.concat([prev[0]]); // KwKwK 特例
    } else {
      throw new Error(`非法码 ${code}（next=${next}, codeSize=${codeSize}）→ LZW 码长失步`);
    }
    if (prev !== null && next < 4096) {
      table.set(next, prev.concat([entry[0]]));
      next++;
      if (next === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    for (const v of entry) out.push(v);
    prev = entry;
    if (out.length > (expectedPixels || 1e9) + 4096) throw new Error('输出像素超限');
  }
  return out;
}

/**
 * 解析 GIF → { width, height, palette, frames: [{ delay, indices }] }
 * 结构非法会抛错
 */
function decodeGIF(buf, log) {
  let p = 0;
  const sig = buf.toString('ascii', 0, 6);
  if (sig !== 'GIF89a' && sig !== 'GIF87a') throw new Error('文件头非法: ' + sig);
  p = 6;
  const width = buf.readUInt16LE(p); p += 2;
  const height = buf.readUInt16LE(p); p += 2;
  const packed = buf[p++]; p += 2; // bgColor, aspect
  let palette = [];
  if (packed & 0x80) {
    const size = 2 << (packed & 0x07);
    for (let i = 0; i < size; i++) {
      palette.push([buf[p], buf[p + 1], buf[p + 2]]);
      p += 3;
    }
  }

  const frames = [];
  let delay = 0;
  while (p < buf.length) {
    const b = buf[p++];
    if (b === 0x3b) break; // Trailer
    if (b === 0x21) { // Extension
      const label = buf[p++];
      if (label === 0xf9) { // Graphic Control
        const size = buf[p++];
        const flags = buf[p];
        delay = buf.readUInt16LE(p + 1);
        // 透明索引仅记录，不报错（外部 GIF 常用；我们自产的 GIF 不使用透明）
        p += size + 1;
      } else { // 跳过其它扩展（按子块结构）
        while (p < buf.length) {
          const n = buf[p++];
          if (n === 0) break;
          p += n;
        }
      }
      continue;
    }
    if (b === 0x2c) { // Image Descriptor
      const left = buf.readUInt16LE(p);
      const top = buf.readUInt16LE(p + 2);
      const fw = buf.readUInt16LE(p + 4);
      const fh = buf.readUInt16LE(p + 6);
      p += 8;
      const iflags = buf[p++];
      let localPalette = null;
      if (iflags & 0x80) { // 局部色表（本编码器不使用，外部 GIF 可能有）
        const size = 2 << (iflags & 0x07);
        localPalette = [];
        for (let i = 0; i < size; i++) {
          localPalette.push([buf[p], buf[p + 1], buf[p + 2]]);
          p += 3;
        }
      }
      if (iflags & 0x40) throw new Error('隔行扫描 GIF 暂不支持校验');
      const minCodeSize = buf[p++];
      const dataBytes = [];
      while (p < buf.length) {
        const n = buf[p++];
        if (n === 0) break;
        for (let i = 0; i < n; i++) dataBytes.push(buf[p + i]);
        p += n;
      }
      const indices = lzwDecode(minCodeSize, dataBytes, fw * fh, log);
      if (indices.length !== fw * fh) {
        throw new Error(`帧像素数不符：解码出 ${indices.length}，期望 ${fw * fh}（帧 ${fw}x${fh}）`);
      }
      frames.push({ delay, left, top, w: fw, h: fh, indices, palette: localPalette });
      delay = 0;
      continue;
    }
    throw new Error(`未知块标识 0x${b.toString(16)} @ offset ${p - 1}`);
  }
  return { width, height, palette, frames };
}

// 解码并渲染指定帧为 PNG（用于人眼校验）
function frameToPNG(gif, frameIdx, bgColor) {
  const { width, height, palette, frames } = gif;
  const frame = frames[frameIdx];
  const pal = frame.palette || palette;
  const rgb = Buffer.alloc(width * height * 3);
  const bg = bgColor || [255, 255, 255];
  for (let i = 0; i < width * height; i++) {
    const c = bg;
    rgb[i * 3] = c[0];
    rgb[i * 3 + 1] = c[1];
    rgb[i * 3 + 2] = c[2];
  }
  for (let y = 0; y < frame.h; y++) {
    for (let x = 0; x < frame.w; x++) {
      const si = y * frame.w + x;
      const di = ((frame.top + y) * width) + (frame.left + x);
      if (di < 0 || di >= width * height) continue;
      const c = pal[frame.indices[si]] || bg;
      rgb[di * 3] = c[0];
      rgb[di * 3 + 1] = c[1];
      rgb[di * 3 + 2] = c[2];
    }
  }
  return encodePNG(width, height, rgb);
}

module.exports = { decodeGIF, frameToPNG, lzwDecode };
