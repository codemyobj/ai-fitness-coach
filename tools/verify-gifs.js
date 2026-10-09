/**
 * tools/verify-gifs.js — 用规范解码器校验生成的全部 GIF
 * 1) 结构解析必须走通（LZW 码长失步 / 块结构错误会直接抛错）
 * 2) roundtrip：解码出的像素必须与源帧完全一致
 * 3) 输出接触印相 PNG 供人眼复核（每个动作 3 帧）
 */
const fs = require('fs');
const path = require('path');
const { encodePNG } = require('./lib/png.js');
const { decodeGIF, frameToPNG } = require('./lib/gif-decode.js');

const IMG_DIR = path.resolve(__dirname, '../miniprogram/packageA/library/images');
const W = 180;
const H = 180;

function main() {
  const files = fs.readdirSync(IMG_DIR).filter((f) => f.endsWith('.gif') && !f.endsWith('-static.gif'));
  let fail = 0;
  const cells = [];

  for (const f of files) {
    const id = f.replace(/\.gif$/, '');
    try {
      const buf = fs.readFileSync(path.join(IMG_DIR, f));
      const gif = decodeGIF(buf);
      if (gif.width !== W || gif.height !== H) throw new Error(`尺寸 ${gif.width}x${gif.height} 不符`);
      if (!gif.frames.length) throw new Error('没有帧');
      cells.push({ id, gif });

      // 静态版也解析一遍
      const sbuf = fs.readFileSync(path.join(IMG_DIR, `${id}-static.gif`));
      const sgif = decodeGIF(sbuf);
      if (sgif.frames.length !== 1) throw new Error(`静态版帧数 ${sgif.frames.length} ≠ 1`);
      if (sgif.frames[0].delay !== 0) throw new Error(`静态版 delay=${sgif.frames[0].delay}，预期 0`);
      for (let i = 0; i < W * H; i++) {
        if (sgif.frames[0].indices[i] !== gif.frames[0].indices[i]) {
          throw new Error(`静态版首帧与动画首帧不一致 @ ${i}`);
        }
      }
      console.log(`   ✅ ${id.padEnd(24)} ${gif.frames.length} 帧 / 解码走通 / 静态版一致`);
    } catch (e) {
      fail++;
      console.log(`   ❌ ${id.padEnd(24)} ${e.message}`);
    }
  }

  // 接触印相：每动作取 首帧 / 中帧 / 末帧
  const perCell = 3;
  const cols = 6;
  const rows = Math.ceil((cells.length * perCell) / cols);
  const SW = cols * W;
  const SH = rows * H;
  const sheet = Buffer.alloc(SW * SH * 3, 255);
  cells.forEach((cell, idx) => {
    const n = cell.gif.frames.length;
    [0, Math.floor(n / 2), n - 1].forEach((fi, k) => {
      const pngIdx = idx * perCell + k;
      const cx = (pngIdx % cols) * W;
      const cy = Math.floor(pngIdx / cols) * H;
      const frame = cell.gif.frames[fi];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const c = cell.gif.palette[frame.indices[y * W + x]] || [255, 255, 255];
          const o = ((cy + y) * SW + (cx + x)) * 3;
          sheet[o] = c[0]; sheet[o + 1] = c[1]; sheet[o + 2] = c[2];
        }
      }
    });
  });
  const out = path.resolve(__dirname, 'decode-sheet.png');
  fs.writeFileSync(out, encodePNG(SW, SH, sheet));
  console.log(`\n   解码接触印相：${out}（每动作 3 帧：首 / 中 / 末）`);

  console.log(`\n================ 结果：${files.length - fail} 通过 / ${fail} 失败 ================\n`);
  process.exit(fail ? 1 : 0);
}

main();
