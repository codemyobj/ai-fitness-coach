// assets/data/exercises.js — 动作库种子数据
// ⚠️ 注意：微信小程序不支持 require() JSON 文件（解析器只认 .js，会去找 xxx.json.js 然后
//    报 "module is not defined" 并白屏），所以数据必须用 JS 模块导出，不能用 .json 文件。
// 数据结构：{ version, note, categories, exercises[] }

module.exports = {
  version: '0.1',
  note: '动作库种子数据：MVP 阶段本地维护，V0.3 后迁移至云数据库 exercises 集合',
  categories: ['胸', '背', '腿', '肩', '核心', '有氧'],
  exercises: [
    {
      id: 'pushup',
      name: '标准俯卧撑',
      category: '胸',
      equipment: '徒手',
      difficulty: 1,
      tips: '核心收紧，身体成一条直线，下落至胸口离地一拳',
      mistakes: '塌腰、耸肩、幅度不足',
      alternatives: ['跪姿俯卧撑', '上斜俯卧撑']
    },
    {
      id: 'knee_pushup',
      name: '跪姿俯卧撑',
      category: '胸',
      equipment: '徒手',
      difficulty: 1,
      tips: '膝盖着地降低难度，其余要领同标准俯卧撑',
      mistakes: '塌腰、颈部前伸',
      alternatives: ['上斜俯卧撑']
    },
    {
      id: 'dumbbell_bench_press',
      name: '哑铃卧推',
      category: '胸',
      equipment: '哑铃',
      difficulty: 2,
      tips: '肩胛后缩下沉，小臂始终垂直地面',
      mistakes: '肩部前引、下放过快',
      alternatives: ['俯卧撑']
    },
    {
      id: 'pullup',
      name: '引体向上',
      category: '背',
      equipment: '健身房',
      difficulty: 3,
      tips: '肩胛先下沉再拉起，下巴过杠即可，控制下落',
      mistakes: '借力摆荡、耸肩',
      alternatives: ['弹力带辅助引体', '哑铃划船']
    },
    {
      id: 'dumbbell_row',
      name: '哑铃单臂划船',
      category: '背',
      equipment: '哑铃',
      difficulty: 2,
      tips: '背部发力带动手臂，肘贴身拉向髋部',
      mistakes: '用手臂硬拉、躯干旋转',
      alternatives: ['弹力带划船']
    },
    {
      id: 'squat',
      name: '徒手深蹲',
      category: '腿',
      equipment: '徒手',
      difficulty: 1,
      tips: '膝盖与脚尖方向一致，臀部向后坐，全程脚跟不离地',
      mistakes: '膝盖内扣、弯腰',
      alternatives: ['箱式深蹲']
    },
    {
      id: 'lunge',
      name: '箭步蹲',
      category: '腿',
      equipment: '徒手',
      difficulty: 2,
      tips: '前腿膝盖不超过脚尖过多，躯干保持直立',
      mistakes: '重心不稳、步幅过小',
      alternatives: ['保加利亚分腿蹲']
    },
    {
      id: 'dumbbell_shoulder_press',
      name: '哑铃肩推',
      category: '肩',
      equipment: '哑铃',
      difficulty: 2,
      tips: '肋骨下压避免腰椎代偿，推起时哑铃轨迹略向中间收',
      mistakes: '过度弓腰、推过头后',
      alternatives: ['俯身YTW']
    },
    {
      id: 'plank',
      name: '平板支撑',
      category: '核心',
      equipment: '徒手',
      difficulty: 1,
      tips: '肘在肩正下方，收腹夹臀，身体一条直线',
      mistakes: '塌腰、撅臀、憋气',
      alternatives: ['跪姿平板']
    },
    {
      id: 'dead_bug',
      name: '死虫式',
      category: '核心',
      equipment: '徒手',
      difficulty: 1,
      tips: '腰部全程贴地，对侧手脚同时伸展',
      mistakes: '腰部离地、动作过快',
      alternatives: ['鸟狗式']
    },
    {
      id: 'jumping_jack',
      name: '开合跳',
      category: '有氧',
      equipment: '徒手',
      difficulty: 1,
      tips: '落地屈膝缓冲，保持节奏呼吸',
      mistakes: '落地僵直、塌腰',
      alternatives: ['原地小步跑']
    },
    {
      id: 'burpee',
      name: '波比跳',
      category: '有氧',
      equipment: '徒手',
      difficulty: 3,
      tips: '俯撑-收腿-纵跳连贯完成，量力而行控制心率',
      mistakes: '塌腰俯撑、落地过重',
      alternatives: ['开合跳']
    }
  ]
};
