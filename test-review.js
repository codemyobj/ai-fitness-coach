/**
 * test-review.js — 提审合规静态断言（V1.0.1 起）
 *
 * 为什么单独一套：2026-10-08 提审被驳回，原因是
 * 「小程序服务内容涉及深度合成技术（如：AI 问答…），属个人主体尚未开放服务类目」。
 * 处置方式是移除全部 AI 功能与 AI 宣称（见 docs/REVIEW-AI-REMOVAL.md）。
 *
 * 这类问题**不会再被功能测试发现** —— 删了代码、页面照样跑；但只要文案里
 * 留一句「AI 为你生成」，就又是一次驳回。所以这里用静态扫描把它钉住：
 *   ① 注册表（app.json / sitemap）不得出现 coach 页
 *   ② 包内不得出现任何 AI 生成类宣称（wxml / json / 协议正文）
 *   ③ AI 相关模块必须待在 parked-features 之外，包内不得引用
 *   ④ 计划页/首页不得再有跳转教练页的方法
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, 'miniprogram');
const PROJECT = __dirname;
let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`   ✅ ${name}`); }
  else { fail++; console.log(`   ❌ ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`); }
}
function eq(name, actual, expected) {
  ok(`${name}（期望 ${JSON.stringify(expected)}）`, actual === expected, actual);
}
function section(t) { console.log(`\n${t}`); }

// 递归收集包内文件（跳过图片与数据素材目录）
function walk(dir, exts, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'assets') continue;
      walk(p, exts, out);
    } else if (exts.some((x) => p.endsWith(x))) {
      out.push(p);
    }
  }
  return out;
}
const rel = (p) => path.relative(PROJECT, p).replace(/\\/g, '/');

console.log('\n================ 提审合规静态断言 ================');

// ---------- A. 注册表：不得再有教练页 ----------
section('A. 页面注册表（app.json / sitemap.json）');
{
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  const allPages = []
    .concat(appJson.pages || [])
    .concat((appJson.subpackages || []).flatMap((sp) => (sp.pages || []).map((p) => `${sp.root}/${p}`)));

  ok('pages / subpackages 不含 coach 页', !allPages.some((p) => p.indexOf('coach') >= 0), allPages.join(','));
  ok('tabBar 不含教练 tab', !(appJson.tabBar.list || []).some((t) => t.pagePath.indexOf('coach') >= 0),
    JSON.stringify((appJson.tabBar.list || []).map((t) => t.text)));
  eq('tabBar 剩 2 个 tab（训练 / 我的）', appJson.tabBar.list.length, 2);
  ok('导航标题不含 AI', String(appJson.window.navigationBarTitleText).indexOf('AI') < 0,
    appJson.window.navigationBarTitleText);

  const sitemap = JSON.parse(fs.readFileSync(path.join(ROOT, 'sitemap.json'), 'utf8'));
  ok('sitemap 不含 coach 页', !(sitemap.rules || []).some((r) => String(r.page).indexOf('coach') >= 0),
    JSON.stringify(sitemap.rules));
}

// ---------- B. 包内不得出现 AI 生成类宣称 ----------
// 只扫「用户可见文本」的载体：WXML、页面 JSON、协议正文。
// .js 里的注释允许出现 AI（因为我们要在注释里说明「不涉及 AI」，这正是澄清而不是宣称）。
section('B. 用户可见文案（不得宣称 AI 生成）');
{
  // 注意：不能把「不涉及人工智能生成合成技术」这类**澄清**当违规。
  // 这里只拦「宣称由 AI 生成」的表述（由 AI / AI 依据 / AI 为你 / AI 教练）。
  const CLAIM = /由\s?AI|AI\s?依据|AI\s?为你|AI\s?教练|AI\s?定制|AI\s?问答/;
  const wxmlFiles = walk(ROOT, ['.wxml']);
  const jsonFiles = walk(ROOT, ['.json']);
  const textFiles = wxmlFiles.concat(jsonFiles);
  const hits = [];
  for (const f of textFiles) {
    const src = fs.readFileSync(f, 'utf8');
    // 只查可见文本：去掉注释
    const visible = wxmlFiles.includes(f) ? src.replace(/<!--[\s\S]*?-->/g, '') : src;
    if (/AI/.test(visible)) hits.push(rel(f));
  }
  ok(`WXML / JSON 中不出现 AI 字样（扫了 ${textFiles.length} 个文件）`, hits.length === 0, hits.join(','));

  const content = require(path.join(ROOT, 'content/legal.js'));
  const legalText = JSON.stringify(content.AGREEMENT) + JSON.stringify(content.PRIVACY)
    + JSON.stringify(content.DATA_ITEMS);
  ok('协议与隐私正文不出现 AI 字样', !/AI/.test(legalText),
    (legalText.match(/[^"]{0,24}AI[^"]{0,24}/) || [''])[0]);
  ok('协议正文不含「由 AI / AI 依据 / AI 为你」这类生成宣称', !CLAIM.test(legalText),
    (legalText.match(CLAIM) || [''])[0]);
  ok('收集清单已无「对话内容」项',
    !content.DATA_ITEMS.some((d) => /对话/.test(d.name)), JSON.stringify(content.DATA_ITEMS.map((d) => d.name)));
  eq('收集清单剩 7 项', content.DATA_ITEMS.length, 7);
  eq('协议版本已升到 v1.1（正文有实质改动）', content.LEGAL_VERSION, 'v1.1');
  ok('协议里明确了计划由确定性规则编排（不涉及生成合成技术）',
    /不涉及人工智能生成合成技术/.test(JSON.stringify(content.AGREEMENT)));
}

// ---------- C. AI 模块必须已封存，包内不得引用 ----------
section('C. AI 模块封存状态');
{
  ok('包内已无 services/ai.js', !fs.existsSync(path.join(ROOT, 'services/ai.js')));
  ok('包内已无 utils/markdown.js', !fs.existsSync(path.join(ROOT, 'utils/markdown.js')));
  ok('包内已无 pages/coach 目录', !fs.existsSync(path.join(ROOT, 'pages/coach')));
  ok('包内已无 coach tabBar 图标', !fs.existsSync(path.join(ROOT, 'assets/icons/coach.png')));

  ok('封存目录存在 ai.js', fs.existsSync(path.join(PROJECT, 'parked-features/services/ai.js')));
  ok('封存目录存在教练页', fs.existsSync(path.join(PROJECT, 'parked-features/pages-coach/coach.js')));
  ok('封存目录有还原说明', fs.existsSync(path.join(PROJECT, 'parked-features/README.md')));
  ok('封存内容不在小程序包内（不会被上传审核）',
    !rel(path.join(PROJECT, 'parked-features')).startsWith('miniprogram/'));

  // 云函数保留（不上传、审核不可见），但前端不得再调用
  ok('aiCoach 云函数源码仍保留（企业主体后可复用）',
    fs.existsSync(path.join(PROJECT, 'cloudfunctions/aiCoach/index.js')));
  const jsFiles = walk(ROOT, ['.js']);
  const callers = jsFiles.filter((f) => {
    const src = fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
    return /aiCoach|services\/ai|pages\/coach/.test(src);
  });
  ok(`包内 JS 不再调用 AI 能力（扫了 ${jsFiles.length} 个文件）`, callers.length === 0, callers.map(rel).join(','));
}

// ---------- D. 页面方法层：入口真的断开了 ----------
section('D. 页面方法（入口已断开）');
{
  const training = fs.readFileSync(path.join(ROOT, 'pages/training/training.js'), 'utf8');
  const plan = fs.readFileSync(path.join(ROOT, 'packageA/plan/plan.js'), 'utf8');
  ok('训练页已无 goCoach 方法', !/goCoach\s*\(/.test(training));
  ok('训练页生成计划走本地规则', /createPlanLocal\s*\(/.test(training) && !/\bai\./.test(training));
  ok('计划页已无 goCoach 方法', !/goCoach\s*\(/.test(plan));
  ok('计划页改为本地重排（regenerate）', /regenerate\s*\(/.test(plan) && /createPlanLocal\s*\(/.test(plan));

  const trainingWxml = fs.readFileSync(path.join(ROOT, 'pages/training/training.wxml'), 'utf8');
  ok('训练页无「问问教练」按钮', trainingWxml.indexOf('问问教练') < 0);
  ok('训练页生成按钮文案已改口径', trainingWxml.indexOf('生成训练计划') >= 0);
  ok('免责声明不再说内容由 AI 生成', trainingWxml.indexOf('内容由 AI 生成') < 0);
}

// ---------- E. 计划生成仍是确定性规则（可离线验证） ----------
section('E. 计划编排（规则驱动，无模型调用）');
{
  global.wx = {
    cloud: { database: () => ({ serverDate: () => ({ $date: 0 }) }), command: {} },
    getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {}
  };
  global.getApp = () => ({ globalData: { openid: 'openid-test' } });
  const planSvc = require(path.join(ROOT, 'services/plan.js'));
  const profile = { goal: 'fat_loss', daysPerWeek: 4, equipment: ['徒手'] };
  const p = planSvc.buildPlan(profile);
  eq('编排结果 4 周', p.structure.length, 4);
  eq('每周 4 天（跟随档案）', p.structure[0].days.length, 4);
  eq('计划名不含 AI 字样', /AI/.test(p.planName), false);
  ok('计划说明不含 AI 字样', !/AI/.test(p.summary), p.summary);
  const again = planSvc.buildPlan(profile);
  ok('同档案两次编排结果一致（确定性，不是随机/生成式）',
    JSON.stringify(again.structure) === JSON.stringify(p.structure));
  ok('动作全部来自本地动作库', p.structure[0].days[0].exercises.every((e) => !!e.exerciseId));
}

// ---------- 输出 ----------
console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================');
if (fail > 0) {
  console.log('\n失败项：');
  process.exitCode = 1;
} else {
  console.log('结论：已按审核驳回意见移除 AI 相关功能与宣称，可重新提审 ✅');
}
