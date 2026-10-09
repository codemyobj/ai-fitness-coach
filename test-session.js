/**
 * test-session.js — 「今天该练哪一节」+ 周目标进度 单测（离线运行）
 *
 * 这个模块是修 bug 的产物：训练首页原来把 week=%d&day=1 写死，
 * 用户练到第 3 周还是永远进第 1 周第 1 天。规则一旦写错，只有真机点到才发现，
 * 所以用测试把边界钉死：周次推进、本周节次、越界回退、无计划、跨月跨年。
 */
const path = require('path');
const MINIPROGRAM = path.resolve(__dirname, 'miniprogram');
const session = require(path.join(MINIPROGRAM, 'services/session.js'));

const passed = [];
const failed = [];
function ok(name, cond, detail) {
  if (cond) passed.push(name);
  else failed.push(`${name}${detail ? ' → ' + detail : ''}`);
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `期望 ${expected}，实际 ${actual}`);
}

// ---------- 构造计划 ----------
// 4 周 × 每周 3 天，每天 2 个动作（结构和云函数产出的计划一致）
function makePlan(opts) {
  const o = opts || {};
  const weeks = o.weeks === undefined ? 4 : o.weeks;
  const daysPerWeek = o.daysPerWeek === undefined ? 3 : o.daysPerWeek;
  const structure = [];
  for (let w = 1; w <= weeks; w++) {
    const days = [];
    for (let d = 1; d <= daysPerWeek; d++) {
      days.push({
        dayIndex: o.oddDayIndex ? w * 10 + d : d,
        focus: `第${w}周-第${d}节`,
        exercises: o.emptyExercises ? [] : [
          { exerciseId: 'pushup', name: '标准俯卧撑', sets: 3, reps: 12 },
          { exerciseId: 'squat', name: '徒手深蹲', sets: 3, reps: 12 }
        ]
      });
    }
    structure.push({ weekIndex: w, focus: `第${w}周`, days });
  }
  return { _id: 'plan-1', planName: '减脂塑形 · 4 周计划', weeks, daysPerWeek, structure };
}

// ============================================================
// 1. clampInt
// ============================================================
eq('clampInt 正常夹取', session.clampInt(5, 1, 7, 3), 5);
eq('clampInt 超上限', session.clampInt(99, 1, 7, 3), 7);
eq('clampInt 低于下限', session.clampInt(-4, 0, 7, 3), 0);
eq('clampInt 小数四舍五入', session.clampInt(3.6, 0, 9, 0), 4);
eq('clampInt NaN 用回退值', session.clampInt(NaN, 0, 9, 3), 3);
eq('clampInt 非数字用回退值', session.clampInt('abc', 0, 9, 3), 3);
eq('clampInt null 用回退值（不能当成 0）', session.clampInt(null, 0, 9, 3), 3);
eq('clampInt undefined 用回退值', session.clampInt(undefined, 1, 7, 3), 3);
eq('clampInt 空串用回退值（Number("") 是 0，会静默变成 0 天）', session.clampInt('', 0, 9, 3), 3);
eq('clampInt 纯空格串用回退值', session.clampInt('   ', 0, 9, 3), 3);
eq('clampInt 布尔值用回退值', session.clampInt(true, 0, 9, 3), 3);
eq('clampInt 数组用回退值（Number([]) 是 0）', session.clampInt([], 0, 9, 3), 3);
eq('clampInt 数字 0 是有效值，不被当成缺失', session.clampInt(0, 0, 9, 3), 0);
eq('clampInt 数字字符串可解析', session.clampInt('4', 1, 7, 3), 4);

// ============================================================
// 2. 日期工具
// ============================================================
eq('fmtDate 补零', session.fmtDate(new Date(2026, 0, 5)), '2026-01-05');
eq('fmtDate 非法日期返回空串', session.fmtDate('不是日期'), '');
eq('cnDateTitle 星期四', session.cnDateTitle(new Date(2026, 9, 8)), '2026年10月8日 星期四');
eq('cnDateTitle 星期日', session.cnDateTitle(new Date(2026, 2, 1)), '2026年3月1日 星期日');
eq('cnDateTitle 非法返回空串', session.cnDateTitle('x'), '');

eq('mondayOf 周四 → 本周一', session.fmtDate(session.mondayOf(new Date(2026, 9, 8))), '2026-10-05');
eq('mondayOf 周日 → 上一个周一（周一为一周起点）', session.fmtDate(session.mondayOf(new Date(2026, 9, 4))), '2026-09-28');
eq('mondayOf 周一本身不变', session.fmtDate(session.mondayOf(new Date(2026, 9, 5))), '2026-10-05');
eq('mondayOf 跨年（2026-01-01 周四 → 2025-12-29）', session.fmtDate(session.mondayOf(new Date(2026, 0, 1))), '2025-12-29');

