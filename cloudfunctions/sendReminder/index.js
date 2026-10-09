// cloudfunctions/sendReminder/index.js — 训练提醒（订阅消息）
//
// 职责：
//   ① 定时触发（每小时整点）：给「已开启 + 还有订阅额度 + 今天没打卡 + 到点」的用户发一条训练提醒
//   ② action='test'：给调用者自己立刻发一条（联调用，会消耗 1 次真实订阅额度）
//
// ── 部署前必做（详见 docs/REMINDER-SETUP.md）────────────────────────────
//   1. 微信公众平台 → 功能 → 订阅消息 → 选用模板，复制模板 ID
//   2. 云开发控制台 → 云函数 → sendReminder → 配置 → 环境变量：
//        REMINDER_TEMPLATE_ID = 你的模板 ID   ← 不填则整个函数不发送（只打日志）
//        MINIPROGRAM_STATE    = developer      ← 开发期用 developer，上线后删掉或改 formal
//   3. 按你的模板字段名调整下面的 FIELD_MAP
//   4. 云开发控制台 → 数据库 → 新建集合 reminders（权限：仅创建者可读写）
//   5. 右键 sendReminder → 上传并部署（云端安装依赖）
//
// ── 为什么按小时跑而不是每天一次 ────────────────────────────────────────
//   提醒时间由用户自己选（7:00/12:00/19:00…），定时器只能固定时间触发，
//   所以每小时跑一次、只发给「用户选的整点 == 当前整点」的人。
//   24 次/天，在云开发免费额度里可以忽略。

