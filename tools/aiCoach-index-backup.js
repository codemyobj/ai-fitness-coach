// cloudfunctions/aiCoach/index.js — AI 健身教练云函数（V0.2：对话）
//
// 部署前配置（云开发控制台 → 云函数 → aiCoach → 配置 → 环境变量）：
//   MODEL_API_KEY  大模型 API Key（必填，不填则进入演示模式）
//   MODEL_BASE_URL OpenAI 兼容接口地址（默认 https://api.deepseek.com）
//   MODEL_NAME     模型名（默认 deepseek-chat；混元/通义等兼容接口同样适用）
//
// 需创建集合：chat_messages（安全规则：read/write 限本人 openid）

const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const MODEL_API_KEY = process.env.MODEL_API_KEY || '';
const MODEL_BASE_URL = process.env.MODEL_BASE_URL || 'https://api.deepseek.com';
const MODEL_NAME = process.env.MODEL_NAME || 'deepseek-chat';
const CONTEXT_COUNT = 20;      // 携带的历史对话条数
const MODEL_TIMEOUT = 55000;   // 模型超时（毫秒），需小于云函数 timeout

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { action, message } = event;

  try {
    switch (action) {
      case 'chat':
        return await handleChat(OPENID, message);
      case 'generatePlan':
        return await handleGeneratePlan(OPENID);
      default:
        return { code: 1, message: `未知操作: ${action}` };
    }
  } catch (err) {
    console.error('aiCoach 异常:', err);
    return { code: 1, message: err.message || 'AI 服务异常，请稍后重试' };
  }
};

// ---------- 对话 ----------
async function handleChat(openid, message) {
  // 1. 输入校验
  if (!message || typeof message !== 'string') {
    throw new Error('消息不能为空');
  }
  if (message.length > 500) {
    throw new Error('消息太长了，请精简到 500 字以内');
  }

  // 2. 内容安全检测（合规必须）
  await secCheck(message);

  // 3. 加载用户档案 + 近期对话
  const [profile, history] = await Promise.all([
    getProfile(openid),
    getHistory(openid)
  ]);

  // 4. 拼装 Prompt：人设 + 档案 + 输出约束
  const systemPrompt = buildSystemPrompt(profile);
  const chatMessages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: message }
  ];

  // 5. 调模型（未配置 Key 时返回演示回复，保证链路可跑通）
  let reply;
  if (!MODEL_API_KEY) {
    reply = '【演示模式】尚未配置 MODEL_API_KEY 环境变量。'
      + '部署后在云开发控制台为 aiCoach 云函数配置大模型 API Key 即可获得真实回复。'
      + (profile ? `\n\n已读取到你的档案：${profile.goal === 'fat_loss' ? '减脂' : profile.goal === 'muscle_gain' ? '增肌' : '综合'}目标，${profile.daysPerWeek} 天/周。` : '');
  } else {
    reply = await callModelWithRetry(chatMessages);
  }

  // 6. AI 输出同样过内容安全
  await secCheck(reply);

  // 7. 双向消息落库（按时间序：先 user 后 assistant）
  // _openid 必须显式写入：云函数写入不会自动带 _openid，而集合权限
  // 「仅创建者可读写」按 _openid 判定，缺了它客户端将读不到自己的消息
  const now = db.serverDate();
  await db.collection('chat_messages').add({
    data: { _openid: openid, openid, role: 'user', content: message, createdAt: now }
  });
  await db.collection('chat_messages').add({
    data: { _openid: openid, openid, role: 'assistant', content: reply, createdAt: now }
  });

  return { code: 0, data: { reply } };
}

// ---------- 计划生成（V0.3）----------
// 动作白名单：与前端 assets/data/exercises.json 保持同步
const EXERCISE_LIBRARY = [
  { id: 'pushup', name: '标准俯卧撑', equipment: '徒手' },
  { id: 'knee_pushup', name: '跪姿俯卧撑', equipment: '徒手' },
  { id: 'dumbbell_bench_press', name: '哑铃卧推', equipment: '哑铃' },
  { id: 'pullup', name: '引体向上', equipment: '健身房' },
  { id: 'dumbbell_row', name: '哑铃单臂划船', equipment: '哑铃' },
  { id: 'squat', name: '徒手深蹲', equipment: '徒手' },
  { id: 'lunge', name: '箭步蹲', equipment: '徒手' },
  { id: 'dumbbell_shoulder_press', name: '哑铃肩推', equipment: '哑铃' },
  { id: 'plank', name: '平板支撑', equipment: '徒手' },
  { id: 'dead_bug', name: '死虫式', equipment: '徒手' },
  { id: 'jumping_jack', name: '开合跳', equipment: '徒手' },
  { id: 'burpee', name: '波比跳', equipment: '徒手' }
];