// ============================================================
// 3. 计划结构归一
// ============================================================
eq('每周天数取计划字段', session.normalizeDaysPerWeek(makePlan({ daysPerWeek: 5 })), 5);
eq('每周天数越界被夹到 7', session.normalizeDaysPerWeek(makePlan({ daysPerWeek: 12 })), 7);
eq('每周天数 0 时回退到第一周实际天数', session.normalizeDaysPerWeek(Object.assign(makePlan({ daysPerWeek: 3 }), { daysPerWeek: 0 })), 3);
eq('没有 daysPerWeek 字段时用第一周天数', session.normalizeDaysPerWeek({ structure: [{ days: [1, 2, 3, 4] }] }), 4);
eq('空计划回退到 3 天', session.normalizeDaysPerWeek(null), 3);
eq('结构异常也回退到 3 天', session.normalizeDaysPerWeek({ structure: 'oops' }), 3);
eq('daysPerWeek 是字符串也能认', session.normalizeDaysPerWeek({ daysPerWeek: '4', structure: [] }), 4);

eq('总周数取 structure 长度', session.totalWeeksOf(makePlan({ weeks: 6 })), 6);
eq('没有 structure 时用 weeks 字段', session.totalWeeksOf({ weeks: 8, structure: [] }), 8);
eq('都没有时默认 4 周', session.totalWeeksOf({}), 4);
eq('总周数最少 1 周', session.totalWeeksOf({ weeks: 0, structure: [] }), 1);

// ============================================================
// 4. 周次推进 / 本周节次
// ============================================================
eq('0 次打卡 → 第 1 周', session.weekIndexOf(0, 3, 4), 0);
eq('练满 3 次 → 第 2 周', session.weekIndexOf(3, 3, 4), 1);
eq('练 8 次 → 第 3 周', session.weekIndexOf(8, 3, 4), 2);
eq('练 11 次 → 第 4 周', session.weekIndexOf(11, 3, 4), 3);
eq('练超总周数 → 停在最后一周', session.weekIndexOf(999, 3, 4), 3);
eq('每周 1 天时按 1 次推进', session.weekIndexOf(2, 1, 4), 2);
// 总周数传 0（脏数据）时会被夹成 1 周，于是周次只能是第 1 周，不会越界
eq('总周数传 0 → 只有 1 周，周次夹在 0', session.weekIndexOf(5, 3, 0), 0);
eq('打卡次数非法按 0 算', session.weekIndexOf(NaN, 3, 4), 0);
eq('打卡次数为负按 0 算', session.weekIndexOf(-5, 3, 4), 0);

eq('0 次 → 第 1 节', session.dayIndexOf(0, 3), 1);
eq('1 次 → 第 2 节', session.dayIndexOf(1, 3), 2);
eq('2 次 → 第 3 节', session.dayIndexOf(2, 3), 3);
// 关键：练满一节就推进一节，不按「本周日历打卡数」重置
eq('3 次（练满一周）→ 回到第 1 节（进入下一周）', session.dayIndexOf(3, 3), 1);
eq('4 次 → 第 2 节', session.dayIndexOf(4, 3), 2);
eq('5 次 → 第 3 节', session.dayIndexOf(5, 3), 3);
eq('每周 1 天 → 永远第 1 节', session.dayIndexOf(3, 1), 1);
eq('每周 7 天 → 7 次后回到第 1 节', session.dayIndexOf(7, 7), 1);
eq('每周 7 天 → 第 8 节对应第 2 周第 1 节（周次另算）', session.weekIndexOf(7, 7, 4), 1);
eq('单周计划练满后循环回第 1 节', session.dayIndexOf(1, 1), 1);
eq('课次非法按 0 算', session.dayIndexOf(NaN, 3), 1);

