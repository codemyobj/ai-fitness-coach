// services/reminder.js — 训练提醒（订阅消息）
//
// 微信规则决定的产品形态（很重要，别当成 bug）：
//   训练提醒只能走「一次性订阅」——用户授权 1 次 = 服务端只能发 1 条。
//   没有长期订阅资格，所以这里维护一个「剩余提醒次数 quota」：
//   授权成功 +1，云函数发一条 -1；余额为 0 时提醒不会发，页面会引导再点一次「续订」。
//
// 集合：reminders（权限需设为「仅创建者可读写」）
// 文档：{ openid, enabled, hour, quota, lastSentDate, lastSentAt, lastError, createdAt, updatedAt }

const { friendlyError } = require('../utils/db-error.js');

// ⚠️ 唯一需要你改的一行：微信公众平台 → 功能 → 订阅消息 → 选用模板 → 复制模板 ID
//    改完这里才会真正收到提醒；云函数那边还要把同一个 ID 配到环境变量（见 docs/REMINDER-SETUP.md）
const TEMPLATE_ID = 'REPLACE_WITH_TEMPLATE_ID';
const TEMPLATE_PLACEHOLDER = 'REPLACE_WITH_TEMPLATE_ID';

const COLLECTION = 'reminders';
const KEY = 'reminder_pref_v1'; // 本地缓存（云端不可用时也能渲染页面）
const DEFAULT_HOUR = 19;
// 可选的提醒整点：云函数每小时跑一次，用户选几点就几点发
const HOURS = [7, 8, 9, 10, 12, 17, 18, 19, 20, 21, 22];

function pad(n) {
  return String(n).padStart(2, '0');
}

// 模板是否已配置（没配置时页面显示配置指引，而不是点了没反应）
function isConfigured() {
  return !!TEMPLATE_ID && TEMPLATE_ID !== TEMPLATE_PLACEHOLDER;
}

function clampHour(h) {
  // null / '' 要单独挡：Number(null) 和 Number('') 都是 0，
  // 不挡会被当成「每天 0 点提醒」
  if (h === null || h === undefined || h === '') return DEFAULT_HOUR;
  const n = Math.round(Number(h));
  if (!isFinite(n)) return DEFAULT_HOUR;
  return Math.max(0, Math.min(23, n));
}

function formatHour(h) {
  return `${pad(clampHour(h))}:00`;
}

function hourLabels() {
  return HOURS.map((h) => formatHour(h));
}

// 顶部状态文案
function statusText(record) {
  const r = record || {};
  if (r.enabled !== true) return '未开启';
  if (!(Number(r.quota) > 0)) return '待续订';
  return `已开启 · ${formatHour(r.hour)}`;
}

// 剩余次数文案
function quotaText(record) {
  const q = Math.max(0, Math.round(Number(record && record.quota) || 0));
  return `剩余 ${q} 次`;
}

// 是否处于「开着但没额度」的待续订状态
function needRenew(record) {
  const r = record || {};
  return r.enabled === true && !(Number(r.quota) > 0);
}

// ---------- 本地缓存 ----------
function getCache() {
  try {
    return wx.getStorageSync(KEY) || null;
  } catch (e) {
    return null;
  }
}

function setCache(v) {
  try {
    wx.setStorageSync(KEY, v);
  } catch (e) { /* 存储写满不影响主流程 */ }
}

function clearCache() {
  try {
    wx.removeStorageSync(KEY);
  } catch (e) { /* 忽略 */ }
}

// ---------- 集合缺失自愈（与其他服务一致的做法）----------
let _initTried = false;
function isCollectionMissing(err) {
  const msg = (err && (err.errMsg || err.message)) || String(err);
  return /-502005|collection not exists|集合不存在/i.test(msg);
}

async function ensureCollection() {
  if (_initTried) return false;
  _initTried = true;
  try {
    await wx.cloud.callFunction({ name: 'initDb', data: {} });
    console.log('[reminder] 集合缺失，已自动执行 initDb 初始化');
    return true;
  } catch (e) {
    console.warn('[reminder] 自动初始化失败（initDb 未部署？）:', e && (e.errMsg || e.message));
    return false;
  }
}

function openid() {
  const app = getApp();
  return (app && app.globalData && app.globalData.openid) || '';
}

// ---------- 读取 ----------
// 读取自己的提醒设置；云端不可用时回落本地缓存，页面至少能显示上次状态
async function load() {
  const uid = openid();
  if (!uid) return null;
  try {
    return await _load(uid);
  } catch (err) {
    if (isCollectionMissing(err) && (await ensureCollection())) {
      try {
        return await _load(uid);
      } catch (e2) { /* 落到下面兜底 */ }
    }
    const cached = getCache();
    if (cached) return cached;
    throw friendlyError(err);
  }
}

async function _load(uid) {
  const db = wx.cloud.database();
  const res = await db.collection(COLLECTION).where({ openid: uid }).limit(1).get();
  const doc = res.data[0] || null;
  if (doc) setCache(doc);
  return doc;
}

