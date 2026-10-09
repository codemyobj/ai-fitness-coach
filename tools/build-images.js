/**
 * tools/build-images.js — AI 原图 → 小程序可用压缩图
 * 输入 tools/raw/<id>.png（ImageGen 产物，1024×1024）
 * 输出 miniprogram/packageA/library/images/<id>.png（360×360，索引色，白底）
 */
const fs = require('fs');
const path = require('path');
const { decodePNG, toRGB, resize } = require('./lib/png-decode.js');
const { quantize } = require('./lib/quantize.js');
const { encodePalettePNG } = require('./lib/png.js');

const EXERCISE_IDS = require('../miniprogram/assets/data/exercises.js')
  .exercises.map((e) => e.id);

const RAW_DIR = path.join(__dirname, 'raw');
const OUT_DIR = path.join(__dirname, '..', 'miniprogram', 'packageA', 'library', 'images');
const SIZE = 360;      // 详情弹层 360rpx ≈ 180px，360px 保证 2x 清晰
const MAX_COLORS = 96; // 扁平插画 96 色足够

/** 从四边泛洪填充：把与背景连通的「近白噪点」（纸纹理/渐变灰底）统一成纯白 */
function cleanBackground(img) {
  const { width: w, height: h, pixels } = img;
  const isWashy = (i) => {
    const r = pixels[i * 3], g = pixels[i * 3 + 1], b = pixels[i * 3 + 2];
    return Math.min(r, g, b) > 214 && Math.max(r, g, b) - Math.min(r, g, b) < 30;
  };
  const stack = [];
  const seen = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop();
    if (p < 0 || p >= w * h || seen[p] || !isWashy(p)) continue;
    seen[p] = 1;
    pixels[p * 3] = 255; pixels[p * 3 + 1] = 255; pixels[p * 3 + 2] = 255;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });
let total = 0, done = 0, missing = [];

for (const id of EXERCISE_IDS) {
  const src = path.join(RAW_DIR, `${id}.png`);
  if (!fs.existsSync(src)) { missing.push(id); continue; }

  const img = toRGB(decodePNG(fs.readFileSync(src)));
  cleanBackground(img);
  const small = resize(img, SIZE, SIZE);
  const { indices, palette } = quantize(small, MAX_COLORS, true);
  const out = encodePalettePNG(SIZE, SIZE, indices, palette);
  const dest = path.join(OUT_DIR, `${id}.png`);
  fs.writeFileSync(dest, out);

  const kb = (out.length / 1024).toFixed(1);
  const srcKb = (fs.statSync(src).size / 1024).toFixed(0);
  console.log(`  ✅ ${id.padEnd(26)} ${srcKb}KB → ${kb}KB  (${SIZE}x${SIZE}, ${palette.length} 色)`);
  total += out.length; done++;
}

console.log(`\n完成 ${done} 张，合计 ${(total / 1024).toFixed(1)} KB`);
if (missing.length) console.log(`缺少原图（待生成）：${missing.join(', ')}`);
