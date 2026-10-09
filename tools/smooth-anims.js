/**
 * tools/smooth-anims.js — 把数据集的教学 GIF 转成「丝滑循环动画」
 *
 * 数据集原始素材的问题（已实测）：
 *   · 帧序列本身是匀速连续的（逐步变化不均度 1.0~1.6，循环接缝 = 一个步长），内容没问题
 *   · 但时间轴是「分段定格」：关键姿势被定格 500~1000ms，中间 5 帧 100ms 快放
 *   · 结果实际帧率只有 4~5 fps，观感上「卡一下、窜一段、再卡一下」
 *
 * 本管线做的事：
 *   1. 按 disposal/透明 语义合成出完整画面（差分帧不做合成根本没法比）
 *   2. 时间轴均匀化（丢掉定格），并在相邻帧之间做交叉淡化插值补帧 → 目标帧率
 *   3. 全局调色板量化（帧间共享一张色表，避免闪烁）
 *   4. 差分帧重编码（只写变化区域的最小矩形，未变像素走透明占位）—— 体积的关键
 *
 * 用法：
 *   node tools/smooth-anims.js                     # 全部动作
 *   node tools/smooth-anims.js squat pushup        # 指定动作
 *   node tools/smooth-anims.js --fps=20 --interp=1 --colors=127
 */
const fs = require('fs');
const path = require('path');
const { lzwDecode } = require('./lib/gif-decode.js');
const { composeFrames } = require('./lib/gif-parse.js');
const { medianCut } = require('./lib/quantize.js');
const { encodeGIFFrames } = require('./lib/gif.js');

const SRC = path.join(__dirname, 'dataset');
const OUT = path.join(__dirname, '..', 'miniprogram', 'packageA', 'library', 'images');

// ---------- 参数 ----------
const args = process.argv.slice(2);
const opt = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : def;
};
const TARGET_FPS = opt('fps', 20);   // 目标帧率（素材本身是交叉淡化，插帧数学上精确，20fps 无新增瑕疵）
const INTERP = opt('interp', 1);     // 每对相邻帧之间插入几张过渡帧
const COLORS = opt('colors', 63);    // 主色数（+1 个透明槽；63+1=128 槽 → minCodeSize 7，压缩率最优）
const only = args.filter((a) => !a.startsWith('--'));

if (TARGET_FPS * (INTERP + 1) > 100) throw new Error('帧率过高，GIF 延迟最小单位为 10ms');
// GIF 延迟单位 1/100 秒，且低于 2 会被多数渲染器改判为 10 → 保守取整且下限 4(40ms)
let DELAY = Math.round(100 / TARGET_FPS);
if (DELAY < 4) { DELAY = 4; console.log(`⚠️ 目标帧率过高，延迟钳到 40ms（${DELAY / 100}s → ${(100 / DELAY).toFixed(1)}fps）`); }

const ids = require('../miniprogram/assets/data/exercises.js').exercises.map((e) => e.id)
  .filter((id) => !only.length || only.includes(id));

// ---------- 最近色映射（带缓存） ----------
function makeMapper(palette) {
  const cache = new Map();
  return (r, g, b) => {
    const key = (r >> 2) << 12 | (g >> 2) << 6 | (b >> 2);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let best = 0, bestD = Infinity;
    for (let p = 0; p < palette.length; p++) {
      const dr = r - palette[p][0], dg = g - palette[p][1], db = b - palette[p][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; best = p; if (!d) break; }
    }
    cache.set(key, best);
    return best;
  };
}

// ---------- 交叉淡化插值 ----------
function blend(a, b, t) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.round(a[i] * (1 - t) + b[i] * t);
  return out;
}

let total = 0;
const rows = [];

