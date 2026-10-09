// 過關模式平衡模擬：假設玩家每關首次過關後把金錢與經驗值花完 (先補滿士兵、再買比較好的裝備)，
// 戰利品隨機，所以同時跑數個玩家取平均。以電腦代打雙方，估計每一關的勝率。
// node tools/campaign-sim.js [每關場數] [只跑的關卡，例如 5,6,7 或 all] [玩家數] [難度，例如 normal,nightmare,hell]
// 指定多個難度時，同一批玩家依序打完 (例如普通全破後接著打噩夢)；只會印出「只跑的關卡」的勝率
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.window = {};
for (const f of ['config.js', 'items.js', 'explore.js', 'sprites.js', 'battle.js', 'tactics.js', 'elites.js', 'skills.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
}
const S = window.Sango;
const C = S.CAMPAIGN;
const n = Number(process.argv[2] || 200);
const only = process.argv[3] && process.argv[3] !== 'all' ? process.argv[3].split(',').map(Number) : null;
const P = Number(process.argv[4] || 6);
const DIFFS = (process.argv[5] || 'normal').split(',');

const BUY_ORDER = ['spear', 'cavalry', 'archer', 'spear'];
const UP_ORDER = ['spear', 'war', 'archer', 'lead', 'cavalry', 'hp'];   // 兵種等級與主將能力輪流

function newPlayer() {
  const each = C.CREATE.BASE + C.CREATE.POINTS / 4;   // 平均分配點數、初始士兵 槍2 弓2 騎1
  return {
    general: { name: '玩家', hp: each, war: each, int: each, lead: each, beard: null },
    soldiers: ['spear', 'spear', 'archer', 'archer', 'cavalry'],
    levels: { spear: 0, archer: 0, cavalry: 0 },
    equip: S.migrateEquip({}).equip,
    gold: C.START_GOLD, exp: 0, buyIdx: 0, upIdx: 0, shop: S.rollShop(1, 9)
  };
}

function gain(p, item) {
  const key = S.equipTarget(p.equip, item), cur = p.equip[key];
  if (!cur || S.itemValue(item) > S.itemValue(cur)) p.equip[key] = item;
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
        const price = S.itemValue(it), cur = p.equip[S.equipTarget(p.equip, it)];
        const g = price - (cur ? S.itemValue(cur) : 0);
        if (price <= p.gold && g > bestGain) { best = i; bestGain = g; }
      });
      if (best < 0) break;
      const it = p.shop.splice(best, 1)[0];
      p.gold -= S.itemValue(it);
      gain(p, it);
    }
  }
  for (let guard = 0; guard < 500; guard++) {
    const k = UP_ORDER[p.upIdx % UP_ORDER.length];
    const isLv = p.levels[k] != null;
    const maxed = isLv ? p.levels[k] >= S.LEVEL.MAX : p.general[k] >= C.STAT_MAX;
    const cost = isLv ? S.levelCost(p.levels[k]) : S.statCost(p.general[k]);
    if (!maxed && p.exp < cost) break;
    p.upIdx++;
    if (maxed) continue;
    p.exp -= cost;
    if (isLv) p.levels[k]++;
    else p.general[k] = Math.min(C.STAT_MAX, p.general[k] + C.STAT_STEP);
  }
}

function reward(p, st, k, diff, loot) {
  const D = S.DIFFICULTIES[diff], ilvl = Math.min(S.MAX_ILVL, k + 1 + D.ilvl);
  p.gold += Math.round(st.gold * D.reward);
  p.exp += Math.round(st.exp * D.reward);
  gain(p, S.rollLoot(ilvl));
  (loot || []).forEach(it => gain(p, it));
  (st.drops || []).forEach(dr => gain(p, S.makeItem(Object.assign({ ilvl }, dr))));
  p.shop = S.rollShop(Math.min(S.MAX_ILVL, ilvl + 1), 9);
}

const players = Array.from({ length: P }, newPlayer);
DIFFS.forEach(diff => S.STAGES.forEach((st, k) => {
  const D = S.DIFFICULTIES[diff];
  players.forEach(spend);
  const show = !only || only.indexOf(k + 1) >= 0;
  if (!show) { players.forEach(p => reward(p, st, k, diff)); return; }
  let w = 0, time = 0, games = 0;
  const loots = players.map(() => []);
  players.forEach((p, pi) => {
    const armies = [S.playerArmy(p), Object.assign({}, st.general, { units: st.units.slice() })];
    const levels = [S.playerLevels(p), S.stageLevels(st, diff)];
    for (let i = 0; i < Math.ceil(n / P); i++) {
      const b = new S.Battle(armies, { levels, eliteChance: D.elite, ilvl: Math.min(S.MAX_ILVL, k + 1 + D.ilvl) });
      while (b.state === 'fighting') b.step(S.SIM_DT);
      if (b.winner === 0) { w++; if (i === 0) loots[pi] = b.lootFound; }
      time += b.time;
      games++;
    }
  });
  const p = players[0], a = S.playerArmy(p), lv = p.levels;
  const eq = S.EQUIP_SLOT_KEYS.filter(s => p.equip[s]).length + '/10 件';
  console.log(`${D.name} 第${k + 1}關 ${st.general.name} 勝率 ${(w / games * 100).toFixed(0)}% 平均${(time / games).toFixed(0)}s` +
    ` | 玩家1 兵${p.soldiers.length} Lv 槍${lv.spear} 弓${lv.archer} 騎${lv.cavalry}` +
    ` 體${a.hp} 武${a.war} 智${a.int} 統${a.lead} 士兵+${Math.round(a.troopBonus * 100)}% ${eq} 剩金${p.gold}`);
  players.forEach((p, pi) => reward(p, st, k, diff, loots[pi]));
}));
