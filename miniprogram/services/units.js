// services/units.js — 重量单位偏好（kg / lb）（V1.1）
// 设计原则：数据库里一律存 kg（唯一真源），只在「输入」和「展示」两个边界换算。
// 这样换单位不需要迁移历史数据，也不会出现同一份数据两种含义。
const KEY = 'unit_pref_v1';
const UNITS = ['kg', 'lb'];
const LB_PER_KG = 2.2046226;
const KG_MIN = 20;
const KG_MAX = 300;

let _mem = 'kg';
function storage() {
  if (typeof wx !== 'undefined' && wx && typeof wx.getStorageSync === 'function') {
    return {
      get: () => wx.getStorageSync(KEY),
      set: (v) => wx.setStorageSync(KEY, v)
    };
  }
  return { get: () => _mem, set: (v) => { _mem = v; } };
}

function round1(n) {
  const num = Number(n);
  if (isNaN(num)) return 0;
  return Math.round(num * 10) / 10;
}

// 空值（null / undefined / 空串）一律返回 null，别被 Number('') 偷偷变成 0
function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// 当前单位（脏数据一律回落到 kg）
function get() {
  try {
    const raw = storage().get();
    return UNITS.indexOf(raw) >= 0 ? raw : 'kg';
  } catch (e) {
    return 'kg';
  }
}

function set(unit) {
  const safe = UNITS.indexOf(unit) >= 0 ? unit : 'kg';
  try {
    storage().set(safe);
  } catch (e) {
    console.warn('单位设置写入失败：', e);
  }
  return safe;
}

function label(unit) {
  return (UNITS.indexOf(unit) >= 0) ? unit : get();
}

// kg（存储值） → 展示值
function toDisplay(kg, unit) {
  const u = label(unit);
  const num = toNum(kg);
  if (num === null) return null;
  return round1(u === 'lb' ? num * LB_PER_KG : num);
}

// 展示值 → kg（存储值）
function toKg(value, unit) {
  const u = label(unit);
  const num = toNum(value);
  if (num === null) return null;
  return round1(u === 'lb' ? num / LB_PER_KG : num);
}

// 输入范围（跟着当前单位走，提示文案才不会自相矛盾）
function bounds(unit) {
  const u = label(unit);
  if (u === 'lb') {
    return { min: Math.round(KG_MIN * LB_PER_KG), max: Math.round(KG_MAX * LB_PER_KG), unit: u };
  }
  return { min: KG_MIN, max: KG_MAX, unit: u };
}

// 「70 kg」/「154.3 lb」
function formatWeight(kg, unit) {
  const u = label(unit);
  const v = toDisplay(kg, u);
  return v === null ? '—' : `${v} ${u}`;
}

// 训练容量（kg×次数）：数字大时用千分位，不用「吨」，避免和健身语境混淆
function formatVolume(kgVolume, unit) {
  const u = label(unit);
  const v = toDisplay(kgVolume, u);
  if (v === null) return '—';
  const int = Math.round(v);
  return `${String(int).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ${u}`;
}

module.exports = {
  KEY,
  UNITS,
  LB_PER_KG,
  get,
  set,
  label,
  toDisplay,
  toKg,
  bounds,
  formatWeight,
  formatVolume,
  _internal: { round1, KG_MIN, KG_MAX }
};
