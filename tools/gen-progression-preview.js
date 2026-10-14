/**
 * tools/gen-progression-preview.js — 从真实规则生成视觉预览
 *
 * 与 gen-badges-preview.js / gen-legal-preview.js 同一思路：预览里的每一句建议文案
 * 都由 services/progression.js 真实算出来，不手写、不拍脑袋 —— 改规则后重跑即可，
 * 预览不可能与代码漂移。
 *
 * 用法：node tools/gen-progression-preview.js
 * 输出：docs/preview-progression.html
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const progression = require(path.join(ROOT, 'miniprogram/services/progression.js'));
const units = require(path.join(ROOT, 'miniprogram/services/units.js'));

const OUT = path.join(ROOT, 'docs/preview-progression.html');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

// 构造训练历史：与 workout_logs.exercises 同结构
function log(date, exs) {
  return { _id: 'log-' + date, date, focus: '胸 / 三头', durationMin: 32, exercises: exs };
}
function ex(exerciseId, name, weights, done, opts) {
  const o = opts || {};
  return {
    exerciseId,
    name,
    targetSets: o.targetSets || weights.length,
    reps: o.reps === undefined ? 12 : o.reps,
    sets: weights.map((w, i) => ({ done: i < (done === undefined ? weights.length : done), weightKg: w }))
  };
}

// 四个场景覆盖全部建议分支（scenario 字段就是 suggest() 的输入）
const SCENARIOS = [
  {
    tag: '首次做这个动作',
    note: '没有历史 → 不给建议（第一次就指手画脚只会帮倒忙）',
    allowWeight: true,
    targetSets: 3,
    reps: 12,
    logs: []
  },
  {
    tag: '上次没做满',
    note: '上次 2/3 组 → 保持重量，先把组数补齐',
    allowWeight: true,
    targetSets: 3,
    reps: 12,
    logs: [log('2026-10-09', [ex('dumbbell_row', '哑铃划船', [10, 10, 10], 2)])]
  },
  {
    tag: '首次做满',
    note: '上次做满、更早一次没做满 → 稳住一次再加',
    allowWeight: true,
    targetSets: 3,
    reps: 12,
    logs: [
      log('2026-10-07', [ex('dumbbell_row', '哑铃划船', [10, 10, 10], 2)]),
      log('2026-10-09', [ex('dumbbell_row', '哑铃划船', [10, 10, 10], 3)])
    ]
  },
  {
    tag: '连续两次做满',
    note: '同一重量连续两次做满 → 加重量（轻重量 +2.5kg）',
    allowWeight: true,
    targetSets: 3,
    reps: 12,
    logs: [
      log('2026-10-07', [ex('dumbbell_row', '哑铃划船', [10, 10, 10], 3)]),
      log('2026-10-09', [ex('dumbbell_row', '哑铃划船', [10, 10, 10], 3)])
    ]
  },
  {
    tag: '大重量（>20kg）',
    note: '加重幅度变成 +5kg',
    allowWeight: true,
    targetSets: 3,
    reps: 8,
    logs: [
      log('2026-10-07', [ex('barbell_squat', '杠铃深蹲', [60, 60, 60], 3, { reps: 8 })]),
      log('2026-10-09', [ex('barbell_squat', '杠铃深蹲', [60, 60, 60], 3, { reps: 8 })])
    ],
    exerciseId: 'barbell_squat',
    name: '杠铃深蹲'
  },
  {
    tag: '徒手动作',
    note: '没有重量维度 → 改为建议每组 +2 次',
    allowWeight: false,
    targetSets: 3,
    reps: 12,
    logs: [log('2026-10-09', [ex('pushup', '标准俯卧撑', [null, null, null], 3)])],
    exerciseId: 'pushup',
    name: '标准俯卧撑'
  },
  {
    tag: '练过但没记重量',
    note: '没有基准就算不出加重幅度 → 提示先记重量',
    allowWeight: true,
    targetSets: 3,
    reps: 12,
    logs: [log('2026-10-09', [ex('dumbbell_row', '哑铃划船', [null, null, null], 3)])]
  }
];

function build(scenario) {
  const exId = scenario.exerciseId || 'dumbbell_row';
  const name = scenario.name || '哑铃划船';
  const history = progression.historyOf(scenario.logs, exId);
  const suggest = progression.suggest({
    history,
    targetSets: scenario.targetSets,
    reps: scenario.reps,
    allowWeight: scenario.allowWeight,
    unit: 'kg'
  });
  // 记录详情页的「比上次」：拿本次与更早一次对比
  const current = history[history.length - 1] || null;
  const before = history.length > 1 ? history[history.length - 2] : null;
  const compare = progression.compare(current, before, 'kg');
  return { scenario, name, suggest, compare, current, before };
}

function suggestHtml(s) {
  if (!s) {
    return `<div class="sg-none">本次不显示建议条（没有历史记录）</div>`;
  }
  const apply = s.canApply ? `<div class="sg-apply">套用</div>` : '';
  return `<div class="sg-row sg-${esc(s.status)}">
      <div class="sg-main">
        <div class="sg-title">${esc(s.title)}</div>
        <div class="sg-reason">${esc(s.reason)} · ${esc(s.lastText)}</div>
      </div>
      ${apply}
    </div>`;
}

function card(r) {
  const s = r.suggest;
  const weights = s && s.weightKg !== null ? String(units.toDisplay(s.weightKg, 'kg')) : '';
  const rows = [1, 2, 3].map((i) => `
        <div class="set-row">
          <div class="set-no">第 ${i} 组</div>
          <div class="set-weight">${esc(weights)}</div>
          <div class="set-check">✓</div>
        </div>`).join('');

  const cmp = r.compare.text
    ? `<span class="cmp cmp-${esc(r.compare.tone)}">${esc(r.compare.text)}</span>`
    : '';

  return `
  <section class="case">
    <div class="case-head">
      <div class="case-tag">${esc(r.scenario.tag)}</div>
      <div class="case-note">${esc(r.scenario.note)}</div>
    </div>
    <div class="phone">
      <div class="card">
        <div class="ex-head">
          <div>
            <div class="ex-name">${esc(r.name)}</div>
            <div class="ex-target">${r.scenario.targetSets} 组 × ${esc(r.scenario.reps)} 次</div>
          </div>
          <div class="tips-btn">要点</div>
        </div>
        ${suggestHtml(s)}
        <div class="set-list">${rows}
        </div>
        <div class="set-foot">
          <div class="set-step">−</div>
          <div class="set-count">3 组</div>
          <div class="set-step">+</div>
        </div>
      </div>
      <div class="record-line">记录详情里会写：${cmp || '<span class="cmp cmp-flat">首次记录</span>'}</div>
    </div>
  </section>`;
}

const cases = SCENARIOS.map((sc) => card(build(sc))).join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>渐进超负荷建议 · 视觉预览</title>
<style>
  :root {
    --primary: #10b981;
    --primary-dark: #059669;
    --accent: #f59e0b;
    --text: #1f2937;
    --text-2: #6b7280;
    --text-3: #9ca3af;
    --border: #e5e7eb;
    --bg: #f5f6f8;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px 20px 64px;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    font-size: 14px;
  }
  .page-head { max-width: 1120px; margin: 0 auto 28px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .sub { color: var(--text-2); line-height: 1.7; }
  .sub code { background: #fff; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--border); }
  .grid {
    max-width: 1120px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 20px;
  }
  .case { background: #fff; border-radius: 16px; padding: 18px; box-shadow: 0 2px 12px rgba(0,0,0,.05); }
  .case-head { margin-bottom: 14px; }
  .case-tag { font-weight: 700; font-size: 15px; }
  .case-note { color: var(--text-2); font-size: 13px; margin-top: 4px; line-height: 1.6; }
  .phone { background: var(--bg); border-radius: 12px; padding: 14px; }
  .card { background: #fff; border-radius: 12px; padding: 14px; }
  .ex-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
  .ex-name { font-size: 15px; font-weight: 700; }
  .ex-target { font-size: 12px; color: var(--text-2); margin-top: 3px; }
  .tips-btn {
    font-size: 12px; color: var(--primary); border: 1px solid var(--primary);
    border-radius: 999px; padding: 3px 11px; white-space: nowrap;
  }
  .sg-row {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 11px; border-radius: 8px; margin-bottom: 10px;
    background: rgba(16,185,129,.08); border-left: 3px solid var(--primary);
  }
  .sg-row.sg-hold, .sg-row.sg-no-weight {
    background: rgba(107,114,128,.08); border-left-color: var(--text-3);
  }
  .sg-row.sg-reps-up { background: rgba(245,158,11,.1); border-left-color: var(--accent); }
  .sg-main { flex: 1; min-width: 0; }
  .sg-title { font-size: 14px; font-weight: 600; }
  .sg-reason { font-size: 12px; color: var(--text-2); margin-top: 2px; }
  .sg-apply {
    flex-shrink: 0; background: var(--primary); color: #fff;
    font-size: 12px; padding: 5px 12px; border-radius: 999px;
  }
  .sg-none {
    padding: 9px 11px; border-radius: 8px; margin-bottom: 10px;
    background: #f3f4f6; color: var(--text-3); font-size: 12px;
  }
  .set-list { border-top: 1px solid var(--border); padding-top: 6px; }
  .set-row { display: flex; align-items: center; padding: 5px 0; font-size: 13px; }
  .set-no { color: var(--text-2); width: 64px; font-size: 12px; }
  .set-weight { flex: 1; font-variant-numeric: tabular-nums; }
  .set-check { color: var(--primary); }
  .set-foot {
    display: flex; align-items: center; justify-content: center; gap: 18px;
    margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border);
    color: var(--text-2); font-size: 13px;
  }
  .set-step {
    width: 26px; height: 26px; border-radius: 50%; background: #f3f4f6;
    display: flex; align-items: center; justify-content: center; font-weight: 700;
  }
  .record-line { margin-top: 12px; font-size: 12px; color: var(--text-2); }
  .cmp { display: inline-block; padding: 2px 9px; border-radius: 999px; font-weight: 600; }
  .cmp-up { color: var(--primary-dark); background: rgba(16,185,129,.12); }
  .cmp-down { color: #b45309; background: rgba(245,158,11,.14); }
  .cmp-flat { color: var(--text-2); background: rgba(107,114,128,.1); }
</style>
</head>
<body>
  <div class="page-head">
    <h1>渐进超负荷建议 · 视觉预览</h1>
    <div class="sub">
      本页所有文案由 <code>services/progression.js</code> 实时计算生成（跑 <code>node tools/gen-progression-preview.js</code> 重新生成）。<br />
      绿色 = 建议加重；灰色 = 保持；橙色 = 徒手加次数。规则依据：上一次是否做满计划组数、以及是否<b>同一重量连续两次</b>做满。
    </div>
  </div>
  <div class="grid">
${cases}
  </div>
</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf8');
console.log(`✅ 已生成 ${path.relative(ROOT, OUT)}`);
SCENARIOS.forEach((sc, i) => {
  const r = build(sc);
  const s = r.suggest;
  console.log(`   ${i + 1}. ${sc.tag} → ${s ? `${s.status}｜${s.title}` : '（无建议）'}`);
});
