// cloudfunctions/login/index.js — 静默登录云函数
// 云函数自带微信身份上下文，无需 wx.login 换 code，直接取 openid
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID, UNIONID, APPID } = cloud.getWXContext();
  console.log(OPENID);
  const users = db.collection('users');

  try {
    // 查是否已建档
    const { total } = await users.where({ openid: OPENID }).count();

    if (total === 0) {
      // 首次登录：创建用户记录
      await users.add({
        data: {
          openid: OPENID,
          unionid: UNIONID || '',
          nickname: '',
          avatarUrl: '',
          status: 'active',
          createdAt: db.serverDate(),
          lastLoginAt: db.serverDate()
        }
      });
    } else {
      // 更新最后登录时间
      await users.where({ openid: OPENID }).update({
        data: { lastLoginAt: db.serverDate() }
      });
    }
  } catch (err) {
    // users 集合不存在时容错：仍返回 openid，前端登录态不阻断
    console.error('users 集合操作失败（请先在云开发控制台创建集合）：', err);
  }

  // marker/env 用于前端诊断：确认线上跑的确实是这份代码、以及调用环境归属
  return {
    marker: 'ai-fitness-login-v2',
    env: process.env.TCB_ENV || 'unknown',
    appid: APPID || 'unknown',
    openid: OPENID || ''
  };
};
