/**
 * tools/gen-badges-preview.js — 从真实徽章定义生成视觉预览
 *
 * 与 gen-legal-preview.js / gen-skeleton-preview.js 同一思路：
 * 徽章的名称、图标、阈值、分组全部 require 真实模块，
 * 预览不可能和 services/badges.js 漂移（改阈值/改名后重跑即可）。
 *
 * 用法：node tools/gen-badges-preview.js
 * 输出：docs/preview-badges.html
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const badges = require(path.join(ROOT, 'miniprogram/services/badges.js'));

const OUT = path.join(ROOT, 'docs/preview-badges.html');

const px = (rpx) => `${Number(rpx) / 2}px`;
const esc = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

// 预览用的三个状态。metrics/hwm 的形状与 buildMetrics 一致。
const STATES = [
  {
    tag: '刚开始练',
    note: '建档 + 打卡 2 次：解锁 2 / 13',
    metrics: { hasProfile: true, totalCheckins: 2, bestStreak: 2, totalMin: 55, totalSets: 18, monthCount: 2, favCount: 1 },
    newIds: ['profile_done', 'first_checkin'],
    unlockedAt: '10月8日'
  },
  {
    tag: '练了两个月',
    note: '本次刚跨过两个阈值：新解锁 2 枚（绿色描边）',
    metrics: { hasProfile: true, totalCheckins: 28, bestStreak: 9, totalMin: 620, totalSets: 410, monthCount: 8, favCount: 6 },
    newIds: ['time_10h', 'fav_5'],
    unlockedAt: '10月8日'
  },
  {
    tag: '全部达成',
    note: '13 / 13，顶部换成「下一个目标」的完成态',
    metrics: { hasProfile: true, totalCheckins: 120, bestStreak: 32, totalMin: 3600, totalSets: 1200, monthCount: 14, favCount: 8 },
    newIds: [],
    unlockedAt: '9月28日'
  }
];

function buildState(state) {
  const list = badges.evaluate(state.metrics, state.metrics);
  list.forEach((b) => {
    b.isNew = state.newIds.indexOf(b.id) >= 0;
    b.unlockedText = b.unlocked ? `解锁于 ${state.unlockedAt}` : '';
  });
  const unlockedCount = list.filter((b) => b.unlocked).length;
  const locked = list.filter((b) => !b.unlocked);
  const next = locked.length
    ? locked.reduce((a, b) => (b.percent > a.percent ? b : a), locked[0])
    : null;
  return {
    tag: state.tag,
    note: state.note,
    groups: badges.groupList(list),
    unlockedCount,
    total: badges.TOTAL,
    percent: Math.round((unlockedCount / badges.TOTAL) * 100),
    next,
    newly: list.filter((b) => b.isNew).map((b) => b.name)
  };
}

function tile(b) {
  const foot = b.unlocked
    ? `<div class="tile-foot tile-unlocked">✓ ${esc(b.unlockedText)}</div>`
    : `<div class="tile-bar"><div class="tile-fill" style="width:${b.percent}%"></div></div>
       <div class="tile-foot">${esc(b.remainText)}</div>`;
  return `<div class="tile ${b.unlocked ? 'on' : ''} ${b.isNew ? 'is-new' : ''}">
    <div class="tile-icon">${b.icon}</div>
    <div class="tile-name">${esc(b.name)}</div>
    <div class="tile-desc">${esc(b.desc)}</div>
    ${foot}
  </div>`;
}

function renderScreen(s) {
  const newCard = s.newly.length
    ? `<div class="new-card"><span class="new-icon">🎉</span><span class="new-text">新解锁 ${s.newly.length} 枚：${esc(s.newly.join('、'))}</span></div>`
    : '';
  const nextCard = s.next
    ? `<div class="card next-card">
        <div class="next-head"><span class="next-label">下一个目标</span><span class="next-remain">${esc(s.next.remainText)}</span></div>
        <div class="next-body">
          <div class="next-icon">${s.next.icon}</div>
          <div class="next-main">
            <div class="next-name">${esc(s.next.name)}</div>
            <div class="next-desc">${esc(s.next.desc)}</div>
            <div class="next-bar"><div class="next-fill" style="width:${s.next.percent}%"></div></div>
          </div>
        </div>
      </div>`
    : `<div class="card next-card all-done-card"><span class="all-done-icon">🏆</span><span class="all-done-text">全部 ${s.total} 枚徽章已解锁，你就是自己的教练</span></div>`;

  const groups = s.groups.map((g) => `
    <div class="card">
      <div class="card-header"><span class="card-title">${esc(g.title)}</span><span class="card-stat">${g.items.length} 枚</span></div>
      <div class="tiles">${g.items.map(tile).join('')}</div>
    </div>`).join('');

  return `
    <div class="hero">
      <div class="hero-row">
        <div class="hero-main">
          <div class="hero-num">${s.unlockedCount}<span class="hero-total">/ ${s.total}</span></div>
          <div class="hero-label">已解锁徽章</div>
        </div>
        <div class="hero-badge">🏅</div>
      </div>
      <div class="hero-track"><div class="hero-fill" style="width:${s.percent}%"></div></div>
    </div>
    <div class="body">
      ${newCard}
      ${nextCard}
      ${groups}
      <div class="footnote">徽章依据最近 365 天的训练记录判定，已解锁的徽章永久保留</div>
    </div>`;
}

const SCREENS = STATES.map(buildState);
const phones = SCREENS.map((s, i) => `
  <div class="col">
    <div class="phone">
      <div class="navbar">成就徽章</div>
      <div class="screen scroll">
        <span class="state-tag">${esc(s.tag)}</span>
        ${renderScreen(s)}
      </div>
    </div>
    <div class="cap">${['①', '②', '③'][i]} ${esc(s.note)}</div>
  </div>`).join('');

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>成就徽章 · 视觉预览</title>
<style>
  /* 本文件由 tools/gen-badges-preview.js 生成，请勿手改 —— 改 services/badges.js 后重跑脚本 */
  :root {
    --color-primary: #10b981;
    --color-primary-dark: #059669;
    --color-text: #1f2937;
    --color-text-secondary: #6b7280;
    --color-text-light: #9ca3af;
    --color-bg: #f5f6f8;
    --color-card: #ffffff;
    --color-border: #e5e7eb;
    --radius-base: 6px;
    --radius-lg: 10px;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: #eceef1; padding: 28px 16px 60px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', sans-serif;
    color: var(--color-text); }
  h1.pagetitle { text-align: center; font-size: 18px; margin: 0 0 6px; }
  .pagesub { text-align: center; font-size: 12px; color: #6b7280; margin-bottom: 22px; }
  .wrap { display: flex; flex-wrap: wrap; gap: 26px; justify-content: center; align-items: flex-start; }
  .phone { width: 375px; background: var(--color-bg); border-radius: 22px; overflow: hidden;
    box-shadow: 0 10px 32px rgba(0,0,0,.14); position: relative; }
  .navbar { height: 40px; background: #111827; color: #fff; display: flex; align-items: center;
    justify-content: center; font-size: 15px; font-weight: 600; }
  .screen { height: 700px; overflow-y: auto; position: relative; }
  .cap { text-align: center; font-size: 12px; color: #6b7280; margin-top: 10px; max-width: 375px; line-height: 1.6; }
  .state-tag { position: absolute; top: 10px; right: 12px; z-index: 2; background: rgba(0,0,0,.62); color: #fff;
    font-size: 11px; padding: 3px 10px; border-radius: 999px; }

  .hero { background: linear-gradient(135deg, #111827 0%, #1f2937 60%, #059669 135%);
    padding: ${px(40)} ${px(32)} ${px(44)}; color: #fff; }
  .hero-row { display: flex; align-items: center; }
  .hero-main { flex: 1; }
  .hero-num { font-size: ${px(64)}; font-weight: 700; line-height: 1.1; }
  .hero-total { font-size: ${px(28)}; font-weight: 400; opacity: .65; margin-left: ${px(8)}; }
  .hero-label { font-size: ${px(24)}; opacity: .75; margin-top: ${px(8)}; }
  .hero-badge { font-size: ${px(64)}; opacity: .9; }
  .hero-track { height: ${px(12)}; border-radius: 4px; background: rgba(255,255,255,.2);
    margin-top: ${px(28)}; overflow: hidden; }
  .hero-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg, #34d399, #10b981); }

  .body { padding-bottom: ${px(60)}; }
  .new-card { display: flex; align-items: center; margin: ${px(24)} ${px(32)} 0; padding: ${px(20)} ${px(24)};
    background: linear-gradient(135deg, #fef3c7, #fde68a); border: 1px solid #fcd34d; border-radius: var(--radius-base); }
  .new-icon { font-size: ${px(32)}; margin-right: ${px(12)}; }
  .new-text { flex: 1; font-size: ${px(24)}; color: #92400e; line-height: 1.5; }

  .card { background: #fff; border-radius: var(--radius-lg); padding: ${px(28)} ${px(32)} ${px(32)};
    margin: ${px(24)} ${px(32)}; box-shadow: 0 1px 6px rgba(0,0,0,.04); }
  .next-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: ${px(20)}; }
  .next-label { font-size: ${px(24)}; color: var(--color-text-secondary); }
  .next-remain { font-size: ${px(24)}; color: var(--color-primary-dark); font-weight: 600; }
  .next-body { display: flex; align-items: center; }
  .next-icon { width: ${px(88)}; height: ${px(88)}; border-radius: 50%; background: var(--color-bg);
    display: flex; align-items: center; justify-content: center; font-size: ${px(44)};
    flex-shrink: 0; margin-right: ${px(24)}; }
  .next-main { flex: 1; min-width: 0; }
  .next-name { font-size: ${px(28)}; font-weight: 600; }
  .next-desc { font-size: ${px(24)}; color: var(--color-text-secondary); margin-top: ${px(6)}; }
  .next-bar { height: ${px(12)}; border-radius: 4px; background: var(--color-border); margin-top: ${px(16)}; overflow: hidden; }
  .next-fill { height: 100%; border-radius: 4px; background: var(--color-primary); }
  .all-done-card { display: flex; align-items: center; justify-content: center; padding: ${px(40)} ${px(32)}; }
  .all-done-icon { font-size: ${px(40)}; margin-right: ${px(16)}; }
  .all-done-text { font-size: ${px(28)}; font-weight: 600; }

  .card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: ${px(24)}; }
  .card-title { font-size: ${px(32)}; font-weight: 600; }
  .card-stat { font-size: ${px(24)}; color: var(--color-text-light); }

  .tiles { display: flex; flex-wrap: wrap; margin: -${px(8)}; }
  .tile { width: calc(50% - ${px(16)}); margin: ${px(8)}; padding: ${px(20)};
    background: #f7f8fa; border: 1px solid transparent; border-radius: var(--radius-base); }
  .tile.on { background: #fff; border-color: rgba(16,185,129,.35); box-shadow: 0 1px 5px rgba(16,185,129,.08); }
  .tile.is-new { border-color: var(--color-primary); background: #ecfdf5; }
  .tile-icon { width: ${px(64)}; height: ${px(64)}; border-radius: 50%; background: #e9ebef;
    display: flex; align-items: center; justify-content: center; font-size: ${px(34)};
    margin-bottom: ${px(16)}; filter: grayscale(1); opacity: .55; }
  .tile.on .tile-icon { background: #ecfdf5; filter: none; opacity: 1; }
  .tile-name { font-size: ${px(28)}; font-weight: 600; color: var(--color-text-light); }
  .tile.on .tile-name { color: var(--color-text); }
  .tile-desc { font-size: ${px(22)}; color: var(--color-text-light); line-height: 1.5; margin-top: ${px(6)}; min-height: ${px(66)}; }
  .tile-bar { height: ${px(8)}; border-radius: 3px; background: #e2e4e8; margin-top: ${px(12)}; overflow: hidden; }
  .tile-fill { height: 100%; border-radius: 3px; background: var(--color-primary); }
  .tile-foot { font-size: ${px(20)}; color: var(--color-text-light); margin-top: ${px(12)}; }
  .tile-unlocked { color: var(--color-primary-dark); }
  .footnote { text-align: center; font-size: ${px(22)}; color: var(--color-text-light); margin-top: ${px(32)}; padding: 0 ${px(48)}; line-height: 1.6; }
</style>
</head>
<body>
  <h1 class="pagetitle">成就徽章 · 视觉预览</h1>
  <div class="pagesub">由 tools/gen-badges-preview.js 从 services/badges.js 真实定义生成 ·
    共 ${badges.TOTAL} 枚 / ${badges.GROUPS.length} 个分组</div>
  <div class="wrap">${phones}</div>
</body>
</html>
`;

fs.writeFileSync(OUT, HTML, 'utf8');
console.log(`已生成 ${path.relative(ROOT, OUT)} —— ${badges.TOTAL} 枚徽章 / ${badges.GROUPS.length} 个分组，${SCREENS.length} 个状态`);
