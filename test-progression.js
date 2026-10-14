/**
 * test-progression.js — 渐进超负荷建议的单测（V1.0.5）
 * 覆盖：次数解析 / 历史抽取 / 三种建议分支 / 单位换算 / 脏数据与不改入参
 *
 * 为什么值得单测：这套规则决定「用户下次该加多少重量」，错一次可能就是让人
 * 在第三组崩掉（练不动 → 弃用）。而它全是纯函数，离线断言成本几乎为零。
 * 特别要钉住的两条：
 *   ① 连续两次做满才加重（一次达标可能是状态好，不是能力涨了）
 *   ② 单位是 lb 时，建议值必须跟着换算（否则提示 20 lb 实际存 20 kg）
 */
const path = require('path');
const MINIPROGRAM = path.resolve(__dirname, 'miniprogram');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`   ✅ ${name}`);
  } else {
    fail++;
    console.log(`   ❌ ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
  }
}
function eq(name, actual, expected) {
  ok(`${name}（期望 ${JSON.stringify(expected)}）`, actual === expected, actual);
}
function section(t) { console.log(`\n${t}`); }

// ---------- 内存版 wx 替身（units.js 读单位偏好用） ----------
const storeMap = {};
global.wx = {
  getStorageSync: (k) => (k in storeMap ? storeMap[k] : ''),
  setStorageSync: (k, v) => { storeMap[k] = v; },
  removeStorageSync: (k) => { delete storeMap[k]; }
};

const p = require(path.join(MINIPROGRAM, 'services/progression.js'));
const units = require(path.join(MINIPROGRAM, 'services/units.js'));

// ---------- 造数据 ----------
// 一条训练记录：{ date, focus, exercises: [{ exerciseId, name, targetSets, reps, sets }] }
function log(date, entries) {
  return { _id: 'log-' + date, date, focus: '胸', exercises: entries };
}
// 某个动作在一条日志里的样子：sets 传重量数组（null = 没填重量），doneCount 控制勾选数
function entry(exerciseId, weights, doneCount, opts) {
  const o = opts || {};
  const sets = weights.map((w, i) => ({ done: i < (doneCount === undefined ? weights.length : doneCount), weightKg: w }));
  return {
    exerciseId,
    name: o.name || exerciseId,
    targetSets: o.targetSets || weights.length,
    reps: o.reps === undefined ? 12 : o.reps,
    sets
  };
}

(async function run() {
  console.log('==================== 渐进超负荷单测 ====================');

  section('1. 次数解析 parseReps');
  eq('数字 12', JSON.stringify(p.parseReps(12)), JSON.stringify({ min: 12, max: 12 }));
  eq('区间字符串 8-12', JSON.stringify(p.parseReps('8-12')), JSON.stringify({ min: 8, max: 12 }));
  eq('单值字符串 10', JSON.stringify(p.parseReps('10')), JSON.stringify({ min: 10, max: 10 }));
  eq('带单位 30 秒', JSON.stringify(p.parseReps('30 秒')), JSON.stringify({ min: 30, max: 30 }));
  eq('颠倒的区间 12-8 会被纠正', JSON.stringify(p.parseReps('12-8')), JSON.stringify({ min: 12, max: 12 }));
  eq('空值返回 null', p.parseReps(null), null);
  eq('纯文字返回 null', p.parseReps('力竭'), null);
  eq('0 返回 null（不能给「每组 0 次」的建议）', p.parseReps(0), null);

  section('2. 加重幅度 incrementFor');
  eq('轻重量（10kg）加 2.5', p.incrementFor(10), 2.5);
  eq('20kg 加 5', p.incrementFor(20), 5);
  eq('大重量（60kg）加 5', p.incrementFor(60), 5);
  eq('没填重量时给 2.5 兜底', p.incrementFor(null), 2.5);

  section('3. 历史抽取 historyOf');
  const logs = [
    log('2026-10-01', [entry('pushup', [10, 10, 10]), entry('squat', [20, 20, 20])]),
    log('2026-10-03', [entry('pushup', [10, 10, null], 2)]),
    log('2026-10-05', [entry('squat', [22.5, 22.5, 22.5])]),
    log('2026-10-07', [entry('pushup', [10, 10, 10], 0)])  // 一组都没勾 → 不算历史
  ];
  const pushHistory = p.historyOf(logs, 'pushup');
  eq('只取练过该动作的记录（空勾选被排除）', pushHistory.length, 2);
  eq('按日期升序（最近在最后）', pushHistory[pushHistory.length - 1].date, '2026-10-03');
  eq('组数摘要正确', pushHistory[0].doneSets, 3);
  eq('最大重量取已勾选组', pushHistory[1].topWeight, 10);
  eq('目标组数沿用日志里的 targetSets', pushHistory[0].targetSets, 3);
  eq('别的动作不会串进来', p.historyOf(logs, 'squat').length, 2);
  eq('不存在的动作返回空数组', p.historyOf(logs, 'nope').length, 0);
  eq('脏数据（null 日志）不炸', p.historyOf([null, undefined, {}], 'pushup').length, 0);

  // excludeDate：跟练页要的是「上次」，今天已打卡那条不能算
  eq('excludeDate 排除当天', p.historyOf(logs, 'pushup', { excludeDate: '2026-10-03' }).length, 1);
  // 乱序输入也要按日期排好
  const shuffled = [logs[1], logs[0]];
  eq('乱序输入仍按日期升序',
    p.historyOf(shuffled, 'pushup').map((h) => h.date).join(','), '2026-10-01,2026-10-03');

  section('4. 建议：无历史');
  eq('第一次练这个动作 → 不给建议', p.suggest({ history: [], targetSets: 3, reps: 12, allowWeight: true }), null);
  eq('history 传 null 也不炸', p.suggest({ history: null, targetSets: 3 }), null);
  eq('空对象调用不炸', p.suggest(), null);

  section('5. 建议：上次没做满 → 保持重量');
  const sHold = p.suggest({
    history: p.historyOf(logs, 'pushup'),
    targetSets: 3,
    reps: 12,
    allowWeight: true
  });
  eq('状态为 hold', sHold.status, 'hold');
  eq('重量保持上次的 10kg', sHold.weightKg, 10);
  eq('可一键套用', sHold.canApply, true);
  ok('文案说明是「补齐组数」', sHold.reason.indexOf('2/3') > 0, sHold.reason);
  ok('带上「上次」信息', sHold.lastText.indexOf('上次 2 组') === 0, sHold.lastText);

  section('6. 建议：首次做满 → 稳住一次再加');
  const logsFull = [
    log('2026-10-01', [entry('pushup', [10, 10, null], 2)]),
    log('2026-10-03', [entry('pushup', [10, 10, 10])])
  ];
  const sFirst = p.suggest({ history: p.historyOf(logsFull, 'pushup'), targetSets: 3, reps: 12, allowWeight: true });
  eq('状态为 hold', sFirst.status, 'hold');
  eq('重量不涨', sFirst.weightKg, 10);
  ok('文案提示「再做满一次就加重量」', sFirst.reason.indexOf('再做满一次') > 0, sFirst.reason);

  section('7. 建议：连续两次做满 → 加重');
  const logsTwice = [
    log('2026-10-01', [entry('pushup', [10, 10, 10])]),
    log('2026-10-03', [entry('pushup', [10, 10, 10])])
  ];
  const sUp = p.suggest({ history: p.historyOf(logsTwice, 'pushup'), targetSets: 3, reps: 12, allowWeight: true });
  eq('状态为 up', sUp.status, 'up');
  eq('10kg → 12.5kg（轻重量加 2.5）', sUp.weightKg, 12.5);
  eq('增量字段正确', sUp.deltaKg, 2.5);
  ok('文案带「建议加到」', sUp.title.indexOf('建议加到') === 0, sUp.title);
  ok('理由写明连续两次做满', sUp.reason.indexOf('连续两次') === 0, sUp.reason);

  // 大重量：加 5kg
  const logsHeavy = [
    log('2026-10-01', [entry('squat', [60, 60, 60])]),
    log('2026-10-03', [entry('squat', [60, 60, 60])])
  ];
  const sHeavy = p.suggest({ history: p.historyOf(logsHeavy, 'squat'), targetSets: 3, reps: 12, allowWeight: true });
  eq('60kg → 65kg（大重量加 5）', sHeavy.weightKg, 65);

  // 中间有一次降了重量（60 → 50，说明 60 太重）→ 不加重，稳住当前重量
  const logsDip = [
    log('2026-10-01', [entry('squat', [60, 60, 60])]),
    log('2026-10-03', [entry('squat', [50, 50, 50])])
  ];
  const sDip = p.suggest({ history: p.historyOf(logsDip, 'squat'), targetSets: 3, reps: 12, allowWeight: true });
  eq('降过重量 → 不加回 55，回到 hold', sDip.status, 'hold');
  eq('保持 50kg', sDip.weightKg, 50);

  // 用户自己加重（10 → 12.5 且都做满）→ 也要先稳住一次，不当成「连续两次达标」
  const logsRaise = [
    log('2026-10-01', [entry('squat', [10, 10, 10])]),
    log('2026-10-03', [entry('squat', [12.5, 12.5, 12.5])])
  ];
  const sRaise = p.suggest({ history: p.historyOf(logsRaise, 'squat'), targetSets: 3, reps: 12, allowWeight: true });
  eq('自己加重后也要先稳住一次', sRaise.status, 'hold');
  eq('稳住 12.5kg', sRaise.weightKg, 12.5);
  // 第三次同样重量再做满 → 这才会加
  const logsTwiceAt125 = logsRaise.concat([log('2026-10-05', [entry('squat', [12.5, 12.5, 12.5])])]);
  const sUp125 = p.suggest({ history: p.historyOf(logsTwiceAt125, 'squat'), targetSets: 3, reps: 12, allowWeight: true });
  eq('同重量连续两次后加重', sUp125.status, 'up');
  eq('12.5 → 15', sUp125.weightKg, 15);

  // 封顶：不能建议超过输入框范围
  const logsMax = [
    log('2026-10-01', [entry('squat', [300, 300, 300])]),
    log('2026-10-03', [entry('squat', [300, 300, 300])])
  ];
  const sMax = p.suggest({ history: p.historyOf(logsMax, 'squat'), targetSets: 3, reps: 12, allowWeight: true });
  ok('不超过 300kg 上限', sMax.weightKg <= p.MAX_WEIGHT_KG, sMax.weightKg);
  eq('封顶后增量归零', sMax.deltaKg, 0);

  section('8. 建议：徒手动作按次数递进');
  const bodyLogs = [log('2026-10-01', [entry('pushup', [null, null, null], 3, { reps: 12 })])];
  const sBody = p.suggest({ history: p.historyOf(bodyLogs, 'pushup'), targetSets: 3, reps: 12, allowWeight: false });
  eq('状态为 reps-up', sBody.status, 'reps-up');
  eq('次数目标 12 → 14', sBody.repsTarget, 14);
  eq('不给重量', sBody.weightKg, null);
  eq('不能套用重量', sBody.canApply, false);
  ok('文案讲次数', sBody.title.indexOf('每组 14 次') > 0, sBody.title);

  const bodyShort = [log('2026-10-01', [entry('plank', [null, null, null], 1, { reps: 30 })])];
  const sBodyHold = p.suggest({ history: p.historyOf(bodyShort, 'plank'), targetSets: 3, reps: 30, allowWeight: false });
  eq('徒手没做满 → hold', sBodyHold.status, 'hold');
  ok('文案是「先把 N 组做满」', sBodyHold.title.indexOf('先把 3 组做满') === 0, sBodyHold.title);

  section('9. 建议：重量动作但没记过重量');
  const noWeightLogs = [log('2026-10-01', [entry('pushup', [null, null, null], 3)])];
  const sNoWeight = p.suggest({ history: p.historyOf(noWeightLogs, 'pushup'), targetSets: 3, reps: 12, allowWeight: true });
  eq('状态为 no-weight', sNoWeight.status, 'no-weight');
  eq('不给重量', sNoWeight.weightKg, null);
  eq('不能套用', sNoWeight.canApply, false);
  ok('提示先记重量', sNoWeight.title.indexOf('重量') > 0, sNoWeight.title);

  section('10. 单位换算（lb）');
  units.set('lb');
  const sLb = p.suggest({ history: p.historyOf(logsTwice, 'pushup'), targetSets: 3, reps: 12, allowWeight: true });
  eq('内部仍存 kg', sLb.weightKg, 12.5);
  ok('文案按 lb 显示（12.5kg ≈ 27.6lb）', sLb.title.indexOf('27.6') > 0, sLb.title);
  const cmpLb = p.compare({ doneSets: 3, topWeight: 12.5 }, { doneSets: 3, topWeight: 10 }, 'lb');
  ok('对比文案也按 lb', cmpLb.text.indexOf('5.5') > 0, cmpLb.text);
  units.set('kg');

  section('11. 对比文案 compare');
  eq('首次记录', p.compare({ doneSets: 3, topWeight: 10 }, null).text, '首次记录');
  eq('重量持平', p.compare({ doneSets: 3, topWeight: 10 }, { doneSets: 3, topWeight: 10 }).text, '重量与上次持平');
  eq('升重 tone = up', p.compare({ doneSets: 3, topWeight: 12.5 }, { doneSets: 3, topWeight: 10 }).tone, 'up');
  eq('降重 tone = down', p.compare({ doneSets: 3, topWeight: 7.5 }, { doneSets: 3, topWeight: 10 }).tone, 'down');
  ok('升重文案带 +', p.compare({ doneSets: 3, topWeight: 12.5 }, { doneSets: 3, topWeight: 10 }).text.indexOf('+2.5') > 0,
    p.compare({ doneSets: 3, topWeight: 12.5 }, { doneSets: 3, topWeight: 10 }).text);
  eq('无重量时比组数（多 1 组）', p.compare({ doneSets: 3, topWeight: null }, { doneSets: 2, topWeight: null }).text, '比上次多 1 组');
  eq('无重量时比组数（持平）', p.compare({ doneSets: 2, topWeight: null }, { doneSets: 2, topWeight: null }).text, '组数与上次持平');
  eq('current 为空返回空文案', p.compare(null, { doneSets: 3 }).text, '');

  section('12. 纯函数约定：不改入参');
  const snapshot = JSON.stringify(logs);
  p.historyOf(logs, 'pushup');
  p.suggest({ history: p.historyOf(logs, 'pushup'), targetSets: 3, reps: 12, allowWeight: true });
  eq('入参 logs 未被修改', JSON.stringify(logs), snapshot);

  console.log(`\n================ 结果：${pass} 通过 / ${fail} 失败 ================\n`);
  if (fail > 0) process.exit(1);
})();
