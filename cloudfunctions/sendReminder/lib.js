// cloudfunctions/sendReminder/lib.js — 训练提醒的纯逻辑
//
// 为什么要单独拆一个文件：
//   index.js 顶部 require('wx-server-sdk')，本地 node 跑不起来；
//   把「算北京时间 / 判断该不该发 / 拼模板数据」这些纯函数拆出来，
//   就能用 node 直接跑单测（见项目根目录 test-reminder.js），不用连云环境。
//
// 本文件不允许 require wx-server-sdk 或任何 Node 内置模块。

'use strict';

const DEFAULT_HOUR = 19;

// 云函数运行在 UTC 时区，而「今天几点」必须按北京时间算
const CN_OFFSET_MS = 8 * 60 * 60 * 1000;

function pad(n) {
  return String(n).padStart(2, '0');
}

// 北京时间的时间分量（用 getUTCxxx 读，等价于北京时间的当地时间）
function cnParts(baseMs) {
  const ms = (baseMs === undefined || baseMs === null) ? Date.now() : Number(baseMs);
  const d = new Date(ms + CN_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay() // 0 = 周日
  };
}

function cnDateStr(baseMs) {
  const p = cnParts(baseMs);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function cnTimeText(baseMs) {
  const p = cnParts(baseMs);
  return `${p.year}年${p.month}月${p.day}日 ${pad(p.hour)}:${pad(p.minute)}`;
}

// 提醒时间归一化：0-23 整数，非法值回落到默认 19 点
// 注意 null / '' 必须单独挡掉：Number(null) 是 0、Number('') 也是 0，
// 不挡的话「没填时间」会被当成「每天 0 点提醒」
function clampHour(h) {
  if (h === null || h === undefined || h === '') return DEFAULT_HOUR;
  const n = Math.round(Number(h));
  if (!isFinite(n)) return DEFAULT_HOUR;
  return Math.max(0, Math.min(23, n));
}

function formatHour(h) {
  return `${pad(clampHour(h))}:00`;
}

// 订阅消息字段有字数上限（thing 类型 20 字），按「字符」截断，
// 不能用 slice 直接切（emoji → 半个码元），也不能把变体选择符/零宽连接符留在末尾
function truncate(str, max) {
  const s = (str === undefined || str === null) ? '' : String(str);
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  const head = chars.slice(0, Math.max(0, max - 1));
  // 末尾若只剩组合符号（️ ️⃣ 等），去掉，否则省略号会被吃掉
  while (head.length && /[\uFE0E\uFE0F\u200D\u20E3]/.test(head[head.length - 1])) head.pop();
  return head.join('') + '…';
}

// 跳过原因 → 中文说明（写进返回值，方便在控制台一眼看出为什么没人收到）
const REASON_TEXT = {
  ok: '可发送',
  disabled: '未开启提醒',
  'no-quota': '订阅额度已用完',
  'already-sent': '今天已经提醒过了',
  'checked-in': '今天已打卡，无需提醒',
  'hour-mismatch': '未到提醒时间'
};

function reasonText(reason) {
  return REASON_TEXT[reason] || reason || '';
}

/**
 * 决策：这条提醒记录在当前时刻该不该发。
 * @param {object} record { enabled, hour, quota, lastSentDate }
 * @param {object} ctx    { nowMs, hour, todayStr, checkedInToday }
 *        - ctx.hour 传数字才校验时间点；不传（如测试发送）则跳过时间校验
 * @returns {{ send: boolean, reason: string }}
 */
function decideRemind(record, ctx) {
  const r = record || {};
  const c = ctx || {};
  if (r.enabled !== true) return { send: false, reason: 'disabled' };
  if (!(Number(r.quota) > 0)) return { send: false, reason: 'no-quota' };
  if (c.checkedInToday) return { send: false, reason: 'checked-in' };
  // 同一天只发一条：云函数每小时跑一次，靠这个字段兜住重复
  if (c.todayStr && r.lastSentDate === c.todayStr) return { send: false, reason: 'already-sent' };
  if (typeof c.hour === 'number' && clampHour(r.hour) !== c.hour) return { send: false, reason: 'hour-mismatch' };
  return { send: true, reason: 'ok' };
}

/**
 * 归一化的提醒文案（字段名交给 index.js 的 FIELD_MAP 映射到具体模板）
 * @param {object} ctx { nowMs, focus, streak }
 */
function buildContent(ctx) {
  const c = ctx || {};
  const streak = Math.max(0, Math.round(Number(c.streak) || 0));
  const focus = c.focus ? String(c.focus) : '';
  return {
    // thing 类字段：≤20 字
    thing: truncate(focus ? `${focus}训练提醒` : '今日训练提醒', 20),
    // time 类字段：年月日时分
    time: cnTimeText(c.nowMs),
    // 备注：给一点情绪价值，仍然 ≤20 字
    remark: truncate(
      streak >= 2 ? `已连续打卡 ${streak} 天，今天别断` : '点开完成今天的计划吧',
      20
    )
  };
}

/**
 * 归一化文案 → 订阅消息 data。
 * 只映射配置过的字段：模板里有什么字段就配什么，多传字段会被微信判「参数不准确」。
 */
function toTemplateData(content, fieldMap) {
  const map = fieldMap || {};
  const out = {};
  ['thing', 'time', 'remark'].forEach((k) => {
    const key = map[k];
    const val = content && content[k];
    if (key && val) out[key] = { value: String(val) };
  });
  return out;
}

// 发送成功后扣 1 次额度（不会扣成负数）
function nextQuota(record) {
  const q = Math.round(Number(record && record.quota) || 0) - 1;
  return q > 0 ? q : 0;
}

// 这个错误是不是「用户没有可用的订阅额度 / 已拒收」
// 43101 = 用户拒绝接收；这种情况必须停发，否则每轮都会报错
function isNoQuotaError(err) {
  const msg = [
    err && err.errCode,
    err && err.errMsg,
    err && err.message,
    typeof err === 'string' ? err : ''
  ].filter(Boolean).join(' ');
  return /43101|refuse|拒收/i.test(msg);
}

// 日志里的 openid 打码（别把用户完整 openid 打进云函数日志）
function maskOpenid(openid) {
  const s = String(openid || '');
  return s.length > 8 ? `${s.slice(0, 6)}***${s.slice(-2)}` : s;
}

module.exports = {
  DEFAULT_HOUR,
  cnParts,
  cnDateStr,
  cnTimeText,
  clampHour,
  formatHour,
  truncate,
  reasonText,
  decideRemind,
  buildContent,
  toTemplateData,
  nextQuota,
  isNoQuotaError,
  maskOpenid,
  _internal: { REASON_TEXT }
};
