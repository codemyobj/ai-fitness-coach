/**
 * tools/gen-gifs.js — 生成动作库 GIF 动画（12 个动作，本地绘制，零第三方依赖）
 *
 * 设计要点：
 *  1. 不下载网络素材（版权风险），改为程序化绘制火柴人示意图
 *  2. 3x 超采样 + 覆盖率抗锯齿，输出 8 色索引 GIF（体积小）
 *  3. 骨骼长度归一化：骨段（躯干/大腿/小腿/上臂/前臂）长度由首帧锁定，
 *     后续关键帧只改方向不改长度 → 不会出现肢体被拉伸/压缩
 *  4. 每动作输出 xxx.gif（动画，用于详情弹层）+ xxx-static.gif（首帧静态，用于列表缩略图，
 *     避免 12 个 GIF 同时播放拖慢小程序）
 *
 * 用法：node tools/gen-gifs.js [--sheet]   （--sheet 额外输出校验用接触印相 PNG）
 */
const fs = require('fs');
const path = require('path');
const { encodeGIF } = require('./lib/gif.js');
const { encodePNG } = require('./lib/png.js');

const OUT_DIR = path.resolve(__dirname, '../miniprogram/packageA/library/images');
const W = 180;
const H = 180;
const SS = 3;                 // 超采样倍数
const CW = W * SS;
const CH = H * SS;
const GROUND = 168;
const DELAY = 10;             // 100ms / 帧
const STEPS = 6;              // 每两个关键帧之间的插值帧数

const INK_NEAR = 1;
const INK_FAR = 2;
const INK_ACC = 3;

const PALETTE = [
  [255, 255, 255], // 0 白底
  [55, 65, 81],    // 1 近侧肢体实色 #374151
  [156, 163, 175], // 2 远侧肢体实色 / 近侧浅抗锯齿 #9ca3af
  [209, 213, 219], // 3 远侧抗锯齿 #d1d5db
  [229, 231, 235], // 4 备用浅灰 #e5e7eb
  [16, 185, 129],  // 5 主色（器械/地面）#10b981
  [167, 243, 208], // 6 主色抗锯齿 #a7f3d0
  [107, 114, 128]  // 7 近侧中间抗锯齿 #6b7280
];

// ---------------- 画布 ----------------
const canvas = new Uint8Array(CW * CH);

function clearCanvas() { canvas.fill(0); }

function discRaw(cx, cy, r, ink) {
  const x0 = Math.max(0, Math.floor(cx - r - 1));
  const x1 = Math.min(CW - 1, Math.ceil(cx + r + 1));
  const y0 = Math.max(0, Math.floor(cy - r - 1));
  const y1 = Math.min(CH - 1, Math.ceil(cy + r + 1));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy <= r2) canvas[y * CW + x] = ink;
    }
  }
}

// 端点坐标用输出坐标系（0..W），内部按 SS 放大
function disc(cx, cy, r, ink) { discRaw(cx * SS, cy * SS, r * SS, ink); }

function thickLine(x1, y1, x2, y2, w, ink) {
  const ax = x1 * SS, ay = y1 * SS, bx = x2 * SS, by = y2 * SS;
  const dist = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(dist / 0.8));
  const r = (w / 2) * SS;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    discRaw(ax + (bx - ax) * t, ay + (by - ay) * t, r, ink);
  }
}

// 覆盖率 → 调色板索引（近侧最深，远侧次之，主色绿）
function colorFor(ink, cov) {
  if (ink === INK_NEAR) return cov >= 0.62 ? 1 : (cov >= 0.32 ? 7 : (cov >= 0.12 ? 2 : 0));
  if (ink === INK_ACC) return cov >= 0.62 ? 5 : (cov >= 0.28 ? 6 : 0);
  if (ink === INK_FAR) return cov >= 0.62 ? 2 : (cov >= 0.28 ? 3 : 0);
  return 0;
}

