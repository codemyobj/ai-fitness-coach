/**
 * tools/build-repdb.js — RepDB 免费商用素材 → 小程序动作演示（静态 JPG + 循环动图 GIF）
 *
 * 为什么需要它：
 *   RepDB 免费档给的是 512px WebP 的「起始姿势 / 顶峰姿势」两张静图（等长动作为单张 main），
 *   没有动画。小程序里直接摆静图等于没演示，所以本地把它合成循环动画：
 *     start →(缓动插值 N 步)→ peak →(缓动插值回)→ start，20fps 无缝循环
 *   交叉淡化插值的中间帧 = 两姿势的线性混色，观感就是「人在动」。
 *
 * 依赖：sharp（仅构建期，用于 WebP 解码 / JPEG 缩略图；小程序运行期不需要）
 *   NODE_PATH=<managed node workspace>/node_modules node tools/build-repdb.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { medianCut } = require('./lib/quantize.js');
const { encodeGIFFrames } = require('./lib/gif.js');

const WEBP = path.join(__dirname, 'repdb', 'webp');
const OUT = path.join(__dirname, '..', 'miniprogram', 'packageA', 'library', 'images');

const SIZE = 240;      // 动图分辨率（360rpx 弹层够清晰，体积敏感）
const THUMB = 360;     // 静态缩略图分辨率
const COLORS = 63;     // 主色数（+1 透明槽 = 64 → minCodeSize 6，压缩率最优）
const STEPS = 10;      // 单向插值步数 → 一周期 20 帧
const FPS = 20;
const DELAY = Math.round(100 / FPS); // 50ms

const IDS = require('../miniprogram/assets/data/exercises.js').exercises.map((e) => e.id);

/** 背景色（RepDB 扁平插画的浅蓝底）→ 统一刷成纯白，跟 App 卡片底色一致 */
const BG = [217, 241, 253];

/** WebP → {width,height,pixels(RGB)} */
async function loadPose(file, size) {
  const { data, info } = await sharp(file)
    .resize(size, size, { fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const px = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = data[i * info.channels + 3] / 255; // 素材无 alpha，保险起见做一次合成
    for (let c = 0; c < 3; c++) {
      const v = data[i * info.channels + c];
      px[i * 3 + c] = Math.round(v * a + 255 * (1 - a));
    }
  }
  return { width: info.width, height: info.height, pixels: px };
}

/** 从四边洪泛，把背景刷成纯白（只吃连通区，不会误伤衣服上的浅色块） */
function whiteBackground(img) {
  const { width: w, height: h, pixels } = img;
  const near = (i) => {
    const dr = pixels[i * 3] - BG[0], dg = pixels[i * 3 + 1] - BG[1], db = pixels[i * 3 + 2] - BG[2];
    return Math.abs(dr) < 26 && Math.abs(dg) < 26 && Math.abs(db) < 26;
  };
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop();
    if (p < 0 || p >= w * h || seen[p] || !near(p)) continue;
    seen[p] = 1;
    pixels[p * 3] = 255; pixels[p * 3 + 1] = 255; pixels[p * 3 + 2] = 255;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  return img;
}

const blend = (a, b, t) => {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.round(a[i] * (1 - t) + b[i] * t);
  return out;
};
/** 缓动：让动作在两端稍作停顿，中间快 —— 比线性更像真实发力节奏 */
const ease = (t) => t * t * (3 - 2 * t);

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

/** 帧序列 → 联合量化 → 差分帧 GIF（只写变化区域，未变像素透明占位） */
function encodeSeq(seq, W, H, delay) {
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
  const palette = medianCut(sample.subarray(0, m * 3), COLORS);
  for (let i = 0; i < palette.length; i++) {
    if (palette[i][0] > 238 && palette[i][1] > 238 && palette[i][2] > 238) {
      palette[i] = [255, 255, 255];
      const t = palette[0]; palette[0] = palette[i]; palette[i] = t;
      break;
    }
  }
  const transparentIndex = palette.length;
  const outPalette = palette.slice();
  outPalette[transparentIndex] = [255, 255, 255];

  const map = makeMapper(palette);
  const idxFrames = seq.map((f) => {
    const idx = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) idx[i] = map(f[i * 3], f[i * 3 + 1], f[i * 3 + 2]);
    return idx;
  });

  const frames = [];
  let merged = 0;
  for (let k = 0; k < idxFrames.length; k++) {
    merged += delay || DELAY;
    if (k === 0) {
      frames.push({ indices: idxFrames[0], left: 0, top: 0, w: W, h: H, delay: merged, disposal: 1, transparent: false });
      merged = 0;
      continue;
    }
    const cur = idxFrames[k], prev = idxFrames[k - 1];
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
    if (x1 < 0) continue;
    const fw = x1 - x0 + 1, fh = y1 - y0 + 1;
    const buf = new Uint8Array(fw * fh);
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const gi = (y0 + y) * W + (x0 + x);
        buf[y * fw + x] = cur[gi] === prev[gi] ? transparentIndex : cur[gi];
      }
    }
    frames.push({ indices: buf, left: x0, top: y0, w: fw, h: fh, delay: merged, disposal: 1, transparent: true });
    merged = 0;
  }
  if (merged > 0 && frames.length) frames[frames.length - 1].delay += merged;

  return encodeGIFFrames({ w: W, h: H, palette: outPalette, transparentIndex, loop: true, frames });
}

