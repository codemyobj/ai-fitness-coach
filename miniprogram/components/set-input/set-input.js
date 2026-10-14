// components/set-input/set-input.js — 组数 / 次数 / 重量 三合一输入器
//
// properties:
//   sets       {Number} 目标组数（初始值）
//   reps       {String} 目标次数区间，如 "8-12"，仅展示
//   weightUnit {String} 重量单位，默认 kg
//   allowWeight{Boolean} 是否允许记录重量（徒手动作为 false）
// events:
//   change -> detail: { sets, reps, weightKg }

Component({
  properties: {
    sets: { type: Number, value: 3 },
    reps: { type: String, value: '' },
    weightUnit: { type: String, value: 'kg' },
    allowWeight: { type: Boolean, value: true }
  },

  data: {
    setList: [] // [{ index, done, weightKg }]
  },

  observers: {
    'sets, allowWeight'(sets) {
      this.buildSetList(sets);
    }
  },

  lifetimes: {
    attached() {
      this.buildSetList(this.data.sets);
    }
  },

  methods: {
    // 按组数生成列表，保留已填重量
    buildSetList(count) {
      const total = Math.min(Math.max(Number(count) || 1, 1), 10);
      const old = this.data.setList;
      const setList = Array.from({ length: total }, (_, i) => {
        const prev = old[i];
        return prev
          ? { ...prev, index: i + 1 }
          : { index: i + 1, done: false, weightKg: '' };
      });
      this.setData({ setList });
      this.emitChange();
    },

    // 完成/取消完成某组
    onToggleSet(e) {
      const idx = Number(e.currentTarget.dataset.index);
      const key = `setList[${idx}].done`;
      this.setData({ [key]: !this.data.setList[idx].done }, () => this.emitChange());
    },

    // 修改重量
    onWeightInput(e) {
      const idx = Number(e.currentTarget.dataset.index);
      const value = e.detail.value;
      this.setData({ [`setList[${idx}].weightKg`]: value }, () => this.emitChange());
    },

    // 组数 ±
    onSetsStep(e) {
      const delta = Number(e.currentTarget.dataset.delta);
      const next = Math.min(Math.max(this.data.setList.length + delta, 1), 10);
      this.buildSetList(next);
    },

    // 一键套用建议重量（渐进超负荷建议用）。
    // 只填「还没填」的组：用户已经手填过的重量不能被覆盖——他可能正在刻意降重量热身。
    // @returns {Number} 实际填入的组数（0 表示没有可填的组）
    fillWeight(value) {
      const num = Number(value);
      if (!isFinite(num) || num <= 0) return 0;
      let filled = 0;
      const setList = this.data.setList.map((s) => {
        const empty = s.weightKg === '' || s.weightKg === null || s.weightKg === undefined;
        if (!empty) return s;
        filled += 1;
        return { ...s, weightKg: num };
      });
      if (!filled) return 0;
      this.setData({ setList }, () => this.emitChange());
      return filled;
    },

    // 通知父组件当前填写状态
    emitChange() {
      const setList = this.data.setList;
      this.triggerEvent('change', {
        total: setList.length,
        doneCount: setList.filter((s) => s.done).length,
        sets: setList.map((s) => ({
          done: s.done,
          weightKg: s.weightKg === '' ? null : Number(s.weightKg)
        }))
      });
    }
  }
});
