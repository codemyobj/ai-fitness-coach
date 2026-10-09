/**
 * tools/lib/gif.js — 极简 GIF89a 编码器（零依赖）
 * 只支持索引色 + 全帧尺寸（不做帧间差分），够用且可靠。
 * 输出：Buffer
 */

class BitWriter {
  constructor() {
    this.bytes = [];
    this.cur = 0;
    this.bits = 0;
  }
  write(code, len) {
    this.cur |= code << this.bits;
    this.bits += len;
    while (this.bits >= 8) {
      this.bytes.push(this.cur & 0xff);
      this.cur >>= 8;
      this.bits -= 8;
    }
  }
  flush() {
    if (this.bits > 0) {
      this.bytes.push(this.cur & 0xff);
      this.cur = 0;
      this.bits = 0;
    }
  }
}

// GIF 变长 LZW：minCodeSize 决定起始码长，字典满 4096 时发 clear 重置
function lzwEncode(minCodeSize, indices, log) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let next = eoiCode + 1;
  const dict = new Map();
  const bw = new BitWriter();

  if (log) log.push({ dir: 'E', code: clearCode, size: codeSize, next });
  bw.write(clearCode, codeSize);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 256 + k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    if (log) log.push({ dir: 'E', code: prefix, size: codeSize, next });
    bw.write(prefix, codeSize);
    if (next < 4096) {
      dict.set(key, next++);
      // 解码器总是比编码器「慢一步」建表（next 恒小 1），因此：
      // 本步发出的码最大为 next-1（KwKwK 情形），需 next ≤ 2^codeSize ；
      // 自增后 next 若 > 2^codeSize，则下一步必须加长码长。
      if (next > (1 << codeSize) && codeSize < 12) codeSize++;
    } else {
      if (log) log.push({ dir: 'E', code: clearCode, size: codeSize, next });
      bw.write(clearCode, codeSize);
      dict.clear();
      codeSize = minCodeSize + 1;
      next = eoiCode + 1;
    }
    prefix = k;
  }
  if (log) log.push({ dir: 'E', code: prefix, size: codeSize, next });
  if (log) log.push({ dir: 'E', code: eoiCode, size: codeSize, next });
  bw.write(prefix, codeSize);
  bw.write(eoiCode, codeSize);
  bw.flush();
  return bw.bytes;
}

function subBlocks(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    const n = Math.min(255, bytes.length - i);
    out.push(n);
    for (let j = 0; j < n; j++) out.push(bytes[i + j]);
    i += n;
  }
  out.push(0);
  return out;
}

/**
 * @param {Object} opts
 * @param {Array<Uint8Array>} opts.frames  每帧的调色板索引数组（w*h）
 * @param {number} opts.w
 * @param {number} opts.h
 * @param {Array<[number,number,number]>} opts.palette
 * @param {number} opts.delay  百分之一秒（10 = 100ms）
 * @param {boolean} opts.loop  是否循环播放
 */
function encodeGIF(opts) {
  const { frames, w, h, palette, delay, loop, log } = opts;
  const b = [];
  const str = (s) => { for (const c of s) b.push(c.charCodeAt(0)); };

  str('GIF89a');
  b.push(w & 255, w >> 8, h & 255, h >> 8);

  // 调色板大小必须是 2 的幂（不足补黑）
  let bits = 0;
  while ((1 << bits) < palette.length) bits++;
  const palBits = Math.max(1, bits) - 1; // 字段值 = log2(size) - 1
  const palSize = 1 << (palBits + 1);
  b.push(0x80 | (0x7 << 4) | palBits); // 有全局色表、色彩分辨率 7、非排序
  b.push(0); // 背景色索引
  b.push(0); // 像素宽高比
  for (let i = 0; i < palSize; i++) {
    const c = palette[i] || [0, 0, 0];
    b.push(c[0], c[1], c[2]);
  }

  if (loop && frames.length > 1) {
    b.push(0x21, 0xff, 0x0b);
    str('NETSCAPE2.0');
    b.push(0x03, 0x01, 0x00, 0x00); // 无限循环
    b.push(0x00);
  }

  const minCodeSize = Math.max(2, palBits + 1);
  for (let i = 0; i < frames.length; i++) {
    // Graphic Control Extension：处置方式 1（不处置，整帧覆盖）
    b.push(0x21, 0xf9, 0x04, 0x04, delay & 255, (delay >> 8) & 255, 0, 0x00);
    // Image Descriptor
    b.push(0x2c, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0x00);
    b.push(minCodeSize);
    for (const v of subBlocks(lzwEncode(minCodeSize, frames[i], log))) b.push(v);
  }

  b.push(0x3b); // Trailer
  return Buffer.from(b);
}

/**
 * 进阶编码：支持帧间差分（小矩形 + 透明占位）、每帧独立延迟/偏移/disposal
 * 这是控制体积的关键 —— 动作演示图每帧只有肢体在动，全幅编码会把体积撑到十几倍
 *
 * @param {Object} opts
 * @param {number} opts.w  逻辑屏宽
 * @param {number} opts.h  逻辑屏高
 * @param {Array<[number,number,number]>} opts.palette  全局色表（长度须能补齐为 2 的幂）
 * @param {number} opts.transparentIndex  透明占位色号（-1 表示不使用透明）
 * @param {boolean} opts.loop
 * @param {Array<Object>} opts.frames
 *        { indices: Uint8Array(局部 w*h), left, top, w, h, delay(1/100s), disposal }
 */
function encodeGIFFrames(opts) {
  const { w, h, palette, frames, loop, transparentIndex = -1 } = opts;
  const b = [];
  const str = (s) => { for (const c of s) b.push(c.charCodeAt(0)); };

  str('GIF89a');
  b.push(w & 255, w >> 8, h & 255, h >> 8);

  let bits = 0;
  while ((1 << bits) < palette.length) bits++;
  const palBits = Math.max(1, bits) - 1;
  const palSize = 1 << (palBits + 1);
  b.push(0x80 | (0x7 << 4) | palBits);
  b.push(0);
  b.push(0);
  for (let i = 0; i < palSize; i++) {
    const c = palette[i] || [0, 0, 0];
    b.push(c[0], c[1], c[2]);
  }

  if (loop && frames.length > 1) {
    b.push(0x21, 0xff, 0x0b);
    str('NETSCAPE2.0');
    b.push(0x03, 0x01, 0x00, 0x00, 0x00);
  }

  const minCodeSize = Math.max(2, palBits + 1);
  for (const f of frames) {
    const transparent = f.transparent !== undefined ? f.transparent : transparentIndex >= 0;
    const disposal = f.disposal === undefined ? 1 : f.disposal;
    b.push(0x21, 0xf9, 0x04, ((disposal & 7) << 2) | (transparent ? 1 : 0));
    b.push(f.delay & 255, (f.delay >> 8) & 255);
    b.push(transparent ? transparentIndex : 0, 0x00);

    b.push(0x2c);
    b.push(f.left & 255, f.left >> 8, f.top & 255, f.top >> 8);
    b.push(f.w & 255, f.w >> 8, f.h & 255, f.h >> 8);
    b.push(0x00);
    b.push(minCodeSize);
    for (const v of subBlocks(lzwEncode(minCodeSize, f.indices))) b.push(v);
  }

  b.push(0x3b);
  return Buffer.from(b);
}

module.exports = { encodeGIF, encodeGIFFrames };
