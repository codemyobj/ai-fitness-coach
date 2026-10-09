/**
 * test-rest-page.js — 跟练页「组间休息倒计时」的状态机测试（离线运行）
 *
 * 为什么单独写：倒计时是纯时序逻辑，靠肉眼看不出错。这里用
 * 假时钟（Date.now 可控）+ 手动计时器队列，把「勾选一组 → 倒计时 → 归零 →
 * 自动收起 / 暂停 / ±15s / 最后一组不休息」整条链路真跑一遍。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, 'miniprogram');
const passed = [];
const failed = [];
function ok(name, cond, extra) {
  if (cond) { passed.push(name); console.log(`   ✅ ${name}`); }
  else { failed.push(name); console.log(`   ❌ ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`); }
}
function eq(name, actual, expected) {
  ok(`${name}（期望 ${JSON.stringify(expected)}）`, actual === expected, actual);
}
function section(t) { console.log(`\n${t}`); }

// ---------------- 假时钟 ----------------
const RealDate = Date;
let now = 1700000000000;
function FakeDate() { return new RealDate(now); }
FakeDate.now = () => now;

// ---------------- 手动计时器队列 ----------------
const timers = { intervals: {}, timeouts: {}, seq: 0 };
function setIntervalFake(fn, delay) {
  const id = ++timers.seq;
  timers.intervals[id] = { fn, delay: delay || 250 };
  return id;
}
function clearIntervalFake(id) { delete timers.intervals[id]; }
function setTimeoutFake(fn, delay) {
  const id = ++timers.seq;
  timers.timeouts[id] = { fn, at: now + (delay || 0) };
  return id;
}
function clearTimeoutFake(id) { delete timers.timeouts[id]; }

// 推进 ms 毫秒：逐 250ms 触发一次 interval，到期 timeout 也一起跑
function advance(ms) {
  let left = ms;
  while (left > 0) {
    const d = Math.min(250, left);
    now += d;
    left -= d;
    Object.keys(timers.timeouts).forEach((id) => {
      if (timers.timeouts[id].at <= now) {
        const fn = timers.timeouts[id].fn;
        delete timers.timeouts[id];
        fn();
      }
    });
    Object.keys(timers.intervals).forEach((id) => {
      const it = timers.intervals[id];
      if (it) it.fn();
    });
  }
}

// ---------------- mock 环境 ----------------
const buzzCalls = [];
let keptScreenOn = null;
function makeCollection() {
  const chain = {
    where() { return chain; }, orderBy() { return chain; }, limit() { return chain; },
    skip() { return chain; }, field() { return chain; }, doc() { return chain; },
    async get() { return { data: [] }; }, async add() { return { _id: 'x' }; },
    async update() { return { stats: { updated: 1 } }; }, async remove() { return { stats: { removed: 0 } }; },
    async count() { return { total: 0 }; }
  };
  return chain;
}
const wxMock = {
  cloud: {
    init() {},
    database: () => ({ collection: () => makeCollection(), serverDate: () => ({ $date: now }), command: { gte: (v) => ({ gte: v }), lte: (v) => ({ lte: v }) } }),
    callFunction: async () => ({ result: { code: 0 } })
  },
  getStorageSync: () => '',           // → rest.getDefault() = 60 秒
  setStorageSync() {}, removeStorageSync() {},
  showToast() {}, showLoading() {}, hideLoading() {}, showModal() {}, navigateBack() {},
  vibrateShort: (o) => buzzCalls.push(o && o.type),
  setKeepScreenOn: (o) => { keptScreenOn = !!o.keepScreenOn; },
  stopPullDownRefresh() {}, startPullDownRefresh() {}, nextTick: (fn) => fn()
};
global.wx = wxMock;                    // Node 侧（services/*）用
const appInstance = { globalData: { openid: 'o1', profile: null, debugMode: false }, on() {}, off() {}, emit() {} };
global.getApp = () => appInstance;

// ---------------- 加载跟练页 ----------------
const pageDefs = [];
const sandboxContext = {
  wx: wxMock,
  getApp: global.getApp,
  Page: (def) => pageDefs.push(def),
  Component: () => {},
  Date: FakeDate,
  setInterval: setIntervalFake,
  clearInterval: clearIntervalFake,
  setTimeout: setTimeoutFake,
  clearTimeout: clearTimeoutFake
};
function loadPage() {
  pageDefs.length = 0;
  const file = path.join(ROOT, 'packageA/workout/workout.js');
  const code = fs.readFileSync(file, 'utf8');
  const mod = { exports: {} };
  const localRequire = (id) => {
    const abs = id.startsWith('.') ? path.resolve(path.dirname(file), id) : id;
    return require(abs);
  };
  const sandbox = Object.assign({ require: localRequire, module: mod, exports: mod.exports, console, __dirname: path.dirname(file) }, sandboxContext);
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: file });
  return pageDefs[0];
}
const def = loadPage();

// 构造页面实例（只跑「休息」相关方法，不触发云请求）
function makePage(overrides) {
  // 每个用例都是「一张新页面」，把上一页遗留的计时器清掉，避免跨用例互相污染
  timers.intervals = {};
  timers.timeouts = {};
  // 注意顺序：先把页面定义摊进来，再覆盖 data —— 反过来 def.data 会把测试用的初值冲掉
  const inst = Object.assign({}, def, {
    data: Object.assign(JSON.parse(JSON.stringify(def.data)), overrides || {}),
    setData(obj, cb) { Object.assign(inst.data, obj); if (typeof cb === 'function') cb(); }
  });
  return inst;
}
function toggleSet(inst, id, doneCount, total) {
  inst.onSetChange({ currentTarget: { dataset: { id } }, detail: { doneCount, total, sets: [] } });
}
const DAY = {
  dayIndex: 1,
  focus: '全身',
  exercises: [
    { exerciseId: 'squat', name: '深蹲', sets: 3 },
    { exerciseId: 'plank', name: '平板支撑', sets: 3 }
  ]
};

// ---------------- 用例 ----------------
section('1. 勾选一组 → 自动开始倒计时');
let p = makePage({ day: DAY, progress: {}, restEnabled: true, restTotal: 60 });
ok('初始不显示休息条', p.data.restActive === false);
toggleSet(p, 'squat', 1, 3);
eq('休息条出现', p.data.restActive, true);
eq('倒计时从 60 秒开始', p.data.restText, '01:00');
eq('进度条满格', p.data.restPercent, 100);
eq('提示下一组是第 2/3 组', p.data.restNext, '深蹲 · 第 2/3 组');
eq('注册了 1 个计时器', Object.keys(timers.intervals).length, 1);
eq('本次训练总用时计时器未受影响', Object.keys(timers.intervals).length, 1);

section('2. 倒计时按真实时间走（切后台/掉帧不漂移）');
advance(25000);
eq('25 秒后剩 35 秒', p.data.restLeft, 35);
eq('文案同步', p.data.restText, '00:35');
eq('进度条 35/60 ≈ 58%', p.data.restPercent, 58);
// 模拟切后台 20 秒（没有任何 tick 触发），回来一次性推进时间
now += 20000;
p.tickRest();
eq('时间按时间戳算，不掉秒', p.data.restLeft, 15);
eq('文案同步为 00:15', p.data.restText, '00:15');

section('3. 暂停 / 继续');
p.toggleRest();
eq('已暂停', p.data.restPaused, true);
eq('暂停后计时器被清掉', Object.keys(timers.intervals).length, 0);
advance(30000);
eq('暂停期间剩余时间不变', p.data.restLeft, 15);
p.toggleRest();
eq('恢复后不再暂停', p.data.restPaused, false);
advance(5000);
eq('恢复后继续倒计时', p.data.restLeft, 10);

section('4. ±15 秒微调');
p.adjustRest({ currentTarget: { dataset: { delta: 15 } } });
eq('+15s 后剩 25 秒', p.data.restLeft, 25);
eq('总时长抬高到 60（进度条不溢出）', p.data.restTotal, 60);
eq('进度条 25/60 ≈ 42%', p.data.restPercent, 42);
p.adjustRest({ currentTarget: { dataset: { delta: -15 } } });
eq('−15s 后剩 10 秒', p.data.restLeft, 10);
eq('总时长不会被改小', p.data.restTotal, 60);
p.adjustRest({ currentTarget: { dataset: { delta: -15 } } });
eq('减到下限 5 秒（不会出现 0 或负数）', p.data.restLeft, 5);
p.adjustRest({ currentTarget: { dataset: { delta: -15 } } });
eq('继续减仍是下限 5 秒', p.data.restLeft, 5);

section('5. 归零 → 震动提示 → 6 秒后自动收起');
buzzCalls.length = 0;
advance(5000);
eq('倒计时归零', p.data.restLeft, 0);
eq('进入「休息结束」态', p.data.restDone, true);
eq('文案为 00:00', p.data.restText, '00:00');
eq('进度条清空', p.data.restPercent, 0);
eq('倒计时计时器已停止', Object.keys(timers.intervals).length, 0);
advance(300); // 让「第二震」落地（首次震动是同步触发的）
eq('震动提示触发 2 次（双震）', buzzCalls.length, 2);
ok('已安排自动收起（1 个待执行定时器）', Object.keys(timers.timeouts).length === 1, Object.keys(timers.timeouts).length);
advance(6000);
eq('6 秒后自动收起', p.data.restActive, false);
eq('收起后清空提示文案', p.data.restNext, '');

section('6. 今天的最后一个动作做完 → 不进入休息');
p = makePage({ day: DAY, progress: {}, restEnabled: true, restTotal: 60 });
toggleSet(p, 'plank', 3, 3);
eq('最后一个动作做满不休息', p.data.restActive, false);
eq('没有注册计时器', Object.keys(timers.intervals).length, 0);

section('7. 取消勾选（手滑）不启动倒计时');
p = makePage({ day: DAY, progress: { squat: { doneCount: 2, total: 3, sets: [] } }, restEnabled: true, restTotal: 60 });
toggleSet(p, 'squat', 1, 3);
eq('组数减少不触发休息', p.data.restActive, false);

section('8. 关闭自动休息时不启动');
p = makePage({ day: DAY, progress: {}, restEnabled: false, restTotal: 60 });
toggleSet(p, 'squat', 1, 3);
eq('restEnabled=false 时不弹休息条', p.data.restActive, false);

section('9. 跨动作：本动作做满 → 提示下一个动作');
p = makePage({ day: DAY, progress: {}, restEnabled: true, restTotal: 60 });
toggleSet(p, 'squat', 3, 3);
eq('切换到下一个动作的提示', p.data.restNext, '下一个：平板支撑 3 组');
eq('仍然进入休息', p.data.restActive, true);
p.hideRest();

section('10. 休息中再完成一组 → 重新计时');
toggleSet(p, 'plank', 1, 3);
advance(20000);
eq('先走掉 20 秒', p.data.restLeft, 40);
toggleSet(p, 'plank', 2, 3);
eq('重新开始计时', p.data.restLeft, 60);
eq('提示更新为第 3/3 组', p.data.restNext, '平板支撑 · 第 3/3 组');
eq('新旧计时器没有叠加（仍只有 1 个）', Object.keys(timers.intervals).length, 1);

section('11. 手动跳过');
p.hideRest();
eq('跳过立即收起', p.data.restActive, false);
eq('计时器全部清空', Object.keys(timers.intervals).length, 0);
advance(1000);
eq('收起后不会再被 tick 唤醒', p.data.restActive, false);

section('12. 休息结束态点数字 = 立即收起');
p = makePage({ day: DAY, progress: {}, restEnabled: true, restTotal: 30 });
toggleSet(p, 'squat', 1, 3);
advance(30000);
eq('已结束', p.data.restDone, true);
p.toggleRest();
eq('点一下直接收起', p.data.restActive, false);

section('13. 跟练页保持屏幕常亮（休息时用户不看手机）');
// 单独跑一次 onLoad 观察 setKeepScreenOn
p = makePage({ day: DAY });
p.options = {};
p.load = async () => {};   // 屏蔽云请求，只验证页面级设置
p.onLoad({});
eq('进入跟练页开启常亮', keptScreenOn, true);
p.onUnload();
eq('离开跟练页关闭常亮', keptScreenOn, false);

section('14. 不残留计时器（否则页面销毁后仍在 setData）');
p = makePage({ day: DAY, progress: {}, restEnabled: true, restTotal: 60 });
toggleSet(p, 'squat', 1, 3);
eq('休息中', Object.keys(timers.intervals).length, 1);
p.onUnload();
eq('卸载后计时器清空', Object.keys(timers.intervals).length, 0);
eq('卸载后待执行的 timeout 也清空', Object.keys(timers.timeouts).length, 0);

console.log('\n================ 结果：' + passed.length + ' 通过 / ' + failed.length + ' 失败 ================\n');
process.exit(failed.length ? 1 : 0);
