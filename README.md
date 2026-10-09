# 轻练打卡健身 · 微信小程序

微信原生小程序 + 云开发实现的个人健身打卡与训练指导工具。不依赖任何前端框架，不引入构建工具链——所有逻辑用纯函数分层，全部检查用 `node xxx.js` 直接跑。

- 页面：2 个主包页面 + 9 个分包页面（分包 `packageA`）
- 逻辑：`services/` 下 14 个零 `wx` 依赖的纯逻辑模块，可离线单测
- 检查：14 套离线测试 + 1 套静态校验（`verify.js`），当前全绿
- 体积：主包 174.7 KB / 分包 1265.6 KB（上限均 2048 KB）

## 功能模块

| 模块 | 说明 |
| --- | --- |
| 建档 | 训练目标 / 经验 / 可用器械 / 每周天数 → 生成周计划（**本地确定性规则编排**，不调用模型） |
| 训练首页 | 今日训练卡、周进度环、连续打卡天数、真实日历周进度条 |
| 训练打卡 | 训练计时、逐动作组数/次数/重量记录、组间休息倒计时、估算消耗 |
| 数据看板 | 打卡热力图、周/月趋势、累计时长与次数 |
| 动作库 | 12 个动作演示（11 个双关键帧合成的循环 GIF + 1 个静态）、按肌群/器械筛选、收藏 |
| 身体记录 | 体重 / 体脂率趋势与备注 |
| 成就徽章 | 13 枚徽章 / 7 个分组，采用高水位判定（统计窗口滑动不会收回已得徽章） |
| 训练提醒 | 订阅消息提醒，云函数定时触发、额度自增与集合自愈 |
| 合规 | 用户协议 + 隐私政策独立页面，版本号驱动重新征得同意，建档流程有勾选闸门 |

## 技术栈与架构

| 层 | 位置 | 约束 |
| --- | --- | --- |
| 数据 | `miniprogram/content/` | 纯数据（如协议正文），零 `wx` 依赖，可被测试直接 `require` |
| 逻辑 | `miniprogram/services/` | 纯函数，不碰 `wx` API；每个模块导出 `_internal` 供单测 |
| 视图 | `miniprogram/pages/`、`packageA/` | 只做 `setData` 与事件绑定，业务判断一律下沉到 services |
| 后端 | `cloudfunctions/` | `login`（换 openid）、`initDb`（建集合 + 种子数据）、`sendReminder`（订阅消息） |

几个刻意的设计决定：

- **单一时钟的进度模型**：周次 = `floor(总打卡数 / 每周天数)`，课次 = `总打卡数 % 每周天数 + 1`。避免「日历周」与「课次」两套计数互相追赶导致跳课。
- **高水位徽章**：累计类指标取 `max(当前, 历史最高)`，并且解锁记录只增不删，所以 365 天滑动统计窗口不会让已有徽章消失。
- **确定性计划编排**：`services/plan.js` 的 `buildPlan()` 对同一份档案必须产出完全一致的结果，`test-review.js` 用「两次编排结果全等」钉住这一点。
- **协议版本驱动**：改正文必须同时升 `LEGAL_VERSION`，否则老用户不会被重新征得同意——测试里也钉了这条。
- **骨架屏**：`components/skeleton` 支持 8 种变体（含 `ring`/`tint`/`tiles`），由区块声明驱动，180ms 内不显示以免闪烁。

## 目录结构

```
miniprogram/
  app.js                     云开发初始化 + 静默登录（⚠️ 需填自己的云环境 ID）
  app.json                   页面 / 分包 / preloadRule / tabBar 注册
  services/                  session stats badges plan library workout rest reminder
                             body favorites legal data units userinfo
  content/legal.js           用户协议 + 隐私政策正文 + 收集清单（单一来源）
  components/skeleton/       骨架屏组件
  packageA/                  onboarding plan workout stats library body reminder legal badges
cloudfunctions/
  login/  initDb/  sendReminder/
  aiCoach/                   已搁置的 AI 对话云函数（保留源码、未部署，见下）
tools/                       素材抓取 / GIF 合成 / 预览页生成脚本
parked-features/             已移除功能的归档 + 还原步骤
docs/                        路线图、发布清单、配置对照表、静态预览页
test-*.js  verify.js         离线检查（node 直接运行）
```

