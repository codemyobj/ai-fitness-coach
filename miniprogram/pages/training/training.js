// pages/training/training.js — 训练首页
const app = getApp();
const { formatGreeting } = require('../../utils/util.js');
const planService = require('../../services/plan.js');
const statsService = require('../../services/stats.js');
const session = require('../../services/session.js');
const badges = require('../../services/badges.js');
const favorites = require('../../services/favorites.js');
const skeleton = require('../../utils/skeleton.js');
const share = require('../../utils/share.js');

const GOAL_TEXT = {
  fat_loss: '减脂塑形',
  muscle_gain: '增肌变强',
  endurance: '提升体能',
  posture: '体态改善'
};

// 加载失败时的空概览（页面照常渲染，不因为统计挂了就白屏）
const EMPTY_SUMMARY = {
  streak: 0,
  totalCheckins: 0,
  weekDates: [],
  weekCount: 0,
  weekMin: 0,
  todayChecked: false
};

Page({
  data: {
    loading: true,
    skVisible: false, // 首屏骨架屏显隐（由 utils/skeleton.js 的闸门驱动）
    statusBarHeight: 24, // 自定义导航：给 hero 顶部让出状态栏（onLoad 取真实值）
    hasProfile: false,
    profile: null,
    goalText: '',
    nickname: '',
    todayText: '',
    greeting: '',
    // 本周打卡（自然周：周一 → 周日）
    weekDays: [],
    weekCount: 0,
    weekTarget: 0,
    weekProgress: { done: 0, target: 0, percent: 0, reached: false, text: '0/0' },
    weekMinText: '',
    ringBg: session.ringGradient(0),
    streak: 0,
    todayChecked: false,
    // 今日该练哪一节（由 services/session.js 推导，不再写死 day=1）
    today: null,
    plan: null,
    // 成就徽章：初始值直接读本地已解锁数，不等待云请求
    badgeUnlocked: badges.unlockedCount(),
    badgeTotal: badges.TOTAL,
    planReady: false, // 计划 + 本周打卡是否已落定（落定前显示骨架屏）
    planLoading: false,
    loginError: ''
  },

  onLoad() {
    this.sk = skeleton.gate(this);
    this._summary = null;
    // 沉浸式头部需要避开状态栏
    try {
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarHeight: win.statusBarHeight || 24 });
    } catch (e) { /* 用默认值兜底 */ }
    // 档案可能晚于页面加载（登录是异步的），监听事件刷新。
    // 保存绑好 this 的引用 —— 否则 off() 传原函数摘不掉监听，页面卸载后回调还会跑
    this._onProfileLoaded = this.renderProfile.bind(this);
    this._onOpenidReady = this.onOpenidReady.bind(this);
    this._onLoginFailed = this.onLoginFailed.bind(this);
    app.on('profileLoaded', this._onProfileLoaded);
    app.on('openidReady', this._onOpenidReady);
    app.on('loginFailed', this._onLoginFailed);
    this.initToday();
  },

  onShow() {
    const today = this.todayKey();
    const needLoad = this._loadedDate !== today || this._dirty;
    // 性能：切 tab 会高频触发 onShow，但今天已加载过就不必再打云请求。
    // 服务层另有 TTL 缓存兜底；跨天 / 打卡后（_dirty）才会真正重新拉取。
    this._loadedDate = today;
    this._dirty = false;

    if (app.globalData.profile) {
      this.renderProfile(app.globalData.profile);
    } else if (app.globalData.openid) {
      app.loadProfile();
    }

    // 冷启动时登录 / 档案还没就绪：骨架屏先挂着，openidReady、profileLoaded 会接着走
    if (!app.globalData.openid || !app.globalData.profile) {
      this.bootStart();
      return undefined;
    }
    if (!needLoad) return this._contentPromise;
    // 返回 Promise，页面级冒烟测试会等它落定（真机忽略返回值）
    return this.loadContent();
  },

  onUnload() {
    app.off('profileLoaded', this._onProfileLoaded);
    app.off('openidReady', this._onOpenidReady);
    app.off('loginFailed', this._onLoginFailed);
    this.sk.stop();
  },

  // 标记数据已变脏（如从跟练页返回），下次 onShow 强制刷新
  markDirty() {
    this._dirty = true;
  },

  todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  },

  // ---------- 首屏骨架屏 ----------
  // 只在「首屏还没落定」时开；已有内容（下拉刷新 / 切回来）旧内容留在屏上，不闪。
  bootStart() {
    if (this.data.loginError) return;
    if (this.data.planReady) return;
    this.sk.start();
  },

  bootEnd() {
    this.setData({ loading: false, planReady: true });
    this.sk.stop();
  },

  // 计划 + 本周打卡一起等，两份都落定才收起骨架屏（避免先闪一个"无计划"占位再跳成计划）
  loadContent() {
    if (this._contentPromise) return this._contentPromise;
    const self = this;
    this.bootStart();
    // loadPlan / loadSummary / loadBadges 内部各自兜错，不会 reject。
    // loadBadges 与 loadSummary 都走 listLogs(365) 的同一个缓存项 → 不会多打一次云请求。
    this._contentPromise = Promise.all([this.loadPlan(), this.loadSummary(), this.loadBadges()]).then(() => {
      self._contentPromise = null;
      self.renderToday();
      self.bootEnd();
    });
    return this._contentPromise;
  },

  // 初始化日期与问候语、本周打卡条（周一 → 周日，未来置灰）
  initToday() {
    const now = new Date();
    this.setData({
      todayText: session.cnDateTitle(now),
      greeting: formatGreeting(now),
      weekDays: session.buildWeekBar(now, [])
    });
  },

  renderProfile(profile) {
    const hasProfile = !!profile;
    this.setData({
      loginError: '',
      hasProfile,
      profile: profile || null,
      goalText: profile ? (GOAL_TEXT[profile.goal] || '综合健身') : '',
      nickname: (profile && profile.nickname) || ''
    });
    if (!hasProfile) {
      // 未建档：没什么可等的，收起骨架屏露出建档引导
      this.bootEnd();
    } else if (!this.data.planReady) {
      this.loadContent();
    }
  },

  // 登录成功、档案加载完成前的过渡（openidReady 早于 profileLoaded）
  onOpenidReady() {
    if (app.globalData.profile) this.loadContent();
    else this.bootStart();
  },

  // 登录失败：展示原因 + 重试入口（不再白屏）
  onLoginFailed(errMsg) {
    this.sk.stop();
    this.setData({
      loading: false,
      loginError: errMsg || '未知错误'
    });
  },

  retryLogin() {
    this.setData({ loading: true, loginError: '', planReady: false });
    this.sk.start();
    app.globalData.openid = null;
    app.silentLogin();
  },

  // 加载当前生效计划（静默失败，不打扰用户）
  async loadPlan() {
    if (!app.globalData.openid || !app.globalData.profile) return;
    try {
      const plan = await planService.getActivePlan();
      this.setData({ plan });
    } catch (err) {
      console.warn('计划加载失败:', err);
    }
  },

  // 加载打卡概览（连续天数 / 本周进度 / 今日是否已打卡）
  // 数据来自 stats 的 365 天聚合缓存，和看板共用同一批记录，不额外打云请求
  async loadSummary() {
    if (!app.globalData.openid) return;
    let sum = EMPTY_SUMMARY;
    try {
      sum = (await statsService.getHomeSummary()) || EMPTY_SUMMARY;
    } catch (err) {
      console.warn('训练概览加载失败:', err);
    }
    this._summary = sum;
    this.setData({
      streak: sum.streak || 0,
      todayChecked: !!sum.todayChecked,
      weekCount: sum.weekCount || 0,
      weekMinText: sum.weekMin ? `本周 ${sum.weekMin} 分钟` : '',
      weekDays: session.buildWeekBar(new Date(), sum.weekDates)
    });
  },

  // 成就徽章：判定 + 记录解锁（顺带把首页入口的数字刷新掉）
  // 指标来自 stats.getBadgeStats()，与上面的 loadSummary 共用同一批记录缓存，0 次额外云查询。
  async loadBadges() {
    if (!app.globalData.openid) return;
    try {
      const totals = await statsService.getBadgeStats();
      const res = badges.sync(badges.buildMetrics(totals, {
        hasProfile: !!(app.globalData && app.globalData.profile),
        favCount: favorites.count()
      }));
      this.setData({ badgeUnlocked: res.unlockedCount, badgeTotal: res.total });
      if (res.newlyUnlocked.length) {
        // 解锁记录已落盘，所以这条提示只会出现一次
        const names = res.list.filter((b) => b.isNew).map((b) => b.name);
        wx.showToast({
          title: `🎉 解锁成就：${names.slice(0, 2).join('、')}${names.length > 2 ? ` 等 ${names.length} 枚` : ''}`,
          icon: 'none',
          duration: 2500
        });
      }
    } catch (err) {
      // 徽章是锦上添花，失败绝不能影响首页主内容
      console.warn('徽章同步失败:', err);
      this.setData({ badgeUnlocked: badges.unlockedCount(), badgeTotal: badges.TOTAL });
    }
  },

  // 计划 + 打卡都拿到后再算「今天练哪一节」和目标进度：
  // 单看任一份都不足（周次推进会用到计划里的每周天数）
  renderToday() {
    const sum = this._summary || EMPTY_SUMMARY;
    const today = session.resolveToday({
      plan: this.data.plan,
      weekCount: sum.weekCount,
      totalCheckins: sum.totalCheckins,
      todayChecked: sum.todayChecked
    });
    const prog = session.weekProgress(sum.weekCount, today.daysPerWeek);
    this.setData({
      today,
      weekTarget: prog.target,
      weekProgress: prog,
      ringBg: session.ringGradient(prog.percent)
    });
  },

  // 生成训练计划
  // 走本地规则编排（services/plan.js#createPlanLocal）：按档案的每周天数、训练目标、
  // 可用器械筛选动作池，4 周渐进。**不涉及任何 AI 生成内容**——深度合成类目个人主体未开放，
  // 已按审核驳回意见移除，详见 docs/REVIEW-AI-REMOVAL.md 与 parked-features/README.md。
  async generatePlan() {
    if (this.data.planLoading) return;
    const profile = app.globalData.profile;
    if (!profile) {
      wx.showToast({ title: '请先完成身体建档', icon: 'none' });
      return;
    }
    this.setData({ planLoading: true });
    wx.showLoading({ title: '正在编排…', mask: true });
    try {
      const res = await planService.createPlanLocal(profile);
      await this.loadPlan();
      this.renderToday();
      wx.hideLoading();
      // planId 可能叫 planId 也可能直接是 _id，两个都兜住；都没有就进计划页自动查生效计划
      const pid = res && (res.planId || res._id);
      wx.navigateTo({ url: pid ? `/packageA/plan/plan?id=${pid}` : '/packageA/plan/plan' });
    } catch (err) {
      wx.hideLoading();
      console.error('计划生成失败：', err);
      wx.showToast({ title: err.message || '生成失败，请重试', icon: 'none' });
    } finally {
      this.setData({ planLoading: false });
    }
  },

  goPlanDetail() {
    wx.navigateTo({ url: '/packageA/plan/plan' });
  },

  // 开始跟练：进「今天该练的那一节」
  // 修复：以前写死 week=0&day=1，练到第 3 周还是永远进第 1 周第 1 天
  goWorkout() {
    const plan = this.data.plan;
    const today = this.data.today;
    if (!plan || !plan._id) {
      wx.showToast({ title: '还没有可用计划', icon: 'none' });
      return;
    }
    if (!today || today.ready === false) {
      wx.showToast({ title: (today && today.reason) || '这一节还没有动作', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/packageA/workout/workout?planId=${plan._id}&week=${today.weekIndex}&day=${today.dayIndex}`
    });
  },

  goOnboarding() {
    wx.navigateTo({ url: '/packageA/onboarding/onboarding' });
  },

  // V0.5 数据看板
  goStats() {
    wx.navigateTo({ url: '/packageA/stats/stats' });
  },

  // V0.6 动作库
  goLibrary() {
    // 分包首次下载需 1~2s，加 loading 兜底；动作库 onReady 里关闭
    wx.showLoading({ title: '加载中…', mask: true });
    wx.navigateTo({ url: '/packageA/library/library' });
  },

  // V0.6 身体记录
  goBody() {
    wx.navigateTo({ url: '/packageA/body/body' });
  },

  // V1.1 成就徽章
  goBadges() {
    wx.navigateTo({ url: '/packageA/badges/badges' });
  },

  // ---------- 分享 ----------
  // 卡片文案由 utils/share.js 统一生成（纯函数、可离线单测），文案都不带 imageUrl，
  // 由微信自动截取页面顶部 —— 主包已经 174.7KB，能不加图片就不加。
  onShareAppMessage() {
    const t = this.data.today;
    return share.buildHomeCard({
      hasPlan: !!(t && t.ready),
      focus: t && t.focus,
      dayNumber: t && t.dayNumber,
      streak: this.data.streak,
      todayChecked: this.data.todayChecked
    });
  },

  onShareTimeline() {
    const t = this.data.today;
    return share.buildTimeline({
      title: (this.data.todayChecked && this.data.streak > 0)
        ? `我已连续打卡 ${this.data.streak} 天，一起来练`
        : (t && t.ready ? `今天练${t.focus}` : ''),
      tag: 'home'
    });
  }
});
