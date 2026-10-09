/**
 * test-badges.js — 成就徽章的单测（V1.1）
 * 覆盖：徽章定义完整性 + 判定边界 + 高水位（不回退）+ 解锁记录 + 脏数据与异常兜底
 *
 * 为什么值得写这么多：徽章最容易出的两类问题都很隐蔽 ——
 *   ① 「已解锁」因为统计窗口滑动而回退（用户会觉得徽章被偷了）
 *   ② 「新解锁」提示重复弹（因为解锁记录没落盘或判定不稳）
 * 这两件事运行时都不报错，只能靠断言钉住。
 *
 * 全部离线运行：一个内存版 wx 替身，可注入读写故障。
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

function clearStore() { Object.keys(storeMap).forEach((k) => delete storeMap[k]); }
function resetFaults() { faults.get = faults.set = faults.remove = false; }

const b = require(path.join(MINIPROGRAM, 'services/badges.js'));

/** 取某枚徽章的判定结果 */
function get(list, id) { return list.filter((x) => x.id === id)[0]; }
/** 零指标 */
function zeroMetrics() { return b.buildMetrics({}, {}); }

console.log('\n================ 成就徽章测试 ================');

// ================= A. 定义完整性 =================
section('A. 徽章定义完整性');

ok('徽章数量 >= 10', b.TOTAL >= 10, b.TOTAL);
eq('TOTAL 与 DEFS 一致', b.TOTAL, b.DEFS.length);
eq('分组无重复', new Set(b.GROUPS).size, b.GROUPS.length);
ok('分组数量 >= 5', b.GROUPS.length >= 5, b.GROUPS.length);

let badField = null;
b.DEFS.forEach((d, i) => {
  if (typeof d.id !== 'string' || !d.id.trim()) badField = `${i}.id`;
  if (typeof d.icon !== 'string' || !d.icon.trim()) badField = `${i}.icon`;
  if (typeof d.name !== 'string' || !d.name.trim()) badField = `${i}.name`;
  if (typeof d.desc !== 'string' || !d.desc.trim()) badField = `${i}.desc`;
  if (typeof d.group !== 'string' || !d.group.trim()) badField = `${i}.group`;
  if (typeof d.metric !== 'string' || !d.metric.trim()) badField = `${i}.metric`;
  if (!(Number(d.target) > 0)) badField = `${i}.target`;
});
ok('每枚徽章字段完整且 target > 0', badField === null, badField);

eq('徽章 id 无重复', new Set(b.DEFS.map((d) => d.id)).size, b.DEFS.length);
eq('徽章名称无重复', new Set(b.DEFS.map((d) => d.name)).size, b.DEFS.length);

const unknownGroup = b.DEFS.filter((d) => b.GROUPS.indexOf(d.group) < 0).map((d) => d.id);
eq('所有徽章的分组都在 GROUPS 中', unknownGroup.length, 0);
const unknownMetric = b.DEFS.filter((d) => b.METRICS.indexOf(d.metric) < 0).map((d) => d.id);
eq('所有徽章的指标都在 METRICS 中', unknownMetric.length, 0);

// 分组顺序 = DEFS 里首次出现的顺序（否则页面分组会跳来跳去）
const appearOrder = [];
b.DEFS.forEach((d) => { if (appearOrder.indexOf(d.group) < 0) appearOrder.push(d.group); });
eq('GROUPS 顺序与 DEFS 出现顺序一致', JSON.stringify(b.GROUPS), JSON.stringify(appearOrder));

const emptyGroups = b.GROUPS.filter((g) => !b.DEFS.some((d) => d.group === g));
eq('没有空分组', emptyGroups.length, 0);

ok('DEF_BY_ID 能按 id 取到定义', b.DEF_BY_ID.streak_7 && b.DEF_BY_ID.streak_7.target === 7);
eq('同一指标可以支撑多枚徽章（累计 10/50/100）',
  b.DEFS.filter((d) => d.metric === 'totalCheckins').length >= 3, true);

// ================= B. 判定与边界 =================
section('B. 判定与边界（evaluate）');

