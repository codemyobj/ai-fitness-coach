// packageA/badges/badges.js — 成就徽章
// 判定与解锁记录都在 services/badges.js（纯逻辑，可离线单测），
// 页面只负责：取指标 → 同步 → 渲染。指标走 stats.getBadgeStats()，
// 与首页/看板共用同一个 30s 缓存，所以这里通常 0 次云查询。
const app = getApp();
const badges = require('../../services/badges.js');
const stats = require('../../services/stats.js');
const favorites = require('../../services/favorites.js');
const skeleton = require('../../utils/skeleton.js');
const share = require('../../utils/share.js');

function fmtDay(ts) {
  const n = Number(ts);
  if (!isFinite(n) || n <= 0) return '';
  const d = new Date(n);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

Page({
  data: {
    unlockedCount: 0,
    total: badges.TOTAL,
    percent: 0,
    groups: [],
    next: null,
    newly: [],
    newlyText: '',
    skVisible: false,
    loadError: ''
  },

  onLoad() {
    this.sk = skeleton.gate(this);
  },

  onShow() {
    // 首屏还没有内容才开骨架屏；从别处返回时旧内容留在屏上，不闪
    if (!this.data.groups.length) this.sk.start();
    // 返回 Promise，页面级冒烟测试会等它落定（真机忽略返回值）
    return this.load();
  },

  async load() {
    if (this._loading) return;
    this._loading = true;
    this.setData({ loadError: '' });
    try {
      const totals = await stats.getBadgeStats();
      const metrics = badges.buildMetrics(totals, {
        hasProfile: !!(app.globalData && app.globalData.profile),
        favCount: favorites.count()
      });
      const res = badges.sync(metrics);
      this.render(res);
      this.setData({ loadError: '' });
    } catch (err) {
      console.error('徽章加载失败：', err);
      this.setData({ loadError: this.fmtErr(err) });
    } finally {
      this._loading = false;
      this.sk.stop();
    }
  },

  render(res) {
    // 解锁时间只在已解锁的徽章上出现（写入后永不删除，所以不会闪现）
    const groups = res.groups.map((g) => ({
      key: g.key,
      title: g.title,
      items: g.items.map((b) => Object.assign({}, b, {
        unlockedText: b.unlocked ? `解锁于 ${fmtDay(b.unlockedAt)}` : ''
      }))
    }));

    const newlyNames = res.list
      .filter((b) => b.isNew)
      .map((b) => b.name);

    this.setData({
      groups,
      unlockedCount: res.unlockedCount,
      total: res.total,
      percent: res.total ? Math.round((res.unlockedCount / res.total) * 100) : 0,
      next: res.next,
      newly: newlyNames,
      newlyText: newlyNames.join('、')
    });
  },

  fmtErr(err) {
    const msg = (err && (err.errMsg || err.message)) || err;
    return `加载失败：${String(msg).slice(0, 100)}`;
  },

  retry() {
    // 清掉错误卡交给骨架屏接管；loadError 只在成功时清，避免失败后又把内容顶掉
    this.setData({ loadError: '' });
    this.load();
  },

  noop() {},

  // ---------- 分享 ----------
  // 徽章墙对新用户是空的，所以落地页统一给首页（utils/share.js 里的约定），
  // 分享文案只讲「我解锁了多少」——这是唯一别人看得懂、也愿意点进来的信息。
  onShareAppMessage() {
    return share.buildBadgeCard({
      unlocked: this.data.unlockedCount,
      total: this.data.total,
      nextName: (this.data.next && this.data.next.name) || ''
    });
  },

  onShareTimeline() {
    return share.buildTimeline({
      title: `我已解锁 ${this.data.unlockedCount}/${this.data.total} 枚成就徽章`,
      tag: 'badges'
    });
  }
});
