/**
 * utils/db-error.js — 云数据库错误友好化
 *
 * 云开发的原始错误对用户毫无意义（如 -502005 database collection not exists），
 * 这里统一转换成「能看懂 + 知道怎么修」的提示。
 */

function friendlyError(err) {
  const msg = (err && (err.errMsg || err.message)) || String(err);

  // 集合不存在：最常见，UI 首次使用时集合还没建
  if (/-502005|collection not exists|集合不存在/i.test(msg)) {
    return new Error('数据库集合未创建，请在云开发控制台执行 initDb 云函数初始化');
  }
  // 权限不足：集合权限没设成「仅创建者可读写」
  if (/-502003|permission denied|无权限/i.test(msg)) {
    return new Error('数据库权限不足，请把对应集合权限设为「仅创建者可读写」');
  }
  // 环境未初始化 / 环境 ID 错
  if (/-501000|env.*invalid|环境.*无效|cloud.*not.*init/i.test(msg)) {
    return new Error('云开发环境未就绪，请检查 app.js 里的 ENV_ID 是否正确');
  }
  // 登录态缺失
  if (/openid|not.*login/i.test(msg)) {
    return new Error('登录状态未就绪，请稍后重试');
  }
  // 网络
  if (/network|timeout|超时|fail.*request/i.test(msg)) {
    return new Error('网络异常，请检查网络后重试');
  }
  return err instanceof Error ? err : new Error(msg);
}

module.exports = { friendlyError };
