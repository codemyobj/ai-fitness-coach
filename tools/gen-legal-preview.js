/**
 * tools/gen-legal-preview.js — 从真实正文生成协议页视觉预览
 *
 * 为什么用脚本生成而不是手写 HTML：
 *   协议正文改动频繁（每次改都要重走提审对照），手写预览一定会和 content/legal.js 漂移，
 *   预览就会从「验收依据」退化成「另一份过期文案」。这里直接 require 真实模块，
 *   正文/版本号/生效日期/收集清单全部来自单一来源。
 *
 * 用法：node tools/gen-legal-preview.js
 * 输出：docs/preview-legal.html
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const content = require(path.join(ROOT, 'miniprogram/content/legal.js'));

const OUT = path.join(ROOT, 'docs/preview-legal.html');

// rpx → px（1rpx = 0.5px，375 宽模拟 iPhone）
const px = (rpx) => `${Number(rpx) / 2}px`;
const esc = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

/** 渲染一份文档的正文（与 legal.wxml 结构一一对应） */
function renderDoc(doc) {
  const sections = doc.sections.map((sec) => {
    const ps = (sec.ps || []).map((p) => `<div class="sec-p">${esc(p)}</div>`).join('');
    let table = '';
    if (sec.table) {
      table = '<div class="tbl">' + content.DATA_ITEMS.map((it) => `
        <div class="tbl-row">
          <div class="tbl-top">
            <span class="tbl-name">${esc(it.name)}</span>
            <span class="tbl-tag ${it.required ? 'req' : 'opt'}">${it.required ? '必需' : '可选'}</span>
          </div>
          <div class="tbl-line"><span class="tbl-k">内容</span><span class="tbl-v">${esc(it.detail)}</span></div>
          <div class="tbl-line"><span class="tbl-k">用途</span><span class="tbl-v">${esc(it.purpose)}</span></div>
        </div>`).join('') + '</div>';
    }
    return `<div class="sec-card"><div class="sec-h">${esc(sec.h)}</div>${ps}${table}</div>`;
  }).join('');

  return `
    <div class="doc-head">
      <div class="doc-title">${esc(doc.title)}</div>
      <div class="doc-meta">版本 ${content.LEGAL_VERSION} · 生效日期 ${content.EFFECTIVE_DATE} · 更新于 ${content.UPDATED_DATE}</div>
      <div class="doc-summary">${esc(doc.summary)}</div>
    </div>
    <div class="doc-tabs">
      ${content.docTabs().map((t) => `<div class="doc-tab ${t.type === doc.type ? 'active' : ''}">${esc(t.label)}</div>`).join('')}
    </div>
    ${sections}
    <div class="doc-foot">
      <div class="foot-line">${esc(doc.title)} ${content.LEGAL_VERSION}</div>
      <div class="foot-line">生效日期 ${content.EFFECTIVE_DATE} · 更新于 ${content.UPDATED_DATE}</div>
    </div>`;
}

