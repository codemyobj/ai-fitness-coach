// components/skeleton/skeleton.js — 骨架屏
//
// 一个组件覆盖全部页面首屏：靠 variant 切换版式
//   training | stats | body | plan | workout | card | list
// 版式本身由 utils/skeleton.js 的 buildSpec() 用纯数据描述，这里只负责渲染。
// 好处：改版式不用动组件 WXML，且 spec 能离线单测（见 test-skeleton.js）。
//
// 用法：<skeleton wx:if="{{skVisible}}" variant="stats" />
// 显隐由页面用 utils/skeleton.js 的 gate() 驱动（延迟 180ms，避免缓存命中时闪一下）。
const skeleton = require('../../utils/skeleton.js');

Component({
  properties: {
    // 版式名（未知值回落到 list，不会白屏）
    variant: { type: String, value: 'list', observer: 'onPropChange' },
    // 列表行数，0 = 用该版式的默认值
    rows: { type: Number, value: 0, observer: 'onPropChange' }
  },

  data: {
    v: 'list',
    cards: []
  },

  lifetimes: {
    attached() {
      this.render(this.data.variant, this.data.rows);
    }
  },

  methods: {
    onPropChange() {
      this.render(this.data.variant, this.data.rows);
    },

    render(variant, rows) {
      const v = skeleton.normalizeVariant(variant);
      const key = `${v}|${rows || 0}`;
      // 属性 observer 与 attached 都会调这里，同样的输入不重复 setData
      if (this._specKey === key) return;
      this._specKey = key;
      this.setData({ v: v, cards: skeleton.buildSpec(v, rows) });
    }
  }
});
