# parked-features — 封存的 AI 功能（未上线）

> 封存时间：2026-10-08
> 原因：提审驳回，驳回原文见 `docs/REVIEW-AI-REMOVAL.md`
> **这些文件不在小程序包内（已移出 `miniprogram/` 根目录），不会被上传，也不参与 `verify.js` 校验。**

## 为什么要封存

微信审核判定：「小程序服务内容涉及深度合成技术（如：AI 问答、AI 换脸视频、AI 绘画等），
属个人主体尚未开放服务类目」——**个人主体无法开通该服务类目**，与代码质量无关，申诉无用。

因此 V1.0.1 提审版本改为**纯工具型健身小程序**：档案 → 规则编排计划 → 跟练打卡 → 数据统计。
计划生成走 `miniprogram/services/plan.js` 的 `buildFallbackPlan()`（本地规则，非 AI，不涉及深度合成）。

## 封存清单

| 原路径 | 现路径 | 说明 |
|---|---|---|
| `miniprogram/pages/coach/` | `pages-coach/` | 「教练」tab：AI 对话页（四件套齐全） |
| `miniprogram/services/ai.js` | `services/ai.js` | 前端封装：`chat()` / `generatePlan()` |
| `miniprogram/utils/markdown.js` | `utils/markdown.js` | Markdown → rich-text nodes（仅对话页使用） |
| `miniprogram/assets/icons/coach.png`、`coach-active.png` | `icons/` | tabBar 图标 |

`cloudfunctions/aiCoach/` **保留在原位**（云函数不参与小程序包上传，审核不可见），
其单元测试 `test-cloud.js` 也保留，逻辑随时可用。

## 恢复步骤（升级为企业主体、开通深度合成类目后再做）

1. 移回文件：

   ```bash
   cp -r parked-features/pages-coach miniprogram/pages/coach
   cp parked-features/services/ai.js miniprogram/services/ai.js
   cp parked-features/utils/markdown.js miniprogram/utils/markdown.js
   cp parked-features/icons/coach*.png miniprogram/assets/icons/
   ```

2. `miniprogram/app.json`：
   - `pages` 数组加回 `"pages/coach/coach"`
   - `tabBar.list` 在「训练」与「我的」之间加回：

     ```json
     { "pagePath": "pages/coach/coach", "text": "教练",
       "iconPath": "assets/icons/coach.png",
       "selectedIconPath": "assets/icons/coach-active.png" }
     ```

3. `miniprogram/sitemap.json`：加回 `{ "action": "allow", "page": "pages/coach/coach" }`

4. `miniprogram/services/plan.js`：`createPlanLocal()` 的 `source` 仍是 `'local-fallback'`，
   AI 路径由 `services/ai.js#generatePlan()` 走 `aiCoach` 云函数，恢复 `training.js` 里的调用即可。

5. `miniprogram/content/legal.js`：把「AI 教练对话内容」收集项、第五节「AI 生成内容的性质」
   加回，并**再次升 `LEGAL_VERSION`**（用户需重新同意）。

6. `docs/LEGAL-SETUP.md`：在后台《用户隐私保护指引》里补回对话内容一项。

7. 恢复后跑一遍 `test-cloud.js` 与「还原清单」中的静态断言（`test-pages.js` 里那条
   「包内不得出现 AI 生成内容宣称」会立刻失败，正好提醒你别漏改文案）。

## 硬前提：企业主体

深度合成类目要求**非个人主体**，且通常需要提供算法备案等资质。
升级路径：注册个体工商户 / 公司 → 小程序主体变更或重新注册 → 申请类目 → 恢复本目录内容。
