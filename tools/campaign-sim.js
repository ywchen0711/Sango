// 過關模式平衡模擬：假設玩家每關首次過關後把金錢與經驗值花完 (先補滿士兵、再買裝備)，
// 以電腦代打雙方，估計每一關的勝率。node tools/campaign-sim.js [每關場數] [只跑的關卡，例如 5,6,7]
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.window = {};
for (const f of ['config.js', 'sprites.js', 'battle.js', 'tactics.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
}
const S = window.Sango;
const C = S.CAMPAIGN;
const n = Number(process.argv[2] || 200);
const only = process.argv[3] ? process.argv[3].split(',').map(Number) : null;

// 平均分配點數、初始士兵 槍2 弓2 騎1
const each = C.CREATE.BASE + C.CREATE.POINTS / 4;
const profile = {
  general: { name: '玩家', hp: each, war: each, int: each, lead: each, beard: null },
  soldiers: ['spear', 'spear', 'archer', 'archer', 'cavalry'],
  levels: { spear: 0, archer: 0, cavalry: 0 },
  equip: { weapon: null, armor: null, treasure: null },
  gold: C.START_GOLD, exp: 0
};
const BUY_ORDER = ['spear', 'cavalry', 'archer', 'spear'];
const UP_ORDER = ['spear', 'war', 'archer', 'lead', 'cavalry', 'hp'];   // 兵種等級與主將能力輪流
// 商店裝備依價格由低到高，輪流買武器 / 防具 / 寶物
const SHOP = Object.keys(S.EQUIPMENT).filter(id => S.EQUIPMENT[id].price > 0)
  .sort((a, b) => S.EQUIPMENT[a].price - S.EQUIPMENT[b].price);
let buyIdx = 0, upIdx = 0;
const owned = new Set();

function equipIfBetter(id) {
  const it = S.EQUIPMENT[id], cur = S.EQUIPMENT[profile.equip[it.slot]];
  if (!cur || S.equipValue(it) > S.equipValue(cur)) profile.equip[it.slot] = id;
}

function spend() {
  while (profile.soldiers.length < C.MAX_UNITS && profile.gold >= C.PRICE[BUY_ORDER[buyIdx % BUY_ORDER.length]]) {
    const t = BUY_ORDER[buyIdx++ % BUY_ORDER.length];
    profile.gold -= C.PRICE[t];
    profile.soldiers.push(t);
  }
  if (profile.soldiers.length >= C.MAX_UNITS) {
    for (const id of SHOP) {
      if (owned.has(id) || profile.gold < S.EQUIPMENT[id].price) continue;
      profile.gold -= S.EQUIPMENT[id].price;
      owned.add(id);
      equipIfBetter(id);
    }
  }
  while (profile.exp >= Math.max(C.LEVEL_COST, C.STAT_COST)) {
    const k = UP_ORDER[upIdx++ % UP_ORDER.length];
    if (profile.levels[k] != null) { profile.levels[k]++; profile.exp -= C.LEVEL_COST; }
    else if (profile.general[k] < C.STAT_MAX) {
      profile.general[k] = Math.min(C.STAT_MAX, profile.general[k] + C.STAT_STEP);
      profile.exp -= C.STAT_COST;
    }
  }
}

function reward(st) {
  profile.gold += st.gold;
  profile.exp += st.exp;
  (st.drops || []).forEach(id => { owned.add(id); equipIfBetter(id); });
}

S.STAGES.forEach((st, k) => {
  spend();
  if (only && only.indexOf(k + 1) < 0) { reward(st); return; }
  const armies = [S.playerArmy(profile), Object.assign({}, st.general, { units: st.units.slice() })];
  const levels = [S.playerLevels(profile), S.stageLevels(st)];
  let w = 0, time = 0, timeouts = 0;
  for (let i = 0; i < n; i++) {
    const b = new S.Battle(armies, { levels });
    while (b.state === 'fighting') b.step(S.SIM_DT);
    if (b.winner === 0) w++;
    if (b.timedOut) timeouts++;
    time += b.time;
  }
  const lv = profile.levels, a = armies[0];
  const eq = S.EQUIP_SLOT_KEYS.map(s => profile.equip[s] ? S.EQUIPMENT[profile.equip[s]].name : '—').join('/');
  console.log(`第${k + 1}關 ${st.general.name} 勝率 ${(w / n * 100).toFixed(0)}% 平均${(time / n).toFixed(0)}s` +
    (timeouts ? ` 超時${timeouts}` : '') +
    ` | 兵${profile.soldiers.length} Lv 槍${lv.spear} 弓${lv.archer} 騎${lv.cavalry}` +
    ` 體${a.hp} 武${a.war} 智${a.int} 統${a.lead} 裝備 ${eq} 剩金${profile.gold}`);
  reward(st);
});