// 器械条件 → 可用动作 id 过滤
const EQUIPMENT_FILTER = {
  '徒手': ['徒手'],
  '哑铃': ['徒手', '哑铃'],
  '健身房': ['徒手', '哑铃', '健身房']
};

async function handleGeneratePlan(openid) {
  // 1. 必须先建档
  const profile = await getProfile(openid);
  if (!profile) {
    return { code: 3, message: '请先完成身体档案填写' };
  }

  // 2. 生成计划（真实模式 / 演示模式）
  let plan;
  if (!MODEL_API_KEY) {
    plan = buildDemoPlan(profile);
  } else {
    plan = await generatePlanByModel(profile);
  }

  // 3. 归档旧计划，保存新计划
  const now = db.serverDate();
  await db.collection('plans')
    .where({ openid, status: 'active' })
    .update({ data: { status: 'archived', updatedAt: now } });
  const addRes = await db.collection('plans').add({
    data: {
      _openid: openid, // 显式写入创建者：配合集合「仅创建者可读写」权限，客户端才能读到
      openid,
      goal: profile.goal,
      weeks: plan.weeks.length,
      planName: plan.planName,
      summary: plan.summary,
      structure: plan.weeks,
      status: 'active',
      source: MODEL_API_KEY ? 'ai' : 'demo',
      createdAt: now,
      updatedAt: now
    }
  });

  return { code: 0, data: { planId: addRes._id, plan } };
}

// 真实模式：模型生成 + 结构校验 + 一次重试
async function generatePlanByModel(profile) {
  const lib = EXERCISE_LIBRARY.filter(
    (e) => (EQUIPMENT_FILTER[profile.equipment] || ['徒手']).includes(e.equipment)
  );
  const libText = lib.map((e) => `${e.id}(${e.name})`).join('、');
  const daysPerWeek = Math.min(Math.max(profile.daysPerWeek || 3, 1), 6);

  const prompt = [
    `为以下用户生成 4 周训练计划：`,
    `目标：${GOAL_TEXT[profile.goal] || '综合健身'}；经验：${profile.level}；`,
    `器械：${profile.equipment}；每周训练 ${daysPerWeek} 天；`,
    `年龄 ${profile.age}，身高 ${profile.heightCm}cm，体重 ${profile.weightKg}kg。`,
    ``,
    `严格按以下规则输出【纯 JSON，不要任何解释和 markdown 代码块】：`,
    `{ "planName": "计划名", "summary": "一句话说明",`,
    `  "weeks": [ { "weekIndex": 1, "focus": "本周主题",`,
    `    "days": [ { "dayIndex": 1, "focus": "当日部位",`,
    `      "exercises": [ { "exerciseId": "动作ID", "sets": 3, "reps": "8-12", "restSec": 60 } ] } ] } ] }`,
    ``,
    `硬性约束：`,
    `1. 只能使用这些动作ID：${libText}；`,
    `2. 每周 days 数组长度 = ${daysPerWeek}，dayIndex 从 1 递增；`,
    `3. 每个训练日 4-6 个动作，按目标合理搭配部位；`,
    `4. sets 为 2-5 的整数，restSec 为 30-180 的整数；`,
    `5. 共 4 周（weekIndex 1-4），强度随周递进。`
  ].join('\n');

  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await callModelWithRetry([
      { role: 'system', content: '你是专业的健身计划编排师，只输出合法 JSON。' },
      { role: 'user', content: prompt }
    ]);
    try {
      return validatePlan(parseJsonLoose(raw), lib, daysPerWeek);
    } catch (err) {
      console.warn(`计划校验失败(第${attempt}次):`, err.message);
      if (attempt === 2) throw new Error('计划生成异常，请重试');
    }
  }
}

