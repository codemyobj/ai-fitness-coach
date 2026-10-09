// services/body.js — 身体记录服务（V0.6）
// 集合：body_records（权限需设为「仅创建者可读写」）
// 设计要点：同一天重复记录走更新（upsert），避免出现同日多条；日期用本地字符串避免 UTC 跨天

const { friendlyError } = require('../utils/db-error.js');
const units = require('./units.js');

const COLLECTION = 'body_records';

function pad(n) {
  return String(n).padStart(2, '0');
}

function fmt(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayStr() {
  return fmt(new Date());
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

// 校验并归一化表单输入，失败直接抛 Error（页面 toast 提示）
// unit：表单里填的是「展示单位」（kg 或 lb），这里统一换算成 kg 再入库
function validate(payload, unit) {
  const u = units.label(unit);
  const p = payload || {};
  const date = String(p.date || '').trim() || todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式不正确');
  if (date > todayStr()) throw new Error('不能记录未来日期');

  const rawWeight = (p.weightKg === undefined || p.weightKg === null) ? '' : p.weightKg;
  if (String(rawWeight).trim() === '') throw new Error('请填写体重');
  const shown = Number(rawWeight);
  if (isNaN(shown)) throw new Error('体重必须是数字');
  const b = units.bounds(u);
  if (shown < b.min || shown > b.max) throw new Error(`体重需在 ${b.min}-${b.max} ${u} 之间`);
  const weight = units.toKg(shown, u); // 统一按 kg 存储

  let fat = null;
  const rawFat = (p.bodyFatPct === undefined || p.bodyFatPct === null) ? '' : p.bodyFatPct;
  if (String(rawFat).trim() !== '') {
    fat = Number(rawFat);
    if (isNaN(fat)) throw new Error('体脂率必须是数字');
    if (fat < 3 || fat > 70) throw new Error('体脂率需在 3-70% 之间');
  }

  const note = String(p.note || '').trim().slice(0, 50);

  return {
    date,
    weightKg: round1(weight),
    bodyFatPct: fat === null ? null : round1(fat),
    note,
    unit: u
  };
}

function openid() {
  const app = getApp();
  return (app && app.globalData && app.globalData.openid) || '';
}

// 保存（同日已存在则更新，否则新增；集合缺失时自动初始化后重试一次）
async function saveRecord(payload, unit) {
  try {
    return await _saveRecord(payload, unit);
  } catch (err) {
    if (isCollectionMissing(err) && (await ensureCollection())) {
      return _saveRecord(payload, unit);
    }
    throw friendlyError(err);
  }
}

async function _saveRecord(payload, unit) {
  const data = validate(payload, unit);
  const db = wx.cloud.database();
  const uid = openid();
  const col = db.collection(COLLECTION);

  const exist = await col.where({ openid: uid, date: data.date }).limit(1).get();
  if (exist.data && exist.data.length) {
    await col.doc(exist.data[0]._id).update({
      data: {
        weightKg: data.weightKg,
        bodyFatPct: data.bodyFatPct,
        note: data.note,
        updatedAt: db.serverDate()
      }
    });
    return exist.data[0]._id;
  }

  const res = await col.add({
    data: {
      openid: uid,
      date: data.date,
      weightKg: data.weightKg,
      bodyFatPct: data.bodyFatPct,
      note: data.note,
      createdAt: db.serverDate()
    }
  });
  return res._id;
}

// 集合自愈：查询报「集合不存在」时自动调用 initDb 云函数建集合，然后重试一次。
// _initTried 保证每次会话最多自愈一次，避免 initDb 不存在时无限循环。
let _initTried = false;
function isCollectionMissing(err) {
  const msg = (err && (err.errMsg || err.message)) || String(err);
  return /-502005|collection not exists/i.test(msg);
}
async function ensureCollection() {
  if (_initTried) return false;
  _initTried = true;
  try {
    await wx.cloud.callFunction({ name: 'initDb', data: {} });
    console.log('[body] 集合缺失，已自动执行 initDb 初始化');
    return true;
  } catch (e) {
    console.warn('[body] 自动初始化失败（initDb 未部署？）:', e && (e.errMsg || e.message));
    return false;
  }
}

async function listRecords(limit) {
  const db = wx.cloud.database();
  const query = () => db.collection(COLLECTION)
    .where({ openid: openid() })
    .orderBy('date', 'desc')
    .limit(limit || 60)
    .get();
  try {
    const res = await query();
    return res.data || [];
  } catch (err) {
    if (isCollectionMissing(err) && (await ensureCollection())) {
      // initDb 建好集合后重试一次
      try {
        const res = await query();
        return res.data || [];
      } catch (err2) {
        throw friendlyError(err2);
      }
    }
    throw friendlyError(err);
  }
}


async function removeRecord(id) {
  if (!id) throw new Error('记录 id 为空');
  const db = wx.cloud.database();
  await db.collection(COLLECTION).doc(id).remove();
  return true;
}

// ---------- 纯函数：聚合与装饰（可单测） ----------

function sortByDateAsc(list) {
  return (list || []).slice().sort((a, b) => {
    const da = String(a && a.date || '');
    const db2 = String(b && b.date || '');
    if (da < db2) return -1;
    if (da > db2) return 1;
    return 0;
  });
}

function deltaText(d) {
  if (d === null || d === undefined) return '';
  if (Math.abs(d) < 0.05) return '持平';
  return (d > 0 ? '+' : '-') + Math.abs(round1(d)).toFixed(1);
}

function deltaClass(d) {
  if (d === null || d === undefined) return '';
  if (Math.abs(d) < 0.05) return 'flat';
  // 体重下降用主色（正向），上升用强调色（提醒）
  return d > 0 ? 'up' : 'down';
}

function buildSummary(records, unit) {
  const u = units.label(unit);
  const asc = sortByDateAsc(records);
  if (!asc.length) {
    return {
      count: 0,
      hasData: false,
      latest: null,
      latestWeight: null,
      latestFat: null,
      latestDate: '',
      delta: null,
      deltaText: '',
      deltaClass: '',
      totalDelta: null,
      totalDeltaText: '',
      totalDeltaClass: '',
      minWeight: null,
      maxWeight: null,
      avgWeight: null,
      unit: u
    };
  }

  const withW = asc.filter((r) => typeof r.weightKg === 'number' && !isNaN(r.weightKg));
  const nums = withW.map((r) => r.weightKg);
  const latest = asc[asc.length - 1];
  const prev = asc.length > 1 ? asc[asc.length - 2] : null;

  const deltaKg = (prev && typeof latest.weightKg === 'number' && typeof prev.weightKg === 'number')
    ? round1(latest.weightKg - prev.weightKg)
    : null;
  const totalDeltaKg = (withW.length > 1 && typeof latest.weightKg === 'number')
    ? round1(latest.weightKg - withW[0].weightKg)
    : null;

  // 差值也要按单位换算，否则 lb 用户看到的是 kg 的差值
  const delta = deltaKg === null ? null : units.toDisplay(deltaKg, u);
  const totalDelta = totalDeltaKg === null ? null : units.toDisplay(totalDeltaKg, u);
  const disp = (kg) => (kg === null ? null : units.toDisplay(kg, u));

  return {
    count: asc.length,
    hasData: true,
    latest,
    latestWeight: typeof latest.weightKg === 'number' ? units.toDisplay(latest.weightKg, u) : null,
    latestFat: typeof latest.bodyFatPct === 'number' ? latest.bodyFatPct : null,
    latestDate: latest.date || '',
    delta,
    deltaText: deltaText(delta),
    deltaClass: deltaClass(delta),
    totalDelta,
    totalDeltaText: deltaText(totalDelta),
    totalDeltaClass: deltaClass(totalDelta),
    minWeight: nums.length ? disp(round1(Math.min.apply(null, nums))) : null,
    maxWeight: nums.length ? disp(round1(Math.max.apply(null, nums))) : null,
    avgWeight: nums.length ? disp(round1(nums.reduce((s, n) => s + n, 0) / nums.length)) : null,
    unit: u
  };
}

// 体重趋势（取最近 n 条，按日期升序），heightPct 供 WXSS 柱状图使用
function buildTrend(records, n, unit) {
  const u = units.label(unit);
  const asc = sortByDateAsc(records).filter((r) => typeof r.weightKg === 'number' && !isNaN(r.weightKg));
  const size = n || 10;
  const slice = asc.slice(Math.max(0, asc.length - size));
  const nums = slice.map((r) => r.weightKg);
  const min = nums.length ? Math.min.apply(null, nums) : 0;
  const max = nums.length ? Math.max.apply(null, nums) : 0;
  const range = max - min;

  const points = slice.map((r) => {
    let pct = 55;
    if (range > 0) pct = Math.round(((r.weightKg - min) / range) * 70) + 30;
    return {
      date: r.date,
      label: String(r.date || '').slice(5),
      weightKg: units.toDisplay(round1(r.weightKg), u),
      heightPct: pct
    };
  });

  return {
    count: points.length,
    hasData: points.length > 0,
    minWeight: units.toDisplay(round1(min), u),
    maxWeight: units.toDisplay(round1(max), u),
    points,
    unit: u
  };
}

// 列表装饰：倒序 + 与上一次记录的差值
function decorateRecords(records, unit) {
  const u = units.label(unit);
  const desc = sortByDateAsc(records).reverse();
  return desc.map((r, i) => {
    const older = desc[i + 1];
    const dKg = (older && typeof r.weightKg === 'number' && typeof older.weightKg === 'number')
      ? round1(r.weightKg - older.weightKg)
      : null;
    const d = dKg === null ? null : units.toDisplay(dKg, u);
    return {
      _id: r._id || '',
      date: r.date || '',
      weightKg: typeof r.weightKg === 'number' ? units.toDisplay(r.weightKg, u) : null,
      weightText: typeof r.weightKg === 'number' ? String(units.toDisplay(round1(r.weightKg), u)) : '—',
      fatText: typeof r.bodyFatPct === 'number' ? String(round1(r.bodyFatPct)) : '',
      note: r.note || '',
      delta: d,
      deltaText: deltaText(d),
      deltaClass: deltaClass(d)
    };
  });
}

module.exports = {
  COLLECTION,
  todayStr,
  validate,
  saveRecord,
  listRecords,
  removeRecord,
  buildSummary,
  buildTrend,
  decorateRecords,
  friendlyError,
  _internal: { sortByDateAsc, deltaText, deltaClass, round1, fmt }
};