// ============================================================
// 5. resolveToday
// ============================================================
{
  const none = session.resolveToday({ plan: null, weekCount: 0, totalCheckins: 0 });
  eq('无计划 → ready=false', none.ready, false);
  eq('无计划 → 给出原因', none.reason, '还没有训练计划');
  eq('无计划 → 每周天数仍回退为 3', none.daysPerWeek, 3);

  const broken = session.resolveToday({ plan: { structure: [] }, weekCount: 0, totalCheckins: 0 });
  eq('structure 为空 → ready=false', broken.ready, false);
  eq('structure 非数组 → ready=false', session.resolveToday({ plan: { structure: 'x' }, weekCount: 0, totalCheckins: 0 }).ready, false);

  const day1 = session.resolveToday({ plan: makePlan(), weekCount: 0, totalCheckins: 0 });
  eq('全新用户 → ready', day1.ready, true);
  eq('全新用户 → 第 1 周', day1.weekNumber, 1);
  eq('全新用户 → 第 1 节', day1.dayNumber, 1);
  eq('全新用户 → 周内第 1 天（URL 用）', day1.dayIndex, 1);
  eq('全新用户 → 带出该节 focus', day1.focus, '第1周-第1节');
  eq('全新用户 → 动作数', day1.exerciseCount, 2);
  eq('全新用户 → 总周数', day1.totalWeeks, 4);
  eq('全新用户 → 本周未达标', day1.weekDone, false);
  eq('全新用户 → 今日未打卡', day1.todayChecked, false);

  const mid = session.resolveToday({ plan: makePlan(), weekCount: 2, totalCheckins: 2 });
  eq('练了 2 节 → 今天第 3 节', mid.dayNumber, 3);
  eq('练了 2 节 → 还在第 1 周', mid.weekNumber, 1);
  eq('练了 2 节 → 带出第 3 节 focus', mid.focus, '第1周-第3节');

  const wk2 = session.resolveToday({ plan: makePlan(), weekCount: 0, totalCheckins: 3 });
  eq('累计 3 次 → 第 2 周', wk2.weekNumber, 2);
  eq('累计 3 次 → 新一周从第 1 节开始', wk2.dayNumber, 1);
  eq('第 2 周第 1 节 focus', wk2.focus, '第2周-第1节');

  // 周次和节次必须来自同一个时钟：不能出现「第 2 周第 3 节」（跳过第 2 周前两节）
  const rolled = session.resolveToday({ plan: makePlan(), weekCount: 3, totalCheckins: 3, todayChecked: true });
  eq('练满 3 节 → weekDone（本周日历目标达成）', rolled.weekDone, true);
  eq('练满 3 节 → 节次推进到下一周第 1 节', rolled.dayNumber, 1);
  eq('练满 3 节 → 周次也推进到第 2 周', rolled.weekNumber, 2);
  eq('练满 3 节 → 周次与节次不打架', rolled.focus, '第2周-第1节');
  eq('已打卡透传给页面', rolled.todayChecked, true);

  const wk2d3 = session.resolveToday({ plan: makePlan(), weekCount: 1, totalCheckins: 5 });
  eq('累计 5 次 → 第 2 周', wk2d3.weekNumber, 2);
  eq('累计 5 次 → 第 3 节', wk2d3.dayNumber, 3);
  eq('周次与节次自洽', wk2d3.focus, '第2周-第3节');

  // 越界回退：累计远超总周数
  const over = session.resolveToday({ plan: makePlan(), weekCount: 9, totalCheckins: 999, todayChecked: false });
  eq('累计超总周数 → 夹在最后一周', over.weekNumber, 4);
  ok('越界时节次仍在 1..每周天数 之间', over.dayNumber >= 1 && over.dayNumber <= 3, over.dayNumber);
  eq('越界时仍能取到动作', over.ready, true);

  // AI 计划里的 dayIndex 可能不是 1..n 的顺序值，跟练页按它定位，必须原样带出
  const odd = session.resolveToday({ plan: makePlan({ oddDayIndex: true }), weekCount: 0, totalCheckins: 0 });
  eq('优先使用计划里的 dayIndex', odd.dayIndex, 11);
  eq('dayNumber 仍按顺序数（给文案用）', odd.dayNumber, 1);

  const oddWk2 = session.resolveToday({ plan: makePlan({ oddDayIndex: true }), weekCount: 0, totalCheckins: 4 });
  eq('第 2 周的 dayIndex 也来自计划', oddWk2.dayIndex, 22);

  // 每周 1 天 / 每周 7 天
  eq('每周 1 天 → 每次都是第 1 节', session.resolveToday({ plan: makePlan({ daysPerWeek: 1 }), weekCount: 0, totalCheckins: 0 }).dayNumber, 1);
  eq('每周 7 天 → 第 8 次打卡推进到第 2 周', session.resolveToday({ plan: makePlan({ daysPerWeek: 7, weeks: 4 }), weekCount: 0, totalCheckins: 7 }).weekNumber, 2);
  eq('每周 7 天 → 第 8 次打卡回到周内第 1 节', session.resolveToday({ plan: makePlan({ daysPerWeek: 7, weeks: 4 }), weekCount: 0, totalCheckins: 7 }).dayNumber, 1);

  // 结构异常
  const noEx = session.resolveToday({ plan: makePlan({ emptyExercises: true }), weekCount: 0, totalCheckins: 0 });
  eq('该节没有动作 → ready=false', noEx.ready, false);
  ok('该节没有动作 → 提示回到训练页换一份计划', noEx.reason.indexOf('换一份计划') >= 0, noEx.reason);

  const noDays = session.resolveToday({ plan: { structure: [{ weekIndex: 1, days: [] }] }, weekCount: 0, totalCheckins: 0 });
  eq('该周没有训练日 → ready=false', noDays.ready, false);
  ok('该周没有训练日 → 提示第几周', noDays.reason.indexOf('第 1 周') >= 0, noDays.reason);

  // 参数缺省也不该抛
  const bare = session.resolveToday();
  eq('不传参数 → ready=false（不抛错）', bare.ready, false);
  const partial = session.resolveToday({ plan: makePlan(), weekCount: null, totalCheckins: undefined });
  eq('weekCount 为 null 按 0 处理', partial.dayNumber, 1);
  eq('totalCheckins 缺省按 0 处理', partial.weekNumber, 1);

  // dayIndex 缺失时回退到顺序号
  const noIdx = makePlan();
  delete noIdx.structure[0].days[0].dayIndex;
  eq('计划没给 dayIndex → 回退顺序号', session.resolveToday({ plan: noIdx, weekCount: 0, totalCheckins: 0 }).dayIndex, 1);
  const badIdx = makePlan();
  badIdx.structure[0].days[0].dayIndex = 0;
  eq('dayIndex 为 0 → 回退顺序号', session.resolveToday({ plan: badIdx, weekCount: 0, totalCheckins: 0 }).dayIndex, 1);
}