// 宽松解析：容忍 ```json 包裹与首尾杂字符
function parseJsonLoose(raw) {
  let text = String(raw).trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  return JSON.parse(text);
}

// 结构校验：字段不合法直接抛错（触发重试）
function validatePlan(plan, lib, daysPerWeek) {
  if (!plan || !Array.isArray(plan.weeks) || plan.weeks.length !== 4) {
    throw new Error('weeks 结构错误');
  }
  const validIds = new Set(lib.map((e) => e.id));
  const nameMap = {};
  lib.forEach((e) => { nameMap[e.id] = e.name; });

  plan.weeks.forEach((week, wi) => {
    if (week.weekIndex !== wi + 1) throw new Error('weekIndex 错误');
    if (!Array.isArray(week.days) || !week.days.length) throw new Error('days 为空');
    week.days.forEach((day, di) => {
      if (day.dayIndex !== di + 1) throw new Error('dayIndex 错误');
      if (!Array.isArray(day.exercises) || day.exercises.length < 3) {
        throw new Error('动作数量不足');
      }
      day.exercises.forEach((ex) => {
        if (!validIds.has(ex.exerciseId)) throw new Error(`非法动作 ${ex.exerciseId}`);
        if (!Number.isInteger(ex.sets) || ex.sets < 1 || ex.sets > 6) {
          throw new Error('sets 非法');
        }
        if (!ex.reps) throw new Error('reps 缺失');
        const rest = Number(ex.restSec);
        if (!Number.isFinite(rest) || rest < 30 || rest > 180) throw new Error('restSec 非法');
        // 用标准名覆盖模型返回的名称，保证与动作库一致
        ex.name = nameMap[ex.exerciseId];
      });
    });
  });
  return plan;
}

// 演示模式：按档案规则本地生成（无 API Key 时保证链路可测）
function buildDemoPlan(profile) {
  const allowedEquipment = EQUIPMENT_FILTER[profile.equipment] || ['徒手'];
  const lib = EXERCISE_LIBRARY.filter((e) => allowedEquipment.includes(e.equipment));
  const daysPerWeek = Math.min(Math.max(profile.daysPerWeek || 3, 1), 6);
  const templates = [
    { focus: '胸 + 核心', ids: ['pushup', 'plank', 'dead_bug', 'jumping_jack'] },
    { focus: '腿 + 有氧', ids: ['squat', 'lunge', 'burpee', 'jumping_jack'] },
    { focus: '背 + 肩', ids: ['dumbbell_row', 'dumbbell_shoulder_press', 'plank', 'dead_bug'] },
    { focus: '全身循环', ids: ['squat', 'pushup', 'lunge', 'jumping_jack'] },
    { focus: '上肢强化', ids: ['pushup', 'dumbbell_bench_press', 'dumbbell_row', 'plank'] },
    { focus: '综合体能', ids: ['burpee', 'squat', 'pushup', 'plank', 'jumping_jack'] }
  ];
  const weeks = [1, 2, 3, 4].map((weekIndex) => ({
    weekIndex,
    focus: ['适应期', '进阶期', '强化期', '冲刺期'][weekIndex - 1],
    days: Array.from({ length: daysPerWeek }, (_, di) => ({
      dayIndex: di + 1,
      focus: templates[di % templates.length].focus,
      exercises: templates[di % templates.length].ids
        .filter((id) => lib.some((e) => e.id === id))
        .map((id) => {
          const e = lib.find((x) => x.id === id);
          return {
            exerciseId: id,
            name: e.name,
            sets: weekIndex + 1,
            reps: '10-15',
            restSec: 60
          };
        })
    }))
  }));
  return {
    planName: `4 周${GOAL_TEXT[profile.goal] || '综合'}计划（演示）`,
    summary: `根据你的档案生成：每周 ${daysPerWeek} 练，${profile.equipment}条件，强度逐周递进`,
    weeks
  };
}


// ⚠️ 参数格式基于 security.msgSecCheck，微信侧偶有升级，部署后如报参数错误需核实最新文档
async function secCheck(content) {
  try {
    await cloud.openapi.security.msgSecCheck({ content });
  } catch (err) {
    // 87014 = 内容违规，拒绝本次对话
    if (err.errCode === 87014) {
      throw new Error('内容包含违规信息，请修改后重试');
    }
    // 其他错误（如权限未配置）：记录日志但不阻断，避免开发阶段卡死
    console.warn('msgSecCheck 调用异常（不阻断）:', JSON.stringify(err));
  }
}

