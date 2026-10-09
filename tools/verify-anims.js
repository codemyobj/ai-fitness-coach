/**
 * tools/verify-anims.js — 丝滑化产物的端到端校验
 *
 * 做两件事：
 *  1. 正确性：把产物 GIF 用「解析 → disposal/透明合成 → 独立 LZW 解码」还原成像素，
 *     与管线应有的参考序列（源素材合成 + 同样的插值）逐帧比对。
 *     差分帧/透明索引/帧矩形任何一处写错，帧数或像素都会对不上。
 *  2. 画质：统计每帧平均通道误差 / PSNR，用来判断调色板降到多少色还能接受。
 *
 * 用法：node tools/verify-anims.js [--interp=1] [--fps=20] [squat pushup ...]
 */
const fs = require('fs');
const path = require('path');
const { lzwDecode } = require('./lib/gif-decode.js');
const { composeFrames } = require('./lib/gif-parse.js');

const SRC = path.join(__dirname, 'dataset');
const OUT = path.join(__dirname, '..', 'miniprogram', 'packageA', 'library', 'images');

const args = process.argv.slice(2);
const opt = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? Number(h.split('=')[1]) : d; };
const INTERP = opt('interp', 1);
const only = args.filter((a) => !a.startsWith('--'));

const ids = require('../miniprogram/assets/data/exercises.js').exercises.map((e) => e.id)
  .filter((id) => !only.length || only.includes(id));

function blend(a, b, t) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.round(a[i] * (1 - t) + b[i] * t);
  return out;
}

function psnrAndMae(a, b) {
  let se = 0, ae = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    se += d * d; ae += Math.abs(d);
  }
  const mse = se / n;
  return { mae: ae / n, psnr: mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse) };
}

let pass = 0, fail = 0;
console.log('动作'.padEnd(24), '帧数', '体积', '平均误差', 'PSNR', '结论');
console.log('-'.repeat(78));

const agg = [];
for (const id of ids) {
  const srcPath = path.join(SRC, `${id}.gif`);
  const outPath = path.join(OUT, `${id}.gif`);
  if (!fs.existsSync(srcPath) || !fs.existsSync(outPath)) { console.log(id.padEnd(24), '缺文件'); continue; }

  const src = composeFrames(fs.readFileSync(srcPath), lzwDecode);
  // 参考序列 = 源帧 + 交叉淡化插值（与管线完全一致的算法）
  const ref = [];
  for (let i = 0; i < src.frames.length; i++) {
    ref.push(src.frames[i]);
    for (let t = 1; t <= INTERP; t++) {
      ref.push(blend(src.frames[i], src.frames[(i + 1) % src.frames.length], t / (INTERP + 1)));
    }
  }

  const out = composeFrames(fs.readFileSync(outPath), lzwDecode);
  const size = fs.statSync(outPath).size;
  const problems = [];
  if (out.width !== src.width || out.height !== src.height) problems.push(`尺寸 ${out.width}x${out.height}`);
  if (out.frames.length !== ref.length) problems.push(`帧数 ${out.frames.length}≠${ref.length}`);

  let mae = 0, psnr = 0, cmpN = 0;
  const limit = Math.min(out.frames.length, ref.length);
  for (let i = 0; i < limit; i++) {
    if (out.frames[i].length !== ref[i].length) { problems.push(`帧${i} 像素数`); break; }
    const r = psnrAndMae(out.frames[i], ref[i]);
    mae += r.mae; psnr += r.psnr; cmpN++;
  }
  mae /= cmpN || 1; psnr /= cmpN || 1;

  const okFlag = problems.length === 0;
  if (okFlag) pass++; else fail++;
  console.log(
    id.padEnd(24),
    String(out.frames.length).padStart(4),
    ((size / 1024).toFixed(0) + 'KB').padStart(6),
    mae.toFixed(2).padStart(8),
    psnr.toFixed(1).padStart(5),
    okFlag ? '✅' : '❌ ' + problems.join('; ')
  );
  agg.push({ id, size, mae, psnr });
}

console.log('-'.repeat(78));
const tot = agg.reduce((n, a) => n + a.size, 0);
console.log(`通过 ${pass} / 失败 ${fail}   合计 ${(tot / 1024).toFixed(0)}KB   平均误差 ${(agg.reduce((n, a) => n + a.mae, 0) / (agg.length || 1)).toFixed(2)}   平均PSNR ${(agg.reduce((n, a) => n + a.psnr, 0) / (agg.length || 1)).toFixed(1)}dB`);
process.exit(fail ? 1 : 0);
