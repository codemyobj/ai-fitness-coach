/**
 * tools/build-anims.js — 双关键帧 AI 插画 → 循环动图 GIF
 * 输入 tools/raw/<id>.png（姿势A，已有）+ tools/raw/<id>_b.png（姿势B，编辑模式生成）
 * 输出 miniprogram/packageA/library/images/<id>.gif
 *
 * 原理：两帧共用一张量化调色板（保证颜色一致不闪烁），
 *       按 ping-pong 循环 A↔B 播放，读作完整动作轨迹。
 * 平板支撑（等长静力动作）无姿势B，用「核心高亮脉冲」模拟发力感。
 */
const fs = require('fs');
const path = require('path');
const { decodePNG, toRGB, resize } = require('./lib/png-decode.js');
const { quantize } = require('./lib/quantize.js');
const { encodeGIF } = require('./lib/gif.js');

const EXERCISE_IDS = require('../miniprogram/assets/data/exercises.js')
  .exercises.map((e) => e.id);

const RAW_DIR = path.join(__dirname, 'raw');
const OUT_DIR = path.join(__dirname, '..', 'miniprogram', 'packageA', 'library', 'images');
const SIZE = 240;        // 动图分辨率（体积敏感，240 在 360rpx 弹层里足够清晰）
const MAX_COLORS = 64;   // 扁平插画 64 色足够，调色板越小 LZW 压得越狠
const DELAY = 45;        // 每帧 450ms，一个完整动作周期约 0.9s

/** 与 build-images.js 相同的背景净化 */
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

/** 加载一张原图 → 净化 + 缩放，返回 {width,height,pixels} */
function loadFrame(file) {
  const img = toRGB(decodePNG(fs.readFileSync(file)));
  cleanBackground(img);
  return resize(img, SIZE, SIZE);
}

/** 平板支撑脉冲帧：把青绿色高亮调淡 45%，模拟核心「发力-保持」节奏 */
function pulseFrame(img) {
  const out = { width: img.width, height: img.height, pixels: Uint8Array.from(img.pixels) };
  for (let i = 0; i < img.width * img.height; i++) {
    const r = img.pixels[i * 3], g = img.pixels[i * 3 + 1], b = img.pixels[i * 3 + 2];
    if (g - r > 40 && g - b > 20 && g > 110) { // 青绿高亮 (#10B981 系)
      out.pixels[i * 3]     = Math.round(r + (255 - r) * 0.45);
      out.pixels[i * 3 + 1] = Math.round(g + (255 - g) * 0.45);
      out.pixels[i * 3 + 2] = Math.round(b + (255 - b) * 0.45);
    }
  }
  return out;
}

/**
 * 两帧对齐自检。
 * 注意：不能用包围盒 IoU —— 姿势包络本身就会变（波比跳站起来比蹲着高 25%），
 * 会把「动作幅度大」误判成「构图跑偏」。真正该看的是：人有没有横向漂、有没有离地。
 */
function alignScore(a, b) {
  const boxA = bbox(a), boxB = bbox(b);
  const cxA = (boxA[0] + boxA[2]) / 2, cxB = (boxB[0] + boxB[2]) / 2;
  const dxPct = Math.abs(cxB - cxA) / a.width * 100;          // 水平漂移
  const footPct = Math.abs(boxB[3] - boxA[3]) / a.height * 100; // 脚底（接地）位移
  return { dxPct, footPct, bad: dxPct > 5 || footPct > 15 };
}

/** 非白像素包围盒（用于两帧对齐自检） */
function bbox(img) {
  const { width: w, height: h, pixels } = img;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    if (pixels[i] < 244 || pixels[i + 1] < 244 || pixels[i + 2] < 244) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return [x0, y0, x1, y1];
}

fs.mkdirSync(OUT_DIR, { recursive: true });
let total = 0, done = 0, skipped = [], loose = [];

for (const id of EXERCISE_IDS) {
  const fileA = path.join(RAW_DIR, `${id}.png`);
  const fileB = path.join(RAW_DIR, `${id}_b.png`);
  if (!fs.existsSync(fileA)) { skipped.push(`${id}(无A)`); continue; }
  if (!fs.existsSync(fileB)) { skipped.push(`${id}(无B)`); continue; }

  const a = loadFrame(fileA);
  const b = loadFrame(fileB);

  // 两帧拼成一张伪图做联合量化 → 共享调色板（关键：避免帧间颜色跳变）
  const n = SIZE * SIZE;
  const combo = {
    width: SIZE * 2, height: SIZE,
    pixels: new Uint8Array(n * 2 * 3),
  };
  combo.pixels.set(a.pixels, 0);
  combo.pixels.set(b.pixels, n * 3);
  const { indices, palette } = quantize(combo, MAX_COLORS, true);

  const frames = [indices.slice(0, n), indices.slice(n, n * 2)];
  const gif = encodeGIF({ frames, w: SIZE, h: SIZE, palette, delay: DELAY, loop: true });
  const dest = path.join(OUT_DIR, `${id}.gif`);
  fs.writeFileSync(dest, gif);

  const al = alignScore(a, b);
  if (al.bad) loose.push(`${id}(横漂${al.dxPct.toFixed(1)}%/离地${al.footPct.toFixed(1)}%)`);
  const kb = (gif.length / 1024).toFixed(1);
  console.log(`  ${al.bad ? '⚠️' : '✅'} ${id.padEnd(26)} ${palette.length}色 → ${kb}KB  横漂${al.dxPct.toFixed(1)}% 接地位移${al.footPct.toFixed(1)}%`);
  total += gif.length; done++;
}

// 平板支撑：无 B 帧，用脉冲动画（不依赖生成，直接从 A 图构造）
{
  const id = 'plank';
  const fileA = path.join(RAW_DIR, `${id}.png`);
  if (fs.existsSync(fileA) && !EXERCISE_IDS.some((x) => false)) {
    const a = loadFrame(fileA);
    const b = pulseFrame(a);
    const n = SIZE * SIZE;
    const combo = { width: SIZE * 2, height: SIZE, pixels: new Uint8Array(n * 2 * 3) };
    combo.pixels.set(a.pixels, 0);
    combo.pixels.set(b.pixels, n * 3);
    const { indices, palette } = quantize(combo, MAX_COLORS, true);
    const frames = [indices.slice(0, n), indices.slice(n, n * 2)];
    const gif = encodeGIF({ frames, w: SIZE, h: SIZE, palette, delay: 55, loop: true });
    fs.writeFileSync(path.join(OUT_DIR, `${id}.gif`), gif);
    console.log(`  ✅ ${id.padEnd(26)} ${palette.length}色 → ${(gif.length / 1024).toFixed(1)}KB（核心脉冲）`);
    total += gif.length; done++;
  }
}

console.log(`\n完成 ${done} 个动图，合计 ${(total / 1024).toFixed(1)} KB`);
if (skipped.length) console.log(`跳过（缺姿势B原图）：${skipped.join(', ')}`);
if (loose.length) console.log(`⚠️ 两帧构图差异偏大（动画会跳，建议重生成对应 _b.png）：${loose.join(', ')}`);
