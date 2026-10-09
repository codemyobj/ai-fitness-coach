// services/plan.js — 计划读写服务
const EX = require('../assets/data/exercises.js');
const { friendlyError } = require('../utils/db-error.js');

// 获取当前生效计划（status: active）
// 缓存工具：切 tab 会重复调用 getActivePlan，30s 内复用；生成/更新计划后 invalidate
const _cache = {};
function cached(key, ttl, producer) {
  const hit = _cache[key];
  if (hit && Date.now() - hit.t < ttl) return hit.p;
  const p = producer();
  _cache[key] = { t: Date.now(), p };
  p.catch(() => { delete _cache[key]; });
  return p;
}
function invalidatePlanCache() {
  Object.keys(_cache).forEach((k) => delete _cache[k]);
}

async function getActivePlan() {
  return cached('active', 30000, _getActivePlan);
}

async function _getActivePlan() {
  const db = wx.cloud.database();
  const res = await db.collection('plans')
    .where({ openid: getApp().globalData.openid, status: 'active' })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  return res.data[0] || null;
}

// 按 id 获取（计划详情页跳转用）
async function getPlanById(id) {
  const db = wx.cloud.database();
  const res = await db.collection('plans').doc(id).get();
  return res.data;
}

// ============================================================
// 本地规则编排：当前唯一的计划生成路径（纯前端，不依赖云函数）
//
// 为什么是规则而不是 AI：微信审核判定「AI 问答」等属深度合成类目，
// 个人主体未开放，V1.0.1 已移除 AI 相关功能（见 docs/REVIEW-AI-REMOVAL.md）。
// 这里的编排完全由确定性规则完成 —— 动作池按器械筛选，按目标决定分化，
// 按周推进容量与强度，不调用任何大模型，也不产生生成式内容。
// ============================================================

const GOAL_FOCUS = {
  fat_loss: ['全身循环燃脂', '下肢 + 有氧', '上肢 + 核心', '间歇燃脂'],
  muscle_gain: ['胸 / 三头', '背 / 二头', '腿 / 臀', '肩 / 核心'],
  endurance: ['心肺基础', '下肢耐力', '上肢耐力', '核心稳定'],
  posture: ['核心激活', '背部链激活', '髋部灵活', '肩颈放松']
};

const WEEK_FOCUS = ['动作模式建立', '容量积累', '强度提升', '巩固与冲刺'];
const SETS_BY_WEEK = [3, 3, 4, 4];
const REST_BY_WEEK = [75, 60, 60, 45];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// 按用户可用器械筛选动作池
function poolFor(profile) {
  const raw = profile && (profile.equipment || profile.equipments);
  const arr = Array.isArray(raw) ? raw : (raw ? [raw] : ['徒手']);
  const allowed = new Set(arr.length ? arr : ['徒手']);
  if (allowed.has('健身房')) return EX.exercises;
  const list = EX.exercises.filter(
    (e) => allowed.has(e.equipment) || e.equipment === '徒手'
  );
  return list.length ? list : EX.exercises;
}

function repsFor(ex) {
  if (ex.category === '核心') return 30;
  if (ex.category === '有氧') return 20;
  return 12;
}

// 轮转取 n 个动作，尽量覆盖不同肌群
function pickExercises(pool, seed, n) {
  const byCat = {};
  pool.forEach((e) => { (byCat[e.category] = byCat[e.category] || []).push(e); });
  const cats = Object.keys(byCat);
  const out = [];
  for (let i = 0; i < n; i++) {
    const cat = cats[(seed + i) % cats.length];
    const list = byCat[cat];
    const ex = list[(seed + Math.floor(i / cats.length)) % list.length];
    if (out.indexOf(ex) === -1) out.push(ex);
  }
  // 去重后不足则用整个池补齐
  for (let i = 0; out.length < n && i < pool.length; i++) {
    if (out.indexOf(pool[i]) === -1) out.push(pool[i]);
  }
  return out;
}

// 按档案编排一份 4 周计划（规则驱动，可离线单测）
function buildPlan(profile) {
  const pool = poolFor(profile);
  const daysPerWeek = clamp(Number(profile && profile.daysPerWeek) || 3, 1, 7);
  const goal = (profile && profile.goal) || 'fat_loss';
  const focusList = GOAL_FOCUS[goal] || GOAL_FOCUS.fat_loss;
  const structure = [];

  for (let w = 1; w <= 4; w++) {
    const days = [];
    for (let d = 1; d <= daysPerWeek; d++) {
      const seed = (w - 1) * daysPerWeek + (d - 1);
      const picked = pickExercises(pool, seed, 5);
      days.push({
        dayIndex: d,
        focus: focusList[seed % focusList.length],
        exercises: picked.map((ex) => ({
          exerciseId: ex.id,
          name: ex.name,
          sets: SETS_BY_WEEK[w - 1],
          reps: repsFor(ex),
          restSec: REST_BY_WEEK[w - 1]
        }))
      });
    }
    structure.push({ weekIndex: w, focus: WEEK_FOCUS[w - 1], days });
  }

  const goalText = { fat_loss: '减脂塑形', muscle_gain: '增肌变强', endurance: '提升体能', posture: '体态改善' }[goal] || '综合健身';
  return {
    planName: `${goalText} · 4 周计划`,
    summary: `按你的档案编排：每周 ${daysPerWeek} 天，4 周渐进。动作取自本地动作库，可在计划页换一份重新编排。`,
    weeks: 4,
    daysPerWeek,
    structure
  };
}

// 本地规则编排并直接写入 plans 集合（客户端直写，需要集合权限为「仅创建者可读写」）
async function createPlanLocal(profile) {
  const db = wx.cloud.database();
  const openid = getApp().globalData.openid;
  const plan = buildPlan(profile);
  const doc = Object.assign({}, plan, {
    openid,
    status: 'active',
    source: 'local-rule',
    createdAt: db.serverDate()
  });
  const res = await db.collection('plans').add({ data: doc });
  invalidatePlanCache(); // 新计划落库后清缓存，首页下次读取拿到新计划
  return Object.assign({ planId: res._id }, plan);
}

module.exports = {
  getActivePlan,
  getPlanById,
  buildPlan,
  createPlanLocal,
  invalidatePlanCache
};
