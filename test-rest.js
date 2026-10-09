/**
 * test-rest.js — 组间休息倒计时（services/rest.js）单测（V1.1）
 * 全部离线运行：内存版 wx 替身，不碰真实环境。
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

// ---------- 内存版 wx 替身 ----------
const storeMap = {};
global.wx = {
  getStorageSync: (k) => (k in storeMap ? storeMap[k] : ''),
  setStorageSync: (k, v) => { storeMap[k] = v; },
  removeStorageSync: (k) => { delete storeMap[k]; }
};

const rest = require(path.join(MINIPROGRAM, 'services/rest.js'));

(async () => {
  section('1. 时长归一化 clampSec');
  eq('常规值原样返回', rest.clampSec(60), 60);
  eq('字符串数字', rest.clampSec('90'), 90);
  eq('小数四舍五入', rest.clampSec(7.6), 8);
  eq('低于下限夹到 5', rest.clampSec(3), 5);
  eq('高于上限夹到 600', rest.clampSec(9999), 600);
  eq('0 视为非法 → 回落 fallback', rest.clampSec(0, 45), 45);
  eq('负数 → 回落 fallback', rest.clampSec(-30, 45), 45);
  eq('NaN → 回落 fallback', rest.clampSec('abc', 45), 45);
  eq('fallback 也没有时用默认 60', rest.clampSec(null), 60);
  eq('fallback 超上限也被夹住', rest.clampSec(0, 9999), 600);

  section('1b. 手动微调 clampAdjust（区别于 clampSec：≤0 也夹取，不回落）');
  eq('剩 10 秒点 −15s → 夹到下限 5 秒（不能跳回 60）', rest.clampAdjust(10 - 15), 5);
  eq('5 秒再 −15 仍是 5', rest.clampAdjust(5 - 15), 5);
  eq('0 也夹到下限', rest.clampAdjust(0), 5);
  eq('常规值原样返回', rest.clampAdjust(45), 45);
  eq('加过头夹到 600', rest.clampAdjust(700), 600);
  eq('非数字 → 回落默认 60', rest.clampAdjust('abc'), 60);

  section('2. 时间格式化 fmt');
  eq('0 → 00:00', rest.fmt(0), '00:00');
  eq('5 → 00:05', rest.fmt(5), '00:05');
  eq('90 → 01:30', rest.fmt(90), '01:30');
  eq('600 → 10:00', rest.fmt(600), '10:00');
  eq('负数 → 00:00（不出现 -00:01）', rest.fmt(-3), '00:00');
  eq('字符串入参', rest.fmt('60'), '01:00');
  eq('null → 00:00', rest.fmt(null), '00:00');

  section('3. 剩余秒数 leftSecFrom（基于时间戳，切后台不掉时间）');
  const T = 1700000000000;
  eq('正好 8 秒', rest.leftSecFrom(T + 8000, T), 8);
  eq('7.5 秒向上取整为 8', rest.leftSecFrom(T + 7500, T), 8);
  eq('8.001 秒向上取整为 9', rest.leftSecFrom(T + 8001, T), 9);
  eq('到点 → 0', rest.leftSecFrom(T, T), 0);
  eq('已过点 → 0 而不是负数', rest.leftSecFrom(T - 5000, T), 0);
  eq('未启动（endTs=0）→ 0', rest.leftSecFrom(0, T), 0);
  eq('不传 now 用当前时间（不抛错）', typeof rest.leftSecFrom(Date.now() + 3000) === 'number', true);

  section('4. 剩余比例 percentLeft');
  eq('30/60 → 50', rest.percentLeft(30, 60), 50);
  eq('60/60 → 100', rest.percentLeft(60, 60), 100);
  eq('0/60 → 0', rest.percentLeft(0, 60), 0);
  eq('剩余大于总时长也夹到 100', rest.percentLeft(90, 60), 100);
  eq('总时长非法 → 0（不会 NaN/Infinity）', rest.percentLeft(10, 0), 0);
  eq('负数剩余 → 0', rest.percentLeft(-5, 60), 0);

  section('5. 下一个练什么 nextLabel');
  const LIST = [
    { exerciseId: 'squat', name: '深蹲', sets: 3 },
    { exerciseId: 'plank', name: '平板支撑', sets: 4 },
    { exerciseId: 'pushup', name: '俯卧撑', sets: 3 }
  ];
  const a = rest.nextLabel(LIST, 'squat', 1, 3);
  eq('同动作还有组 → kind=set', a.kind, 'set');
  eq('文案指向第 2/3 组', a.text, '深蹲 · 第 2/3 组');
  const b = rest.nextLabel(LIST, 'squat', 3, 3);
  eq('本动作做完 → 指向下一个动作', b.kind, 'exercise');
  eq('下一个动作文案', b.text, '下一个：平板支撑 4 组');
  const c = rest.nextLabel(LIST, 'pushup', 3, 3);
  eq('最后一个动作做完 → kind=end', c.kind, 'end');
  ok('结束文案含完成提示', c.text.indexOf('完成') >= 0, c.text);
  const d = rest.nextLabel(LIST, 'pushup', 1, 3);
  eq('最后一个动作未做完仍是 set', d.kind, 'set');
  const e = rest.nextLabel(LIST, 'unknown', 1, 3);
  eq('未知 id 不崩，回落到第一个动作', e.kind, 'exercise');
  const f = rest.nextLabel([], 'squat', 1, 3);
  eq('空列表 → end', f.kind, 'end');
  const g = rest.nextLabel(null, 'squat', 1, 3);
  eq('null 列表 → end（不抛错）', g.kind, 'end');
  const h = rest.nextLabel(LIST, 'squat', 0, 0);
  eq('组数为 0 视为已做完 → 走下一个动作', h.kind, 'exercise');

  section('6. 偏好读写（默认 60 秒 / 0 = 关闭）');
  eq('初始默认 60 秒', rest.getDefault(), 60);
  eq('初始 isEnabled 为 true', rest.isEnabled(), true);
  eq('setDefault(45) 返回落库值', rest.setDefault(45), 45);
  eq('读回 45', rest.getDefault(), 45);
  eq('setDefault(0) 表示关闭', rest.setDefault(0), 0);
  eq('关闭后 getDefault 为 0', rest.getDefault(), 0);
  eq('关闭后 isEnabled 为 false', rest.isEnabled(), false);
  eq('0 能存进去（不能被 clamp 成 60）', storeMap[rest.KEY], 0);
  eq('重新开启 90 秒', rest.setDefault(90), 90);
  eq('超范围值被夹到 600', rest.setDefault(9999), 600);
  eq('非法值回落默认 60', rest.setDefault('abc'), 60);

  section('7. 脏数据容错');
  storeMap[rest.KEY] = 'xyz';
  eq('无法解析 → 回落 60', rest.getDefault(), 60);
  storeMap[rest.KEY] = '';
  eq('空串 → 回落 60', rest.getDefault(), 60);
  storeMap[rest.KEY] = null;
  eq('null → 回落 60', rest.getDefault(), 60);
  storeMap[rest.KEY] = '0';
  eq("字符串 '0' 也识别为关闭", rest.getDefault(), 0);
  storeMap[rest.KEY] = '30';
  eq('字符串数字可解析', rest.getDefault(), 30);
  delete storeMap[rest.KEY];

  section('8. 文案与预设');
  eq('label(0) → 已关闭', rest.label(0), '已关闭');
  eq('label(30) → 30 秒', rest.label(30), '30 秒');
  eq('label(60) → 60 秒', rest.label(60), '60 秒');
  eq('预设共 6 项', rest.presetLabels().length, 6);
  eq('首项为已关闭', rest.presetLabels()[0], '已关闭');
  eq('30 秒的下标为 1', rest.presetIndex(30), 1);
  eq('关闭态下标为 0', rest.presetIndex(0), 0);
  eq('非预设值回落 0', rest.presetIndex(77), 0);
  eq('PRESETS 与 label 一一对应', rest.PRESETS.map(rest.label).join('|'), rest.presetLabels().join('|'));

  section('9. 与「我的」页联动的语义');
  // 我的页 ActionSheet：点第 3 项（下标 3）应落到 60 秒
  const picked = rest.PRESETS[3];
  eq('ActionSheet 下标 3 → 60 秒', picked, 60);
  eq('存下来后再读还是 60', rest.setDefault(picked), 60);

  console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================\n');
  process.exit(fail ? 1 : 0);
})();
