/**
 * test-body.js — 身体记录服务单测（V0.6）
 * 用内存数据库 mock wx.cloud.database，覆盖写入/更新/删除/聚合
 */
const path = require('path');

// ---------- mock 云数据库 ----------
const DB = { body_records: [] };
let idSeq = 0;

function makeCollection(name) {
  const col = {
    _q: null,
    _order: null,
    _limit: 1000,
    where(q) { col._q = q; return col; },
    orderBy(f, dir) { col._order = { f, dir }; return col; },
    limit(n) { col._limit = n; return col; },
    async get() {
      let rows = DB[name].filter((d) => {
        if (!col._q) return true;
        return Object.keys(col._q).every((k) => d[k] === col._q[k]);
      });
      if (col._order) {
        rows.sort((a, b) => {
          const av = a[col._order.f];
          const bv = b[col._order.f];
          if (av === bv) return 0;
          const asc = av > bv ? 1 : -1;
          return col._order.dir === 'desc' ? -asc : asc;
        });
      }
      return { data: rows.slice(0, col._limit).map((d) => Object.assign({}, d)) };
    },
    async add(opts) {
      idSeq++;
      const _id = `id_${idSeq}`;
      DB[name].push(Object.assign({ _id }, opts.data));
      return { _id };
    },
    doc(id) {
      return {
        async update(opts) {
          const row = DB[name].find((d) => d._id === id);
          if (!row) throw new Error('文档不存在：' + id);
          Object.assign(row, opts.data);
          return { stats: { updated: 1 } };
        },
        async remove() {
          const i = DB[name].findIndex((d) => d._id === id);
          if (i < 0) throw new Error('文档不存在：' + id);
          DB[name].splice(i, 1);
          return { stats: { removed: 1 } };
        }
      };
    }
  };
  return col;
}

global.wx = {
  cloud: {
    database: () => ({
      collection: makeCollection,
      serverDate: () => ({ _serverDate: Date.now() })
    })
  }
};
global.getApp = () => ({ globalData: { openid: 'test-openid' } });

const body = require(path.join(__dirname, 'miniprogram/services/body.js'));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`   ✅ ${name}`); }
  else { fail++; console.log(`   ❌ ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`); }
}
function eq(name, actual, expected) {
  ok(`${name}（期望 ${JSON.stringify(expected)}）`, actual === expected, actual);
}
function throws(name, fn, keyword) {
  try {
    fn();
    ok(`${name} 应抛错`, false, '没有抛错');
  } catch (e) {
    ok(`${name}（含「${keyword}」）`, String(e.message).indexOf(keyword) >= 0, e.message);
  }
}
function section(t) { console.log(`\n${t}`); }

