// cloudfunctions/initDb/index.js — 数据库初始化（幂等，可重复调用）
// 作用：创建项目需要的全部集合。云开发的特性是「集合不存在时查询会报错」
//（错误码 -502005 database collection not exists），所以首次使用前必须先建集合。
//
// 调用方式（开发者工具 → 云开发控制台 → 云函数 → initDb → 测试）：
//   入参留空 {} 即可，返回每个集合的创建结果。
//
// 说明：云函数使用管理员权限，不受集合权限规则限制，因此能创建集合；
//      集合的「仅创建者可读写」权限仍需在控制台手动设置（API 不支持改权限）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 项目全部集合
const COLLECTIONS = [
  'users',          // 用户（登录时写入）
  'profiles',       // 身体档案
  'plans',          // 训练计划
  'workout_logs',   // 训练打卡
  // 'chat_messages' 已随 AI 对话功能下线（见 docs/REVIEW-AI-REMOVAL.md），不再初始化
  'body_records',   // 身体记录（体重/体脂）
  'reminders'       // 训练提醒（订阅消息额度/时间）
];

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const results = [];

  // 兼容性检查：部分 wx-server-sdk 版本没有 db.createCollection
  if (typeof db.createCollection !== 'function') {
    return {
      code: 2,
      message: '当前 wx-server-sdk 不支持程序化建集合，请在云开发控制台 → 数据库 → 手动新建以下集合：'
        + COLLECTIONS.join('、'),
      results: COLLECTIONS.map((name) => ({ name, status: 'manual', message: '需手动创建' }))
    };
  }

  for (const name of COLLECTIONS) {
    try {
      // createCollection 幂等：已存在会抛错，捕获后标记为已存在
      await db.createCollection(name);
      results.push({ name, status: 'created' });
      console.log(`[initDb] 创建集合: ${name}`);
    } catch (err) {
      const msg = (err && (err.errMsg || err.message)) || String(err);
      // -501001 / ResourceExists / 已存在 都视为 OK
      const exists = /exist|已存在|-501001/i.test(msg);
      results.push({ name, status: exists ? 'exists' : 'error', message: exists ? '' : msg });
      if (!exists) console.error(`[initDb] 创建失败 ${name}:`, msg);
    }
  }

  // 顺带写一条自检记录，确认写权限正常（写入 init_logs 可选集合）
  try {
    await db.collection('init_logs').add({
      data: { openid: OPENID, at: db.serverDate(), action: 'initDb' }
    });
  } catch (e) { /* init_logs 不存在也无所谓，不影响主流程 */ }

  const failed = results.filter((r) => r.status === 'error');
  return {
    code: failed.length ? 1 : 0,
    message: failed.length
      ? `有 ${failed.length} 个集合创建失败，详见 results`
      : '全部集合已就绪',
    results
  };
};
