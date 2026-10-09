// 探索模式模擬：以簡單的機器人操控主將 (附近沒敵人就去打最近的敵人，敵將留到最後)，
// 自動計策開啟，估計各關的勝率與耗時。node tools/explore-sim.js [每關場數] [關卡，例如 1,5,10]
// 玩家的養成程度沿用 campaign-sim 的假設：每關首次過關後把金錢與經驗值花完
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.window = {};
for (const f of ['config.js', 'items.js', 'soldiers.js', 'explore.js', 'sprites.js', 'battle.js', 'tactics.js', 'elites.js', 'skills.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
}
const S = window.Sango;
const C = S.CAMPAIGN;
const n = Number(process.argv[2] || 10);
const only = process.argv[3] ? process.argv[3].split(',').map(Number) : null;

// 第 k 關之前的典型養成 (與 campaign-sim 相同的花費規則，裝備取每欄位的普通 / 魔法平均水準)
function playerAt(k) {
  const each = C.CREATE.BASE + C.CREATE.POINTS / 4;
  const p = {
    general: { name: '玩家', hp: each, war: each, int: each, lead: each, beard: null },
    soldiers: ['spear', 'spear', 'archer', 'archer', 'cavalry'],
    levels: { spear: 0, archer: 0, cavalry: 0 }, equip: {}
  };
  let gold = C.START_GOLD, exp = 0, bi = 0, ui = 0;
  const BUY = ['spear', 'cavalry', 'archer', 'spear'], UP = ['spear', 'war', 'archer', 'lead', 'cavalry', 'hp'];
  for (let s = 0; s < k; s++) { gold += S.STAGES[s].gold; exp += S.STAGES[s].exp; }
  while (p.soldiers.length < C.MAX_UNITS && gold >= C.PRICE[BUY[bi % 4]]) { gold -= C.PRICE[BUY[bi % 4]]; p.soldiers.push(BUY[bi++ % 4]); }
  while (exp >= 100) {
    const key = UP[ui++ % UP.length];
    if (p.levels[key] != null) p.levels[key]++; else p.general[key] = Math.min(100, p.general[key] + 3);
    exp -= 100;
  }
  if (k > 0) S.EQUIP_SLOT_KEYS.forEach(key => { p.equip[key] = S.makeItem({ ilvl: k, quality: 'magic', slot: key.replace(/[12]$/, '') }); });
  p.soldiers = p.soldiers.map(t => Object.assign(S.makeSoldier({ cls: S.BASE_CLASS[t], q: 'normal', ilvl: 1, lv: p.levels[t] }), { active: true }));
  p.levels = { spear: 0, archer: 0, cavalry: 0 };
  return p;
}

function bot(b) {
  const g = b.generals[0];
  if (!g || g.dead) return;
  const soldiers = b.alive(0).filter(u => !u.isGeneral);
  // 主將兵力太低：退回士兵中間
  if (g.hp < g.maxHp * 0.4 && soldiers.length) {
    const cx = Math.round(soldiers.reduce((s, u) => s + u.x, 0) / soldiers.length);
    const cy = Math.round(soldiers.reduce((s, u) => s + u.y, 0) / soldiers.length);
    if (Math.max(Math.abs(cx - g.x), Math.abs(cy - g.y)) > 2 && (!g.order || g.order.kind !== 'move')) {
      b.commandGeneral(0, { kind: 'move', x: cx, y: cy });
    }
    return;
  }
  if (g.order && g.order.kind !== 'hold') return;
  const near = b.unitsNear(1, g.x, g.y, S.EXPLORE.ENGAGE).filter(e => !e.passive);
  if (near.length) { b.commandGeneral(0, { kind: 'attack', target: near[0] }); return; }
  // 等士兵跟上、回復兵力
  if (soldiers.some(u => Math.max(Math.abs(u.x - g.x), Math.abs(u.y - g.y)) > 6)) return;
  if (g.hp < g.maxHp * 0.8) return;
  let best = null, bestD = Infinity;
  b.alive(1).forEach(e => {
    if (e.passive) return;   // 鹿會逃跑，不去追
    const d = Math.max(Math.abs(e.x - g.x), Math.abs(e.y - g.y)) + (e.camp === 0 ? 1000 : 0);
    if (d < bestD) { bestD = d; best = e; }
  });
  if (best) b.commandGeneral(0, { kind: 'attack', target: best });
}

S.STAGES.forEach((st, k) => {
  if (only && only.indexOf(k + 1) < 0) return;
  const p = playerAt(k);
  let w = 0, time = 0, camps = 0, loot = 0, left = 0, ms = 0;
  for (let i = 0; i < n; i++) {
    const ex = S.makeExplore(k);
    const t0 = Date.now();
    const b = new S.Battle([S.playerArmy(p), Object.assign({}, st.general, { units: st.units.slice() })],
      { explore: ex, control: [true, false], autoTactics: [true, false], levels: [S.playerLevels(p), S.stageLevels(st)] });
    let botT = 0;
    while (b.state === 'fighting' && b.time < 1500) {
      b.step(S.SIM_DT);
      botT -= S.SIM_DT;
      if (botT <= 0) { botT = 0.5; bot(b); }
    }
    ms += Date.now() - t0;
    if (b.winner === 0) w++; else if (process.env.WHY) console.log('  敗因', b.state === 'fighting' ? '超時' : '主將陣亡', 'area', b.area, (b.log.slice(-4)).join(' / '));
    time += b.time;
    camps += b.campsCleared;
    loot += b.lootFound.length;
    left += b.alive(0).length;
  }
  console.log(`第${k + 1}關 ${st.general.name} 勝率 ${(w / n * 100).toFixed(0)}% 平均${(time / n).toFixed(0)}s` +
    ` 擊破敵營 ${(camps / n).toFixed(1)} 裝備 ${(loot / n).toFixed(1)} 剩餘部隊 ${(left / n).toFixed(1)}` +
    ` | 模擬耗時 ${(ms / n / 1000).toFixed(1)}s/場 (遊戲每秒 ${(ms / time).toFixed(2)}ms)`);
});
