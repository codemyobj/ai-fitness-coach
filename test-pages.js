/**
 * test-pages.js — 页面级冒烟测试（离线运行，不依赖微信开发者工具）
 *
 * 目的：抓「白屏」这类只在运行时才暴露的问题。
 * 小程序白屏的典型成因是：模块加载阶段抛错 → Page() 从未执行 → 页面不渲染；
 * 或 onLoad/onShow 抛错 → 数据一直停在初始态。
 *
 * 做法：mock 掉 wx / getApp / Page / Component，把每个页面的
 * ① 模块加载 ② onLoad ③ onShow 真实跑一遍，捕获任何异常。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, 'miniprogram');
const passed = [];
const failed = [];

// ---------------- 模拟数据 ----------------
const samplePlan = {
  _id: 'plan-1',
  openid: 'openid-test',
  planName: '减脂塑形 · 4 周计划',
  summary: '测试用计划',
  weeks: 4,
  daysPerWeek: 3,
  status: 'active',
  structure: [1, 2, 3, 4].map((w) => ({
    weekIndex: w,
    focus: `第${w}周`,
    days: [1, 2, 3].map((d) => ({
      dayIndex: d,
      focus: `第${d}天`,
      exercises: [
        { exerciseId: 'pushup', name: '标准俯卧撑', sets: 3, reps: 12, restSec: 60 },
        { exerciseId: 'squat', name: '徒手深蹲', sets: 3, reps: 12, restSec: 60 },
        { exerciseId: 'plank', name: '平板支撑', sets: 3, reps: 30, restSec: 60 }
      ]
    }))
  }))
};
const sampleProfile = {
  openid: 'openid-test',
  goal: 'fat_loss',
  daysPerWeek: 3,
  equipment: ['徒手'],
  nickname: '测试用户'
};

// ---------------- mock wx ----------------
function makeCollection(name) {
  const data = () => {
    if (name === 'plans') return [samplePlan];
    if (name === 'profiles') return [sampleProfile];
    return [];
  };
  const chain = {
    where() { return chain; },
    orderBy() { return chain; },
    limit() { return chain; },
    skip() { return chain; },
    field() { return chain; },
    doc() { return chain; },
    async get() { return { data: name === 'plans' ? [samplePlan] : data() }; },
    async add() { return { _id: 'new-doc' }; },
    async update() { return { stats: { updated: 1 } }; },
    async remove() { return { stats: { removed: 1 } }; },
    async count() { return { total: data().length }; },
    watch() { return { on() {}, off() {} }; }
  };
  return chain;
}

global.wx = {
  cloud: {
    init() {},
    database: () => ({
      collection: (name) => makeCollection(name),
      serverDate: () => ({ $date: Date.now() }),
      command: { gte: (v) => ({ gte: v, and: () => ({}) }), lte: (v) => ({ lte: v }) }
    }),
    callFunction: async ({ name }) => {
      if (name === 'login') return { result: { openid: 'openid-test', marker: 'test' } };
      return { result: { code: 0, data: { reply: '测试回复', plan: samplePlan } } };
    }
  },
  showToast() {}, showLoading() {}, hideLoading() {}, showModal() {},
  navigateTo() {}, navigateBack() {}, redirectTo() {}, switchTab() {}, reLaunch() {},
  setNavigationBarTitle() {}, setNavigationBarColor() {},
  setInterval: () => 1, clearInterval() {}, clearTimeout() {}, setTimeout: () => 1,
  stopPullDownRefresh() {}, startPullDownRefresh() {},
  getSystemInfoSync: () => ({ platform: 'devtools', screenHeight: 800, windowHeight: 600, safeArea: { bottom: 600 } }),
  getSystemSetting: () => ({}), getAppAuthorizeSetting: () => ({}),
  request() {}, login() {}, getUserProfile() {},
  getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
  createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({}) }), exec() {} }),
  nextTick: (fn) => fn()
};
global.getSystemInfoSync = global.wx.getSystemInfoSync;
global.getCurrentPages = () => [];

// ---------------- mock App / Page / Component ----------------
const appInstance = {
  globalData: { openid: 'openid-test', profile: sampleProfile, cloudReady: true },
  on() {}, off() {}, emit() {},
  silentLogin: async () => {}, loadProfile: async () => sampleProfile
};
global.getApp = () => appInstance;

const pageDefs = [];
const compDefs = [];
global.App = (def) => { Object.assign(appInstance, def); };
global.Page = (def) => { pageDefs.push(def); };
global.Component = (def) => { compDefs.push(def); };
global.Behavior = (def) => def;

// ---------------- 运行器 ----------------
// 用 vm 隔离执行每个页面模块，避免 require 缓存相互影响
function loadModule(file, context) {
  const code = fs.readFileSync(file, 'utf8');
  // require 必须按「当前模块所在目录」解析，否则相对路径会基准到本脚本；
  // 且要和小程序运行时保持一致：小程序不支持 require JSON 文件，这里直接拒绝，避免 Node 兼容造成漏测
  const localRequire = (id) => {
    if (/\.json$/.test(id)) {
      throw new Error(`小程序不支持 require JSON 文件：${id}（请改用 .js 模块 module.exports 导出）`);
    }
    const abs = id.startsWith('.') ? path.resolve(path.dirname(file), id) : id;
    return require(abs);
  };
  const mod = { exports: {} };
  // 定时器在小程序运行时是全局函数（不是 wx.xxx），沙箱必须提供，否则误报 ReferenceError
  // unref() 避免页面里启动的计时器（如跟练页秒表）把 Node 事件循环挂住导致脚本不退出
  const timers = {
    setTimeout: (fn, t) => { const id = setTimeout(fn, t); if (id.unref) id.unref(); return id; },
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, t) => { const id = setInterval(fn, t); if (id.unref) id.unref(); return id; },
    clearInterval: (id) => clearInterval(id)
  };
  const sandbox = Object.assign({ require: localRequire, module: mod, exports: mod.exports, __dirname: path.dirname(file), __filename: file, console }, timers, context);
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: file });
  return mod.exports;
}

async function exerciseLifecycle(def, label) {
  // 构造页面实例：把 methods 挂到 this 上，setData 直接合并
  const inst = Object.assign({
    data: JSON.parse(JSON.stringify(def.data || {})),
    setData(obj, cb) {
      Object.assign(inst.data, obj);
      if (typeof cb === 'function') cb();
      return inst;
    },
    selectComponent: () => null,
    route: label
  }, def);

  for (const hook of ['onLoad', 'onShow']) {
    if (typeof def[hook] !== 'function') continue;
    const r = def[hook].call(inst, {});
    if (r && typeof r.then === 'function') await r;
  }
  return inst;
}

/**
 * 带 query 的页面启动器（泛化循环里的 exerciseLifecycle 固定传 {}，不够用）。
 * 生命周期若返回 Promise（如 onShow 里等云端数据），挂到 inst._life 上供测试 await。
 */