clearStore();
let list = b.evaluate(zeroMetrics());
eq('零指标：一枚都不解锁', list.filter((x) => x.unlocked).length, 0);
eq('零指标：条数等于徽章总数', list.length, b.TOTAL);
eq('零指标：建档徽章未解锁', get(list, 'profile_done').unlocked, false);

list = b.evaluate({ hasProfile: true });
eq('仅有档案：只解锁建档徽章', list.filter((x) => x.unlocked).map((x) => x.id).join(','), 'profile_done');
eq('建档徽章进度文案', get(list, 'profile_done').progressText, '已达成');
eq('建档徽章 percent 100', get(list, 'profile_done').percent, 100);
eq('建档徽章 remain 0', get(list, 'profile_done').remain, 0);
eq('未完成的布尔徽章文案', get(b.evaluate({}), 'profile_done').progressText, '未完成');
eq('未完成的布尔徽章 remainText', get(b.evaluate({}), 'profile_done').remainText, '尚未完成');

// 边界：target-1 不解锁，target 解锁
const m = (n) => b.buildMetrics({ totalCheckins: n }, {});
eq('累计 9 次：10 次徽章未解锁', get(b.evaluate(m(9)), 'checkin_10').unlocked, false);
eq('累计 10 次：10 次徽章解锁', get(b.evaluate(m(10)), 'checkin_10').unlocked, true);
eq('累计 1 次：首次徽章解锁', get(b.evaluate(m(1)), 'first_checkin').unlocked, true);
eq('累计 0 次：首次徽章未解锁', get(b.evaluate(m(0)), 'first_checkin').unlocked, false);
eq('累计 100 次：百炼成钢解锁', get(b.evaluate(m(100)), 'checkin_100').unlocked, true);
eq('累计 99 次：百炼成钢未解锁', get(b.evaluate(m(99)), 'checkin_100').unlocked, false);

// 进度文案与百分比
const p = get(b.evaluate(m(25)), 'checkin_100');
eq('25/100 的 percent', p.percent, 25);
eq('25/100 的进度文案', p.progressText, '25/100 次');
eq('25/100 的剩余文案', p.remainText, '还差 75 次');
eq('超额时不显示负剩余', get(b.evaluate(m(200)), 'checkin_100').remainText, '');
eq('超额时进度文案夹在阈值', get(b.evaluate(m(200)), 'checkin_100').progressText, '100/100 次');
eq('超额时 percent 夹在 100', get(b.evaluate(m(200)), 'checkin_100').percent, 100);

// 连续徽章走 bestStreak（不是当前 streak）
const st = b.buildMetrics({ bestStreak: 7 }, {});
eq('最长连续 7 天：解锁「坚持一周」', get(b.evaluate(st), 'streak_7').unlocked, true);
eq('最长连续 7 天：未解锁「半月不断」', get(b.evaluate(st), 'streak_14').unlocked, false);
eq('当前连续字段不参与判定', get(b.evaluate(b.buildMetrics({ streak: 30 }, {})), 'streak_7').unlocked, false);

// 其它指标
eq('时长 600 分钟解锁十小时', get(b.evaluate(b.buildMetrics({ totalMin: 600 }, {})), 'time_10h').unlocked, true);
eq('时长 599 分钟不解锁', get(b.evaluate(b.buildMetrics({ totalMin: 599 }, {})), 'time_10h').unlocked, false);
eq('1000 组解锁千组达成', get(b.evaluate(b.buildMetrics({ totalSets: 1000 }, {})), 'sets_1000').unlocked, true);
eq('单月 12 次解锁月度活跃', get(b.evaluate(b.buildMetrics({ monthCount: 12 }, {})), 'month_12').unlocked, true);
eq('收藏 5 个解锁收藏家', get(b.evaluate(b.buildMetrics({}, { favCount: 5 })), 'fav_5').unlocked, true);
eq('收藏 4 个不解锁', get(b.evaluate(b.buildMetrics({}, { favCount: 4 })), 'fav_5').unlocked, false);