## 本地运行

1. 微信开发者工具 → **导入项目** → 选择本目录（`miniprogramRoot`、`cloudfunctionRoot` 已配好）
2. 开通云开发，把环境 ID 填进 `miniprogram/app.js` 的 `ENV_ID`（当前指向作者自己的环境，跑你自己的数据请替换）
3. 右键 `cloudfunctions/initDb` → **上传并部署**，执行一次创建集合并写入种子数据
4. `cloudfunctions/sendReminder` 需另行配置订阅消息模板 ID 与定时触发器，见 `docs/REMINDER-SETUP.md`
5. 开发期在「详情 → 本地设置」勾选「不校验合法域名」

> AppID 写在 `project.config.json`（个人主体小程序）。换成自己的项目时记得同时改 AppID 与环境 ID。

## 跑测试

```bash
node verify.js            # 静态校验：WXML 字段/空安全、WXSS 变量、图片引用、体积
node test-session.js      # 单套；同名的 test-*.js 共 14 套
```

测试不需要安装依赖，`__mock_wx_server_sdk__.js` 是为云函数模块做的一个极简 stub。几套值得一提的：

- `test-review.js` —— 静态合规断言。用功能性测试抓不到的东西（页面注册表里不能再有教练页、用户可见文本里不能再出现 AI 宣称、同档案两次编排结果必须全等）
- `test-stats.js` —— 断言徽章功能**没有新增任何云查询**（复用 `listLogs(365)` 缓存）
- `test-pages.js` —— 用 wx mock 跑完所有页面生命周期，含跳转 URL 精确断言
- `test-badges.js` / `test-legal.js` / `test-session.js` —— 各自领域的边界与回归用例

## 第三方素材与许可

动作演示图来自 [RepDB/exercise-dataset](https://github.com/RepDB/exercise-dataset)（**RepDB Free Tier License v1.0**）：允许 App 内使用，要求在应用内可见署名，且**禁止将素材作为数据集二次分发**。

因此本仓库**不包含** `tools/raw`、`tools/dataset`、`tools/repdb`、`tools/exercises-full.json` 等素材数据，也不包含已弃用的 Gym Visual 备份（该源明确仅限教学/非商用）。App 运行所需的图片在 `miniprogram/packageA/library/images/`，如需从零重建：

```bash
node tools/fetch-repdb.js     # 拉取数据（需网络与 Node）
node tools/build-repdb.js     # 合成循环 GIF
```

许可细节与上线自查清单见 [`docs/ASSETS-LICENSE.md`](docs/ASSETS-LICENSE.md)。

## 为什么仓库里没有 AI 对话功能

V1.0.1 提审因「深度合成技术（AI 问答）」被驳回——该类目在个人主体下不可申请。处置方式是把前端 AI 模块整体移入 `parked-features/`，训练计划改由确定性规则编排生成，协议正文同步升到 v1.1 并删除对应收集项；云函数 `aiCoach` 保留源码但未部署，便于将来主体升级后恢复。

完整原因、处置清单与还原步骤见 [`docs/REVIEW-AI-REMOVAL.md`](docs/REVIEW-AI-REMOVAL.md) 与 [`parked-features/README.md`](parked-features/README.md)。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | 版本路线图与已完成项 |
| [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md) | 提审前逐项自检（含平台侧配置） |
| [`docs/LEGAL-SETUP.md`](docs/LEGAL-SETUP.md) | 隐私保护指引在后台怎么填，与代码收集清单的对照表 |
| [`docs/REMINDER-SETUP.md`](docs/REMINDER-SETUP.md) | 训练提醒：模板 ID、云函数环境变量、定时触发器 |
| [`docs/DATABASE-SETUP.md`](docs/DATABASE-SETUP.md) | 云数据库集合、索引与权限 |
| [`docs/ASSETS-LICENSE.md`](docs/ASSETS-LICENSE.md) | 素材授权、合成流程、体积预算 |
| [`docs/REVIEW-AI-REMOVAL.md`](docs/REVIEW-AI-REMOVAL.md) | 驳回原因与整改记录 |
| `docs/preview-*.html` | 各页面的静态视觉预览（由真实源码生成，脚本见 `tools/gen-*-preview.js`） |
