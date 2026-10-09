/**
 * test-reminder.js — 训练提醒（订阅消息）单测（V1.1）
 * 覆盖两层：
 *   A. cloudfunctions/sendReminder/lib.js —— 纯逻辑（北京时间换算 / 该不该发 / 模板数据拼装）
 *      → 云函数本体 require 了 wx-server-sdk 跑不起来，所以纯逻辑单独拆了出来
 *   B. miniprogram/services/reminder.js —— 纯展示helper + 用内存版云数据库跑读写
 * 全部离线运行，不碰真实云环境。
 */
const path = require('path');
const MINIPROGRAM = path.resolve(__dirname, 'miniprogram');

const lib = require(path.resolve(__dirname, 'cloudfunctions/sendReminder/lib.js'));

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
let subscribeResult = 'accept'; // requestSubscribeMessage 的授权结果
let callFunctionLog = [];

const SERVER_DATE = { __serverDate: true };

function filterDocs(name, cond) {
  const docs = collections[name] || [];
  return docs.filter((d) => Object.keys(cond || {}).every((k) => d[k] === cond[k]));
}

// 把 update 的 data（含 {__inc}、serverDate 标记）作用到文档上
function applyPatch(doc, data) {
  Object.keys(data || {}).forEach((k) => {
    const v = data[k];
    if (v && typeof v === 'object' && typeof v.__inc === 'number') {
      doc[k] = Math.round(Number(doc[k]) || 0) + v.__inc;
    } else if (v && v.__serverDate) {
      doc[k] = 1759825249000; // 固定值，仅用于断言"写入了"
    } else {
      doc[k] = v;
    }
  });
}

global.wx = {
  getStorageSync: (k) => (k in storeMap ? storeMap[k] : ''),
  setStorageSync: (k, v) => { storeMap[k] = v; },
  removeStorageSync: (k) => { delete storeMap[k]; },
  requestSubscribeMessage: (opt) => {
    const res = {};
    const tmpl = (opt.tmplIds || [])[0];
    if (subscribeResult === 'unsupported') {
      delete global.wx.requestSubscribeMessage;
      opt.fail && opt.fail({ errMsg: 'requestSubscribeMessage:fail not supported' });
      global.wx.requestSubscribeMessage = wx.requestSubscribeMessage;
      return;
    }
    res[tmpl] = subscribeResult;
    opt.success && opt.success(res);
  },
  cloud: {
    database: () => ({
      serverDate: () => SERVER_DATE,
      command: {
        inc: (n) => ({ __inc: n })
      },
      collection(name) {
        if (missingCollections.indexOf(name) >= 0) {
          return {
            where: () => ({ limit: () => ({ get: async () => { throw { errMsg: 'errCode: -502005 database collection not exists' }; } }) }),
            add: async () => { throw { errMsg: '-502005 collection not exists' }; }
          };
        }
        return {
          where: (cond) => ({
            limit: (n) => ({
              get: async () => ({ data: filterDocs(name, cond).slice(0, n) })
            })
          }),
          add: async ({ data }) => {
            const _id = `${name}-${(collections[name] || []).length + 1}`;
            (collections[name] = collections[name] || []).push(Object.assign({ _id }, data));
            return { _id };
          },
          doc: (id) => ({
            update: async ({ data }) => {
              const d = (collections[name] || []).find((x) => x._id === id);
              if (!d) throw new Error('doc not found: ' + id);
              applyPatch(d, data);
              return {};
            }
          })
        };
      }
    }),
    callFunction: async ({ name, data }) => {
      callFunctionLog.push({ name, data });
      return { result: { code: 0 } };
    }
  }
};
global.getApp = () => ({ globalData: { openid: 'u1' } });

const reminder = require(path.join(MINIPROGRAM, 'services/reminder.js'));

