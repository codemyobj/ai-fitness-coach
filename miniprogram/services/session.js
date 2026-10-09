// services/session.js — 「今天该练哪一节」与周目标进度
//
// 全部是纯函数（不依赖 wx / 云 / storage），所以能离线单测。
// 训练首页原来把 weekIndex/dayIndex 写死成 0/1 —— 用户练到第 3 周还是永远进第 1 周第 1 天。
// 这里把「该练哪一节」的推导独立出来，规则明确、可被测试钉住：
//
//   只有一个时钟：**累计完成课次**。
//     第几周 = floor(累计课次 / 每周天数)，最多停在计划最后一周
//     周内第几节 = 累计课次 % 每周天数 + 1
//   用课次推进而不是按日历推算，是因为用户停练两周回来时不应该被直接丢到第 4 周；
//   而「本周打卡 N/目标」是另一个问题（日历周目标），由 weekProgress 单独算 —— 两者不要混。
//
// 另外提供首页要用的三个展示件：周打卡条、周目标进度、进度环渐变串。

const MIN_DAYS_PER_WEEK = 1;
const MAX_DAYS_PER_WEEK = 7;
const FALLBACK_DAYS_PER_WEEK = 3;
const FALLBACK_TOTAL_WEEKS = 4;

// 打卡条用（周一起）
const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
// 「星期X」用（周日起，跟 Date.getDay() 对齐）
const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

const RING_ON = '#10b981';
const RING_OFF = '#e5e7eb';

// ---------- 基础工具 ----------

