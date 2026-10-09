/**
 * test-legal.js — 用户协议 / 隐私政策的单测（V1.1）
 * 覆盖：正文完整性（content/legal.js）+ 同意状态（services/legal.js）
 *
 * 为什么给「文案」也写测试：
 *   协议正文是提审时会被逐条对照的材料，但它太容易被「随手改一句」改坏
 *   （删掉某段免责、漏掉某个收集项、留下 TODO 占位符），而运行时不报任何错。
 *   这里把「必须存在的段落」钉成断言，改动时会被拦住。
 *
 * 全部离线运行：一个内存版 wx 替身，不碰真实环境。
 */
const path = require('path');
const MINIPROGRAM = path.resolve(__dirname, 'miniprogram');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`   ✅ ${name}`);
  } else {
    fail++;
    console.log(`   ❌ ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
  }
}
function eq(name, actual, expected) {
  ok(`${name}（期望 ${JSON.stringify(expected)}）`, actual === expected, actual);
}
function section(t) { console.log(`\n${t}`); }

// ---------- 内存版 wx 替身（可注入故障） ----------
const storeMap = {};
const faults = { get: false, set: false, remove: false };

global.wx = {
  getStorageSync(k) {
    if (faults.get) throw new Error('boom: getStorageSync');
    return k in storeMap ? storeMap[k] : '';
  },
  setStorageSync(k, v) {
    if (faults.set) throw new Error('boom: setStorageSync');
    storeMap[k] = v;
  },
  removeStorageSync(k) {
    if (faults.remove) throw new Error('boom: removeStorageSync');
    delete storeMap[k];
  }
};

function clearStore() {
  Object.keys(storeMap).forEach((k) => delete storeMap[k]);
}
function resetFaults() {
  faults.get = faults.set = faults.remove = false;
}

const content = require(path.join(MINIPROGRAM, 'content/legal.js'));
const legal = require(path.join(MINIPROGRAM, 'services/legal.js'));

console.log('\n================ 协议与隐私政策测试 ================');

// ================= A. 正文完整性 =================
section('A. 正文完整性（content/legal.js）');

ok('版本号格式为 vX.Y', /^v\d+\.\d+$/.test(content.LEGAL_VERSION), content.LEGAL_VERSION);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
ok('生效日期为 YYYY-MM-DD', DATE_RE.test(content.EFFECTIVE_DATE), content.EFFECTIVE_DATE);
ok('更新日期为 YYYY-MM-DD', DATE_RE.test(content.UPDATED_DATE), content.UPDATED_DATE);
ok('生效日期不晚于更新日期', content.EFFECTIVE_DATE <= content.UPDATED_DATE,
  `${content.EFFECTIVE_DATE} > ${content.UPDATED_DATE}`);

eq('用户协议 type', content.AGREEMENT.type, 'agreement');
eq('隐私政策 type', content.PRIVACY.type, 'privacy');
ok('应用名非空', typeof content.APP_NAME === 'string' && content.APP_NAME.length > 0);
ok('联系方式非空', typeof content.CONTACT === 'string' && content.CONTACT.length > 0, content.CONTACT);

/** 把一份文档拍平成一个长字符串，做关键词断言用 */
function flat(doc) {
  const parts = [doc.title, doc.summary];
  (doc.sections || []).forEach((s) => {
    parts.push(s.h);
    (s.ps || []).forEach((p) => parts.push(p));
  });
  return parts.join('\n');
}

for (const [label, doc] of [['用户协议', content.AGREEMENT], ['隐私政策', content.PRIVACY]]) {
  ok(`${label}标题非空`, typeof doc.title === 'string' && doc.title.length > 0);
  ok(`${label}摘要非空`, typeof doc.summary === 'string' && doc.summary.length > 20);
  ok(`${label}分节数 >= 8`, Array.isArray(doc.sections) && doc.sections.length >= 8,
    doc.sections && doc.sections.length);

  let badSection = null;
  let badPara = null;
  const heads = [];
  doc.sections.forEach((s, i) => {
    if (typeof s.h !== 'string' || !s.h.trim()) badSection = i;
    if (!Array.isArray(s.ps) || !s.ps.length) badSection = i;
    (s.ps || []).forEach((p, j) => {
      if (typeof p !== 'string' || !p.trim()) badPara = `${i}-${j}`;
    });
    heads.push(s.h);
  });
  ok(`${label}每节都有标题与正文段落`, badSection === null, badSection);
  ok(`${label}没有空段落`, badPara === null, badPara);
  eq(`${label}节标题无重复`, new Set(heads).size, heads.length);
}

// 占位符 / 未填项：提审时出现这类文字会被直接驳回
const PLACEHOLDERS = ['TODO', 'FIXME', '待填', '待补充', 'xxx', 'XXX', 'REPLACE', 'lorem', '占位'];
for (const [label, doc] of [['用户协议', content.AGREEMENT], ['隐私政策', content.PRIVACY]]) {
  const text = flat(doc);
  const hit = PLACEHOLDERS.filter((w) => text.indexOf(w) >= 0);
  eq(`${label}正文无占位符残留`, hit.length, 0);
}

// 用户协议必须覆盖的硬条款
const agreeText = flat(content.AGREEMENT);
ok('用户协议含健康与安全提示章节', agreeText.indexOf('健康与安全') >= 0);
ok('用户协议声明 AI 内容不构成医疗建议', agreeText.indexOf('不构成医疗建议') >= 0);
ok('用户协议提示就医', agreeText.indexOf('就医') >= 0);
ok('用户协议含未成年人条款', agreeText.indexOf('监护人') >= 0);
ok('用户协议含免责与责任限制', agreeText.indexOf('免责') >= 0);
ok('用户协议含知识产权章节', agreeText.indexOf('知识产权') >= 0);
ok('用户协议含第三方素材署名说明', agreeText.indexOf('RepDB') >= 0);
ok('用户协议含协议更新条款', agreeText.indexOf('更新') >= 0);
ok('用户协议第十章含联系方式', agreeText.indexOf(content.CONTACT) >= 0);

// 隐私政策必须覆盖的硬条款
const privacyText = flat(content.PRIVACY);
ok('隐私政策声明最小必要原则', privacyText.indexOf('最小必要') >= 0);
ok('隐私政策声明不收集手机号/位置/相册等', privacyText.indexOf('手机号') >= 0 && privacyText.indexOf('位置') >= 0);
ok('隐私政策写明存储位置（微信云开发）', privacyText.indexOf('微信云开发') >= 0);
ok('隐私政策写明删除路径（清空训练数据）', privacyText.indexOf('清空训练数据') >= 0);
ok('隐私政策写明撤回同意方式', privacyText.indexOf('撤回同意') >= 0);
ok('隐私政策含用户权利章节', privacyText.indexOf('你的权利') >= 0);
ok('隐私政策含未成年人保护章节', privacyText.indexOf('未成年人') >= 0);
ok('隐私政策声明不出售个人信息', privacyText.indexOf('不会出售') >= 0);
ok('隐私政策含第三方服务说明', privacyText.indexOf('第三方') >= 0);
ok('隐私政策第十章含联系方式', privacyText.indexOf(content.CONTACT) >= 0);
// 健康数据属敏感个人信息，必须显式提示
ok('隐私政策提示身体数据属敏感个人信息', privacyText.indexOf('敏感个人信息') >= 0);

// 收集清单 ↔ 页面表格的对应关系
ok('DATA_ITEMS 非空', Array.isArray(content.DATA_ITEMS) && content.DATA_ITEMS.length >= 5,
  content.DATA_ITEMS && content.DATA_ITEMS.length);
let itemBad = null;
content.DATA_ITEMS.forEach((d, i) => {
  if (typeof d.name !== 'string' || !d.name.trim()) itemBad = `${i}.name`;
  if (typeof d.detail !== 'string' || !d.detail.trim()) itemBad = `${i}.detail`;
  if (typeof d.purpose !== 'string' || !d.purpose.trim()) itemBad = `${i}.purpose`;
  if (typeof d.required !== 'boolean') itemBad = `${i}.required`;
});
ok('收集清单每项字段完整（name/detail/purpose/required）', itemBad === null, itemBad);
eq('收集清单无重名', new Set(content.DATA_ITEMS.map((d) => d.name)).size, content.DATA_ITEMS.length);
ok('收集清单至少有一条必需项', content.DATA_ITEMS.some((d) => d.required === true));
ok('收集清单有可选项（否则「可选」标注失去意义）', content.DATA_ITEMS.some((d) => d.required === false));

// 表格挂在隐私政策第二（索引 1）节，页面与文档必须一致
const tableSections = content.PRIVACY.sections.filter((s) => s.table === true);
eq('隐私政策有且仅有一个表格节', tableSections.length, 1);
eq('表格节是「我们收集哪些信息」', tableSections[0] && tableSections[0].h.indexOf('收集') >= 0, true);
ok('表格节说明了必需/可选的图例',
  (tableSections[0].ps || []).join('').indexOf('必需') >= 0 && (tableSections[0].ps || []).join('').indexOf('可选') >= 0);
eq('用户协议没有表格节', content.AGREEMENT.sections.filter((s) => s.table === true).length, 0);

ok('requiredItemNames 只返回必需项',
  content.requiredItemNames().length === content.DATA_ITEMS.filter((d) => d.required).length,
  content.requiredItemNames());

// isType / getDoc / docTabs
eq('isType agreement', content.isType('agreement'), true);
eq('isType privacy', content.isType('privacy'), true);
['', null, undefined, 'Agreement', 'PRIVACY', 'terms', 0, {}, ['agreement']].forEach((bad, i) => {
  eq(`isType 非法值 #${i} 为 false`, content.isType(bad), false);
});
eq('getDoc 非法 type 回退到用户协议', content.getDoc('nope'), content.AGREEMENT);
eq('getDoc undefined 回退到用户协议', content.getDoc(undefined), content.AGREEMENT);
eq('getDoc privacy 正常取到', content.getDoc('privacy'), content.PRIVACY);