// 脏指标不能抛错，一律当 0
const dirtyList = b.evaluate({
  hasProfile: 'yes', totalCheckins: null, bestStreak: undefined,
  totalMin: 'abc', totalSets: -5, monthCount: NaN, favCount: Infinity
});
eq('脏指标不抛错且视为未解锁（除布尔真值）', dirtyList.filter((x) => x.unlocked).map((x) => x.id).join(','), 'profile_done');
eq('负值当 0', get(dirtyList, 'sets_1000').percent, 0);
eq('Infinity 当 0', get(dirtyList, 'month_12').percent, 0);

// 数字字符串可解析
eq('指标为数字字符串可解析', get(b.evaluate(b.buildMetrics({ totalCheckins: '50' }, {})), 'checkin_50').unlocked, true);

// null / undefined 入参
eq('evaluate(null) 不抛错', b.evaluate(null).length, b.TOTAL);
eq('evaluate(undefined) 不抛错', b.evaluate(undefined).length, b.TOTAL);

// ================= C. 高水位 =================
section('C. 高水位：累计指标只增不减');

clearStore();
const t0 = 1700000000000;
let res = b.sync(b.buildMetrics({ totalCheckins: 100, bestStreak: 30, totalMin: 3000, totalSets: 1000, monthCount: 12 }, { hasProfile: true, favCount: 5 }), t0);
eq('满指标：13 枚全解锁', res.unlockedCount, b.TOTAL);
eq('全解锁后没有「下一个目标」', res.next, null);

// 关键回归：统计窗口滑动 / 换设备后指标归零，已解锁的不能掉
const res2 = b.sync(zeroMetrics(), t0 + 1000);
eq('指标归零后仍保持全解锁', res2.unlockedCount, b.TOTAL);
eq('指标归零后不产生新解锁', res2.newlyUnlocked.length, 0);
eq('高水位保留了历史最大值', res2.hwm.totalCheckins, 100);
eq('高水位保留 bestStreak', res2.hwm.bestStreak, 30);
eq('高水位里建档保持为 1', res2.hwm.hasProfile, 1);

// 高水位只增不减
const res3 = b.sync(b.buildMetrics({ totalCheckins: 40 }, {}), t0 + 2000);
eq('传入更小值不会降低高水位', res3.hwm.totalCheckins, 100);
const res4 = b.sync(b.buildMetrics({ totalCheckins: 150 }, {}), t0 + 3000);
eq('传入更大值会抬高水位', res4.hwm.totalCheckins, 150);

// 部分指标归零时，只有该指标相关的徽章受影响（这里高水位兜住了，所以不掉）
clearStore();
b.sync(b.buildMetrics({ totalCheckins: 10 }, { favCount: 5 }), t0);
// 10 ≥ 1 所以「迈出第一步」也一并解锁：预期 3 枚（先打卡 / 10 次 / 收藏家）
eq('先解锁 3 枚（含首次打卡）', b.unlockedCount(), 3);
const partial = b.sync(zeroMetrics(), t0 + 1);
eq('归零后仍是 3 枚', partial.unlockedCount, 3);
eq('高水位中 favCount 保留', partial.hwm.favCount, 5);

// ================= D. sync 与新解锁提示 =================
section('D. sync 与新解锁记录');

clearStore();
res = b.sync(b.buildMetrics({ totalCheckins: 0 }, {}), t0);
eq('首帧无解锁', res.newlyUnlocked.length, 0);
eq('首帧 unlockedCount 为 0', res.unlockedCount, 0);
ok('首帧有下一个目标', !!res.next);

res = b.sync(b.buildMetrics({ totalCheckins: 1 }, {}), t0 + 5000);
eq('首次打卡产生一次新解锁', res.newlyUnlocked.join(','), 'first_checkin');
eq('新解锁的 isNew 为 true', get(res.list, 'first_checkin').isNew, true);
eq('新解锁记录时间戳', get(res.list, 'first_checkin').unlockedAt, t0 + 5000);

