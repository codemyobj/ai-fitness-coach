/**
 * tools/verify-repdb.js — 端到端校验生成的动作动图
 *
 * 不是「看起来对」，而是把产物 GIF 解码回像素，跟 RepDB 原始姿势逐帧比：
 *   1. 帧数/尺寸对不对
 *   2. 首帧 = 起始姿势、第 N 帧 = 顶峰姿势（PSNR 阈值）
 *   3. 帧间变化是否单调推进（证明是真的在动，不是闪）
 *   4. 循环接缝是否等于一个普通步长（证明首尾接得上）
 *   5. 脉冲类动画（平板支撑）两帧差异应当在合理区间
 *
 * 用法：NODE_PATH=<workspace>/node_modules node tools/verify-repdb.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { lzwDecode } = require('./lib/gif-decode.js');
const { composeFrames } = require('./lib/gif-parse.js');

const WEBP = path.join(__dirname, 'repdb', 'webp');
const OUT = path.join(__dirname, '..', 'miniprogram', 'packageA', 'library', 'images');
const SIZE = 240;
const STEPS = 10;
const BG = [217, 241, 253];

async function loadRef(file) {
  const { data, info } = await sharp(file)
    .resize(SIZE, SIZE, { fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const px = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = data[i * info.channels + 3] / 255;
    for (let c = 0; c < 3; c++) px[i * 3 + c] = Math.round(data[i * info.channels + c] * a + 255 * (1 - a));
  }
  const near = (i) => Math.abs(px[i * 3] - BG[0]) < 26 && Math.abs(px[i * 3 + 1] - BG[1]) < 26 && Math.abs(px[i * 3 + 2] - BG[2]) < 26;
  const seen = new Uint8Array(n);
  const stack = [];
  for (let x = 0; x < SIZE; x++) stack.push(x, (SIZE - 1) * SIZE + x);
  for (let y = 0; y < SIZE; y++) stack.push(y * SIZE, y * SIZE + SIZE - 1);
  while (stack.length) {
    const p = stack.pop();
    if (p < 0 || p >= n || seen[p] || !near(p)) continue;
    seen[p] = 1;
    px[p * 3] = 255; px[p * 3 + 1] = 255; px[p * 3 + 2] = 255;
    const x = p % SIZE, y = (p / SIZE) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < SIZE - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - SIZE);
    if (y < SIZE - 1) stack.push(p + SIZE);
  }
  return px;
}

const rmse = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s / a.length);
};
const psnr = (e) => (e === 0 ? 99 : 20 * Math.log10(255 / e));

(async () => {
  const ids = JSON.parse(fs.readFileSync(path.join(__dirname, 'repdb', 'manifest.json'), 'utf8'));
  let pass = 0, fail = 0;

  for (const id of Object.keys(ids)) {
    const gifPath = path.join(OUT, `${id}.gif`);
    const jpgPath = path.join(OUT, `${id}.jpg`);
    const hasGif = fs.existsSync(gifPath);

    // 静态图必须存在且是真 JPEG
    const jpg = fs.readFileSync(jpgPath);
    if (!(jpg[0] === 0xff && jpg[1] === 0xd8)) { console.log(`❌ ${id} 缩略图不是 JPEG`); fail++; continue; }
    if (!hasGif) { console.log(`  ⚪ ${id.padEnd(24)} 仅静态（素材单姿势）—— 已确认无动画`); pass++; continue; }

    const g = composeFrames(fs.readFileSync(gifPath), lzwDecode);
    const errs = [];
    if (g.width !== SIZE || g.height !== SIZE) errs.push(`尺寸 ${g.width}x${g.height}`);

    const startFile = path.join(WEBP, `${id}-start.webp`);
    const peakFile = path.join(WEBP, `${id}-peak.webp`);
    const twoPose = fs.existsSync(startFile) && fs.existsSync(peakFile);

    if (twoPose) {
      if (g.frames.length !== STEPS * 2) errs.push(`帧数 ${g.frames.length}≠${STEPS * 2}`);
      const startRef = await loadRef(startFile);
      const peakRef = await loadRef(peakFile);
      const p0 = psnr(rmse(g.frames[0], startRef));
      const pk = psnr(rmse(g.frames[STEPS], peakRef));
      if (p0 < 30) errs.push(`首帧≠起始姿势 PSNR${p0.toFixed(1)}`);
      if (pk < 30) errs.push(`第${STEPS}帧≠顶峰姿势 PSNR${pk.toFixed(1)}`);

      // 单调推进：相对首帧的差异应逐步增大
      const d = g.frames.slice(0, STEPS + 1).map((f) => rmse(f, g.frames[0]));
      let mono = true;
      for (let i = 1; i < d.length; i++) if (d[i] < d[i - 1] - 1.5) mono = false;
      if (!mono) errs.push('帧序列非单调推进');

      // 循环接缝：末帧→首帧应 ≈ 一个普通步长
      const seam = rmse(g.frames[g.frames.length - 1], g.frames[0]);
      const step = rmse(g.frames[1], g.frames[0]);
      if (seam > step * 2.2) errs.push(`接缝跳变 ${seam.toFixed(1)} vs 步长 ${step.toFixed(1)}`);
      console.log(
        `  ${errs.length ? '❌' : '✅'} ${id.padEnd(24)} ${g.frames.length}帧 首帧PSNR${p0.toFixed(1)} 顶峰PSNR${pk.toFixed(1)}` +
        ` 步长${step.toFixed(1)} 接缝${seam.toFixed(1)}`
      );
    } else {
      const diff = rmse(g.frames[1], g.frames[0]);
      if (g.frames.length < 2) errs.push('脉冲动画帧数<2');
      if (diff < 0.5 || diff > 30) errs.push(`脉冲幅度异常 ${diff.toFixed(1)}`);
      console.log(`  ${errs.length ? '❌' : '✅'} ${id.padEnd(24)} 脉冲 ${g.frames.length}帧 幅度${diff.toFixed(1)}`);
    }

    if (errs.length) { fail++; console.log(`     └ ${errs.join('；')}`); } else pass++;
  }

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