// 整数夹取。
// 「缺失」和「0」必须区分开：Number(null) / Number('') 都是 0，
// 如果直接转换，clampInt(null, 1, 7, 3) 会返回 1（被当成用户选了 1 天），
// 而不是回退到默认的 3 —— 这类静默错值最难查，所以只接受数字和非空字符串。
function clampInt(n, min, max, fallback) {
  let num;
  if (typeof n === 'number') num = n;
  else if (typeof n === 'string' && n.trim() !== '') num = Number(n);
  else return fallback; // undefined / null / '' / 布尔 / 对象 / 数组
  if (!isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function fmtDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// 「2026年10月8日 星期四」
function cnDateTitle(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日 星期${WEEKDAY_CN[dt.getDay()]}`;
}

// 本周周一（周一为一周起点，和看板的 startOfWeek 口径一致）
function mondayOf(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const wd = (dt.getDay() + 6) % 7; // 周一 = 0
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() - wd);
}

// ---------- 计划结构归一 ----------

// 每周天数：优先用计划里存的，其次数第一周有几天，最后兜 3 天
function normalizeDaysPerWeek(plan) {
  const fromField = plan && plan.daysPerWeek;
  const explicit = Number(fromField);
  if (isFinite(explicit) && explicit > 0) {
    return clampInt(explicit, MIN_DAYS_PER_WEEK, MAX_DAYS_PER_WEEK, FALLBACK_DAYS_PER_WEEK);
  }
  const firstWeek = plan && Array.isArray(plan.structure) ? plan.structure[0] : null;
  const days = firstWeek && Array.isArray(firstWeek.days) ? firstWeek.days.length : 0;
  if (days > 0) return clampInt(days, MIN_DAYS_PER_WEEK, MAX_DAYS_PER_WEEK, FALLBACK_DAYS_PER_WEEK);
  return FALLBACK_DAYS_PER_WEEK;
}

function totalWeeksOf(plan) {
  const structure = plan && Array.isArray(plan.structure) ? plan.structure : [];
  if (structure.length) return structure.length;
  return clampInt(plan && plan.weeks, 1, 52, FALLBACK_TOTAL_WEEKS);
}

// 已完成课次 → 第几周（0 基）
function weekIndexOf(totalCheckins, daysPerWeek, totalWeeks) {
  const done = clampInt(totalCheckins, 0, 9999, 0);
  const per = clampInt(daysPerWeek, MIN_DAYS_PER_WEEK, MAX_DAYS_PER_WEEK, FALLBACK_DAYS_PER_WEEK);
  const weeks = clampInt(totalWeeks, 1, 52, FALLBACK_TOTAL_WEEKS);
  const raw = Math.floor(done / per);
  return clampInt(raw, 0, weeks - 1, 0);
}

// 本周已练 N 次 → 今天练本周第几节（1 基，且不超过每周天数）
// ⚠️ 只认「累计完成课次」这一个时钟。
// 曾经这里用「本周日历打卡数」，但周次是按累计课次推进的 —— 两个时钟会打架：
// 本周练满 3 次后周次跳到第 2 周，节次却停在第 3 节，等于跳过第 2 周前两节。
// 现在统一成：练到第 N 节课，就永远是第 floor(N/每周天数)+1 周的
// 第 N%每周天数+1 节，跨周不重置，停练几周回来也不会跳周。
function dayIndexOf(totalCheckins, daysPerWeek) {
  const done = clampInt(totalCheckins, 0, 99999, 0);
  const per = clampInt(daysPerWeek, MIN_DAYS_PER_WEEK, MAX_DAYS_PER_WEEK, FALLBACK_DAYS_PER_WEEK);
  return (done % per) + 1;
}

// 取第 weekIndex 周第 dayIndex 节（越界逐级回退，任何一层坏了都不抛）
function pickDay(plan, weekIndex, dayIndex) {
  const structure = plan && Array.isArray(plan.structure) ? plan.structure : [];
  const week = structure[weekIndex] || structure[0];
  const days = week && Array.isArray(week.days) ? week.days : [];
  if (!days.length) return null;
  return days[dayIndex - 1] || days[0] || null;
}

// ---------- 今日安排 ----------

/**
 * 推导「今天练哪一节」。
 * @param {Object} input
 * @param {Object} input.plan          生效计划（可为 null）
 * @param {Number} input.weekCount     本周（日历周）已打卡天数，只用于「本周目标是否达成」
 * @param {Number} input.totalCheckins 累计打卡次数，决定推进到第几周第几节
 * @param {Boolean} input.todayChecked 今天是否已打卡
 */
function resolveToday(input) {
  const o = input || {};
  const plan = o.plan;
  const weekCount = clampInt(o.weekCount, 0, 9999, 0);
  const daysPerWeek = normalizeDaysPerWeek(plan);
  const totalWeeks = totalWeeksOf(plan);
  const todayChecked = !!o.todayChecked;

  const empty = {
    ready: false,
    reason: '还没有训练计划',
    weekIndex: 0,
    weekNumber: 1,
    totalWeeks,
    dayIndex: 1,
    dayNumber: 1,
    daysPerWeek,
    focus: '',
    exerciseCount: 0,
    weekDone: false,
    todayChecked
  };

  if (!plan || !Array.isArray(plan.structure) || !plan.structure.length) return empty;

  const weekIndex = weekIndexOf(o.totalCheckins, daysPerWeek, totalWeeks);
  const dayNumber = dayIndexOf(o.totalCheckins, daysPerWeek);
  const day = pickDay(plan, weekIndex, dayNumber);
  if (!day) {
    return Object.assign({}, empty, {
      reason: '第 ' + (weekIndex + 1) + ' 周还没有安排训练日',
      weekIndex,
      weekNumber: weekIndex + 1,
      dayNumber
    });
  }

  const exercises = Array.isArray(day.exercises) ? day.exercises : [];
  if (!exercises.length) {
    return Object.assign({}, empty, {
      reason: '这一节还没有动作，回到训练页换一份计划',
      weekIndex,
      weekNumber: weekIndex + 1,
      dayNumber
    });
  }

  // 计划里的 dayIndex 才是跟练页认的值，缺失才退回按顺序数的序号
  const rawDayIndex = Number(day.dayIndex);
  return {
    ready: true,
    reason: '',
    weekIndex,
    weekNumber: weekIndex + 1,
    totalWeeks,
    dayIndex: isFinite(rawDayIndex) && rawDayIndex > 0 ? rawDayIndex : dayNumber,
    dayNumber,
    daysPerWeek,
    focus: day.focus || '训练',
    exerciseCount: exercises.length,
    weekDone: weekCount >= daysPerWeek,
    todayChecked
  };
}

// ---------- 周目标进度 ----------

/**
 * 本周目标完成度（给进度环 / 数字用）。
 * 超额完成时 percent 封顶 100，但 done 仍显示真实数字（练了 5 天就是 5）。
 */
function weekProgress(done, target) {
  const d = clampInt(done, 0, 999, 0);
  const t = clampInt(target, 0, MAX_DAYS_PER_WEEK, 0);
  const reached = t > 0 && d >= t;
  return {
    done: d,
    target: t,
    percent: t > 0 ? Math.min(100, Math.round((d / t) * 100)) : 0,
    reached,
    text: `${d}/${t}`
  };
}

// 进度环的 conic-gradient 串。放在 JS 里算，一是可单测，二是不用在 WXSS 里写死颜色。
// 颜色不传就用主色/分割线色；百分比非法按 0 处理。
function ringGradient(percent, onColor, offColor) {
  const p = Math.max(0, Math.min(100, isFinite(Number(percent)) ? Number(percent) : 0));
  const on = onColor || RING_ON;
  const off = offColor || RING_OFF;
  const deg = p * 3.6;
  if (deg <= 0) return `conic-gradient(${off} 0deg 360deg)`;
  if (deg >= 360) return `conic-gradient(${on} 0deg 360deg)`;
  return `conic-gradient(${on} 0deg ${deg}deg, ${off} ${deg}deg 360deg)`;
}

// ---------- 本周打卡条 ----------

/**
 * 周一到周日 7 格（含今天、未来、是否已打卡）。
 * 注意：以前首页是「滚动近 7 天」却标成「本周」，跨周时数字对不上，这里统一成自然周。
 * @param {Date}   baseDate     基准日期（一般传 new Date()）
 * @param {Array}  checkedDates 已打卡日期（YYYY-MM-DD）
 */
function buildWeekBar(baseDate, checkedDates) {
  const monday = mondayOf(baseDate instanceof Date ? baseDate : new Date());
  const today = fmtDate(baseDate instanceof Date ? baseDate : new Date());
  const checked = new Set(Array.isArray(checkedDates) ? checkedDates : []);

  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const date = fmtDate(d);
    out.push({
      key: date,
      label: WEEK_LABELS[i],
      date,
      isToday: date === today,
      future: date > today,
      checked: checked.has(date)
    });
  }
  return out;
}

module.exports = {
  MIN_DAYS_PER_WEEK,
  MAX_DAYS_PER_WEEK,
  FALLBACK_DAYS_PER_WEEK,
  WEEK_LABELS,
  WEEKDAY_CN,
  clampInt,
  fmtDate,
  cnDateTitle,
  mondayOf,
  normalizeDaysPerWeek,
  totalWeeksOf,
  weekIndexOf,
  dayIndexOf,
  pickDay,
  resolveToday,
  weekProgress,
  ringGradient,
  buildWeekBar
};