const tabs = content.docTabs();
eq('切换标签 2 项', tabs.length, 2);
eq('标签顺序：用户协议在前', tabs[0].type, 'agreement');
eq('标签顺序：隐私政策在后', tabs[1].type, 'privacy');
eq('标签文案取标题', tabs[0].label, content.AGREEMENT.title);

// ================= B. 同意状态 =================
section('B. 同意状态（services/legal.js）');

clearStore();
eq('存储键固定', legal.KEY, 'legal_accept_v1');
eq('初始：getAcceptance 为 null', legal.getAcceptance(), null);
eq('初始：isAccepted 为 false', legal.isAccepted(), false);
eq('初始：needsReaccept 为 true', legal.needsReaccept(), true);
eq('初始：状态文案', legal.statusText(), '未同意');
eq('初始：同意时间为 0', legal.acceptedAt(), 0);

const rec = legal.accept();
eq('accept 记录当前版本', rec.version, content.LEGAL_VERSION);
ok('accept 记录时间戳', typeof rec.acceptedAt === 'number' && rec.acceptedAt > 0, rec.acceptedAt);
eq('accept 后 isAccepted 为 true', legal.isAccepted(), true);
eq('accept 后 needsReaccept 为 false', legal.needsReaccept(), false);
eq('accept 后状态文案带版本', legal.statusText(), `已同意 ${content.LEGAL_VERSION}`);
eq('accept 后同意时间可读', legal.acceptedAt(), rec.acceptedAt);
ok('accept 写入了 storage', legal.KEY in storeMap);

