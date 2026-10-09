/**
 * tools/diag.js — 诊断用（不参与交付）
 * 1) 用外部真实 GIF 校验「解码器是否符合规范」
 * 2) 用随机索引序列做 encode→decode 往返，定位首个分歧点
 */
const fs = require('fs');
const path = require('path');
const { decodeGIF } = require('./lib/gif-decode.js');
const { encodeGIF } = require('./lib/gif.js');

const REAL = [
  'D:/软件/PotPlayer/Html/loading.gif',
  'C:/Program Files/Microsoft OneDrive/26.168.0830.0006/AutoPlayOptIn.gif',
  'C:/Program Files/WindowsApps/12030rocksdanister.LivelyWallpaper_1.0.164.0_x64__97hta09mmv6hy/Assets/tray-tutorial.gif',
  'D:/软件/Thunder/Profiles/LoginPrompt/11a25ce5d06a6af996bbaacd4c8ea0f6.gif',
];

console.log('===== 1) 用外部真实 GIF 校验解码器 =====');
for (const f of REAL) {
  if (!fs.existsSync(f)) { console.log('  (跳过，不存在) ' + f); continue; }
  try {
    const g = decodeGIF(fs.readFileSync(f));
    const ok = g.frames.every((fr) => fr.indices.length === fr.w * fr.h);
    console.log(`  ${ok ? '✅' : '❌'} ${path.basename(f)}  ${g.width}x${g.height}  帧数=${g.frames.length}  调色板=${g.palette.length}`);
  } catch (e) {
    console.log(`  ❌ ${path.basename(f)}  ${e.message}`);
  }
}

console.log('\n===== 2) 随机序列往返（最小复现）=====');
const PALETTE = [[255,255,255],[55,65,81],[156,163,175],[209,213,219],[229,231,235],[16,185,129],[167,243,208],[107,114,128]];
function makeRandom(n, seed) {
  let s = seed;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = s % 8;
  }
  return out;
}

// 用「低熵」序列（更接近火柴人：大片同色），这才是真实负载
function makeBlob(n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = 0;
  for (let i = 0; i < n; i += 37) out[i] = 1;
  for (let i = 5; i < n; i += 53) out[i] = 2;
  return out;
}

const cases = [
  ['纯随机 180x180', makeRandom(180 * 180, 42)],
  ['低熵斑点 180x180', makeBlob(180 * 180)],
  ['纯随机 32x32', makeRandom(32 * 32, 7)],
];

for (const [name, idx] of cases) {
  const w = Math.round(Math.sqrt(idx.length));
  const h = w;
  const buf = encodeGIF({ frames: [idx], w, h, palette: PALETTE, delay: 10, loop: false });
  try {
    const g = decodeGIF(buf);
    const got = g.frames[0].indices;
    let firstDiff = -1;
    for (let i = 0; i < idx.length; i++) {
      if (got[i] !== idx[i]) { firstDiff = i; break; }
    }
    console.log(`  ${firstDiff === -1 && got.length === idx.length ? '✅' : '❌'} ${name}: 解码 ${got.length}/${idx.length} px, 首个不一致 @ ${firstDiff}`);
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    console.log(e.stack.split('\n').slice(1, 4).join('\n'));
  }
}
