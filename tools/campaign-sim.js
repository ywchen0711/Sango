// 過關模式平衡模擬：假設玩家每關首次過關後把金錢與經驗值花完，
// 以電腦代打雙方，估計每一關的勝率。node tools/campaign-sim.js [每關場數]
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
const only = process.argv[3] ? process.argv[3].split(',').map(Number) : null;   // 只模擬指定關卡，例如 5,6,7

// 平均分配點數、初始士兵 槍2 弓2 騎1
const each = C.CREATE.BASE + C.CREATE.POINTS / 4;
const player = {
  general: { name: '玩家', hp: each, war: each, int: each, lead: each, beard: null },
  soldiers: ['spear', 'spear', 'archer', 'archer', 'cavalry'],
  levels: { spear: 0, archer: 0, cavalry: 0 },
  gold: C.START_GOLD, exp: 0
};
const BUY_ORDER = ['spear', 'cavalry', 'archer', 'spear'];
const UP_ORDER = ['spear', 'war', 'archer', 'lead', 'cavalry', 'hp'];   // 兵種等級與主將能力輪流
let buyIdx = 0, upIdx = 0;

function spend() {
  while (player.soldiers.length < C.MAX_UNITS && player.gold >= C.PRICE[BUY_ORDER[buyIdx % BUY_ORDER.length]]) {
    const t = BUY_ORDER[buyIdx++ % BUY_ORDER.length];
    player.gold -= C.PRICE[t];
    player.soldiers.push(t);
  }
  while (player.exp >= Math.max(C.LEVEL_COST, C.STAT_COST)) {
    const k = UP_ORDER[upIdx++ % UP_ORDER.length];
    if (player.levels[k] != null) { player.levels[k]++; player.exp -= C.LEVEL_COST; }
    else if (player.general[k] < C.STAT_MAX) {
      player.general[k] = Math.min(C.STAT_MAX, player.general[k] + C.STAT_STEP);
      player.exp -= C.STAT_COST;
    }
  }
}

S.STAGES.forEach((st, k) => {
  spend();
  if (only && only.indexOf(k + 1) < 0) { player.gold += st.gold; player.exp += st.exp; return; }
  const armies = [
    Object.assign({}, player.general, { units: player.soldiers.slice() }),
    Object.assign({}, st.general, { units: st.units.slice() })
  ];
  const elv = S.stageLevels(st);
  let w = 0, time = 0;
  for (let i = 0; i < n; i++) {
    const b = new S.Battle(armies, { levels: [player.levels, elv] });
    while (b.state === 'fighting') b.step(S.SIM_DT);
    if (b.winner === 0) w++;
    time += b.time;
  }
  const lv = player.levels, g = player.general;
  console.log(`第${k + 1}關 ${st.general.name} 勝率 ${(w / n * 100).toFixed(0)}% 平均${(time / n).toFixed(0)}s` +
    ` | 玩家 兵${player.soldiers.length} Lv 槍${lv.spear} 弓${lv.archer} 騎${lv.cavalry}` +
    ` 體${g.hp} 武${g.war} 智${g.int} 統${g.lead} 剩金${player.gold}`);
  player.gold += st.gold;
  player.exp += st.exp;
});
