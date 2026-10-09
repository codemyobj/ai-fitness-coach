/**
 * verify.js — 小程序项目静态体检脚本（离线运行，不依赖微信开发者工具）
 * 检查维度：
 *   1. JS 语法（node --check 等价：new vm.Script）
 *   2. JSON 合法性
 *   3. 页面四件套完整性（js/json/wxml/wxss）
 *   4. app.json 页面/分包路径与磁盘文件是否对应
 *   5. WXML 中 bindtap/catchtap 等事件绑定的方法是否在 JS 中定义
 *   6. WXML 中引用的 data 顶格字段是否在 data 中声明
 *   7. require 路径是否可解析
 *   8. usingComponents 声明的组件是否存在
 *   9. WXSS 中 var(--x) 变量是否在 variables.wxss 定义
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, 'miniprogram');
const errors = [];
const warns = [];
const ok = [];

function rel(p) { return path.relative(process.cwd(), p).replace(/\\/g, '/'); }
function err(msg) { errors.push(msg); }
function warn(msg) { warns.push(msg); }

// ---------- 1. 收集所有文件 ----------
function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const allFiles = walk(ROOT);

// ---------- 2. JS 语法 ----------
const jsFiles = allFiles.filter((f) => f.endsWith('.js'));
for (const f of jsFiles) {
  try {
    new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f });
  } catch (e) {
    err(`[语法] ${rel(f)} → ${e.message}`);
  }
}
ok.push(`JS 语法检查：${jsFiles.length} 个文件`);

// ---------- 3. JSON 合法性 ----------
const jsonFiles = allFiles.filter((f) => f.endsWith('.json'));
for (const f of jsonFiles) {
  try {
    JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    err(`[JSON] ${rel(f)} → ${e.message}`);
  }
}
ok.push(`JSON 合法性：${jsonFiles.length} 个文件`);

// ---------- 4. app.json 页面路径与四件套 ----------
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));

const declaredPages = [];
(appJson.pages || []).forEach((p) => declaredPages.push({ route: p, root: 'miniprogram' }));
(appJson.subpackages || appJson.subPackages || []).forEach((sp) => {
  (sp.pages || []).forEach((p) => declaredPages.push({ route: `${sp.root}/${p}`, root: 'miniprogram' }));
});

for (const { route } of declaredPages) {
  const base = path.join(ROOT, route);
  for (const ext of ['js', 'json', 'wxml', 'wxss']) {
    if (!fs.existsSync(`${base}.${ext}`)) {
      warn(`[四件套] 缺少 ${route}.${ext}（wxss 可省略，其余必需）`);
    }
  }
  // 页面 json 不能被声明为组件
  const pj = `${base}.json`;
  if (fs.existsSync(pj)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(pj, 'utf8'));
      if (cfg.component === true) err(`[配置] 页面 ${route} 的 json 误标 component:true`);
    } catch (_) {}
  }
}
ok.push(`页面路径检查：${declaredPages.length} 个页面（主包 ${(appJson.pages || []).length} + 分包 ${declaredPages.length - (appJson.pages || []).length}）`);

// tabBar 页必须在 pages 中
if (appJson.tabBar && appJson.tabBar.list) {
  for (const item of appJson.tabBar.list) {
    if (!(appJson.pages || []).includes(item.pagePath)) {
      err(`[tabBar] ${item.pagePath} 未在 app.json pages 中声明`);
    }
    // 有 iconPath 就必须成对存在
    if (item.iconPath && !fs.existsSync(path.join(ROOT, item.iconPath))) {
      err(`[tabBar] 图标缺失 ${item.iconPath}`);
    }
  }
  // 未配图标时提醒（正式版可接受，但需知晓）
  const noIcon = appJson.tabBar.list.filter((i) => !i.iconPath).length;
  if (noIcon > 0) warn(`[tabBar] ${noIcon} 个 tab 未配置图标，正式发布建议补齐（开发预览可用文字）`);
}

// preloadRule 里的包名必须存在
if (appJson.preloadRule) {
  const pkgNames = (appJson.subpackages || []).map((s) => s.name).filter(Boolean);
  for (const [page, rule] of Object.entries(appJson.preloadRule)) {
    if (!declaredPages.some((p) => p.route === page)) {
      err(`[preloadRule] 页面 ${page} 不存在`);
    }
    (rule.packages || []).forEach((p) => {
      if (!pkgNames.includes(p)) err(`[preloadRule] 分包 ${p} 未定义`);
    });
  }
}

// ---------- 5. require 路径解析 ----------
for (const f of jsFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const target = path.resolve(path.dirname(f), m[1]);
    const cand = [target, `${target}.js`, path.join(target, 'index.js')];
    if (!cand.some((c) => fs.existsSync(c))) {
      err(`[require] ${rel(f)} 引用不存在的模块 ${m[1]}`);
    }
  }
}
ok.push('require 路径解析');

// ---------- 5c. 禁止 require JSON 文件 ----------
// 微信小程序不支持 require('xxx.json')：解析器只认 .js，会去找 xxx.json.js，
// 报 "module 'xxx.json.js' is not defined" 并在模块加载阶段炸掉 → 整页白屏
let jsonRequires = 0;
for (const f of jsFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /require\(\s*['"](\.[^'"]*\.json)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    jsonRequires++;
    err(`[require] ${rel(f)} require 了 JSON 文件 ${m[1]}：小程序不支持 require JSON，请改用 .js 模块导出（module.exports）`);
  }
}
ok.push(`require JSON 检查（${jsonRequires} 处，必须为 0）`);

// ---------- 5b. 解构导入的导出名校验 ----------
// 抓「从 A 模块解构 B 模块的导出」这类运行时才爆的 bug（如 getTodayWorkoutLog 从 plan.js 解构）
function extractExports(src) {
  const names = new Set();
  let dynamic = false;
  // 1) module.exports = { ... }（括号配平取顶层键）
  const meIdx = src.search(/module\.exports\s*=\s*\{/);
  if (meIdx >= 0) {
    const braceStart = src.indexOf('{', meIdx);
    let depth = 0;
    let end = -1;
    for (let i = braceStart; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end > braceStart) {
      const body = src.slice(braceStart + 1, end);
      let d = 0;
      let segStart = 0;
      const segs = [];
      for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch === '{' || ch === '[' || ch === '(') d++;
        else if (ch === '}' || ch === ']' || ch === ')') d--;
        else if (ch === ',' && d === 0) { segs.push(body.slice(segStart, i)); segStart = i + 1; }
      }
      segs.push(body.slice(segStart));
      for (const seg of segs) {
        const s = seg.trim();
        if (!s) continue;
        if (s.startsWith('...') || s.startsWith('[') || s.startsWith('"') || s.startsWith("'")) { dynamic = true; continue; }
        const km = s.match(/^([a-zA-Z_$][\w$]*)\s*:/);
        if (km) names.add(km[1]);
        else if (/^[a-zA-Z_$][\w$]*$/.test(s)) names.add(s); // 简写 { a, b }
        else dynamic = true;
      }
    }
  } else if (/module\.exports\s*=\s*(?!function|\{)/.test(src)) {
    dynamic = true; // module.exports = 某变量 / 函数表达式等，静态不可判定
  }
  // 2) module.exports.xxx = / exports.xxx =
  const addRe = /(?:module\.exports|exports)\.([a-zA-Z_$][\w$]*)\s*=/g;
  let am;
  while ((am = addRe.exec(src))) names.add(am[1]);
  return { names, dynamic };
}

let importChecks = 0;
for (const f of jsFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const target = path.resolve(path.dirname(f), m[2]); // m[1]=解构变量名，m[2]=模块路径
    const cand = [target, `${target}.js`, path.join(target, 'index.js')].find((c) => fs.existsSync(c));
    if (!cand) continue; // 路径错误已由 5 报过
    const { names, dynamic } = extractExports(fs.readFileSync(cand, 'utf8'));
    if (dynamic) continue; // 导出形式静态不可判定，不强查
    for (const raw of m[1].split(',')) {
      const nm = raw.split(':')[0].split('=')[0].trim();
      if (!nm) continue;
      importChecks++;
      if (!names.has(nm)) {
        err(`[导出] ${rel(f)} 从 ${m[2]} 解构 ${nm}，但该模块未导出此名称（导出：${[...names].join(', ') || '无'}）`);
      }
    }
  }
}
ok.push(`解构导入导出名匹配（${importChecks} 处）`);

// ---------- 6. 组件声明存在性 ----------
for (const f of jsonFiles) {
  if (!f.endsWith('.json')) continue;
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { continue; }
  if (!cfg.usingComponents) continue;
  for (const [name, cpath] of Object.entries(cfg.usingComponents)) {
    const base = cpath.startsWith('/')
      ? path.join(ROOT, cpath)
      : path.resolve(path.dirname(f), cpath);
    for (const ext of ['js', 'json', 'wxml']) {
      if (!fs.existsSync(`${base}.${ext}`)) {
        err(`[组件] ${rel(f)} 声明的 ${name}(${cpath}) 缺少 .${ext}`);
      }
    }
  }
}
ok.push('自定义组件声明');

// ---------- 7. WXML 事件绑定 ↔ JS 方法 ----------
for (const { route } of declaredPages) {
  const wxml = path.join(ROOT, `${route}.wxml`);
  const js = path.join(ROOT, `${route}.js`);
  if (!fs.existsSync(wxml) || !fs.existsSync(js)) continue;
  const wxmlSrc = fs.readFileSync(wxml, 'utf8');
  const jsSrc = fs.readFileSync(js, 'utf8');

  const evtRe = /\b(?:bind|catch)(?::)?([a-zA-Z]+)\s*=\s*["']([a-zA-Z_$][\w$]*)["']/g;
  let m;
  const handlers = new Set();
  while ((m = evtRe.exec(wxmlSrc))) handlers.add(m[2]);
  for (const h of handlers) {
    const defined = new RegExp(`\\b${h}\\s*[:(]`).test(jsSrc);
    if (!defined) err(`[事件] ${route}.wxml 绑定 ${h} 但 ${route}.js 未定义`);
  }
}

// 组件 wxml 事件
const compWxml = path.join(ROOT, 'components/set-input/set-input.wxml');
const compJs = path.join(ROOT, 'components/set-input/set-input.js');
if (fs.existsSync(compWxml) && fs.existsSync(compJs)) {
  const w = fs.readFileSync(compWxml, 'utf8');
  const j = fs.readFileSync(compJs, 'utf8');
  const re = /\b(?:bind|catch)(?::)?([a-zA-Z]+)\s*=\s*["']([a-zA-Z_$][\w$]*)["']/g;
  let m;
  while ((m = re.exec(w))) {
    if (!new RegExp(`\\b${m[2]}\\s*[:(]`).test(j)) {
      err(`[事件] set-input.wxml 绑定 ${m[2]} 但 set-input.js 未定义`);
    }
  }
}
ok.push('WXML 事件绑定 ↔ JS 方法');

// ---------- 8. WXML 顶层 data 字段声明 ----------
// 只检查形如 {{field}} / {{field.xxx}} 的顶格标识符
const IGNORE = new Set(['true', 'false', 'null', 'undefined', 'item', 'index', 'day', 'ex', 's', 'wx', 'index + 1']);
for (const { route } of declaredPages) {
  const wxml = path.join(ROOT, `${route}.wxml`);
  const js = path.join(ROOT, `${route}.js`);
  if (!fs.existsSync(wxml) || !fs.existsSync(js)) continue;
  const wxmlSrc = fs.readFileSync(wxml, 'utf8');
  const jsSrc = fs.readFileSync(js, 'utf8');
  // 提取 JS data 段（括号配平，避免嵌套对象导致截断）
  const dataStart = jsSrc.search(/\bdata\s*:\s*\{/);
  const dataKeys = new Set();
  if (dataStart >= 0) {
    const braceStart = jsSrc.indexOf('{', dataStart);
    let depth = 0;
    let end = -1;
    for (let i = braceStart; i < jsSrc.length; i++) {
      const ch = jsSrc[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end > braceStart) {
      // 只取 data 的顶层键：深度为 1 时的 `key:`
      const body = jsSrc.slice(braceStart + 1, end);
      let d = 0;
      for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch === '{' || ch === '[') d++;
        else if (ch === '}' || ch === ']') d--;
        else if (ch === ':' && d === 0) {
          const before = body.slice(0, i);
          const km = before.match(/([a-zA-Z_$][\w$]*)\s*$/);
          if (km) dataKeys.add(km[1]);
        }
      }
    }
  }
  // 提取 {{ }} 中的顶格标识符
  const mustacheRe = /\{\{([^}]+)\}\}/g;
  let mm;
  while ((mm = mustacheRe.exec(wxmlSrc))) {
    let expr = mm[1];
    // 剔除字符串字面量（避免把 'disabled' / "active" 这类 class 名当成变量）
    expr = expr.replace(/'[^']*'/g, ' ').replace(/"[^"]*"/g, ' ');
    const idRe = /(?:^|[^.\w$])([a-zA-Z_$][\w$]*)/g;
    let im;
    while ((im = idRe.exec(expr))) {
      const id = im[1];
      if (IGNORE.has(id) || dataKeys.has(id)) continue;
      // wx:for 内声明的别名
      if (new RegExp(`wx:for-item\\s*=\\s*["']${id}["']`).test(wxmlSrc)) continue;
      warn(`[data] ${route}.wxml 使用 {{${id}}} 但 data 中未声明（${expr.trim().slice(0, 40)}）`);
    }
  }
}
ok.push('WXML 数据字段声明');

// ---------- 8b. WXML 深层取值空安全（x[a].y 形式，数据缺失会白屏）----------
for (const { route } of declaredPages) {
  const wxml = path.join(ROOT, `${route}.wxml`);
  if (!fs.existsSync(wxml)) continue;
  const src = fs.readFileSync(wxml, 'utf8');
  const deepRe = /\{\{[^}]*?[a-zA-Z_$][\w$]*\[[^\]]+\]\.[a-zA-Z_$]/g;
  let m;
  while ((m = deepRe.exec(src))) {
    warn(`[空安全] ${route}.wxml 存在深层取值 ${m[0].slice(2, 60)}…，数据缺失时可能白屏`);
  }
}
ok.push('WXML 深层取值空安全扫描');

// ---------- 8c. data 段以外定义的方法被 WXML 调用（组件方法需在 methods 内）----------
for (const f of jsonFiles) {
  if (!f.endsWith('.json')) continue;
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { continue; }
  if (cfg.component !== true) continue;
  const js = f.replace(/\.json$/, '.js');
  const wxml = f.replace(/\.json$/, '.wxml');
  if (!fs.existsSync(js) || !fs.existsSync(wxml)) continue;
  const jsSrc = fs.readFileSync(js, 'utf8');
  const wxmlSrc = fs.readFileSync(wxml, 'utf8');
  const methodsMatch = jsSrc.match(/methods\s*:\s*\{([\s\S]*)\n\s*\}\s*\n\s*\}\);?\s*$/);
  const inMethods = methodsMatch ? methodsMatch[1] : '';
  const re = /\b(?:bind|catch)(?::)?[a-zA-Z]+\s*=\s*["']([a-zA-Z_$][\w$]*)["']/g;
  let m;
  while ((m = re.exec(wxmlSrc))) {
    if (!new RegExp(`\\b${m[1]}\\s*\\(`).test(inMethods)) {
      err(`[组件] ${rel(wxml)} 绑定 ${m[1]}，但组件 js 的 methods 中未定义（自定义组件事件必须写在 methods 内）`);
    }
  }
}
ok.push('组件事件方法归属 methods');

// ---------- 9. WXSS 变量定义 ----------
const varDefs = new Set();
const varFile = path.join(ROOT, 'styles/variables.wxss');
if (fs.existsSync(varFile)) {
  const vs = fs.readFileSync(varFile, 'utf8');
  const vRe = /(--[\w-]+)\s*:/g;
  let vm2;
  while ((vm2 = vRe.exec(vs))) varDefs.add(vm2[1]);
}
const wxssFiles = allFiles.filter((f) => f.endsWith('.wxss'));
const usedVars = new Set();
for (const f of wxssFiles) {
  const s = fs.readFileSync(f, 'utf8');
  const re = /var\((--[\w-]+)/g;
  let m;
  while ((m = re.exec(s))) usedVars.add(m[1]);
}
for (const v of usedVars) {
  if (!varDefs.has(v)) err(`[样式] 使用了未定义的 CSS 变量 ${v}`);
}
ok.push(`WXSS 变量检查：定义 ${varDefs.size} 个，使用 ${usedVars.size} 个`);

// ---------- 10. 图片引用存在性 ----------
// 静态资源引用 404 在真机上是白块，编译期不报错，必须离线兜住
const IMG_RE = /\.(png|jpe?g|gif|webp|svg)$/i;
const imgRefs = []; // { file, raw }
for (const f of allFiles) {
  if (!/\.(wxml|js)$/.test(f)) continue;
  const src = fs.readFileSync(f, 'utf8');
  const re = /(?:src\s*=\s*["']([^"']+)["'])|(?:["'](\/[^"':]*?\.(?:png|jpe?g|gif|webp|svg))["'])/gi;
  let m;
  while ((m = re.exec(src))) {
    const raw = m[1] || m[2];
    if (!raw || !IMG_RE.test(raw.split('?')[0])) continue;
    imgRefs.push({ file: f, raw });
  }
}
for (const { file, raw } of imgRefs) {
  const target = raw.startsWith('/')
    ? path.join(ROOT, raw)
    : path.resolve(path.dirname(file), raw.split('?')[0]);
  if (!fs.existsSync(target)) {
    err(`[图片] ${rel(file)} 引用的 ${raw} 不存在（应为 ${rel(target)}）`);
  }
}
ok.push(`图片引用存在性（${imgRefs.length} 处）`);

// ---------- 10b. 动作库演示图完整性 ----------
// 每个动作必须同时具备：静态缩略图 PNG（列表用）+ 循环动图 GIF（详情/跟练弹层用）
// 素材本身只有单姿势（等长/单帧），官方不提供动画序列 —— 弹层回退静态图即可
const STATIC_ANIM = ['burpee'];
{
  const exFile = path.join(ROOT, 'assets/data/exercises.js');
  const imgDir = path.join(ROOT, 'packageA/library/images');
  const exSrc = fs.readFileSync(exFile, 'utf8');
  const idRe = /\bid\s*:\s*['"]([a-z0-9_]+)['"]/g;
  let m;
  let count = 0;
  while ((m = idRe.exec(exSrc))) {
    count++;
    const anim = path.join(imgDir, `${m[1]}.gif`);
    const thumb = path.join(imgDir, `${m[1]}.jpg`);
    if (!fs.existsSync(thumb)) {
      err(`[图片] 动作 ${m[1]} 缺少静态缩略图 ${m[1]}.jpg（运行 node tools/apply-dataset-images.js）`);
    } else if (fs.readFileSync(thumb)[0] !== 0xff || fs.readFileSync(thumb)[1] !== 0xd8) {
      err(`[图片] ${m[1]}.jpg 不是合法 JPEG`);
    }
    if (STATIC_ANIM.includes(m[1])) continue; // 单姿势素材：无动画是预期行为
    if (!fs.existsSync(anim)) {
      err(`[图片] 动作 ${m[1]} 缺少演示动画 ${m[1]}.gif（运行 node tools/apply-dataset-images.js）`);
    } else {
      // 文件头必须是 GIF89a，防止下载到半截文件
      const head = fs.readFileSync(anim).slice(0, 6).toString('ascii');
      if (head !== 'GIF89a') err(`[图片] ${m[1]}.gif 文件头非法（${head}）`);
    }
  }
  ok.push(`动作库演示图完整性（${count} 个动作 × 静态图${count - STATIC_ANIM.length} 动图 + ${STATIC_ANIM.length} 静态）`);
}

// ---------- 11. 分包体积 ----------
function dirSize(dir) {
  let total = 0;
  for (const f of walk(dir)) total += fs.statSync(f).size;
  return total;
}
const mainSize = ['app.js', 'app.json', 'app.wxss', 'sitemap.json']
  .reduce((s, f) => s + (fs.existsSync(path.join(ROOT, f)) ? fs.statSync(path.join(ROOT, f)).size : 0), 0)
  + dirSize(path.join(ROOT, 'pages'))
  + dirSize(path.join(ROOT, 'components'))
  + dirSize(path.join(ROOT, 'styles'))
  + dirSize(path.join(ROOT, 'utils'))
  + dirSize(path.join(ROOT, 'services'));
const mainKB = (mainSize / 1024).toFixed(1);
ok.push(`主包体积约 ${mainKB} KB（上限 2048 KB）`);
if (mainSize > 2048 * 1024) err(`[体积] 主包超过 2MB`);

for (const sp of (appJson.subpackages || appJson.subPackages || [])) {
  const spDir = path.join(ROOT, sp.root);
  if (!fs.existsSync(spDir)) continue; // 路径问题已由第 4 项报过
  const size = dirSize(spDir);
  ok.push(`分包 ${sp.name} 体积约 ${(size / 1024).toFixed(1)} KB（上限 2048 KB）`);
  if (size > 2048 * 1024) err(`[体积] 分包 ${sp.name} 超过 2MB`);
}

// ---------- 输出报告 ----------
console.log('\n==================== 静态体检报告 ====================\n');
console.log('✅ 通过项：');
ok.forEach((s) => console.log('   · ' + s));

if (warns.length) {
  console.log('\n⚠️  警告（' + warns.length + '）：');
  warns.forEach((s) => console.log('   · ' + s));
} else {
  console.log('\n⚠️  警告：无');
}

if (errors.length) {
  console.log('\n❌ 错误（' + errors.length + '）：');
  errors.forEach((s) => console.log('   · ' + s));
  console.log('\n结论：存在 ' + errors.length + ' 个错误，需修复后才能在开发者工具中正常运行。\n');
  process.exit(1);
} else {
  console.log('\n❌ 错误：无');
  console.log('\n结论：静态检查全部通过 ✅（' + warns.length + ' 条警告为优化建议）\n');
}