// 撤销
eq('revoke 返回 true', legal.revoke(), true);
eq('revoke 后 isAccepted 为 false', legal.isAccepted(), false);
eq('revoke 后 storage 已清空', legal.KEY in storeMap, false);

// 旧版本同意不算同意：协议更新后必须重新勾选
legal.accept('v0.9');
eq('旧版本记录仍可读出', legal.getAcceptance().version, 'v0.9');
eq('旧版本 isAccepted 为 false', legal.isAccepted(), false);
eq('旧版本 needsReaccept 为 true', legal.needsReaccept(), true);
eq('旧版本状态文案为「协议已更新」', legal.statusText(), '协议已更新');

// 显式版本 + 时间戳（测试与迁移用）
const custom = legal.accept(content.LEGAL_VERSION, 1700000000000);
eq('显式时间戳生效', custom.acceptedAt, 1700000000000);
eq('显式版本生效', custom.version, content.LEGAL_VERSION);

// 非法时间戳回退到当前时间
const now0 = Date.now();
const fallbackAt = legal.accept(content.LEGAL_VERSION, 0).acceptedAt;
ok('acceptedAt=0 回退到当前时间', fallbackAt >= now0 && fallbackAt <= Date.now() + 5,
  `${fallbackAt} vs ${now0}`);
ok('acceptedAt=NaN 回退到当前时间', legal.accept(content.LEGAL_VERSION, NaN).acceptedAt > 0);
ok('acceptedAt=-1 回退到当前时间', legal.accept(content.LEGAL_VERSION, -1).acceptedAt > 0);
eq('非法版本号回退到当前版本', legal.accept('', 123).version, content.LEGAL_VERSION);
eq('非字符串版本号回退', legal.accept(123, 123).version, content.LEGAL_VERSION);

