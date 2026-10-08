// 過關模式平衡模擬：假設玩家每關首次過關後把金錢與經驗值花完 (先補滿士兵、再買比較好的裝備)，
// 戰利品隨機，所以同時跑數個玩家取平均。以電腦代打雙方，估計每一關的勝率。
// node tools/campaign-sim.js [每關場數] [只跑的關卡，例如 5,6,7] [玩家數]
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.window = {};
for (const f of ['config.js', 'items.js', 'sprites.js', 'battle.js', 'tactics.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
}
const S = window.Sango;
const C = S.CAMPAIGN;
const n = Number(process.argv[2] || 200);
const only = process.argv[3] && process.argv[3] !== 'all' ? process.argv[3].split(',').map(Number) : null;
const P = Number(process.argv[4] || 6);

const BUY_ORDER = ['spear', 'cavalry', 'archer', 'spear'];
const UP_ORDER = ['spear', 'war', 'archer', 'lead', 'cavalry', 'hp'];   // 兵種等級與主將能力輪流

function newPlayer() {
  const each = C.CREATE.BASE + C.CREATE.POINTS / 4;   // 平均分配點數、初始士兵 槍2 弓2 騎1
  return {
    general: { name: '玩家', hp: each, war: each, int: each, lead: each, beard: null },
    soldiers: ['spear', 'spear', 'archer', 'archer', 'cavalry'],
    levels: { spear: 0, archer: 0, cavalry: 0 },
    equip: { weapon: null, armor: null, treasure: null },
    gold: C.START_GOLD, exp: 0, buyIdx: 0, upIdx: 0, shop: S.rollShop(1, 6)
  };
}

function gain(p, item) {
  const slot = S.itemInfo(item).slot, cur = p.equip[slot];
  if (!cur || S.itemValue(item) > S.itemValue(cur)) p.equip[slot] = item;
  else p.gold += S.itemSellPrice(item);
}

function spend(p) {
  while (p.soldiers.length < C.MAX_UNITS && p.gold >= C.PRICE[BUY_ORDER[p.buyIdx % BUY_ORDER.length]]) {
    const t = BUY_ORDER[p.buyIdx++ % BUY_ORDER.length];
    p.gold -= C.PRICE[t];
    p.soldiers.push(t);
  }
  if (p.soldiers.length >= C.MAX_UNITS) {
    // 買能提升最多的裝備
    for (;;) {
      let best = -1, bestGain = 0;
      p.shop.forEach((it, i) => {
        const price = S.itemValue(it), cur = p.equip[S.itemInfo(it).slot];
        const g = price - (cur ? S.itemValue(cur) : 0);
        if (price <= p.gold && g > bestGain) { best = i; bestGain = g; }
      });
      if (best < 0) break;
      const it = p.shop.splice(best, 1)[0];
      p.gold -= S.itemValue(it);
      gain(p, it);
    }
  }
  while (p.exp >= Math.max(C.LEVEL_COST, C.STAT_COST)) {
    const k = UP_ORDER[p.upIdx++ % UP_ORDER.length];
    if (p.levels[k] != null) { p.levels[k]++; p.exp -= C.LEVEL_COST; }
    else if (p.general[k] < C.STAT_MAX) {
      p.general[k] = Math.min(C.STAT_MAX, p.general[k] + C.STAT_STEP);
      p.exp -= C.STAT_COST;
    }
  }
}

function reward(p, st, k) {
  p.gold += st.gold;
  p.exp += st.exp;
  gain(p, S.rollLoot(k + 1));
  (st.drops || []).forEach(dr => gain(p, S.makeItem(Object.assign({ ilvl: k + 1 }, dr))));
  p.shop = S.rollShop(Math.min(10, k + 2), 6);
}

const players = Array.from({ length: P }, newPlayer);
S.STAGES.forEach((st, k) => {
  players.forEach(spend);
  if (only && only.indexOf(k + 1) < 0) { players.forEach(p => reward(p, st, k)); return; }
  let w = 0, time = 0, games = 0;
  players.forEach(p => {
    const armies = [S.playerArmy(p), Object.assign({}, st.general, { units: st.units.slice() })];
    const levels = [S.playerLevels(p), S.stageLevels(st)];
    for (let i = 0; i < Math.ceil(n / P); i++) {
      const b = new S.Battle(armies, { levels });
      while (b.state === 'fighting') b.step(S.SIM_DT);
      if (b.winner === 0) w++;
      time += b.time;
      games++;
    }
  });
  const p = players[0], a = S.playerArmy(p), lv = p.levels;
  const eq = S.EQUIP_SLOT_KEYS.map(s => p.equip[s] ? S.itemInfo(p.equip[s]).name : '—').join('/');
  console.log(`第${k + 1}關 ${st.general.name} 勝率 ${(w / games * 100).toFixed(0)}% 平均${(time / games).toFixed(0)}s` +
    ` | 玩家1 兵${p.soldiers.length} Lv 槍${lv.spear} 弓${lv.archer} 騎${lv.cavalry}` +
    ` 體${a.hp} 武${a.war} 智${a.int} 統${a.lead} 士兵+${Math.round(a.troopBonus * 100)}% ${eq} 剩金${p.gold}`);
  players.forEach(p => reward(p, st, k));
});
