// services/favorites.js — 动作收藏（V1.1）
// 存本地 storage，不碰云数据库：收藏是个人偏好，跨设备同步价值低、成本高。
// KEY 带版本号，将来改结构（比如换成 {id, at} 对象）可以直接换 v2 而不炸老数据。
const KEY = 'fav_exercises_v1';
const MAX = 200; // 收藏上限，防止 storage 无限膨胀

// 环境适配：小程序走 wx.storage；Node 单测走内存（不污染测试进程外的状态）
let _mem = [];
function storage() {
  if (typeof wx !== 'undefined' && wx && typeof wx.getStorageSync === 'function') {
    return {
      get: () => wx.getStorageSync(KEY),
      set: (v) => wx.setStorageSync(KEY, v),
      remove: () => wx.removeStorageSync(KEY)
    };
  }
  return {
    get: () => _mem,
    set: (v) => { _mem = v; },
    remove: () => { _mem = []; }
  };
}

// 任意脏数据 → 干净的 id 数组：只留非空字符串、去重、保持原顺序、截断到上限
function normalize(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const id = raw[i];
    if (typeof id !== 'string') continue;
    const trimmed = id.trim();
    if (!trimmed || out.indexOf(trimmed) >= 0) continue;
    out.push(trimmed);
    if (out.length >= MAX) break;
  }
  return out;
}

function save(ids) {
  try {
    storage().set(ids);
  } catch (e) {
    console.warn('收藏写入失败：', e); // 存储写满等异常不应中断交互
  }
  return ids;
}

// 收藏 id 列表（副本，外部改动不会影响存储）
function list() {
  try {
    return normalize(storage().get());
  } catch (e) {
    console.warn('收藏读取失败：', e);
    return [];
  }
}

function count() {
  return list().length;
}

function has(id) {
  if (typeof id !== 'string' || !id) return false;
  return list().indexOf(id) >= 0;
}

// id → true 的映射表，列表渲染时避免在 WXML 里做数组查找
function map() {
  const m = {};
  list().forEach((id) => { m[id] = true; });
  return m;
}

// 新的收藏状态（最近收藏的放最前，列表/收藏页都好看）
function add(id) {
  if (typeof id !== 'string' || !id.trim()) return { ids: list(), added: false };
  const key = id.trim();
  const ids = list();
  if (ids.indexOf(key) >= 0) return { ids, added: false };
  ids.unshift(key);
  save(ids.slice(0, MAX));
  return { ids, added: true };
}

function remove(id) {
  if (typeof id !== 'string' || !id) return { ids: list(), removed: false };
  const ids = list();
  const next = ids.filter((x) => x !== id);
  if (next.length === ids.length) return { ids, removed: false };
  save(next);
  return { ids: next, removed: true };
}

// 返回切换后的状态，方便调用方直接提示
function toggle(id) {
  if (has(id)) {
    remove(id);
    return { favorited: false, count: count() };
  }
  add(id);
  return { favorited: true, count: count() };
}

function clear() {
  try {
    storage().remove();
  } catch (e) {
    console.warn('收藏清空失败：', e);
  }
  return [];
}

module.exports = { KEY, MAX, list, count, has, map, add, remove, toggle, clear, _internal: { normalize } };