const res5 = b.sync(b.buildMetrics({ totalCheckins: 1 }, {}), t0 + 6000);
eq('同样指标再同步：不重复报新解锁', res5.newlyUnlocked.length, 0);
eq('已解锁徽章 isNew 归位为 false', get(res5.list, 'first_checkin').isNew, false);
eq('解锁时间保持不变', get(res5.list, 'first_checkin').unlockedAt, t0 + 5000);

// 一次跨多枚
clearStore();
res = b.sync(b.buildMetrics({ totalCheckins: 50, bestStreak: 7 }, { hasProfile: true }), t0);
eq('一次可同时解锁多枚', res.newlyUnlocked.length >= 5, true);
ok('新解锁列表不含重复', new Set(res.newlyUnlocked).size === res.newlyUnlocked.length);
eq('unlockedCount 与新解锁数量一致', res.unlockedCount, res.newlyUnlocked.length);

// next：进度最高的未解锁
clearStore();
res = b.sync(b.buildMetrics({ totalCheckins: 9, bestStreak: 1 }, {}), t0);
eq('下一个目标是进度最高的未解锁', res.next.id, 'checkin_10');
eq('下一个目标进度文案', res.next.remainText, '还差 1 次');

// 时间戳异常回退到当前时间
clearStore();
const now0 = Date.now();
res = b.sync(b.buildMetrics({ totalCheckins: 1 }, {}), 0);
ok('now=0 时回退到当前时间', get(res.list, 'first_checkin').unlockedAt >= now0, get(res.list, 'first_checkin').unlockedAt);
res = b.sync(b.buildMetrics({}, {}), NaN);
ok('now=NaN 不抛错', true);

// 分组结构
clearStore();
res = b.sync(b.buildMetrics({ totalCheckins: 3, bestStreak: 3, totalMin: 90, totalSets: 27, monthCount: 3 }, { hasProfile: true, favCount: 2 }), t0);
ok('groups 非空', res.groups.length > 0, res.groups.length);
eq('groups 的标题来自 GROUPS', res.groups[0].title, b.GROUPS[0]);
eq('groups 里徽章总数等于全部徽章', res.groups.reduce((n, g) => n + g.items.length, 0), b.TOTAL);
ok('groups 里没有空分组', res.groups.every((g) => g.items.length > 0));

// ================= E. 存储与异常 =================
section('E. 存储归一化与异常兜底');

eq('存储键固定', b.KEY, 'badges_v1');
eq('normalize(null) 得到空状态', JSON.stringify(b.normalize(null)), JSON.stringify({ v: 1, hwm: {}, badges: {} }));
eq('normalize 字符串', JSON.stringify(b.normalize('garbage')), JSON.stringify({ v: 1, hwm: {}, badges: {} }));
eq('normalize 数组', JSON.stringify(b.normalize([1, 2])), JSON.stringify({ v: 1, hwm: {}, badges: {} }));
eq('normalize 空对象', JSON.stringify(b.normalize({})), JSON.stringify({ v: 1, hwm: {}, badges: {} }));

const norm = b.normalize({
  hwm: { totalCheckins: 100, bad: 'x', neg: -3 },
  badges: { first_checkin: 123, zero: 0, bad: 'y' }
});
eq('hwm 保留合法数字', norm.hwm.totalCheckins, 100);
eq('hwm 丢弃非数字', 'bad' in norm.hwm, false);
eq('hwm 丢弃负数', 'neg' in norm.hwm, false);
eq('badges 保留合法时间戳', norm.badges.first_checkin, 123);
eq('badges 丢弃 0', 'zero' in norm.badges, false);
eq('badges 丢弃非数字', 'bad' in norm.badges, false);

// storage 里的脏数据不影响判定
clearStore();
storeMap[b.KEY] = 'not-an-object';
eq('脏存储下 unlockedCount 为 0', b.unlockedCount(), 0);
eq('脏存储下 unlockedAt 为 0', b.unlockedAt('first_checkin'), 0);
res = b.sync(b.buildMetrics({ totalCheckins: 1 }, {}), t0);
eq('脏存储可被一次同步覆盖', res.unlockedCount, 1);

