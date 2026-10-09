/**
 * services/badges.js — 成就徽章（纯逻辑 + 本地记录）
 *
 * 设计要点：
 *
 * 1) **零云成本**。徽章不额外查任何集合，指标全部来自 stats.getOverview() 已经算好的
 *    那批数据（与看板/首页共用同一个 30s 缓存）。收藏数取本地 storage，建档状态取内存里的档案。
 *
 * 2) **高水位（high-water mark）**。累计类指标（总次数/总时长/总组数/最佳单月）如果直接
 *    拿「当前值」判定，会因为 stats 只拉最近 365 天而回退 —— 用户练了两年，窗口一滑，
 *    「累计 100 次」反而变成 40 次。所以这里对每个指标维护历史最大值，
 *    判定一律用 max(当前值, 历史最大值)；再加上「解锁记录一旦写入永不删除」，
 *    已解锁的徽章在语义上就是终身的。
 *
 * 3) **当前连续 ≠ 最长连续**。「坚持一周」必须用 bestStreak。用当前 streak 的话，
 *    用户第 8 天没练，徽章会当场消失。
 *
 * 存储：{ v: 1, hwm: { 指标: 数值 }, badges: { 徽章id: 解锁时间戳 } }，key = badges_v1。
 * 读写全部 try/catch，最坏退化成「徽章显示未解锁」，不会抛错白屏。
 */

const KEY = 'badges_v1';

// 参与高水位跟踪的指标（与 DEFS 里的 metric 字段对应）
const METRICS = ['hasProfile', 'totalCheckins', 'bestStreak', 'totalMin', 'totalSets', 'monthCount', 'favCount'];

// 分组顺序固定：从「刚开始练」到「练了很久」的心理动线
const GROUPS = ['起步', '打卡', '连续', '时长', '强度', '节奏', '探索'];

/**
 * 徽章定义。
 * metric：取自 collectMetrics 的键；target：阈值；unit：进度文案的单位；
 * boolean：该指标是「是/否」型（进度条会直接是 0% 或 100%）
 */
const DEFS = [
  { id: 'profile_done', icon: '🎯', name: '建档完成', desc: '完成身体档案，让计划更贴合你', group: '起步', metric: 'hasProfile', target: 1, unit: '', boolean: true },

  { id: 'first_checkin', icon: '🎽', name: '迈出第一步', desc: '完成第 1 次训练打卡', group: '打卡', metric: 'totalCheckins', target: 1, unit: ' 次' },
  { id: 'checkin_10', icon: '🔥', name: '进入状态', desc: '累计完成 10 次训练', group: '打卡', metric: 'totalCheckins', target: 10, unit: ' 次' },
  { id: 'checkin_50', icon: '💪', name: '训练常客', desc: '累计完成 50 次训练', group: '打卡', metric: 'totalCheckins', target: 50, unit: ' 次' },
  { id: 'checkin_100', icon: '🏅', name: '百炼成钢', desc: '累计完成 100 次训练', group: '打卡', metric: 'totalCheckins', target: 100, unit: ' 次' },

  { id: 'streak_7', icon: '📅', name: '坚持一周', desc: '连续打卡 7 天', group: '连续', metric: 'bestStreak', target: 7, unit: ' 天' },
  { id: 'streak_14', icon: '🗓', name: '半月不断', desc: '连续打卡 14 天', group: '连续', metric: 'bestStreak', target: 14, unit: ' 天' },
  { id: 'streak_30', icon: '🌙', name: '月度全勤', desc: '连续打卡 30 天', group: '连续', metric: 'bestStreak', target: 30, unit: ' 天' },

  { id: 'time_10h', icon: '⏱', name: '十小时俱乐部', desc: '累计训练 10 小时', group: '时长', metric: 'totalMin', target: 600, unit: ' 分钟' },
  { id: 'time_50h', icon: '⌛', name: '五十小时', desc: '累计训练 50 小时', group: '时长', metric: 'totalMin', target: 3000, unit: ' 分钟' },

  { id: 'sets_1000', icon: '🧱', name: '千组达成', desc: '累计完成 1000 组', group: '强度', metric: 'totalSets', target: 1000, unit: ' 组' },

  { id: 'month_12', icon: '📆', name: '月度活跃', desc: '单月打卡满 12 次', group: '节奏', metric: 'monthCount', target: 12, unit: ' 次' },

  { id: 'fav_5', icon: '⭐', name: '收藏家', desc: '收藏 5 个动作', group: '探索', metric: 'favCount', target: 5, unit: ' 个' }
];

const TOTAL = DEFS.length;
const DEF_BY_ID = {};
DEFS.forEach((d) => { DEF_BY_ID[d.id] = d; });

// ---------- 数值工具 ----------
function num(v) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return 0;
  return n;
}

function numOr(v, fallback) {
  const n = Number(v);
  return isFinite(n) && n >= 0 ? n : fallback;
}

/** 建档是布尔量，别的指标都是累计量；统一成 0/1 方便走同一套比较 */
function metricOf(metrics, key) {
  if (key === 'hasProfile') return metrics && metrics.hasProfile ? 1 : 0;
  return num(metrics && metrics[key]);
}

/**
 * 把两个来源的指标合成一份（缺项按 0 兜底）。
 * 页面侧只需要传 stats.getBadgeStats() 的结果 + 本地指标，合并规则集中在这里，避免两处漂移。
 */
function buildMetrics(totals, extra) {
  const t = totals || {};
  const e = extra || {};
  return {
    hasProfile: !!e.hasProfile,
    totalCheckins: numOr(t.totalCheckins, 0),
    bestStreak: numOr(t.bestStreak, 0),
    totalMin: numOr(t.totalMin, 0),
    totalSets: numOr(t.totalSets, 0),
    monthCount: numOr(t.monthCount, 0),
    favCount: numOr(e.favCount, 0)
  };
}