// ============================================================
// 6. weekProgress
// ============================================================
{
  const p0 = session.weekProgress(0, 3);
  eq('0/3 → 0%', p0.percent, 0);
  eq('0/3 → 文案', p0.text, '0/3');
  eq('0/3 → 未达标', p0.reached, false);

  const p1 = session.weekProgress(1, 3);
  eq('1/3 → 33%', p1.percent, 33);
  eq('1/3 → 未达标', p1.reached, false);

  const p2 = session.weekProgress(2, 3);
  eq('2/3 → 67%', p2.percent, 67);

  const p3 = session.weekProgress(3, 3);
  eq('3/3 → 100%', p3.percent, 100);
  eq('3/3 → 达标', p3.reached, true);

  const p5 = session.weekProgress(5, 3);
  eq('超额 5/3 → 百分比封顶 100', p5.percent, 100);
  eq('超额 5/3 → 数字保留真实值', p5.done, 5);
  eq('超额 5/3 → 文案 5/3', p5.text, '5/3');
  eq('超额 5/3 → 达标', p5.reached, true);

  const p0t = session.weekProgress(2, 0);
  eq('目标为 0 → 不除零，百分比 0', p0t.percent, 0);
  eq('目标为 0 → 未达标', p0t.reached, false);

  const pBad = session.weekProgress(NaN, 'x');
  eq('非法入参 → done 0', pBad.done, 0);
  eq('非法入参 → target 0', pBad.target, 0);

  eq('每日目标上限 7（不会出现 0/12 天）', session.weekProgress(3, 12).target, 7);
  eq('负数按 0 处理', session.weekProgress(-3, 3).done, 0);
}

// ============================================================
// 7. ringGradient
// ============================================================
{
  const g0 = session.ringGradient(0);
  eq('0% → 整圈底色', g0, 'conic-gradient(#e5e7eb 0deg 360deg)');
  const g100 = session.ringGradient(100);
  eq('100% → 整圈主色', g100, 'conic-gradient(#10b981 0deg 360deg)');
  const g50 = session.ringGradient(50);
  eq('50% → 180 度分界', g50, 'conic-gradient(#10b981 0deg 180deg, #e5e7eb 180deg 360deg)');
  eq('超范围按 100 处理', session.ringGradient(180), g100);
  eq('负数按 0 处理', session.ringGradient(-20), g0);
  eq('非法值按 0 处理', session.ringGradient('abc'), g0);
  eq('可以自定义颜色', session.ringGradient(50, '#ff0000', '#000000'),
    'conic-gradient(#ff0000 0deg 180deg, #000000 180deg 360deg)');
  ok('33% 的分界角是 118.8 度', session.ringGradient(33).indexOf('118.8deg') > 0, session.ringGradient(33));
}