function downsample() {
  const out = new Uint8Array(W * H);
  const total = SS * SS;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c1 = 0, c2 = 0, c3 = 0;
      for (let sy = 0; sy < SS; sy++) {
        const row = (y * SS + sy) * CW;
        for (let sx = 0; sx < SS; sx++) {
          const v = canvas[row + (x * SS + sx)];
          if (v === 1) c1++;
          else if (v === 2) c2++;
          else if (v === 3) c3++;
        }
      }
      let ink = 0, cov = 0;
      if (c1 >= c3 && c1 >= c2 && c1 > 0) { ink = 1; cov = c1 / total; }
      else if (c3 >= c2 && c3 > 0) { ink = 3; cov = c3 / total; }
      else if (c2 > 0) { ink = 2; cov = c2 / total; }
      out[y * W + x] = colorFor(ink, cov);
    }
  }
  return out;
}

// ---------------- 骨骼归一化（保证骨段长度恒定） ----------------
function len(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }
function unit(a, b) {
  const d = len(a, b) || 1;
  return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
}
function extend(a, d, L) { return [a[0] + d[0] * L, a[1] + d[1] * L]; }

function boneLengths(ref) {
  return {
    neck: len(ref.sh, ref.neck),
    head: len(ref.neck, ref.head),
    torso: len(ref.sh, ref.hip),
    thigh: len(ref.hip, ref.k),
    shin: len(ref.k, ref.f),
    upper: len(ref.sh, ref.e),
    fore: len(ref.e, ref.h)
  };
}

// 按首帧锁定骨长，只保留各关键帧的方向意图
function normalizePose(p, L) {
  const sh = p.sh.slice();
  const neck = extend(sh, unit(sh, p.neck), L.neck);
  const head = extend(neck, unit(neck, p.head), L.head);
  const hip = extend(sh, unit(sh, p.hip), L.torso);
  const k = extend(hip, unit(hip, p.k), L.thigh);
  const f = extend(k, unit(k, p.f), L.shin);
  const e = extend(sh, unit(sh, p.e), L.upper);
  const h = extend(e, unit(e, p.h), L.fore);
  const out = { head, neck, sh, hip, e, h, k, f };
  // 显式的对侧肢体（箭步蹲 / 死虫式这类不对称动作）
  if (p.e2) {
    const e2 = extend(sh, unit(sh, p.e2), L.upper);
    out.e2 = e2;
    out.h2 = extend(e2, unit(e2, p.h2 || p.h), L.fore);
  }
  if (p.k2) {
    const k2 = extend(hip, unit(hip, p.k2), L.thigh);
    out.k2 = k2;
    out.f2 = extend(k2, unit(k2, p.f2 || p.f), L.shin);
  }
  return out;
}

// 远侧肢体：镜面对称（正面视图）或固定偏移（侧面视图）
const CX = 90;
const OFF_SIDE = [-10, -7];

function withFarLimb(p, ex) {
  const far = (pt) => (ex.mirror ? [2 * CX - pt[0], pt[1]] : [pt[0] + ex.off[0], pt[1] + ex.off[1]]);
  return Object.assign({}, p, {
    e2: p.e2 || far(p.e),
    h2: p.h2 || far(p.h),
    k2: p.k2 || far(p.k),
    f2: p.f2 || far(p.f)
  });
}

// ---------------- 绘制 ----------------
function drawPose(p, ex) {
  clearCanvas();

  // 地面
  thickLine(16, GROUND, 164, GROUND, 2.5, INK_FAR);

  // 器械（在主色层）
  if (ex.gear === 'bar') thickLine(34, ex.barY || 20, 146, ex.barY || 20, 4, INK_ACC);
  if (ex.gear === 'bench') {
    const by = ex.benchY || 132;
    thickLine(36, by, 142, by, 5, INK_ACC);
    thickLine(46, by, 46, GROUND, 4, INK_ACC);
    thickLine(132, by, 132, GROUND, 4, INK_ACC);
  }

  // 远侧肢体（先画，压在躯干下面）
  thickLine(p.sh[0], p.sh[1], p.e2[0], p.e2[1], 6, INK_FAR);
  thickLine(p.e2[0], p.e2[1], p.h2[0], p.h2[1], 6, INK_FAR);
  thickLine(p.hip[0], p.hip[1], p.k2[0], p.k2[1], 7, INK_FAR);
  thickLine(p.k2[0], p.k2[1], p.f2[0], p.f2[1], 7, INK_FAR);

  // 躯干 + 头
  thickLine(p.neck[0], p.neck[1], p.hip[0], p.hip[1], 11, INK_NEAR);
  thickLine(p.sh[0], p.sh[1], p.neck[0], p.neck[1], 9, INK_NEAR);
  disc(p.head[0], p.head[1], 11, INK_NEAR);

  // 近侧肢体
  thickLine(p.hip[0], p.hip[1], p.k[0], p.k[1], 8, INK_NEAR);
  thickLine(p.k[0], p.k[1], p.f[0], p.f[1], 8, INK_NEAR);
  thickLine(p.sh[0], p.sh[1], p.e[0], p.e[1], 7, INK_NEAR);
  thickLine(p.e[0], p.e[1], p.h[0], p.h[1], 7, INK_NEAR);

  // 哑铃（画在手的位置；单臂动作只画近侧手）
  if (ex.gear === 'dumbbell') {
    disc(p.h[0], p.h[1], 7, INK_ACC);
    if (ex.dumbbellFar !== false) disc(p.h2[0], p.h2[1], 6, INK_ACC);
  }
  if (ex.gear === 'barbell') {
    thickLine(p.h[0] - 16, p.h[1], p.h[0] + 16, p.h[1], 5, INK_ACC);
  }

  return downsample();
}