/** 等长静力动作（平板支撑）：素材只有一张，用「发力高亮脉冲」表达收紧-保持-放松 */
function pulse(img) {
  const out = { width: img.width, height: img.height, pixels: Uint8Array.from(img.pixels) };
  for (let i = 0; i < img.width * img.height; i++) {
    const r = img.pixels[i * 3], g = img.pixels[i * 3 + 1], b = img.pixels[i * 3 + 2];
    const isHighlight = b > 150 && b - r > 60 && g - r > 20; // RepDB 用亮蓝标目标肌群
    if (isHighlight) {
      out.pixels[i * 3] = Math.round(r + (255 - r) * 0.45);
      out.pixels[i * 3 + 1] = Math.round(g + (255 - g) * 0.45);
      out.pixels[i * 3 + 2] = Math.round(b + (255 - b) * 0.45);
    }
  }
  return out;
}

/** 非白包围盒，用于两姿势对齐自检 */
function bbox(img) {
  const { width: w, height: h, pixels } = img;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    if (pixels[i] < 244 || pixels[i + 1] < 244 || pixels[i + 2] < 244) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return [x0, y0, x1, y1];
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let total = 0, gifTotal = 0, jpgTotal = 0;
  const animIds = [];

  for (const id of IDS) {
    const startFile = path.join(WEBP, `${id}-start.webp`);
    const peakFile = path.join(WEBP, `${id}-peak.webp`);
    const mainFile = path.join(WEBP, `${id}-main.webp`);
    const twoPose = fs.existsSync(startFile) && fs.existsSync(peakFile);
    const single = fs.existsSync(mainFile);
    if (!twoPose && !single) { console.log(`⚠️  跳过 ${id}（无素材）`); continue; }

    const first = twoPose ? startFile : mainFile;
    const a = whiteBackground(await loadPose(first, SIZE));

    // ---- 静态缩略图 / 兜底图（JPG）----
    const jpgBuf = await sharp(first)
      .resize(THUMB, THUMB, { fit: 'fill', kernel: 'lanczos3' })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82, mozjpeg: false })
      .toBuffer();
    fs.writeFileSync(path.join(OUT, `${id}.jpg`), jpgBuf);
    jpgTotal += jpgBuf.length;

    let seq = null;
    let note = '';
    if (twoPose) {
      const b = whiteBackground(await loadPose(peakFile, SIZE));
      const boxA = bbox(a), boxB = bbox(b);
      const dx = Math.abs((boxB[0] + boxB[2]) / 2 - (boxA[0] + boxA[2]) / 2) / SIZE * 100;
      const foot = Math.abs(boxB[3] - boxA[3]) / SIZE * 100;
      if (dx > 5 || foot > 15) note = `⚠️横漂${dx.toFixed(1)}%/接地${foot.toFixed(1)}%`;

      seq = [];
      for (let i = 0; i <= STEPS; i++) seq.push(blend(a.pixels, b.pixels, ease(i / STEPS)));
      for (let i = STEPS - 1; i >= 1; i--) seq.push(blend(a.pixels, b.pixels, ease(i / STEPS)));
    } else if (id === 'plank') {
      // 等长动作：主图 + 高亮脉冲，两帧来回
      seq = [a.pixels, pulse(a).pixels];
    }

    if (seq) {
      const frameDelay = id === 'plank' ? 55 : DELAY; // 脉冲帧要慢，50ms 会闪成频闪灯
      const gif = encodeSeq(seq, SIZE, SIZE, frameDelay);
      fs.writeFileSync(path.join(OUT, `${id}.gif`), gif);
      gifTotal += gif.length; total += gif.length;
      animIds.push(id);
      const cycle = (seq.length * frameDelay) / 100;
      console.log(
        `  ✅ ${id.padEnd(24)} ${String(seq.length).padStart(2)}帧 ${String(Math.round(gif.length / 1024)).padStart(3)}KB` +
        ` 周期${cycle.toFixed(1)}s ${FPS}fps ${note}`
      );
    } else {
      // 没有动画素材时必须删掉旧动图，否则会残留上一版（Gym Visual）的 180² GIF
      const stale = path.join(OUT, `${id}.gif`);
      if (fs.existsSync(stale)) fs.unlinkSync(stale);
      console.log(`  ⚪ ${id.padEnd(24)} 仅静态图 ${Math.round(jpgBuf.length / 1024)}KB（素材单姿势，不做动画）`);
    }
    total += jpgBuf.length;
  }

  fs.writeFileSync(
    path.join(__dirname, 'repdb', 'anim-ids.json'),
    JSON.stringify(animIds, null, 2)
  );
  console.log(`\n动图 ${(gifTotal / 1024).toFixed(1)}KB + 静图 ${(jpgTotal / 1024).toFixed(1)}KB = ${(total / 1024).toFixed(1)}KB`);
  console.log(`有动画的动作（${animIds.length}）：${animIds.join(', ')}`);
})().catch((e) => { console.error(e); process.exit(1); });