// 读取抛错
clearStore();
resetFaults();
faults.get = true;
eq('getStorageSync 抛错 → unlockedCount 为 0', b.unlockedCount(), 0);
eq('getStorageSync 抛错 → unlockedAt 为 0', b.unlockedAt('x'), 0);
res = b.sync(b.buildMetrics({ totalCheckins: 1 }, {}), t0);
eq('getStorageSync 抛错 → sync 仍能算出结果', res.unlockedCount, 1);
resetFaults();

// 写入抛错
faults.set = true;
let threw = false;
let res6 = null;
try { res6 = b.sync(b.buildMetrics({ totalCheckins: 1 }, {}), t0); } catch (e) { threw = true; }
ok('setStorageSync 抛错不向外抛', threw === false);
ok('setStorageSync 抛错仍返回判定结果', res6 && res6.unlockedCount === 1, res6 && res6.unlockedCount);
resetFaults();

// 删除抛错
faults.remove = true;
eq('removeStorageSync 抛错 → reset 返回 false', b.reset(), false);
resetFaults();

// ================= F. 工具函数 =================
section('F. 工具函数');

const merged = b.buildMetrics({ totalCheckins: 10, bestStreak: 3 }, { hasProfile: 1, favCount: 2 });
eq('buildMetrics 合并训练指标', merged.totalCheckins, 10);
eq('buildMetrics 合并最佳连续', merged.bestStreak, 3);
eq('buildMetrics 布尔化 hasProfile', merged.hasProfile, true);
eq('buildMetrics 合并本地收藏数', merged.favCount, 2);
eq('buildMetrics 缺失项补 0', merged.totalMin, 0);
eq('buildMetrics 负数补 0', b.buildMetrics({ totalMin: -9 }, {}).totalMin, 0);
eq('buildMetrics null 入参不抛错', b.buildMetrics(null, null).totalCheckins, 0);
eq('buildMetrics 数字字符串可解析', b.buildMetrics({ totalSets: '88' }, {}).totalSets, 88);
eq('未传 hasProfile 时为 false', b.buildMetrics({}, {}).hasProfile, false);

eq('groupList 空列表返回空数组', b.groupList([]).length, 0);
// evaluate 返回全部徽章（含未解锁），所以分组是齐全的
const allGroups = b.groupList(b.evaluate({ hasProfile: true }));
eq('groupList 覆盖全部分组', allGroups.length, b.GROUPS.length);
eq('groupList 保留分组标题', allGroups[0].title, b.GROUPS[0]);
// 只给一份子集时必须把空分组过滤掉（否则页面会渲染空卡片）
const subset = b.evaluate({ hasProfile: true }).filter((x) => x.group === '起步');
const oneGroup = b.groupList(subset);
eq('groupList 过滤掉没有徽章的分组', oneGroup.length, 1);
eq('groupList 过滤后仍是起步组', oneGroup[0].title, '起步');

eq('nextBadge 空列表返回 null', b.nextBadge([]), null);
eq('nextBadge 全部解锁返回 null', b.nextBadge(b.evaluate({ hasProfile: true, totalCheckins: 100, bestStreak: 30, totalMin: 3000, totalSets: 1000, monthCount: 12 }, { totalCheckins: 100, bestStreak: 30, totalMin: 3000, totalSets: 1000, monthCount: 12, hasProfile: 1, favCount: 5 })), null);

clearStore();
eq('reset 后 unlockedCount 为 0', b.sync(b.buildMetrics({ totalCheckins: 5 }, {}), t0) && b.reset() === true && b.unlockedCount() === 0, true);

clearStore();
b.sync(b.buildMetrics({ totalCheckins: 5 }, { favCount: 5 }), t0);
eq('unlockedIds 按定义顺序返回', b.unlockedIds().join(','), 'first_checkin,fav_5');
eq('unlockedAt 可读', b.unlockedAt('first_checkin'), t0);
eq('unlockedAt 未知 id 返回 0', b.unlockedAt('nope'), 0);

clearStore();
resetFaults();

// ---------- 输出 ----------
console.log(`\n================ 结果：${pass} 通过 / ${fail} 失败 ================\n`);
if (fail > 0) process.exit(1);
