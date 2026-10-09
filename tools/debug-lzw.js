/**
 * tools/debug-lzw.js — 逐码对照：解码器读到的每个码 / 当时码长 / 当时 next
 * 目的：定位 LZW 码长失步的第一个位置
 */
const { encodeGIF } = require('./lib/gif.js');
const { decodeGIF } = require('./lib/gif-decode.js');

const PALETTE = [[255,255,255],[55,65,81],[156,163,175],[209,213,219],[229,231,235],[16,185,129],[167,243,208],[107,114,128]];

const w = 32, h = 32, n = w * h;
const idx = new Uint8Array(n);
let s = 7;
for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; idx[i] = s % 8; }

const encLog = [];
const buf = encodeGIF({ frames: [idx], w, h, palette: PALETTE, delay: 10, loop: false, log: encLog });

console.log('编码器发出的码流（前 20 个）：');
console.log('  序号   码值   码长   next');
encLog.slice(0, 20).forEach((r, i) => {
  const note = r.code === 8 ? 'CLEAR' : r.code === 9 ? 'EOI' : '';
  console.log(`  #${String(i).padStart(3)}   ${String(r.code).padStart(4)}   ${r.size}     ${String(r.next).padStart(4)}   ${note}`);
});
console.log('  总码数 =', encLog.length);
console.log('');

const log = [];
let err = null;
let decoded = null;
try { decoded = decodeGIF(buf, log); } catch (e) { err = e; }

console.log('期望像素 =', n, ' 解码出错 =', err ? err.message : '无');
if (decoded) console.log('首帧像素 =', decoded.frames[0].indices.length);
console.log('\n解码器读到的码流（前 45 个）：');
console.log('  序号   码值   码长   next   说明');
log.slice(0, 45).forEach((r, i) => {
  const note = r.code === (1 << 3) ? 'CLEAR' : r.code === (1 << 3) + 1 ? 'EOI' : '';
  console.log(`  #${String(i).padStart(3)}   ${String(r.code).padStart(4)}   ${r.size}     ${String(r.next).padStart(4)}   ${note}`);
});

// 码长变化点
console.log('\n码长变化轨迹：');
let last = -1;
const changes = [];
for (const r of log) {
  if (r.size !== last) { changes.push(`读到码 ${r.code} 时码长 ${last} → ${r.size}（next=${r.next}）`); last = r.size; }
}
console.log('  ' + changes.join('\n  '));