(async function run() {
  console.log('==================== 训练提醒单测 ====================');

  // ============================================================
  // A. 云函数纯逻辑
  // ============================================================
  section('A1. 北京时间换算（云函数在 UTC 时区运行）');
  // UTC 2026-10-07 11:00 = 北京 19:00
  const p1 = lib.cnParts(Date.UTC(2026, 9, 7, 11, 0, 0));
  eq('UTC 11:00 → 北京小时 19', p1.hour, 19);
  eq('日期分量正确', `${p1.year}-${p1.month}-${p1.day}`, '2026-10-7');
  eq('cnDateStr 输出补零', lib.cnDateStr(Date.UTC(2026, 9, 7, 11, 0, 0)), '2026-10-07');
  // 跨天边界：UTC 2026-10-06 17:00 = 北京 2026-10-07 01:00
  eq('UTC 17:00 跨天到次日', lib.cnDateStr(Date.UTC(2026, 9, 6, 17, 0, 0)), '2026-10-07');
  // UTC 2026-10-06 15:59 = 北京 2026-10-06 23:59
  eq('UTC 15:59 仍是当天', lib.cnDateStr(Date.UTC(2026, 9, 6, 15, 59, 0)), '2026-10-06');
  eq('cnTimeText 中文格式', lib.cnTimeText(Date.UTC(2026, 9, 7, 11, 5, 0)), '2026年10月7日 19:05');

  section('A2. 提醒时间归一化');
  eq('undefined → 默认 19', lib.clampHour(undefined), 19);
  eq('"abc" → 默认 19', lib.clampHour('abc'), 19);
  eq('null → 默认 19', lib.clampHour(null), 19);
  eq('25 收敛到 23', lib.clampHour(25), 23);
  eq('-3 收敛到 0', lib.clampHour(-3), 0);
  eq('7.6 四舍五入到 8', lib.clampHour(7.6), 8);
  eq('字符串 "9" → 9', lib.clampHour('9'), 9);
  eq('空串按未填处理 → 默认 19', lib.clampHour(''), 19);
  eq('formatHour(7) 补零', lib.formatHour(7), '07:00');
  eq('formatHour(19)', lib.formatHour(19), '19:00');

  section('A3. 文案截断（模板 thing 字段限 20 字）');
  eq('短文本不动', lib.truncate('今日训练提醒', 20), '今日训练提醒');
  eq('刚好等长不动', lib.truncate('12345', 5), '12345');
  eq('超长截断加省略号', lib.truncate('abcdef', 3), 'ab…');
  eq('截断后长度为上限', Array.from(lib.truncate('一二三四五六七八九十', 4)).length, 4);
  eq('emoji 代理对不被切开', lib.truncate('abc🏋️def', 5), 'abc🏋…');
  eq('末尾不留孤立的变体选择符', lib.truncate('🏋️bc', 3), '🏋…');
  eq('null → 空串', lib.truncate(null, 5), '');

  section('A4. 该不该发（decideRemind）');
  const base = { enabled: true, hour: 19, quota: 1, lastSentDate: '' };
  const ctx = { todayStr: '2026-10-07', hour: 19, checkedInToday: false };
  eq('正常情况可发', lib.decideRemind(base, ctx).reason, 'ok');
  eq('未开启 → disabled', lib.decideRemind(Object.assign({}, base, { enabled: false }), ctx).reason, 'disabled');
  eq('enabled 缺失 → disabled', lib.decideRemind({ hour: 19, quota: 1 }, ctx).reason, 'disabled');
  eq('额度为 0 → no-quota', lib.decideRemind(Object.assign({}, base, { quota: 0 }), ctx).reason, 'no-quota');
  eq('额度缺失 → no-quota', lib.decideRemind(Object.assign({}, base, { quota: undefined }), ctx).reason, 'no-quota');
  eq('今天已打卡 → checked-in', lib.decideRemind(base, Object.assign({}, ctx, { checkedInToday: true })).reason, 'checked-in');
  eq('今天已经发过 → already-sent', lib.decideRemind(Object.assign({}, base, { lastSentDate: '2026-10-07' }), ctx).reason, 'already-sent');
  eq('昨天发过不影响今天', lib.decideRemind(Object.assign({}, base, { lastSentDate: '2026-10-06' }), ctx).reason, 'ok');
  eq('时间点不匹配 → hour-mismatch', lib.decideRemind(base, Object.assign({}, ctx, { hour: 20 })).reason, 'hour-mismatch');
  eq('不传 hour 跳过时间校验（测试发送用）', lib.decideRemind(base, { todayStr: '2026-10-07' }).reason, 'ok');
  eq('不传 todayStr 跳过当天去重', lib.decideRemind(Object.assign({}, base, { lastSentDate: '2026-10-07' }), { hour: 19 }).reason, 'ok');
  eq('hour 非法值按默认 19 比对', lib.decideRemind(Object.assign({}, base, { hour: undefined }), ctx).reason, 'ok');
  ok('决策结果带 send 布尔', lib.decideRemind(base, ctx).send === true && lib.decideRemind({}, ctx).send === false);
  eq('原因有中文说明', lib.reasonText('checked-in'), '今天已打卡，无需提醒');
  eq('未知原因原样返回', lib.reasonText('whatever'), 'whatever');

  section('A5. 模板数据拼装');
  const content = lib.buildContent({ nowMs: Date.UTC(2026, 9, 7, 11, 0, 0), focus: '胸 / 三头', streak: 3 });
  eq('thing 带焦点', content.thing, '胸 / 三头训练提醒');
  eq('time 是中文时间', content.time, '2026年10月7日 19:00');
  eq('remark 提连续天数', content.remark, '已连续打卡 3 天，今天别断');
  eq('无 focus 时回落通用标题', lib.buildContent({}).thing, '今日训练提醒');
  eq('streak < 2 用默认鼓励语', lib.buildContent({ streak: 1 }).remark, '点开完成今天的计划吧');
  eq('streak 非法值不报错', lib.buildContent({ streak: 'abc' }).remark, '点开完成今天的计划吧');
  ok('thing 不超过 20 字', Array.from(lib.buildContent({ focus: '很长的部位名称很长的部位名称' }).thing).length <= 20);

  const tpl = lib.toTemplateData(content, { thing: 'thing1', time: 'time2', remark: 'thing3' });
  eq('映射出 3 个字段', Object.keys(tpl).length, 3);
  eq('thing1 结构正确', tpl.thing1.value, '胸 / 三头训练提醒');
  eq('time2 结构正确', tpl.time2.value, '2026年10月7日 19:00');
  eq('只配一个字段就只发一个', Object.keys(lib.toTemplateData(content, { thing: 'thing1' })).length, 1);
  eq('无映射 → 空对象（不会误发多余字段）', JSON.stringify(lib.toTemplateData(content, null)), '{}');
  eq('字段值为空时不映射', JSON.stringify(lib.toTemplateData({ thing: '' }, { thing: 'thing1' })), '{}');

  section('A6. 额度扣减与错误识别');
  eq('3 → 2', lib.nextQuota({ quota: 3 }), 2);
  eq('1 → 0', lib.nextQuota({ quota: 1 }), 0);
  eq('0 不会变负', lib.nextQuota({ quota: 0 }), 0);
  eq('缺失额度 → 0', lib.nextQuota({}), 0);
  eq('字符串额度也能算', lib.nextQuota({ quota: '2' }), 1);
  ok('43101（用户拒收）识别为无额度', lib.isNoQuotaError({ errCode: 43101, errMsg: 'user refuse to accept the msg' }) === true);
  ok('文案含 refuse 也识别', lib.isNoQuotaError({ errMsg: 'user refuse to accept the msg' }) === true);
  ok('其他错误不误判', lib.isNoQuotaError({ errCode: 47003, errMsg: 'argument invalid' }) === false);
  ok('字符串错误不误判', lib.isNoQuotaError('oops') === false);
  eq('openid 打码', lib.maskOpenid('oABCDEFGHIJK1234'), 'oABCDE***34');
  eq('短 openid 原样返回', lib.maskOpenid('o123'), 'o123');

  // ============================================================
  // B. 小程序侧服务
  // ============================================================
  section('B1. 纯展示 helper');
  ok('模板 ID 还是占位符时 isConfigured() 为 false', reminder.isConfigured() === false);
  eq('默认提醒时间 19:00', reminder.formatHour(reminder.DEFAULT_HOUR), '19:00');
  eq('服务侧 clampHour(null) 也用默认值', reminder.clampHour(null), reminder.DEFAULT_HOUR);
  eq('服务侧 clampHour("") 也用默认值', reminder.clampHour(''), reminder.DEFAULT_HOUR);
  eq('服务侧 clampHour(30) 收敛到 23', reminder.clampHour(30), 23);
  eq('候选整点数量与标签一致', reminder.hourLabels().length, reminder.HOURS.length);
  eq('候选第一个标签', reminder.hourLabels()[0], '07:00');
  eq('状态：无记录 → 未开启', reminder.statusText(null), '未开启');
  eq('状态：开着但没额度 → 待续订', reminder.statusText({ enabled: true, quota: 0, hour: 19 }), '待续订');
  eq('状态：正常 → 已开启 + 时间', reminder.statusText({ enabled: true, quota: 2, hour: 7 }), '已开启 · 07:00');
  eq('次数文案：有额度', reminder.quotaText({ quota: 3 }), '剩余 3 次');
  eq('次数文案：无额度', reminder.quotaText({ quota: 0 }), '剩余 0 次');
  eq('次数文案：无记录', reminder.quotaText(null), '剩余 0 次');
  eq('needRenew：开着没额度 → true', reminder.needRenew({ enabled: true, quota: 0 }), true);
  eq('needRenew：关着 → false', reminder.needRenew({ enabled: false, quota: 5 }), false);
  eq('needRenew：开着有额度 → false', reminder.needRenew({ enabled: true, quota: 1 }), false);

  section('B2. 模板未配置时的防护');
  const sub = await reminder.subscribe();
  eq('未配置时授权直接返回 unconfigured', sub.status, 'unconfigured');
  eq('未配置时 accepted=0', sub.accepted, 0);
  let enableErr = '';
  try {
    await reminder.enable(19);
  } catch (e) {
    enableErr = e.message;
  }
  ok('enable 抛「模板未配置」而不是静默失败', /模板未配置/.test(enableErr), enableErr);

  section('B3. 本地缓存');
  eq('初始无缓存', reminder.getCache(), null);
  reminder.setCache({ enabled: true, quota: 2, hour: 8 });
  eq('setCache 后能读回', reminder.getCache().quota, 2);
  eq('menu 状态文案跟随缓存', reminder.statusText(reminder.getCache()), '已开启 · 08:00');
  reminder.clearCache();
  eq('clearCache 后为空', reminder.getCache(), null);

  section('B4. 云端读写（内存数据库）');
  collections.reminders = [];
  let doc = await reminder.disable();
  eq('首次 disable 会建记录', collections.reminders.length, 1);
  eq('建出来是关闭状态', doc.enabled, false);
  eq('建出来额度为 0', doc.quota, 0);
  eq('建出来用默认时间', doc.hour, reminder.DEFAULT_HOUR);
  ok('写入 createdAt', !!doc.createdAt);

  doc = await reminder.setHour(7.6);
  eq('setHour 四舍五入并落库', doc.hour, 8);
  eq('setHour 不改开关', doc.enabled, false);

  // 直接走内部 upsert 覆盖「额度自增」这条最难的分支
  doc = await reminder._internal.upsert('u1', { enabled: true, hour: 19, quotaInc: 2 });
  eq('订阅 2 次 → 额度 2', doc.quota, 2);
  eq('订阅后开关打开', doc.enabled, true);
  eq('订阅后时间落库', doc.hour, 19);
  eq('同一用户不会新建第二条记录', collections.reminders.length, 1);

  doc = await reminder._internal.upsert('u1', { enabled: true, hour: 19, quotaInc: 1 });
  eq('再订阅 1 次 → 额度累加到 3', doc.quota, 3);

  doc = await reminder._internal.upsert('u1', { enabled: false });
  eq('关闭时额度保留（不白花）', doc.quota, 3);
  eq('关闭后状态为 false', doc.enabled, false);
  eq('只传 enabled 时时间不变', doc.hour, 19);

  const loaded = await reminder.load();
  eq('load 读到的是同一条', loaded.quota, 3);
  eq('load 顺便写了本地缓存', reminder.getCache().hour, 19);
  eq('菜单文案同步', reminder.statusText(reminder.getCache()), '未开启');
  eq('testSend 会调用云函数', (await reminder.testSend()).code, 0);
  eq('testSend 调用的是 sendReminder', callFunctionLog[callFunctionLog.length - 1].name, 'sendReminder');
  eq('testSend 传了 action=test', callFunctionLog[callFunctionLog.length - 1].data.action, 'test');

  section('B5. 集合缺失时的自愈与兜底');
  missingCollections = ['reminders'];
  reminder.clearCache();
  callFunctionLog = [];
  let missErr = '';
  try {
    await reminder.load();
  } catch (e) {
    missErr = e.message;
  }
  eq('集合缺失时先自动跑一次 initDb', callFunctionLog.filter((c) => c.name === 'initDb').length, 1);
  ok('自愈失败后给出可读提示', /集合未创建/.test(missErr), missErr);
  missingCollections = [];

  console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================\n');
  if (fail > 0) process.exit(1);
})();
