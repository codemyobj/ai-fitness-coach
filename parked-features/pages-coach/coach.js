// pages/coach/coach.js — AI 教练对话页
const app = getApp();
const ai = require('../../services/ai.js');
const { ensureOpenid } = require('../../utils/auth.js');
const { mdToNodes } = require('../../utils/markdown.js');

let msgId = 1000; // 历史消息 id 从 1000 起，本地新增从 1 起，避免 wx:key 冲突

Page({
  data: {
    hasProfile: false,
    statusBarHeight: 24, // 沉浸式头部：状态栏高度（onLoad 里取真实值）
    messages: [],
    inputValue: '',
    sending: false,
    scrollIntoView: '',
    suggestions: [
      { icon: '📋', text: '这周的训练怎么安排？' },
      { icon: '🥗', text: '增肌每天要吃多少蛋白质？' },
      { icon: '🦵', text: '深蹲膝盖不舒服怎么办？' },
      { icon: '🏠', text: '没器械在家怎么练背？' }
    ]
  },

  async onLoad() {
    // 沉浸式头部需要避开状态栏
    try {
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarHeight: win.statusBarHeight || 24 });
    } catch (e) { /* 用默认值兜底 */ }
    app.on('profileLoaded', (profile) => {
      this.setData({ hasProfile: !!profile });
    });
    this.setData({ hasProfile: !!app.globalData.profile });
    await this.loadHistory();
  },

  // 从 chat_messages 集合加载最近对话
  async loadHistory() {
    try {
      await ensureOpenid();
      const db = wx.cloud.database();
      const res = await db.collection('chat_messages')
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get();
      // 安全校验只取本人数据（配合安全规则双保险）
      const mine = res.data
        .filter((m) => m.openid === app.globalData.openid)
        .reverse()
        .map((m) => ({
          id: ++msgId,
          role: m.role,
          content: m.content,
          // AI 回复走 Markdown 渲染
          nodes: m.role === 'assistant' ? mdToNodes(m.content) : null
        }));
      if (mine.length) {
        this.setData({ messages: mine, scrollIntoView: 'msg-bottom' });
      }
    } catch (err) {
      console.warn('历史加载失败（首次使用可忽略）:', err);
    }
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value });
  },

  // 快捷提问
  onSuggestionTap(e) {
    if (this.data.sending) return;
    this.doSend(e.currentTarget.dataset.text);
  },

  async onSend() {
    const content = this.data.inputValue.trim();
    if (!content || this.data.sending) return;
    this.doSend(content);
  },

  async doSend(content) {
    // 追加用户消息（乐观更新）
    this.pushMessage('user', content);
    this.setData({ inputValue: '', sending: true });

    // 打字指示
    this.pushMessage('assistant', '正在思考…', true);

    try {
      const reply = await ai.chat(content);
      this.replaceLastMessage(reply);
    } catch (err) {
      console.error('AI 调用失败：', err);
      this.replaceLastMessage('出错了：' + (err.message || '请稍后重试'));
      wx.vibrateShort({ type: 'medium' });
    } finally {
      this.setData({ sending: false });
    }
  },

  pushMessage(role, content, isTemp) {
    const item = { id: ++msgId, role, content };
    if (isTemp) {
      item.temp = true;
    } else if (role === 'assistant') {
      item.nodes = mdToNodes(content);
    }
    const messages = this.data.messages.concat([item]);
    this.setData({ messages, scrollIntoView: 'msg-bottom' });
  },

  // 替换最后一条（打字指示 → 真实回复）
  replaceLastMessage(content) {
    const messages = this.data.messages.slice();
    const last = messages[messages.length - 1];
    const item = { role: 'assistant', content, nodes: mdToNodes(content) };
    if (last && last.role === 'assistant') {
      messages[messages.length - 1] = { id: last.id, ...item };
    } else {
      messages.push({ id: ++msgId, ...item });
    }
    this.setData({ messages, scrollIntoView: 'msg-bottom' });
  }
});
