// app.js — 应用入口：云开发初始化 + 静默登录

// ⚠️ 唯一需要你手动修改的地方：填入云开发环境 ID（云开发控制台 → 设置 → 环境 ID）
const ENV_ID = 'cloud1-d9gqfb50v89521c1a';

// 调试开关：运行时错误弹窗 / 页面内调试入口。
// 提审与正式发布必须为 false；联调排查时改回 true。
const DEBUG_SHOW_ERROR = false;

App({
  globalData: {
    openid: null,
    profile: null, // 用户身体档案（建档后写入）
    cloudReady: false, // 云开发是否初始化成功
    lastError: '', // 最近一次运行时错误
    debugMode: DEBUG_SHOW_ERROR // 供页面决定是否显示调试入口
  },

  // 全局错误捕获：页面白屏往往就是这里抛的，弹窗让原因可见
  onError(msg) {
    console.error('[全局错误]', msg);
    this.globalData.lastError = msg;
    this.emit('appError', msg);
    if (DEBUG_SHOW_ERROR) {
      wx.showModal({
        title: '运行出错（调试模式）',
        content: String(msg).slice(0, 500),
        showCancel: false,
        confirmText: '知道了'
      });
    }
  },

  // 跳转到了不存在的页面（多半是路径写错）
  onPageNotFound(res) {
    console.error('[页面不存在]', res);
    this.globalData.lastError = `页面不存在：${res && res.path}`;
    if (DEBUG_SHOW_ERROR) {
      wx.showModal({
        title: '页面不存在',
        content: `${res && res.path}\n${JSON.stringify(res && res.query)}`,
        showCancel: false
      });
    }
  },

  // 未处理的 Promise 异常（onError 捕不到这类，云函数调用失败常从这里冒泡）
  onUnhandledRejection(res) {
    const reason = res && res.reason;
    console.error('[未处理 Promise 异常]', reason);
    this.globalData.lastError = String(reason || '');
    this.emit('appError', String(reason || ''));
    if (DEBUG_SHOW_ERROR) {
      wx.showToast({ title: '操作未完成，请重试', icon: 'none' });
    }
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('基础库版本过低，请升级微信基础库至 2.2.3 以上');
      return;
    }
    if (ENV_ID === 'YOUR_ENV_ID') {
      console.warn('⚠️ 尚未配置云开发环境 ID：请在 miniprogram/app.js 中把 ENV_ID 替换为你的环境 ID');
    }
    wx.cloud.init({
      env: ENV_ID,
      traceUser: true
    });
    this.globalData.cloudReady = true;
    this.silentLogin();
    // 后台预下载动作库分包（2.27.3+，纯后台不阻塞页面切换）；
    // 低版本基础库由 preloadRule（训练页）与入口 loading 兜底
    if (wx.preDownloadSubpackage) {
      wx.preDownloadSubpackage({
        packageRoot: 'packageA',
        success: () => console.log('[分包] packageA 预下载完成'),
        fail: (e) => console.warn('[分包] 预下载失败（不影响使用）:', e && e.errMsg)
      });
    }
  },

  // 静默登录：云函数换取 openid（wx.login 的 code 由云函数自动解析，无需前端换取 session_key）
  async silentLogin() {
    try {
      // 10s 兜底超时：环境 ID 错误 / 云函数未部署时不会永远挂起
      const res = await Promise.race([
        wx.cloud.callFunction({ name: 'login' }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('登录超时：请检查环境 ID 与云函数部署')), 10000)
        )
      ]);
      if (!res || !res.result || !res.result.openid) {
        // 诊断模式：把函数原始返回透出到页面，一眼判断线上代码/环境是否正确
        const raw = res && res.result ? JSON.stringify(res.result) : String(res && res.result);
        const marker = res && res.result && res.result.marker
          ? `（线上代码版本：${res.result.marker}，环境：${res.result.env}）`
          : '（⚠️ 无版本标记 → 线上运行的不是最新代码）';
        throw new Error(`login 返回异常：${String(raw).slice(0, 100)} ${marker}`);
      }
      this.globalData.openid = res.result.openid;
      this.emit('openidReady', res.result.openid);
      await this.loadProfile();
    } catch (err) {
      console.error('静默登录失败：', err);
      // 把失败暴露给页面，避免白屏
      this.emit('loginFailed', err.message || String(err));
    }
  },

  // 加载用户档案，未建档则标记（各页面据此引导去 onboarding）
  async loadProfile() {
    if (!this.globalData.openid) return null;
    try {
      const db = wx.cloud.database();
      const res = await db.collection('profiles')
        .where({ openid: this.globalData.openid })
        .limit(1)
        .get();
      this.globalData.profile = res.data[0] || null;
      this.emit('profileLoaded', this.globalData.profile);
      return this.globalData.profile;
    } catch (err) {
      // profiles 集合不存在等情况：档案按"未建档"处理，但不再让页面卡死
      console.error('加载档案失败（请确认已创建 profiles 集合并配置权限）：', err);
      this.emit('profileLoaded', null);
      return null;
    }
  },

  // ---- 极简事件总线：页面间同步登录/档案状态 ----
  _listeners: {},
  on(event, fn) {
    (this._listeners[event] = this._listeners[event] || []).push(fn);
  },
  off(event, fn) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(f => f !== fn);
  },
  emit(event, payload) {
    (this._listeners[event] || []).forEach(fn => fn(payload));
  }
});