for (const id of ids) {
  const src = path.join(SRC, `${id}.gif`);
  if (!fs.existsSync(src)) { console.log(`⚠️  跳过 ${id}（缺 tools/dataset/${id}.gif）`); continue; }

  const { width: W, height: H, frames: srcFrames, delays } = composeFrames(fs.readFileSync(src), lzwDecode);

  // ---- 1) 时间轴均匀化 + 插值补帧（插值走 wrap，保持循环接缝连续）----
  const seq = [];
  for (let i = 0; i < srcFrames.length; i++) {
    seq.push(srcFrames[i]);
    for (let t = 1; t <= INTERP; t++) {
      const j = (i + 1) % srcFrames.length;
      seq.push(blend(srcFrames[i], srcFrames[j], t / (INTERP + 1)));
    }
  }

  // ---- 2) 全局调色板：从所有帧里稀疏采样 ----
  const perFrame = Math.max(1, Math.floor(80000 / seq.length));
  const sample = new Uint8Array(perFrame * seq.length * 3);
  let m = 0;
  for (const f of seq) {
    const step = Math.max(1, Math.floor((W * H) / perFrame));
    for (let i = 0; i < W * H && m < perFrame * seq.length; i += step) {
      sample[m * 3] = f[i * 3]; sample[m * 3 + 1] = f[i * 3 + 1]; sample[m * 3 + 2] = f[i * 3 + 2];
      m++;
    }
  }
  let palette = medianCut(sample.subarray(0, m * 3), COLORS);
  // 纯白提到 index 0（背景占大头，且白必须准）
  for (let i = 0; i < palette.length; i++) {
    if (palette[i][0] > 238 && palette[i][1] > 238 && palette[i][2] > 238) {
      palette[i] = [255, 255, 255];
      const t = palette[0]; palette[0] = palette[i]; palette[i] = t;
      break;
    }
  }
  const transparentIndex = palette.length;      // 透明槽 = 下一个空位
  const outPalette = palette.slice();
  outPalette[transparentIndex] = [255, 255, 255];

  // ---- 3) 每帧 → 索引图 ----
  const map = makeMapper(palette);
  const indexFrames = seq.map((f) => {
    const idx = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) idx[i] = map(f[i * 3], f[i * 3 + 1], f[i * 3 + 2]);
    return idx;
  });

  // ---- 4) 差分帧：只写变化区域，未变像素用透明占位 ----
  const outFrames = [];
  let merged = 0; // 累计待分配的停留时间（中间出现完全相同的帧时并入下一输出帧）
  for (let k = 0; k < indexFrames.length; k++) {
    merged += DELAY;
    if (k === 0) {
      outFrames.push({ indices: indexFrames[0], left: 0, top: 0, w: W, h: H, delay: merged, disposal: 1, transparent: false });
      merged = 0;
      continue;
    }
    const cur = indexFrames[k], prev = indexFrames[k - 1];
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        if (cur[row + x] !== prev[row + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) continue; // 与上一帧完全相同：不产生新帧，时间顺延
    const fw = x1 - x0 + 1, fh = y1 - y0 + 1;
    const buf = new Uint8Array(fw * fh);
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const gi = (y0 + y) * W + (x0 + x);
        buf[y * fw + x] = cur[gi] === prev[gi] ? transparentIndex : cur[gi];
      }
    }
    outFrames.push({ indices: buf, left: x0, top: y0, w: fw, h: fh, delay: merged, disposal: 1, transparent: true });
    merged = 0;
  }
  if (merged > 0 && outFrames.length) outFrames[outFrames.length - 1].delay += merged;

  const gif = encodeGIFFrames({
    w: W, h: H, palette: outPalette, transparentIndex, loop: true, frames: outFrames,
  });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${id}.gif`), gif);

  const cycle = (outFrames.reduce((a, f) => a + f.delay, 0)) / 100;
  const realFps = (outFrames.length / cycle).toFixed(1);
  total += gif.length;
  rows.push({ id, src: srcFrames.length, out: outFrames.length, kb: gif.length / 1024, cycle, fps: realFps, palette: palette.length });
  console.log(
    `  ✅ ${id.padEnd(24)} ${String(srcFrames.length).padStart(2)}帧(定格${(delays.reduce((a, b) => a + b, 0) / 1000).toFixed(1)}s)` +
    ` → ${String(outFrames.length).padStart(3)}帧 ${(gif.length / 1024).toFixed(0).padStart(3)}KB` +
    `  周期${cycle.toFixed(2)}s  ${realFps}fps  ${palette.length}色`
  );
}

console.log(`\n合计 ${(total / 1024).toFixed(1)} KB`);
