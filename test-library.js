/**
 * test-library.js — 动作库服务单测（V0.6）
 * 纯逻辑测试，不需要云环境
 */
const path = require('path');
const library = require(path.join(__dirname, 'miniprogram/services/library.js'));

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

(async function run() {
  console.log('==================== 动作库服务单测 ====================');

  section('1. 基础数据');
  const all = library.allExercises();
  eq('动作总数', all.length, 12);
  ok('每个动作都有 id/名称/部位/器械', all.every((e) => e.id && e.name && e.category && e.equipment));
  ok('每个动作都有要点', all.every((e) => typeof e.tips === 'string' && e.tips.length > 0));
  ok('每个动作都有难度星级且长度为 3', all.every((e) => e.difficultyStars.length === 3));
  ok('难度标签只可能是初级/中级/高级', all.every((e) => ['初级', '中级', '高级'].indexOf(e.difficultyLabel) >= 0));

  section('2. 分类与器械');
  const cats = library.getCategories();
  eq('分类首位是「全部」', cats[0], '全部');
  eq('分类总数（全部 + 6 部位）', cats.length, 7);
  const eqs = library.getEquipments();
  eq('器械首位是「全部」', eqs[0], '全部');
  ok('器械从数据推导（全部 + 徒手/哑铃/健身房）', eqs.length === 4, eqs);

  section('3. 筛选');
  eq('不传条件返回全部', library.listExercises().length, 12);
  eq('部位=胸', library.listExercises({ category: '胸' }).length, 3);
  eq('部位=有氧', library.listExercises({ category: '有氧' }).length, 2);
  eq('器械=徒手', library.listExercises({ equipment: '徒手' }).length, 8);
  eq('器械=哑铃', library.listExercises({ equipment: '哑铃' }).length, 3);
  eq('器械=健身房', library.listExercises({ equipment: '健身房' }).length, 1);
  eq('部位=腿 + 器械=徒手', library.listExercises({ category: '腿', equipment: '徒手' }).length, 2);
  eq('部位=腿 + 器械=哑铃（冲突，应为 0）', library.listExercises({ category: '腿', equipment: '哑铃' }).length, 0);

  section('4. 关键词搜索');
  eq('空关键词返回全部', library.listExercises({ keyword: '' }).length, 12);
  eq('undefined 关键词返回全部', library.listExercises({ keyword: undefined }).length, 12);
  eq('搜「深蹲」命中 1 个', library.listExercises({ keyword: '深蹲' }).length, 1);
  eq('搜「哑铃」命中 3 个', library.listExercises({ keyword: '哑铃' }).length, 3);
  eq('搜「背」命中部位为背的 2 个', library.listExercises({ keyword: '背' }).length, 2);
  eq('搜不存在的词返回 0', library.listExercises({ keyword: 'zzzz' }).length, 0);
  eq('关键词带空格自动 trim', library.listExercises({ keyword: '  深蹲  ' }).length, 1);

  section('5. 查询与映射');
  const squat = library.getExerciseById('squat');
  eq('按 id 查到深蹲', squat && squat.name, '徒手深蹲');
  eq('未知 id 返回 null', library.getExerciseById('not-exist'), null);
  const map = library.buildMap();
  eq('映射表条目数', Object.keys(map).length, 12);
  eq('映射可按 id 取值', map.pushup.name, '标准俯卧撑');
  eq('totalCount', library.totalCount(), 12);

  section('6. 边界与容错');
  const d0 = library._internal.decorate(null);
  eq('decorate(null) 兜底名称', d0.name, '未命名动作');
  eq('decorate(null) 兜底难度', d0.difficulty, 1);
  ok('decorate(null) 兜底替代动作为数组', Array.isArray(d0.alternatives));
  ok('decorate(null) 无示范图路径', d0.demo === '' && d0.thumb === '' && d0.anim === '');
  const dSquat = library._internal.decorate({ id: 'squat', name: '徒手深蹲' });
  ok('静态示范图路径按 id 生成', /\/squat\.jpg$/.test(dSquat.demo));
  ok('列表缩略图路径按 id 生成', /\/squat\.jpg$/.test(dSquat.thumb));
  ok('循环演示动画路径按 id 生成', /\/squat\.gif$/.test(dSquat.anim));
  // 单姿势素材（波比跳）：无动画是预期行为，弹层回退静态图，不能返回一个不存在的文件
  const dBurpee = library._internal.decorate({ id: 'burpee', name: '波比跳' });
  eq('单姿势动作无动画路径', dBurpee.anim, '');
  ok('图片路径为本地包或云存储 CDN', /^(\/packageA\/library\/images|cloud:\/\/)/.test(dSquat.thumb));
  ok('单姿势动作仍有静态图', /\/burpee\.jpg$/.test(dBurpee.demo));
  eq('难度 0 被夹到 1', library._internal.clampLevel(0), 1);
  eq('难度 9 被夹到 3', library._internal.clampLevel(9), 3);
  eq('难度非法值兜底 1', library._internal.clampLevel('abc'), 1);
  eq('星级：初级', library._internal.padStars(1), '★☆☆');
  eq('星级：高级', library._internal.padStars(3), '★★★');
  eq('filterExercises 传 null 不炸', library._internal.filterExercises(null, {}).length, 0);

  section('7. 动作收藏（本地 storage）');
  const fav = require(path.join(__dirname, 'miniprogram/services/favorites.js'));
  fav.clear();
  eq('初始收藏为空', fav.count(), 0);
  ok('初始未收藏', fav.has('squat') === false);

  let r = fav.toggle('squat');
  ok('toggle 收藏', r.favorited === true && r.count === 1);
  ok('收藏后 has 为 true', fav.has('squat') === true);
  r = fav.toggle('squat');
  ok('再次 toggle 取消收藏', r.favorited === false && r.count === 0);

  fav.add('squat');
  fav.add('pushup');
  fav.add('plank');
  eq('连续收藏 3 个', fav.count(), 3);
  eq('最近收藏排最前', fav.list()[0], 'plank');
  ok('list 返回副本（外部改动不影响存储）', (() => {
    const l = fav.list();
    l.push('hacked');
    return fav.count() === 3;
  })());
  ok('重复收藏不重复计数', fav.add('squat').added === false && fav.count() === 3);
  eq('map() 查表（WXML 用）', fav.map().squat, true);
  ok('map() 不含未收藏项', fav.map().burpee === undefined);
  ok('非法 id 不入库', fav.add('').added === false && fav.add(null).added === false &&
    fav.add(123).added === false && fav.count() === 3);
  ok('remove 不存在的 id 无副作用', fav.remove('nope').removed === false && fav.count() === 3);
  ok('remove 生效', fav.remove('squat').removed === true && fav.count() === 2);
  ok('has 对非法入参返回 false', fav.has(null) === false && fav.has('') === false);

  // 脏数据 / 容量兜底
  const norm = fav._internal.normalize;
  eq('normalize 非数组 → 空', norm('abc').length, 0);
  eq('normalize 过滤非法值并去重 trim', JSON.stringify(norm(['a', '', 1, null, 'a', ' b '])), JSON.stringify(['a', 'b']));
  eq('normalize 上限 200', norm(new Array(500).fill(0).map((_, i) => 'id' + i)).length, 200);

  // 与动作库联动（收藏 id 要能查到动作，脏 id 要能过滤掉）
  fav.clear();
  fav.add('squat');
  fav.add('plank');
  eq('收藏 id 均可在动作库查到', fav.list().map((id) => library.getExerciseById(id)).filter(Boolean).length, 2);
  fav.add('ghost-id');
  eq('未知 id 被过滤（列表不出现空白卡片）',
    fav.list().map((id) => library.getExerciseById(id)).filter(Boolean).length, 2);
  fav.clear();
  eq('清空后为 0', fav.count(), 0);

  console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================\n');
  process.exit(fail ? 1 : 0);
})();
