/**
 * test-share.js — 分享卡片文案单测（V1.0.4）
 *
 * 为什么值得单独测：分享文案是「用户没打开小程序时唯一看到的东西」，
 * 而且它散在 5 个页面的 onShareAppMessage 里、没人会天天点开核对。
 * 抽成纯函数之后，这里能把三条产品约定钉死：
 *   ① 标题不超长（微信会截断，超了就会出现半个词）
 *   ② 除动作卡外统一落地首页（陌生用户点进来不能是空的徽章墙/看板）
 *   ③ 空数据不许崩、不许产出「undefined」这种脏文案
 * 纯逻辑测试，不需要云环境。
 */
const path = require('path');
const share = require(path.join(__dirname, 'miniprogram/utils/share.js'));

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

// 所有「卡片生成函数」——用来跑通用约束，新增卡片只要加进这个表就会被自动体检
const CARD_BUILDERS = [
  ['首页', share.buildHomeCard, { hasPlan: true, focus: '胸 + 三头', dayNumber: 3, streak: 5, todayChecked: true }],
  ['跟练卡', share.buildWorkoutCard, { focus: '腿', dayNumber: 2, totalCount: 5 }],
  ['战绩卡', share.buildCheckinCard, { focus: '背', durationMin: 42, streak: 12, newBadgeNames: ['坚持一周'] }],
  ['动作卡', share.buildExerciseCard, { id: 'pushup', name: '标准俯卧撑', category: '胸', equipment: '徒手' }],
  ['动作库卡', share.buildLibraryCard, { total: 12 }],
  ['徽章卡', share.buildBadgeCard, { unlocked: 7, total: 13, nextName: '坚持一月' }],
  ['看板卡', share.buildStatsCard, { totalCheckins: 30, bestStreak: 14 }]
];

