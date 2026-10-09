/**
 * tools/gen-skeleton-preview.js — 生成 docs/preview-skeleton.html
 *
 * 预览文件不手写：直接读 utils/skeleton.js 的 buildSpec()（真实版式描述）
 * 和 components/skeleton/skeleton.wxss（真实样式，rpx→px ×0.5），
 * 按 skeleton.wxml 的规则渲染成 HTML。这样代码改了预览自动跟着改，不会各自漂移。
 *
 * 运行：node tools/gen-skeleton-preview.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MINIPROGRAM = path.join(ROOT, 'miniprogram');
const sk = require(path.join(MINIPROGRAM, 'utils/skeleton.js'));

const RPX = 0.5; // 375px 宽下 1rpx = 0.5px

function rpx(v) {
  const m = String(v).match(/^(-?[\d.]+)rpx$/);
  return m ? `${Number(m[1]) * RPX}px` : v;
}

// WXSS → CSS：rpx 换 px，其余原样
function convertWxss(src) {
  return src.replace(/(-?[\d.]+)rpx/g, (_, n) => `${Number(n) * RPX}px`);
}

// ---------- 按 skeleton.wxml 的规则把 spec 渲染成 HTML ----------
function esc(s) { return String(s); }

function renderBlock(b) {
  switch (b.type) {
    case 'hero':
      return '<div class="sk-hero">' +
        b.widths.map((w) => `<div class="sh-dark sk-hero-line" style="width:${rpx(w)}"></div>`).join('') +
        (b.progress ? '<div class="sk-hero-track"><div class="sh-dark sk-hero-track-inner"></div></div>' : '') +
        '</div>';

    case 'head':
      return `<div class="sk-head"><div class="sk sh sk-t" style="width:${rpx(b.w + 'rpx')}"></div>` +
        (b.right ? `<div class="sk sh sk-t" style="width:${rpx(b.right + 'rpx')}"></div>` : '') +
        '</div>';

    case 'lines':
      return `<div class="sk-lines${b.tint ? ' sk-tint' : ''}">${b.widths.map((w) =>
        `<div class="sk sh sk-line" style="width:${rpx(w)}"></div>`).join('')}</div>`;

    case 'ring':
      return '<div class="sk-ring-wrap"><div class="sk sh sk-ring"></div>' +
        '<div class="sk-ring-lines">' +
        `<div class="sk sh sk-line" style="width:${rpx(b.w1)}"></div>` +
        `<div class="sk sh sk-line" style="width:${rpx(b.w2)}"></div>` +
        '</div></div>';

    case 'grid':
      return `<div class="sk-grid">${b.cells.map(() =>
        '<div class="sk-grid-item"><div class="sk sh sk-num"></div>' +
        '<div class="sk sh sk-line sk-line-sm"></div></div>').join('')}</div>`;

    case 'tiles':
      return `<div class="sk-tiles">${b.items.map(() =>
        '<div class="sk-tile"><div class="sk sh sk-tile-icon"></div>' +
        '<div class="sk sh sk-line" style="width:74%"></div>' +
        '<div class="sk sh sk-line sk-line-sm" style="width:46%"></div></div>').join('')}</div>`;

    case 'chart':
      return `<div class="sk-chart">${b.bars.map((h) =>
        `<div class="sk-bar-col"><div class="sk sh sk-bar" style="height:${h}%"></div></div>`).join('')}</div>`;

    case 'heat':
      return `<div class="sk-heat">${b.cols.map(() =>
        `<div class="sk-heat-col">${b.days.map(() =>
          '<div class="sk sh sk-cell"></div>').join('')}</div>`).join('')}</div>`;

    case 'cal':
      return `<div class="sk-cal">${b.rows.map(() =>
        `<div class="sk-cal-row">${b.days.map(() =>
          '<div class="sk-cal-cell"><div class="sk sh sk-sq"></div></div>').join('')}</div>`).join('')}</div>`;

    case 'rows':
      return `<div class="sk-rows">${b.items.map(() =>
        '<div class="sk-row">' +
        (b.avatar ? '<div class="sk sh sk-thumb"></div>' : '') +
        (b.lead ? `<div class="sk sh sk-line sk-lead" style="width:${rpx(b.lead)}"></div>` : '') +
        `<div class="sk-row-main"><div class="sk sh sk-line" style="width:${esc(b.w1)}"></div>` +
        `<div class="sk sh sk-line" style="width:${esc(b.w2)}"></div></div></div>`).join('')}</div>`;

    case 'kv':
      return `<div class="sk-rows">${b.items.map(() =>
        '<div class="sk-kv-row">' +
        `<div class="sk sh sk-line" style="width:${rpx(b.w1)}"></div>` +
        `<div class="sk sh sk-line" style="width:${rpx(b.w2)}"></div></div>`).join('')}</div>`;

    case 'dots':
      return `<div class="sk-dots">${b.items.map(() =>
        '<div class="sk-dot-item"><div class="sk sh sk-dot"></div></div>').join('')}</div>`;

    case 'tools':
      return `<div class="sk-tools">${b.items.map(() =>
        '<div class="sk-tool"><div class="sk sh sk-icon"></div>' +
        '<div class="sk sh sk-line sk-line-sm"></div></div>').join('')}</div>`;

    case 'tabs':
      return `<div class="sk-tabs">${b.items.map(() =>
        '<div class="sk sh sk-pill"></div>').join('')}</div>`;

    case 'sets':
      return `<div class="sk-sets">${b.items.map(() =>
        '<div class="sk sh sk-chip"></div>').join('')}</div>`;

    case 'buttons':
      return `<div class="sk-btns">${b.items.map(() =>
        '<div class="sk sh sk-btn"></div>').join('')}</div>`;

    case 'button':
      return '<div class="sk sh sk-btn sk-btn-full"></div>';

    case 'bar':
      return '<div class="sk sh sk-progress"></div>';

    default:
      return `<!-- 未支持的块类型 ${b.type} -->`;
  }
}

function renderSkeleton(variant, rows) {
  const cards = sk.buildSpec(variant, rows);
  const v = sk.normalizeVariant(variant);
  return `<div class="sk-page sk-${v}">${cards.map((c) =>
    `<div class="${c.bare ? 'sk-bare' : 'sk-card'}">${c.blocks.map(renderBlock).join('')}</div>`).join('')}</div>`;
}

// ---------- 页面外壳 ----------
const PAGES = [
  { variant: 'training', title: '', caption: '训练首页（主包）', hero: true },
  { variant: 'stats', title: '数据看板', caption: '数据看板 · 5 张卡' },
  { variant: 'body', title: '身体记录', caption: '身体记录 · 卡片间距与其他页不同（已跟随）' },
  { variant: 'plan', title: '训练计划', caption: '训练计划 · 头部 + 周切换 + 3 个训练日' },
  { variant: 'workout', title: '跟练打卡', caption: '跟练打卡 · 进度 + 3 个动作' },
  { variant: 'badge', title: '成就徽章', caption: '成就徽章 · 概览 + 两个分组栅格（tiles 块）' },
  { variant: 'card', title: '训练提醒', caption: '训练提醒 · 设置 / 自检两张卡' }
];

const phones = PAGES.map((p) => `
  <div class="col">
    <div class="phone">
      ${p.hero ? '' : `<div class="navbar">${p.title}</div>`}
      <div class="screen ${p.hero ? 'screen-hero' : ''}">
        ${p.hero
          ? `<div class="hero"><div class="hero-date">2026年10月8日 星期四</div>
               <div class="hero-title">下午好，健身搭子</div>
               <div class="hero-sub">今天也要元气满满地动起来 💪</div></div>`
          : ''}
        ${renderSkeleton(p.variant)}
      </div>
    </div>
    <div class="cap">${p.caption}</div>
  </div>`).join('');

const wxss = convertWxss(
  fs.readFileSync(path.join(MINIPROGRAM, 'components/skeleton/skeleton.wxss'), 'utf8')
);

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>骨架屏 · 视觉预览（7 个页面 + 延迟显示演示）</title>
<style>
  /* rpx → px 按 1rpx = 0.5px 换算，375px 宽模拟 iPhone，与小程序真机一致。
     下方 .sk-* 样式由 components/skeleton/skeleton.wxss 自动转换而来。 */
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
  .head { max-width: 1240px; margin: 0 auto 22px; }
  .head h1 { font-size: 20px; margin: 0 0 8px; }
  .head p { font-size: 13px; color: #4b5563; line-height: 21px; margin: 0 0 6px; }
  .head code { background: #e5e7eb; border-radius: 4px; padding: 1px 5px; font-size: 12px; }
  h2.sec { max-width: 1240px; margin: 34px auto 14px; font-size: 16px; }
  h2.sec span { font-size: 12px; font-weight: 400; color: #6b7280; margin-left: 8px; }
  .wrap { display: flex; flex-wrap: wrap; gap: 24px; justify-content: center; align-items: flex-start;
          max-width: 1240px; margin: 0 auto; }
  .col { flex: 0 0 auto; }
  .phone { width: 375px; background: var(--color-bg); border-radius: 10px; overflow: hidden;
           box-shadow: 0 8px 26px rgba(0,0,0,.13); position: relative; height: 600px; }
  .cap { text-align: center; font-size: 12px; color: #6b7280; margin-top: 10px; width: 375px; }
  .navbar { height: 44px; display: flex; align-items: center; justify-content: center;
    background: #fff; font-size: 16px; font-weight: 600; border-bottom: 1px solid #f0f1f3; }
  .screen { padding: 12px 12px 0; height: calc(100% - 44px); overflow: hidden; }
  .screen-hero { padding: 0; height: 100%; }
  .hero { background: linear-gradient(135deg, #111827 0%, #1f2937 60%, #059669 130%); color: #fff;
    padding: 52px 16px 28px; border-radius: 0 0 20px 20px; }
  .hero-date { font-size: 12px; opacity: .7; }
  .hero-title { font-size: 22px; font-weight: 700; margin-top: 6px; }
  .hero-sub { font-size: 13px; opacity: .8; margin-top: 4px; }

  /* 骨架屏「待命」占位 */
  .sk-hold { min-height: 160px; }

${wxss}

  /* ---------- 演示区 ---------- */
  .demo { max-width: 1240px; margin: 0 auto; display: flex; gap: 26px; flex-wrap: wrap;
          justify-content: center; align-items: flex-start; }
  .panel { background: #fff; border-radius: 10px; padding: 16px 18px; width: 375px;
           box-shadow: 0 8px 26px rgba(0,0,0,.1); }
  .panel h3 { margin: 0 0 6px; font-size: 15px; }
  .panel p { font-size: 12.5px; color: #4b5563; line-height: 20px; margin: 0 0 14px; }
  .btns { display: flex; gap: 8px; flex-wrap: wrap; }
  .btn { border: none; border-radius: 999px; padding: 9px 16px; font-size: 13px; font-weight: 600;
         cursor: pointer; background: var(--color-primary); color: #fff; }
  .btn.ghost { background: #fff; color: var(--color-primary); border: 1px solid var(--color-primary); }
  .btn:active { opacity: .85; }
  .log { margin-top: 14px; font-size: 12px; line-height: 20px; color: #374151;
         background: #f8fafc; border: 1px solid #eef1f4; border-radius: 8px; padding: 10px 12px;
         min-height: 92px; font-variant-numeric: tabular-nums; }
  .log b.good { color: var(--color-primary-dark); }
  .log b.warn { color: #b45309; }
  .verdict { margin-top: 12px; font-size: 12.5px; font-weight: 600; }
</style>
</head>
<body>

<div class="head">
  <h1>骨架屏 · 视觉预览</h1>
  <p>页面结构与样式由 <code>utils/skeleton.js</code> 的 <code>buildSpec()</code> + <code>components/skeleton/skeleton.wxss</code> 自动生成（rpx→px ×0.5），与小程序渲染一致，改了代码这里会跟着变。</p>
  <p>卡片圆角 / 内边距 / 左右外边距刻意与 <code>app.wxss</code> 的 <code>.card</code> 对齐，骨架屏换成真实内容时不会跳动。微光动画是真实在跑的。</p>
</div>

<h2 class="sec">① 七个页面的首屏骨架屏 <span>一个组件 + variant 切换，8 种版式</span></h2>
<div class="wrap">${phones}</div>

<h2 class="sec">② 为什么要「延迟 180ms」才显示 <span>点按钮看真实时序（下面这块逻辑与 utils/skeleton.js 的闸门一致）</span></h2>
<div class="demo">
  <div class="col">
    <div class="phone">
      <div class="navbar">数据看板</div>
      <div class="screen" id="demoScreen"></div>
    </div>
    <div class="cap">真机上一次「加载」全过程</div>
  </div>
  <div class="panel">
    <h3>对比两种加载耗时</h3>
    <p>已有聚合缓存的页面命中时可能 10ms 就返回。如果立刻画骨架屏，结果就是<b>闪一下</b>——比留白更刺眼。</p>
    <div class="btns">
      <button class="btn ghost" id="btnFast">模拟缓存命中（80ms）</button>
      <button class="btn" id="btnSlow">模拟真的慢（900ms）</button>
      <button class="btn ghost" id="btnFail">模拟加载失败</button>
    </div>
    <div class="log" id="demoLog">点上面任一按钮开始。</div>
    <div class="verdict" id="demoVerdict"></div>
  </div>
</div>

<script>
  // 与 utils/skeleton.js 完全一致的闸门规则（shouldShow + 180ms 定时器）
  var DELAY = ${sk.DEFAULT_DELAY};
  var statsHtml = ${JSON.stringify(renderSkeleton('stats'))};
  var screen = document.getElementById('demoScreen');
  var logEl = document.getElementById('demoLog');
  var verdictEl = document.getElementById('demoVerdict');
  var timer = null;
  var startedAt = 0;
  var skeletonShown = false;

  function now() { return Date.now(); }
  function line(s) {
    logEl.innerHTML += (logEl.innerHTML ? '<br>' : '') + s;
  }
  function reset() {
    if (timer) { clearTimeout(timer); timer = null; }
    screen.innerHTML = '';
    logEl.innerHTML = '';
    verdictEl.textContent = '';
    skeletonShown = false;
  }

  function start() {
    reset();
    startedAt = now();
    line('0ms　开始加载，此时屏幕上<b>什么都不画</b>');
    timer = setTimeout(function () {
      timer = null;
      skeletonShown = true;
      screen.innerHTML = statsHtml;
      line(DELAY + 'ms　仍在等待 → 显示骨架屏');
    }, DELAY);
  }

  function done() {
    var cost = now() - startedAt;
    if (timer) { clearTimeout(timer); timer = null; }
    screen.innerHTML = '<div style="padding:44px 0;text-align:center;color:#6b7280;font-size:13px">' +
      '（这里换成真实的看板内容）</div>';
    line(cost + 'ms　数据到达 → 渲染真实内容');
    if (skeletonShown) {
      verdictEl.innerHTML = '<b class="warn">骨架屏出现了 → 用户看到「骨架 → 内容」的过渡</b>';
    } else {
      verdictEl.innerHTML = '<b class="good">全程没出现骨架屏 → 不闪，直接出内容 ✅</b>';
    }
  }

  function fail(message) {
    var cost = now() - startedAt;
    if (timer) { clearTimeout(timer); timer = null; }
    screen.innerHTML = '<div style="margin:12px 16px;background:#fff;border:1px solid #fecaca;' +
      'border-radius:10px;padding:16px"><div style="color:#b91c1c;font-weight:700;font-size:15px">⚠️ 看板加载失败</div>' +
      '<div style="color:#7f1d1d;font-size:12.5px;margin:8px 0 14px">' + message + '</div>' +
      '<div style="background:#10b981;color:#fff;border-radius:999px;text-align:center;padding:11px;' +
      'font-size:15px;font-weight:600">重新加载</div></div>';
    line(cost + 'ms　请求失败 → 错误卡（错误只在失败时清，成功后不留残影）');
    verdictEl.innerHTML = skeletonShown
      ? '<b class="warn">骨架屏 → 错误卡</b>'
      : '<b class="good">全程没出现骨架屏 → 直接出错误卡</b>';
  }

  document.getElementById('btnFast').addEventListener('click', function () {
    start();
    setTimeout(done, 80);
  });
  document.getElementById('btnSlow').addEventListener('click', function () {
    start();
    setTimeout(done, 900);
  });
  document.getElementById('btnFail').addEventListener('click', function () {
    start();
    setTimeout(function () { fail('网络请求超时，请检查网络后重试'); }, 620);
  });
</script>
</body>
</html>
`;

const out = path.join(ROOT, 'docs', 'preview-skeleton.html');
fs.writeFileSync(out, html);
console.log(`已生成 ${path.relative(ROOT, out)}（${(Buffer.byteLength(html) / 1024).toFixed(1)} KB）`);
console.log(`版式：${sk.VARIANTS.join(' / ')}`);