// normalize 归一化
eq('normalize null', legal.normalize(null), null);
eq('normalize undefined', legal.normalize(undefined), null);
eq('normalize 字符串', legal.normalize('v1.0'), null);
eq('normalize 数组', legal.normalize(['v1.0', 1]), null);
eq('normalize 空对象', legal.normalize({}), null);
eq('normalize 缺 acceptedAt', legal.normalize({ version: 'v1.0' }), null);
eq('normalize 缺 version', legal.normalize({ acceptedAt: 123 }), null);
eq('normalize 空 version', legal.normalize({ version: '', acceptedAt: 123 }), null);
eq('normalize version 非字符串', legal.normalize({ version: 1, acceptedAt: 123 }), null);
eq('normalize acceptedAt 为 0', legal.normalize({ version: 'v1.0', acceptedAt: 0 }), null);
eq('normalize acceptedAt 为负数', legal.normalize({ version: 'v1.0', acceptedAt: -5 }), null);
eq('normalize acceptedAt 非数字', legal.normalize({ version: 'v1.0', acceptedAt: 'abc' }), null);
eq('normalize acceptedAt 缺失为 undefined', legal.normalize({ version: 'v1.0', acceptedAt: undefined }), null);
const normOk = legal.normalize({ version: 'v1.0', acceptedAt: 123 });
ok('normalize 合法记录透传', normOk && normOk.version === 'v1.0' && normOk.acceptedAt === 123, normOk);
eq('normalize acceptedAt 数字字符串可解析', legal.normalize({ version: 'v1.0', acceptedAt: '123' }).acceptedAt, 123);

// 脏数据落在 storage 里不能抛错、只能退化为「未同意」
clearStore();
storeMap[legal.KEY] = { version: 'v1.0' }; // 缺时间戳
eq('缺时间戳的脏记录 → 未同意', legal.isAccepted(), false);
storeMap[legal.KEY] = 'garbage';
eq('字符串脏记录 → 未同意', legal.isAccepted(), false);
storeMap[legal.KEY] = [];
eq('数组脏记录 → 未同意', legal.isAccepted(), false);
storeMap[legal.KEY] = { version: content.LEGAL_VERSION, acceptedAt: 'abc' };
eq('时间戳非法 → 未同意', legal.isAccepted(), false);

// 读写异常兜底
clearStore();
resetFaults();
faults.get = true;
eq('getStorageSync 抛错 → getAcceptance 返回 null', legal.getAcceptance(), null);
eq('getStorageSync 抛错 → isAccepted 为 false', legal.isAccepted(), false);
eq('getStorageSync 抛错 → needsReaccept 为 true', legal.needsReaccept(), true);
resetFaults();

faults.set = true;
let threw = false;
let r2 = null;
try { r2 = legal.accept(); } catch (e) { threw = true; }
ok('setStorageSync 抛错不向外抛', threw === false);
ok('setStorageSync 抛错仍返回记录', r2 && r2.version === content.LEGAL_VERSION, r2);
resetFaults();

faults.remove = true;
eq('removeStorageSync 抛错 → revoke 返回 false', legal.revoke(), false);
resetFaults();
eq('removeStorageSync 正常 → revoke 返回 true', legal.revoke(), true);

// reset 等价于 revoke
legal.accept();
eq('reset 后 isAccepted 为 false', legal.reset() === true && legal.isAccepted() === false, true);

// 协议版本升级 → 老用户重新同意（这是整套机制存在的理由）
// 注意：不要把「模拟的新版本」写死成某个具体版本号 —— 真版本一旦涨到同一个号，
// 模拟就失效了（曾经踩过：写死 v1.1，而 content.LEGAL_VERSION 正好也是 v1.1）。
clearStore();
legal.accept();
eq('升级前：当前版本已同意', legal.isAccepted(), true);
const savedVersion = content.LEGAL_VERSION;
const bumpedVersion = savedVersion.replace(/^v(\d+)\.(\d+)$/, (m, a, b) => `v${a}.${Number(b) + 1}`);
ok('能从当前版本推出一个更高的版本号', bumpedVersion !== savedVersion, `${savedVersion} → ${bumpedVersion}`);
try {
  content.LEGAL_VERSION = bumpedVersion; // 模拟开发者改了版本号
  eq('升级后：isAccepted 变 false', legal.isAccepted(), false);
  eq('升级后：needsReaccept 为 true', legal.needsReaccept(), true);
  eq('升级后：状态文案为「协议已更新」', legal.statusText(), '协议已更新');
  eq('升级后：旧记录仍保留可查', legal.getAcceptance().version, savedVersion);
  legal.accept();
  eq('升级后重新同意：状态文案跟新版本', legal.statusText(), `已同意 ${bumpedVersion}`);
} finally {
  content.LEGAL_VERSION = savedVersion;
}

clearStore();
resetFaults();

// ---------- 输出 ----------
console.log(`\n================ 结果：${pass} 通过 / ${fail} 失败 ================\n`);
if (fail > 0) process.exit(1);
