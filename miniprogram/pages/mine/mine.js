// pages/mine/mine.js — 我的页面（V1.1：头像昵称 / 单位设置 / 数据清理）
const app = getApp();
const favorites = require('../../services/favorites.js');
const userinfo = require('../../services/userinfo.js');
const units = require('../../services/units.js');
const dataService = require('../../services/data.js');
const reminder = require('../../services/reminder.js');
const rest = require('../../services/rest.js');
const legal = require('../../services/legal.js');
const badges = require('../../services/badges.js');
const share = require('../../utils/share.js');

// 开发环境（开发者工具 / 体验版）拿不到版本号，用一个兜底值，避免「当前版本」空着
const FALLBACK_VERSION = 'v1.1.0';

function readAppVersion() {
  try {
    if (typeof wx.getAccountInfoSync !== 'function') return FALLBACK_VERSION;
    const info = wx.getAccountInfoSync();
    return (info && info.miniProgram && info.miniProgram.version) || FALLBACK_VERSION;
  } catch (e) {
    return FALLBACK_VERSION;
  }
}

Page({
  data: {
    hasProfile: false,
    profile: null,
    favCount: 0,
    badgeCount: 0,     // 已解锁徽章数（读本地记录，不额外打云请求）
    badgeTotal: badges.TOTAL,
    unit: 'kg',
    weightText: '—',   // 档案体重（按当前单位换算后的展示值）
    reminderText: '未开启', // 训练提醒状态（读本地缓存，不额外打云请求）
    restText: '60 秒',      // 组间休息时长（本地偏好）
    avatar: '',        // 本地头像路径（空则用 emoji 占位）
    displayName: '',   // 本地昵称 > 云档案昵称 > 默认
    legalStatus: '未同意', // 协议同意状态
    legalWarn: true,   // 未同意 / 协议已更新 → 入口高亮
    appVersion: FALLBACK_VERSION,
    statusBarHeight: 24, // 自定义导航：给用户卡顶部让出状态栏
    showEdit: false,
    editAvatar: '',
    editNickname: '',
    savingProfile: false,
    clearing: false
  },

  onLoad() {
    // 事件回调要保存引用，否则 off 时对不上（bind 每次都是新函数）
    this._onProfileLoaded = this.refresh.bind(this);
    try {
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarHeight: win.statusBarHeight || 24 });
    } catch (e) { /* 用默认值兜底 */ }
  },

  onShow() {
    this.refresh();
    // 登录慢于页面加载时，监听一次性刷新
    if (!app.globalData.openid) app.on('profileLoaded', this._onProfileLoaded);
  },

  onUnload() {
    app.off('profileLoaded', this._onProfileLoaded);
  },

  // 统一的页面状态刷新（从动作库/身体记录回来也会走这里）
  refresh() {
    const profile = app.globalData.profile;
    const unit = units.get();
    this.setData({
      hasProfile: !!profile,
      profile: profile || null,
      favCount: favorites.count(),
      badgeCount: badges.unlockedCount(),
      unit,
      // 档案里存的是 kg，展示跟着单位设置走
      weightText: (profile && profile.weightKg) ? String(units.toDisplay(profile.weightKg, unit)) : '—',
      reminderText: reminder.statusText(reminder.getCache()),
      restText: rest.label(rest.getDefault()),
      legalStatus: legal.statusText(),
      legalWarn: legal.needsReaccept(),
      appVersion: readAppVersion(),
      avatar: userinfo.getAvatar(),
      displayName: userinfo.displayName(profile)
    });
  },

  // 用户协议 / 隐私政策（数据来源：data-type）
  goLegal(e) {
    const type = (e.currentTarget.dataset && e.currentTarget.dataset.type) || 'agreement';
    wx.navigateTo({ url: `/packageA/legal/legal?type=${type}` });
  },

  // ---------- 头像 + 昵称 ----------
  openEdit() {
    this.setData({
      showEdit: true,
      editAvatar: this.data.avatar,
      editNickname: userinfo.getNickname() || (this.data.profile && this.data.profile.nickname) || ''
    });
  },

  closeEdit() {
    if (this.data.savingProfile) return;
    this.setData({ showEdit: false });
  },

  // <button open-type="chooseAvatar"> 回调：拿到的是临时文件，保存时才落盘
  onChooseAvatar(e) {
    const temp = e && e.detail && e.detail.avatarUrl;
    if (temp) this.setData({ editAvatar: temp });
  },

  // <input type="nickname"> 的推荐昵称走 bindchange
  onNicknameInput(e) {
    this.setData({ editNickname: e.detail.value });
  },

  async saveProfileInfo() {
    if (this.data.savingProfile) return;
    this.setData({ savingProfile: true });
    wx.showLoading({ title: '保存中…', mask: true });
    try {
      let avatar = this.data.avatar;
      if (this.data.editAvatar && this.data.editAvatar !== this.data.avatar) {
        avatar = await userinfo.saveAvatar(this.data.editAvatar); // 临时文件 → 本地用户目录
      }
      await userinfo.setNickname(this.data.editNickname);
      await userinfo.syncNicknameToCloud(this.data.editNickname); // 有档案时同步云端，失败不阻塞
      wx.hideLoading();
      this.setData({
        avatar,
        displayName: userinfo.displayName(app.globalData.profile),
        showEdit: false,
        savingProfile: false
      });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      this.setData({ savingProfile: false });
      console.error('保存头像昵称失败：', err);
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    }
  },

  // 恢复默认头像（emoji 占位）
  onResetAvatar() {
    this.setData({ editAvatar: '' });
  },

  // ---------- 单位设置 ----------
  onUnitTap(e) {
    const unit = e.currentTarget.dataset.unit;
    if (!unit || unit === this.data.unit) return;
    units.set(unit);
    const profile = app.globalData.profile;
    this.setData({
      unit,
      weightText: (profile && profile.weightKg) ? String(units.toDisplay(profile.weightKg, unit)) : '—'
    });
    wx.showToast({ title: `重量单位：${unit}`, icon: 'none' });
  },

  // ---------- 组间休息时长 ----------
  // 用原生 ActionSheet 而不是 picker：这个值只在这里改，不值得为它加一个 picker 容器
  // （menu-item:last-child 的边框规则会因为多一层包裹而失效）。
  onRestTap() {
    wx.showActionSheet({
      itemList: rest.presetLabels(),
      success: (res) => {
        const sec = rest.PRESETS[res.tapIndex];
        if (sec === undefined) return;
        const saved = rest.setDefault(sec);
        this.setData({ restText: rest.label(saved) });
        wx.showToast({
          title: saved > 0 ? `组间休息 ${saved} 秒` : '已关闭自动休息',
          icon: 'none'
        });
      },
      fail: () => {} // 用户取消，不提示
    });
  },

  // ---------- 清空训练数据 ----------
  onClearData() {
    if (this.data.clearing) return;
    const self = this;
    wx.showModal({
      title: '清空训练数据？',
      content: '将删除云端的训练打卡、身体记录和训练计划，并重置成就徽章。\n档案、收藏和设置会保留。\n\n此操作不可恢复。',
      confirmText: '继续',
      confirmColor: '#ef4444',
      success(res) {
        if (!res.confirm) return;
        // 不可逆操作：再确认一次
        wx.showModal({
          title: '再次确认',
          content: '真的要清空吗？清空后无法找回。',
          confirmText: '确认清空',
          confirmColor: '#ef4444',
          success(res2) {
            if (res2.confirm) self.doClear();
          }
        });
      }
    });
  },

  async doClear() {
    this.setData({ clearing: true });
    wx.showLoading({ title: '清空中…', mask: true });
    try {
      const res = await dataService.clearTrainingData({
        onProgress: (n, label) => wx.showLoading({ title: `清空${label} ${n} 条`, mask: true })
      });
      wx.hideLoading();
      // 徽章由训练数据推导，数据清空后必须一起重置，
      // 否则会出现「看板全空但已解锁 13 枚」的矛盾状态
      badges.reset();
      this.setData({ clearing: false });
      const capped = res.capped && res.capped.length
        ? `\n\n⚠️ ${res.capped.join('、')} 超过单次上限（500 条），再点一次可继续清空`
        : '';
      wx.showModal({
        title: '已清空',
        content: `共删除 ${res.total} 条记录${res.summary ? `\n${res.summary}` : ''}${capped}`,
        showCancel: false
      });
      this.refresh();
    } catch (err) {
      wx.hideLoading();
      this.setData({ clearing: false });
      wx.showModal({
        title: '清空失败',
        content: String((err && (err.errMsg || err.message)) || err).slice(0, 300),
        showCancel: false
      });
    }
  },

  // ---------- 跳转 ----------
  goOnboarding() {
    wx.navigateTo({ url: '/packageA/onboarding/onboarding' });
  },

  // V0.5 数据看板
  goStats() {
    wx.navigateTo({ url: '/packageA/stats/stats' });
  },

  // V1.1 成就徽章
  goBadges() {
    wx.navigateTo({ url: '/packageA/badges/badges' });
  },

  // V0.6 动作库
  goLibrary() {
    // 分包首次下载需 1~2s，加 loading 兜底；动作库 onReady 里关闭
    wx.showLoading({ title: '加载中…', mask: true });
    wx.navigateTo({ url: '/packageA/library/library' });
  },

  // V1.1 我的收藏（直接进动作库的收藏筛选）
  goFavorites() {
    wx.showLoading({ title: '加载中…', mask: true });
    wx.navigateTo({ url: '/packageA/library/library?fav=1' });
  },

  // V0.6 身体记录
  goBody() {
    wx.navigateTo({ url: '/packageA/body/body' });
  },

  // V1.1 训练提醒（订阅消息）
  goReminder() {
    wx.navigateTo({ url: '/packageA/reminder/reminder' });
  },

  showTodo() {
    wx.showToast({ title: '该功能后续版本上线', icon: 'none' });
  },

  noop() {},

  // ---------- 分享 ----------
  // 「我的」是 tabBar 页：不定义 onShareAppMessage 的话右上角「转发」是灰的，
  // 用户想分享会发现没入口。本页正好展示着徽章解锁进度，就拿它当文案。
  onShareAppMessage() {
    return share.buildBadgeCard({
      unlocked: this.data.badgeCount,
      total: this.data.badgeTotal
    });
  },

  onShareTimeline() {
    return share.buildTimeline({
      title: this.data.badgeTotal
        ? `我已解锁 ${this.data.badgeCount}/${this.data.badgeTotal} 枚成就徽章`
        : '',
      tag: 'mine'
    });
  }
});
