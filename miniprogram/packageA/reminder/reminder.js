// packageA/reminder/reminder.js — 训练提醒设置（订阅消息）
//
// 页面职责：开关提醒、选提醒时间、看剩余可提醒次数、测试发送。
// 「剩余次数」是这个页面的核心信息：微信只给一次性订阅，授权 1 次 = 1 条，
// 所以必须让用户随时看得到还剩几条，否则会出现「开了但收不到」的困惑。
const reminder = require('../../services/reminder.js');
const skeleton = require('../../utils/skeleton.js');

// 小时 → picker 下标（不在候选列表里就回落到默认值）
function indexOfHour(h) {
  const i = reminder.HOURS.indexOf(reminder.clampHour(h));
  return i >= 0 ? i : reminder.HOURS.indexOf(reminder.DEFAULT_HOUR);
}

Page({
  data: {
    loading: true,
    skVisible: false,    // 首屏骨架屏显隐
    loaded: false,       // 云端记录是否已读到（读到前不渲染内容，避免闪空数值）
    loadError: '',
    configured: false,   // 模板 ID 是否已配置
    record: null,        // 云端提醒记录
    statusText: '',
    quotaText: '',
    enabled: false,
    needRenew: false,    // 开着但额度用完了
    hour: 19,
    hourText: '19:00',
    hourLabels: [],
    hourIndex: 0,
    working: false,
    tip: ''
  },

  onLoad() {
    this.sk = skeleton.gate(this);
    const hour = reminder.DEFAULT_HOUR;
    this.setData({
      configured: reminder.isConfigured(),
      hourLabels: reminder.hourLabels(),
      hour,
      hourText: reminder.formatHour(hour),
      hourIndex: indexOfHour(hour)
    });
    // 返回 Promise：页面级冒烟测试会等首屏加载落定（真机忽略返回值）
    return this.load();
  },

  onShow() {
    // 首次由 onLoad 负责；之后每次进来（如从微信设置页改完订阅权限回来）都刷新
    if (this._loadedOnce) this.load();
  },

  async load() {
    // 首屏还没读到记录才开骨架屏；改完设置回来时不闪
    if (!this.data.loaded) this.sk.start();
    this.setData({ loading: true });
    try {
      const record = await reminder.load();
      this.apply(record);
      this.setData({ loading: false, loaded: true, loadError: '' });
    } catch (err) {
      console.error('读取提醒设置失败：', err);
      this.setData({ loading: false, loadError: this.fmtErr(err) });
    } finally {
      this._loadedOnce = true;
      this.sk.stop();
    }
  },

  // 用一条云端记录刷新全部展示字段
  apply(record) {
    const hour = reminder.clampHour((record && record.hour) || this.data.hour);
    this.setData({
      record: record || null,
      enabled: !!(record && record.enabled),
      needRenew: reminder.needRenew(record),
      statusText: reminder.statusText(record),
      quotaText: reminder.quotaText(record),
      hour,
      hourText: reminder.formatHour(hour),
      hourIndex: indexOfHour(hour)
    });
  },

  // 主按钮：开启 / 续订（必须在点击回调里直接调 requestSubscribeMessage）
  onPrimary() {
    if (this.data.working) return;
    if (!this.data.configured) {
      wx.showModal({
        title: '提醒模板未配置',
        content: '需要先在「微信公众平台 → 功能 → 订阅消息」选用一个模板，'
          + '把模板 ID 填到 miniprogram/services/reminder.js，'
          + '并配到云函数 sendReminder 的环境变量 REMINDER_TEMPLATE_ID。\n\n详见 docs/REMINDER-SETUP.md',
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }
    this.doEnable();
  },

  async doEnable() {
    this.setData({ working: true, tip: '' });
    wx.showLoading({ title: '请求授权…', mask: true });
    try {
      const res = await reminder.enable(this.data.hour);
      wx.hideLoading();
      if (!res.accepted) {
        const msg = res.tip || '未获得授权';
        this.setData({ working: false, tip: msg });
        wx.showToast({ title: msg, icon: 'none', duration: 2500 });
        return;
      }
      this.apply(res.record);
      this.setData({
        working: false,
        tip: '订阅成功，额度 +1。微信限制一次授权只能发一条，完成训练后顺手续订即可。'
      });
      wx.showToast({ title: '订阅成功 +1 次', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      const msg = this.fmtErr(err);
      this.setData({ working: false, tip: msg });
      wx.showToast({ title: msg, icon: 'none', duration: 2500 });
    }
  },

  doDisable() {
    if (this.data.working) return;
    const self = this;
    wx.showModal({
      title: '关闭训练提醒？',
      content: '关闭后不会再收到提醒；已授权的额度会保留，重新开启即可继续使用。',
      confirmText: '关闭',
      success(res) {
        if (res.confirm) self.runDisable();
      }
    });
  },

  async runDisable() {
    this.setData({ working: true });
    wx.showLoading({ title: '处理中…', mask: true });
    try {
      const record = await reminder.disable();
      wx.hideLoading();
      this.apply(record);
      this.setData({ working: false, tip: '已关闭训练提醒' });
    } catch (err) {
      wx.hideLoading();
      this.setData({ working: false });
      wx.showToast({ title: this.fmtErr(err), icon: 'none' });
    }
  },

  onHourChange(e) {
    const idx = Number(e.detail.value);
    const hour = reminder.HOURS[idx];
    if (hour === undefined) return;
    this.setData({ hour, hourText: reminder.formatHour(hour), hourIndex: idx });

    // 还没开启：只改本地，等点「开启」时一起写库
    if (!this.data.enabled) {
      this.setData({ tip: '开启提醒后，会在这个时间收到通知' });
      return;
    }
    const self = this;
    reminder.setHour(hour).then((record) => {
      self.apply(record);
      wx.showToast({ title: `提醒时间 ${reminder.formatHour(hour)}`, icon: 'none' });
    }).catch((err) => {
      self.setData({ tip: self.fmtErr(err) });
    });
  },

  // 测试发送：验证「模板 ID + 字段映射 + 云函数」整条链路
  async onTestSend() {
    if (this.data.working) return;
    this.setData({ working: true, tip: '' });
    wx.showLoading({ title: '发送中…', mask: true });
    try {
      const res = await reminder.testSend();
      wx.hideLoading();
      this.setData({ working: false, tip: res.message || '测试提醒已发送' });
      this.load();
    } catch (err) {
      wx.hideLoading();
      const msg = this.fmtErr(err);
      this.setData({ working: false, tip: msg });
      wx.showModal({ title: '测试提醒未发送', content: msg, showCancel: false });
    }
  },

  retry() {
    this.setData({ loadError: '' }); // 清掉错误卡交给骨架屏接管
    this.load();
  },

  fmtErr(err) {
    if (!err) return '未知错误';
    if (typeof err === 'string') return err;
    return err.message || err.errMsg || JSON.stringify(err);
  }
});
