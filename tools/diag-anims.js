/** 详细诊断：帧矩形/透明/disposal/逐步步长 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'miniprogram', 'packageA', 'library', 'images');
const ids = require('../miniprogram/assets/data/exercises.js').exercises.map((e) => e.id);

// 直接做原始块解析，把 GCE 的透明/disposal 也读出来
function parseBlocks(buf) {
  let p = 6;
  const width = buf.readUInt16LE(0 + 6); // placeholder
  const w = buf.readUInt16LE(6), h = buf.readUInt16LE(8);
  const packed = buf[10];
  p = 13;
  let gct = [];
  if (packed & 0x80) {
    const n = 2 << (packed & 7);
    for (let i = 0; i < n; i++) { gct.push([buf[p], buf[p + 1], buf[p + 2]]); p += 3; }
  }
  const out = [];
  let gce = null;
  while (p < buf.length) {
    const b = buf[p++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = buf[p++];
      if (label === 0xf9) {
        const size = buf[p++];
        const flags = buf[p];
        const delay = buf.readUInt16LE(p + 1);
        const transIdx = buf[p + 3];
        gce = { disposal: (flags >> 2) & 7, transparent: !!(flags & 1), transIdx, delay };
        p += size + 1;
      } else { while (p < buf.length) { const n = buf[p++]; if (n === 0) break; p += n; } }
      continue;
    }
    if (b === 0x2c) {
      const left = buf.readUInt16LE(p), top = buf.readUInt16LE(p + 2);
      const fw = buf.readUInt16LE(p + 4), fh = buf.readUInt16LE(p + 6);
      p += 8;
      const iflags = buf[p++];
      let lct = null;
      if (iflags & 0x80) { const n = 2 << (iflags & 7); lct = n; p += n * 3; }
      if (iflags & 0x40) throw new Error('interlaced');
      p++; // minCodeSize
      while (p < buf.length) { const n = buf[p++]; if (n === 0) break; p += n; }
      out.push({ left, top, w: fw, h: fh, lct, gce });
      gce = null;
      continue;
    }
  }
  return { w, h, gct: gct.length, frames: out };
}

for (const id of ids) {
  const p = path.join(DIR, `${id}.gif`);
  if (!fs.existsSync(p)) continue;
  const buf = fs.readFileSync(p);
  const info = parseBlocks(buf);
  const dlys = info.frames.map((f) => f.gce ? f.gce.delay * 10 : 0);
  const disposals = [...new Set(info.frames.map((f) => f.gce ? f.gce.disposal : -1))];
  const trans = info.frames.filter((f) => f.gce && f.gce.transparent).length;
  const rects = [...new Set(info.frames.map((f) => `${f.left},${f.top} ${f.w}x${f.h}`))];
  const lcts = [...new Set(info.frames.map((f) => f.lct || 0))];
  console.log(`\n## ${id}  ${info.w}x${info.h}  全局色表 ${info.gct} 色  帧 ${info.frames.length}`);
  console.log(`   延迟: ${dlys.join(',')}`);
  console.log(`   disposal: ${disposals.join('/')}   带透明的帧: ${trans}/${info.frames.length}   局部色表: ${lcts.join('/') || '无'}`);
  console.log(`   帧矩形种类(${rects.length}): ${rects.slice(0, 4).join(' | ')}${rects.length > 4 ? ' …' : ''}`);
}
