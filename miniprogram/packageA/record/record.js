// packageA/record/record.js — 单次训练记录详情（V1.0.5）
//
// 为什么要有这一页：看板的「最近训练」原来只是一行只读文字，
// 用户练完两周后回头想不起那天到底做了几组、用了多少重量。
// 数据早就在 workout_logs.exercises 里躺着，缺的只是一个能翻的地方。
//
// 顺带承担渐进超负荷的「依据页」职责：每个动作下面直接写「比上次 +2.5 kg」，
// 跟练页给结论、这里给证据，用户才信这个建议不是拍脑袋。
const units = require('../../services/units.js');
const stats = require('../../services/stats.js');
const progression = require('../../services/progression.js');
const share = require('../../utils/share.js');

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

// '2026-10-13' → '10月13日 周二'
function dateText(dateStr) {
  const parts = String(dateStr || '').split('-');
  if (parts.length < 3) return String(dateStr || '');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  const dt = new Date(y, m - 1, d);
  const w = isNaN(dt.getTime()) ? '' : ` 周${WEEKDAYS[dt.getDay()]}`;
  return `${m}月${d}日${w}`;
}

Page({
  data: {
    loading: true,
    loadError: '',
    notFound: false,
    unit: 'kg',
    meta: null,      // { dateText, focus, durationText, setsText, volumeText, exerciseCount }
    exercises: []    // [{ name, targetText, setsText, sets: [...], compare: { text, tone } }]
  },

  onLoad(options) {
    this.logId = (options && options.id) || '';
    return this.load();
  },

  async load() {
    this.setData({ loading: true, loadError: '', notFound: false });
    try {
      const unit = units.get();
      const log = await stats.getLogById(this.logId);
      if (!log) {
        this.setData({ loading: false, notFound: true });
        return;
      }
      // 第二次调用命中同一份 30s 缓存（getLogById 已读过），不会多一次云查询
      let allLogs = [];
      try {
        allLogs = await stats.listLogs(365);
      } catch (e) {
        console.warn('历史记录读取失败（不显示「比上次」）：', e);
      }
      this.log = log;
      this.setData(Object.assign({ loading: false, unit }, this.buildView(log, allLogs, unit)));
    } catch (err) {
      console.error('记录详情加载失败：', err);
      this.setData({ loading: false, loadError: this.fmtErr(err) });
    }
  },

  fmtErr(err) {
    if (!err) return '未知错误';
    if (typeof err === 'string') return err;
    return err.message || err.errMsg || JSON.stringify(err);
  },

  retry() {
    if (!this.logId) {
      this.setData({ notFound: true });
      return;
    }
    this.load();
  },

  // 把一条日志渲染成页面结构（纯计算，方便单测时也能调用）
  buildView(log, allLogs, unit) {
    const agg = stats.sumSets(log);
    const list = log.exercises || [];

    const exercises = list.map((ex) => {
      const sets = (ex.sets || []).map((s, i) => ({
        index: i + 1,
        done: !!(s && s.done),
        weightText: (s && s.done && Number(s.weightKg) > 0)
          ? units.formatWeight(s.weightKg, unit)
          : '—'
      }));
      const doneSets = sets.filter((s) => s.done).length;

      // 「比上次」：拿这条记录与它之前最近一次同动作记录对比
      const history = progression.historyOf(allLogs, ex.exerciseId);
      const current = progression.summarizeEntry(log, ex.exerciseId);
      const before = history.filter((h) => h.date < log.date);
      const compare = progression.compare(current, before[before.length - 1] || null, unit);

      return {
        exerciseId: ex.exerciseId,
        name: ex.name || ex.exerciseId,
        targetText: `${Number(ex.targetSets) || sets.length} 组 × ${ex.reps || '—'}`,
        setsText: doneSets > 0 ? `${doneSets}/${sets.length} 组` : '未记录',
        sets,
        compare
      };
    });

    return {
      meta: {
        dateText: dateText(log.date),
        focus: log.focus || '训练',
        durationText: Number(log.durationMin) > 0 ? `${Number(log.durationMin)} 分钟` : '—',
        setsText: String(agg.sets),
        volumeText: agg.volume > 0 ? units.formatVolume(agg.volume, unit) : '—',
        exerciseCount: String(list.length)
      },
      exercises
    };
  },

  // 空态：回看板
  goStats() {
    wx.redirectTo({ url: '/packageA/stats/stats' });
  },

  // ---------- 分享 ----------
  // 和看板/徽章一个约定：落地首页（陌生用户点开只有首页对他友好）
  onShareAppMessage() {
    const log = this.log || {};
    return share.buildRecordCard({
      focus: log.focus,
      durationMin: Number(log.durationMin) || 0,
      sets: parseInt((this.data.meta || {}).setsText, 10) || 0
    });
  },

  onShareTimeline() {
    const meta = this.data.meta || {};
    return share.buildTimeline({
      title: meta.dateText ? `${meta.dateText}的记录：${meta.focus} · ${meta.durationText}` : '',
      tag: 'record'
    });
  }
});