// ---------------- 动作关键帧 ----------------
// 坐标约定：180x180，地面 y=168。side=侧视图（远侧肢体偏移），mirror=正面视图（左右对称）
const EXERCISES = [
  {
    id: 'pushup', name: '标准俯卧撑', gear: 'none', off: OFF_SIDE, ground: ['h', 'f'],
    keys: [
      { head: [54, 70], neck: [64, 80], sh: [76, 86], hip: [117, 130], e: [82, 124], h: [86, 168], k: [134, 149], f: [152, 168] },
      { head: [30, 104], neck: [42, 110], sh: [56, 116], hip: [110, 144], e: [46, 142], h: [86, 168], k: [131, 157], f: [152, 168] }
    ]
  },
  {
    id: 'knee_pushup', name: '跪姿俯卧撑', gear: 'none', off: OFF_SIDE, ground: ['h', 'k', 'k2'],
    keys: [
      { head: [56, 62], neck: [67, 75], sh: [78, 88], hip: [116, 133], e: [84, 126], h: [88, 168], k: [142, 164], f: [168, 158] },
      { head: [48, 92], neck: [59, 102], sh: [70, 112], hip: [108, 140], e: [56, 142], h: [88, 168], k: [142, 164], f: [168, 158] }
    ]
  },
  {
    id: 'dumbbell_bench_press', name: '哑铃卧推', gear: 'bench', off: OFF_SIDE, benchY: 132, ground: ['f'], dumbbellFar: false,
    keys: [
      { head: [46, 116], neck: [56, 120], sh: [66, 124], hip: [120, 126], e: [68, 100], h: [68, 74], k: [140, 142], f: [154, 168] },
      { head: [46, 116], neck: [56, 120], sh: [66, 124], hip: [120, 126], e: [76, 112], h: [90, 116], k: [140, 142], f: [154, 168] }
    ]
  },
  {
    id: 'pullup', name: '引体向上', gear: 'bar', mirror: true, barY: 20,
    keys: [
      { head: [90, 78], neck: [90, 92], sh: [90, 100], hip: [90, 140], e: [80, 64], h: [76, 24], k: [88, 160], f: [86, 178] },
      { head: [90, 46], neck: [90, 60], sh: [90, 68], hip: [90, 110], e: [76, 48], h: [76, 24], k: [88, 132], f: [86, 152] }
    ]
  },
  {
    id: 'dumbbell_row', name: '哑铃单臂划船', gear: 'dumbbell', off: OFF_SIDE, ground: ['f'], dumbbellFar: false,
    keys: [
      { head: [64, 78], neck: [74, 86], sh: [84, 92], hip: [118, 108], e: [86, 122], h: [84, 152], k: [124, 142], f: [122, 168] },
      { head: [64, 78], neck: [74, 86], sh: [84, 92], hip: [118, 108], e: [98, 110], h: [108, 96], k: [124, 142], f: [122, 168] }
    ]
  },
  {
    id: 'squat', name: '徒手深蹲', gear: 'none', mirror: true, ground: ['f', 'f2'],
    keys: [
      { head: [90, 34], neck: [90, 48], sh: [90, 56], hip: [90, 100], e: [78, 74], h: [62, 82], k: [82, 134], f: [80, 168] },
      { head: [90, 60], neck: [90, 74], sh: [90, 82], hip: [90, 120], e: [78, 102], h: [62, 110], k: [76, 146], f: [78, 168] }
    ]
  },
  {
    id: 'lunge', name: '箭步蹲', gear: 'none', off: OFF_SIDE, ground: ['f', 'f2'],
    keys: [
      {
        head: [88, 50], neck: [90, 64], sh: [92, 72], hip: [96, 108], e: [98, 94], h: [96, 116],
        k: [112, 140], f: [118, 168], k2: [76, 140], f2: [58, 168]
      },
      {
        head: [88, 78], neck: [90, 90], sh: [92, 96], hip: [96, 128], e: [98, 116], h: [96, 136],
        k: [114, 150], f: [118, 168], k2: [72, 158], f2: [58, 168]
      }
    ]
  },
  {
    id: 'dumbbell_shoulder_press', name: '哑铃肩推', gear: 'dumbbell', mirror: true, ground: ['f', 'f2'],
    keys: [
      { head: [90, 34], neck: [90, 48], sh: [90, 56], hip: [90, 100], e: [76, 70], h: [70, 58], k: [88, 134], f: [88, 168] },
      { head: [90, 34], neck: [90, 48], sh: [90, 56], hip: [90, 100], e: [80, 42], h: [86, 18], k: [88, 134], f: [88, 168] }
    ]
  },
  {
    id: 'plank', name: '平板支撑', gear: 'none', off: OFF_SIDE, ground: ['h', 'f'],
    keys: [
      { head: [50, 96], neck: [60, 102], sh: [72, 108], hip: [116, 120], e: [70, 142], h: [56, 168], k: [134, 146], f: [152, 168] },
      { head: [50, 101], neck: [60, 107], sh: [72, 113], hip: [116, 125], e: [70, 145], h: [56, 168], k: [134, 148], f: [152, 168] }
    ]
  },
  {
    id: 'dead_bug', name: '死虫式', gear: 'none', off: OFF_SIDE,
    keys: [
      {
        head: [40, 150], neck: [54, 154], sh: [62, 158], hip: [116, 158], e: [60, 128], h: [58, 100],
        k: [116, 118], f: [144, 118], e2: [68, 128], h2: [70, 100], k2: [118, 118], f2: [146, 118]
      },
      {
        head: [40, 150], neck: [54, 154], sh: [62, 158], hip: [116, 158], e: [46, 162], h: [26, 164],
        k: [134, 158], f: [168, 162], e2: [68, 128], h2: [70, 100], k2: [118, 118], f2: [146, 118]
      }
    ]
  },
  {
    id: 'jumping_jack', name: '开合跳', gear: 'none', mirror: true, ground: ['f', 'f2'],
    keys: [
      { head: [90, 34], neck: [90, 48], sh: [90, 56], hip: [90, 100], e: [84, 82], h: [84, 112], k: [86, 134], f: [86, 168] },
      { head: [90, 30], neck: [90, 44], sh: [90, 52], hip: [90, 98], e: [74, 50], h: [62, 22], k: [76, 134], f: [64, 168] }
    ]
  },
  {
    id: 'burpee', name: '波比跳', gear: 'none', off: OFF_SIDE,
    keys: [
      { head: [84, 42], neck: [84, 56], sh: [84, 64], hip: [86, 108], e: [88, 92], h: [86, 118], k: [86, 140], f: [84, 168], ground: ['f'] },
      { head: [96, 74], neck: [104, 88], sh: [112, 100], hip: [118, 116], e: [130, 142], h: [140, 168], k: [104, 150], f: [92, 168], ground: ['h', 'f'] },
      { head: [162, 116], neck: [154, 120], sh: [150, 124], hip: [112, 136], e: [154, 150], h: [152, 168], k: [92, 156], f: [74, 168], ground: ['h', 'f'] },
      { head: [96, 74], neck: [104, 88], sh: [112, 100], hip: [118, 116], e: [130, 142], h: [140, 168], k: [104, 150], f: [92, 168], ground: ['h', 'f'] },
      { head: [84, 42], neck: [84, 56], sh: [84, 64], hip: [86, 108], e: [88, 92], h: [86, 118], k: [86, 140], f: [84, 168], ground: ['f'] },
      { head: [84, 42], neck: [84, 56], sh: [84, 64], hip: [86, 108], e: [84, 46], h: [82, 20], k: [86, 140], f: [84, 160], ground: [] }
    ]
  }
];

