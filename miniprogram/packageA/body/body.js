// packageA/body/body.js — 身体记录（V1.1）
// 内容：最新体重概览 / 体重趋势柱状图 / 记录列表（含与上次差值、删除）/ 新增记录弹层
// 单位：展示与输入跟随「我的 → 单位设置」（kg/lb），存储始终是 kg
const body = require('../../services/body.js');
const units = require('../../services/units.js');
const skeleton = require('../../utils/skeleton.js');

Page({
  data: {
    loading: true,
    skVisible: false, // 首屏骨架屏显隐
    loadError: '',
    records: [],
    summary: null,
    trend: null,
    showForm: false,
    saving: false,
    unit: 'kg',
    weightPh: '必填，如 65.5',
    weightHint: '20-300 kg',
    fDate: '',
    fWeight: '',
    fFat: '',
    fNote: '',
    maxDate: '',
    debugMode: false // 仅联调期显示「一键初始化数据库」，正式版隐藏
  },

  onLoad() {
    const app = getApp();
    const unit = units.get();
    this.sk = skeleton.gate(this);
    this.setData(Object.assign({
      fDate: body.todayStr(),
      maxDate: body.todayStr(),
      unit,
      debugMode: !!(app && app.globalData && app.globalData.debugMode)
    }, this.unitHints(unit)));
    // 返回 Promise：页面级冒烟测试会等首屏加载落定（真机忽略返回值）
    return this.load();
  },

  // 输入提示跟着单位走（lb 用户看到的是 lb 的范围）
  unitHints(unit) {
    const b = units.bounds(unit);
    return {
      weightPh: unit === 'lb' ? '必填，如 144.4' : '必填，如 65.5',
      weightHint: `${b.min}-${b.max} ${b.unit}`
    };
  },

  // 从「我的」改完单位回来要立刻按新单位重算
  onShow() {
    const unit = units.get();
    if (unit !== this.data.unit) {
      this.setData(Object.assign({ unit }, this.unitHints(unit)));
      if (!this.data.loading) this.load();
    }
  },
  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  fmtErr(err) {
    if (!err) return '未知错误';
    if (typeof err === 'string') return err;
    return err.message || err.errMsg || JSON.stringify(err);
  },

  retry() {
    // 清掉错误卡交给骨架屏接管
    this.setData({ loadError: '' });
    this.load();
  },

  // 一键修复：直接调 initDb 云函数建集合，把云端真实返回原样弹出来（排查用）
  async repairDb() {
    wx.showLoading({ title: '初始化中…', mask: true });
    try {
      const res = await wx.cloud.callFunction({ name: 'initDb', data: {} });
      wx.hideLoading();
      const r = (res && res.result) || {};
      const lines = (r.results || [])
        .map((x) => `${x.status === 'error' ? '❌' : '✅'} ${x.name} — ${x.status}${x.message ? '（' + x.message + '）' : ''}`)
        .join('\n');
      wx.showModal({
        title: `initDb 返回 code=${r.code}`,
        content: `${r.message || '（无 message）'}\n\n${lines || '（无 results）'}`,
        showCancel: false,
        confirmText: '知道了'
      });
      if (r.code === 0) this.load();
    } catch (err) {
      wx.hideLoading();
      wx.showModal({
        title: 'initDb 调用失败',
        content: String((err && (err.errMsg || err.message)) || err).slice(0, 400)
          + '\n\n请确认：\n1) initDb 已「上传并部署：云端安装依赖」\n2) 部署环境与 app.js 的 ENV_ID 一致',
        showCancel: false
      });
    }
  },

  async load() {
    // 首屏还没有内容才开骨架屏；下拉刷新 / 改单位回来时旧内容留在屏上
    if (!this.data.summary) this.sk.start();
    this.setData({ loading: true });
    const unit = units.get();
    try {
      const records = await body.listRecords(60);
      this.setData({
        records: body.decorateRecords(records, unit),
        summary: body.buildSummary(records, unit),
        trend: body.buildTrend(records, 10, unit),
        unit,
        loading: false,
        loadError: '' // 上次失败过、这次成功了：必须清掉，否则错误卡会把内容顶掉
      });
    } catch (err) {
      console.error('身体记录加载失败：', err);
      this.setData({
        loading: false,
        loadError: this.fmtErr(err)
      });
    } finally {
      this.sk.stop();
    }
  },

  // ---------- 表单 ----------
  onAddTap() {
    this.setData({
      showForm: true,
      fDate: body.todayStr(),
      fWeight: '',
      fFat: '',
      fNote: ''
    });
  },

  onCloseForm() {
    if (this.data.saving) return;
    this.setData({ showForm: false });
  },

  onDateChange(e) {
    this.setData({ fDate: e.detail.value });
  },

  onInputWeight(e) {
    this.setData({ fWeight: e.detail.value });
  },

  onInputFat(e) {
    this.setData({ fFat: e.detail.value });
  },

  onInputNote(e) {
    this.setData({ fNote: e.detail.value });
  },

  async onSave() {
    if (this.data.saving) return;
    let payload;
    try {
      payload = body.validate({
        date: this.data.fDate,
        weightKg: this.data.fWeight,
        bodyFatPct: this.data.fFat,
        note: this.data.fNote
      });
    } catch (e) {
      wx.showToast({ title: e.message || '输入不合法', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中…', mask: true });
    try {
      // 表单里填的是展示单位，saveRecord 内部会换算成 kg 入库
      await body.saveRecord(payload, this.data.unit);
      wx.hideLoading();
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ saving: false, showForm: false });
      await this.load();
    } catch (err) {
      wx.hideLoading();
      this.setData({ saving: false });
      wx.showModal({
        title: '保存失败',
        content: this.fmtErr(err),
        showCancel: false
      });
    }
  },

  onDeleteTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const self = this;
    wx.showModal({
      title: '删除这条记录？',
      content: '删除后不可恢复',
      confirmColor: '#ef4444',
      success(res) {
        if (!res.confirm) return;
        self.doRemove(id);
      }
    });
  },

  async doRemove(id) {
    wx.showLoading({ title: '删除中…', mask: true });
    try {
      await body.removeRecord(id);
      wx.hideLoading();
      wx.showToast({ title: '已删除', icon: 'success' });
      await this.load();
    } catch (err) {
      wx.hideLoading();
      wx.showModal({ title: '删除失败', content: this.fmtErr(err), showCancel: false });
    }
  },

  noop() {}
});
