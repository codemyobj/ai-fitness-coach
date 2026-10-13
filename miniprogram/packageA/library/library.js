// packageA/library/library.js — 动作库（V1.1）
// 分类筛选 + 器械筛选 + 关键词搜索 + 收藏筛选 + 动作详情弹层（要点/常见错误/替代动作）
const library = require('../../services/library.js');
const favorites = require('../../services/favorites.js');
const share = require('../../utils/share.js');

Page({
  data: {
    keyword: '',
    categories: [],
    activeCategory: '全部',
    equipments: [],
    activeEquipment: '全部',
    list: [],
    total: 0,
    empty: false,
    favOnly: false,     // 只看收藏
    favCount: 0,
    showDetail: false,
    detail: null
  },

  onLoad(options) {
    // 从「我的 → 我的收藏」进来时直接进入收藏筛选：/packageA/library/library?fav=1
    const favOnly = !!(options && options.fav === '1');
    this.setData({
      categories: library.getCategories(),
      equipments: library.getEquipments(),
      favOnly
    });
    this.applyFilter();
    // 分享卡落地：?id=xxx 直接摊开这个动作的详情。
    // 分享出去的就是那个动作，落地还要用户在 601 个动作里自己找就白分享了。
    if (options && options.id) this.openDetail(options.id);
  },

  // 入口页（我的/训练）在跳转前 showLoading 兜底分包下载，页面就绪后关闭。
  // 若分包已预载则 loading 一闪而过；未跳转入口直接打开时 hideLoading 为无害空操作。
  onReady() {
    wx.hideLoading();
  },

  onPullDownRefresh() {
    this.applyFilter();
    wx.stopPullDownRefresh();
  },

  // 收藏状态在 onShow 也刷新一次：详情页/其他入口改过收藏时列表不脏
  onShow() {
    if (this.data.list.length) this.applyFilter();
  },

  applyFilter() {
    const favIds = favorites.list();
    const favMap = {};
    favIds.forEach((id) => { favMap[id] = true; });

    // 只用动作库的公开接口（listExercises）取数据，收藏顺序在页面里排
    let list = library.listExercises({
      keyword: this.data.keyword,
      category: this.data.activeCategory,
      equipment: this.data.activeEquipment
    });

    if (this.data.favOnly) {
      const order = {};
      favIds.forEach((id, i) => { order[id] = i; }); // 最近收藏的在前
      list = list
        .filter((ex) => favMap[ex.id])
        .sort((a, b) => order[a.id] - order[b.id]);
    }

    list = list.map((ex) => Object.assign({}, ex, { fav: !!favMap[ex.id] }));

    this.setData({
      list,
      total: list.length,
      empty: list.length === 0,
      favCount: favIds.length
    });
  },

  // 只看收藏开关
  onToggleFavOnly() {
    this.setData({ favOnly: !this.data.favOnly });
    this.applyFilter();
  },

  // 显示全部（收藏筛选下的空态/退出用）
  onShowAll() {
    this.setData({ favOnly: false, keyword: '', activeCategory: '全部', activeEquipment: '全部' });
    this.applyFilter();
  },

  // 切换收藏：卡片上的 ♡ 用 catchtap，避免同时打开详情
  onToggleFav(e) {
    const id = e.currentTarget.dataset.id;
    const rawIndex = e.currentTarget.dataset.index;
    const res = favorites.toggle(id);
    wx.showToast({
      title: res.favorited ? '已收藏' : '已取消收藏',
      icon: 'none',
      duration: 1200
    });

    // 收藏列表里取消收藏 → 该卡片直接消失
    const idx = (rawIndex === undefined || rawIndex === '')
      ? this.data.list.findIndex((x) => x.id === id) // 详情弹层里点的，自己找下标
      : Number(rawIndex);

    if (this.data.favOnly || idx < 0 || idx >= this.data.list.length) {
      this.applyFilter();
    } else {
      this.setData({
        [`list[${idx}].fav`]: res.favorited,
        favCount: res.count
      });
    }

    // 详情弹层打开着的话同步按钮状态
    if (this.data.showDetail && this.data.detail && this.data.detail.id === id) {
      this.setData({ 'detail.fav': res.favorited });
    }
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value || '' });
    this.applyFilter();
  },

  onClearKeyword() {
    this.setData({ keyword: '' });
    this.applyFilter();
  },

  onCategoryTap(e) {
    const value = e.currentTarget.dataset.value;
    if (value === this.data.activeCategory) return;
    this.setData({ activeCategory: value });
    this.applyFilter();
  },

  onEquipmentTap(e) {
    const value = e.currentTarget.dataset.value;
    if (value === this.data.activeEquipment) return;
    this.setData({ activeEquipment: value });
    this.applyFilter();
  },

  onExerciseTap(e) {
    this.openDetail(e.currentTarget.dataset.id);
  },

  // 打开动作详情（列表点击与分享落地共用一份逻辑）
  openDetail(id) {
    const ex = library.getExerciseById(id);
    if (!ex) {
      wx.showToast({ title: '未找到该动作', icon: 'none' });
      return;
    }
    const detail = Object.assign({}, ex, { fav: favorites.has(id) });
    this.setData({ detail, showDetail: true });
  },

  onCloseDetail() {
    this.setData({ showDetail: false });
  },

  // 阻止弹层内部点击冒泡到遮罩（否则点内容也会关闭）
  noop() {},

  // ---------- 分享 ----------
  // 详情打开着就分享这个动作（唯一「有内容可看」的分享卡，落地页带 id 直开详情）；
  // 否则分享动作库本身。
  onShareAppMessage() {
    const d = this.data.showDetail ? this.data.detail : null;
    if (d && d.id) {
      return share.buildExerciseCard({
        id: d.id,
        name: d.name,
        category: d.category,
        equipment: d.equipment
      });
    }
    return share.buildLibraryCard({ total: this.data.total });
  },

  onShareTimeline() {
    const d = this.data.showDetail ? this.data.detail : null;
    return share.buildTimeline({
      title: d && d.name ? `${d.name}｜动作要领` : `${this.data.total} 个动作的要点与示范`,
      tag: 'library'
    });
  }
});