(async function run() {
  console.log('==================== 身体记录服务单测 ====================');

  section('1. 输入校验');
  const v = body.validate({ date: '2026-10-01', weightKg: '65.55', bodyFatPct: '18.4' });
  eq('体重保留 1 位小数', v.weightKg, 65.6);
  eq('体脂保留 1 位小数', v.bodyFatPct, 18.4);
  eq('日期原样保留', v.date, '2026-10-01');
  throws('体重为空', () => body.validate({ weightKg: '' }), '请填写体重');
  throws('体重非数字', () => body.validate({ weightKg: 'abc' }), '数字');
  throws('体重过小', () => body.validate({ weightKg: 10 }), '20-300');
  throws('体重过大', () => body.validate({ weightKg: 400 }), '20-300');
  throws('体脂过高', () => body.validate({ weightKg: 65, bodyFatPct: 90 }), '3-70');
  throws('日期格式错', () => body.validate({ weightKg: 65, date: '2026/10/01' }), '日期格式');
  throws('未来日期', () => body.validate({ weightKg: 65, date: '2099-01-01' }), '未来');
  eq('体脂留空则为 null', body.validate({ weightKg: 65 }).bodyFatPct, null);
  eq('备注超长被截断', body.validate({ weightKg: 65, note: 'x'.repeat(80) }).note.length, 50);
  eq('日期缺省为今天', body.validate({ weightKg: 65 }).date, body.todayStr());

  section('2. 写入与更新');
  const id1 = await body.saveRecord({ date: '2026-09-01', weightKg: 70, note: '起始' });
  eq('新增返回 _id 前缀', String(id1).indexOf('id_') === 0, true);
  eq('库中 1 条', DB.body_records.length, 1);
  const id2 = await body.saveRecord({ date: '2026-09-01', weightKg: 69.2 });
  eq('同日重复记录走更新（id 相同）', id2, id1);
  eq('库中仍为 1 条', DB.body_records.length, 1);
  eq('同日记录被覆盖为最新体重', DB.body_records[0].weightKg, 69.2);
  await body.saveRecord({ date: '2026-09-08', weightKg: 68.4 });
  await body.saveRecord({ date: '2026-09-15', weightKg: 67.9, bodyFatPct: 20.1 });
  eq('库中 3 条', DB.body_records.length, 3);
  eq('写入带 openid', DB.body_records[0].openid, 'test-openid');

  section('3. 查询与删除');
  const list = await body.listRecords(60);
  eq('列表条数', list.length, 3);
  eq('按日期倒序，首条最新', list[0].date, '2026-09-15');
  eq('按日期倒序，末条最旧', list[2].date, '2026-09-01');
  ok('limit 生效', (await body.listRecords(2)).length === 2);
  await body.removeRecord(list[0]._id);
  eq('删除后剩 2 条', DB.body_records.length, 2);

  section('4. 汇总 summary');
  const recs = await body.listRecords(60);
  const s = body.buildSummary(recs);
  eq('记录数', s.count, 2);
  eq('hasData', s.hasData, true);
  eq('最新体重（09-08）', s.latestWeight, 68.4);
  eq('最低体重', s.minWeight, 68.4);
  eq('最高体重', s.maxWeight, 69.2);
  eq('较上次差值（68.4 - 69.2）', s.delta, -0.8);
  eq('差值文案带负号', s.deltaText, '-0.8');
  eq('下降用 down 样式（主色）', s.deltaClass, 'down');
  eq('总变化', s.totalDelta, -0.8);
  const empty = body.buildSummary([]);
  eq('空数据 count', empty.count, 0);
  eq('空数据 hasData', empty.hasData, false);
  eq('空数据无差值文案', empty.deltaText, '');

  section('5. 趋势 trend');
  const t = body.buildTrend(recs, 10);
  eq('趋势点数', t.count, 2);
  eq('趋势按日期升序', t.points[0].date, '2026-09-01');
  eq('标签取 MM-DD', t.points[0].label, '09-01');
  ok('柱高在 30-100 之间', t.points.every((p) => p.heightPct >= 30 && p.heightPct <= 100), t.points);
  const t1 = body.buildTrend([{ date: '2026-09-01', weightKg: 70 }], 10);
  eq('单点趋势也有数据', t1.hasData, true);
  eq('单点柱高取中间值', t1.points[0].heightPct, 55);
  eq('空趋势无数据', body.buildTrend([], 10).hasData, false);

  section('6. 列表装饰');
  const dec = body.decorateRecords(recs);
  eq('装饰后条数', dec.length, 2);
  eq('装饰后首条最新', dec[0].date, '2026-09-08');
  eq('最新一条差值（68.4-69.2）', dec[0].deltaText, '-0.8');
  eq('最旧一条无差值', dec[1].deltaText, '');
  eq('体重文案', dec[0].weightText, '68.4');
  eq('无体脂时体脂文案为空', dec[0].fatText, '');
  eq('体脂文案', dec[1].fatText, '');
  const dec3 = body.decorateRecords([
    { date: '2026-09-01', weightKg: 70 },
    { date: '2026-09-08', weightKg: 70 }
  ]);
  eq('相同体重显示持平', dec3[0].deltaText, '持平');
  eq('持平用 flat 样式', dec3[0].deltaClass, 'flat');
  eq('上升用 up 样式', body._internal.deltaClass(1.2), 'up');

  section('7. 纯函数');
  eq('日期升序排序', body._internal.sortByDateAsc([
    { date: '2026-09-08' }, { date: '2026-09-01' }
  ])[0].date, '2026-09-01');
  eq('round1 四舍五入', body._internal.round1(65.55), 65.6);
  eq('fmt 补零', body._internal.fmt(new Date(2026, 0, 5)), '2026-01-05');

  section('8. 单位换算（kg / lb）');
  // 入库永远是 kg：表单填 lb 时先换算
  const lbIn = body.validate({ date: '2026-10-01', weightKg: '154.3' }, 'lb');
  eq('lb 输入换算成 kg 入库', lbIn.weightKg, 70);
  eq('单位标记透出', lbIn.unit, 'lb');
  eq('不传单位默认 kg（老调用不受影响）', body.validate({ weightKg: '70' }).weightKg, 70);
  throws('lb 用户体重过小提示 lb 范围', () => body.validate({ weightKg: 20 }, 'lb'), '44-661 lb');
  throws('lb 用户体重过大提示 lb 范围', () => body.validate({ weightKg: 700 }, 'lb'), '44-661 lb');
  eq('lb 边界值 44 合法', body.validate({ weightKg: 44 }, 'lb').weightKg, 20);

  const lbSummary = body.buildSummary(recs, 'lb');
  eq('summary 最新体重按 lb 展示（68.4kg ≈ 150.8lb）', lbSummary.latestWeight, 150.8);
  eq('summary 差值按 lb 换算（-0.8kg ≈ -1.8lb）', lbSummary.delta, -1.8);
  eq('summary 单位标记', lbSummary.unit, 'lb');
  eq('summary 最低体重按 lb 展示', lbSummary.minWeight, 150.8);
  eq('summary 最高体重按 lb 展示', lbSummary.maxWeight, 152.6);

  const lbTrend = body.buildTrend(recs, 10, 'lb');
  eq('趋势点位体重按 lb 展示', lbTrend.points[lbTrend.points.length - 1].weightKg, 150.8);
  eq('趋势单位标记', lbTrend.unit, 'lb');
  eq('柱高百分比不受单位影响（与 kg 一致）',
    lbTrend.points[0].heightPct, body.buildTrend(recs, 10, 'kg').points[0].heightPct);

  const lbDec = body.decorateRecords(recs, 'lb');
  eq('列表体重文本按 lb 展示', lbDec[0].weightText, '150.8');
  eq('列表差值文本按 lb 展示', lbDec[0].deltaText, '-1.8');
  eq('列表空体重显示占位符', body.decorateRecords([{ date: '2026-09-01', weightKg: null }], 'lb')[0].weightText, '—');
  eq('kg 模式下行为与旧版一致', body.decorateRecords(recs, 'kg')[0].weightText, '68.4');

  console.log('\n================ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ================\n');
  process.exit(fail ? 1 : 0);
})();
