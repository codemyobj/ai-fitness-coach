/**
 * tools/diag-render.js — 把「外部真实 GIF」解码后渲染成 PNG，人眼确认解码器真的解对了
 */
const fs = require('fs');
const { decodeGIF, frameToPNG } = require('./lib/gif-decode.js');

const jobs = [
  ['C:/Program Files/WindowsApps/12030rocksdanister.LivelyWallpaper_1.0.164.0_x64__97hta09mmv6hy/Assets/tray-tutorial.gif', [0, 20, 40], 'real-tray-tutorial'],
  ['D:/软件/PotPlayer/Html/loading.gif', [0, 6, 12, 18], 'real-loading'],
  ['C:/Program Files/Microsoft OneDrive/26.168.0830.0006/AutoPlayOptIn.gif', [0, 150, 299], 'real-autoplay'],
];

for (const [file, idxs, name] of jobs) {
  if (!fs.existsSync(file)) { console.log('跳过（不存在）', file); continue; }
  try {
    const g = decodeGIF(fs.readFileSync(file));
    for (const i of idxs) {
      if (i >= g.frames.length) continue;
      const png = frameToPNG(g, i);
      fs.writeFileSync(`${__dirname}/${name}-f${i}.png`, png);
      console.log(`  ✅ ${name}-f${i}.png  ${g.width}x${g.height} 帧 ${i}/${g.frames.length}  delay=${g.frames[i].delay}`);
    }
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}
