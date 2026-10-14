// services/progression.js — 渐进超负荷建议（V1.0.5）
//
// 这是「教练价值」的核心一块：把历史上练过的数据变成下一次的建议。
// 与 AI 无关，纯本地规则计算 —— 不联网、不上传、无审核风险（个人主体可用）。
//
// ── 规则为什么这样定（改之前先读）────────────────────────────────
// 数据库里每次训练只记了「这一组做没做」和「用了多少重量」，
// **没有记录实际做了几次**（见 components/set-input：只 emit done + weightKg）。
// 所以不能照搬教科书上的 double progression（"做到次数上限再加重量"）——
// 我们拿不到次数字段，只能用「是否做满计划组数」当达标信号。
//
// 规则（健身房里最保守也最通用的做法）：
//   1. 没有历史        → 不给建议（第一次就指手画脚只会帮倒忙）
//   2. 上次没做满组数  → 保持重量，先把组数补齐
//   3. 上次做满、上上次没做满（首次达标）→ 保持重量，再做满一次才加
//      —— 一次达标可能是状态好，两次才是能力；冒进加重最容易让人在第三组崩掉
//   4. 连续两次「同一重量」做满 → 加重量（≤20kg 加 2.5kg，>20kg 加 5kg）
//      —— 强调同重量：上次 50kg、上上次 60kg 说明 60 太重降下来了，这次该稳住 50
//      而不是接着加（用户自己加重的情形同理，先稳住一次）
//   5. 徒手动作（allowWeight=false）→ 不给重量，改为建议每组 +2 次
//   6. 重量动作但历史里没有重量记录 → 提示先记录重量（没有基准就无法加重）
//
// 单位：库里一律存 kg（与 services/units.js 同一约定），只在生成文案时按用户单位换算。

const units = require('./units.js');

const DEFAULT_TARGET_SETS = 3;
const MAX_WEIGHT_KG = 300;   // 与 units.KG_MAX 对齐，避免建议出一个输入框填不进去的值
const BODYWEIGHT_REP_STEP = 2; // 徒手动作每次建议增加的次数

// 加重的幅度：轻重量加 2.5kg（哑铃/小杠铃的最小增量），中重量加 5kg
function incrementFor(weightKg) {
  const w = Number(weightKg);
  if (!isFinite(w) || w <= 0) return 2.5;
  return w < 20 ? 2.5 : 5;
}

function round1(n) {
  const num = Number(n);
  if (!isFinite(num)) return 0;
  return Math.round(num * 10) / 10;
}

// 解析计划里的次数描述：12 → {min:12,max:12}；'8-12' → {min:8,max:12}；'30秒' → {min:30,max:30}
// 解析不出来返回 null（不猜）
function parseReps(reps) {
  if (reps === null || reps === undefined) return null;
  const nums = String(reps).match(/\d+/g);
  if (!nums || !nums.length) return null;
  const min = Number(nums[0]);
  const max = nums.length > 1 ? Number(nums[1]) : min;
  if (!isFinite(min) || min <= 0) return null;
  return { min, max: Math.max(min, isFinite(max) ? max : min) };
}

// 取一组里用的最大重量（kg）。空值/0 都视为「没记重量」
function topWeightOf(sets) {
  let top = null;
  (sets || []).forEach((s) => {
    if (!s || !s.done) return;
    const w = Number(s.weightKg);
    if (!isFinite(w) || w <= 0) return;
    if (top === null || w > top) top = w;
  });
  return top;
}

// 把「一条日志里的某个动作」压成一行摘要
function summarizeEntry(log, exerciseId) {
  const entry = ((log && log.exercises) || []).find((e) => e && e.exerciseId === exerciseId);
  if (!entry) return null;
  const sets = entry.sets || [];
  const doneSets = sets.filter((s) => s && s.done).length;
  return {
    date: (log && log.date) || '',
    targetSets: Number(entry.targetSets) || sets.length || DEFAULT_TARGET_SETS,
    reps: parseReps(entry.reps),
    doneSets,
    topWeight: topWeightOf(sets)
  };
}

