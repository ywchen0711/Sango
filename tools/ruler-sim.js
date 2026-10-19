// 君主模式模擬：每位君主用「智能判斷」自動回覆 (出征也自動)，一路推進月份，看天下大勢與有沒有壞掉的數字
// node tools/ruler-sim.js [每位君主的局數] [最多幾年]
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.window = {};
for (const f of ['i18n.js', 'ruler.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
const R = window.Sango.Ruler;
const games = Number(process.argv[2] || 4), years = Number(process.argv[3] || 40);
let bad = 0;

function check(G, who) {
  for (const c of Object.values(G.cities)) for (const k of ['farm', 'com', 'def', 'order', 'troops', 'train', 'gold', 'food']) {
    if (!Number.isFinite(c[k]) || c[k] < 0) { bad++; if (bad < 10) console.log(`  !! ${who} ${G.year}/${G.month} ${c.id}.${k} = ${c[k]}`); }
  }
  for (const o of Object.values(G.officers)) if (!o.gone && !G.cities[o.city]) { bad++; if (bad < 10) console.log(`  !! ${who} officer ${o.id} in ${o.city}`); }
}

for (const lord of R.LORD_ORDER) {
  const out = [];
  for (let g = 0; g < games; g++) {
    const G = R.newGame(lord);
    G.settings.auto = 'smart'; G.settings.askAttack = false;
    let decided = 0, approved = 0, peak = 0;
    for (let m = 0; m < years * 12 && !G.over; m++) {
      const done = R.pump(); decided += done.length; approved += done.filter((d) => d.ok).length;
      if (G.queue.length) throw new Error('queue stuck: ' + JSON.stringify(G.queue[0]));
      R.nextMonth(); check(G, lord);
      peak = Math.max(peak, R.citiesOf(lord).length);
    }
    out.push(`${G.over || 'ongoing'}@${G.year} cities ${R.citiesOf(lord).length} (peak ${peak}) offs ${R.officersOf(lord).length} props ${decided} ok ${approved}`);
  }
  console.log(R.lordName(lord).padEnd(4), '\n   ' + out.join('\n   '));
}
console.log(bad ? `BAD values: ${bad}` : 'all values sane');
process.exit(bad ? 1 : 0);
