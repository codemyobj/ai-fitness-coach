/**
 * utils/markdown.js — 聊天气泡轻量 Markdown 渲染（零依赖）
 *
 * 将 AI 回复的 Markdown 转为 rich-text nodes：
 *   - 标题 #/##/###
 *   - 无序列表 - / •   有序列表 1.
 *   - 行内 **加粗**、*斜体*、`代码`
 *   - 空行分段，其余为普通段落
 * 不支持的语法（表格/图片等）按纯文本兜底，不会报错。
 */

// 行内解析：**bold**、*italic*、`code` → 富文本节点数组
function inline(text) {
  const nodes = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push({ type: 'text', text: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith('**')) {
      nodes.push({ name: 'strong', attrs: { class: 'md-strong' }, children: [{ type: 'text', text: tok.slice(2, -2) }] });
    } else if (tok.startsWith('`')) {
      nodes.push({ name: 'code', attrs: { class: 'md-code' }, children: [{ type: 'text', text: tok.slice(1, -1) }] });
    } else {
      nodes.push({ name: 'em', attrs: { class: 'md-em' }, children: [{ type: 'text', text: tok.slice(1, -1) }] });
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) });
  return nodes;
}

// 主入口：markdown 字符串 → rich-text nodes
function mdToNodes(md) {
  if (!md || typeof md !== 'string') return [{ type: 'text', text: '' }];
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const nodes = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue; // 空行分段由 div 自带间距承担

    // 标题
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      nodes.push({
        name: 'div',
        attrs: { class: 'md-h md-h' + level },
        children: inline(h[2])
      });
      continue;
    }

    // 无序列表
    const ul = line.match(/^[-•*]\s+(.*)$/);
    if (ul) {
      nodes.push({
        name: 'div',
        attrs: { class: 'md-li' },
        children: [{ type: 'text', text: '· ' }, ...inline(ul[1])]
      });
      continue;
    }

    // 有序列表
    const ol = line.match(/^(\d+)[.、]\s+(.*)$/);
    if (ol) {
      nodes.push({
        name: 'div',
        attrs: { class: 'md-li' },
        children: [{ type: 'text', text: ol[1] + '. ' }, ...inline(ol[2])]
      });
      continue;
    }

    // 普通段落
    nodes.push({ name: 'div', attrs: { class: 'md-p' }, children: inline(line) });
  }

  return nodes.length ? nodes : [{ type: 'text', text: md }];
}

module.exports = { mdToNodes };
