// packageA/onboarding/onboarding.js — 身体建档向导
const app = getApp();
const units = require('../../services/units.js');
const legal = require('../../services/legal.js');

const STEP_DEFS = [
  { key: 'goal', title: '你的训练目标是？', subtitle: '计划会围绕目标安排动作与强度' },
  { key: 'body', title: '基本情况', subtitle: '用于计算训练强度与热量参考' },
  { key: 'level', title: '训练经验如何？', subtitle: '决定动作难度与进阶节奏' },
  { key: 'equipment', title: '平时在哪里练？', subtitle: '决定可用动作范围' },
  { key: 'days', title: '每周打算练几天？', subtitle: '决定计划分化与恢复安排' }
];

Page({
  data: {
    stepIndex: 0,
    steps: STEP_DEFS,
    currentStep: STEP_DEFS[0], // 当前步骤标题/副标题（WXML 直接渲染）
    canNext: false,
    submitting: false,
    agreed: false,     // 是否同意《用户协议》《隐私政策》（完成建档的硬闸门）
    agreeShake: false, // 未勾选时抖动提示
    unit: 'kg',       // 体重输入单位（跟「我的 → 单位设置」，入库前换算成 kg）
    weightPh: '如 68.5',
    form: {
      goal: '',
      gender: '',
      age: '',
      heightCm: '',
      weightKg: '',
      level: '',
      equipment: '',
      daysPerWeek: 0
    },
    goals: [
      { key: 'fat_loss', icon: '🔥', label: '减脂塑形' },
      { key: 'muscle_gain', icon: '💪', label: '增肌变强' },
      { key: 'endurance', icon: '🏃', label: '提升体能' },
      { key: 'posture', icon: '🧘', label: '体态改善' }
    ],
    levels: [
      { key: '新手', icon: '🌱', label: '新手', desc: '刚开始或断练超过半年' },
      { key: '进阶', icon: '⚡', label: '进阶', desc: '规律训练半年以上' },
      { key: '老手', icon: '🏆', label: '老手', desc: '两年以上系统训练' }
    ],
    equipments: [
      { key: '徒手', icon: '🏠', label: '在家徒手', desc: '无器械或只有瑜伽垫' },
      { key: '哑铃', icon: '🏋️', label: '小哑铃', desc: '有哑铃/弹力带等小件' },
      { key: '健身房', icon: '🏢', label: '健身房', desc: '杠铃器械齐全' }
    ]
  },

  onLoad() {
    const unit = units.get();
    // 编辑模式：回填已有档案（档案里是 kg，按当前单位换算成展示值）
    const profile = app.globalData.profile;
    if (profile) {
      const shownWeight = profile.weightKg ? units.toDisplay(profile.weightKg, unit) : '';
      this.setData({
        form: {
          goal: profile.goal || '',
          gender: profile.gender || '',
          age: profile.age ? String(profile.age) : '',
          heightCm: profile.heightCm ? String(profile.heightCm) : '',
          weightKg: shownWeight === '' ? '' : String(shownWeight),
          level: profile.level || '',
          equipment: profile.equipment || '',
          daysPerWeek: profile.daysPerWeek || 0
        }
      });
    }
    this.setData({ unit, weightPh: unit === 'lb' ? '如 151' : '如 68.5', agreed: legal.isAccepted() });
    this.validate();
  },

  // 从「我的」改完单位回来时同步输入口径；
  // 从协议页返回时同步勾选态（用户在协议页点了「我已阅读并同意」）
  onShow() {
    const unit = units.get();
    const agreed = legal.isAccepted();
    if (unit === this.data.unit) {
      if (agreed !== this.data.agreed) this.setData({ agreed });
      return;
    }
    const shown = this.data.form.weightKg ? units.toKg(this.data.form.weightKg, this.data.unit) : '';
    this.setData({
      unit,
      weightPh: unit === 'lb' ? '如 151' : '如 68.5',
      agreed,
      'form.weightKg': shown === '' || shown === null ? '' : String(units.toDisplay(shown, unit))
    });
  },

  // ---------- 协议同意 ----------
  // 勾选即写入同意记录，取消勾选即撤回同意 —— 本地记录跟着用户操作走，不做「隐式保留」
  onToggleAgree() {
    const next = !this.data.agreed;
    if (next) legal.accept();
    else legal.revoke();
    this.setData({ agreed: next });
  },

  // 进协议页（带 from，协议页会在底部给出「我已阅读并同意」）
  goLegal(e) {
    const type = (e.currentTarget.dataset && e.currentTarget.dataset.type) || 'agreement';
    wx.navigateTo({ url: `/packageA/legal/legal?type=${type}&from=onboarding` });
  },

  // 选项点击（goal / gender / level / equipment / daysPerWeek 共用）
  pickOption(e) {
    const { field, value } = e.currentTarget.dataset;
    const numValue = field === 'daysPerWeek' ? Number(value) : value;
    this.setData({ [`form.${field}`]: numValue });
    this.validate();
  },

  // 数字输入
  onFieldInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`form.${field}`]: e.detail.value });
    this.validate();
  },

  // 校验当前步骤是否可继续
  validate() {
    const { stepIndex, form } = this.data;
    let ok = false;
    switch (STEP_DEFS[stepIndex].key) {
      case 'goal': ok = !!form.goal; break;
      case 'body': ok = form.gender && form.age && form.heightCm && form.weightKg; break;
      case 'level': ok = !!form.level; break;
      case 'equipment': ok = !!form.equipment; break;
      case 'days': ok = form.daysPerWeek > 0; break;
    }
    this.setData({ canNext: ok });
  },

  prevStep() {
    if (this.data.stepIndex === 0) return;
    this.goStep(this.data.stepIndex - 1);
  },

  nextStep() {
    if (!this.data.canNext || this.data.submitting) return;
    if (this.data.stepIndex < STEP_DEFS.length - 1) {
      this.goStep(this.data.stepIndex + 1);
      return;
    }
    // 最后一步「完成建档」必须已同意协议：这是收集档案/训练数据的前提
    if (!this.data.agreed) {
      this.warnAgree();
      return;
    }
    this.submit();
  },

  // 未勾选协议时给出明确提示（toast 说清原因 + 抖动指向勾选框）
  warnAgree() {
    wx.showToast({ title: '请先阅读并同意《用户协议》和《隐私政策》', icon: 'none', duration: 2000 });
    this.setData({ agreeShake: true });
    setTimeout(() => this.setData({ agreeShake: false }), 600);
  },

  // 统一步骤切换：保证 stepIndex 与 currentStep 始终同步
  goStep(index) {
    const safeIndex = Math.min(Math.max(index, 0), STEP_DEFS.length - 1);
    this.setData({
      stepIndex: safeIndex,
      currentStep: STEP_DEFS[safeIndex]
    }, () => this.validate());
  },

  // 提交档案到云数据库 profiles 集合
  async submit() {
    // 双保险：即使有别的路径绕过 nextStep，也不允许未同意就写库
    if (!this.data.agreed) {
      this.warnAgree();
      return;
    }
    if (!app.globalData.openid) {
      wx.showToast({ title: '登录中，请稍后再试', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    const { form, unit } = this.data;
    const record = {
      openid: app.globalData.openid,
      goal: form.goal,
      gender: form.gender,
      age: Number(form.age),
      heightCm: Number(form.heightCm),
      // 表单填的是当前单位的数值，统一换算成 kg 入库
      weightKg: units.toKg(form.weightKg, unit),
      level: form.level,
      equipment: form.equipment,
      daysPerWeek: form.daysPerWeek
    };

    try {
      const db = wx.cloud.database();
      if (app.globalData.profile) {
        // 编辑：更新已有档案
        await db.collection('profiles')
          .doc(app.globalData.profile._id)
          .update({ data: { ...record, updatedAt: db.serverDate() } });
      } else {
        // 新建
        await db.collection('profiles').add({
          data: { ...record, createdAt: db.serverDate(), updatedAt: db.serverDate() }
        });
      }
      await app.loadProfile();
      wx.showToast({ title: '建档成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 800);
    } catch (err) {
      console.error('建档失败：', err);
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
