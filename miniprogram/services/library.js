// services/library.js — 动作库服务（V0.6）
// 数据源：assets/data/exercises.js（本地种子数据，MVP 阶段不依赖云数据库）
// ⚠️ 小程序不支持 require JSON，动作数据必须走 .js 模块

const source = require('../assets/data/exercises.js');

const ALL = '全部';
const DIFFICULTY_LABELS = { 1: '初级', 2: '中级', 3: '高级' };

function clampLevel(n) {
  const lv = Number(n);
  if (!lv || isNaN(lv)) return 1;
  return Math.min(3, Math.max(1, lv));
}

function padStars(n) {
  const lv = clampLevel(n);
  return '★'.repeat(lv) + '☆'.repeat(3 - lv);
}

// 动作演示图（RepDB 素材 → tools/build-repdb.js 生成的动图/静图，与动作库同分包）
const IMG_BASE = '/packageA/library/images';

// 云存储图片映射（id → fileID）：有映射走 CDN，否则回退包内本地图。
// 用途：图片移出代码包可让 packageA 从 1.2MB 降到 ~30KB，
// 首次进入动作库/切磋分包时不再等待大包下载。
// 生成方式：node tools/upload-images-to-cloud.js（打印映射，粘回这里）
const CLOUD_IMAGES = {};
// 云存储根路径（取自存储控制台 FileID，去掉文件名）
// 例：cloud://xxx.1234-env/ai-coach/library 或 cloud://<env>.<bucket>
const CLOUD_IMG_BASE = ''; // 云存储迁移暂停：云上文件未确认齐全，先用包内本地图
function imgUrl(id, ext) {
  if (CLOUD_IMAGES[id]) return CLOUD_IMAGES[id][ext] || '';
  if (CLOUD_IMG_BASE) return `${CLOUD_IMG_BASE}/${id}.${ext}`;
  return `${IMG_BASE}/${id}.${ext}`;
}

// 素材本身只有单姿势（官方未提供起始/顶峰两帧），拼不出动画 —— 弹层回退静态图
// 波比跳在 RepDB 免费档只有 burpees-main 一张，改素材源时记得同步这份名单
const STATIC_ANIM = ['burpee'];

// 把原始动作数据拍平补全，避免 WXML 深层取值在字段缺失时白屏
function decorate(ex) {
  const raw = ex || {};
  const difficulty = clampLevel(raw.difficulty);
  return {
    id: raw.id || '',
    name: raw.name || '未命名动作',
    category: raw.category || '其他',
    equipment: raw.equipment || '徒手',
    difficulty,
    difficultyLabel: DIFFICULTY_LABELS[difficulty] || '初级',
    difficultyStars: padStars(difficulty),
    tips: raw.tips || '',
    mistakes: raw.mistakes || '',
    alternatives: Array.isArray(raw.alternatives) ? raw.alternatives.slice() : [],
    // anim：循环演示动画 GIF（详情弹层/跟练要点弹层用，素材来自 RepDB 免费档）
    //       单姿势动作在 STATIC_ANIM 里，anim 置空 → 弹层自动回退到 demo 静态图
    // thumb/demo：同动作的静态首帧 JPG（列表缩略图，避免 12 个动图同屏播放）
    anim: raw.id && STATIC_ANIM.indexOf(raw.id) < 0 ? imgUrl(raw.id, 'gif') : '',
    demo: raw.id ? imgUrl(raw.id, 'jpg') : '',
    thumb: raw.id ? imgUrl(raw.id, 'jpg') : ''
  };
}

function allExercises() {
  const list = (source && Array.isArray(source.exercises)) ? source.exercises : [];
  return list.map(decorate);
}

function getCategories() {
  const list = (source && Array.isArray(source.categories)) ? source.categories : [];
  return [ALL].concat(list);
}

// 器械列表从动作数据里去重推导，避免手写维护两处
function getEquipments() {
  const set = [];
  allExercises().forEach((ex) => {
    if (ex.equipment && set.indexOf(ex.equipment) < 0) set.push(ex.equipment);
  });
  return [ALL].concat(set);
}

function matchKeyword(ex, keyword) {
  const kw = String(keyword === undefined || keyword === null ? '' : keyword).trim().toLowerCase();
  if (!kw) return true;
  const hay = `${ex.name} ${ex.category} ${ex.equipment} ${ex.difficultyLabel}`.toLowerCase();
  return hay.indexOf(kw) >= 0;
}

function filterExercises(list, opts) {
  const o = opts || {};
  const src = Array.isArray(list) ? list : [];
  return src.filter((ex) => {
    if (!matchKeyword(ex, o.keyword)) return false;
    if (o.category && o.category !== ALL && ex.category !== o.category) return false;
    if (o.equipment && o.equipment !== ALL && ex.equipment !== o.equipment) return false;
    return true;
  });
}

function listExercises(opts) {
  return filterExercises(allExercises(), opts);
}

function getExerciseById(id) {
  const list = allExercises();
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
}

// id → 动作，供计划/跟练页查动作要点
function buildMap() {
  const map = {};
  allExercises().forEach((ex) => { map[ex.id] = ex; });
  return map;
}

function totalCount() {
  return allExercises().length;
}

module.exports = {
  ALL,
  allExercises,
  getCategories,
  getEquipments,
  listExercises,
  getExerciseById,
  buildMap,
  totalCount,
  _internal: { decorate, filterExercises, matchKeyword, padStars, clampLevel }
};