const cloud = require('wx-server-sdk');
const lib = require('./lib.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COLLECTION = 'reminders';

// 模板 ID 从环境变量读，避免把 ID 写死在代码里（换模板不用改代码）
const TEMPLATE_ID = process.env.REMINDER_TEMPLATE_ID || '';
// developer = 开发版；trial = 体验版；formal = 正式版（默认）
const MINIPROGRAM_STATE = process.env.MINIPROGRAM_STATE || 'formal';

// 点击提醒消息后跳转的页面
const PAGE = 'pages/training/training';

// 模板字段映射：左边是 lib.buildContent 提供的归一化内容，右边改成你模板里的真实字段名
// 常见模板：提醒事项 thing1 / 提醒时间 time2 / 温馨提示 thing3
const FIELD_MAP = { thing: 'thing1', time: 'time2', remark: 'thing3' };

const MAX_USERS_PER_RUN = 100; // 单轮最多处理多少用户（云函数总超时 60s，留足余量）
const CHUNK = 20;              // 查打卡记录时按 20 个 openid 一批（配 _.in 查）

exports.main = async (event) => {
  const ev = event || {};
  try {
    if (ev.action === 'test') return await handleTest();
    return await runBatch();
  } catch (err) {
    console.error('[sendReminder] 主流程异常：', err);
    return {
      code: 1,
      message: (err && (err.errMsg || err.message)) || String(err)
    };
  }
};

// ─────────────────────────── 定时批量发送 ───────────────────────────

async function runBatch() {
  const now = Date.now();
  const today = lib.cnDateStr(now);
  const hour = lib.cnParts(now).hour;

  if (!templateReady()) {
    const message = '未配置模板 ID：请在云函数环境变量里设置 REMINDER_TEMPLATE_ID（见 docs/REMINDER-SETUP.md）';
    console.warn('[sendReminder]', message);
    return { code: 2, message, hour, sent: 0 };
  }

  // 只捞「开启 + 有额度」的人，减少无谓查询
  const res = await db.collection(COLLECTION)
    .where({ enabled: true, quota: _.gt(0) })
    .limit(MAX_USERS_PER_RUN)
    .get();
  const records = res.data || [];
  if (!records.length) {
    return { code: 0, message: '本轮无待发送用户', hour, sent: 0, total: 0 };
  }

  // 一次性把候选人的今日打卡情况查出来，避免 N 次单查
  const checkedSet = await checkedInSet(records.map((r) => r.openid), today);

  const summary = { total: records.length, sent: 0, failed: 0, skipped: {}, details: [] };

  for (const record of records) {
    const verdict = lib.decideRemind(record, {
      todayStr: today,
      hour,
      checkedInToday: checkedSet.has(record.openid)
    });
    if (!verdict.send) {
      summary.skipped[verdict.reason] = (summary.skipped[verdict.reason] || 0) + 1;
      continue;
    }
    const r = await sendOne(record, { nowMs: now, todayStr: today });
    if (r.ok) summary.sent++;
    else summary.failed++;
    summary.details.push({
      openid: lib.maskOpenid(record.openid),
      ok: r.ok,
      errCode: r.errCode || 0,
      error: r.ok ? '' : String(r.error || '').slice(0, 80)
    });
  }

  console.log('[sendReminder] 本轮结果：', JSON.stringify(summary));
  return Object.assign(
    { code: 0, hour, message: `发送 ${summary.sent} 条，失败 ${summary.failed} 条` },
    summary
  );
}

// ─────────────────────────── 测试发送 ───────────────────────────

async function handleTest() {
  const { OPENID } = cloud.getWXContext();
  const now = Date.now();
  const today = lib.cnDateStr(now);

  if (!templateReady()) {
    return { code: 2, message: '未配置模板 ID：请在云函数环境变量 REMINDER_TEMPLATE_ID 里填入（见 docs/REMINDER-SETUP.md）' };
  }

  let record = null;
  try {
    const res = await db.collection(COLLECTION).where({ openid: OPENID }).limit(1).get();
    record = res.data[0] || null;
  } catch (err) {
    if (/-502005|collection not exists/i.test((err && err.errMsg) || '')) {
      return { code: 3, message: 'reminders 集合还不存在：先在小程序里开启一次提醒，或执行 initDb 初始化' };
    }
    throw err;
  }
  if (!record) {
    return { code: 3, message: '还没有提醒记录：请先在「我的 → 训练提醒」里开启提醒' };
  }
  if (record.enabled !== true) {
    return { code: 4, message: '提醒未开启：请先在「我的 → 训练提醒」里开启' };
  }
  if (!(Number(record.quota) > 0)) {
    return { code: 5, message: '订阅额度已用完：在小程序里再点一次「续订 1 次提醒」授权即可' };
  }

  // 测试发送不校验「时间点」和「今天是否已发」——就是要立刻看到效果
  const r = await sendOne(record, { nowMs: now, todayStr: today, force: true });
  return {
    code: r.ok ? 0 : 6,
    message: r.ok
      ? '测试提醒已发送（已消耗 1 次订阅额度）'
      : `发送失败：${r.error}`,
    detail: { errCode: r.errCode || 0, quota: r.quota, content: r.content }
  };
}

// ─────────────────────────── 内部工具 ───────────────────────────

function templateReady() {
  return !!TEMPLATE_ID && TEMPLATE_ID.indexOf('REPLACE') !== 0;
}

// 发一条 + 扣额度 + 落库。任何失败都不抛，返回结构化结果由调用方汇总
async function sendOne(record, ctx) {
  const content = lib.buildContent({
    nowMs: ctx.nowMs,
    focus: ctx.focus,
    streak: ctx.streak
  });
  const data = lib.toTemplateData(content, FIELD_MAP);

  try {
    await cloud.openapi.subscribeMessage.send({
      touser: record.openid,
      templateId: TEMPLATE_ID,
      page: PAGE,
      data,
      miniprogramState: MINIPROGRAM_STATE
    });

    const quota = lib.nextQuota(record);
    await db.collection(COLLECTION).doc(record._id).update({
      data: {
        quota,
        lastSentDate: ctx.todayStr || lib.cnDateStr(ctx.nowMs),
        lastSentAt: db.serverDate(),
        updatedAt: db.serverDate(),
        lastError: ''
      }
    });
    return { ok: true, errCode: 0, quota, content };
  } catch (err) {
    const errCode = (err && err.errCode) || 0;
    const errMsg = (err && (err.errMsg || err.message)) || String(err);
    const noQuota = lib.isNoQuotaError(err);
    console.warn('[sendReminder] 发送失败', lib.maskOpenid(record.openid), errCode, errMsg);

    // 记录失败原因，方便在数据库里直接看；额度用尽则停发避免连续报错
    try {
      await db.collection(COLLECTION).doc(record._id).update({
        data: Object.assign(
          { updatedAt: db.serverDate(), lastError: String(errMsg).slice(0, 200) },
          noQuota ? { quota: 0, enabled: false } : {}
        )
      });
    } catch (e) { /* 回写失败不影响返回 */ }

    return { ok: false, errCode, error: errMsg, noQuota };
  }
}

// 查出这批人里今天已经打过卡的人（分批 _.in 查询）
async function checkedInSet(openids, today) {
  const set = new Set();
  for (let i = 0; i < openids.length; i += CHUNK) {
    const chunk = openids.slice(i, i + CHUNK);
    try {
      const res = await db.collection('workout_logs')
        .where({ date: today, openid: _.in(chunk) })
        .field({ openid: true })
        .limit(1000)
        .get();
      (res.data || []).forEach((d) => set.add(d.openid));
    } catch (err) {
      // 集合不存在等情况：当作「没打卡」（宁可多发一条，也不要因为查不到就全都不发）
      console.warn('[sendReminder] 查询打卡记录失败：', (err && err.errMsg) || err);
    }
  }
  return set;
}