// ---------- 存储 ----------
function normalize(raw) {
  const empty = { v: 1, hwm: {}, badges: {} };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;

  const hwm = {};
  const rawHwm = (raw.hwm && typeof raw.hwm === 'object' && !Array.isArray(raw.hwm)) ? raw.hwm : {};
  Object.keys(rawHwm).forEach((k) => {
    const n = Number(rawHwm[k]);
    if (isFinite(n) && n >= 0) hwm[k] = n;
  });

  const badges = {};
  const rawBadges = (raw.badges && typeof raw.badges === 'object' && !Array.isArray(raw.badges)) ? raw.badges : {};
  Object.keys(rawBadges).forEach((k) => {
    const n = Number(rawBadges[k]);
    if (isFinite(n) && n > 0) badges[k] = n;
  });

  return { v: 1, hwm, badges };
}

function readState() {
  try {
    return normalize(wx.getStorageSync(KEY));
  } catch (e) {
    return normalize(null);
  }
}

function writeState(state) {
  try {
    wx.setStorageSync(KEY, state);
    return true;
  } catch (e) {
    // 写失败不影响本次展示，只是下次会重新判定（可能重复提示「新解锁」）
    return false;
  }
}

/** 撤回 / 重置（清空数据时用；测试用） */
function reset() {
  try {
    wx.removeStorageSync(KEY);
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- 判定 ----------
/**
 * 纯判定：给定指标与高水位，算出每枚徽章的状态。
 * @param {Object} metrics 见 buildMetrics
 * @param {Object} [hwm]   高水位（历史最大值）
 */
function evaluate(metrics, hwm) {
  const hi = hwm || {};
  return DEFS.map((d) => {
    const target = num(d.target) || 1;
    const base = metricOf(metrics, d.metric);
    // 判定值 = max(当前值, 历史最大值)：累计类指标只增不减
    const current = Math.max(base, num(hi[d.metric]));
    const unlocked = current >= target;
    const shown = Math.min(current, target);
    const remain = Math.max(0, target - current);
    return {
      id: d.id,
      icon: d.icon,
      name: d.name,
      desc: d.desc,
      group: d.group,
      metric: d.metric,
      target,
      unit: d.unit,
      boolean: !!d.boolean,
      current,
      unlocked,
      remain,
      percent: Math.min(100, Math.round((current / target) * 100)),
      progressText: d.boolean ? (unlocked ? '已达成' : '未完成') : `${shown}/${target}${d.unit}`,
      remainText: unlocked ? '' : (d.boolean ? '尚未完成' : `还差 ${remain}${d.unit}`),
      unlockedAt: 0,
      isNew: false
    };
  });
}

/** 按分组聚合成页面直接可渲染的结构 */
function groupList(list) {
  return GROUPS.map((title) => ({
    key: title,
    title,
    items: list.filter((b) => b.group === title)
  })).filter((g) => g.items.length > 0);
}

/** 下一枚要冲的徽章：在所有未解锁里挑进度最靠前的（进度相同则按定义顺序） */
function nextBadge(list) {
  const locked = list.filter((b) => !b.unlocked);
  if (!locked.length) return null;
  return locked.reduce((best, b) => (b.percent > best.percent ? b : best), locked[0]);
}

/**
 * 同步一次：更新高水位 → 判定 → 记录本次新解锁 → 落盘。
 * @param {Object} metrics 见 buildMetrics
 * @param {Number} [now]   解锁时间戳（测试注入用）
 * @returns {{list, groups, newlyUnlocked, unlockedCount, total, next, hwm}}
 */
function sync(metrics, now) {
  const ts = num(now) > 0 ? num(now) : Date.now();
  const state = readState();

  const hwm = {};
  METRICS.forEach((k) => { if (k in state.hwm) hwm[k] = state.hwm[k]; });
  METRICS.forEach((k) => {
    const v = metricOf(metrics, k);
    if (!(k in hwm) || v > hwm[k]) hwm[k] = v;
  });

  const list = evaluate(metrics, hwm);
  const newlyUnlocked = [];
  list.forEach((b) => {
    if (b.unlocked && !state.badges[b.id]) {
      state.badges[b.id] = ts;
      newlyUnlocked.push(b.id);
      b.isNew = true;
    }
    b.unlockedAt = state.badges[b.id] || 0;
  });

  state.hwm = hwm;
  writeState(state);

  return {
    list,
    groups: groupList(list),
    newlyUnlocked,
    unlockedCount: list.filter((b) => b.unlocked).length,
    total: TOTAL,
    next: nextBadge(list),
    hwm
  };
}

/** 只读已解锁数量（不触发判定）—— 给首页/我的页入口用，零计算零云请求 */
function unlockedCount() {
  const state = readState();
  return DEFS.filter((d) => state.badges[d.id] > 0).length;
}

/** 某枚徽章的解锁时间，未解锁返回 0 */
function unlockedAt(id) {
  const state = readState();
  return state.badges[id] || 0;
}

/** 已解锁的 id 列表（按定义顺序） */
function unlockedIds() {
  const state = readState();
  return DEFS.filter((d) => state.badges[d.id] > 0).map((d) => d.id);
}

module.exports = {
  KEY,
  METRICS,
  GROUPS,
  DEFS,
  TOTAL,
  DEF_BY_ID,
  buildMetrics,
  normalize,
  evaluate,
  groupList,
  nextBadge,
  sync,
  unlockedCount,
  unlockedAt,
  unlockedIds,
  reset
};
