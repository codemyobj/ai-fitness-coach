/**
 * tools/gen-app-icon.js — 程序化生成小程序头像（144×144，零依赖）
 *
 * 设计：绿色渐变圆角方块底 + 白色哑铃剪影（与 tabBar 图标同风格）
 * 规范：png ≤2M，建议 144×144（官方推荐）
 * 运行：node tools/gen-app-icon.js
 * 产出：docs/appicon-144.png
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 144;
const SS = 4; // 超采样倍数
const OUT = path.join(__dirname, '..', 'docs', 'appicon-144.png');

// ---------- RGBA PNG 编码 ----------
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodeRGBA(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------- SDF ----------
const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;
const sdCapsule = (px, py, ax, ay, bx, by, r) => {
  const abx = bx - ax, aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t)) - r;
};
function sdRoundRect(px, py, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2 - r, hy = (y1 - y0) / 2 - r;
  const qx = Math.abs(px - cx) - hx, qy = Math.abs(py - cy) - hy;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// ---------- 绘制 ----------
// 绿色渐变（左上 #34d399 → 右下 #059669，与 App 内 hero 同色系）
function bg(px, py) {
  const t = (px + py) / (2 * SIZE);
  const lerp = (a, b) => Math.round(a + (b - a) * t);
  return [lerp(0x34, 0x05), lerp(0xd3, 0x96), lerp(0x99, 0x69)];
}

function inside(px, py) {
  // 白色哑铃：横杆 + 左右双杠铃片（斜置 45° 更有力量感？水平更稳重，选水平）
  const bar = sdCapsule(px, py, 46, 72, 98, 72, 5.5) <= 0;                 // 横杆
  const inner = sdCapsule(px, py, 44, 72, 44, 72, 0) <= 0;                  // 占位
  const plateL = sdRoundRect(px, py, 30, 52, 42, 92, 6) <= 0;               // 左片
  const plateR = sdRoundRect(px, py, 102, 52, 114, 92, 6) <= 0;             // 右片
  const plateL2 = sdRoundRect(px, py, 20, 60, 28, 84, 5) <= 0;              // 左外片
  const plateR2 = sdRoundRect(px, py, 116, 60, 124, 84, 5) <= 0;            // 右外片
  // 中心脉冲点（呼应 AI 渐变 logo）
  const pulse = sdCircle(px, py, 72, 72, 7) <= 0;
  return bar || inner || plateL || plateR || plateL2 || plateR2 || pulse;
}

const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // 4×4 超采样
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS;
        const py = y + (sy + 0.5) / SS;
        // 圆角裁切（全出血方形，圆角半径 24，微信头像会自行裁圆，这里保留方圆角）
        const inTile = sdRoundRect(px, py, 2, 2, SIZE - 2, SIZE - 2, 26) <= 0;
        const fg = inTile && inside(px, py);
        const c = fg ? [255, 255, 255] : bg(px, py);
        r += c[0]; g += c[1]; b += c[2]; a += inTile ? 255 : 0;
      }
    }
    const n = SS * SS;
    const i = (y * SIZE + x) * 4;
    rgba[i] = Math.round(r / n);
    rgba[i + 1] = Math.round(g / n);
    rgba[i + 2] = Math.round(b / n);
    rgba[i + 3] = Math.round(a / n);
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, encodeRGBA(SIZE, SIZE, rgba));
console.log('已生成', OUT, fs.statSync(OUT).size + 'B');
