// utils/share.js — 分享卡片文案与落地页（V1.0.4）
//
// 为什么单独抽一层：分享文案如果散落在 5 个页面里，必然会各写一份、长短不一；
// 而「分享出去说什么」是产品决策、不是渲染逻辑——抽成纯函数就能离线写断言
// （见 test-share.js），改文案也不用去动页面。
//
// 三条约定（改之前先读这里）：
// 1. **统一落地首页，动作卡除外**。陌生用户点开分享卡片时，首页是唯一对他友好的页面
//    （有计划会自动认出他今天该练哪一节，没计划有「开始建档」引导）；
//    徽章墙 / 数据看板对新用户都是空的，拿来当落地页只会显得这个 App 是空的。
// 2. **动作卡落到动作库并带上 id**，接收者能直接看到那个动作的要点与示范图——
//    这是唯一「有内容可看」的分享，所以单独放行。
// 3. **不设 imageUrl**，由微信自动截取页面顶部 5:4 区域。好处是 0 体积成本
//    （主包已经 174.7KB，能省则省）；想换定制海报时，在对应页面的
//    onShareAppMessage 返回值里补 imageUrl 即可，别把图片塞进主包。

const APP_NAME = '轻练打卡健身';
const HOME_PATH = '/pages/training/training';
const LIBRARY_PATH = '/packageA/library/library';

// 微信会话里的分享标题显示有限，超长会被截断。所有标题统一在这里收口。
const MAX_TITLE = 28;

// 截断：中英混排按字符数算就够了，多一个省略号占位避免出现半个词
function clip(text, max) {
  const s = String(text == null ? '' : text).trim();
  if (!s) return '';
  const limit = Number(max) > 0 ? Number(max) : MAX_TITLE;
  return s.length <= limit ? s : `${s.slice(0, limit - 1)}…`;
}

// 用分隔符拼接非空片段，顺手清掉空串带来的「A · · B」双分隔
function joinParts(list, sep) {
  return (list || [])
    .map((x) => String(x == null ? '' : x).trim())
    .filter(Boolean)
    .join(sep || ' · ');
}

// 统一挂个 share 来源标记：现在只是方便排查，将来要统计分享回流也有依据
function withShare(path, tag) {
  const p = String(path || HOME_PATH);
  return `${p}${p.indexOf('?') >= 0 ? '&' : '?'}share=${tag || 'card'}`;
}

// ---------- 训练首页 ----------
// 优先讲「成果」（连续天数），其次讲「今天练什么」，都没有才退回品牌口号。
// 分享卡片的读者是没装过的人，成果类钩子比功能描述更能点进来。
function buildHomeCard(input) {
  const o = input || {};
  const streak = Number(o.streak) || 0;
  let title;
  if (o.todayChecked && streak > 0) {
    title = `我已连续打卡 ${streak} 天，一起来练 💪`;
  } else if (o.hasPlan && o.focus) {
    title = `今天练${o.focus}，第 ${Number(o.dayNumber) || 1} 节`;
  } else {
    title = `${APP_NAME}｜在家也能坚持的训练打卡`;
  }
  return { title: clip(title), path: withShare(HOME_PATH, 'home') };
}

// ---------- 跟练中（还没打卡） ----------
function buildWorkoutCard(input) {
  const o = input || {};
  const count = Number(o.totalCount) || 0;
  const title = o.focus
    ? (count > 0 ? `正在练${o.focus}（${count} 个动作）` : `正在练${o.focus}`)
    : `${APP_NAME}｜今天也要动一下`;
  return { title: clip(title), path: withShare(HOME_PATH, 'workout') };
}

// ---------- 打卡战绩（button open-type="share" 专用） ----------
// 文案优先级：新解锁的徽章 > 连续天数 > 单纯的「练完了」。
// 徽章是唯一带「新鲜感」的信息，读者最容易被它勾住。
function buildCheckinCard(input) {
  const o = input || {};
  const streak = Number(o.streak) || 0;
  const durationMin = Number(o.durationMin) || 0;
  const badge = (o.newBadgeNames && o.newBadgeNames[0]) || '';

  const bits = [];
  if (badge) bits.push(`解锁成就「${badge}」`);
  if (streak > 0) bits.push(`连续打卡 ${streak} 天`);
  if (!bits.length) bits.push(durationMin > 0 ? `刚完成 ${durationMin} 分钟训练` : '刚完成今天的训练');
  else if (durationMin > 0) bits.push(`${durationMin} 分钟`);

  const title = `${joinParts(bits, '，')} 💪`;
  return { title: clip(title), path: withShare(HOME_PATH, 'checkin') };
}

// ---------- 动作（唯一有内容的落地页） ----------
function buildExerciseCard(input) {
  const o = input || {};
  const name = String(o.name || '').trim() || '健身动作';
  const meta = joinParts([o.category, o.equipment && o.equipment !== '徒手' ? o.equipment : ''], ' · ');
  const title = meta ? `${name}｜${meta} 动作要领` : `${name}｜动作要领`;
  const path = o.id
    ? withShare(LIBRARY_PATH, 'exercise') + `&id=${encodeURIComponent(o.id)}`
    : withShare(LIBRARY_PATH, 'exercise');
  return { title: clip(title), path };
}

// ---------- 动作库（没打开具体动作时） ----------
function buildLibraryCard(input) {
  const o = input || {};
  const total = Number(o.total) || 0;
  const title = total > 0
    ? `${APP_NAME}｜${total} 个动作的要点与示范`
    : `${APP_NAME}｜健身动作库`;
  return { title: clip(title), path: withShare(LIBRARY_PATH, 'library') };
}

// ---------- 成就徽章 ----------
function buildBadgeCard(input) {
  const o = input || {};
  const unlocked = Math.max(0, Number(o.unlocked) || 0);
  const total = Math.max(0, Number(o.total) || 0);
  let title;
  if (total > 0) title = `我已解锁 ${unlocked}/${total} 枚成就徽章`;
  else title = `${APP_NAME}｜成就徽章`;
  if (o.nextName) title += `，下一个是「${o.nextName}」`;
  return { title: clip(title), path: withShare(HOME_PATH, 'badges') };
}

// ---------- 数据看板 ----------
function buildStatsCard(input) {
  const o = input || {};
  const totalCheckins = Number(o.totalCheckins) || 0;
  const bestStreak = Number(o.bestStreak) || 0;
  const bits = [];
  if (totalCheckins > 0) bits.push(`累计打卡 ${totalCheckins} 次`);
  if (bestStreak > 0) bits.push(`最长连续 ${bestStreak} 天`);
  const title = bits.length ? joinParts(bits, '，') : `${APP_NAME}｜记录每一次坚持`;
  return { title: clip(title), path: withShare(HOME_PATH, 'stats') };
}

// ---------- 分享到朋友圈 ----------
// 朋友圈只支持 title + query（query 会拼到「当前页面路径」后面），没有 path，
// 所以这里不能换落地页 —— 想分享哪个页面就得在哪个页面里定义 onShareTimeline。
function buildTimeline(input) {
  const o = input || {};
  return {
    title: clip(o.title || `${APP_NAME}｜在家也能坚持的训练打卡`),
    query: `share=${o.tag || 'timeline'}`
  };
}

module.exports = {
  APP_NAME,
  HOME_PATH,
  LIBRARY_PATH,
  MAX_TITLE,
  buildHomeCard,
  buildWorkoutCard,
  buildCheckinCard,
  buildExerciseCard,
  buildLibraryCard,
  buildBadgeCard,
  buildStatsCard,
  buildTimeline,
  _internal: { clip, joinParts, withShare }
};
