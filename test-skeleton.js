/**
 * test-skeleton.js — 骨架屏（utils/skeleton.js + components/skeleton）单测（V1.1）
 *
 * 覆盖三块：
 *   1. 归一化（variant / rows / delay）—— 脏输入不能把页面搞白屏
 *   2. shouldShow + gate 闸门时序 —— 用假计时器，不依赖真实时间（避免 flaky）
 *   3. buildSpec 版式描述 —— 结构合法性 + 行数跟随 rows，保证组件 wx:for 拿到的一定是数组
 *   4. 组件 attached / 属性变更 —— 渲染结果与去重
 *
 * 全部离线运行，不依赖微信开发者工具。
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

const sk = require(path.join(MINIPROGRAM, 'utils/skeleton.js'));

// ---------- 假计时器：让闸门时序完全可控 ----------
function makeTimers() {
  let seq = 0;
  const jobs = new Map();
  return {
    jobs,
    setTimeout(fn, ms) { const id = ++seq; jobs.set(id, { fn, ms }); return id; },
    clearTimeout(id) { jobs.delete(id); },
    // 触发所有到点任务（忽略 ms，测试里手动推进）
    fireAll() {
      const list = Array.from(jobs.entries());
      jobs.clear();
      list.forEach(([, j]) => j.fn());
      return list.length;
    }
  };
}

function makePage(initial) {
  const state = Object.assign({}, initial || {});
  const calls = [];
  return {
    data: state,
    calls,
    setData(obj) { calls.push(obj); Object.assign(state, obj); }
  };
}

(async () => {
  // ============================================================
  section('1. 变体归一化 normalizeVariant');
  eq('合法变体原样返回', sk.normalizeVariant('stats'), 'stats');
  eq('未知变体回落到 list', sk.normalizeVariant('welcome'), 'list');
  eq('空串回落到 list', sk.normalizeVariant(''), 'list');
  eq('null 回落到 list', sk.normalizeVariant(null), 'list');
  eq('undefined 回落到 list', sk.normalizeVariant(undefined), 'list');
  eq('前后空格会被裁掉', sk.normalizeVariant('  body  '), 'body');
  eq('大小写敏感（Stats 不认）', sk.normalizeVariant('Stats'), 'list');
  ok('全部声明的变体都能被识别', sk.VARIANTS.every((v) => sk.normalizeVariant(v) === v), sk.VARIANTS);
  eq('默认变体是 list', sk.DEFAULT_VARIANT, 'list');

  // ============================================================
  section('2. 行数 / 延迟归一化');
  eq('常规行数原样', sk.normalizeRows(4), 4);
  eq('字符串数字', sk.normalizeRows('6'), 6);
  eq('小数四舍五入', sk.normalizeRows(3.6), 4);
  eq('超上限夹到 12', sk.normalizeRows(999), 12);
  eq('负数夹到 1', sk.normalizeRows(-5), 1);
  eq('0 夹到 1', sk.normalizeRows(0), 1);
  eq('非数字 → 1', sk.normalizeRows('abc'), 1);
  eq('NaN → 1', sk.normalizeRows(NaN), 1);

  eq('默认延迟 180ms', sk.DEFAULT_DELAY, 180);
  eq('负数延迟回落默认', sk.normalizeDelay(-1), 180);
  eq('非数字回落默认', sk.normalizeDelay('x'), 180);
  eq('0 是合法延迟（立即显示）', sk.normalizeDelay(0), 0);
  eq('超大延迟被夹到 2000', sk.normalizeDelay(99999), 2000);

  // ============================================================
  section('3. shouldShow 判定规则');
  eq('没在加载 → 永不显示', sk.shouldShow(false, 99999, 180), false);
  eq('没过延迟阈值 → 不显示', sk.shouldShow(true, 100, 180), false);
  eq('刚好到点 → 显示', sk.shouldShow(true, 180, 180), true);
  eq('超过阈值 → 显示', sk.shouldShow(true, 900, 180), true);
  eq('延迟 0 → 立刻显示', sk.shouldShow(true, 0, 0), true);
  eq('时间为 NaN → 宁可显示', sk.shouldShow(true, NaN, 180), true);
  eq('时间为负 → 宁可显示', sk.shouldShow(true, -5, 180), true);

  // ============================================================
  section('4. gate 闸门时序');
  {
    const T = makeTimers();
    const page = makePage({ skVisible: false });
    const g = sk.gate(page, { timers: T, delay: 180 });

    g.start();
    eq('开始后立刻不显示', page.data.skVisible, false);
    eq('定时器已挂上', g.pending(), true);
    eq('没有多余的 setData', page.calls.length, 0);

    T.fireAll();
    eq('到点后显示', page.data.skVisible, true);
    eq('定时器已消费', g.pending(), false);

    g.stop();
    eq('结束后立即隐藏', page.data.skVisible, false);
  }

  {
    const T = makeTimers();
    const page = makePage({ skVisible: false });
    const g = sk.gate(page, { timers: T, delay: 180 });
    g.start();
    const before = page.calls.length;
    g.stop();
    eq('stop 取消未触发的定时器', g.pending(), false);
    T.fireAll();
    eq('被取消后回调不再执行', page.data.skVisible, false);
    ok('stop 之后没有额外 setData', page.calls.length === before, page.calls.length);
  }

  {
    const T = makeTimers();
    const page = makePage({ skVisible: false });
    const g = sk.gate(page, { timers: T, delay: 180 });
    g.start();
    g.start();
    g.start();
    eq('重复 start 只留一个定时器', T.jobs.size, 1);
    T.fireAll();
    eq('仍然只显示一次', page.data.skVisible, true);
  }

  {
    const T = makeTimers();
    const page = makePage({ skVisible: false });
    const g = sk.gate(page, { timers: T, delay: 180 });
    // 数据很快回来（<180ms）：全程不显示骨架屏，一次 setData 都不该发生
    g.start();
    g.stop();
    eq('快路径全程不显示骨架屏', page.data.skVisible, false);
    eq('快路径没有触发任何 setData', page.calls.length, 0);
  }

  {
    const T = makeTimers();
    const page = makePage({});
    const g = sk.gate(page, { timers: T, delay: 0 });
    g.start();
    eq('delay=0 立即显示', page.data.skVisible, true);
    eq('delay=0 不排定时器', T.jobs.size, 0);
    g.stop();
    eq('stop 之后隐藏', page.data.skVisible, false);
  }

  {
    const T = makeTimers();
    const page = makePage({ skVisible: false });
    const g = sk.gate(page, { timers: T });
    eq('默认 key 是 skVisible', g.key, 'skVisible');
    eq('默认延迟 180', g.delay, 180);
    // 自定义 key
    const page2 = makePage({ myFlag: false });
    const g2 = sk.gate(page2, { key: 'myFlag', timers: T, delay: 0 });
    g2.start();
    eq('自定义 key 生效', page2.data.myFlag, true);
    ok('自定义 key 不污染默认字段', page2.data.skVisible === undefined, Object.keys(page2.data));
  }

  {
    const T = makeTimers();
    // 页面没 setData（组件/异常场景）也不能抛错
    let threw = null;
    const g = sk.gate({}, { timers: T, delay: 0 });
    try { g.start(); g.stop(); } catch (e) { threw = e; }
    ok('没有 setData 的宿主不抛错', threw === null, threw && threw.message);
  }

  // ============================================================
  section('5. buildSpec 版式描述结构');
  const ARRAY_FIELDS = ['items', 'cells', 'cols', 'rows', 'days', 'bars', 'widths'];
  sk.VARIANTS.forEach((v) => {
    const cards = sk.buildSpec(v, 4);
    ok(`[${v}] 返回非空数组`, Array.isArray(cards) && cards.length > 0, cards && cards.length);
    let shapeOk = true;
    const cardKeys = new Set();
    cards.forEach((c) => {
      if (!c || typeof c.k !== 'string' || !Array.isArray(c.blocks) || !c.blocks.length) shapeOk = false;
      if (cardKeys.has(c.k)) shapeOk = false;
      cardKeys.add(c.k);
      const blockKeys = new Set();
      c.blocks.forEach((b) => {
        if (!b || typeof b.k !== 'string' || typeof b.type !== 'string') shapeOk = false;
        if (blockKeys.has(b.k)) shapeOk = false; // wx:key="k" 要求同卡片内唯一
        blockKeys.add(b.k);
        // wx:for 只遍历数组：数字会让骨架屏整体画不出来
        ARRAY_FIELDS.forEach((f) => {
          if (b[f] !== undefined && !Array.isArray(b[f])) shapeOk = false;
        });
      });
    });
    ok(`[${v}] 卡片/块结构合法且 key 唯一`, shapeOk);
  });

  eq('未知版本回落到 list 版式', JSON.stringify(sk.buildSpec('nope', 3)), JSON.stringify(sk.buildSpec('list', 3)));
  eq('training 3 张卡（今日训练/本周打卡/更多）', sk.buildSpec('training').length, 3);
  eq('stats 5 张卡（概览/趋势/热力图/日历/最近）', sk.buildSpec('stats').length, 5);
  eq('body 3 张卡（概览/趋势/记录）', sk.buildSpec('body').length, 3);
  eq('plan = 头部 + 周切换 + 3 个训练日', sk.buildSpec('plan').length, 5);
  eq('workout = 进度 + 3 个动作（默认 3 行）', sk.buildSpec('workout').length, 4);
  eq('card 2 张卡（设置 / 自检）', sk.buildSpec('card').length, 2);
  eq('list 1 张卡', sk.buildSpec('list').length, 1);

  const heatBlock = sk.buildSpec('stats')[2].blocks[1];
  eq('热力图用 stats 的块类型', heatBlock.type, 'heat');
  eq('热力图 17 列（与看板一致）', heatBlock.cols.length, 17);
  eq('热力图每列 7 天', heatBlock.days.length, 7);
  const calBlock = sk.buildSpec('stats')[3].blocks[1];
  eq('日历 5 行', calBlock.rows.length, 5);
  eq('日历每周 7 格', calBlock.days.length, 7);
  const chartBlock = sk.buildSpec('stats')[1].blocks[1];
  eq('趋势图 8 根柱子（近 8 周）', chartBlock.bars.length, 8);
  ok('柱子高度都在 0-100 之间', chartBlock.bars.every((h) => h > 0 && h <= 100), chartBlock.bars);
  ok('训练首页有 7 个打卡圆点', sk.buildSpec('training')[1].blocks[2].items.length === 7);
  const trRing = sk.buildSpec('training')[1].blocks[1];
  eq('训练首页本周卡有进度环', trRing.type, 'ring');
  ok('进度环带两行概览占位', !!trRing.w1 && !!trRing.w2);
  eq('今日安排块用 tint 底', sk.buildSpec('training')[0].blocks[1].tint, true);

  // 成就徽章版式：顶部概览 + 两个分组栅格
  {
    const bd = sk.buildSpec('badge');
    eq('徽章版式 3 张卡', bd.length, 3);
    eq('徽章顶部概览是 2 格数据', bd[0].blocks[1].type, 'grid');
    eq('徽章顶部概览 2 格', bd[0].blocks[1].cells.length, 2);
    eq('徽章概览带进度条', bd[0].blocks[2].type, 'bar');
    eq('第一个分组用栅格块', bd[1].blocks[1].type, 'tiles');
    eq('第二个分组也用栅格块', bd[2].blocks[1].type, 'tiles');
    eq('默认 6 枚 → 4 + 2 分布', bd[1].blocks[1].items.length + bd[2].blocks[1].items.length, 6);
    eq('默认徽章栅格 6 枚', sk.buildSpec('badge')[1].blocks[1].items.length + sk.buildSpec('badge')[2].blocks[1].items.length, 6);
    eq('rows=1 时第二组仍有 1 枚（不留空块）', sk.buildSpec('badge', 1)[2].blocks[1].items.length, 1);
    eq('rows=12 时共 12 枚', sk.buildSpec('badge', 12)[1].blocks[1].items.length + sk.buildSpec('badge', 12)[2].blocks[1].items.length, 12);
    // tiles 只应出现在 badge 版式（其它页面没有栅格）
    const others = sk.VARIANTS.filter((v) => v !== 'badge');
    ok('tiles 块仅用于 badge 版式',
      others.every((v) => !JSON.stringify(sk.buildSpec(v)).includes('"tiles"')),
      others.filter((v) => JSON.stringify(sk.buildSpec(v)).includes('"tiles"')));
  }

  // 行数跟随 rows 参数
  function rowsOf(variant, n) {
    const cards = sk.buildSpec(variant, n);
    const hit = cards.find((c) => c.blocks.some((b) => b.type === 'rows' || b.type === 'kv'));
    const block = hit.blocks.find((b) => b.type === 'rows' || b.type === 'kv');
    return block.items.length;
  }
  eq('stats 最近训练行数跟随 rows', rowsOf('stats', 6), 6);
  eq('body 记录行数跟随 rows', rowsOf('body', 7), 7);
  eq('plan 每天动作数跟随 rows', rowsOf('plan', 5), 5);
  eq('card 键值行数跟随 rows', rowsOf('card', 2), 2);
  eq('list 行数跟随 rows', rowsOf('list', 9), 9);

  eq('rows 超上限被夹住', rowsOf('list', 99), 12);
  eq('rows 为 0 用该版式默认值（list=6）', rowsOf('list', 0), 6);
  eq('rows 缺省用默认值（stats=3）', rowsOf('stats'), 3);
  eq('training 不接受 rows（固定 3 张卡）', sk.buildSpec('training', 9).length, 3);

  const wkCount = (n) => sk.buildSpec('workout', n).length;
  eq('workout 动作卡数跟随 rows', wkCount(5), 6);
  eq('workout rows 超上限夹到 12', wkCount(99), 13);

  // 深色 hero：计划页 / 跟练页的头部在真实页面里没有白色卡片包着
  const planHero = sk.buildSpec('plan')[0];
  ok('plan 第一张是 bare（不套白卡）', planHero.bare === true);
  eq('plan hero 块类型', planHero.blocks[0].type, 'hero');
  eq('plan hero 三行文字占位', planHero.blocks[0].widths.length, 3);
  ok('plan 周切换也是 bare', sk.buildSpec('plan')[1].bare === true);
  const wkHero = sk.buildSpec('workout')[0];
  ok('workout 第一张是 bare', wkHero.bare === true);
  eq('workout hero 块类型', wkHero.blocks[0].type, 'hero');
  eq('workout hero 带进度条', wkHero.blocks[0].progress, true);
  ok('workout hero 两行文字占位', wkHero.blocks[0].widths.length === 2);
  ok('普通卡片 bare 均为 false', sk.buildSpec('stats').every((c) => c.bare === false));
  ok('每个 bare 都只出现在 plan/workout',
    ['training', 'stats', 'body', 'card', 'list'].every((v) => sk.buildSpec(v).every((c) => !c.bare)),
    ['training', 'stats', 'body', 'card', 'list'].map((v) => sk.buildSpec(v).filter((c) => c.bare).length));

  // ============================================================
  section('6. 组件渲染（attached / 属性变更）');
  {
    let compDef = null;
    global.Component = (def) => { compDef = def; };
    require(path.join(MINIPROGRAM, 'components/skeleton/skeleton.js'));
    ok('组件模块加载并调用 Component()', !!compDef);
    ok('组件 methods 内有 render', compDef && compDef.methods && typeof compDef.methods.render === 'function');
    ok('attached 在 lifetimes 内', compDef && compDef.lifetimes && typeof compDef.lifetimes.attached === 'function');

    function makeComp(props) {
      const inst = Object.assign({}, compDef.methods);
      inst.data = Object.assign({}, compDef.data);
      inst._setData = 0;
      inst.setData = function (obj) { inst._setData++; Object.assign(inst.data, obj); };
      Object.keys(compDef.properties).forEach((k) => { inst.data[k] = compDef.properties[k].value; });
      Object.assign(inst.data, props || {});
      return inst;
    }

    const a = makeComp({ variant: 'stats', rows: 4 });
    compDef.lifetimes.attached.call(a);
    eq('attached 后 v 归一化正确', a.data.v, 'stats');
    eq('attached 后渲染出 5 张卡', a.data.cards.length, 5);
    eq('渲染发生 1 次 setData', a._setData, 1);

    // 属性 observer 与 attached 都触发 render 时，相同输入不重复 setData
    compDef.methods.onPropChange.call(a);
    eq('相同输入不重复 setData', a._setData, 1);

    // 换版式要重渲染
    a.data.variant = 'body';
    compDef.methods.onPropChange.call(a);
    eq('换版式后重渲染', a.data.v, 'body');
    eq('换版式后卡片数更新', a.data.cards.length, 3);
    eq('换版式触发 1 次 setData', a._setData, 2);

    // 脏变体不白屏
    const b = makeComp({ variant: 'wat', rows: 0 });
    compDef.lifetimes.attached.call(b);
    eq('脏变体回落到 list', b.data.v, 'list');
    eq('脏变体仍有内容渲染', b.data.cards.length, 1);

    // rows 变化要重渲染
    const c = makeComp({ variant: 'list', rows: 3 });
    compDef.lifetimes.attached.call(c);
    const before = c.data.cards[0].blocks[0].items.length;
    c.data.rows = 8;
    compDef.methods.onPropChange.call(c);
    const after = c.data.cards[0].blocks[0].items.length;
    eq('rows 变化后重新生成', `${before}→${after}`, '3→8');
  }

  // ============================================================
  console.log(`\n================ 结果：${pass} 通过 / ${fail} 失败 ================\n`);
  process.exit(fail ? 1 : 0);
})();
