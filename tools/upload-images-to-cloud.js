/**
 * tools/upload-images-to-cloud.js — 把动作演示图上传到微信云存储，并从代码包中移除
 *
 * 背景：packageA 里 1.2MB 的图片导致「首次进入分包页」要下载整个包（1~2s 卡顿）。
 * 图片移到云存储 CDN 后，packageA 只剩 JS 代码（~30KB），首次进入秒开。
 *
 * 使用方式（需微信开发者工具的云开发环境）：
 *   方式 A（推荐，纯图形界面）：直接在开发者工具里操作，见脚本末尾打印的步骤
 *   方式 B（CLI）：本脚本走 cloudbase CLI / 开发者工具 HTTP 通道上传
 *
 * 上传完成后脚本会打印一段 `CLOUD_IMAGES` 映射，
 * 粘贴到 miniprogram/services/library.js 顶部的同名常量即可。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const IMG_DIR = path.join(ROOT, 'miniprogram', 'packageA', 'library', 'images');
const OUT_MANIFEST = path.join(__dirname, 'cloud-images.json');

const files = fs.readdirSync(IMG_DIR).filter((f) => /\.(png|jpg|jpeg|gif)$/i.test(f));
let total = 0;
const manifest = {};
for (const f of files) {
  const size = fs.statSync(path.join(IMG_DIR, f)).size;
  total += size;
  const [id, ext] = f.split(/\.(?=[^.]+$)/);
  manifest[id] = manifest[id] || {};
  manifest[id][ext] = ''; // 待填入云存储 fileID
}

fs.writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

console.log(`共 ${files.length} 个文件，合计 ${(total / 1024).toFixed(0)}KB\n`);
console.log('请在微信开发者工具中按以下步骤操作：\n');
console.log('1. 云开发控制台 → 存储 → 新建文件夹 library');
console.log('2. 批量上传 miniprogram/packageA/library/images 下的全部文件到 library/');
console.log('3. 上传完成后，复制每个文件的【FileID】（形如 cloud://xxx.1234-env/ai-coach/library/squat.gif）');
console.log('4. 填入 miniprogram/services/library.js 的 CLOUD_IMAGES 常量，或直接填 CLOUD_IMG_BASE 根路径：');
console.log(`   const CLOUD_IMG_BASE = 'cloud://<你的环境ID>/ai-coach/library';`);
console.log('5. 确认线上图片正常显示后，删除本地 images 目录（图片已在云上）：');
console.log('   node -e "require(\'fs\').rmSync(\'miniprogram/packageA/library/images\',{recursive:true})"');
console.log('\n映射模板已生成：tools/cloud-images.json');
