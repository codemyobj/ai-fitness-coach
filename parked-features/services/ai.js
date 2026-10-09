// services/ai.js — AI 教练服务封装
// 原则：Prompt 与 API Key 全部在云函数侧，前端只传用户输入
// 兜底原则：云端不可用时降级为本地规则，保证主流程可用（不会卡死在「云函数没部署」）

const planService = require('./plan.js');

// ---- 本地规则回复（云端 AI 不可用时兜底）----
const LOCAL_RULES = [
  { keys: ['计划', '安排', '课表', '怎么练'], reply: '我可以按你的目标排一份 4 周计划：去「训练」页点「生成 AI 计划」即可。一般建议每周 3 天，力量日之间至少隔一天休息。' },
  { keys: ['膝盖', '腰痛', '肩膀', '疼', '受伤'], reply: '出现关节疼痛请先停掉该动作，不要硬扛。可以先换成低冲击替代（如深蹲换箱式深蹲、波比跳换开合跳）；如果疼痛持续超过 3 天或加重，建议就医确认。' },
  { keys: ['饮食', '吃', '蛋白', '减脂'], reply: '减脂的核心是热量缺口：每天约 300-500 kcal 缺口，蛋白质按体重 1.6-2.0 g/kg 摄入，训练日碳水适当前置。睡前 2 小时避免大量进食。' },
  { keys: ['热身', '拉伸', '放松'], reply: '训练前做 5-8 分钟动态热身（关节活动 + 目标肌群小重量激活），训练后做 5 分钟静态拉伸，每个动作保持 20-30 秒。' },
  { keys: ['组数', '次数', '重量', '组'], reply: '新手建议每个动作 3 组 × 10-12 次，选「最后 2 次有点吃力但动作不变形」的重量；能标准完成 12 次就加 2.5-5% 重量。' },
  { keys: ['多久', '频率', '一周几次', '效果'], reply: '每周 3 次、坚持 4 周就能看到明显变化；8 周体型变化会被别人注意到。关键是连续性，别追求单次强度。' }
];

function localReply(message) {
  const text = String(message || '');
  for (let i = 0; i < LOCAL_RULES.length; i++) {
    if (LOCAL_RULES[i].keys.some((k) => text.indexOf(k) !== -1)) {
      return LOCAL_RULES[i].reply + '\n\n（当前云端 AI 未就绪，这是本地规则回复）';
    }
  }
  return '我先把要点说清楚：训练坚持比强度更重要。你可以问我「怎么安排计划」「膝盖疼怎么办」「减脂怎么吃」「组数怎么定」。\n\n（当前云端 AI 未就绪，这是本地规则回复）';
}

// 对话
async function chat(message, sessionId) {
  let res = null;
  let cloudErr = '';
  try {
    res = await wx.cloud.callFunction({
      name: 'aiCoach',
      data: { action: 'chat', message, sessionId }
    });
  } catch (e) {
    cloudErr = (e && (e.message || e.errMsg)) || '云函数调用失败';
  }

  const r = res && res.result;
  // 云端返回了正常结构化结果才使用；否则降级本地（模板代码会把原话原样返回，不能被当成 AI 回复）
  if (r && r.code === 0 && r.data && typeof r.data.reply === 'string' && r.data.reply) {
    return r.data.reply;
  }
  console.warn('[ai] 云端对话不可用，降级本地规则：', cloudErr || JSON.stringify(r).slice(0, 200));
  return localReply(message);
}

// 生成训练计划
async function generatePlan() {
  let res = null;
  let cloudErr = '';
  try {
    res = await wx.cloud.callFunction({
      name: 'aiCoach',
      data: { action: 'generatePlan' }
    });
  } catch (e) {
    cloudErr = (e && (e.message || e.errMsg)) || '云函数调用失败';
  }

  const r = res && res.result;
  if (r && r.code === 0 && r.data && r.data.plan) {
    return r.data.plan;
  }

  // 云端不可用 → 本地规则生成并直写数据库
  console.warn('[ai] 云端计划生成不可用，降级本地规则：', cloudErr || JSON.stringify(r).slice(0, 200));
  const profile = getApp().globalData.profile;
  const plan = await planService.createPlanLocal(profile);
  plan._fallback = true;
  plan._reason = cloudErr || (r && r.message) || '云端未返回计划数据（aiCoach 可能仍是模板代码）';
  return plan;
}

module.exports = { chat, generatePlan };
