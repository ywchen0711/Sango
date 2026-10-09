/*
 * 探索模式：仿暗黑破壞神的大地圖 (戰場的 20 倍大)，四處探索、擊破敵營、開寶箱，最後打倒敵將
 * 一張探索地圖有好幾個「區域」：areas[0] 是野外，其他是洞穴 / 地下迷宮 (走到入口切換場景)
 * 這個檔案只負責產生地圖與配置 (不依賴 DOM)；戰鬥規則在 battle.js / tactics.js 以 battle.explore 區分
 */
(function (S) {
  'use strict';

  S.EXPLORE = {
    COLS: 144,                // 144 x 96 = 13824 格，約為 32 x 22 戰場的 20 倍
    ROWS: 96,
    AGGRO: 8,                 // 我軍靠近幾格內，敵營醒來
    CHASE: 13,                // 醒著的敵人追擊範圍
    LEASH: 22,                // 敵人離開營地超過幾格就回營
    ENGAGE: 9,                // 我軍士兵自動迎擊的範圍
    GENERAL_ENGAGE: 14,       // 主將沒有被操控時，主動攻擊看得到的敵人的範圍
    FOLLOW: 3,                // 士兵和主將保持的距離
    VISION: 9,                // 視野半徑
    REGEN: 0.04,              // 非戰鬥時每秒回復最大兵力的比例
    REGEN_SAFE: 7,            // 附近幾格內沒有醒著的敵人才會回復
    HERO_HP: 2,               // 主將是英雄：兵力為一般戰鬥的幾倍
    COHESION: 4,              // 主將移動時，等到一半以上的士兵在幾格內才繼續前進
    CAMPS: [6, 0.4],          // 敵營數 = 6 + 關卡 × 0.4 (擊破一座敵營有一隊陣亡的士兵歸隊)
    CAMP_SIZE: [3, 6],        // 每座敵營的士兵數 (會隨關卡增加)
    CHESTS: 14,               // 寶箱數 (其中 LOOT_CHESTS 個是裝備箱)
    LOOT_CHESTS: 5,
    SHRINES: 5,               // 神壇數 (見 elites.js)
    WANDERERS: [2, 4],        // 流浪武者人數 (打倒後有機率加入)
    RECRUIT_CHANCE: { magic: 0.5, rare: 0.35, unique: 0.25 },
    CAVES: [2, 3],            // 洞穴 / 地下迷宮入口數
    REWARD_MULT: 2            // 過關的金錢 / 經驗為一般出征的幾倍
  };

  // ---- 地貌 (地圖字元)：wall 不能通過；move 移動時間倍率；rangedDef 站在上面受到的遠程傷害倍率；burn 每秒損失最大兵力的比例 ----
  S.TERRAIN = {
    '.': { name: '平地' },
    '#': { name: '岩石', wall: true },
    '~': { name: '深水', wall: true },
    'T': { name: '樹木', wall: true },
    'f': { name: '森林', move: 1.25, rangedDef: 0.75, desc: '移動稍慢，受到的遠程傷害 -25%' },
    's': { name: '沼澤', move: 1.7, desc: '移動很慢' },
    'i': { name: '冰原', move: 0.75, desc: '移動加快' },
    'l': { name: '熔岩', move: 1.1, burn: 0.04, desc: '站在上面每秒損失 4% 兵力' }
  };

  // ---- 動物：aggro = 我軍靠近幾格會被驚動；passive = 不攻擊、會逃跑 ----
  S.ANIMALS = {
    wolf: { name: '野狼', aggro: 8, pack: [2, 3], desc: '成群出沒，主動攻擊' },
    boar: { name: '野豬', aggro: 3, pack: [1, 2], desc: '靠近或被攻擊才會衝撞' },
    bear: { name: '熊',   aggro: 5, pack: [1, 1], desc: '強悍，打倒可能掉落裝備' },
    deer: { name: '鹿',   aggro: 6, pack: [2, 3], passive: true, desc: '會逃跑，獵到可讓全軍回復兵力' }
  };
  // 動物的能力 (preset)：隨關卡 / 難度的等級成長
  S.animalPreset = function (kind, lv) {
    var t = S.UNIT_TYPES[kind], m = 1 + lv * S.LEVEL.BONUS;
    return { name: S.ANIMALS[kind].name, lv: lv, hp: Math.round(t.hp * m), mp: 0, atk: Math.round(t.atk * m), def: Math.round(t.def * m),
             int: 0, spr: Math.round(t.spr * m), physSkills: [], magicSkills: [] };
  };

  // ======================= 共用工具 =======================
  function tools(rng, W, H) {
    var T = {};
    T.ri = function (a, b) { return a + Math.floor(rng() * (b - a + 1)); };
    T.cheb = function (ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); };
    T.grid = function (fill) {
      var g = [];
      for (var y = 0; y < H; y++) { g.push([]); for (var x = 0; x < W; x++) g[y].push(x === 0 || y === 0 || x === W - 1 || y === H - 1 ? '#' : fill); }
      return g;
    };
    T.isWall = function (ch) { return S.TERRAIN[ch].wall; };
    // 以 (cx, cy) 為中心、半徑 r 的不規則斑塊
    T.blob = function (g, cx, cy, r, ch, ok) {
      for (var y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
        for (var x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
          if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) continue;
          var d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
          if (d <= r + (rng() - 0.5) * 1.2 && (!ok || ok(x, y))) g[y][x] = typeof ch === 'function' ? ch(x, y) : ch;
        }
      }
    };
    // 四方向 BFS (只看牆)
    T.bfs = function (g, sx, sy) {
      var dist = new Array(W * H).fill(-1), q = [sy * W + sx];
      dist[q[0]] = 0;
      for (var h = 0; h < q.length; h++) {
        var c = q[h], cx = c % W, cy = (c / W) | 0;
        for (var k = 0; k < 4; k++) {
          var nx = cx + [1, -1, 0, 0][k], ny = cy + [0, 0, 1, -1][k], n = ny * W + nx;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || T.isWall(g[ny][nx]) || dist[n] >= 0) continue;
          dist[n] = dist[c] + 1;
          q.push(n);
        }
      }
      return dist;
    };
    // 迷宮 (遞迴回溯)：在 (x0, y0) 起、cw × ch 個房格，每格 cell 寬 (通道 cell-1 格 + 牆 1 格)
    T.maze = function (g, x0, y0, cw, chh, cell) {
      var w = cw * cell + 1, h = chh * cell + 1;
      for (var y = y0; y < y0 + h; y++) for (var x = x0; x < x0 + w; x++) g[y][x] = '#';
      var seen = {}, stack = [[0, 0]], ends = [];
      function open(cx, cy) {
        for (var yy = 0; yy < cell - 1; yy++) for (var xx = 0; xx < cell - 1; xx++) g[y0 + 1 + cy * cell + yy][x0 + 1 + cx * cell + xx] = '.';
      }
      seen['0,0'] = true; open(0, 0);
      var depth = { '0,0': 0 };
      while (stack.length) {
        var cur = stack[stack.length - 1], nb = [];
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          var nx = cur[0] + d[0], ny = cur[1] + d[1];
          if (nx >= 0 && ny >= 0 && nx < cw && ny < chh && !seen[nx + ',' + ny]) nb.push([nx, ny, d]);
        });
        if (!nb.length) {
          if (stack.length > 1) ends.push(cur);
          stack.pop();
          continue;
        }
        var n = nb[Math.floor(rng() * nb.length)], d2 = n[2];
        // 打通兩格之間的牆
        for (var t = 0; t < cell - 1; t++) {
          var wx = x0 + 1 + cur[0] * cell + (d2[0] > 0 ? cell - 1 : d2[0] < 0 ? -1 : t);
          var wy = y0 + 1 + cur[1] * cell + (d2[1] > 0 ? cell - 1 : d2[1] < 0 ? -1 : t);
          g[wy][wx] = '.';
        }
        seen[n[0] + ',' + n[1]] = true;
        depth[n[0] + ',' + n[1]] = depth[cur[0] + ',' + cur[1]] + 1;
        open(n[0], n[1]);
        stack.push([n[0], n[1]]);
      }
      // 回傳死路 (由深到淺) 的格子中心
      return ends.map(function (e) { return { x: x0 + 1 + e[0] * cell, y: y0 + 1 + e[1] * cell, depth: depth[e[0] + ',' + e[1]] }; })
        .sort(function (a, b) { return b.depth - a.depth; });
    };
    return T;
  }

  // 在一個區域裡找空位放東西 (避開牆、熔岩、已佔用的格子、走不到的地方)
  function placer(g, dist, W, H) {
    var used = {};
    function key(x, y) { return y * W + x; }
    function okCell(x, y) {
      return x > 0 && y > 0 && x < W - 1 && y < H - 1 && !S.TERRAIN[g[y][x]].wall && g[y][x] !== 'l' && !used[key(x, y)] && dist[key(x, y)] >= 0;
    }
    var floor = [];
    for (var y = 1; y < H - 1; y++) for (var x = 1; x < W - 1; x++) if (okCell(x, y)) floor.push({ x: x, y: y });
    return {
      used: used, floor: floor, okCell: okCell,
      take: function (x, y) { used[key(x, y)] = true; },
      around: function (cx, cy, n) {
        var out = [];
        for (var rr = 0; rr < 7 && out.length < n; rr++) {
          for (var yy = cy - rr; yy <= cy + rr && out.length < n; yy++) {
            for (var xx = cx - rr; xx <= cx + rr && out.length < n; xx++) {
              if (Math.max(Math.abs(xx - cx), Math.abs(yy - cy)) !== rr || !okCell(xx, yy)) continue;
              used[key(xx, yy)] = true;
              out.push({ x: xx, y: yy });
            }
          }
        }
        return out;
      },
      // 隨機找一格：離 avoid 中的點都至少 gap 格
      spot: function (rng, avoid, tries) {
        for (var t = 0; t < (tries || 3000); t++) {
          var p = floor[Math.floor(rng() * floor.length)];
          if (!okCell(p.x, p.y)) continue;
          if (avoid.some(function (a) { return Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) < a.gap; })) continue;
          return p;
        }
        return null;
      }
    };
  }

  // ======================= 產生探索地圖 =======================
  // 回傳 { areas: [{ name, theme, cols, rows, map, chests, shrines, portals }], spawns (含 area), start, startCells, boss, ilvl, ... }
  // 為了相容舊程式，cols / rows / map / chests / shrines 也指向野外 (areas[0])
  S.makeExplore = function (stageIdx, rng, diff) {
    rng = rng || S.random;
    var D = S.DIFFICULTIES[diff || 'normal'];
    var E = S.EXPLORE, W = E.COLS, H = E.ROWS, st = S.STAGES[stageIdx];
    var ilvl = stageIdx + 1 + D.ilvl;
    var T = tools(rng, W, H), ri = T.ri, cheb = T.cheb;
    var g = T.grid('.');
    var x, y, i;

    var start = { x: 7, y: H - 8 };
    var boss = { x: W - 10, y: 9 };
    function nearKey(px, py, r) { return cheb(px, py, start.x, start.y) <= r || cheb(px, py, boss.x, boss.y) <= r; }
    function notKey(r) { return function (px, py) { return !nearKey(px, py, r); }; }

    // ---- 地貌 ----
    // 森林 (裡面偶爾有樹木擋路)
    for (i = 0; i < 9; i++) T.blob(g, ri(5, W - 6), ri(5, H - 6), 3 + rng() * 4, function () { return rng() < 0.14 ? 'T' : 'f'; }, notKey(7));
    // 沼澤、冰原
    for (i = 0; i < 3; i++) T.blob(g, ri(5, W - 6), ri(5, H - 6), 2.5 + rng() * 3, 's', notKey(8));
    for (i = 0; i < 2; i++) T.blob(g, ri(5, W - 6), ri(5, H / 2), 3 + rng() * 4, 'i', notKey(8));
    // 熔岩 (第 4 關以後)
    if (stageIdx >= 3) for (i = 0; i < 2 + Math.floor(stageIdx / 4); i++) T.blob(g, ri(10, W - 11), ri(10, H - 11), 1.5 + rng() * 2.5, 'l', notKey(12));
    // 湖泊
    for (i = 0; i < 3; i++) T.blob(g, ri(15, W - 16), ri(10, H - 11), 2.5 + rng() * 3, '~', notKey(12));
    // 河流：由上到下蜿蜒，每隔一段留淺灘
    var rx = ri(45, W - 50), fordEvery = ri(14, 20);
    for (y = 1; y < H - 1; y++) {
      if (y % 3 === 0) rx = Math.max(30, Math.min(W - 30, rx + ri(-1, 1)));
      var ford = y % fordEvery < 3;
      for (var dx = 0; dx < 2; dx++) if (!ford) g[y][rx + dx] = '~'; else if (g[y][rx + dx] === '~') g[y][rx + dx] = '.';
    }
    // 岩石群
    var blobs = Math.round(W * H / 300);
    for (i = 0; i < blobs; i++) T.blob(g, ri(2, W - 3), ri(2, H - 3), 1 + rng() * 2.4, '#', notKey(6));
    // 城寨廢墟：矩形城牆，每面牆留缺口
    for (i = 0; i < 6; i++) {
      var rw = ri(7, 14), rh = ri(6, 10), rx0 = ri(3, W - rw - 4), ry0 = ri(3, H - rh - 4);
      if (nearKey(rx0 + rw / 2, ry0 + rh / 2, 12)) continue;
      for (x = rx0; x < rx0 + rw; x++) { g[ry0][x] = '#'; g[ry0 + rh - 1][x] = '#'; }
      for (y = ry0; y < ry0 + rh; y++) { g[y][rx0] = '#'; g[y][rx0 + rw - 1] = '#'; }
      for (y = ry0 + 1; y < ry0 + rh - 1; y++) for (x = rx0 + 1; x < rx0 + rw - 1; x++) g[y][x] = '.';
      var gx = rx0 + ri(2, rw - 4), gy = ry0 + ri(2, rh - 4);
      g[ry0][gx] = g[ry0][gx + 1] = '.'; g[ry0 + rh - 1][gx] = g[ry0 + rh - 1][gx + 1] = '.';
      g[gy][rx0] = g[gy + 1][rx0] = '.'; g[gy][rx0 + rw - 1] = g[gy + 1][rx0 + rw - 1] = '.';
    }
    // 野外的迷宮：一座小迷宮，最深處有寶箱
    var mzCw = 7, mzCh = 5, mzCell = 3, mzW = mzCw * mzCell + 1, mzH = mzCh * mzCell + 1;
    var mx = ri(25, W - mzW - 25), my = ri(20, H - mzH - 20);
    var mazeEnds = T.maze(g, mx, my, mzCw, mzCh, mzCell);
    g[my + 1][mx] = g[my + 2][mx] = '.';   // 入口 (左上)
    // 敵將據點：圍牆 + 正面缺口；起點與據點周圍清空
    for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) if (nearKey(x, y, 5) && g[y][x] !== '#') g[y][x] = '.';
    for (x = boss.x - 5; x <= boss.x + 5; x++) g[boss.y + 5][x] = Math.abs(x - boss.x) > 1 ? '#' : '.';
    for (y = boss.y - 5; y <= boss.y + 5; y++) if (y > 0) g[y][boss.x - 6] = Math.abs(y - boss.y) > 1 ? '#' : '.';
    for (y = boss.y - 4; y <= boss.y + 4; y++) for (x = boss.x - 5; x <= boss.x + 5; x++) if (y > 0 && x < W - 1) g[y][x] = '.';

    // ---- 連通：走不到敵將就挖路；走不到的空地填成岩石 ----
    var dist = T.bfs(g, start.x, start.y);
    if (dist[boss.y * W + boss.x] < 0) {
      for (x = start.x; x <= boss.x; x++) for (var k = -1; k <= 1; k++) g[start.y + k][x] = '.';
      for (y = boss.y; y <= start.y; y++) for (k = -1; k <= 1; k++) g[y][boss.x + k] = '.';
      dist = T.bfs(g, start.x, start.y);
    }
    for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) if (!S.TERRAIN[g[y][x]].wall && dist[y * W + x] < 0) g[y][x] = '#';

    var P = placer(g, dist, W, H);
    var spawns = [], campSeq = 1;

    // 敵將據點：敵將 + 該關的完整軍隊
    var bossCells = P.around(boss.x, boss.y, st.units.length + 1);
    spawns.push({ type: 'general', x: bossCells[0].x, y: bossCells[0].y, camp: 0, area: 0 });
    st.units.forEach(function (t, j) { if (bossCells[j + 1]) spawns.push({ type: t, x: bossCells[j + 1].x, y: bossCells[j + 1].y, camp: 0, area: 0 }); });
    if (D.lv > 0) spawns.filter(function (sp) { return sp.camp === 0 && sp.type !== 'general'; }).slice(0, D.lv >= 12 ? 2 : 1)
      .forEach(function (sp) { sp.elite = S.rollEliteAffixes(rng); });

    // 一般敵營
    var sizeBonus = Math.floor(stageIdx / 4);
    var avoid = [{ x: start.x, y: start.y, gap: 20 }, { x: boss.x, y: boss.y, gap: 14 }];
    function addCamp(area, plc, cx, cy, n, eliteChance) {
      var id = campSeq++, hasElite = rng() < eliteChance;
      plc.around(cx, cy, n).forEach(function (cell, kk) {
        spawns.push({ type: st.units[Math.floor(rng() * st.units.length)], x: cell.x, y: cell.y, camp: id, area: area,
                      elite: hasElite && kk === 0 ? S.rollEliteAffixes(rng) : null });
      });
      return id;
    }
    var nCamps = Math.round(E.CAMPS[0] + stageIdx * E.CAMPS[1]), centers = [];
    for (i = 0; i < nCamps; i++) {
      var c = P.spot(rng, avoid.concat(centers.map(function (cc) { return { x: cc.x, y: cc.y, gap: 15 }; })));
      if (!c) break;
      centers.push(c);
      addCamp(0, P, c.x, c.y, ri(E.CAMP_SIZE[0], E.CAMP_SIZE[1]) + sizeBonus, D.campElite);
    }
    var lvBase = S.stageLevels(st, diff || 'normal').spear;

    // 動物群
    var animalAvoid = [{ x: start.x, y: start.y, gap: 14 }, { x: boss.x, y: boss.y, gap: 12 }];
    [['wolf', 2], ['boar', 3], ['bear', (stageIdx >= 1 ? 1 : 0) + (stageIdx >= 4 ? 1 : 0)], ['deer', 2]].forEach(function (a) {
      for (var j = 0; j < a[1]; j++) {
        var p = P.spot(rng, animalAvoid);
        if (!p) return;
        animalAvoid.push({ x: p.x, y: p.y, gap: 10 });
        var id = campSeq++, def = S.ANIMALS[a[0]];
        P.around(p.x, p.y, ri(def.pack[0], def.pack[1])).forEach(function (cell) {
          spawns.push({ type: a[0], animal: a[0], lv: lvBase + (a[0] === 'bear' ? 2 : 0), x: cell.x, y: cell.y, camp: id, area: 0 });
        });
      }
    });

    // 寶箱：遠離起點，前 LOOT_CHESTS 個是裝備箱；迷宮最深處放一個稀有寶箱
    var chests = [];
    if (mazeEnds.length && P.okCell(mazeEnds[0].x, mazeEnds[0].y)) { P.take(mazeEnds[0].x, mazeEnds[0].y); chests.push({ x: mazeEnds[0].x, y: mazeEnds[0].y, loot: true, quality: 'rare' }); }
    var chestAvoid = [{ x: start.x, y: start.y, gap: 12 }];
    while (chests.length < E.CHESTS + 1) {
      var q2 = P.spot(rng, chestAvoid.concat(chests.map(function (cc) { return { x: cc.x, y: cc.y, gap: 8 }; })));
      if (!q2) break;
      P.take(q2.x, q2.y);
      chests.push({ x: q2.x, y: q2.y, loot: chests.length <= E.LOOT_CHESTS });
    }

    // 神壇
    var shrines = [], kinds = S.pickDistinct(S.SHRINE_KEYS, E.SHRINES, rng);
    while (shrines.length < kinds.length) {
      var q3 = P.spot(rng, [{ x: start.x, y: start.y, gap: 15 }].concat(shrines.map(function (cc) { return { x: cc.x, y: cc.y, gap: 18 }; })));
      if (!q3) break;
      P.take(q3.x, q3.y);
      shrines.push({ x: q3.x, y: q3.y, type: kinds[shrines.length] });
    }

    // 流浪武者
    function addWanderer(area, plc, p) {
      var uniques = Object.keys(S.UNIQUE_SOLDIERS).filter(function (id) { return S.UNIQUE_SOLDIERS[id].ilvl <= ilvl; });
      var r = rng(), sol;
      if (uniques.length && r < 0.08) sol = S.makeSoldier({ unique: uniques[Math.floor(rng() * uniques.length)], ilvl: ilvl, lv: lvBase + 2 });
      else sol = S.makeSoldier({ q: r < 0.6 ? 'magic' : 'rare', ilvl: ilvl, lv: lvBase + 2 });
      plc.take(p.x, p.y);
      spawns.push({ type: S.CLASSES[sol.cls].type, x: p.x, y: p.y, camp: 1000 + campSeq++, wanderer: sol, area: area });
    }
    var nW = ri(E.WANDERERS[0], E.WANDERERS[1]), wSpots = [];
    for (i = 0; i < nW; i++) {
      var q4 = P.spot(rng, [{ x: start.x, y: start.y, gap: 18 }, { x: boss.x, y: boss.y, gap: 14 }]
        .concat(centers.map(function (cc) { return { x: cc.x, y: cc.y, gap: 8 }; }))
        .concat(wSpots.map(function (cc) { return { x: cc.x, y: cc.y, gap: 15 }; })));
      if (!q4) break;
      wSpots.push(q4);
      addWanderer(0, P, q4);
    }

    // ---- 洞穴 / 地下迷宮 ----
    var areas = [{ name: '野外', theme: 'grass', cols: W, rows: H, chests: chests, shrines: shrines, portals: [] }];
    var nCaves = ri(E.CAVES[0], E.CAVES[1]), caveSpots = [];
    for (i = 0; i < nCaves; i++) {
      var ent = P.spot(rng, [{ x: start.x, y: start.y, gap: 16 }, { x: boss.x, y: boss.y, gap: 16 }]
        .concat(caveSpots.map(function (cc) { return { x: cc.x, y: cc.y, gap: 30 }; })));
      if (!ent) break;
      caveSpots.push(ent);
      P.take(ent.x, ent.y);
      var kind = i % 2 === 0 ? 'cavern' : 'labyrinth';
      var cave = makeCave(kind, areas.length, ent);
      areas[0].portals.push({ x: ent.x, y: ent.y, to: areas.length, tx: cave.entry.x, ty: cave.entry.y, name: cave.name });
      areas.push(cave);
    }

    function makeCave(kind, areaIdx, back) {
      var CW = kind === 'labyrinth' ? 57 : 64, CH = kind === 'labyrinth' ? 37 : 44;
      var C = tools(rng, CW, CH), cg, entry, chestsC = [], spots;
      if (kind === 'cavern') {
        // 天然洞窟：細胞自動機產生不規則岩洞
        cg = C.grid('.');
        for (var yy = 1; yy < CH - 1; yy++) for (var xx = 1; xx < CW - 1; xx++) cg[yy][xx] = rng() < 0.43 ? '#' : '.';
        for (var it = 0; it < 4; it++) {
          var ng = cg.map(function (row) { return row.slice(); });
          for (yy = 1; yy < CH - 1; yy++) for (xx = 1; xx < CW - 1; xx++) {
            var walls = 0;
            for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) if (cg[yy + oy][xx + ox] === '#') walls++;
            ng[yy][xx] = walls >= 5 ? '#' : '.';
          }
          cg = ng;
        }
        entry = { x: 4, y: CH >> 1 };
        for (yy = entry.y - 2; yy <= entry.y + 2; yy++) for (xx = 1; xx <= 7; xx++) cg[yy][xx] = '.';
        // 少量地底水窪與熔岩
        for (it = 0; it < 3; it++) C.blob(cg, C.ri(12, CW - 6), C.ri(4, CH - 5), 1 + rng() * 2, '~', function (px) { return px > 10; });
        if (stageIdx >= 2) C.blob(cg, C.ri(20, CW - 6), C.ri(4, CH - 5), 1 + rng() * 1.5, 'l', function (px) { return px > 14; });
      } else {
        // 地下迷宮
        cg = C.grid('#');
        var ends = C.maze(cg, 0, 0, 14, 9, 4).filter(function (e) { return e.depth > 4; });
        entry = { x: 2, y: 2 };
        spots = ends;
      }
      var cdist = C.bfs(cg, entry.x, entry.y);
      for (yy = 1; yy < CH - 1; yy++) for (xx = 1; xx < CW - 1; xx++) if (!S.TERRAIN[cg[yy][xx]].wall && cdist[yy * CW + xx] < 0) cg[yy][xx] = '#';
      var CP = placer(cg, cdist, CW, CH);
      CP.take(entry.x, entry.y);
      var cAvoid = [{ x: entry.x, y: entry.y, gap: 10 }];
      if (kind === 'cavern') {
        for (var ci = 0; ci < 3 + (stageIdx >= 5 ? 1 : 0); ci++) {
          var cc = CP.spot(rng, cAvoid);
          if (!cc) break;
          cAvoid.push({ x: cc.x, y: cc.y, gap: 10 });
          addCamp(areaIdx, CP, cc.x, cc.y, ri(3, 5) + sizeBonus, Math.min(1, D.campElite + 0.25));
        }
        var bp = CP.spot(rng, cAvoid);
        if (bp) {
          var bid = campSeq++;
          CP.around(bp.x, bp.y, 1 + (stageIdx >= 5 ? 1 : 0)).forEach(function (cell) {
            spawns.push({ type: 'bear', animal: 'bear', lv: lvBase + 3, x: cell.x, y: cell.y, camp: bid, area: areaIdx });
          });
        }
        if (rng() < 0.5) { var wp = CP.spot(rng, cAvoid); if (wp) addWanderer(areaIdx, CP, wp); }
        while (chestsC.length < 5) {
          var q5 = CP.spot(rng, [{ x: entry.x, y: entry.y, gap: 8 }].concat(chestsC.map(function (c2) { return { x: c2.x, y: c2.y, gap: 6 }; })));
          if (!q5) break;
          CP.take(q5.x, q5.y);
          chestsC.push({ x: q5.x, y: q5.y, loot: chestsC.length < 3 });
        }
      } else {
        // 迷宮：死路盡頭放裝備箱，最深處有精英守著稀有寶箱
        spots.slice(0, 5).forEach(function (e2, j) {
          if (!CP.okCell(e2.x, e2.y)) return;
          CP.take(e2.x, e2.y);
          chestsC.push({ x: e2.x, y: e2.y, loot: true, quality: j === 0 ? 'rare' : null });
          if (j === 0) addCamp(areaIdx, CP, e2.x + 1, e2.y + 1, 3 + sizeBonus, 1);
        });
        for (ci = 0; ci < 4; ci++) {
          var mc = CP.spot(rng, cAvoid);
          if (!mc) break;
          cAvoid.push({ x: mc.x, y: mc.y, gap: 8 });
          addCamp(areaIdx, CP, mc.x, mc.y, 2 + sizeBonus, D.campElite);
        }
      }
      var names = kind === 'cavern' ? ['黑風洞', '盤蛇窟', '幽谷洞', '寒潭洞', '赤焰窟'] : ['八陣迷宮', '地下迷城', '幽冥迷宮', '鬼門迷宮'];
      return {
        name: names[Math.floor(rng() * names.length)], theme: 'cave', kind: kind, cols: CW, rows: CH,
        map: cg.map(function (row) { return row.join(''); }), entry: entry, chests: chestsC, shrines: [],
        portals: [{ x: entry.x - 1 >= 1 ? entry.x - 1 : entry.x, y: entry.y, to: 0, tx: back.x, ty: back.y, name: '出口', exit: true }]
      };
    }
    // 洞穴的出口要能站：入口格本身就是平地
    areas.forEach(function (a) { a.portals.forEach(function (p) { if (a.map) { var row = a.map[p.y]; if (row[p.x] !== '.') a.map[p.y] = row.slice(0, p.x) + '.' + row.slice(p.x + 1); } }); });

    // 我軍起點
    P.used[start.y * W + start.x] = false;
    var startCells = P.around(start.x, start.y, 12);
    areas[0].map = g.map(function (row) { return row.join(''); });

    return {
      areas: areas, stage: stageIdx, ilvl: ilvl, diff: diff || 'normal',
      cols: W, rows: H, map: areas[0].map, chests: chests, shrines: shrines,
      start: start, startCells: startCells, spawns: spawns, boss: boss, camps: centers.length + 1
    };
  };
})(window.Sango);
