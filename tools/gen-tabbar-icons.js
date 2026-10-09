/**
 * tools/gen-tabbar-icons.js — 程序化生成 tabBar 图标（零依赖）
 *
 * 产出 6 张 81×81 透明底 PNG：
 *   training / coach / mine × 普通态(#999999) + 选中态(#10b981)
 *
 * 画法：SDF 形状 + 4×4 超采样抗锯齿，风格为统一填充剪影。
 * 运行：node tools/gen-tabbar-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'miniprogram', 'assets', 'icons');
const SIZE = 81;
const SS = 4; // 超采样倍数
const NORMAL = [0x99, 0x99, 0x99];
const ACTIVE = [0x10, 0xb9, 0x81];

// ---------- RGBA PNG 编码（color type 6） ----------
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
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
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
function sdSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}
const sdCapsule = (px, py, ax, ay, bx, by, r) => sdSegment(px, py, ax, ay, bx, by) - r;
function sdRoundRect(px, py, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2 - r, hy = (y1 - y0) / 2 - r;
  const qx = Math.abs(px - cx) - hx, qy = Math.abs(py - cy) - hy;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
// 点是否在三角形内（三条边半平面同侧）
function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const s1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const s2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const s3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

// 三个图标的形状函数：返回该点的覆盖 (true=着色)
const GLYPHS = {
  // 哑铃：横杆 + 左右各两片竖板
  training(px, py) {
    const bar = sdCapsule(px, py, 24, 40.5, 57, 40.5, 3.4) <= 0;
    const plate = (cx, y0, y1, r) => sdCapsule(px, py, cx, y0, cx, y1, r) <= 0;
    return bar
      || plate(15.5, 25, 56, 5.2) || plate(25.5, 31, 50, 4.2)
      || plate(65.5, 25, 56, 5.2) || plate(55.5, 31, 50, 4.2);
  },
  // 对话气泡 + 尾巴 + 三个镂空点（AI 教练）
  coach(px, py) {
    const bubble = sdRoundRect(px, py, 13, 15, 68, 56, 12) <= 0;
    const tail = inTriangle(px, py, 26, 50, 26, 69, 42, 50);
    const dot = sdCircle(px, py, 28, 35.5, 3.6) <= 0
      || sdCircle(px, py, 40.5, 35.5, 3.6) <= 0
      || sdCircle(px, py, 53, 35.5, 3.6) <= 0;
    return (bubble || tail) && !dot;
  },
  // 人像：头 + 肩身
  mine(px, py) {
    const head = sdCircle(px, py, 40.5, 27, 11.5) <= 0;
    const body = sdRoundRect(px, py, 21, 47, 60, 71, 14) <= 0;
    return head || body;
  }
};

// 渲染：4×4 超采样覆盖率 → alpha
function render(glyph, color) {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if (glyph(px, py)) hit++;
        }
      }
      const a = Math.round((hit / (SS * SS)) * 255);
      const i = (y * SIZE + x) * 4;
      rgba[i] = color[0]; rgba[i + 1] = color[1]; rgba[i + 2] = color[2]; rgba[i + 3] = a;
    }
  }
  return rgba;
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, glyph] of Object.entries(GLYPHS)) {
  for (const [suffix, color] of [['', NORMAL], ['-active', ACTIVE]]) {
    const buf = encodeRGBA(SIZE, SIZE, render(glyph, color));
    const file = path.join(OUT, `${name}${suffix}.png`);
    fs.writeFileSync(file, buf);
    console.log(`✅ ${path.relative(process.cwd(), file)}  ${(buf.length / 1024).toFixed(1)}KB`);
  }
}
