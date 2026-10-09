// utils/skeleton.js — 骨架屏：延迟显示闸门 + 版式描述
//
// 两个职责，都是纯逻辑（不依赖 wx），因此能离线单测：
//
//  1) gate()      —— 延迟显示的小闸门。
//                    已有 TTL 缓存的页面（看板 30s、计划 30s）命中时可能 10ms 就返回，
//                    这时渲染骨架屏会「闪一下」，比留白更刺眼。统一延迟 180ms：
//                      数据在 180ms 内回来 → 全程不显示骨架屏，直接出内容
//                      超过 180ms         → 显示骨架屏，直到数据到达
//                    页面只在「首屏还没有内容」时开启它；下拉刷新 / 切 tab 回来时
//                    旧内容留在屏上，不会闪。
//
//  2) buildSpec() —— 用纯数据描述各页面首屏的占位版式（卡片 / 标题 / 图表 / 列表…）。
//                    组件只负责按 spec 渲染，改版式不用改组件 WXML，也能被单测覆盖。

const VARIANTS = ['training', 'stats', 'body', 'plan', 'workout', 'badge', 'card', 'list'];
const DEFAULT_VARIANT = 'list';
const DEFAULT_DELAY = 180;   // ms：小于这个耗时的加载不显示骨架屏
const MAX_DELAY = 2000;
const MIN_ROWS = 1;
const MAX_ROWS = 12;

// 各版式默认的列表行数（调用方没传 rows 时用）
const ROWS_BY_VARIANT = {
  training: 3,
  stats: 3,
  body: 4,
  plan: 3,
  workout: 3,
  badge: 6,
  card: 3,
  list: 6
};

// 柱状图占位高度（写死不用随机：避免每次渲染跳动）
const BARS_8 = [42, 68, 55, 84, 61, 76, 48, 90];
const BARS_6 = [58, 74, 46, 82, 64, 70];
const HEAT_COLS = 17; // 与看板热力图一致（近 17 周）
const CAL_ROWS = 5;
const DAYS = seq(7);

function seq(n) {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(i + 1);
  return arr;
}

function normalizeVariant(v) {
  const s = (v === undefined || v === null) ? '' : String(v).trim();
  return VARIANTS.indexOf(s) >= 0 ? s : DEFAULT_VARIANT;
}

function normalizeRows(n) {
  const num = Math.round(Number(n));
  if (!isFinite(num)) return MIN_ROWS;
  return Math.max(MIN_ROWS, Math.min(MAX_ROWS, num));
}

function normalizeDelay(d) {
  const num = Math.round(Number(d));
  if (!isFinite(num) || num < 0) return DEFAULT_DELAY;
  return Math.min(MAX_DELAY, num);
}

/**
 * 纯函数：这一时刻是否应该显示骨架屏。
 * @param {Boolean} loading   是否仍在加载
 * @param {Number}  elapsedMs 从开始加载到现在过了多久
 * @param {Number}  delayMs   延迟阈值
 */
function shouldShow(loading, elapsedMs, delayMs) {
  if (!loading) return false;
  const limit = normalizeDelay(delayMs);
  const e = Number(elapsedMs);
  // 时间不可信（NaN / 负数）时宁可显示骨架屏，也好过卡在空白
  if (!isFinite(e) || e < 0) return true;
  return e >= limit;
}

const defaultTimers = {
  setTimeout(fn, ms) { return setTimeout(fn, ms); },
  clearTimeout(id) { return clearTimeout(id); }
};

/**
 * 页面用的小闸门。用法：
 *   onLoad()  { this.sk = skeleton.gate(this); }
 *   load()    { if (!已有内容) this.sk.start(); ... finally { this.sk.stop(); } }
 * WXML 里用 wx:if="{{skVisible}}" 控制骨架屏显隐。
 *
 * @param {Object} page 页面实例（需要 setData / data）
 * @param {Object} [options] { key='skVisible', delay=180, timers }
 */
