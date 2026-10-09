// services/workout.js — 训练记录与打卡服务
const { friendlyError } = require('../utils/db-error.js');

// 本地日期字符串 YYYY-MM-DD（避免 UTC 偏移导致的跨天问题）
function todayStr() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// 保存一条训练记录（打卡）
async function saveLog(payload) {
  invalidate(); // 打卡后清空缓存，下次读取拿到最新
  const db = wx.cloud.database();
  const openid = getApp().globalData.openid;
  const res = await db.collection('workout_logs').add({
    data: {
      openid,
      date: todayStr(),
      planId: payload.planId,
      weekIndex: payload.weekIndex || 0,
      dayIndex: payload.dayIndex,
      focus: payload.focus,
      exercises: payload.exercises,
      durationMin: payload.durationMin,
      completed: true,
      createdAt: db.serverDate()
    }
  });
  return res._id;
}

// 查询今日训练记录（防重复打卡）
async function getTodayWorkoutLog() {
  const db = wx.cloud.database();
  const res = await db.collection('workout_logs')
    .where({ openid: getApp().globalData.openid, date: todayStr() })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  return res.data[0] || null;
}

// 查询指定日期区间的打卡记录（日程/统计用）
// 缓存工具：按 key 缓存 Promise，带 TTL。写操作后调 invalidate 失效。
const _cache = {};
function cached(key, ttl, producer) {
  const hit = _cache[key];
  if (hit && Date.now() - hit.t < ttl) return hit.p;
  const p = producer();
  _cache[key] = { t: Date.now(), p };
  p.catch(() => { delete _cache[key]; }); // 失败不缓存，下次重试
  return p;
}
// 数据变更广播：其他模块（如 stats 的聚合缓存）可注册回调，一并失效
const _invalidateHooks = [];
function onInvalidate(fn) {
  if (typeof fn === 'function') _invalidateHooks.push(fn);
}

function invalidate(prefix) {
  Object.keys(_cache).forEach((k) => { if (!prefix || k.indexOf(prefix) === 0) delete _cache[k]; });
  _invalidateHooks.forEach((fn) => {
    try { fn(prefix); } catch (e) { console.warn('invalidate hook 失败：', e); }
  });
}

async function listLogsByRange(startDate, endDate) {
  const db = wx.cloud.database();
  const _ = db.command;
  const res = await db.collection('workout_logs')
    .where({
      openid: getApp().globalData.openid,
      date: _.gte(startDate).and(_.lte(endDate))
    })
    .orderBy('date', 'asc')
    .limit(100)
    .get();
  return res.data;
}

// 近 7 天打卡日期集合（首页打卡条用）
async function getRecentCheckinDates(days = 7) {
  // 切 tab 会重复调用：60s 内直接复用（打卡后有 invalidate 主动失效）
  return cached('checkins:' + days, 60000, () => _getRecentCheckinDates(days));
}

async function _getRecentCheckinDates(days = 7) {
  const now = new Date();
  const start = new Date(now.getTime() - (days - 1) * 86400000);
  const fmt = (d) => {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  };
  const logs = await listLogsByRange(fmt(start), fmt(now));
  return Array.from(new Set(logs.map((l) => l.date)));
}

module.exports = { saveLog, getTodayWorkoutLog, listLogsByRange, getRecentCheckinDates, todayStr, invalidate, onInvalidate };