// ---------------- 帧生成 ----------------
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpPt(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]; }
function smooth(t) { return t * t * (3 - 2 * t); }

function lerpPose(a, b, t) {
  const out = {};
  for (const key of ['head', 'neck', 'sh', 'hip', 'e', 'h', 'k', 'f', 'e2', 'h2', 'k2', 'f2']) {
    if (a[key] && b[key]) out[key] = lerpPt(a[key], b[key], t);
  }
  return out;
}

function buildKeys(ex) {
  const prepared = ex.keys.map((k) => withFarLimb(k, ex));
  const L = boneLengths(prepared[0]);
  const norm = prepared.map((p) => normalizePose(p, L));
  // 支撑点钉在地上（手/脚不该陷进地里或飘起来）
  norm.forEach((p, i) => {
    const gp = (ex.keys[i] && ex.keys[i].ground) || ex.ground || [];
    for (const name of gp) {
      if (p[name]) p[name] = [p[name][0], GROUND];
    }
  });
  return norm;
}

function buildFrames(ex) {
  const keys = buildKeys(ex);
  // 两个关键帧 → 往复一次形成循环；多个关键帧 → 顺序播放后回到起点
  const seq = keys.length === 2 ? [keys[0], keys[1], keys[0]] : keys.concat([keys[0]]);
  const frames = [];
  for (let s = 0; s < seq.length - 1; s++) {
    const a = seq[s];
    const b = seq[s + 1];
    for (let i = 0; i < STEPS; i++) {
      frames.push(lerpPose(a, b, smooth(i / STEPS)));
    }
  }
  frames.push(seq[seq.length - 1]);
  return frames.map((p) => drawPose(p, ex));
}

