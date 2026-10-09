/**
 * tools/apply-dataset-images.js — 把下载好的公开动作素材装进小程序
 * - <id>.gif  → 循环演示动画（详情弹层 / 跟练要点弹层）
 * - <id>.jpg  → 静态缩略图（列表卡，避免 12 个动图同屏播放）
 * 原 AI 生成的 .gif / .png 会被一并清掉。
 *
 * 用法：node tools/apply-dataset-images.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'dataset');
const OUT = path.join(__dirname, '..', 'miniprogram', 'packageA', 'library', 'images');
const IDS = require('../miniprogram/assets/data/exercises.js').exercises.map((e) => e.id);

fs.mkdirSync(OUT, { recursive: true });

// 1. 清掉旧的自绘/AI 素材
let removed = 0;
for (const f of fs.readdirSync(OUT)) {
  if (/\.(gif|png)$/i.test(f)) { fs.unlinkSync(path.join(OUT, f)); removed++; }
}

// 2. 复制新素材并做完整性校验（GIF 头必须是 GIF89a，JPG 头必须是 FFD8FF）
let gifTotal = 0, jpgTotal = 0, missing = [];
for (const id of IDS) {
  const gifSrc = path.join(SRC, `${id}.gif`);
  const jpgSrc = path.join(SRC, 'images', `${id}.jpg`);
  if (!fs.existsSync(gifSrc) || !fs.existsSync(jpgSrc)) { missing.push(id); continue; }

  const gif = fs.readFileSync(gifSrc);
  const jpg = fs.readFileSync(jpgSrc);
  if (gif.slice(0, 6).toString('ascii') !== 'GIF89a') throw new Error(`${id}.gif 文件头非法`);
  if (jpg[0] !== 0xff || jpg[1] !== 0xd8) throw new Error(`${id}.jpg 不是 JPEG`);

  fs.writeFileSync(path.join(OUT, `${id}.gif`), gif);
  fs.writeFileSync(path.join(OUT, `${id}.jpg`), jpg);
  gifTotal += gif.length;
  jpgTotal += jpg.length;
  console.log(`  ✅ ${id.padEnd(24)} gif ${(gif.length / 1024).toFixed(0)}KB + jpg ${(jpg.length / 1024).toFixed(0)}KB`);
}

console.log(`\n清理旧素材 ${removed} 个；装入动图 12 张合计 ${(gifTotal / 1024).toFixed(0)}KB，缩略图 ${(jpgTotal / 1024).toFixed(0)}KB`);
if (missing.length) console.log(`⚠️ 缺素材：${missing.join(', ')}`);