/** 建档页底部的同意条（未勾选 / 已勾选 两态） */
function renderAgreeBar(checked, shake) {
  return `
    <div class="btn-area">
      <div class="agree-row ${shake ? 'shake' : ''}">
        <div class="agree-box ${checked ? 'checked' : ''}">${checked ? '<span class="agree-tick">✓</span>' : ''}</div>
        <div class="agree-text">我已阅读并同意
          <span class="agree-link">《用户协议》</span>和<span class="agree-link">《隐私政策》</span>
        </div>
      </div>
      <div class="btn-row">
        <div class="btn-ghost back">上一步</div>
        <div class="btn-primary next">完成建档</div>
      </div>
    </div>`;
}

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>用户协议与隐私政策 · 视觉预览</title>
<style>
  /* 本文件由 tools/gen-legal-preview.js 生成，请勿手改 —— 改 content/legal.js 后重跑脚本 */
  :root {
    --color-primary: #10b981;
    --color-primary-dark: #059669;
    --color-accent: #f59e0b;
    --color-text: #1f2937;
    --color-text-secondary: #6b7280;
    --color-text-light: #9ca3af;
    --color-bg: #f5f6f8;
    --color-card: #ffffff;
    --color-border: #e5e7eb;
    --radius-base: 6px;
    --radius-lg: 10px;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: #eceef1; padding: 28px 16px 60px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', sans-serif;
    color: var(--color-text); }
  h1.pagetitle { text-align: center; font-size: 18px; margin: 0 0 6px; }
  .pagesub { text-align: center; font-size: 12px; color: #6b7280; margin-bottom: 26px; }
  .wrap { display: flex; flex-wrap: wrap; gap: 26px; justify-content: center; align-items: flex-start; }
  .phone { width: 375px; background: var(--color-bg); border-radius: 22px; overflow: hidden;
    box-shadow: 0 10px 32px rgba(0,0,0,.14); position: relative; flex: 0 0 auto; }
  .statusbar { height: 20px; background: #111827; }
  .navbar { height: 40px; background: #111827; color: #fff; display: flex; align-items: center;
    justify-content: center; font-size: 15px; font-weight: 600; }
  .screen { height: 640px; overflow: hidden; position: relative; }
  .screen.scroll { overflow-y: auto; }
  .cap { text-align: center; font-size: 12px; color: #6b7280; margin-top: 10px; max-width: 375px; }

  /* ---------- 协议页 ---------- */
  .page { min-height: 100%; padding: ${px(24)} 0 ${px(80)}; }
  .doc-head { padding: ${px(8)} ${px(32)} ${px(24)}; }
  .doc-title { font-size: ${px(40)}; font-weight: 700; line-height: 1.3; }
  .doc-meta { margin-top: ${px(12)}; font-size: ${px(24)}; color: var(--color-text-light); }
  .doc-summary { margin-top: ${px(20)}; font-size: ${px(24)}; color: var(--color-text-secondary); line-height: 1.7; }
  .doc-tabs { display: flex; margin: 0 ${px(32)} ${px(24)}; background: #e9ebef;
    border-radius: var(--radius-base); padding: ${px(6)}; }
  .doc-tab { flex: 1; text-align: center; font-size: ${px(28)}; color: var(--color-text-secondary);
    padding: ${px(14)} 0; border-radius: 4px; }
  .doc-tab.active { background: var(--color-card); color: var(--color-primary-dark); font-weight: 600;
    box-shadow: 0 ${px(2)} ${px(8)} rgba(0,0,0,.06); }
  .sec-card { background: #fff; border-radius: var(--radius-lg); margin: 0 ${px(32)} ${px(24)};
    padding: ${px(28)} ${px(32)}; box-shadow: 0 ${px(2)} ${px(12)} rgba(0,0,0,.04); }
  .sec-h { font-size: ${px(28)}; font-weight: 600; margin-bottom: ${px(16)}; }
  .sec-p { font-size: ${px(24)}; color: var(--color-text-secondary); line-height: 1.8; margin-bottom: ${px(12)}; }
  .sec-p:last-child { margin-bottom: 0; }
  .tbl { margin-top: ${px(20)}; border-top: 1px solid var(--color-border); }
  .tbl-row { padding: ${px(20)} 0; border-bottom: 1px solid var(--color-border); }
  .tbl-row:last-child { border-bottom: none; padding-bottom: 0; }
  .tbl-top { display: flex; align-items: center; margin-bottom: ${px(10)}; }
  .tbl-name { flex: 1; font-size: ${px(28)}; font-weight: 600; }
  .tbl-tag { font-size: ${px(20)}; padding: ${px(2)} ${px(12)}; border-radius: 999px; margin-left: ${px(12)}; }
  .tbl-tag.req { color: #b91c1c; background: #fee2e2; }
  .tbl-tag.opt { color: var(--color-text-secondary); background: #f3f4f6; }
  .tbl-line { display: flex; font-size: ${px(24)}; line-height: 1.7; margin-top: ${px(6)}; }
  .tbl-k { width: ${px(76)}; flex-shrink: 0; color: var(--color-text-light); }
  .tbl-v { flex: 1; color: var(--color-text-secondary); }
  .doc-foot { padding: ${px(16)} ${px(32)} 0; text-align: center; }
  .foot-line { font-size: ${px(24)}; color: var(--color-text-light); line-height: ${px(40)}; }
  .agree-bar { position: absolute; left: 0; right: 0; bottom: 0; padding: ${px(20)} ${px(32)};
    background: #fff; border-top: 1px solid var(--color-border); box-shadow: 0 -${px(2)} ${px(16)} rgba(0,0,0,.05); }
  .agree-tip { text-align: center; font-size: ${px(24)}; color: var(--color-primary-dark); margin-bottom: ${px(12)}; }
  .btn-primary { background: var(--color-primary); color: #fff; text-align: center; font-size: ${px(30)};
    font-weight: 600; padding: ${px(24)} 0; border-radius: var(--radius-base); }

  /* ---------- 建档页底部同意条 ---------- */
  .onboard-body { padding: ${px(40)} ${px(32)} 0; }
  .step-title { font-size: ${px(36)}; font-weight: 700; }
  .step-sub { font-size: ${px(24)}; color: var(--color-text-secondary); margin-top: ${px(10)}; }
  .day-grid { display: flex; flex-wrap: wrap; gap: ${px(20)}; margin-top: ${px(32)}; }
  .day-option { width: ${px(140)}; height: ${px(96)}; border-radius: var(--radius-base);
    border: 1px solid var(--color-border); background: #fff; display: flex; align-items: center;
    justify-content: center; font-size: ${px(30)}; font-weight: 600; }
  .day-option.selected { border-color: var(--color-primary); background: #ecfdf5; color: var(--color-primary-dark); }
  .day-unit { font-size: ${px(22)}; margin-left: 2px; font-weight: 400; }
  .btn-area { position: absolute; left: 0; right: 0; bottom: 0; padding: ${px(40)} ${px(32)};
    background: #fff; border-top: 1px solid var(--color-border); }
  .agree-row { display: flex; align-items: flex-start; margin-bottom: ${px(32)}; }
  .agree-row.shake { animation: agree-shake .45s ease-in-out; }
  @keyframes agree-shake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-5px); }
    40% { transform: translateX(5px); }
    60% { transform: translateX(-3px); }
    80% { transform: translateX(3px); }
  }
  .agree-box { width: ${px(36)}; height: ${px(36)}; flex-shrink: 0; margin: ${px(2)} ${px(16)} 0 0;
    border: 1px solid var(--color-border); border-radius: 4px; background: #fff;
    display: flex; align-items: center; justify-content: center; }
  .agree-box.checked { background: var(--color-primary); border-color: var(--color-primary); }
  .agree-tick { color: #fff; font-size: ${px(24)}; font-weight: 700; line-height: 1; }
  .agree-text { flex: 1; font-size: ${px(24)}; color: var(--color-text-secondary); line-height: 1.6; }
  .agree-link { color: var(--color-primary-dark); }
  .btn-row { display: flex; gap: ${px(24)}; }
  .btn-ghost { border: 1px solid var(--color-border); color: var(--color-text-secondary); text-align: center;
    font-size: ${px(30)}; padding: ${px(24)} 0; border-radius: var(--radius-base); background: #fff; }
  .btn-ghost.back { width: ${px(200)}; }
  .btn-primary.next { flex: 1; }
  .toast { position: absolute; left: 50%; top: 46%; transform: translate(-50%, -50%);
    background: rgba(0,0,0,.78); color: #fff; font-size: 13px; padding: 12px 18px; border-radius: 8px;
    max-width: 260px; text-align: center; line-height: 1.5; }
  .state-tag { position: absolute; top: 8px; right: 10px; background: rgba(0,0,0,.6); color: #fff;
    font-size: 11px; padding: 3px 9px; border-radius: 999px; }
  .stat { display: flex; justify-content: center; gap: 18px; font-size: 12px; color: #6b7280;
    margin-bottom: 22px; flex-wrap: wrap; }
  .stat b { color: #10b981; }
</style>
</head>
<body>
  <h1 class="pagetitle">用户协议与隐私政策 · 视觉预览</h1>
  <div class="pagesub">由 tools/gen-legal-preview.js 从 content/legal.js 真实正文生成 · ${content.LEGAL_VERSION} · 生效 ${content.EFFECTIVE_DATE}</div>
  <div class="stat">
    <span>用户协议 <b>${content.AGREEMENT.sections.length}</b> 节</span>
    <span>隐私政策 <b>${content.PRIVACY.sections.length}</b> 节</span>
    <span>收集清单 <b>${content.DATA_ITEMS.length}</b> 项（必需 ${content.DATA_ITEMS.filter((d) => d.required).length}）</span>
  </div>

  <div class="wrap">
    <div>
      <div class="phone">
        <div class="statusbar"></div>
        <div class="navbar">用户协议</div>
        <div class="screen scroll"><div class="page">${renderDoc(content.AGREEMENT)}</div></div>
      </div>
      <div class="cap">① 用户协议：标题 + 版本/生效日期 + 两份文档切换标签 + 分节正文（可滚动查看全部 ${content.AGREEMENT.sections.length} 节）</div>
    </div>

    <div>
      <div class="phone">
        <div class="statusbar"></div>
        <div class="navbar">隐私政策</div>
        <div class="screen scroll"><div class="page">${renderDoc(content.PRIVACY)}</div></div>
      </div>
      <div class="cap">② 隐私政策：第二节内嵌「我们收集哪些信息」清单表格，必需项红标 / 可选项灰标</div>
    </div>

    <div>
      <div class="phone">
        <div class="statusbar"></div>
        <div class="navbar">个人档案</div>
        <div class="screen">
          <span class="state-tag">未勾选</span>
          <div class="onboard-body">
            <div class="step-title">每周打算练几天？</div>
            <div class="step-sub">决定计划分化与恢复安排</div>
            <div class="day-grid">
              <div class="day-option">1<span class="day-unit">天</span></div>
              <div class="day-option">2<span class="day-unit">天</span></div>
              <div class="day-option selected">3<span class="day-unit">天</span></div>
              <div class="day-option">4<span class="day-unit">天</span></div>
              <div class="day-option">5<span class="day-unit">天</span></div>
              <div class="day-option">6<span class="day-unit">天</span></div>
            </div>
          </div>
          <div class="toast">请先阅读并同意《用户协议》和《隐私政策》</div>
          ${renderAgreeBar(false, true)}
        </div>
      </div>
      <div class="cap">③ 建档最后一步：未勾选时点「完成建档」被拦下 —— 勾选框抖动 + toast 说明原因</div>
    </div>

    <div>
      <div class="phone">
        <div class="statusbar"></div>
        <div class="navbar">个人档案</div>
        <div class="screen">
          <span class="state-tag">已勾选</span>
          <div class="onboard-body">
            <div class="step-title">每周打算练几天？</div>
            <div class="step-sub">决定计划分化与恢复安排</div>
            <div class="day-grid">
              <div class="day-option">1<span class="day-unit">天</span></div>
              <div class="day-option">2<span class="day-unit">天</span></div>
              <div class="day-option selected">3<span class="day-unit">天</span></div>
              <div class="day-option">4<span class="day-unit">天</span></div>
              <div class="day-option">5<span class="day-unit">天</span></div>
              <div class="day-option">6<span class="day-unit">天</span></div>
            </div>
          </div>
          ${renderAgreeBar(true, false)}
        </div>
      </div>
      <div class="cap">④ 勾选后放行建档；写库前还有一次服务端校验兜底。取消勾选即撤回同意记录</div>
    </div>
  </div>
</body>
</html>
`;

fs.writeFileSync(OUT, HTML, 'utf8');
console.log(`已生成 ${path.relative(ROOT, OUT)} —— ${content.LEGAL_VERSION}，用户协议 ${content.AGREEMENT.sections.length} 节 / 隐私政策 ${content.PRIVACY.sections.length} 节 / 收集清单 ${content.DATA_ITEMS.length} 项`);
