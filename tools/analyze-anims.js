/**
 * tools/analyze-anims.js — 量动作动图的「丝滑度」指标
 * 关键：必须先用 dispose/disposal 语义合成出完整画面，否则差分帧之间无法比较
 */
const fs = require('fs');
const path = require('path');
const { lzwDecode } = require('./lib/gif-decode.js');
const { composeFrames } = require('./lib/gif-parse.js');

const SRC = path.join(__dirname, 'dataset');
const ids = require('../miniprogram/assets/data/exercises.js').exercises.map((e) => e.id);

function diffPct(a, b) {
  let n = 0;
  const px = a.length / 3;
  for (let i = 0; i < a.length; i += 3) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
  }
  return (n / px) * 100;
}

const file = process.argv[2];
const list = file ? [path.basename(file, '.gif')] : ids;

console.log('动作'.padEnd(24), '帧数', '总时长', '延迟序列', '逐步变化%', '循环接缝%');
console.log('-'.repeat(110));

const report = [];
for (const id of list) {
  const p = path.join(SRC, `${id}.gif`);
  if (!fs.existsSync(p)) { console.log(id.padEnd(24), '缺文件'); continue; }
  const { frames, delays } = composeFrames(fs.readFileSync(p), lzwDecode);
  const steps = [];
  for (let i = 1; i < frames.length; i++) steps.push(diffPct(frames[i - 1], frames[i]));
  const seam = diffPct(frames[frames.length - 1], frames[0]);
  const total = delays.reduce((a, b) => a + b, 0);
  const uniq = [...new Set(delays)];
  const fps = (frames.length / (total / 1000)).toFixed(1);

  console.log(
    id.padEnd(24),
    String(frames.length).padStart(4),
    (total / 1000).toFixed(2) + 's',
    (uniq.length === 1 ? String(uniq[0]) : uniq.join('/')).padStart(9),
    steps.map((s) => s.toFixed(1)).join(' '),
    '|' + seam.toFixed(1),
    ' fps=' + fps
  );
  const avg = steps.reduce((a, b) => a + b, 0) / steps.length;
  report.push({ id, n: frames.length, avg, max: Math.max(...steps), min: Math.min(...steps), seam, fps: +fps, total });
}

console.log('\n—— 汇总 ——');
for (const r of report) {
  const jitter = r.max / (r.min || 0.01);
  console.log(
    r.id.padEnd(24),
    '帧', String(r.n).padStart(2),
    '平均步长', r.avg.toFixed(1) + '%',
    '最大', r.max.toFixed(1) + '%',
    '不均度(max/min)', jitter.toFixed(1),
    '接缝', r.seam.toFixed(1) + '%',
    r.seam > r.avg * 1.8 ? '  ← 接缝跳变' : ''
  );
}