// ---------- 订阅授权 ----------
// 拉起微信订阅弹窗。必须在用户点击的调用栈里执行，否则会报 can only be invoked by user TAP gesture。
// 返回 { accepted: 0|1, status }，status: accept / reject / ban / unconfigured / unsupported / error
function subscribe() {
  return new Promise((resolve) => {
    if (!isConfigured()) {
      resolve({ accepted: 0, status: 'unconfigured' });
      return;
    }
    if (!wx.requestSubscribeMessage) {
      resolve({ accepted: 0, status: 'unsupported' });
      return;
    }
    wx.requestSubscribeMessage({
      tmplIds: [TEMPLATE_ID],
      success(res) {
        const st = (res && res[TEMPLATE_ID]) || 'unknown';
        resolve({ accepted: st === 'accept' ? 1 : 0, status: st });
      },
      fail(err) {
        resolve({ accepted: 0, status: 'error', errMsg: (err && err.errMsg) || String(err) });
      }
    });
  });
}

// ---------- 写入 ----------
/**
 * 开启 / 续订提醒：先授权，授权成功才 +1 次额度。
 * @param {number} hour 想收到提醒的整点
 * @returns {{ accepted: number, status: string, tip?: string, record?: object }}
 */
async function enable(hour) {
  const uid = openid();
  if (!uid) throw new Error('登录状态未就绪，请稍后重试');
  if (!isConfigured()) throw new Error('提醒模板未配置，请先在 services/reminder.js 填入模板 ID');

  const sub = await subscribe();
  if (sub.status === 'unsupported') throw new Error('当前微信版本不支持订阅消息，请升级微信后重试');
  if (sub.status === 'error') throw new Error('订阅授权失败，请重试');
  if (!sub.accepted) {
    return {
      accepted: 0,
      status: sub.status,
      tip: sub.status === 'ban'
        ? '你已关闭该提醒的订阅，可在「微信 → 设置 → 订阅消息」里重新允许'
        : '需要允许订阅，才能收到训练提醒'
    };
  }

  const record = await upsert(uid, {
    enabled: true,
    hour: clampHour(hour),
    quotaInc: sub.accepted
  });
  return { accepted: sub.accepted, status: sub.status, record };
}

async function disable() {
  const uid = openid();
  if (!uid) throw new Error('登录状态未就绪，请稍后重试');
  return upsert(uid, { enabled: false });
}

async function setHour(hour) {
  const uid = openid();
  if (!uid) throw new Error('登录状态未就绪，请稍后重试');
  return upsert(uid, { hour: clampHour(hour) });
}

// 让云函数立刻给自己发一条（联调用；会消耗 1 次真实订阅额度）
async function testSend() {
  const res = await wx.cloud.callFunction({ name: 'sendReminder', data: { action: 'test' } });
  const r = (res && res.result) || {};
  if (r.code !== 0) throw new Error(r.message || '测试发送失败');
  return r;
}

async function upsert(uid, patch) {
  try {
    return await _upsert(uid, patch);
  } catch (err) {
    if (isCollectionMissing(err) && (await ensureCollection())) {
      return await _upsert(uid, patch);
    }
    throw friendlyError(err);
  }
}

async function _upsert(uid, patch) {
  const db = wx.cloud.database();
  const _ = db.command;
  const res = await db.collection(COLLECTION).where({ openid: uid }).limit(1).get();
  const existing = res.data[0] || null;

  if (existing && existing._id) {
    const data = { updatedAt: db.serverDate() };
    if (patch.enabled !== undefined) data.enabled = patch.enabled === true;
    if (patch.hour !== undefined) data.hour = clampHour(patch.hour);
    // 用 inc 原子自增，避免和「刚发出去一条」的云函数扣减互相覆盖
    if (patch.quotaInc) data.quota = _.inc(Math.round(Number(patch.quotaInc)));
    await db.collection(COLLECTION).doc(existing._id).update({ data });
  } else {
    // 新建：add 里不能用 _.inc，直接给初值
    await db.collection(COLLECTION).add({
      data: {
        openid: uid,
        enabled: patch.enabled === true,
        hour: clampHour(patch.hour),
        quota: Math.max(0, Math.round(Number(patch.quotaInc) || 0)),
        lastSentDate: '',
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    });
  }
  return _load(uid);
}

module.exports = {
  TEMPLATE_ID,
  KEY,
  HOURS,
  DEFAULT_HOUR,
  COLLECTION,
  isConfigured,
  clampHour,
  formatHour,
  hourLabels,
  statusText,
  quotaText,
  needRenew,
  getCache,
  setCache,
  clearCache,
  load,
  subscribe,
  enable,
  disable,
  setHour,
  testSend,
  // 内部写路径开放给单测（正常业务请不要直接调用，用 enable/disable/setHour）
  _internal: { upsert }
};
