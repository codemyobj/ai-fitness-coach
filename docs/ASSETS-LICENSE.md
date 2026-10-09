# 动作演示素材授权说明

> 最后更新：2026-10-03 ｜ 适用于 `miniprogram/packageA/library/images/` 下全部素材

## 当前素材源：RepDB 免费档（可商用）

| 项 | 内容 |
| --- | --- |
| 来源 | [RepDB/exercise-dataset](https://github.com/RepDB/exercise-dataset)（Hugging Face / npm `@repdb/exercises`） |
| 内容 | 601 个动作，512×512 扁平插画 WebP（每个动作给「起始 / 顶峰」两帧，等长动作单帧） |
| 授权 | **RepDB Free Tier License v1.0** |
| 商用 | ✅ 允许（个人与商业应用内使用，免费） |
| 要求 | ⚠️ **必须在应用内可见署名**："Exercise data by RepDB (repdb.co)" |
| 禁止 | ① 作为数据集二次分发/转售/提供 API；② 用作生成式 AI 的输入、参考或训练材料 |

### 署名已落地的位置

- `miniprogram/pages/mine/mine.wxml` →「素材与数据来源」卡片（我的页，等于 about/credits 页）

> 改动注意：这一块是**许可证强制项**，删掉或修改会失去免费商用授权。

## 历史素材源（已弃用，勿再使用）

| 源 | 问题 |
| --- | --- |
| `hasaneyldrm/exercises-dataset`（1324 个 GIF，媒体 © Gym Visual） | 仓库与版权方声明**仅限教学/非商业**，上架商用需单独购买授权 |
| AI 生成的插画（ImageGen） | 人体姿势错误率过高，用户已否决 |

旧素材备份在 `tools/_backup-gymvisual/`（**在 `tools/` 下，不进小程序包，不会被打包**），仅用于回滚对比。

## 素材是如何变成动图的

RepDB 免费档只给静图，动画是本地合成的：

```
WebP(512²) --sharp 解码--> 240² RGB --洪泛刷白背景--> 起始帧/顶峰帧
        --> 缓动插值 10 步 x2（ping-pong）= 20 帧 --> 联合量化 63 色 --> 差分帧 GIF（20fps 循环）
```

- 重建命令：`NODE_PATH=<managed node workspace>/node_modules node tools/build-repdb.js`
- 下载命令：`node tools/fetch-repdb.js`
- 自检命令：`NODE_PATH=<managed node workspace>/node_modules node tools/verify-repdb.js`
- 动作映射表写在 `tools/fetch-repdb.js` 的 `MAP`（本地 id → RepDB id）

## 单姿势动作（无动画，属预期）

| 动作 | 原因 |
| --- | --- |
| 波比跳 `burpee` | RepDB 只有 `burpees-main` 单帧，无起止两帧，无法合成 |

代码侧通过 `services/library.js` 的 `STATIC_ANIM = ['burpee']` 让 `anim` 置空、弹层自动回退静态图。
**换素材源时记得同步这份名单。**

## 体积

11 个动图 995KB + 12 个静态图 120KB = **1115KB**（分包 packageA 合计约 1194KB，上限 2048KB）。
后续若要扩充动作数量，**必须改走云存储 CDN**，不能继续塞本地包。

## 上线前自查

- [ ] 我的页署名卡片可见（真机打开确认）
- [ ] 未使用 Gym Visual 任何素材（对比 `tools/_backup-gymvisual/` 逐张确认打包目录里没有）
- [ ] 未把 RepDB 图片喂给生成式 AI（许可证第 5 条）
- [ ] 若将来上架付费功能，复查 RepDB 免费档条款是否仍满足（付费档 $299 起可去掉署名）
