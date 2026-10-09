/**
 * tools/lib/quantize.js — 中位切分量化（median cut）+ 最近色映射
 * 针对「白底扁平插画」优化：纯白必须进调色板；不做抖动（扁平色块抖动反而脏）
 */

/** 中位切分：把像素桶切成 k 个，返回 [[r,g,b], ...] */
function medianCut(pixels, k) {
  // 桶：{pixels: [r,g,b,...扁平数组], }
  let boxes = [[pixels, 0, pixels.length / 3]];
  // pixels 为扁平 RGB 数组；boxes 内用 [start,end) 索引范围 + 原地分区
  const arr = pixels;

  const rangeOf = (start, end, ch) => {
    let min = 255, max = 0;
    for (let i = start; i < end; i++) {
      const v = arr[i * 3 + ch];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return max - min;
  };

  while (boxes.length < k) {
    // 找到「体量最大」（像素数 × 通道极差）的桶
    let best = -1, bestScore = -1;
    for (let i = 0; i < boxes.length; i++) {
      const [a, s, e] = boxes[i];
      if (e - s < 2) continue;
      const r = rangeOf(s, e, 0), g = rangeOf(s, e, 1), b = rangeOf(s, e, 2);
      const score = Math.max(r, g, b) * (e - s);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0 || bestScore <= 0) break;

    let [a, s, e] = boxes[best];
    // 选极差最大的通道做切分
    const r = rangeOf(s, e, 0), g = rangeOf(s, e, 1), b = rangeOf(s, e, 2);
    const ch = r >= g && r >= b ? 0 : (g >= b ? 1 : 2);
    // 按该通道中位数分区（简单排序切片，桶通常几千个，可接受）
    const slice = [];
    for (let i = s; i < e; i++) slice.push([arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]]);
    slice.sort((p, q) => p[ch] - q[ch]);
    const mid = slice.length >> 1;
    for (let i = 0; i < slice.length; i++) {
      const j = (s + i) * 3;
      arr[j] = slice[i][0]; arr[j + 1] = slice[i][1]; arr[j + 2] = slice[i][2];
    }
    boxes[best] = [a, s, s + mid];
    boxes.push([a, s + mid, e]);
  }

  const palette = [];
  for (const [, s, e] of boxes) {
    if (e <= s) continue;
    let r = 0, g = 0, b = 0;
    for (let i = s; i < e; i++) { r += arr[i * 3]; g += arr[i * 3 + 1]; b += arr[i * 3 + 2]; }
    const n = e - s;
    palette.push([
      Math.round(r / n),
      Math.round(g / n),
      Math.round(b / n),
    ]);
  }
  return palette;
}

/**
 * 量化：img {width,height,pixels(RGB)} → { indices, palette }
 * forceWhite: 近白像素一律并入 (255,255,255)，且保证其为 palette[0]
 */
function quantize(img, maxColors, forceWhite) {
  const { width, height, pixels } = img;
  const n = width * height;

  if (forceWhite) {
    for (let i = 0; i < n; i++) {
      const r = pixels[i * 3], g = pixels[i * 3 + 1], b = pixels[i * 3 + 2];
      if (r > 242 && g > 242 && b > 242) {
        pixels[i * 3] = 255; pixels[i * 3 + 1] = 255; pixels[i * 3 + 2] = 255;
      }
    }
  }

  // 采样加速：最多取 6 万个像素参与切分
  const step = Math.max(1, Math.floor(n / 60000));
  const sample = new Uint8Array(Math.ceil(n / step) * 3);
  let m = 0;
  for (let i = 0; i < n; i += step) {
    sample[m * 3] = pixels[i * 3];
    sample[m * 3 + 1] = pixels[i * 3 + 1];
    sample[m * 3 + 2] = pixels[i * 3 + 2];
    m++;
  }
  const palette = medianCut(sample, maxColors);

  // 保证纯白在调色板里且是 index 0
  let hasWhite = palette.some((c) => c[0] > 250 && c[1] > 250 && c[2] > 250);
  if (forceWhite && !hasWhite) palette.unshift([255, 255, 255]);
  for (let i = 0; i < palette.length; i++) {
    if (palette[i][0] > 250 && palette[i][1] > 250 && palette[i][2] > 250) {
      const t = palette[0]; palette[0] = palette[i]; palette[i] = t;
      palette[0] = [255, 255, 255];
      break;
    }
  }

  // 最近色映射（带缓存）
  const cache = new Map();
  const indices = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = pixels[i * 3], g = pixels[i * 3 + 1], b = pixels[i * 3 + 2];
    const key = (r << 16) | (g << 8) | b;
    let idx = cache.get(key);
    if (idx === undefined) {
      let best = 0, bestD = Infinity;
      for (let p = 0; p < palette.length; p++) {
        const dr = r - palette[p][0], dg = g - palette[p][1], db = b - palette[p][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = p; }
      }
      idx = best;
      cache.set(key, idx);
    }
    indices[i] = idx;
  }

  return { indices, palette };
}

module.exports = { quantize, medianCut };
