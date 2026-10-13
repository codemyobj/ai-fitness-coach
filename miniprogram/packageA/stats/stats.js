// packageA/stats/stats.js — 数据看板（V1.1）
// 内容：累计概览 / 近 8 周趋势柱状图 / 打卡热力图 / 月打卡日历 / 最近训练记录
const app = getApp();
const stats = require('../../services/stats.js');
const units = require('../../services/units.js');
const skeleton = require('../../utils/skeleton.js');
const share = require('../../utils/share.js');

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const HEAT_WEEKS = 17; // 热力图展示周数（约 4 个月）

Page({
  data: {
    loading: true,
    skVisible: false,        // 首屏骨架屏显隐
    loadError: '',
    overview: null,          // 累计概览
    volumeText: '',          // 总容量（按当前单位格式化）
    unit: 'kg',
    trend: null,             // { weeks, maxCount }
    heat: null,              // { weeks, monthLabels, activeDays, ... }
    heatTip: '',             // 热力图底部提示（点格子后变化）
    heatSel: '',             // 选中的日期，用于高亮
    weekLabels: WEEK_LABELS,
    heatWeekLabels: ['一', '', '三', '', '五', '', '日'],
    cal: null,               // { year, month, weeks, monthCount }
    calLabel: '',
    canNextMonth: false,
    recentLogs: []
  },

  onLoad() {
    this._heatIndex = {}; // date -> cell，避免每次点击遍历
    this.sk = skeleton.gate(this);
    // 返回 Promise：页面级冒烟测试会等首屏加载落定（真机忽略返回值）
    return this.load();
  },

  onPullDownRefresh() {
    stats.invalidateCache(); // 下拉刷新拿最新数据
    this.load(true).then(() => wx.stopPullDownRefresh());
  },

  // 从「我的」改完单位回来，按新单位重算
  onShow() {
    const unit = units.get();
    if (unit !== this.data.unit && !this.data.loading) this.load(true);
  },

  fmtErr(err) {
    if (!err) return '未知错误';
    if (typeof err === 'string') return err;
    return err.message || err.errMsg || JSON.stringify(err);
  },

  retry() {
    // 清掉错误卡交给骨架屏接管；loadError 只在成功时清，避免失败后又把内容顶掉
    this.setData({ loadError: '' });
    this.load();
  },

  // 加载全部看板数据（4 个查询共用同一批原始记录，见 services/stats.js 缓存）
  async load(keepMonth) {
    if (this._loading) return;
    this._loading = true;
    // 首屏还没有内容才开骨架屏；下拉刷新时旧内容留在屏上，不闪
    if (!this.data.overview) this.sk.start();
    this.setData({ loading: true });
    try {
      const now = new Date();
      const year = (keepMonth && this.data.cal) ? this.data.cal.year : now.getFullYear();
      const month = (keepMonth && this.data.cal) ? this.data.cal.month : now.getMonth() + 1;

      const [overview, trend, heat, cal, recentLogsRaw] = await Promise.all([
        stats.getOverview(),
        stats.getWeeklyTrend(8),
        stats.getHeatmap(HEAT_WEEKS),
        stats.getCalendar(year, month),
        stats.getRecentLogs(10)
      ]);

      // 单位换算只做展示层：库里存 kg，这里按偏好转成 kg / lb
      const unit = units.get();
      const recentLogs = recentLogsRaw.map((l) =>
        Object.assign({}, l, { volumeText: units.formatVolume(l.volume, unit) }));

      // 建立日期索引，供点击格子时 O(1) 取值
      const index = {};
      heat.weeks.forEach((col) => col.cells.forEach((c) => { if (c.trained) index[c.date] = c; }));
      this._heatIndex = index;

      this.setData({
        overview,
        trend,
        heat,
        cal,
        recentLogs,
        unit,
        volumeText: units.formatVolume(overview.totalVolume, unit),
        loading: false,
        loadError: '',
        heatSel: '',
        heatTip: `近 ${HEAT_WEEKS} 周训练 ${heat.activeDays} 天 · 累计 ${heat.totalMin} 分钟`,
        calLabel: `${cal.year}年${cal.month}月`,
        canNextMonth: !(cal.year === now.getFullYear() && cal.month === now.getMonth() + 1)
      });
    } catch (err) {
      console.error('看板加载失败：', err);
      this.setData({ loading: false, loadError: this.fmtErr(err) });
    } finally {
      this._loading = false;
      this.sk.stop();
    }
  },

  // 点热力图格子 → 底部提示当天明细（不用弹窗，避免遮挡）
  onTapHeatCell(e) {
    const { date, future, minutes } = e.currentTarget.dataset;
    if (future) return;
    const cell = this._heatIndex[date];
    const label = (() => {
      const [y, m, d] = String(date).split('-');
      return `${Number(m)}月${Number(d)}日`;
    })();
    const tip = cell
      ? `${label} · ${cell.minutes} 分钟 · ${cell.count} 次记录 · ${cell.sets} 组` +
        (cell.volume > 0 ? ` · ${units.formatVolume(cell.volume, this.data.unit)}` : '')
      : `${label} · 未训练`;
    this.setData({ heatTip: tip, heatSel: date });
  },


  // 只切换日历月份（不重载全部数据）
  async gotoMonth(year, month) {
    try {
      const cal = await stats.getCalendar(year, month);
      const now = new Date();
      this.setData({
        cal,
        calLabel: `${cal.year}年${cal.month}月`,
        canNextMonth: !(cal.year === now.getFullYear() && cal.month === now.getMonth() + 1)
      });
    } catch (err) {
      wx.showToast({ title: '日历加载失败', icon: 'none' });
    }
  },

  onPrevMonth() {
    const { year, month } = this.data.cal;
    const d = new Date(year, month - 2, 1); // 上一月
    this.gotoMonth(d.getFullYear(), d.getMonth() + 1);
  },

  onNextMonth() {
    if (!this.data.canNextMonth) return;
    const { year, month } = this.data.cal;
    const d = new Date(year, month, 1); // 下一月
    this.gotoMonth(d.getFullYear(), d.getMonth() + 1);
  },

  // 空态引导：回训练页去生成计划 / 开始跟练
  goTrainingTab() {
    wx.switchTab({ url: '/pages/training/training' });
  },

  // ---------- 分享 ----------
  // 看板对陌生用户是空的，所以落地页给首页；分享文案讲累计与最长连续，
  // 「最长连续」比「当前连续」更适合传播——它只会越来越大，不会因为断卡而归零。
  onShareAppMessage() {
    const o = this.data.overview || {};
    return share.buildStatsCard({
      totalCheckins: o.totalCheckins,
      bestStreak: o.bestStreak
    });
  },

  onShareTimeline() {
    const o = this.data.overview || {};
    return share.buildTimeline({
      title: o.totalCheckins ? `累计打卡 ${o.totalCheckins} 次，最长连续 ${o.bestStreak || 0} 天` : '',
      tag: 'stats'
    });
  }
});
