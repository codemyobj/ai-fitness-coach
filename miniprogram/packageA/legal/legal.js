// packageA/legal/legal.js — 用户协议 / 隐私政策
// 一个页面承载两份文档：正文来自 content/legal.js（纯数据，可离线断言完整性），
// 同意状态来自 services/legal.js。页面本身不做任何网络请求，所以不需要骨架屏。
const content = require('../../content/legal.js');
const legal = require('../../services/legal.js');

Page({
  data: {
    type: 'agreement',
    tabs: [],
    doc: null,        // { title, summary, sections }
    dataItems: [],    // 仅隐私政策：收集清单表格
    version: '',
    effective: '',
    updated: '',
    from: '',         // 来源页；'onboarding' 时底部出现同意条
    agreed: false,
    showAgreeBar: false
  },

  onLoad(query) {
    const q = query || {};
    // 非法 type 回退到用户协议，页面永远不会因为参数写错而空着
    const type = content.isType(q.type) ? q.type : 'agreement';
    this._from = typeof q.from === 'string' ? q.from : '';
    this.setData({
      tabs: content.docTabs(),
      from: this._from,
      showAgreeBar: this._from === 'onboarding'
    });
    this.render(type);
  },

  // 从建档流程点进来 → 同意后返回 → 建档页在 onShow 里同步勾选态
  onShow() {
    this.setData({ agreed: legal.isAccepted() });
  },

  render(type) {
    const doc = content.getDoc(type);
    try {
      wx.setNavigationBarTitle({ title: doc.title });
    } catch (e) { /* 标题设置失败不影响内容展示 */ }
    this.setData({
      type,
      doc,
      dataItems: type === 'privacy' ? content.DATA_ITEMS : [],
      version: content.LEGAL_VERSION,
      effective: content.EFFECTIVE_DATE,
      updated: content.UPDATED_DATE,
      agreed: legal.isAccepted()
    });
  },

  // 顶部切换：不跳页，直接换一份文档（少一次分包路由开销，也不会丢阅读位置）
  switchTab(e) {
    const type = e.currentTarget.dataset.type;
    if (!content.isType(type) || type === this.data.type) return;
    this.render(type);
    this.toTop();
  },

  toTop() {
    try {
      if (typeof wx.pageScrollTo === 'function') {
        wx.pageScrollTo({ scrollTop: 0, duration: 200 });
      }
    } catch (e) { /* 部分环境不支持，忽略 */ }
  },

  // 建档流程里的「我已阅读并同意」：写同意记录后回上一页
  onAgree() {
    legal.accept();
    this.setData({ agreed: true });
    wx.showToast({ title: '已同意', icon: 'success' });
    setTimeout(() => {
      try { wx.navigateBack(); } catch (e) { /* 直接进入本页时无上一页 */ }
    }, 500);
  }
});
