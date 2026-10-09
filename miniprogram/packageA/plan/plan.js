// packageA/plan/plan.js — 训练计划详情页
// 设计原则：任何一步失败都要「把原因显示在页面上」，绝不白屏
const app = getApp();
const planService = require('../../services/plan.js');
const skeleton = require('../../utils/skeleton.js');

// 动作库：用于展示要点（加载失败只影响提示文案，不影响整页）
let EXERCISE_LIST = [];
try {
  EXERCISE_LIST = require('../../assets/data/exercises.js').exercises || [];
} catch (e) {
  console.error('动作库加载失败：', e);
  EXERCISE_LIST = [];
}

Page({
  data: {
    loading: true,
    skVisible: false, // 首屏骨架屏显隐
    plan: null,
    currentWeekIndex: 0,
    currentWeek: null,
    totalDays: 0,
    exerciseMap: {},
    loadError: '',   // 失败原因，直接显示给用户/开发者
    debugInfo: '',   // 空态时的排查线索
    debugMode: false,
    regenerating: false, // 「换一份计划」进行中（防重复点击）
    collapsedDays: {} // 折叠状态：key = `w{周}d{日}`，true = 已收起
  },

  onLoad(options) {
    this.sk = skeleton.gate(this);
    this.setData({ debugMode: !!(getApp() && getApp().globalData && getApp().globalData.debugMode) });
    this.options = options || {};

    // 构建 id → 动作详情映射（只用于补充 tips）
    const exerciseMap = {};
    EXERCISE_LIST.forEach((e) => { exerciseMap[e.id] = e; });
    this._exerciseMap = exerciseMap;
    this.setData({ exerciseMap });

    // 登录是异步的：openid 还没好就先等事件，避免空查导致「看起来白屏」
    this._onOpenidReady = () => { this.reload(); };
    if (app.on) app.on('openidReady', this._onOpenidReady);

    // 返回 Promise：页面级冒烟测试会等首屏加载落定（真机忽略返回值）
    return this.reload();
  },

  onUnload() {
    if (app.off && this._onOpenidReady) app.off('openidReady', this._onOpenidReady);
    if (this.sk) this.sk.stop();
  },

  onPullDownRefresh() {
    this.reload().then(() => wx.stopPullDownRefresh());
  },

  // 重新加载：骨架屏闸门在这里驱动，实际读取逻辑在 _reload
  async reload() {
    // 首屏还没有计划才开骨架屏；下拉刷新 / 切周时旧内容留在屏上，不闪
    if (!this.data.plan) this.sk.start();
    try {
      await this._reload();
    } finally {
      this.sk.stop();
    }
  },

  // 读取 + 渲染计划，任何一路失败都把原因写进 loadError（绝不白屏）
  async _reload() {
    this.setData({ loading: true, loadError: '', debugInfo: '' });

    const openid = (app.globalData && app.globalData.openid) || '';
    const mode = this.options.id ? `按 id 读取（${this.options.id}）` : '读取当前生效计划';

    let raw = null;
    let note = '';
    try {
      if (this.options.id) {
        try {
          raw = await planService.getPlanById(this.options.id);
        } catch (e) {
          // 常见于集合权限为「仅管理端可读写」：doc(id).get() 在客户端会被拒绝
          note = `按 id 读取失败（${(e && (e.message || e.errMsg)) || e}），已改用「当前生效计划」重试`;
          try {
            raw = await planService.getActivePlan();
          } catch (e2) {
            throw new Error(`${note}；重试也失败：${(e2 && (e2.message || e2.errMsg)) || e2}`);
          }
        }
      } else {
        raw = await planService.getActivePlan();
      }
    } catch (err) {
      console.error('计划加载失败：', err);
      this.setData({
        loading: false,
        plan: null,
        loadError: this.fmtErr(err)
      });
      return;
    }

    // 有数据但结构不对 → 也要说清楚，不能静默变空态
    if (raw && (!Array.isArray(raw.structure) || !raw.structure.length)) {
      this.setData({
        loading: false,
        plan: null,
        loadError: '',
        debugInfo: [
          `已读到记录，但 structure 字段异常`,
          `字段：${Object.keys(raw).join(', ')}`,
          `structure：${typeof raw.structure} / ${Array.isArray(raw.structure) ? raw.structure.length : '-'}`,
          `→ 大概率是云函数写入的是旧版/模板数据，不是计划对象`,
          `mode：${mode}`
        ].join('\n')
      });
      return;
    }

    if (!raw) {
      this.setData({
        loading: false,
        plan: null,
        loadError: '',
        debugInfo: [
          `没有查询到计划记录`,
          `openid：${openid ? '已获取（' + openid.slice(0, 8) + '…）' : '❌ 还没有（登录未完成）'}`,
          `查询方式：${mode}`,
          note ? `备注：${note}` : '',
          `→ 若 openid 为空：等登录完成后会自动重试`,
          `→ 若 openid 正常仍为空：检查 plans 集合权限是否为「仅创建者可读写」`
        ].filter(Boolean).join('\n')
      });
      return;
    }

    // 正常渲染
    try {
      const plan = this.decoratePlan(raw);
      const week = (plan.structure && plan.structure[0]) || null;
      this.setData({
        plan,
        loading: false,
        loadError: '',
        debugInfo: '',
        currentWeekIndex: 0,
        currentWeek: week,
        totalDays: week && Array.isArray(week.days) ? week.days.length : 0
      });
      wx.setNavigationBarTitle({ title: plan.planName || '训练计划' });
    } catch (err) {
      console.error('计划渲染失败：', err);
      this.setData({
        loading: false,
        plan: null,
        loadError: `计划数据渲染失败：${this.fmtErr(err)}`
      });
    }
  },

  // 统一错误文案
  fmtErr(err) {
    if (!err) return '未知错误';
    if (typeof err === 'string') return err;
    return err.message || err.errMsg || (typeof err === 'object' ? JSON.stringify(err) : String(err));
  },

  // 给展示数据补齐动作详情（计划里的动作 id 可能不在本地动作库中，避免 WXML 深层取值白屏）
  decoratePlan(plan) {
    const map = this._exerciseMap || {};
    (plan.structure || []).forEach((week) => {
      if (!week) return;
      week.days = Array.isArray(week.days) ? week.days : [];
      week.days.forEach((day) => {
        if (!day) return;
        day.exercises = Array.isArray(day.exercises) ? day.exercises : [];
        day.exercises.forEach((ex) => {
          if (!ex) return;
          const detail = map[ex.exerciseId] || {};
          ex.tips = detail.tips || '';
          ex.mistakes = detail.mistakes || '';
        });
      });
    });
    return plan;
  },

  // 切换周（同步更新 currentWeek，避免 WXML 深层取值）
  onWeekTap(e) {
    const index = Number(e.currentTarget.dataset.index);
    const structure = (this.data.plan && this.data.plan.structure) || [];
    const week = structure[index];
    if (!week) return;
    this.setData({
      currentWeekIndex: index,
      currentWeek: week,
      totalDays: Array.isArray(week.days) ? week.days.length : 0
    });
  },

  // 折叠/展开某个训练日的动作列表（跨周记忆状态）
  toggleDay(e) {
    const { week, day } = e.currentTarget.dataset;
    const key = `w${week}d${day}`;
    this.setData({ [`collapsedDays.${key}`]: !this.data.collapsedDays[key] });
  },

  // 进入跟练页
  goWorkout(e) {
    const { week, day } = e.currentTarget.dataset;
    const plan = this.data.plan;
    if (!plan || !plan._id) {
      wx.showToast({ title: '计划数据不完整', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/packageA/workout/workout?planId=${plan._id}&week=${week}&day=${day}`
    });
  },

  // 页面内重试
  retry() {
    // 清掉错误卡交给骨架屏接管
    this.setData({ loadError: '' });
    this.reload();
  },

  // 换一份计划：按当前档案重新编排
  // 走本地规则编排（services/plan.js#createPlanLocal），不涉及 AI 生成内容
  async regenerate() {
    if (this.data.regenerating) return;
    const profile = app.globalData && app.globalData.profile;
    if (!profile) {
      wx.showToast({ title: '请先完成身体建档', icon: 'none' });
      return;
    }
    this.setData({ regenerating: true });
    wx.showLoading({ title: '正在编排…', mask: true });
    try {
      await planService.createPlanLocal(profile);
      wx.hideLoading();
      // 新计划已生效：清掉「按 id 定位」，改为读取当前生效计划后再刷新
      this.options = {};
      this.setData({ plan: null, currentWeekIndex: 0, currentWeek: null, loadError: '' });
      await this.reload();
      wx.showToast({ title: '已生成新计划', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      console.error('计划重排失败：', err);
      wx.showToast({ title: this.fmtErr(err), icon: 'none' });
    } finally {
      this.setData({ regenerating: false });
    }
  }
});