function bootPage(file, query, label) {
  pageDefs.length = 0;
  loadModule(file, { wx: global.wx, getApp: global.getApp, Page: global.Page, Component: global.Component });
  const def = pageDefs[0];
  const inst = Object.assign({}, def, {
    data: JSON.parse(JSON.stringify(def.data || {})),
    setData(obj, cb) {
      Object.assign(inst.data, obj);
      if (typeof cb === 'function') cb();
      return inst;
    },
    selectComponent: () => null,
    route: label || file
  });
  const jobs = [];
  for (const hook of ['onLoad', 'onShow']) {
    if (typeof def[hook] !== 'function') continue;
    const r = def[hook].call(inst, query || {});
    if (r && typeof r.then === 'function') jobs.push(r);
  }
  inst._life = Promise.all(jobs);
  return inst;
}

(async () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  const routes = (appJson.pages || []).slice();
  (appJson.subpackages || []).forEach((sp) => (sp.pages || []).forEach((p) => routes.push(`${sp.root}/${p}`)));

  // 先跑 app.js（App() 会用 def.globalData 覆盖实例，所以之后要重新注入「已登录」状态）
  try {
    loadModule(path.join(ROOT, 'app.js'), { wx: global.wx, getApp: global.getApp, App: global.App });
    passed.push('app.js 模块加载');
  } catch (e) {
    failed.push(`app.js 模块加载失败：${e.message}`);
  }
  // 模拟静默登录已完成：openid + 档案就绪
  appInstance.globalData.openid = 'openid-test';
  appInstance.globalData.profile = sampleProfile;

  for (const route of routes) {
    const file = path.join(ROOT, `${route}.js`);
    if (!fs.existsSync(file)) { failed.push(`${route} 缺少 js`); continue; }

    let def = null;
    // ① 模块加载（白屏第一大成因）
    try {
      pageDefs.length = 0;
      loadModule(file, { wx: global.wx, getApp: global.getApp, Page: global.Page, Component: global.Component });
      if (!pageDefs.length) { failed.push(`${route} 未调用 Page()（模块可能提前 return）`); continue; }
      def = pageDefs[0];
      passed.push(`${route} 模块加载 + Page() 注册`);
    } catch (e) {
      failed.push(`${route} 模块加载抛错：${e.message}`);
      continue;
    }

    // ② onLoad / onShow 真跑一遍
    try {
      const inst = await exerciseLifecycle(def, route);
      // 断言：生命周期跑完后不应还卡在 loading（除非业务上确实在等待）
      if (inst.data.loading === true && inst.data.loadError === undefined) {
        failed.push(`${route} 生命周期跑完后 loading 仍为 true（会一直显示加载中/白屏）`);
      } else {
        passed.push(`${route} onLoad/onShow 执行无异常`);
      }
    } catch (e) {
      failed.push(`${route} 生命周期抛错：${e.message}`);
    }
  }

  // 组件
  const compDir = path.join(ROOT, 'components');
  if (fs.existsSync(compDir)) {
    for (const name of fs.readdirSync(compDir)) {
      const file = path.join(compDir, name, `${name}.js`);
      if (!fs.existsSync(file)) continue;
      try {
        compDefs.length = 0;
        loadModule(file, { wx: global.wx, getApp: global.getApp, Component: global.Component });
        if (!compDefs.length) { failed.push(`组件 ${name} 未调用 Component()`); continue; }
        const d = compDefs[0];
        // attached 生命周期
        if (d.lifetimes && typeof d.lifetimes.attached === 'function') {
          const inst = Object.assign({ data: JSON.parse(JSON.stringify(d.data || {})), setData(o) { Object.assign(inst.data, o); }, triggerEvent() {} }, d.methods || {}, d);
          Object.assign(inst.data, d.properties ? Object.fromEntries(Object.entries(d.properties).map(([k, v]) => [k, v.value])) : {});
          d.lifetimes.attached.call(inst);
        }
        passed.push(`组件 ${name} 加载 + attached 执行`);
      } catch (e) {
        failed.push(`组件 ${name} 抛错：${e.message}`);
      }
    }
  }

  // ---------------- 训练首页针对性用例 ----------------
  // 回归：以前 goWorkout() 把 week/day 写死成 0/1，练到第 3 周还永远进第 1 周第 1 天。
  // 这里直接断言「点开始跟练时跳出去的 URL」，光看页面不报错是抓不到这个的。
  {
    const statsService = require(path.join(ROOT, 'services/stats.js'));
    const pageFile = path.join(ROOT, 'pages/training/training.js');
    const realSummary = statsService.getHomeSummary;
    const realNavigate = global.wx.navigateTo;
    const urls = [];
    global.wx.navigateTo = (opt) => { urls.push(opt.url); };

    async function bootHome(summary, fail) {
      statsService.getHomeSummary = fail
        ? async () => { throw new Error('stats boom'); }
        : async () => summary;
      pageDefs.length = 0;
      loadModule(pageFile, { wx: global.wx, getApp: global.getApp, Page: global.Page, Component: global.Component });
      return exerciseLifecycle(pageDefs[0], 'pages/training/training');
    }

    function eq(name, actual, expected) {
      if (actual === expected) passed.push(name);
      else failed.push(`${name} → 期望 ${expected}，实际 ${actual}`);
    }

    function ok(name, cond, detail) {
      if (cond) passed.push(name);
      else failed.push(`${name}${detail ? ' → ' + detail : ''}`);
    }

    /** @type {any} */
    let inst = await bootHome({ streak: 2, totalCheckins: 2, weekDates: [], weekCount: 2, weekMin: 50, todayChecked: false });
    ok('首页：本周练 2 次 → 今天练第 3 节', inst.data.today && inst.data.today.dayNumber === 3,
      JSON.stringify(inst.data.today));
    eq('首页：周目标取档案的每周训练天数', inst.data.weekProgress.target, 3);
    eq('首页：本周进度文案', inst.data.weekProgress.text, '2/3');
    eq('首页：连续打卡天数透传', inst.data.streak, 2);
    eq('首页：本周时长文案', inst.data.weekMinText, '本周 50 分钟');
    eq('首页：首屏骨架屏已收起', inst.data.skVisible, false);
    eq('首页：首屏内容已落定', inst.data.planReady, true);
    eq('首页：周打卡条 7 格', inst.data.weekDays.length, 7);

    inst.goWorkout();
    eq('首页：开始跟练进第 1 周第 3 节',
      urls[0], '/packageA/workout/workout?planId=plan-1&week=0&day=3');

    // 练满 3 节 + 本周目标达成 → 推进到第 2 周第 1 节（周次与节次必须同步推进）
    urls.length = 0;
    inst = await bootHome({ streak: 3, totalCheckins: 3, weekDates: [], weekCount: 3, weekMin: 90, todayChecked: false });
    eq('首页：本周目标达成', inst.data.weekProgress.reached, true);
    eq('首页：练满 3 节 → 标记 weekDone', inst.data.today.weekDone, true);
    eq('首页：练满 3 节 → 周次推进到第 2 周', inst.data.today.weekNumber, 2);
    eq('首页：练满 3 节 → 节次回到第 1 节', inst.data.today.dayNumber, 1);
    inst.goWorkout();
    eq('首页：练满后跳第 2 周第 1 节',
      urls[0], '/packageA/workout/workout?planId=plan-1&week=1&day=1');

    urls.length = 0;
    inst = await bootHome({ streak: 4, totalCheckins: 4, weekDates: [], weekCount: 0, weekMin: 0, todayChecked: false });
    eq('首页：累计 4 节 → 第 2 周', inst.data.today.weekNumber, 2);
    eq('首页：累计 4 节 → 周内第 2 节', inst.data.today.dayNumber, 2);
    inst.goWorkout();
    eq('首页：跳第 2 周第 2 节',
      urls[0], '/packageA/workout/workout?planId=plan-1&week=1&day=2');

    // 今日已打卡：文案切到「再练一次」，但仍能进去加练
    urls.length = 0;
    inst = await bootHome({ streak: 5, totalCheckins: 5, weekDates: [], weekCount: 1, weekMin: 30, todayChecked: true });
    eq('首页：今日已打卡透传', inst.data.todayChecked, true);
    eq('首页：today 里也标记已打卡', inst.data.today.todayChecked, true);
    inst.goWorkout();
    ok('首页：已打卡后仍可再练一次', urls.length === 1, JSON.stringify(urls));

    // 统计接口挂了也不能白屏，且要退化成「本周 0/3」
    inst = await bootHome(null, true);
    ok('首页：统计失败仍是可渲染状态', inst.data.planReady === true && inst.data.weekCount === 0,
      `planReady=${inst.data.planReady} weekCount=${inst.data.weekCount}`);
    eq('首页：统计失败 → 周目标回退到档案值', inst.data.weekProgress.target, 3);

    // ---- 计划生成：必须走本地规则，不得再调云函数（审核驳回项，见 docs/REVIEW-AI-REMOVAL.md）----
    {
      const planSvc = require(path.join(ROOT, 'services/plan.js'));
      const realCreate = planSvc.createPlanLocal;
      const calls = [];
      planSvc.createPlanLocal = async (profile) => {
        calls.push(profile);
        return { planId: 'plan-2', planName: '新计划', structure: [] };
      };
      urls.length = 0;
      inst = await bootHome({ streak: 0, totalCheckins: 0, weekDates: [], weekCount: 0, weekMin: 0, todayChecked: false });
      await inst.generatePlan();
      eq('首页：生成计划调用本地规则编排', calls.length, 1);
      eq('首页：本地编排收到当前档案', calls[0] && calls[0].openid, 'openid-test');
      eq('首页：生成后带着新计划 id 进计划页', urls[0], '/packageA/plan/plan?id=plan-2');
      ok('首页：已不再有跳转教练页的入口', typeof inst.goCoach !== 'function');
      planSvc.createPlanLocal = realCreate;
    }

    statsService.getHomeSummary = realSummary;
    global.wx.navigateTo = realNavigate;
    passed.push('训练首页针对性用例（今日安排 / 周进度 / 跟练跳转）');
  }

  // ---------------- 用户协议 / 隐私政策 针对性用例 ----------------
  // 抓两类「静态检查看不见」的问题：
  //   ① 协议页拿错文档 / 非法参数白屏  ② 建档流程未勾选协议也能写库（合规硬伤）
  {
    const legalService = require(path.join(ROOT, 'services/legal.js'));
    const legalContent = require(path.join(ROOT, 'content/legal.js'));
    const legalFile = path.join(ROOT, 'packageA/legal/legal.js');
    const onboardingFile = path.join(ROOT, 'packageA/onboarding/onboarding.js');
    const mineFile = path.join(ROOT, 'pages/mine/mine.js');

    // 临时把 wx 的存储 / 跳转 / 提示换成可观测版本（跑完还原）
    const realWx = {
      navigateTo: global.wx.navigateTo,
      navigateBack: global.wx.navigateBack,
      showToast: global.wx.showToast,
      getStorageSync: global.wx.getStorageSync,
      setStorageSync: global.wx.setStorageSync,
      removeStorageSync: global.wx.removeStorageSync
    };
    const store = {};
    const urls = [];
    const toasts = [];
    let backs = 0;
    global.wx.getStorageSync = (k) => (k in store ? store[k] : '');
    global.wx.setStorageSync = (k, v) => { store[k] = v; };
    global.wx.removeStorageSync = (k) => { delete store[k]; };
    global.wx.navigateTo = (o) => { urls.push(o.url); };
    global.wx.navigateBack = () => { backs++; };
    global.wx.showToast = (o) => { toasts.push((o && o.title) || ''); };

    const clearStore = () => Object.keys(store).forEach((k) => delete store[k]);

    function eq(name, actual, expected) {
      if (actual === expected) passed.push(name);
      else failed.push(`${name} → 期望 ${expected}，实际 ${actual}`);
    }
    function ok(name, cond, detail) {
      if (cond) passed.push(name);
      else failed.push(`${name}${detail ? ' → ' + detail : ''}`);
    }

    // 带 query 的页面启动器直接复用上方的 bootPage（生命周期 Promise 在 inst._life 上）

    // ---- 协议页 ----
    let inst = bootPage(legalFile, {});
    eq('协议页：默认打开用户协议', inst.data.type, 'agreement');
    eq('协议页：渲染出全部分节', inst.data.doc.sections.length, legalContent.AGREEMENT.sections.length);
    eq('协议页：用户协议不渲染收集清单', inst.data.dataItems.length, 0);
    eq('协议页：顶部展示版本号', inst.data.version, legalContent.LEGAL_VERSION);
    eq('协议页：展示生效日期', inst.data.effective, legalContent.EFFECTIVE_DATE);
    eq('协议页：默认不出现同意条', inst.data.showAgreeBar, false);
    eq('协议页：切换标签 2 项', inst.data.tabs.length, 2);

    inst = bootPage(legalFile, { type: 'privacy' });
    eq('协议页：type=privacy 打开隐私政策', inst.data.doc.title, '隐私政策');
    eq('协议页：隐私政策渲染完整收集清单', inst.data.dataItems.length, legalContent.DATA_ITEMS.length);

    inst = bootPage(legalFile, { type: 'nope' });
    eq('协议页：非法 type 回退用户协议', inst.data.type, 'agreement');

    inst = bootPage(legalFile, { type: 'agreement' });
    inst.switchTab({ currentTarget: { dataset: { type: 'privacy' } } });
    eq('协议页：点标签切到隐私政策', inst.data.type, 'privacy');
    eq('协议页：切换后带出收集清单', inst.data.dataItems.length, legalContent.DATA_ITEMS.length);
    inst.switchTab({ currentTarget: { dataset: { type: 'privacy' } } });
    eq('协议页：重复点当前标签不变', inst.data.type, 'privacy');
    inst.switchTab({ currentTarget: { dataset: { type: 'bogus' } } });
    eq('协议页：标签值非法时忽略', inst.data.type, 'privacy');

    // 从建档流程进入 → 底部同意条
    clearStore();
    inst = bootPage(legalFile, { type: 'privacy', from: 'onboarding' });
    eq('协议页：建档流程进入显示同意条', inst.data.showAgreeBar, true);
    eq('协议页：此时尚未同意', inst.data.agreed, false);
    toasts.length = 0;
    backs = 0;
    inst.onAgree();
    eq('协议页：点同意写入同意记录', legalService.isAccepted(), true);
    eq('协议页：点同意后标记 agreed', inst.data.agreed, true);
    eq('协议页：点同意给出提示', toasts.length, 1);
    await new Promise((r) => setTimeout(r, 600));
    eq('协议页：同意后自动返回上一页', backs, 1);

    // ---- 建档页：未同意不得完成建档 ----
    clearStore();
    inst = bootPage(onboardingFile, {});
    eq('建档页：初始未勾选协议', inst.data.agreed, false);
    inst.goStep(4);
    eq('建档页：档案回填后最后一步可继续', inst.data.canNext, true);
    let submitted = false;
    inst.submit = () => { submitted = true; };
    toasts.length = 0;
    inst.nextStep();
    eq('建档页：未同意时拦截「完成建档」', submitted, false);
    ok('建档页：拦截时提示要勾选协议',
      toasts.some((t) => t.indexOf('请先阅读') >= 0), JSON.stringify(toasts));
    eq('建档页：拦截时抖动提示勾选框', inst.data.agreeShake, true);

    inst.onToggleAgree();
    eq('建档页：勾选后 agreed 为 true', inst.data.agreed, true);
    eq('建档页：勾选即写入同意记录', legalService.isAccepted(), true);
    inst.nextStep();
    eq('建档页：同意后放行提交', submitted, true);

    inst.onToggleAgree();
    eq('建档页：取消勾选 agreed 为 false', inst.data.agreed, false);
    eq('建档页：取消勾选即撤回同意记录', legalService.isAccepted(), false);

    // 从协议页点了同意再返回 → onShow 必须同步
    clearStore();
    inst = bootPage(onboardingFile, {});
    eq('建档页：新开一页时未勾选', inst.data.agreed, false);
    legalService.accept();
    inst.onShow();
    eq('建档页：onShow 同步协议页的同意结果', inst.data.agreed, true);

    urls.length = 0;
    inst.goLegal({ currentTarget: { dataset: { type: 'privacy' } } });
    eq('建档页：点《隐私政策》跳协议页',
      urls[0], '/packageA/legal/legal?type=privacy&from=onboarding');
    inst.goLegal({ currentTarget: {} });
    eq('建档页：无 data-type 时兜底用户协议',
      urls[1], '/packageA/legal/legal?type=agreement&from=onboarding');

    // ---- 我的页：入口与状态 ----
    clearStore();
    inst = bootPage(mineFile, {});
    eq('我的页：未同意时状态文案', inst.data.legalStatus, '未同意');
    eq('我的页：未同意时入口高亮', inst.data.legalWarn, true);
    ok('我的页：展示应用版本号',
      typeof inst.data.appVersion === 'string' && inst.data.appVersion.length > 0, inst.data.appVersion);

    legalService.accept();
    inst.refresh();
    eq('我的页：同意后状态文案带版本', inst.data.legalStatus, `已同意 ${legalContent.LEGAL_VERSION}`);
    eq('我的页：同意后取消高亮', inst.data.legalWarn, false);

    // 协议升级后（模拟版本号变化）入口应重新高亮
    const savedVersion = legalContent.LEGAL_VERSION;
    try {
      legalContent.LEGAL_VERSION = 'v9.9';
      inst.refresh();
      eq('我的页：协议升级后文案提示已更新', inst.data.legalStatus, '协议已更新');
      eq('我的页：协议升级后入口重新高亮', inst.data.legalWarn, true);
    } finally {
      legalContent.LEGAL_VERSION = savedVersion;
    }

    urls.length = 0;
    inst.goLegal({ currentTarget: { dataset: { type: 'privacy' } } });
    eq('我的页：点隐私政策跳协议页', urls[0], '/packageA/legal/legal?type=privacy');
    inst.goLegal({ currentTarget: { dataset: {} } });
    eq('我的页：无类型时兜底用户协议', urls[1], '/packageA/legal/legal?type=agreement');

    // 还原
    global.wx.navigateTo = realWx.navigateTo;
    global.wx.navigateBack = realWx.navigateBack;
    global.wx.showToast = realWx.showToast;
    global.wx.getStorageSync = realWx.getStorageSync;
    global.wx.setStorageSync = realWx.setStorageSync;
    global.wx.removeStorageSync = realWx.removeStorageSync;

    passed.push('协议页 / 建档同意闸门 / 我的页入口 针对性用例');
  }

  // ---------------- 成就徽章 针对性用例 ----------------
  // 抓两类静态检查看不见的问题：
  //   ① 首页徽章入口的数字是不是真的走通了同步（而不是永远 0/13）
  //   ② 新解锁提示会不会重复弹（解锁记录没落盘就会每次都弹）
  {
    const statsService = require(path.join(ROOT, 'services/stats.js'));
    const badgesService = require(path.join(ROOT, 'services/badges.js'));
    const trainingFile = path.join(ROOT, 'pages/training/training.js');
    const badgesFile = path.join(ROOT, 'packageA/badges/badges.js');
    const mineFile = path.join(ROOT, 'pages/mine/mine.js');

    const realWx = {
      navigateTo: global.wx.navigateTo,
      showToast: global.wx.showToast,
      getStorageSync: global.wx.getStorageSync,
      setStorageSync: global.wx.setStorageSync,
      removeStorageSync: global.wx.removeStorageSync
    };
    const realHome = statsService.getHomeSummary;
    const realBadgeStats = statsService.getBadgeStats;

    const store = {};
    const urls = [];
    const toasts = [];
    global.wx.getStorageSync = (k) => (k in store ? store[k] : '');
    global.wx.setStorageSync = (k, v) => { store[k] = v; };
    global.wx.removeStorageSync = (k) => { delete store[k]; };
    global.wx.navigateTo = (o) => { urls.push(o.url); };
    global.wx.showToast = (o) => { toasts.push((o && o.title) || ''); };

    const clearStore = () => Object.keys(store).forEach((k) => delete store[k]);
    const eq = (name, actual, expected) => {
      if (actual === expected) passed.push(name);
      else failed.push(`${name} → 期望 ${expected}，实际 ${actual}`);
    };
    const ok = (name, cond, detail) => {
      if (cond) passed.push(name);
      else failed.push(`${name}${detail ? ' → ' + detail : ''}`);
    };

    const HOME = { streak: 3, totalCheckins: 3, weekDates: [], weekCount: 3, weekMin: 90, todayChecked: false };
    const TOTALS = { totalCheckins: 3, bestStreak: 3, totalMin: 90, totalSets: 27, monthCount: 3 };
    statsService.getHomeSummary = async () => HOME;
    statsService.getBadgeStats = async () => TOTALS;

    // ---- 训练首页：入口数字 + 新解锁提示 ----
    clearStore();
    toasts.length = 0;
    let inst = bootPage(trainingFile, {}, 'pages/training/training');
    await inst._life;
    eq('首页：徽章总数渲染', inst.data.badgeTotal, 13);
    eq('首页：徽章解锁数走通同步', inst.data.badgeUnlocked, 2);
    ok('首页：有统计与最佳连续时能算出徽章', inst.data.badgeUnlocked === 2,
      `badgeUnlocked=${inst.data.badgeUnlocked}`);
    ok('首页：新解锁弹出提示', toasts.some((t) => t.indexOf('解锁成就') >= 0), JSON.stringify(toasts));

    urls.length = 0;
    inst.goBadges();
    eq('首页：成就徽章入口跳转正确', urls[0], '/packageA/badges/badges');

    // 再进一次：解锁记录已落盘，不该重复提示
    toasts.length = 0;
    inst = bootPage(trainingFile, {}, 'pages/training/training');
    await inst._life;
    eq('首页：再次进入解锁数不变', inst.data.badgeUnlocked, 2);
    eq('首页：不重复弹新解锁提示', toasts.filter((t) => t.indexOf('解锁成就') >= 0).length, 0);

    // ---- 徽章页：渲染 ----
    inst = bootPage(badgesFile, {}, 'packageA/badges/badges');
    await inst._life;
    eq('徽章页：总数', inst.data.total, 13);
    eq('徽章页：解锁数与首页一致', inst.data.unlockedCount, 2);
    eq('徽章页：顶部百分比', inst.data.percent, Math.round((2 / 13) * 100));
    ok('徽章页：分组已渲染', inst.data.groups.length > 0, inst.data.groups.length);
    eq('徽章页：分组徽章总数等于全部徽章',
      inst.data.groups.reduce((n, g) => n + g.items.length, 0), 13);
    ok('徽章页：有下一个目标', !!inst.data.next, JSON.stringify(inst.data.next));
    ok('徽章页：本次无新解锁', inst.data.newly.length === 0, JSON.stringify(inst.data.newly));
    eq('徽章页：骨架屏已收起', inst.data.skVisible, false);
    eq('徽章页：无错误', inst.data.loadError, '');
    const unlockedTile = inst.data.groups
      .reduce((a, g) => a.concat(g.items), [])
      .filter((b) => b.unlocked)[0];
    ok('徽章页：已解锁徽章带解锁日期文案',
      !!unlockedTile && unlockedTile.unlockedText.indexOf('解锁于') >= 0,
      unlockedTile && unlockedTile.unlockedText);
    const lockedTile = inst.data.groups
      .reduce((a, g) => a.concat(g.items), [])
      .filter((b) => !b.unlocked)[0];
    ok('徽章页：未解锁徽章带剩余文案', !!lockedTile && !!lockedTile.remainText, lockedTile && lockedTile.remainText);

    // ---- 徽章页：新解锁高亮 ----
    clearStore();
    statsService.getBadgeStats = async () => ({ totalCheckins: 10, bestStreak: 7, totalMin: 600, totalSets: 100, monthCount: 5 });
    inst = bootPage(badgesFile, {}, 'packageA/badges/badges');
    await inst._life;
    ok('徽章页：跨阈值时报告新解锁', inst.data.newly.length >= 3, JSON.stringify(inst.data.newly));
    ok('徽章页：新解锁名称拼接成文案', inst.data.newlyText.indexOf('、') >= 0 || inst.data.newly.length === 1,
      inst.data.newlyText);
    eq('徽章页：新解锁数 = 本次解锁总数', inst.data.newly.length, inst.data.unlockedCount);

    const isNewTile = inst.data.groups
      .reduce((a, g) => a.concat(g.items), [])
      .filter((b) => b.isNew);
    eq('徽章页：新解锁徽章被标记 isNew', isNewTile.length, inst.data.newly.length);

    // 再进一次：不再标记新解锁，解锁数不变
    // （该指标组合命中的是：建档 / 首次 / 10 次 / 坚持一周 / 十小时 = 5 枚）
    inst = bootPage(badgesFile, {}, 'packageA/badges/badges');
    await inst._life;
    eq('徽章页：二次进入无新解锁', inst.data.newly.length, 0);
    eq('徽章页：二次进入解锁数保持', inst.data.unlockedCount, 5);

    // ---- 徽章页：指标失败降级 ----
    statsService.getBadgeStats = async () => { throw new Error('badge boom'); };
    inst = bootPage(badgesFile, {}, 'packageA/badges/badges');
    await inst._life;
    ok('徽章页：指标失败展示错误卡', inst.data.loadError.indexOf('加载失败') >= 0, inst.data.loadError);
    eq('徽章页：失败时不挂骨架屏', inst.data.skVisible, false);
    eq('徽章页：失败时不渲染分组', inst.data.groups.length, 0);

    // 重试：错误卡只在成功时清（避免失败后又把内容顶掉）
    statsService.getBadgeStats = async () => TOTALS;
    inst.retry();
    await new Promise((r) => setTimeout(r, 20));
    eq('徽章页：重试后清掉错误', inst.data.loadError, '');
    ok('徽章页：重试后渲染出分组', inst.data.groups.length > 0, inst.data.groups.length);

    // ---- 我的页：入口角标 ----
    inst = bootPage(mineFile, {}, 'pages/mine/mine');
    await inst._life;
    eq('我的页：徽章总数', inst.data.badgeTotal, 13);
    eq('我的页：徽章解锁数与本地记录一致', inst.data.badgeCount, badgesService.unlockedCount());
    urls.length = 0;
    inst.goBadges();
    eq('我的页：成就徽章入口跳转正确', urls[0], '/packageA/badges/badges');

    // 还原
    statsService.getHomeSummary = realHome;
    statsService.getBadgeStats = realBadgeStats;
    global.wx.navigateTo = realWx.navigateTo;
    global.wx.showToast = realWx.showToast;
    global.wx.getStorageSync = realWx.getStorageSync;
    global.wx.setStorageSync = realWx.setStorageSync;
    global.wx.removeStorageSync = realWx.removeStorageSync;

    passed.push('成就徽章针对性用例（首页入口 / 徽章页渲染 / 新解锁幂等 / 失败降级）');
  }

  console.log('\n================ 页面冒烟测试 ================\n');
  passed.forEach((s) => console.log('   ✅ ' + s));
  if (failed.length) {
    console.log('\n❌ 失败（' + failed.length + '）：');
    failed.forEach((s) => console.log('   · ' + s));
    console.log('\n结论：存在 ' + failed.length + ' 个运行时问题，需修复（这类问题在开发者工具里通常表现为白屏）\n');
    process.exit(1);
  }
  console.log('\n结论：全部页面生命周期执行通过 ✅（' + passed.length + ' 项）\n');
})();