(async function run() {
  console.log('==================== 分享卡片文案单测 ====================');

  section('1. 工具函数');
  const { clip, joinParts, withShare } = share._internal;
  eq('clip：空串 → 空', clip(''), '');
  eq('clip：null → 空（不能出现 undefined）', clip(null), '');
  eq('clip：undefined → 空', clip(undefined), '');
  eq('clip：首尾空格被 trim', clip('  打卡  '), '打卡');
  eq('clip：不超长时原样返回', clip('连续打卡 7 天'), '连续打卡 7 天');
  eq('clip：超长按字符截断并补省略号', clip('一'.repeat(40)).length, share.MAX_TITLE);
  ok('clip：截断后以省略号结尾', clip('一'.repeat(40)).slice(-1) === '…');
  eq('clip：可指定更短上限', clip('一二三四五', 3), '一二…');

  eq('joinParts：过滤空串，不产生双分隔', joinParts(['胸', '', null, '哑铃'], ' · '), '胸 · 哑铃');
  eq('joinParts：全空 → 空串', joinParts([null, '', undefined], ' · '), '');
  eq('joinParts：空入参不崩', joinParts(null, ' · '), '');
  eq('withShare：无 query 用 ?', withShare('/pages/training/training', 'home'), '/pages/training/training?share=home');
  eq('withShare：已有 query 用 &', withShare('/packageA/library/library?fav=1', 'library'), '/packageA/library/library?fav=1&share=library');

  section('2. 首页卡：三种分支');
  const checked = share.buildHomeCard({ hasPlan: true, focus: '胸', dayNumber: 2, streak: 5, todayChecked: true });
  eq('已打卡且连续 > 0 → 讲成果', checked.title.includes('连续打卡 5 天'), true);
  const planned = share.buildHomeCard({ hasPlan: true, focus: '胸 + 三头', dayNumber: 3, streak: 0, todayChecked: false });
  eq('有计划 → 讲今天练什么', planned.title, '今天练胸 + 三头，第 3 节');
  const bare = share.buildHomeCard({});
  ok('什么都没有 → 退回品牌口号（不含 undefined）', bare.title.indexOf('undefined') < 0, bare.title);
  // 已打卡但连续为 0（脏数据）不应输出「连续打卡 0 天」
  const odd = share.buildHomeCard({ hasPlan: false, streak: 0, todayChecked: true });
  ok('已打卡但连续为 0 → 不出现「连续打卡 0 天」', odd.title.indexOf('连续打卡') < 0, odd.title);

  section('3. 打卡战绩卡：优先级');
  const t1 = share.buildCheckinCard({ durationMin: 42, streak: 12, newBadgeNames: ['初次打卡'] });
  ok('新徽章优先于连续天数出现在句首', t1.title.indexOf('解锁成就「初次打卡」') === 0, t1.title);
  ok('徽章 + 连续 + 时长都在同一句里', t1.title.includes('连续打卡 12 天') && t1.title.includes('42 分钟'), t1.title);
  const t2 = share.buildCheckinCard({ durationMin: 30, streak: 3, newBadgeNames: [] });
  ok('没有新徽章 → 讲连续天数', t2.title.indexOf('连续打卡 3 天') === 0, t2.title);
  const t3 = share.buildCheckinCard({ durationMin: 30, streak: 0, newBadgeNames: [] });
  ok('都没有 → 讲「刚完成 N 分钟训练」', t3.title.indexOf('刚完成 30 分钟训练') === 0, t3.title);
  const t4 = share.buildCheckinCard({});
  ok('全空 → 兜底文案，不崩', t4.title.length > 0 && t4.title.indexOf('undefined') < 0, t4.title);
  ok('战绩卡标题不超长（多枚新徽章时也不溢出）',
    share.buildCheckinCard({ durationMin: 90, streak: 100, newBadgeNames: ['坚持一年不间断'] }).title.length <= share.MAX_TITLE);

  section('4. 动作卡：唯一非首页落地');
  const ex = share.buildExerciseCard({ id: 'pushup', name: '标准俯卧撑', category: '胸', equipment: '徒手' });
  eq('标题带部位但不带「徒手」', ex.title, '标准俯卧撑｜胸 动作要领');
  const ex2 = share.buildExerciseCard({ id: 'db_row', name: '哑铃划船', category: '背', equipment: '哑铃' });
  ok('非徒手动作标题带器械', ex2.title.includes('哑铃'), ex2.title);
  ok('落地页指向动作库', ex.path.indexOf('/packageA/library/library') === 0, ex.path);
  ok('落地页带上动作 id', ex.path.includes('id=pushup'), ex.path);
  const ex3 = share.buildExerciseCard({ id: '动作 1', name: '测试' });
  ok('id 做 URL 编码（中文/空格不破坏 query）', ex3.path.includes('id=%E5%8A%A8%E4%BD%9C%201'), ex3.path);
  const ex4 = share.buildExerciseCard({ name: '无 id 动作' });
  ok('没有 id 时不产出空 id 参数', ex4.path.indexOf('id=') < 0, ex4.path);
  const ex5 = share.buildExerciseCard({});
  ok('全空 → 有兜底名字且不崩', ex5.title.indexOf('undefined') < 0 && ex5.title.length > 0, ex5.title);

  section('5. 动作库 / 徽章 / 看板卡');
  eq('动作库卡带总数', share.buildLibraryCard({ total: 12 }).title, '轻练打卡健身｜12 个动作的要点与示范');
  ok('动作库卡总数缺失时不出现 NaN/0 个动作',
    share.buildLibraryCard({}).title.indexOf('0 个动作') < 0, share.buildLibraryCard({}).title);
  const bg = share.buildBadgeCard({ unlocked: 7, total: 13, nextName: '坚持一月' });
  ok('徽章卡带进度与下一个目标', bg.title.includes('7/13') && bg.title.includes('坚持一月'), bg.title);
  const bg2 = share.buildBadgeCard({ unlocked: 7, total: 13 });
  ok('没有下一枚时不拼接空引号', bg2.title.indexOf('「」') < 0, bg2.title);
  const st = share.buildStatsCard({ totalCheckins: 30, bestStreak: 14 });
  eq('看板卡讲累计与最长连续', st.title, '累计打卡 30 次，最长连续 14 天');
  ok('看板卡空数据走兜底', share.buildStatsCard({}).title.indexOf('undefined') < 0, share.buildStatsCard({}).title);
  ok('看板卡用「最长连续」而不是「当前连续」（断卡后会归零）', share.buildStatsCard({ totalCheckins: 1, streak: 0, bestStreak: 9 }).title.indexOf('9') > 0);

  section('6. 通用约定（新增卡片会被自动纳入）');
  ok('卡片生成函数注册表非空', CARD_BUILDERS.length >= 7, CARD_BUILDERS.length);
  CARD_BUILDERS.forEach(([name, fn, input]) => {
    const card = fn(input);
    ok(`${name}：标题不超长（≤ ${share.MAX_TITLE}）`, typeof card.title === 'string' && card.title.length > 0 && card.title.length <= share.MAX_TITLE, card.title);
    ok(`${name}：标题干净（不含 undefined/null/NaN）`, !/undefined|null|NaN/.test(card.title), card.title);
    ok(`${name}：path 以 / 开头`, card.path.indexOf('/') === 0, card.path);
    ok(`${name}：path 带 share 来源标记`, card.path.includes('share='), card.path);
  });
  // 产品约定：只有动作相关内容（动作卡 / 动作库卡）能离开首页 —— 其余卡片落到徽章墙/看板时，
  // 新用户看到的是 0/13 和空图表，那是劝退而不是拉新
  CARD_BUILDERS.forEach(([name, fn, input]) => {
    const card = fn(input);
    const isExercise = name === '动作卡' || name === '动作库卡';
    ok(`${name}：落地页${isExercise ? '为动作库' : '为首页（陌生用户友好）'}`,
      isExercise ? card.path.indexOf(share.LIBRARY_PATH) === 0 : card.path.indexOf(share.HOME_PATH) === 0,
      card.path);
  });
  // 反过来钉死：动作卡 / 动作库卡之外，任何卡片都不许落到分包页
  CARD_BUILDERS.forEach(([name, fn, input]) => {
    if (name === '动作卡' || name === '动作库卡') return;
    ok(`${name}：不落到分包页（分包未下载时分享链接会白屏）`,
      fn(input).path.indexOf(share.HOME_PATH) === 0, fn(input).path);
  });
  // 空入参整体扫一遍：任何一个卡片生成函数都不能抛
  CARD_BUILDERS.forEach(([name, fn]) => {
    let threw = '';
    try { fn(); } catch (e) { threw = e.message; }
    ok(`${name}：无入参不抛错`, threw === '', threw);
  });

  section('7. 朋友圈分享');
  const tl = share.buildTimeline({ title: '今天练背', tag: 'workout' });
  eq('朋友圈标题透传', tl.title, '今天练背');
  eq('朋友圈只带 query（路径取当前页，不能换页）', tl.query, 'share=workout');
  ok('朋友圈空标题走兜底', share.buildTimeline({}).title.length > 0 && !/undefined/.test(share.buildTimeline({}).title));
  ok('朋友圈 query 有默认值', share.buildTimeline({}).query === 'share=timeline');

  console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================\n');
  process.exit(fail ? 1 : 0);
})();