// ---------- 数据读取 ----------
async function getProfile(openid) {
  const res = await db.collection('profiles').where({ openid }).get();
  return res.data[0] || null;
}

async function getHistory(openid) {
  const res = await db.collection('chat_messages')
    .where({ openid })
    .orderBy('createdAt', 'desc')
    .limit(CONTEXT_COUNT)
    .get();
  // 取出来是倒序，反转为时间正序
  return res.data
    .reverse()
    .map((m) => ({ role: m.role, content: m.content }));
}

// ---------- Prompt 设计 ----------
const GOAL_TEXT = {
  fat_loss: '减脂塑形',
  muscle_gain: '增肌变强',
  endurance: '提升体能',
  posture: '体态改善'
};

function buildSystemPrompt(profile) {
  let base = [
    '你是「AI 健身教练」，一位专业、耐心、说话接地气的私教。遵守以下规则：',
    '1. 回答基于运动科学与常识，简洁实用，优先给可执行建议，单次回复不超过 300 字；',
    '2. 涉及用户身体数据时给出个性化建议，而不是泛泛而谈；',
    '3. 涉及伤病、疼痛时，先建议就医排查，不提供诊断或治疗方案；',
    '4. 不讨论药物、补剂处方，饮食只给一般性均衡建议；',
    '5. 语气亲切自然，适当使用表情，不说教。'
  ].join('\n');

  if (!profile) {
    base += '\n\n（用户尚未建档，可在合适时机提醒他完成建档以获得个性化建议）';
    return base;
  }

  const p = [
    `\n\n用户档案：`,
    `- 性别：${profile.gender === 'male' ? '男' : profile.gender === 'female' ? '女' : '未知'}`,
    `- 年龄：${profile.age} 岁；身高 ${profile.heightCm}cm；体重 ${profile.weightKg}kg`,
    `- 目标：${GOAL_TEXT[profile.goal] || '综合健身'}`,
    `- 经验：${profile.level || '未知'}；器械条件：${profile.equipment || '未知'}`,
    `- 频率：每周 ${profile.daysPerWeek} 天`
  ].join('\n');
  return base + p;
}

// ---------- 模型调用（OpenAI 兼容 /chat/completions）----------
function callModel(messages) {
  return new Promise((resolve, reject) => {
    const base = MODEL_BASE_URL.replace(/\/+$/, '');
    const url = new URL(base + '/chat/completions');
    const payload = JSON.stringify({
      model: MODEL_NAME,
      messages,
      temperature: 0.7,
      max_tokens: 800
    });

    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MODEL_API_KEY}`,
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: MODEL_TIMEOUT
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`模型接口错误(${res.statusCode}): ${data.slice(0, 200)}`));
            return;
          }
          try {
            const json = JSON.parse(data);
            const reply = json.choices && json.choices[0] && json.choices[0].message
              && json.choices[0].message.content;
            if (!reply) {
              reject(new Error('模型返回为空'));
            } else {
              resolve(reply.trim());
            }
          } catch (e) {
            reject(new Error('模型返回解析失败'));
          }
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('模型响应超时，请重试')));
    req.write(payload);
    req.end();
  });
}

// 免费模型（如 glm-4.7-flash）高峰期会返回 429「访问量过大」，
// 对 429/5xx 做指数退避重试：1s → 2.5s，最多 3 次尝试。
// 云函数总超时 60s，重试耗尽后抛出可读错误由前端兜底展示。
function callModelWithRetry(messages, attempts = 3) {
  return callModel(messages).catch((err) => {
    const retriable = /模型接口错误\((429|50[0234])\)/.test(err.message);
    if (retriable && attempts > 1) {
      const delay = attempts === 3 ? 1000 : 2500;
      return new Promise((resolve) => setTimeout(resolve, delay))
        .then(() => callModelWithRetry(messages, attempts - 1));
    }
    if (retriable) {
      throw new Error('AI 模型当前访问量过大，已自动重试仍失败，请稍等几秒再发一次');
    }
    throw err;
  });
}
