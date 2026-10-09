/**
 * tools/check-cloud-images.js — 校验云存储图片是否齐全
 *
 * 用途：把图片从代码包迁到云存储后，确认云上 23 个文件都在，
 * 再删本地图，避免「本地删了云上缺文件」导致白图。
 *
 * 用法：
 *   1. 填好下面的 ENV / BUCKET / CLOUD_DIR（一般从 CLOUD_IMG_BASE 拆出来）
 *   2. node tools/check-cloud-images.js
 *   3. 若提示缺文件，去云开发控制台补齐再重跑
 *
 * 说明：云存储下载链接由小程序运行时下发，本脚本无法直接访问；
 * 因此这里做的是「本地清单 + 配置一致性」静态核对，实际可用性
 * 请在开发者工具里打开动作库肉眼确认一次。
 */
const fs = require('fs');
const path = require('path');

// ↓↓ 从 miniprogram/services/library.js 的 CLOUD_IMG_BASE 同步过来 ↓↓
const CLOUD_IMG_BASE = 'cloud://cloud1-d9gqfb50v89521c1a.636c-cloud1-d9gqfb50v89521c1a-1499204681';
const CLOUD_DIR = 'library';

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'miniprogram', 'services', 'library.js');
const IMG_DIR = path.join(ROOT, 'miniprogram', 'packageA', 'library', 'images');

let fail = 0;
const bad = (m) => { console.error('❌ ' + m); fail++; };
const ok = (m) => console.log('✅ ' + m);

// 1. 配置一致性
const src = fs.readFileSync(LIB, 'utf8');
const m = src.match(/const CLOUD_IMG_BASE = '([^']*)'/);
if (!m || !m[1]) {
  bad('library.js 的 CLOUD_IMG_BASE 为空 —— 图片仍走本地包路径');
} else if (m[1] !== CLOUD_IMG_BASE) {
  bad(`配置不一致：library.js = ${m[1]}，本脚本 = ${CLOUD_IMG_BASE}`);
} else if (!/^cloud:\/\/[^/]+\.[^/]+/.test(m[1])) {
  bad(`CLOUD_IMG_BASE 格式可疑（应形如 cloud://<env>.<bucket>）：${m[1]}`);
} else {
  ok('CLOUD_IMG_BASE 格式正确');
}

// 2. 生成本地应传清单（按动作数据推导，不依赖目录是否已删）
const dataSrc = fs.readFileSync(path.join(ROOT, 'miniprogram/assets/data/exercises.js'), 'utf8');
const ids = [...dataSrc.matchAll(/\bid\s*:\s*'([a-z0-9_]+)'/g)].map((x) => x[1]);
const STATIC_ANIM = ['burpee']; // 与 library.js 保持同步
const needed = [];
for (const id of ids) {
  needed.push(`${id}.jpg`);
  if (!STATIC_ANIM.includes(id)) needed.push(`${id}.gif`);
}
console.log(`\n需要上传到 ${CLOUD_DIR}/ 的文件（${needed.length} 个）：`);
console.log(needed.join('\n'));

// 3. 若本地目录还在，核对是否齐全（删之前跑一次最稳）
if (fs.existsSync(IMG_DIR)) {
  const local = fs.readdirSync(IMG_DIR);
  const missing = needed.filter((f) => !local.includes(f));
  if (missing.length) bad(`本地目录就缺这些文件，先补全再上传：${missing.join(' ')}`);
  else ok(`本地 ${local.length} 个文件与清单一致，可以整目录上传`);
} else {
  console.log('\n（本地 images 目录已删除，跳过本地核对）');
}

console.log(`\n${fail === 0 ? '✅ 静态核对通过' : `❌ ${fail} 项需处理`}`);
console.log('提醒：最终请在开发者工具里打开「动作库」，确认缩略图与详情动图都能正常显示。');
process.exit(fail ? 1 : 0);
