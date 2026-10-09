/**
 * tools/fetch-repdb.js — 下载 RepDB 免费商用动作素材（WebP，512px 扁平插画）
 *
 * 为什么换素材：
 *   原 Gym Visual 动图（hasaneyldrm/exercises-dataset）媒体版权归 Gym Visual，仅授权教学/非商业，
 *   不能上架。RepDB 免费档（601 个动作）**可商用，只需可见署名**，且动作命名规范，
 *   顺带解决了「深蹲/平板/开合跳在数据集中没有同名条目、只能用变体替代」的老问题。
 *
 * 用法：node tools/fetch-repdb.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const CDN = 'https://cdn.jsdelivr.net/npm/@repdb/exercises@latest/';
const OUT = path.join(__dirname, 'repdb', 'webp');

// 本地动作 id → RepDB 动作 id（已逐个核对存在性与 start/peak/main 可用性）
const MAP = {
  pushup: 'push-up',
  knee_pushup: 'knee-push-ups',
  dumbbell_bench_press: 'db-bench-press',
  pullup: 'pull-up',
  dumbbell_row: 'single-arm-db-row',
  squat: 'bodyweight-squat',
  lunge: 'bodyweight-reverse-lunge',
  dumbbell_shoulder_press: 'dumbbell-shoulder-press',
  plank: 'plank',
  dead_bug: 'dead-bug',
  jumping_jack: 'jumping-jacks',
  burpee: 'burpees',
};

/**
 * 带重试的下载。
 * 注意：本项目里 Node 无法 spawn curl（沙箱 EBUSY），只能用内置 https；
 * jsDelivr 偶发 ECONNRESET，所以必须重试。
 */
function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ code: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(new Error('timeout')); });
  });
}

async function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (let i = 0; i < 6; i++) {
    try {
      const { code, body } = await get(url);
      if (code === 200 && body.slice(0, 4).toString() === 'RIFF' && body.slice(8, 12).toString() === 'WEBP') {
        fs.writeFileSync(dest, body);
        return body.length;
      }
    } catch (e) { /* 重试 */ }
    await new Promise((r) => setTimeout(r, 800));
  }
  return 0;
}

const meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'repdb', 'exercises.json'), 'utf8'));
const byId = new Map(meta.exercises.map((x) => [x.id, x]));

fs.mkdirSync(OUT, { recursive: true });
let total = 0;
const manifest = {};

(async () => {
for (const [localId, repId] of Object.entries(MAP)) {
  const ex = byId.get(repId);
  if (!ex) { console.log(`❌ ${localId} → ${repId} 不在数据集中`); continue; }
  const poses = ex.images.flat;            // {start,peak} 或 {main}
  const files = {};
  let bytes = 0;
  for (const [pose, rel] of Object.entries(poses)) {
    const dest = path.join(OUT, `${localId}-${pose}.webp`);
    const size = await download(CDN + rel, dest);
    if (!size) { console.log(`❌ ${localId}-${pose} 下载失败`); continue; }
    files[pose] = dest;
    bytes += size;
  }
  total += bytes;
  manifest[localId] = { repId, poses: Object.keys(files), name_en: ex.name_en };
  console.log(
    `  ✅ ${localId.padEnd(24)} ← ${repId.padEnd(26)} [${Object.keys(files).join('+')}] ${(bytes / 1024).toFixed(0)}KB`
  );
}

fs.writeFileSync(
  path.join(__dirname, 'repdb', 'manifest.json'),
  JSON.stringify(manifest, null, 2)
);
console.log(`\n合计 ${(total / 1024).toFixed(1)} KB，清单已写入 tools/repdb/manifest.json`);
})();
