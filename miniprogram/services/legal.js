/**
 * services/legal.js — 协议同意状态（本地记录）
 *
 * 只做一件事：记住「用户同意过哪个版本的协议」。
 * 版本号一变（content/legal.js 的 LEGAL_VERSION），needsReaccept() 立刻为 true，
 * 建档流程会重新要求勾选 —— 这就是「协议更新后重新征得同意」的落地方式。
 *
 * 为什么不写云端：同意记录是「本地凭证」，写云反而引入一次网络请求与失败分支；
 * 而它的作用域本来就只有「这台设备上的这个用户」。storage 全部 try/catch 兜底，
 * 读写失败最坏退化成「需要重新同意」，不会抛错白屏。
 */
const content = require('../content/legal.js');

const KEY = 'legal_accept_v1';

/**
 * 归一化存储值：只接受形如 { version: 'v1.0', acceptedAt: 1234567890 } 的记录。
 * 脏数据（字符串、数组、缺字段、时间戳非数字）一律视为「未同意」。
 */
function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const version = raw.version;
  if (typeof version !== 'string' || !version) return null;
  const acceptedAt = Number(raw.acceptedAt);
  if (!isFinite(acceptedAt) || acceptedAt <= 0) return null;
  return { version, acceptedAt };
}

/** 读取同意记录；从未同意或数据损坏时返回 null */
function getAcceptance() {
  try {
    return normalize(wx.getStorageSync(KEY));
  } catch (e) {
    return null;
  }
}

/** 是否已同意「当前版本」的协议 */
function isAccepted() {
  const rec = getAcceptance();
  return !!rec && rec.version === content.LEGAL_VERSION;
}

/** 是否需要（重新）征得同意：从未同意，或只同意过旧版本 */
function needsReaccept() {
  return !isAccepted();
}

/** 记录同意。可显式传入版本号（测试用）；默认记当前版本 */
function accept(version, at) {
  const rec = {
    version: typeof version === 'string' && version ? version : content.LEGAL_VERSION,
    acceptedAt: isFinite(Number(at)) && Number(at) > 0 ? Number(at) : Date.now()
  };
  try {
    wx.setStorageSync(KEY, rec);
  } catch (e) { /* 写失败不影响本次使用，只是下次会再问一遍 */ }
  return rec;
}

/** 撤回同意（取消勾选时调用），返回是否清除成功 */
function revoke() {
  try {
    wx.removeStorageSync(KEY);
    return true;
  } catch (e) {
    return false;
  }
}

/** 清空同意记录，等价于 revoke；测试重置用 */
function reset() {
  return revoke();
}

/**
 * 我的页入口右侧的状态文案。
 * 未同意 → 「未同意」；同意过的版本落后 → 「协议已更新」；当前版本 → 「已同意 v1.0」
 */
function statusText() {
  const rec = getAcceptance();
  if (!rec) return '未同意';
  if (rec.version !== content.LEGAL_VERSION) return '协议已更新';
  return `已同意 ${rec.version}`;
}

/** 同意时间（毫秒时间戳），未同意返回 0；给「关于」页展示用 */
function acceptedAt() {
  const rec = getAcceptance();
  return rec ? rec.acceptedAt : 0;
}

module.exports = {
  KEY,
  normalize,
  getAcceptance,
  isAccepted,
  needsReaccept,
  accept,
  revoke,
  reset,
  statusText,
  acceptedAt
};
