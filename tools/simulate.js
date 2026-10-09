// 無畫面批次模擬，用於驗證邏輯與平衡：node tools/simulate.js [場數] [random] [seed]
// 預設每場使用加密亂數；加上 seed 參數則以固定種子重現
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.window = {};
for (const f of ['config.js', 'sprites.js', 'battle.js', 'tactics.js', 'elites.js', 'skills.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
}
const S = window.Sango;

// 檢查點陣圖尺寸
for (const [type, frames] of Object.entries(S.SPRITE_DATA)) {
  frames.forEach((rows, i) => {
    rows.forEach((r, y) => {
      if (r.length !== 16 || rows.length !== 16) throw new Error(`${type}[${i}] row ${y} len ${r.length}`);
    });
  });
}
S.PORTRAIT_DATA.forEach((r, y) => { if (r.length !== 24) throw new Error(`portrait row ${y} len ${r.length}`); });

const n = Number(process.argv[2] || 200);
const randomize = process.argv[3] === 'random';
const baseSeed = process.argv[4] != null ? Number(process.argv[4]) : null;
const wins = [0, 0, 0];
let totalTime = 0, maxTime = 0, timeouts = 0;
const skillUses = {}, tacticUses = {}, chestOpens = {};
let ambushes = 0;

for (let i = 0; i < n; i++) {
  const armies = S.DEFAULT_ARMIES.map(a => Object.assign({}, a, {
    units: randomize ? Array.from({ length: 9 }, () => S.UNIT_KINDS[Math.floor(S.random() * 3)]) : a.units.slice()
  }));
  const b = new S.Battle(armies, { seed: baseSeed != null ? baseSeed + i : null });
  while (b.state === 'fighting') b.step(S.SIM_DT);
  wins[b.winner === -1 ? 2 : b.winner]++;
  totalTime += b.time;
  maxTime = Math.max(maxTime, b.time);
  if (b.timedOut) timeouts++;
  for (const [k, v] of Object.entries(b.skillUses)) skillUses[k] = (skillUses[k] || 0) + v;
  for (const [k, v] of Object.entries(b.tacticUses)) tacticUses[k] = (tacticUses[k] || 0) + v;
  for (const [k, v] of Object.entries(b.chestOpens)) chestOpens[k] = (chestOpens[k] || 0) + v;
  if (b.ambushDone) ambushes++;
  if (i === 0) console.log(b.log.slice(0, 8).join('\n') + '\n...\n' + b.log.slice(-3).join('\n'));
}
console.log(`\n${n} 場：${S.DEFAULT_ARMIES[0].name} 勝 ${wins[0]}，${S.DEFAULT_ARMIES[1].name} 勝 ${wins[1]}，平手 ${wins[2]}`);
console.log(`平均 ${(totalTime / n).toFixed(1)}s，最長 ${maxTime.toFixed(1)}s，超時 ${timeouts}`);
console.log('每場平均特技次數：' + Object.entries(skillUses).map(([k, v]) => `${k} ${(v / n).toFixed(1)}`).join('，'));
const perGame = o => Object.entries(o).map(([k, v]) => `${k} ${(v / n).toFixed(2)}`).join('，');
console.log('每場平均計策次數：' + perGame(tacticUses));
console.log('每場平均開啟寶箱：' + perGame(chestOpens));
console.log(`伏兵出現 ${ambushes} 場`);