function gate(page, options) {
  const o = options || {};
  const key = o.key || 'skVisible';
  const delay = normalizeDelay(o.delay === undefined ? DEFAULT_DELAY : o.delay);
  const T = o.timers || defaultTimers;
  let timer = null;

  function write(val) {
    if (!page || typeof page.setData !== 'function') return;
    const cur = page.data ? page.data[key] : undefined;
    if (!!cur === !!val) return; // 值没变就不触发渲染
    const patch = {};
    patch[key] = val;
    page.setData(patch);
  }

  const api = {
    key: key,
    delay: delay,
    // 开始一次加载：延迟到点才把骨架屏打开
    start() {
      api.stop();
      // delay === 0 时立刻显示（shouldShow 就是这条规则本身）
      if (shouldShow(true, 0, delay)) {
        write(true);
        return api;
      }
      timer = T.setTimeout(() => {
        timer = null;
        write(true);
      }, delay);
      return api;
    },
    // 加载结束：无论有没有显示过，都要清干净并取消未触发的定时器
    stop() {
      if (timer) {
        T.clearTimeout(timer);
        timer = null;
      }
      write(false);
      return api;
    },
    // 定时器是否还挂着（测试与排查用）
    pending() {
      return !!timer;
    }
  };
  return api;
}

// ---------- 版式描述 ----------
// 每个「块」是一种占位元素，组件 WXML 按 type 分发渲染。
// bare = true 的卡片不套白色卡片外框（页面里本来就没有卡片的区块，如深色 hero）
function card(k, blocks) {
  return { k: k, blocks: blocks, bare: false };
}

function bareCard(k, blocks) {
  return { k: k, blocks: blocks, bare: true };
}

function trainingSpec() {
  return [
    // 今日训练：浅绿底的「今日安排」块（3 行）+ 所属计划一行 + 两个按钮
    card('train', [
      { k: 'h', type: 'head', w: 140, right: 104 },
      { k: 't', type: 'lines', tint: true, widths: ['42%', '58%', '76%'] },
      { k: 'p', type: 'lines', widths: ['62%'] },
      { k: 'b', type: 'buttons', items: seq(2) }
    ]),
    // 本周打卡：进度环（环 + 两行概览）+ 周一~周日 7 格 + 底部链接
    card('week', [
      { k: 'h', type: 'head', w: 140, right: 56 },
      { k: 'o', type: 'ring', w1: '64%', w2: '46%' },
      { k: 'd', type: 'dots', items: DAYS },
      { k: 'l', type: 'lines', widths: ['190rpx'] }
    ]),
    card('more', [
      { k: 'h', type: 'head', w: 92 },
      { k: 't', type: 'tools', items: seq(2) }
    ])
  ];
}

function statsSpec(n) {
  return [
    card('ov', [
      { k: 'h', type: 'head', w: 148 },
      { k: 'g', type: 'grid', cells: seq(4) },
      { k: 'l', type: 'lines', widths: ['74%'] }
    ]),
    card('trend', [
      { k: 'h', type: 'head', w: 168, right: 96 },
      { k: 'c', type: 'chart', bars: BARS_8 }
    ]),
    card('heat', [
      { k: 'h', type: 'head', w: 168, right: 88 },
      { k: 'm', type: 'heat', cols: seq(HEAT_COLS), days: DAYS }
    ]),
    card('cal', [
      { k: 'h', type: 'head', w: 148, right: 56 },
      { k: 'w', type: 'cal', rows: seq(CAL_ROWS), days: DAYS }
    ]),
    card('recent', [
      { k: 'h', type: 'head', w: 148 },
      { k: 'r', type: 'rows', items: seq(n), lead: '116rpx', w1: '46%', w2: '68%' }
    ])
  ];
}

