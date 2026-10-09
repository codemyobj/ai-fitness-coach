// utils/auth.js — 登录态管理
// 说明：云开发方案下 wx.login 的 code 由云函数自动解析，
// 无需前端保管 session_key，登录态 = openid（存于 app.globalData）

const app = getApp();

// 确保 openid 就绪（页面异步场景使用）
function ensureOpenid() {
  if (app.globalData.openid) return Promise.resolve(app.globalData.openid);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('登录超时')), 10000);
    app.on('profileLoaded', () => {
      clearTimeout(timer);
      resolve(app.globalData.openid);
    });
    // 兜底轮询
    const poll = setInterval(() => {
      if (app.globalData.openid) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve(app.globalData.openid);
      }
    }, 300);
  });
}

module.exports = { ensureOpenid };
