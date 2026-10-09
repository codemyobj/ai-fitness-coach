/**
 * test-stats.js — 数据看板统计逻辑单测（离线运行）
 * 重点覆盖容易写错的地方：跨月日期运算、周一为周起点、连续打卡天数、
 * 训练容量（重量×次数）、日历网格对齐与补位。
 */
const path = require('path');
const MINIPROGRAM = path.resolve(__dirname, 'miniprogram');

const passed = [];
const failed = [];
function ok(name, cond, detail) {
  if (cond) passed.push(name);
  else failed.push(`${name}${detail ? ' → ' + detail : ''}`);
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `期望 ${expected}，实际 ${actual}`);
}

// ---------- 构造假数据 ----------
// 以「今天」为基准造打卡记录，保证用例永远可复现
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shift(baseDate, delta) {
  const [y, m, d] = baseDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
const TODAY = today();

const fakeLogs = [
  // 今天：俯卧撑 3 组全完成（20kg×10次，其中 2 组记了重量）
  { date: TODAY, focus: '胸 / 三头', durationMin: 30, exercises: [{ exerciseId: 'pushup', name: '标准俯卧撑', reps: 10, sets: [{ done: true, weightKg: 20 }, { done: true, weightKg: 20 }, { done: true, weightKg: null }] }] },
  // 昨天：深蹲 2 组，1 组完成（自重）
  { date: shift(TODAY, -1), focus: '腿 / 臀', durationMin: 25, exercises: [{ exerciseId: 'squat', name: '徒手深蹲', reps: 12, sets: [{ done: true, weightKg: null }, { done: false, weightKg: null }] }] },
  // 前天：未完成任何组
  { date: shift(TODAY, -2), focus: '核心', durationMin: 15, exercises: [{ exerciseId: 'plank', name: '平板支撑', reps: 30, sets: [{ done: false, weightKg: null }] }] },
  // 4 天前（中间断了一天）
  { date: shift(TODAY, -4), focus: '背', durationMin: 40, exercises: [{ exerciseId: 'dumbbell_row', name: '哑铃划船', reps: 12, sets: [{ done: true, weightKg: 15 }] }] }
];

// 覆写数据源，避免依赖真实的 wx.cloud（同时统计调用次数，验证缓存）
let rangeCalls = 0;
const workoutService = require(path.join(MINIPROGRAM, 'services/workout.js'));
workoutService.listLogsByRange = async () => { rangeCalls += 1; return fakeLogs; };

const stats = require(path.join(MINIPROGRAM, 'services/stats.js'));
const { sumSets, calcStreak, calcBestStreak, addDays, startOfWeek, fmt, heatLevel, cnDate } = stats._internal;

(async () => {
  // ---------- 1. 组数与容量 ----------
  const s1 = sumSets(fakeLogs[0]);
  eq('sumSets 组数', s1.sets, 3);
  eq('sumSets 容量（20×10×2组，第3组无重量计0）', s1.volume, 400);

  const s2 = sumSets(fakeLogs[2]);
  eq('未完成组不计数', s2.sets, 0);
  eq('自重动作容量为 0', s2.volume, 0);

  // ---------- 2. 日期运算 ----------
  eq('addDays 跨月（1月1日往前一天）', addDays('2026-01-01', -1), '2025-12-31');
  eq('addDays 跨年（12月31日往后一天）', addDays('2025-12-31', 1), '2026-01-01');
  eq('addDays 闰年 2月', addDays('2024-02-28', 1), '2024-02-29');
  eq('addDays 平年 2月', addDays('2025-02-28', 1), '2025-03-01');
  // 2026-10-01 是周四 → 本周一应为 2026-09-28
  eq('startOfWeek 周一为起点', startOfWeek('2026-10-01'), '2026-09-28');
  eq('startOfWeek 周日归到上一个周一', startOfWeek('2026-10-04'), '2026-09-28');
  eq('fmt 补零', fmt(new Date(2026, 0, 5)), '2026-01-05');

  // ---------- 3. 连续打卡 ----------
  const dateSet = new Set(fakeLogs.map((l) => l.date));
  eq('连续打卡（今天+昨天+前天，第4天前断）', calcStreak(dateSet), 3);

  const noToday = new Set([shift(TODAY, -1), shift(TODAY, -2)]);
  eq('今天未打卡但昨天打了 → 从昨天算起', calcStreak(noToday), 2);

  const brokenSet = new Set([shift(TODAY, -2), shift(TODAY, -3)]);
  eq('昨天和今天都没打 → 连续为 0', calcStreak(brokenSet), 0);

  eq('空集合连续为 0', calcStreak(new Set()), 0);

  // ---------- 3b. 历史最长连续（徽章口径） ----------
  // 与 calcStreak 的关键区别：当前连续会被「今天没练」打断，最长连续不会。
  // 徽章用错口径的话，用户断一天「坚持一周」就消失了。
  const bestSet = new Set([
    shift(TODAY, -20), shift(TODAY, -19), shift(TODAY, -18), shift(TODAY, -17),
    shift(TODAY, -10),
    shift(TODAY, -2), shift(TODAY, -1)
  ]);
  eq('最长连续取历史最大段（4 天 > 2 天）', calcBestStreak(bestSet), 4);
  eq('当前连续只有 2 天', calcStreak(bestSet), 2);
  eq('空集合最长连续为 0', calcBestStreak(new Set()), 0);
  eq('单日记录最长连续为 1', calcBestStreak(new Set([TODAY])), 1);
  eq('全部连续时最长等于总数', calcBestStreak(new Set([shift(TODAY, -2), shift(TODAY, -1), TODAY])), 3);
  eq('跨月连续能正确识别', calcBestStreak(new Set(['2026-01-31', '2026-02-01'])), 2);
  eq('跨年连续能正确识别', calcBestStreak(new Set(['2025-12-31', '2026-01-01'])), 2);
  eq('闰年 2/29 连续', calcBestStreak(new Set(['2024-02-28', '2024-02-29', '2024-03-01'])), 3);
  // 脏日期不能把两段不连续的日子"接"起来
  eq('脏日期被忽略且不误连', calcBestStreak(new Set(['2026-01-01', 'garbage', '2026-06-01'])), 1);
  eq('非日期字符串集合不抛错', calcBestStreak(new Set(['a', 'b'])), 0);
  eq('传入数组也能算（内部会转）', calcBestStreak(['2026-01-01', '2026-01-02']), 2);
  eq('calcBestStreak(null) 不抛错', calcBestStreak(null), 0);
  ok('最长连续 >= 当前连续', calcBestStreak(bestSet) >= calcStreak(bestSet));

  // ---------- 4. 概览 ----------
  const ov = await stats.getOverview();
  eq('累计打卡次数', ov.totalCheckins, 4);
  eq('累计时长', ov.totalMin, 110);
  eq('总组数（3+1+0+1）', ov.totalSets, 5);
  eq('总容量（400+180）', ov.totalVolume, 580);
  eq('平均时长（110/4 四舍五入）', ov.avgMin, 28);
  ok('本月次数 ≥ 1', ov.monthCount >= 1, `实际 ${ov.monthCount}`);
  eq('概览带出 bestStreak（徽章用）', ov.bestStreak, 3);

  // ---------- 4b. 徽章指标 ----------
  // 徽章判定本身在 test-badges.js；这里只钉住「指标口径与 getOverview 同源」，
  // 以及最关键的一点：**不额外打云请求**（首页已经加载过时徽章是白捡的）
  const badgeStats = await stats.getBadgeStats();
  eq('徽章指标-累计打卡次数与概览一致', badgeStats.totalCheckins, ov.totalCheckins);
  eq('徽章指标-最长连续与概览一致', badgeStats.bestStreak, ov.bestStreak);
  eq('徽章指标-累计时长与概览一致', badgeStats.totalMin, ov.totalMin);
  eq('徽章指标-累计组数与概览一致', badgeStats.totalSets, ov.totalSets);
  eq('徽章指标-单月次数与概览一致', badgeStats.monthCount, ov.monthCount);
  eq('徽章指标不含 streak（当前连续不该用于徽章）', 'streak' in badgeStats, false);

  // ---------- 5. 周趋势 ----------
  const trend = await stats.getWeeklyTrend(8);
  eq('趋势返回 8 周', trend.weeks.length, 8);
  ok('maxCount ≥ 1（避免除零）', trend.maxCount >= 1);
  ok('最后一周是本周', trend.weeks[trend.weeks.length - 1].start === startOfWeek(TODAY),
    `${trend.weeks[trend.weeks.length - 1].start} vs ${startOfWeek(TODAY)}`);
  ok('所有柱子高度不超过 100%', trend.weeks.every((w) => w.count / trend.maxCount <= 1));

  // ---------- 6. 月日历 ----------
  const [yy, mm] = TODAY.split('-').map(Number);
  const cal = await stats.getCalendar(yy, mm);
  const daysInMonth = new Date(yy, mm, 0).getDate();
  const lead = (new Date(yy, mm - 1, 1).getDay() + 6) % 7;
  const totalCells = cal.weeks.length * 7;
  ok('日历单元格数能容纳该月（含补位）', totalCells >= lead + daysInMonth, `${totalCells} < ${lead + daysInMonth}`);
  eq('补位格数正确', cal.weeks[0].filter((c) => c === null).length, lead);
  ok('今天被标记', (() => {
    let found = false;
    cal.weeks.forEach((w) => w.forEach((c) => { if (c && c.isToday) found = true; }));
    return found;
  })(), '未找到 isToday');
  ok('今天被标为已打卡', (() => {
    let found = false;
    cal.weeks.forEach((w) => w.forEach((c) => { if (c && c.isToday && c.checked) found = true; }));
    return found;
  })(), '今天未标记 checked');

  // 跨月边界：2 月（平年 28 天）
  const feb = await stats.getCalendar(2025, 2);
  ok('2025年2月只有 28 天', (() => {
    let n = 0;
    feb.weeks.forEach((w) => w.forEach((c) => { if (c) n++; }));
    return n === 28;
  })(), '天数不符');

  // ---------- 7. 最近记录 ----------
  const recent = await stats.getRecentLogs(10);
  eq('最近记录条数', recent.length, 4);
  eq('按日期倒序，第一条是今天', recent[0].date, TODAY);
  ok('包含动作数与组数', recent[0].exerciseCount === 1 && recent[0].doneSets === 3);

  // ---------- 8. 热力图 ----------
  // 分级纯函数边界
  eq('heatLevel 0 分钟 → 0', heatLevel(0), 0);
  eq('heatLevel undefined → 0', heatLevel(undefined), 0);
  eq('heatLevel 19 → 1', heatLevel(19), 1);
  eq('heatLevel 20 → 2', heatLevel(20), 2);
  eq('heatLevel 39 → 2', heatLevel(39), 2);
  eq('heatLevel 40 → 3', heatLevel(40), 3);
  eq('heatLevel 59 → 3', heatLevel(59), 3);
  eq('heatLevel 60 → 4', heatLevel(60), 4);
  eq('cnDate 格式化', cnDate('2026-10-05'), '10月5日');

  const heat = await stats.getHeatmap(17);
  const flat = heat.weeks.reduce((acc, col) => acc.concat(col.cells), []);
  const byDate = new Map(flat.map((c) => [c.date, c]));

  eq('热力图 17 列', heat.weeks.length, 17);
  ok('每列 7 格（周一到周日）', heat.weeks.every((c) => c.cells.length === 7));
  ok('每列带唯一 id（供 wx:key）', new Set(heat.weeks.map((c) => c.id)).size === 17);
  ok('列首日 = 各列第一格日期', heat.weeks.every((c) => c.start === c.cells[0].date));
  eq('总格数 = 17×7', flat.length, 119);
  eq('日期无重复', byDate.size, 119);
  ok('日期按列优先严格递增', flat.every((c, i) => i === 0 || c.date > flat[i - 1].date));

  const gridStart = addDays(startOfWeek(TODAY), -7 * 16);
  const gridEnd = addDays(startOfWeek(TODAY), 6);
  eq('首格 = 本周一往前 16 周', flat[0].date, gridStart);
  eq('末格 = 本周日', flat[118].date, gridEnd);
  ok('末格覆盖到今天（不会是过去）', flat[118].date >= TODAY);

  eq('今天在网格中唯一标记', flat.filter((c) => c.isToday).length, 1);
  ok('future 标记 = 日期晚于今天', flat.every((c) => c.future === (c.date > TODAY)));
  ok('未来格子无训练数据', flat.filter((c) => c.future).every((c) => !c.trained && c.level === 0));

  eq('活跃天数（4 天有训练）', heat.activeDays, 4);
  eq('窗口内总分钟', heat.totalMin, 110);
  ok('活跃率在 0~100 之间', heat.activeRate >= 0 && heat.activeRate <= 100);

  // 分级 / 聚合：今天 30 分钟、昨天 25、前天 15（未完成组）、4 天前 40
  eq('今天 level（30 分钟 → 2）', byDate.get(TODAY).level, 2);
  eq('昨天 level（25 分钟 → 2）', byDate.get(shift(TODAY, -1)).level, 2);
  eq('前天 level（15 分钟 → 1）', byDate.get(shift(TODAY, -2)).level, 1);
  eq('4 天前 level（40 分钟 → 3）', byDate.get(shift(TODAY, -4)).level, 3);
  eq('未训练日 level 0', byDate.get(shift(TODAY, -3)).level, 0);
  ok('未训练日 trained=false', byDate.get(shift(TODAY, -3)).trained === false);
  eq('当天组数聚合', byDate.get(TODAY).sets, 3);
  eq('当天容量聚合（20×10×2）', byDate.get(TODAY).volume, 400);

  eq('月份标签行与列等长', heat.monthRow.length, 17);
  ok('月份标签 4~6 个（跨约 4 个月）', (() => {
    const n = heat.monthRow.filter((t) => t).length;
    return n >= 4 && n <= 6;
  })(), heat.monthRow.join('|'));
  ok('首个标签非空', !!heat.monthRow[0]);

  const oneWeek = await stats.getHeatmap(1);
  eq('只取 1 周时 7 格', oneWeek.weeks.reduce((a, c) => a.concat(c.cells), []).length, 7);

  // ---------- 9. 聚合缓存 ----------
  stats.invalidateCache();
  rangeCalls = 0;
  await Promise.all([stats.getOverview(), stats.getCalendar(yy, mm), stats.getRecentLogs(5)]);
  eq('同一批原始记录只查一次云数据库', rangeCalls, 1);

  rangeCalls = 0;
  await stats.getOverview();
  eq('缓存命中不再查询', rangeCalls, 0);

  // 徽章与看板同源：首页加载过之后判定徽章是「白捡」的，不该多打一次
  rangeCalls = 0;
  await Promise.all([stats.getOverview(), stats.getBadgeStats()]);
  eq('概览 + 徽章指标共用一次云查询', rangeCalls, 0);

  stats.invalidateCache();
  rangeCalls = 0;
  await Promise.all([stats.getOverview(), stats.getBadgeStats()]);
  eq('缓存失效后两者仍只查一次', rangeCalls, 1);

  rangeCalls = 0;
  workoutService.invalidate(); // 模拟打卡后广播
  await stats.getOverview();
  eq('打卡后统计缓存自动失效并重查', rangeCalls, 1);

  // ---------- 10. 首页概览（自然周口径） ----------
  // 首页以前用「滚动近 7 天」却标成「本周」，跨周时数字对不上。
  // 这里以「本周一」为界构造数据：上周日的记录必须被排除。
  {
    const thisWeekStart = startOfWeek(TODAY);
    const lastWeekDay = addDays(thisWeekStart, -1); // 上周日，一定不在本周
    const homeLogs = [
      { date: TODAY, durationMin: 30, exercises: [] },
      { date: addDays(TODAY, -1), durationMin: 20, exercises: [] },
      { date: addDays(TODAY, -2), durationMin: 10, exercises: [] },
      { date: lastWeekDay, durationMin: 99, exercises: [] }
    ];
    const inWeek = homeLogs.filter((l) => l.date >= thisWeekStart && l.date <= TODAY);

    workoutService.listLogsByRange = async () => homeLogs;
    stats.invalidateCache();
    const home = await stats.getHomeSummary();

    eq('本周打卡天数只数自然周内的记录', home.weekCount, inWeek.length);
    eq('本周打卡次数与日期数组长度一致', home.weekDates.length, home.weekCount);
    ok('本周打卡日期都落在周一~今天', home.weekDates.every((d) => d >= thisWeekStart && d <= TODAY),
      home.weekDates.join(','));
    eq('上周的记录不计入本周', home.weekDates.indexOf(lastWeekDay), -1);
    eq('本周训练时长只累加本周记录（排除上周那条 99 分钟）',
      home.weekMin, inWeek.reduce((a, l) => a + l.durationMin, 0));
    eq('累计打卡次数包含历史全部记录', home.totalCheckins, homeLogs.length);
    eq('今日已打卡', home.todayChecked, true);
    eq('连续打卡按日期算（今天/昨天/前天连成 3 天）', home.streak, 3);
    eq('回传本周一日期（页面算进度用）', home.weekStart, thisWeekStart);

    // 无任何记录：全部归零，不能出现 undefined / NaN
    workoutService.listLogsByRange = async () => [];
    stats.invalidateCache();
    const empty = await stats.getHomeSummary();
    eq('无记录 → 连续 0 天', empty.streak, 0);
    eq('无记录 → 本周 0 天', empty.weekCount, 0);
    eq('无记录 → 本周时长 0', empty.weekMin, 0);
    eq('无记录 → 今日未打卡', empty.todayChecked, false);
    eq('无记录 → 累计 0 次', empty.totalCheckins, 0);
    ok('无记录 → 日期数组是空数组', Array.isArray(empty.weekDates) && empty.weekDates.length === 0);

    // 今天还没练、但昨天练过 → 首页要能区分「今天没打卡」和「完全没打卡」
    workoutService.listLogsByRange = async () => [{ date: addDays(TODAY, -1), durationMin: 25, exercises: [] }];
    stats.invalidateCache();
    const yesterday = await stats.getHomeSummary();
    eq('昨天练过 → 今日未打卡', yesterday.todayChecked, false);
    eq('昨天练过 → 连续 1 天（从昨天算起）', yesterday.streak, 1);
    eq('昨天练过 → 累计 1 次', yesterday.totalCheckins, 1);

    // 同一天多条记录（补打卡）：本周天数按「天」算，不按条数
    workoutService.listLogsByRange = async () => [
      { date: TODAY, durationMin: 20, exercises: [] },
      { date: TODAY, durationMin: 15, exercises: [] }
    ];
    stats.invalidateCache();
    const dup = await stats.getHomeSummary();
    eq('同一天两条记录 → 本周只算 1 天', dup.weekCount, 1);
    eq('同一天两条记录 → 时长照加（20+15）', dup.weekMin, 35);
    eq('同一天两条记录 → 累计次数是 2', dup.totalCheckins, 2);
    eq('同一天两条记录 → 连续仍为 1 天', dup.streak, 1);

    // 查询失败不能把首页拖成白屏：缓存不落库，重试应重新查
    workoutService.listLogsByRange = async () => { throw new Error('网络异常'); };
    stats.invalidateCache();
    let threw = false;
    try { await stats.getHomeSummary(); } catch (e) { threw = true; }
    eq('统计查询失败时向上抛错（由页面兜住转成 0）', threw, true);

    workoutService.listLogsByRange = async () => { rangeCalls += 1; return fakeLogs; };
    stats.invalidateCache();
  }


  console.log('\n============ 统计逻辑单测 ============\n');
  passed.forEach((s) => console.log('   ✅ ' + s));
  if (failed.length) {
    console.log('\n❌ 失败（' + failed.length + '）：');
    failed.forEach((s) => console.log('   · ' + s));
    console.log('\n结果：' + passed.length + ' 通过 / ' + failed.length + ' 失败\n');
    process.exit(1);
  }
  console.log('\n结果：' + passed.length + ' 通过 / 0 失败\n');
})();
