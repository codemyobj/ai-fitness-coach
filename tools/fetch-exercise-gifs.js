/**
 * tools/fetch-exercise-gifs.js — 从开源动作数据集下载现成的动画 GIF + 静态缩略图
 * 数据源：hasaneyldrm/exercises-dataset（1324 个动作，180×180 动画 GIF）
 * 说明：媒体素材 © Gym visual，仓库声明为「教学/非商业研究用途」，商用需自行取得授权。
 *
 * 用法：node tools/fetch-exercise-gifs.js [候选 | 正式]
 */
const fs = require('fs');
const path = require('path');

const CDN = 'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main';
const OUT = path.join(__dirname, 'dataset');

// 我们小程序的 12 个动作 id → 数据集里的动作名（null 表示数据集中无同名条目）
const TARGETS = {
  squat: 'squat to overhead reach',
  pushup: 'push-up',
  knee_pushup: 'kneeling push-up (male)',
  dumbbell_bench_press: 'dumbbell bench press',
  pullup: 'pull-up',
  dumbbell_row: 'dumbbell bent over row',
  lunge: 'forward lunge (male)',
  dumbbell_shoulder_press: 'dumbbell seated shoulder press',
  plank: 'power point plank',
  dead_bug: 'dead bug',
  jumping_jack: 'jack jump (male)',
  burpee: 'burpee'
};

// 覆盖不到的工作中名称 → 备选候选（供人工挑选）
const CANDIDATES = {
  squat: ['jump squat', 'squat to overhead reach', 'split squats', 'potty squat', 'sissy squat'],
  plank: ['power point plank', 'front plank with twist', 'weighted front plank', 'side plank hip adduction'],
  jumping_jack: ['jack jump (male)', 'jack burpee', 'bodyweight drop jump squat']
};

function findEntry(list, name) {
  return list.find((e) => e.name.toLowerCase().trim() === name.toLowerCase().trim());
}

async function download(url, dest) {
  if (fs.existsSync(dest)) return fs.statSync(dest).size;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

(async () => {
  const dirs = ['', 'images'].map((d) => path.join(OUT, d));
  dirs.forEach((d) => fs.mkdirSync(d, { recursive: true }));

  console.log('加载数据集索引...');
  const list = JSON.parse(fs.readFileSync(path.join(__dirname, 'exercises-full.json'), 'utf8'));

  const manifest = [];
  for (const [id, name] of Object.entries(TARGETS)) {
    const e = findEntry(list, name);
    if (!e) { console.log(`⚠️  ${id}：数据集无「${name}」`); continue; }
    const gif = await download(`${CDN}/${e.gif_url}`, path.join(OUT, `${id}.gif`));
    const jpg = await download(`${CDN}/${e.image}`, path.join(OUT, 'images', `${id}.jpg`));
    console.log(`✅ ${id.padEnd(24)} ← ${e.name}  gif ${(gif / 1024).toFixed(0)}KB / jpg ${(jpg / 1024).toFixed(0)}KB`);
    manifest.push({ id, source: e.name, gif: e.gif_url, mediaId: e.media_id });
  }

  console.log('\n候选变体：');
  for (const [id, names] of Object.entries(CANDIDATES)) {
    for (const n of names) {
      const e = findEntry(list, n);
      if (!e) { console.log(`   ⚠️  无「${n}」`); continue; }
      const file = path.join(OUT, `cand-${id}-${n.replace(/[^a-z0-9]+/gi, '-')}.gif`);
      const size = await download(`${CDN}/${e.gif_url}`, file);
      console.log(`   ${id}: ${n} → ${path.basename(file)} (${(size / 1024).toFixed(0)}KB)`);
    }
  }

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const total = fs.readdirSync(OUT).filter((f) => f.endsWith('.gif'))
    .reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
  console.log(`\n合计 ${(total / 1024).toFixed(0)} KB，清单写入 tools/dataset/manifest.json`);
})().catch((e) => { console.error('失败：', e.message); process.exit(1); });
