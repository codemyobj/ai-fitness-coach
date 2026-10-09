// services/rest.js — 组间休息倒计时（V1.1）
//
// 为什么做：跟练页原来只有「本次训练总用时」一个计时器，组与组之间没有任何提示，
// 用户得自己数秒。这里把「休息时长」做成偏好（我的 → 组间休息），跟练页按它自动倒计时。
//
// 设计要点：
// 1. 倒计时基于「结束时间戳」而不是每秒累减 —— 切后台、锁屏、掉帧后回来剩余时间依然准确；
// 2. 默认时长存本地（30/45/60/90/120 秒，或关闭），不占云数据库、不用部署；
// 3. 纯函数（clampSec / fmt / percentLeft / nextLabel）单独导出，可离线单测。
const KEY = 'rest_pref_v1';
const DEFAULT_SEC = 60;
const MIN_SEC = 5;    // 手动 −15s 时允许调到很小；预设值都 ≥ 30
const MAX_SEC = 600;
const PRESETS = [0, 30, 45, 60, 90, 120]; // 0 = 关闭自动休息

let _mem = DEFAULT_SEC;
function storage() {
  if (typeof wx !== 'undefined' && wx && typeof wx.getStorageSync === 'function') {
    return {
      get: () => wx.getStorageSync(KEY),
      set: (v) => wx.setStorageSync(KEY, v)
    };
  }
  return { get: () => _mem, set: (v) => { _mem = v; } };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// 时长归一化：非正数/非数字回落到 fallback，有效值夹到 [MIN_SEC, MAX_SEC]
function clampSec(n, fallback) {
  const num = Math.round(Number(n));
  if (isFinite(num) && num > 0) return Math.max(MIN_SEC, Math.min(MAX_SEC, num));
  const fb = Math.round(Number(fallback));
  if (isFinite(fb) && fb > 0) return Math.max(MIN_SEC, Math.min(MAX_SEC, fb));
  return DEFAULT_SEC;
}

// 手动微调（±15s）专用：只做区间夹取，不把 ≤0 当非法值回落。
// 否则「剩 10 秒点 −15s」会得到 fallback 的 60 秒 —— 越点越多，是反直觉的。
function clampAdjust(n) {
  const num = Math.round(Number(n));
  if (!isFinite(num)) return DEFAULT_SEC;
  return Math.max(MIN_SEC, Math.min(MAX_SEC, num));
}

// 默认休息时长：0 表示用户关闭了自动休息（脏数据一律回落到 60）
function getDefault() {
  try {
    const raw = storage().get();
    if (raw === 0 || raw === '0') return 0;
    if (raw === '' || raw === null || raw === undefined) return DEFAULT_SEC;
    return clampSec(raw, DEFAULT_SEC);
  } catch (e) {
    return DEFAULT_SEC;
  }
}

function setDefault(sec) {
  const num = Number(sec);
  const safe = (isFinite(num) && Math.round(num) === 0) ? 0 : clampSec(sec, DEFAULT_SEC);
  try {
    storage().set(safe);
  } catch (e) {
    console.warn('休息时长写入失败：', e);
  }
  return safe;
}

function isEnabled() {
  return getDefault() > 0;
}

// 「已关闭」/「60 秒」
function label(sec) {
  const n = Number(sec);
  if (isFinite(n) && Math.round(n) === 0) return '已关闭';
  return `${clampSec(sec, DEFAULT_SEC)} 秒`;
}

function presetLabels() {
  return PRESETS.map(label);
}

// 当前值在 PRESETS 中的下标（找不到返回 0，即「已关闭」）
function presetIndex(sec) {
  const n = Number(sec);
  const v = (isFinite(n) && Math.round(n) === 0) ? 0 : clampSec(sec, DEFAULT_SEC);
  const i = PRESETS.indexOf(v);
  return i >= 0 ? i : 0;
}

// 秒 → 「01:30」（>99 分钟时自然进位，不截断）
function fmt(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

// 距结束还剩几秒（向上取整）：now >= end 时为 0
function leftSecFrom(endTs, nowTs) {
  const end = Number(endTs) || 0;
  if (!end) return 0;
  const now = (nowTs === undefined || nowTs === null) ? Date.now() : Number(nowTs);
  if (!isFinite(now)) return 0;
  return Math.max(0, Math.ceil((end - now) / 1000));
}

// 剩余比例（0~100），用于进度条宽度；total 非法时返回 0
function percentLeft(left, total) {
  const l = Math.max(0, Number(left) || 0);
  const t = Number(total) || 0;
  if (t <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((l / t) * 100)));
}

// 休息期间告诉用户「接下来练什么」
// list: [{ exerciseId, name, sets }]，返回 { kind: 'set' | 'exercise' | 'end', text }
function nextLabel(list, exerciseId, doneCount, total) {
  const arr = Array.isArray(list) ? list : [];
  const idx = arr.findIndex((e) => e && e.exerciseId === exerciseId);
  const sets = Math.max(Number(total) || 0, 0);
  const done = Math.max(Number(doneCount) || 0, 0);

  // 同一个动作还有没做完的组
  if (idx >= 0 && sets > 0 && done < sets) {
    return { kind: 'set', text: `${arr[idx].name} · 第 ${done + 1}/${sets} 组` };
  }
  // 往后找下一个还有组数的动作
  for (let i = idx + 1; i < arr.length; i++) {
    const n = Math.max(Number(arr[i].sets) || 0, 0);
    if (n > 0) return { kind: 'exercise', text: `下一个：${arr[i].name} ${n} 组` };
  }
  return { kind: 'end', text: '今天的动作都完成啦 🎉' };
}

module.exports = {
  KEY,
  DEFAULT_SEC,
  MIN_SEC,
  MAX_SEC,
  PRESETS,
  getDefault,
  setDefault,
  isEnabled,
  label,
  presetLabels,
  presetIndex,
  clampSec,
  clampAdjust,
  fmt,
  leftSecFrom,
  percentLeft,
  nextLabel,
  _internal: { pad }
};