// ---------------- 输出 ----------------
function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const wantSheet = process.argv.includes('--sheet');
  let total = 0;
  const sheet = [];

  for (const ex of EXERCISES) {
    const frames = buildFrames(ex);
    const gif = encodeGIF({ frames, w: W, h: H, palette: PALETTE, delay: DELAY, loop: true });
    const gifPath = path.join(OUT_DIR, `${ex.id}.gif`);
    fs.writeFileSync(gifPath, gif);

    const still = encodeGIF({ frames: [frames[0]], w: W, h: H, palette: PALETTE, delay: 0, loop: false });
    const stillPath = path.join(OUT_DIR, `${ex.id}-static.gif`);
    fs.writeFileSync(stillPath, still);

    total += gif.length + still.length;
    console.log(`   ${ex.id.padEnd(24)} ${String(frames.length).padStart(2)} 帧  ${(gif.length / 1024).toFixed(1)} KB + 静态 ${(still.length / 1024).toFixed(1)} KB`);

    if (wantSheet) {
      sheet.push({ name: ex.id, a: frames[0], b: frames[Math.floor(frames.length / 2)] });
    }
  }

  console.log(`\n   合计 ${(total / 1024).toFixed(1)} KB → ${OUT_DIR}`);

  if (wantSheet && sheet.length) {
    const cols = 6;
    const rows = Math.ceil((sheet.length * 2) / cols);
    const SW = cols * W;
    const SH = rows * H;
    const rgb = Buffer.alloc(SW * SH * 3, 255);
    sheet.forEach((item, idx) => {
      [item.a, item.b].forEach((frame, k) => {
        const cell = idx * 2 + k;
        const cx = (cell % cols) * W;
        const cy = Math.floor(cell / cols) * H;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const v = frame[y * W + x];
            const c = PALETTE[v] || [255, 255, 255];
            const o = ((cy + y) * SW + (cx + x)) * 3;
            rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
          }
        }
      });
    });
    const png = encodePNG(SW, SH, rgb);
    const p = path.resolve(__dirname, 'preview-sheet.png');
    fs.writeFileSync(p, png);
    console.log(`   接触印相：${p}（${SW}x${SH}）`);
  }
}

main();
