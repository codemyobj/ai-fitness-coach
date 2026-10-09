/**
 * tools/lib/png-decode.js — 极简 PNG 解码器（零依赖，Node zlib）
 * 支持：8-bit、颜色类型 0(灰)/2(RGB)/4(灰+A)/6(RGBA)、非隔行
 * 用途：读取 AI 生成的原始 PNG，供 build-images.js 降采样 + 量化
 */
const zlib = require('zlib');

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * @returns {{ width, height, channels, pixels:Uint8Array }} pixels 为交错 RGB(A)
 */
function decodePNG(buf) {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('PNG 签名非法');

  let p = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let palette = null, trns = null;

  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    p += 12 + len; // len + type + data + crc

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      trns = Buffer.from(data);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8) throw new Error(`不支持的位深 ${bitDepth}（仅 8）`);
  if (interlace !== 0) throw new Error('不支持隔行（Adam7）PNG');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`不支持的颜色类型 ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * channels);

  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) v = (v + paeth(a, b, c)) & 255;
      cur[x] = v;
    }
    prev = cur;
  }

  // 索引色 → RGB 展开
  if (colorType === 3) {
    if (!palette) throw new Error('索引色缺少 PLTE');
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      const idx = out[i];
      rgb[i * 3] = palette[idx * 3];
      rgb[i * 3 + 1] = palette[idx * 3 + 1];
      rgb[i * 3 + 2] = palette[idx * 3 + 2];
    }
    return { width, height, channels: 3, pixels: rgb, trns };
  }

  return { width, height, channels, pixels: out, trns };
}

/** 任意输入 → RGB（丢弃 alpha，透明/半透明按白底合成） */
function toRGB(img) {
  const { width, height, channels, pixels } = img;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    if (channels >= 3) {
      let r = pixels[i * channels], g = pixels[i * channels + 1], b = pixels[i * channels + 2];
      if (channels === 4) {
        const a = pixels[i * channels + 3] / 255;
        r = Math.round(r * a + 255 * (1 - a));
        g = Math.round(g * a + 255 * (1 - a));
        b = Math.round(b * a + 255 * (1 - a));
      }
      rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
    } else {
      const v = pixels[i * channels];
      rgb[i * 3] = v; rgb[i * 3 + 1] = v; rgb[i * 3 + 2] = v;
    }
  }
  return { width, height, pixels: rgb };
}

/** 面积加权降采样（box filter，支持非整数比例） */
function resize(img, dw, dh) {
  const { width: sw, height: sh, pixels } = img;
  const out = new Uint8Array(dw * dh * 3);
  for (let dy = 0; dy < dh; dy++) {
    const sy0 = (dy * sh) / dh, sy1 = ((dy + 1) * sh) / dh;
    for (let dx = 0; dx < dw; dx++) {
      const sx0 = (dx * sw) / dw, sx1 = ((dx + 1) * sw) / dw;
      let r = 0, g = 0, b = 0, wsum = 0;
      for (let sy = Math.floor(sy0); sy < Math.min(sh, Math.ceil(sy1)); sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        if (wy <= 0) continue;
        for (let sx = Math.floor(sx0); sx < Math.min(sw, Math.ceil(sx1)); sx++) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
          if (wx <= 0) continue;
          const w = wx * wy;
          const i = (sy * sw + sx) * 3;
          r += pixels[i] * w; g += pixels[i + 1] * w; b += pixels[i + 2] * w;
          wsum += w;
        }
      }
      const o = (dy * dw + dx) * 3;
      out[o] = Math.round(r / wsum);
      out[o + 1] = Math.round(g / wsum);
      out[o + 2] = Math.round(b / wsum);
    }
  }
  return { width: dw, height: dh, pixels: out };
}

module.exports = { decodePNG, toRGB, resize };
