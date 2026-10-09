// services/data.js — 云端数据清理（V1.1）
// 用途：「我的 → 清空训练数据」。
// 为什么不用 where().remove()：客户端批量删除受权限与条数限制，
// 最稳的做法是查出 _id 后逐条 .doc(id).remove()（只删自己创建的数据，符合「仅创建者可读写」权限）。
// 数据量小（MVP 每人最多几百条），分批循环足够；写了上限防止异常数据把循环卡死。
// 注：chat_messages 集合已随 AI 对话功能一并下线（见 docs/REVIEW-AI-REMOVAL.md），
// 不再出现在清理清单里；该集合若已在云控制台创建，可直接删除。
const workoutService = require('./workout.js');

const COLLECTIONS = [
  { name: 'workout_logs', label: '训练打卡' },
  { name: 'body_records', label: '身体记录' },
  { name: 'plans', label: '训练计划' }
];
const BATCH = 20;
const MAX_ROUNDS = 25; // 单集合上限 500 条

function isCollectionMissing(err) {
  const msg = (err && (err.errMsg || err.message)) || String(err);
  return /-502005|collection not exists/i.test(msg);
}

function currentOpenid() {
  try {
    const app = getApp();
    return (app && app.globalData && app.globalData.openid) || '';
  } catch (e) {
    return '';
  }
}

// 清空单个集合：返回 { name, label, removed, capped, skipped }
async function clearCollection(entry, opts) {
  const o = opts || {};
  // 显式传 openid（含空串）以传入为准；没传才回退到全局登录态
  const uid = (o.openid === undefined || o.openid === null) ? currentOpenid() : o.openid;
  let removed = 0;

  if (!uid) return { name: entry.name, label: entry.label, removed, skipped: '未登录' };

  const db = wx.cloud.database();
  const col = db.collection(entry.name);

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let res;
    try {
      res = await col.where({ openid: uid }).limit(BATCH).get();
    } catch (err) {
      if (isCollectionMissing(err)) {
        return { name: entry.name, label: entry.label, removed, skipped: '集合不存在' };
      }
      throw err;
    }

    const rows = (res && res.data) || [];
    if (!rows.length) return { name: entry.name, label: entry.label, removed, capped: false };

    for (let i = 0; i < rows.length; i++) {
      try {
        await col.doc(rows[i]._id).remove();
        removed += 1;
      } catch (err) {
        console.warn(`[data] 删除 ${entry.name}/${rows[i]._id} 失败：`, err && (err.errMsg || err.message));
      }
      if (o.onProgress) o.onProgress(removed, entry.label);
    }

    if (rows.length < BATCH) return { name: entry.name, label: entry.label, removed, capped: false };
  }

  return { name: entry.name, label: entry.label, removed, capped: true };
}

// 清空全部训练相关数据（不含档案 profiles）
async function clearTrainingData(opts) {
  const results = [];
  for (let i = 0; i < COLLECTIONS.length; i++) {
    results.push(await clearCollection(COLLECTIONS[i], opts));
  }

  // 清完立刻让本地缓存失效，避免看板/打卡条还显示旧数据
  try {
    workoutService.invalidate();
  } catch (e) {
    console.warn('[data] 缓存失效失败：', e && e.message);
  }

  const total = results.reduce((s, r) => s + r.removed, 0);
  return {
    total,
    results,
    capped: results.filter((r) => r.capped).map((r) => r.label),
    summary: results
      .filter((r) => r.removed > 0 || r.skipped)
      .map((r) => `${r.label} ${r.removed} 条${r.skipped ? `（${r.skipped}）` : ''}`)
      .join('、')
  };
}

// 档案单独删除（「重新建档」用不到，但用户想彻底重来时有入口）
async function clearProfile() {
  const uid = currentOpenid();
  if (!uid) return 0;
  const db = wx.cloud.database();
  try {
    const res = await db.collection('profiles').where({ openid: uid }).limit(20).get();
    const rows = (res && res.data) || [];
    for (let i = 0; i < rows.length; i++) {
      await db.collection('profiles').doc(rows[i]._id).remove();
    }
    return rows.length;
  } catch (err) {
    if (isCollectionMissing(err)) return 0;
    throw err;
  }
}

module.exports = { COLLECTIONS, clearCollection, clearTrainingData, clearProfile, _internal: { isCollectionMissing, BATCH, MAX_ROUNDS } };
