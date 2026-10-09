/**
 * test-settings.js — 「我的」页相关服务的单测（V1.1）
 * 覆盖：单位换算（units）/ 昵称清洗（userinfo）/ 数据清理循环（data）
 * 全部离线运行：用一个内存版 wx 替身，不碰真实云环境
 */
const path = require('path');
const MINIPROGRAM = path.resolve(__dirname, 'miniprogram');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`   ✅ ${name}`);
  } else {
    fail++;
    console.log(`   ❌ ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
  }
}
function eq(name, actual, expected) {
  ok(`${name}（期望 ${JSON.stringify(expected)}）`, actual === expected, actual);
}
function section(t) { console.log(`\n${t}`); }

// ---------- 内存版 wx 替身 ----------
const storeMap = {};
const collections = {}; // name -> docs
let missingCollections = [];

function filterDocs(name, cond) {
  const docs = collections[name] || [];
  return docs.filter((d) => d.openid === cond.openid);
}

global.wx = {
  getStorageSync: (k) => (k in storeMap ? storeMap[k] : ''),
  setStorageSync: (k, v) => { storeMap[k] = v; },
  removeStorageSync: (k) => { delete storeMap[k]; },
  cloud: {
    database: () => ({
      collection(name) {
        if (missingCollections.indexOf(name) >= 0) {
          return {
            where: () => ({
              limit: () => ({
                get: async () => { throw { errMsg: 'errCode: -502005 database collection not exists' }; }
              })
            })
          };
        }
        return {
          where: (cond) => ({
            limit: (n) => ({
              get: async () => ({ data: filterDocs(name, cond).slice(0, n) })
            })
          }),
          doc: (id) => ({
            remove: async () => {
              const docs = collections[name] || [];
              const i = docs.findIndex((d) => d._id === id);
              if (i >= 0) docs.splice(i, 1);
              return {};
            }
          })
        };
      }
    })
  }
};
global.getApp = () => ({ globalData: { openid: 'u1' } });

const units = require(path.join(MINIPROGRAM, 'services/units.js'));
const userinfo = require(path.join(MINIPROGRAM, 'services/userinfo.js'));
const data = require(path.join(MINIPROGRAM, 'services/data.js'));

function seed(name, count, openid) {
  collections[name] = [];
  for (let i = 0; i < count; i++) {
    collections[name].push({ _id: `${name}-${i}`, openid: openid || 'u1' });
  }
  return collections[name];
}

(async function run() {
  console.log('==================== 「我的」相关服务单测 ====================');

  // ---------- 1. 单位 ----------
  section('1. 单位换算（units）');
  eq('默认单位是 kg', units.get(), 'kg');
  eq('非法单位回落到 kg', units.set('stone'), 'kg');
  eq('设置 lb 生效', units.set('lb'), 'lb');
  eq('设置已持久化到 storage', wx.getStorageSync(units.KEY), 'lb');
  eq('切回 kg', units.set('kg'), 'kg');

  eq('kg → kg 不变', units.toDisplay(70, 'kg'), 70);
  eq('kg → lb（70kg ≈ 154.3lb）', units.toDisplay(70, 'lb'), 154.3);
  eq('lb → kg（154.3lb ≈ 70kg）', units.toKg(154.3, 'lb'), 70);
  eq('小数保留一位', units.toDisplay(65.55, 'kg'), 65.6);
  eq('kg → lb 四位小数取整一位', units.toDisplay(1, 'lb'), 2.2);
  eq('toDisplay(null) 返回 null', units.toDisplay(null, 'kg'), null);
  eq('toKg("abc") 返回 null', units.toKg('abc', 'kg'), null);
  eq('显示值换算后再换回来误差 < 0.05', Math.abs(units.toKg(units.toDisplay(72.4, 'lb'), 'lb') - 72.4) < 0.05, true);

  eq('kg 输入范围 20-300', JSON.stringify(units.bounds('kg')), JSON.stringify({ min: 20, max: 300, unit: 'kg' }));
  eq('lb 输入范围 44-661（跟着单位走）', JSON.stringify(units.bounds('lb')), JSON.stringify({ min: 44, max: 661, unit: 'lb' }));
  eq('formatWeight kg', units.formatWeight(70, 'kg'), '70 kg');
  eq('formatWeight lb', units.formatWeight(70, 'lb'), '154.3 lb');
  eq('formatVolume 千分位', units.formatVolume(8420, 'kg'), '8,420 kg');
  eq('formatVolume 小数值', units.formatVolume(320, 'kg'), '320 kg');

  // ---------- 2. 昵称 ----------
  section('2. 昵称清洗（userinfo）');
  const norm = userinfo._internal.normalizeNickname;
  eq('去首尾空格', norm('  阿磊  '), '阿磊');
  eq('换行转空格', norm('阿\n磊'), '阿 磊');
  eq('超长截断到 16 字', norm('一二三四五六七八九十一二三四五六七八').length, 16);
  eq('null → 空串', norm(null), '');
  eq('undefined → 空串', norm(undefined), '');
  eq('数字转字符串', norm(123), '123');
  eq('纯空白 → 空串', norm('   '), '');
  eq('setNickname 持久化', (() => { userinfo.setNickname('  小日子 '); return userinfo.getNickname(); })(), '小日子');
  eq('displayName 优先本地昵称', userinfo.displayName({ nickname: '云端名' }, '默认'), '小日子');
  userinfo.clear();
  eq('清空后回落云档案昵称', userinfo.displayName({ nickname: '云端名' }, '默认'), '云端名');
  eq('无档案时用默认值', userinfo.displayName(null), '未命名健身搭子');
  eq('头像默认空串', userinfo.getAvatar(), '');

  // ---------- 3. 数据清理 ----------
  section('3. 数据清理（data，内存云数据库）');
  // chat_messages 已随 AI 对话功能下线，不再进清理清单（见 docs/REVIEW-AI-REMOVAL.md）
  ok('覆盖 3 个集合', data.COLLECTIONS.length === 3, data.COLLECTIONS.map((c) => c.name).join(','));
  ok('集合名包含训练/身体/计划',
    ['workout_logs', 'body_records', 'plans'].every((n) => data.COLLECTIONS.some((c) => c.name === n)));
  ok('不再清理已下线的 chat_messages', !data.COLLECTIONS.some((c) => c.name === 'chat_messages'));

  // 3.1 单集合多轮删除（45 条 > 单批 20 条，要循环 3 轮）
  missingCollections = [];
  seed('workout_logs', 45);
  const one = await data.clearCollection({ name: 'workout_logs', label: '训练打卡' }, { openid: 'u1' });
  eq('45 条全部删除', one.removed, 45);
  eq('结果为删完（未触发上限）', one.capped, false);
  eq('集合已空', (collections.workout_logs || []).length, 0);

  // 3.2 别人家的数据不能被删
  seed('workout_logs', 3, 'u2');
  const other = await data.clearCollection({ name: 'workout_logs', label: '训练打卡' }, { openid: 'u1' });
  eq('只删自己的（他人 3 条保留）', other.removed, 0);
  eq('他人数据仍在', (collections.workout_logs || []).length, 3);

  // 3.3 超过单次上限要截断并提示
  seed('workout_logs', 600);
  const cappedRes = await data.clearCollection({ name: 'workout_logs', label: '训练打卡' }, { openid: 'u1' });
  eq('单次上限 500 条', cappedRes.removed, data._internal.BATCH * data._internal.MAX_ROUNDS);
  eq('标记 capped（提示再点一次）', cappedRes.capped, true);
  eq('剩余 100 条待下次清理', collections.workout_logs.length, 100);

  // 3.4 集合不存在 → 跳过而不是报错
  missingCollections = ['plans'];
  const skip = await data.clearCollection({ name: 'plans', label: '训练计划' }, { openid: 'u1' });
  eq('集合不存在时跳过', skip.skipped, '集合不存在');
  eq('跳过时删除数为 0', skip.removed, 0);

  // 3.5 未登录不误删
  const noLogin = await data.clearCollection({ name: 'body_records', label: '身体记录' }, { openid: '' });
  eq('未登录直接跳过', noLogin.skipped, '未登录');

  // 3.6 汇总文案
  missingCollections = [];
  seed('workout_logs', 2);
  seed('body_records', 1);
  seed('chat_messages', 0);
  seed('plans', 3);
  const all = await data.clearTrainingData({ openid: 'u1' });
  eq('汇总总数 6', all.total, 6);
  ok('汇总文案包含训练打卡', all.summary.indexOf('训练打卡 2 条') >= 0, all.summary);
  ok('汇总文案跳过空集合', all.summary.indexOf('AI 对话') < 0, all.summary);
  eq('无集合触发上限', all.capped.length, 0);

  // 进度回调：每删一条回调一次
  seed('workout_logs', 5);
  let ticks = 0;
  await data.clearTrainingData({ openid: 'u1', onProgress: () => { ticks++; } });
  ok('进度回调按删除条数触发', ticks >= 5, ticks);

  ok('isCollectionMissing 识别 -502005', data._internal.isCollectionMissing({ errMsg: 'errCode: -502005' }) === true);
  ok('isCollectionMissing 不误判其他错误', data._internal.isCollectionMissing({ errMsg: 'permission denied' }) === false);

  console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================\n');
  process.exit(fail ? 1 : 0);
})();
