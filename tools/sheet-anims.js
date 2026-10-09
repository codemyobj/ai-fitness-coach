/**
 * tools/sheet-anims.js — 把某个动图的连续帧拼成印相图（用于肉眼检查插值/鬼影）
 * 用法：node tools/sheet-anims.js squat --n=12 --cols=6 [--scale=0.75] [--src]
 *   --src 用 tools/dataset 的原始素材，否则用小程序里的产物
 */
const fs = require('fs');
const path = require('path');
const { lzwDecode } = require('./lib/gif-decode.js');
const { composeFrames } = require('./lib/gif-parse.js');
const { encodePNG } = require('./lib/png.js');

const args = process.argv.slice(2);
const opt = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? Number(h.split('=')[1]) : d; };
const useSrc = args.includes('--src');
const id = args.find((a) => !a.startsWith('--')) || 'squat';
const n = opt('n', 12);
const cols = opt('cols', 6);
const scale = opt('scale', 0.75);

const file = useSrc
  ? path.join(__dirname, 'dataset', `${id}.gif`)
  : path.join(__dirname, '..', 'miniprogram', 'packageA', 'library', 'images', `${id}.gif`);
const g = composeFrames(fs.readFileSync(file), lzwDecode);

const S = Math.round(g.width * scale);
const rows = Math.ceil(Math.min(n, g.frames.length) / cols);
const sheet = Buffer.alloc(cols * S * rows * S * 3, 255);
const start = opt('start', 0);
for (let i = 0; i < Math.min(n, g.frames.length - start); i++) {
  const f = g.frames[start + i];
  const cx = (i % cols) * S, cy = Math.floor(i / cols) * S;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const sx = Math.min(g.width - 1, Math.floor(x / scale));
      const sy = Math.min(g.height - 1, Math.floor(y / scale));
      const si = (sy * g.width + sx) * 3;
      const di = ((cy + y) * cols * S + (cx + x)) * 3;
      sheet[di] = f[si]; sheet[di + 1] = f[si + 1]; sheet[di + 2] = f[si + 2];
    }
  }
}
const out = path.join(__dirname, `sheet-${id}${useSrc ? '-src' : ''}.png`);
fs.writeFileSync(out, encodePNG(cols * S, rows * S, sheet));
console.log(`${out}  (${cols}列 × ${rows}行, 第 ${start}~${start + n - 1} 帧, 共 ${g.frames.length} 帧, 每帧 ${S}px)`);