function bodySpec(n) {
  return [
    card('sum', [
      { k: 'h', type: 'head', w: 148, right: 72 },
      { k: 'g', type: 'grid', cells: seq(4) },
      { k: 'l', type: 'lines', widths: ['68%'] }
    ]),
    card('trend', [
      { k: 'h', type: 'head', w: 168, right: 88 },
      { k: 'c', type: 'chart', bars: BARS_6 }
    ]),
    card('rec', [
      { k: 'h', type: 'head', w: 148 },
      { k: 'r', type: 'rows', items: seq(n), lead: '124rpx', w1: '52%', w2: '38%' },
      { k: 'b', type: 'button' }
    ])
  ];
}

function planSpec(n) {
  const cards = [
    // 计划页头部是深色 hero，页面里没有白色卡片包着
    bareCard('hero', [
      { k: 'h', type: 'hero', widths: ['54%', '82%', '40%'] }
    ]),
    // 周切换是横向滚动的胶囊，也不是卡片
    bareCard('tabs', [
      { k: 't', type: 'tabs', items: seq(3) }
    ])
  ];
  for (let i = 0; i < 3; i++) {
    cards.push(card('day' + i, [
      { k: 'h', type: 'head', w: 132, right: 96 },
      { k: 'r', type: 'rows', items: seq(n), w1: '44%', w2: '66%' }
    ]));
  }
  return cards;
}

function workoutSpec(n) {
  const cards = [
    // 跟练页顶部概况也是深色 hero（标题 + 计时 + 进度条）
    bareCard('prog', [
      { k: 'h', type: 'hero', widths: ['62%', '44%'], progress: true }
    ])
  ];
  for (let i = 0; i < n; i++) {
    cards.push(card('ex' + i, [
      { k: 'h', type: 'head', w: 200, right: 76 },
      { k: 's', type: 'sets', items: seq(4) }
    ]));
  }
  return cards;
}

// 成就徽章：顶部进度概览卡 + 两个分组的栅格（首屏可见范围约 6 枚）
function badgeSpec(n) {
  return [
    card('sum', [
      { k: 'h', type: 'head', w: 148, right: 72 },
      { k: 'g', type: 'grid', cells: seq(2) },
      { k: 'b', type: 'bar' },
      { k: 'l', type: 'lines', widths: ['62%'] }
    ]),
    card('g1', [
      { k: 'h', type: 'head', w: 96 },
      { k: 't', type: 'tiles', items: seq(4) }
    ]),
    card('g2', [
      { k: 'h', type: 'head', w: 96 },
      { k: 't', type: 'tiles', items: seq(Math.max(1, n - 4)) }
    ])
  ];
}

function cardSpec(n) {
  return [
    card('main', [
      { k: 'h', type: 'head', w: 148, right: 80 },
      { k: 'v', type: 'kv', items: seq(n), w1: '150rpx', w2: '110rpx' },
      { k: 'b', type: 'button' }
    ]),
    card('test', [
      { k: 'h', type: 'head', w: 96 },
      { k: 'l', type: 'lines', widths: ['100%', '86%'] },
      { k: 'b', type: 'button' }
    ])
  ];
}

function listSpec(n) {
  return [
    card('list', [
      { k: 'r', type: 'rows', items: seq(n), avatar: true, w1: '46%', w2: '72%' }
    ])
  ];
}

function buildSpec(variant, rows) {
  const v = normalizeVariant(variant);
  const useDefault = (rows === undefined || rows === null || rows === 0 || rows === '');
  const n = normalizeRows(useDefault ? ROWS_BY_VARIANT[v] : rows);
  switch (v) {
    case 'training': return trainingSpec();
    case 'stats': return statsSpec(n);
    case 'body': return bodySpec(n);
    case 'plan': return planSpec(n);
    case 'workout': return workoutSpec(n);
    case 'badge': return badgeSpec(n);
    case 'card': return cardSpec(n);
    default: return listSpec(n);
  }
}

module.exports = {
  VARIANTS,
  DEFAULT_VARIANT,
  DEFAULT_DELAY,
  MIN_ROWS,
  MAX_ROWS,
  ROWS_BY_VARIANT,
  normalizeVariant,
  normalizeRows,
  normalizeDelay,
  shouldShow,
  gate,
  buildSpec
};