// ============================================================
// 8. buildWeekBar
// ============================================================
{
  // 2026-10-08 是周四 → 本周一 10-05
  const base = new Date(2026, 9, 8);
  const bar = session.buildWeekBar(base, ['2026-10-06', '2026-10-08']);

  eq('周打卡条固定 7 格', bar.length, 7);
  eq('第 1 格是周一', bar[0].date, '2026-10-05');
  eq('第 1 格标签「一」', bar[0].label, '一');
  eq('第 7 格是周日', bar[6].date, '2026-10-11');
  eq('第 7 格标签「日」', bar[6].label, '日');
  eq('周一 unchecked', bar[0].checked, false);
  eq('周二 checked', bar[1].checked, true);
  eq('周四 checked', bar[3].checked, true);
  eq('今天只有一格', bar.filter((d) => d.isToday).length, 1);
  eq('今天是周四那格', bar[3].isToday, true);
  eq('今天之前不算未来', bar[2].future, false);
  eq('今天不算未来（否则点不动）', bar[3].future, false);
  eq('今天之后算未来', bar[4].future, true);
  eq('周日算未来', bar[6].future, true);
  ok('key 与 date 一致（wx:key 用）', bar.every((d) => d.key === d.date), bar.map((d) => d.key).join(','));
  ok('周一~周日标签顺序正确', bar.map((d) => d.label).join('') === '一二三四五六日', bar.map((d) => d.label).join(''));

  // 周一当天：没有"之前"的日子，今天就是第 1 格
  const mon = session.buildWeekBar(new Date(2026, 9, 5), []);
  eq('周一时今天在第 1 格', mon[0].isToday, true);
  eq('周一时除今天外都是未来', mon.filter((d) => d.future).length, 6);

  // 周日当天：本周 7 格全部不是未来
  const sun = session.buildWeekBar(new Date(2026, 9, 11), []);
  eq('周日时今天在第 7 格', sun[6].isToday, true);
  eq('周日时没有未来的格子', sun.filter((d) => d.future).length, 0);

  // 跨月：2026-03-01 是周日 → 本周一 2026-02-23
  const crossMonth = session.buildWeekBar(new Date(2026, 2, 1), []);
  eq('跨月时周一落在上个月', crossMonth[0].date, '2026-02-23');
  eq('跨月时周日落在本月', crossMonth[6].date, '2026-03-01');
  eq('跨月也能对上今天', crossMonth[6].isToday, true);

  // 跨年：2026-01-01 是周四 → 本周一 2025-12-29
  const crossYear = session.buildWeekBar(new Date(2026, 0, 1), []);
  eq('跨年时周一落在上一年', crossYear[0].date, '2025-12-29');
  eq('跨年时周日落在本年初', crossYear[6].date, '2026-01-04');

  // 脏数据
  const dirty = session.buildWeekBar(base, null);
  eq('checkedDates 传 null 不抛错', dirty.length, 7);
  eq('传 null 时全部未打卡', dirty.filter((d) => d.checked).length, 0);
  const dirty2 = session.buildWeekBar(base, 'oops');
  eq('checkedDates 传字符串不抛错', dirty2.filter((d) => d.checked).length, 0);
  const dirty3 = session.buildWeekBar(base, [null, undefined, '', '2026-10-07']);
eq('脏数组只认合法日期', dirty3.filter((d) => d.checked).length, 1);
eq('脏数组里那一格标对了', dirty3[2].checked, true);
eq('未被打卡的日期不会误标（10-06）', dirty3[1].checked, false);

  // 非法基准日期 → 用当前时间兜底，仍返回 7 格
  eq('基准日期非法仍返回 7 格', session.buildWeekBar('不是日期', []).length, 7);
  eq('基准日期缺省仍返回 7 格', session.buildWeekBar(undefined, []).length, 7);

  // 上个月/下个月的同一天不应被误命中（前缀相同但日期不同）
  const bar2 = session.buildWeekBar(base, ['2026-10-05', '2026-11-05']);
  eq('只命中本周内的日期', bar2.filter((d) => d.checked).length, 1);
}

// ---------- 输出 ----------
console.log('\n============ 今日安排 / 周进度 单测 ============\n');
passed.forEach((s) => console.log('   ✅ ' + s));
if (failed.length) {
  console.log('\n❌ 失败（' + failed.length + '）：');
  failed.forEach((s) => console.log('   · ' + s));
  console.log('\n结果：' + passed.length + ' 通过 / ' + failed.length + ' 失败\n');
  process.exit(1);
}
console.log('\n结果：' + passed.length + ' 通过 / 0 失败\n');
