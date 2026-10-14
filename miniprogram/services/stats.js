// services/stats.js — 训练数据聚合（V0.5 数据看板）
// 说明：MVP 阶段数据量小（每人一年最多几百条），聚合放在客户端完成；
// 后续数据量大时再把计算下沉到云函数（可复用本文件的纯函数）
const workoutService = require('./workout.js');

// ---------- 日期工具（本地时区，避免 UTC 跨天）----------
function pad(n) {
  return String(n).padStart(2, '0');
}

function fmt(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parse(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayStr() {
  return fmt(new Date());
}

// 本周周一（周一为一周起点，符合国内习惯）
function startOfWeek(dateStr) {
  const d = parse(dateStr);
  const weekday = (d.getDay() + 6) % 7; // 周一=0 … 周日=6
  d.setDate(d.getDate() - weekday);
  return fmt(d);
}

function addDays(dateStr, delta) {
  const d = parse(dateStr);
  d.setDate(d.getDate() + delta);
  return fmt(d);
}

// ---------- 记录处理 ----------
// 单条记录的完成组数与训练容量（重量×次数）
function sumSets(log) {
  let sets = 0;
  let volume = 0;
  (log.exercises || []).forEach((ex) => {
    const reps = Number(ex.reps) || 0;
    (ex.sets || []).forEach((s) => {
      if (!s || !s.done) return;
      sets += 1;
      volume += (Number(s.weightKg) || 0) * reps;
    });
  });
  return { sets, volume };
}

// 连续打卡天数（今天没打卡但昨天打了，从昨天往前算）
function calcStreak(dateSet) {
  const today = todayStr();
  let cursor = dateSet.has(today) ? today : addDays(today, -1);
  if (!dateSet.has(cursor)) return 0;
  let streak = 0;
  while (dateSet.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

// 历史最长连续打卡天数（徽章用）
// 与 calcStreak 的区别：calcStreak 是「当前」连续，今天断掉就归零；
// 徽章需要的是「曾经达成过」，否则用户第 8 天没练，「坚持一周」会当场消失。
function calcBestStreak(dateSet) {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const dates = Array.from(dateSet || []).filter((d) => DATE_RE.test(String(d))).sort();
  if (!dates.length) return 0;
  let best = 1;
  let cur = 1;
  for (let i = 1; i < dates.length; i++) {
    if (addDays(dates[i - 1], 1) === dates[i]) cur += 1;
    else cur = 1;
    if (cur > best) best = cur;
  }
  return best;
}

// 拉近 N 天的记录（按 date 升序）
// 看板一次加载要算概览/趋势/日历/最近记录，共用同一批原始记录：
// 加一层 30s 缓存，把「一次进页面 4 次云查询」压到 1~2 次；打卡后由 workout 广播失效。
const LOG_TTL = 30000;
const _logCache = new Map();

function listLogs(days = 365) {
  const key = String(days);
  const hit = _logCache.get(key);
  if (hit && Date.now() - hit.t < LOG_TTL) return hit.p;
  const p = _rawListLogs(days);
  _logCache.set(key, { t: Date.now(), p });
  p.catch(() => _logCache.delete(key)); // 失败不缓存，下次重试
  return p;
}

async function _rawListLogs(days) {
  const end = todayStr();
  const start = addDays(end, -(days - 1));
  const logs = await workoutService.listLogsByRange(start, end);
  return (logs || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
}

// 手动清空（下拉刷新用）
function invalidateCache() {
  _logCache.clear();
}

// 打卡 / 改数据后自动失效
workoutService.onInvalidate(() => invalidateCache());

// ---------- 概览 ----------
async function getOverview() {
  const logs = await listLogs(365);
  const dateSet = new Set(logs.map((l) => l.date));

  let totalMin = 0;
  let totalSets = 0;
  let totalVolume = 0;
  logs.forEach((log) => {
    totalMin += Number(log.durationMin) || 0;
    const s = sumSets(log);
    totalSets += s.sets;
    totalVolume += s.volume;
  });

  const monthPrefix = todayStr().slice(0, 7); // YYYY-MM
  const monthCount = logs.filter((l) => String(l.date).slice(0, 7) === monthPrefix).length;

  return {
    totalCheckins: logs.length,
    streak: calcStreak(dateSet),
    bestStreak: calcBestStreak(dateSet),
    monthCount,
    totalMin,
    totalSets,
    totalVolume: Math.round(totalVolume),
    // 平均单次时长（分钟）
    avgMin: logs.length ? Math.round(totalMin / logs.length) : 0
  };
}

// ---------- 首页概览 ----------
// 训练首页只要「连续天数 + 本周进度」，不该为了这点数字再打一次云请求：
// 直接复用 listLogs(365) 的 30s 缓存（和看板共用同一批数据），进首页 0 次额外查询。
// 本周口径 = 自然周（周一 → 今天），不再用「滚动近 7 天」冒充本周。
async function getHomeSummary() {
  const logs = await listLogs(365);
  const dateSet = new Set(logs.map((l) => l.date));

  const today = todayStr();
  const weekStart = startOfWeek(today);

  const weekDates = [];
  let weekMin = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    if (d > today) break; // 本周还没到的日子不参与统计
    if (dateSet.has(d)) weekDates.push(d);
  }
  logs.forEach((l) => {
    if (l.date >= weekStart && l.date <= today) weekMin += Number(l.durationMin) || 0;
  });

  return {
    streak: calcStreak(dateSet),
    totalCheckins: logs.length,
    weekDates,
    weekCount: weekDates.length,
    weekMin,
    weekStart,
    todayChecked: dateSet.has(today)
  };
}

// ---------- 徽章指标 ----------
// 与 getOverview 完全同源（都走 listLogs(365) 的 30s 缓存），
// 所以「首页已经加载过 → 徽章判定 0 次额外云查询」。
async function getBadgeStats() {
  const o = await getOverview();
  return {
    totalCheckins: o.totalCheckins,
    bestStreak: o.bestStreak,
    totalMin: o.totalMin,
    totalSets: o.totalSets,
    monthCount: o.monthCount
  };
}

// ---------- 近 8 周趋势 ----------
async function getWeeklyTrend(weekCount = 8) {
  const logs = await listLogs(weekCount * 7);
  const countMap = new Map();
  logs.forEach((l) => countMap.set(l.date, (countMap.get(l.date) || 0) + 1));

  const today = todayStr();
  const weeks = [];
  for (let i = weekCount - 1; i >= 0; i--) {
    const start = addDays(startOfWeek(today), -7 * i);
    let count = 0;
    for (let k = 0; k < 7; k++) {
      count += countMap.get(addDays(start, k)) || 0;
    }
    weeks.push({
      start,
      label: `${Number(start.slice(5, 7))}/${Number(start.slice(8, 10))}`,
      count
    });
  }
  const maxCount = Math.max(1, ...weeks.map((w) => w.count));
  return { weeks, maxCount };
}

// ---------- 月打卡日历 ----------
async function getCalendar(year, month) {
  const logs = await listLogs(365);
  const dateSet = new Set(logs.map((l) => l.date));

  const first = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // 周一开头需要补几个空格
  const today = todayStr();

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${pad(month)}-${pad(d)}`;
    cells.push({
      day: d,
      date,
      checked: dateSet.has(date),
      isToday: date === today
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const monthCount = Array.from(dateSet).filter((d) => String(d).slice(0, 7) === `${year}-${pad(month)}`).length;
  return { year, month, weeks, monthCount };
}

// ---------- 打卡热力图（GitHub 贡献图样式，近 N 周）----------
// 颜色分级按当天训练分钟数：<20 / <40 / <60 / ≥60 分钟
const HEAT_THRESHOLDS = [20, 40, 60];

function heatLevel(minutes) {
  const m = Number(minutes) || 0;
  if (m <= 0) return 0;
  for (let i = 0; i < HEAT_THRESHOLDS.length; i++) {
    if (m < HEAT_THRESHOLDS[i]) return i + 1;
  }
  return 4;
}

// 「M月D日」
function cnDate(dateStr) {
  return `${Number(dateStr.slice(5, 7))}月${Number(dateStr.slice(8, 10))}日`;
}

async function getHeatmap(weekCount = 17) {
  const today = todayStr();
  // 列 = 周（周一为起点），行 = 周一…周日
  const start = addDays(startOfWeek(today), -7 * (weekCount - 1));
  const logs = await listLogs(weekCount * 7);

  // 同一天可能有多条记录（补打卡）→ 按天聚合
  const agg = new Map();
  logs.forEach((log) => {
    const date = log.date;
    if (date < start || date > today) return;
    const cur = agg.get(date) || { minutes: 0, count: 0, sets: 0, volume: 0 };
    cur.minutes += Number(log.durationMin) || 0;
    cur.count += 1;
    const s = sumSets(log);
    cur.sets += s.sets;
    cur.volume += s.volume;
    agg.set(date, cur);
  });

  const weeks = [];
  const monthRow = [];   // 与列对齐的月份标签（空字符串表示该列不显示）
  let activeDays = 0;
  let totalMin = 0;
  let lastMonth = -1;

  for (let w = 0; w < weekCount; w++) {
    const cells = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d);
      const hit = agg.get(date);
      const isToday = date === today;
      if (hit) {
        activeDays += 1;
        totalMin += hit.minutes;
      }
      cells.push({
        date,
        day: Number(date.slice(8, 10)),
        minutes: hit ? hit.minutes : 0,
        count: hit ? hit.count : 0,
        sets: hit ? hit.sets : 0,
        volume: hit ? Math.round(hit.volume) : 0,
        level: hit ? heatLevel(hit.minutes) : 0,
        trained: !!hit,
        isToday,
        future: date > today // 本周未到来的日子，置灰不可点
      });
    }
    // 该列首日进入新月份时打标签（和 GitHub 贡献图一致）
    const m = Number(cells[0].date.slice(5, 7));
    monthRow.push(m === lastMonth ? '' : `${m}月`);
    lastMonth = m;
    // 列做成对象：id 供 wx:key 使用，cells 是周一到周日 7 格
    weeks.push({ id: `w${w}`, start: cells[0].date, month: m, cells });
  }

  return {
    weeks,
    monthRow,
    weekCount,
    activeDays,
    totalMin,
    startLabel: cnDate(start),
    endLabel: cnDate(today),
    // 有训练的天数占比（用于副标题）
    activeRate: Math.round((activeDays / (weekCount * 7)) * 100)
  };
}

// ---------- 最近训练记录 ----------
async function getRecentLogs(limit = 10) {
  const logs = await listLogs(365);
  return logs
    .slice()
    .reverse()
    .slice(0, limit)
    .map((log) => {
      const s = sumSets(log);
      return {
        _id: log._id,
        date: log.date,
        focus: log.focus || '训练',
        durationMin: Number(log.durationMin) || 0,
        exerciseCount: (log.exercises || []).length,
        doneSets: s.sets,
        volume: Math.round(s.volume)
      };
    });
}

// 按 _id 取单条训练记录（记录详情页用）
// 复用 listLogs(365) 的 30s 缓存 → 从看板点进来时 0 次额外云查询。
// 注意：只覆盖最近一年，更早的记录返回 null（由页面显示「记录不存在或已超过一年」）
async function getLogById(id) {
  if (!id) return null;
  const logs = await listLogs(365);
  return logs.find((l) => l._id === id) || null;
}

module.exports = {
  getOverview,
  getHomeSummary,
  getBadgeStats,
  getWeeklyTrend,
  getCalendar,
  getHeatmap,
  getRecentLogs,
  getLogById,
  invalidateCache,
  // 原始记录列表（带 exercises 明细、限一年内、30s 缓存）。
  // 渐进超负荷建议与记录详情都要按动作/日期翻历史，共用这一份缓存，
  // 不要各自去查库——否则同一个页面上会出现两种口径的历史。
  listLogs,
  // 单条记录的组数/容量聚合：看板汇总与「打卡结算卡」共用同一份口径，
  // 否则同一个数字会在两个页面对不上（统计口径只能有一个真源）
  sumSets,
  // 纯函数导出，方便单测
  _internal: { fmt, parse, todayStr, startOfWeek, addDays, sumSets, calcStreak, calcBestStreak, heatLevel, cnDate }
};
