// packageA/workout/workout.js — 跟练页
// 流程：选定训练日 → 逐动作跟练（set-input 记录组数/重量）→ 完成打卡 → 写入 workout_logs
const app = getApp();
const planService = require('../../services/plan.js');
const workoutService = require('../../services/workout.js');
const statsService = require('../../services/stats.js');
const badges = require('../../services/badges.js');
const favorites = require('../../services/favorites.js');
const units = require('../../services/units.js');
const reminder = require('../../services/reminder.js');
const rest = require('../../services/rest.js');
const skeleton = require('../../utils/skeleton.js');
const share = require('../../utils/share.js');
const EXERCISES = require('../../assets/data/exercises.js');

// 小时 → picker 下标（不在候选列表里就回落到默认值）
function indexOfHour(h) {
  const i = reminder.HOURS.indexOf(reminder.clampHour(h));
  return i >= 0 ? i : reminder.HOURS.indexOf(reminder.DEFAULT_HOUR);
}

Page({
  data: {
    loading: true,
    skVisible: false, // 首屏骨架屏显隐
    plan: null,
    day: null,
    currentWeekIndex: 0,
    exerciseMap: {},
    // 每个动作的完成状态：{ [exerciseId]: { doneCount, total, sets } }
    progress: {},
    allDone: false,
    finishedCount: 0,
    totalCount: 0,
    // 计时器
    elapsedSec: 0,
    elapsedText: '00:00',
    alreadyChecked: false,
    loadError: '',   // 失败原因，直接显示（不再只弹「加载失败」把原因吞掉）
    debugInfo: '',   // 空态时的排查线索
    debugMode: false,
    // 组间休息倒计时（默认时长在「我的 → 组间休息」设置，0 表示关闭自动休息）
    restEnabled: true,
    restActive: false,
    restPaused: false,
    restDone: false,
    restTotal: 60,
    restLeft: 0,
    restText: '01:00',
    restPercent: 100,
    restNext: '',
    // 动作要点弹层
    showTips: false,
    tipEx: null,
    // 打卡结算卡（用自定义弹层而不是 showModal：要把用时/组数/容量/新徽章摊开，
    // 还要放一个 open-type="share" 的按钮 —— 这些 showModal 都做不到）
    showSummary: false,
    summary: null,
    sharePreview: '',   // 结算卡里给用户看「好友会看到什么」，降低分享的心理门槛
    // 打卡后的「订阅明日提醒」引导（微信一次性订阅：授权 1 次只能发 1 条）
    showRemind: false,
    remindHour: 19,
    remindHourText: '19:00',
    remindHourLabels: [],
    remindHourIndex: 0,
    remindWorking: false,
    remindTip: ''
  },

  onLoad(options) {
    this.sk = skeleton.gate(this);
    const restSec = rest.getDefault(); // 0 = 用户关掉了自动休息
    this.setData({
      debugMode: !!(getApp() && getApp().globalData && getApp().globalData.debugMode),
      remindHourLabels: reminder.hourLabels(),
      restEnabled: restSec > 0,
      restTotal: restSec > 0 ? restSec : rest.DEFAULT_SEC
    });
    this.options = options || {};
    const exerciseMap = {};
    EXERCISES.exercises.forEach((e) => { exerciseMap[e.id] = e; });
    this.setData({ exerciseMap });
    // 跟练时用户不会一直摸手机，保持屏幕常亮（离开页面即失效，不全局生效）
    try { wx.setKeepScreenOn({ keepScreenOn: true }); } catch (e) { /* 低版本忽略 */ }
    // 返回 Promise：页面级冒烟测试会等首屏加载落定（真机忽略返回值）
    return this.load(this.options);
  },

  onUnload() {
    this.stopTimer();
    this.stopRestTimer();
    if (this.sk) this.sk.stop();
    try { wx.setKeepScreenOn({ keepScreenOn: false }); } catch (e) { /* 忽略 */ }
  },

  onPullDownRefresh() {
    this.load(this.options).then(() => wx.stopPullDownRefresh());
  },

  // 统一错误文案
  fmtErr(err) {
    if (!err) return '未知错误';
    if (typeof err === 'string') return err;
    return err.message || err.errMsg || (typeof err === 'object' ? JSON.stringify(err) : String(err));
  },

  // 页面内重试
  retry() {
    this.setData({ loadError: '' }); // 清掉错误卡交给骨架屏接管
    this.load(this.options || {});
  },

  async load(options) {
    // 首屏还没有训练内容才开骨架屏；下拉刷新时旧内容留在屏上
    if (!this.data.day) this.sk.start();
    this.setData({ loading: true, loadError: '', debugInfo: '' });
    try {
      let plan = null;
      let note = '';
      // 按 id 读取失败（权限拒绝 / 文档无 _openid）时，降级查当前生效计划
      if (options.planId) {
        try {
          plan = await planService.getPlanById(options.planId);
        } catch (e) {
          note = `按 id 读取失败（${this.fmtErr(e)}），已改用「当前生效计划」重试`;
          plan = await planService.getActivePlan();
        }
      } else {
        plan = await planService.getActivePlan();
      }

      // 空安全：逐层校验，任何一层异常都按"无训练内容"处理而非崩溃
      const weeks = plan && Array.isArray(plan.structure) ? plan.structure : null;
      if (!weeks || !weeks.length) {
        this.setData({
          loading: false,
          debugInfo: [
            plan ? '已读到计划，但 structure 字段异常' : '没有查询到计划记录',
            `planId：${options.planId || '（无，走生效计划查询）'}`,
            `openid：${(app.globalData && app.globalData.openid) ? '已获取' : '❌ 未获取'}`,
            note,
            '→ 若提示 permission denied：检查 plans 集合权限是否为「仅创建者可读写」'
          ].filter(Boolean).join('\n')
        });
        return;
      }

      // 定位到指定周/天（越界时回退到首周首日）
      let weekIndex = Number(options.week) || 0;
      if (weekIndex < 0 || weekIndex >= weeks.length) weekIndex = 0;
      const days = Array.isArray(weeks[weekIndex].days) ? weeks[weekIndex].days : [];
      if (!days.length) {
        this.setData({ loading: false });
        return;
      }
      let dayIndex = Number(options.day) || 1;
      const day = days[dayIndex - 1] || days[0];

      // 初始化进度（同时补齐动作详情字段，避免 WXML 深层取值白屏）
      const progress = {};
      day.exercises.forEach((ex) => {
        const detail = this.data.exerciseMap[ex.exerciseId] || {};
        ex.tips = detail.tips || '';
        ex.mistakes = detail.mistakes || '';
        ex.allowWeight = detail.equipment ? detail.equipment !== '徒手' : false;
        progress[ex.exerciseId] = { doneCount: 0, total: ex.sets || 3, sets: [] };
      });

      // 是否今日已打卡（防重复打卡）
      // 打卡记录查询失败不应该阻断跟练，降级为「未打卡」
      let alreadyChecked = false;
      try {
        const todayLog = await workoutService.getTodayWorkoutLog();
        alreadyChecked = !!(todayLog && todayLog.planId === plan._id && todayLog.dayIndex === day.dayIndex);
      } catch (e) {
        console.warn('打卡记录查询失败（不阻断跟练）：', e);
      }

      this.setData({
        loading: false,
        plan,
        day,
        currentWeekIndex: weekIndex,
        progress,
        totalCount: day.exercises.length,
        alreadyChecked
      });
      this.startTimer();
    } catch (err) {
      console.error('跟练页加载失败：', err);
      // 把原因显示在页面上，而不是只弹个「加载失败」
      this.setData({
        loading: false,
        loadError: this.fmtErr(err)
      });
    } finally {
      // 有多条提前 return 的分支，用 finally 保证骨架屏一定收得掉
      this.sk.stop();
    }
  },

  // ---------- 计时器 ----------
  startTimer() {
    this.stopTimer();
    this._timer = setInterval(() => {
      const sec = this.data.elapsedSec + 1;
      const mm = String(Math.floor(sec / 60)).padStart(2, '0');
      const ss = String(sec % 60).padStart(2, '0');
      this.setData({ elapsedSec: sec, elapsedText: `${mm}:${ss}` });
    }, 1000);
  },

  stopTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  // ---------- 组间休息倒计时 ----------
  // 用「结束时间戳」而不是每秒累减：切后台、锁屏、掉帧回来剩余时间依然准。
  // 今天的最后一个动作做完了就不再休息（没意义）。
  maybeStartRest(exerciseId, doneCount, total) {
    if (!this.data.restEnabled) return;
    const list = (this.data.day && this.data.day.exercises) || [];
    const info = rest.nextLabel(list, exerciseId, doneCount, total);
    if (info.kind === 'end') return;
    this.startRest(this.data.restTotal, info.text);
  },

  startRest(sec, nextText) {
    const total = rest.clampSec(sec, rest.DEFAULT_SEC);
    this.stopRestTimer(); // 顺带清掉上一轮的自动收起定时器
    this._restTotal = total;
    this._restEndTs = Date.now() + total * 1000;
    this._restPausedMs = 0;
    this.setData({
      restActive: true,
      restPaused: false,
      restDone: false,
      restTotal: total,
      restLeft: total,
      restText: rest.fmt(total),
      restPercent: 100,
      restNext: nextText || this.data.restNext
    });
    this._restTimer = setInterval(() => this.tickRest(), 250);
  },

  tickRest() {
    if (!this._restEndTs) return;
    const now = Date.now();
    const left = rest.leftSecFrom(this._restEndTs, now);
    // 只在「秒数变化」时才 setData，避免 250ms 一次的无谓渲染
    if (left !== this.data.restLeft) {
      this.setData({
        restLeft: left,
        restText: rest.fmt(left),
        restPercent: rest.percentLeft(left, this._restTotal)
      });
    }
    if (now >= this._restEndTs) this.finishRest();
  },

  finishRest() {
    this.stopRestTimer();
    this.setData({ restDone: true, restPaused: false, restLeft: 0, restText: '00:00', restPercent: 0 });
    this.buzz(); // 震动提示（开发者工具/部分机型不支持，静默忽略）
    this._restHideTimer = setTimeout(() => this.hideRest(), 6000); // 6 秒后自动收起
  },

  // 双震比单次更容易察觉（用户这时候多半没在看屏幕）
  buzz() {
    const once = () => { try { wx.vibrateShort({ type: 'heavy' }); } catch (e) { /* 忽略 */ } };
    once();
    this._buzzTimer = setTimeout(once, 220); // 存句柄，页面卸载时一并清掉
  },

  // 点倒计时数字：暂停 / 继续
  toggleRest() {
    if (!this.data.restActive) return;
    if (this.data.restDone) {
      this.hideRest();
      return;
    }
    if (this.data.restPaused) {
      this._restEndTs = Date.now() + (this._restPausedMs || this.data.restLeft * 1000);
      this._restPausedMs = 0;
      this.setData({ restPaused: false });
      this._restTimer = setInterval(() => this.tickRest(), 250);
      this.tickRest();
    } else {
      this._restPausedMs = Math.max(0, this._restEndTs - Date.now());
      this.stopRestTimer();
      this.setData({ restPaused: true });
    }
  },

  // ±15 秒：只影响本次休息，不动「我的」里的默认值
  adjustRest(e) {
    if (!this.data.restActive || this.data.restDone) return;
    if (this._restHideTimer) {
      clearTimeout(this._restHideTimer);
      this._restHideTimer = null;
    }
    const delta = Number(e.currentTarget.dataset.delta) || 0;
    const left = this.data.restPaused
      ? Math.ceil((this._restPausedMs || 0) / 1000)
      : rest.leftSecFrom(this._restEndTs, Date.now());
    const next = rest.clampAdjust(left + delta); // 用夹取而不是 clampSec：−15s 减过头要停在 5 秒，不能跳回 60
    const total = Math.max(this.data.restTotal, next); // 加时同时抬高总时长，进度条才不会溢出
    this._restTotal = total;
    if (this.data.restPaused) {
      this._restPausedMs = next * 1000;
    } else {
      this._restEndTs = Date.now() + next * 1000;
    }
    this.setData({
      restTotal: total,
      restLeft: next,
      restText: rest.fmt(next),
      restPercent: rest.percentLeft(next, total)
    });
  },

  hideRest() {
    this.stopRestTimer();
    this._restEndTs = 0;
    this._restPausedMs = 0;
    this.setData({
      restActive: false,
      restPaused: false,
      restDone: false,
      restLeft: 0,
      restPercent: 100,
      restNext: ''
    });
  },

  stopRestTimer() {
    if (this._restTimer) {
      clearInterval(this._restTimer);
      this._restTimer = null;
    }
    if (this._restHideTimer) {
      clearTimeout(this._restHideTimer);
      this._restHideTimer = null;
    }
    if (this._buzzTimer) {
      clearTimeout(this._buzzTimer);
      this._buzzTimer = null;
    }
  },

  // ---------- 动作完成度 ----------
  onSetChange(e) {
    const exerciseId = e.currentTarget.dataset.id;
    const { doneCount, total, sets } = e.detail;
    const prev = this.data.progress[exerciseId] || { doneCount: 0 };
    const progress = { ...this.data.progress };
    progress[exerciseId] = { doneCount, total, sets };
    this.setData({ progress }, () => this.checkAllDone());

    // 新勾选了一组 → 自动开始组间休息（取消勾选不启动，避免手滑就进倒计时）
    if (doneCount > prev.doneCount) this.maybeStartRest(exerciseId, doneCount, total);
  },

  checkAllDone() {
    const { day, progress } = this.data;
    let finished = 0;
    day.exercises.forEach((ex) => {
      const p = progress[ex.exerciseId];
      // 所有组完成即视为该动作完成
      if (p && p.total > 0 && p.doneCount >= p.total) finished++;
    });
    this.setData({
      finishedCount: finished,
      allDone: finished === day.exercises.length
    });
  },

  // ---------- 查看动作要点（自定义弹层，可展示动作示范图） ----------
  onShowTips(e) {
    const id = e.currentTarget.dataset.id;
    // 优先用已装饰到动作上的详情，回退查本地动作库
    const fromDay = this.data.day && this.data.day.exercises.find((x) => x.exerciseId === id);
    const ex = (fromDay && fromDay.tips) ? fromDay : this.data.exerciseMap[id];
    if (!ex || !ex.tips) {
      wx.showToast({ title: '暂无该动作的要点说明', icon: 'none' });
      return;
    }
    this.setData({
      showTips: true,
      tipEx: {
        name: (fromDay && fromDay.name) || ex.name || '动作要点',
        tips: ex.tips,
        mistakes: ex.mistakes || '',
        // 动作示范（packageA/library/images，与动作库共用一份）
        // anim 优先：循环动图能示范完整动作轨迹；demo 为静态兜底
        anim: id ? `/packageA/library/images/${id}.gif` : '',
        demo: id ? `/packageA/library/images/${id}.png` : ''
      }
    });
  },

  onCloseTips() {
    this.setData({ showTips: false });
  },

  // 阻止弹层内点击冒泡到遮罩
  noop() {},

  // ---------- 完成打卡 ----------
  async onFinish() {
    if (this.data.alreadyChecked) {
      wx.showToast({ title: '今天已完成打卡', icon: 'none' });
      return;
    }
    this.hideRest(); // 打卡结束，倒计时没有意义了
    const { day, progress, elapsedSec, plan } = this.data;

    // 组装训练记录
    const exercises = day.exercises.map((ex) => {
      const p = progress[ex.exerciseId] || {};
      return {
        exerciseId: ex.exerciseId,
        name: ex.name,
        targetSets: ex.sets,
        reps: ex.reps,
        sets: p.sets || []
      };
    });

    // 至少要完成一个动作才允许打卡
    const anyDone = Object.values(progress).some((p) => p.doneCount > 0);
    if (!anyDone) {
      wx.showToast({ title: '先完成至少一组训练吧', icon: 'none' });
      return;
    }

    const durationMin = Math.max(1, Math.round(elapsedSec / 60));
    wx.showLoading({ title: '记录中…', mask: true });
    try {
      await workoutService.saveLog({
        planId: plan._id,
        weekIndex: this.data.currentWeekIndex || 0,
        dayIndex: day.dayIndex,
        focus: day.focus,
        exercises,
        durationMin
      });
      wx.hideLoading();
      this.stopTimer();
      // 打卡成功不再用 showModal 一句话打发：刚练完是用户全天动力最强的时刻，
      // 把这次训练摊开给他看（用时/组数/容量/连续天数/新徽章），并就地给出分享落点。
      const summary = await this.buildCheckinSummary({ exercises, durationMin });
      this.setData({
        alreadyChecked: true, // 关键：不置真的话「查看数据」回来还能再点一次打卡
        showSummary: true,
        summary,
        sharePreview: share.buildCheckinCard(summary).title
      });
    } catch (err) {
      wx.hideLoading();
      console.error('打卡失败：', err);
      wx.showToast({ title: '打卡失败，请重试', icon: 'none' });
    }
  },

  // 结算卡数据（只读，不写库）
  // 徽章在**这里**同步，而不是等回到首页：这是全流程唯一的高光时刻，
  // 等切回首页再弹 Toast 情绪已经凉了。首页的 loadBadges 是幂等的
  // （解锁记录已落盘、走高水位判定），所以不会重复提示。
  async buildCheckinSummary({ exercises, durationMin }) {
    // 组数/容量复用看板的聚合口径，避免同一个数字在两个页面对不上
    const agg = statsService.sumSets({ exercises });
    let streak = 0;
    let newBadgeNames = [];
    try {
      // saveLog 已经失效过缓存，这里拿到的是含本次打卡的最新值
      const sum = await statsService.getHomeSummary();
      streak = Number(sum && sum.streak) || 0;
    } catch (e) {
      console.warn('连续天数读取失败（不影响打卡）：', e);
    }
    try {
      // 与上面的 getHomeSummary 共用同一批 365 天记录缓存 → 0 次额外云查询
      const totals = await statsService.getBadgeStats();
      const res = badges.sync(badges.buildMetrics(totals, {
        hasProfile: !!(app.globalData && app.globalData.profile),
        favCount: favorites.count()
      }));
      newBadgeNames = res.list.filter((b) => b.isNew).map((b) => b.name);
    } catch (e) {
      console.warn('徽章同步失败（不影响打卡）：', e);
    }
    return {
      durationMin,
      durationText: this.data.elapsedText, // 计时器刚停，这就是最终值
      setsText: String(agg.sets),
      volumeText: agg.volume > 0 ? units.formatVolume(agg.volume, units.get()) : '',
      streak,
      newBadgeNames,
      badgeText: newBadgeNames.join('、'),
      focus: (this.data.day && this.data.day.focus) || '',
      finishedCount: this.data.finishedCount,
      totalCount: this.data.totalCount
    };
  },

  // 结算卡「完成」→ 接回原有的「订阅明日提醒」引导。
  // 注意别在这里直接 navigateBack：那样提醒引导永远弹不出来。
  closeSummary() {
    this.setData({ showSummary: false });
    this.afterCheckin();
  },

  goStatsFromSummary() {
    this.setData({ showSummary: false });
    wx.navigateTo({ url: '/packageA/stats/stats' });
  },

  // ---------- 分享 ----------
  // 从结算卡的「分享战绩」按钮进来时带 data-share="checkin"（微信会在 res.target.dataset 里回传），
  // 出的是战绩卡；其余入口（右上角 ··· 转发）出「正在练 XX」卡。
  onShareAppMessage(res) {
    const from = (res && res.from === 'button' && res.target && res.target.dataset)
      ? res.target.dataset.share
      : '';
    if (from === 'checkin' && this.data.summary) return share.buildCheckinCard(this.data.summary);
    const day = this.data.day;
    return share.buildWorkoutCard({
      focus: day && day.focus,
      dayNumber: day && day.dayIndex,
      totalCount: this.data.totalCount
    });
  },

  onShareTimeline() {
    const day = this.data.day;
    return share.buildTimeline({
      title: day ? `今天练${day.focus}` : '',
      tag: 'workout'
    });
  },

  // ---------- 打卡后：顺带订阅明日提醒 ----------
  // 为什么放在这里：微信只给「一次性订阅」（授权 1 次 = 只能发 1 条），
  // 刚打完卡是用户动力最强、也最不会反感弹授权的时刻，顺手确认就够下一天用。
  async afterCheckin() {
    if (!reminder.isConfigured()) {
      wx.navigateBack();
      return;
    }
    try {
      const record = await reminder.load();
      // 还有额度就不打扰；已开启且额度没用完 = 明天照样会提醒
      if (record && record.enabled === true && Number(record.quota) > 0) {
        wx.navigateBack();
        return;
      }
      const hour = reminder.clampHour((record && record.hour) || reminder.DEFAULT_HOUR);
      this.setData({
        showRemind: true,
        remindHour: hour,
        remindHourText: reminder.formatHour(hour),
        remindHourIndex: indexOfHour(hour),
        remindWorking: false,
        remindTip: ''
      });
    } catch (err) {
      console.warn('读取提醒设置失败（不影响打卡）：', err);
      wx.navigateBack();
    }
  },

  // 订阅：必须在点击回调里直接调 requestSubscribeMessage（微信要求用户手势）
  async onRemindSubscribe() {
    if (this.data.remindWorking) return;
    this.setData({ remindWorking: true, remindTip: '' });
    try {
      const res = await reminder.enable(this.data.remindHour);
      if (!res.accepted) {
        this.setData({ remindWorking: false, remindTip: res.tip || '未获得授权' });
        return;
      }
      wx.showToast({ title: '已订阅明日提醒', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 700);
    } catch (err) {
      this.setData({
        remindWorking: false,
        remindTip: (err && (err.message || err.errMsg)) || '订阅失败，请重试'
      });
    }
  },

  onRemindSkip() {
    wx.navigateBack();
  },

  onRemindHourChange(e) {
    const idx = Number(e.detail.value);
    const hour = reminder.HOURS[idx];
    if (hour === undefined) return;
    // 只改本地展示，真正落库在订阅成功时一起写
    this.setData({
      remindHour: hour,
      remindHourIndex: idx,
      remindHourText: reminder.formatHour(hour)
    });
  }
});