// 某动作的历次记录（按日期升序，最近的排在最后）
// excludeDate：排除某一天 —— 跟练页要的是「上次」，今天已打卡的那条不能算
function historyOf(logs, exerciseId, options) {
  const o = options || {};
  const out = [];
  (logs || []).forEach((log) => {
    if (!log) return;
    if (o.excludeDate && log.date === o.excludeDate) return;
    const sum = summarizeEntry(log, exerciseId);
    if (!sum || sum.doneSets <= 0) return; // 没练这个动作 / 一组都没勾，不算历史
    out.push(sum);
  });
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * 生成建议。
 * @param {Object} input
 *   history     {Array}  historyOf() 的结果（升序）
 *   targetSets  {Number} 本次计划的组数
 *   reps        {Number|String} 本次计划的次数
 *   allowWeight {Boolean} 是否记录重量（徒手动作为 false）
 *   unit        {String}  展示单位 kg / lb
 * @returns {Object|null} null 表示没有历史、不给建议
 */
function suggest(input) {
  const o = input || {};
  const unit = units.label(o.unit);
  const history = Array.isArray(o.history) ? o.history : [];
  const last = history[history.length - 1];
  if (!last) return null;

  const target = Number(o.targetSets) || last.targetSets || DEFAULT_TARGET_SETS;
  const allowWeight = o.allowWeight !== false;
  const lastText = last.topWeight === null
    ? `上次 ${last.doneSets} 组`
    : `上次 ${last.doneSets} 组 · ${units.formatWeight(last.topWeight, unit)}`;

  // 徒手动作：没有重量维度，改用次数递进
  if (!allowWeight) {
    const reps = parseReps(o.reps) || last.reps;
    if (last.doneSets < target) {
      return {
        status: 'hold',
        weightKg: null,
        repsTarget: reps ? reps.min : null,
        targetSets: target,
        canApply: false,
        title: `先把 ${target} 组做满`,
        reason: `上次完成 ${last.doneSets}/${target} 组`,
        lastText,
        last
      };
    }
    const nextReps = reps ? reps.max + BODYWEIGHT_REP_STEP : null;
    return {
      status: 'reps-up',
      weightKg: null,
      repsTarget: nextReps,
      targetSets: target,
      canApply: false,
      title: nextReps ? `建议每组 ${nextReps} 次` : `建议每组多做 ${BODYWEIGHT_REP_STEP} 次`,
      reason: `上次做满 ${target} 组，试试提高次数`,
      lastText,
      last
    };
  }

  // 重量动作但没记过重量：没有基准，给不出加重建议
  if (last.topWeight === null) {
    return {
      status: 'no-weight',
      weightKg: null,
      targetSets: target,
      canApply: false,
      title: '先把重量记下来',
      reason: '记录一次重量后，这里就会给出加重建议',
      lastText,
      last
    };
  }

  const prev = history[history.length - 2];

  // 上次没做满 → 保持重量，先补组数
  if (last.doneSets < target) {
    return {
      status: 'hold',
      weightKg: last.topWeight,
      targetSets: target,
      canApply: true,
      title: `建议保持 ${units.formatWeight(last.topWeight, unit)}`,
      reason: `上次完成 ${last.doneSets}/${target} 组，先把组数补齐`,
      lastText,
      last
    };
  }

  // 连续两次「同一重量」做满 → 加重。
  // 必须同重量：如果上次是 50kg、上上次是 60kg（说明 60 太重降下来了），
  // 那这次该稳住 50kg 而不是接着加；用户自己加重的情形也一样，先让他稳住一次。
  const twiceHit = !!(prev && prev.doneSets >= target && prev.topWeight === last.topWeight);
  if (twiceHit) {
    const next = Math.min(round1(last.topWeight + incrementFor(last.topWeight)), MAX_WEIGHT_KG);
    return {
      status: 'up',
      weightKg: next,
      deltaKg: round1(next - last.topWeight),
      targetSets: target,
      canApply: true,
      title: `建议加到 ${units.formatWeight(next, unit)}`,
      reason: `连续两次做满 ${target} 组，可以加重了`,
      lastText,
      last
    };
  }

  // 首次做满 → 稳住一次再加
  return {
    status: 'hold',
    weightKg: last.topWeight,
    targetSets: target,
    canApply: true,
    title: `建议保持 ${units.formatWeight(last.topWeight, unit)}`,
    reason: `上次做满 ${target} 组，再做满一次就加重量`,
    lastText,
    last
  };
}

// 记录详情里「比上次」的对比文案
// current / previous 都是 summarizeEntry 的结果
function compare(current, previous, unit) {
  const u = units.label(unit);
  if (!current) return { text: '', tone: '' };
  if (!previous) return { text: '首次记录', tone: 'flat' };

  const a = current.topWeight;
  const b = previous.topWeight;
  if (a === null || b === null) {
    // 没有重量可比，就比组数
    const d = current.doneSets - previous.doneSets;
    if (d === 0) return { text: '组数与上次持平', tone: 'flat' };
    return { text: d > 0 ? `比上次多 ${d} 组` : `比上次少 ${-d} 组`, tone: d > 0 ? 'up' : 'down' };
  }
  const delta = round1(a - b);
  if (delta === 0) return { text: '重量与上次持平', tone: 'flat' };
  const shown = units.toDisplay(Math.abs(delta), u);
  return {
    text: delta > 0 ? `比上次 +${shown} ${u}` : `比上次 −${shown} ${u}`,
    tone: delta > 0 ? 'up' : 'down'
  };
}

module.exports = {
  incrementFor,
  parseReps,
  summarizeEntry,
  historyOf,
  suggest,
  compare,
  MAX_WEIGHT_KG,
  BODYWEIGHT_REP_STEP,
  _internal: { round1, topWeightOf, DEFAULT_TARGET_SETS }
};
