/*
 * 探索模式：仿暗黑破壞神的大地圖 (戰場的 20 倍大)，四處探索、擊破敵營、開寶箱，最後打倒敵將
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
    ENGAGE: 9,                // 我軍自動迎擊的範圍
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
    REWARD_MULT: 2            // 過關的金錢 / 經驗為一般出征的幾倍
  };

  // 產生探索地圖：回傳 { cols, rows, map, start, spawns, chests, boss, ilvl, stage }
  S.makeExplore = function (stageIdx, rng) {
    rng = rng || S.random;
    var E = S.EXPLORE, W = E.COLS, H = E.ROWS, st = S.STAGES[stageIdx];
    var grid = [];
    var x, y, i;
    for (y = 0; y < H; y++) { grid.push([]); for (x = 0; x < W; x++) grid[y].push(x === 0 || y === 0 || x === W - 1 || y === H - 1); }
    function ri(a, b) { return a + Math.floor(rng() * (b - a + 1)); }
    function cheb(ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); }

    var start = { x: 7, y: H - 8 };
    var boss = { x: W - 10, y: 9 };
    function nearKey(px, py, r) { return cheb(px, py, start.x, start.y) <= r || cheb(px, py, boss.x, boss.y) <= r; }

    // 岩石群
    var blobs = Math.round(W * H / 230);
    for (i = 0; i < blobs; i++) {
      var cx = ri(2, W - 3), cy = ri(2, H - 3), r = 1 + rng() * 2.6;
      for (y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
        for (x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
          if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) continue;
          var d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
          if (d <= r + (rng() - 0.5) * 0.9 && !nearKey(x, y, 6)) grid[y][x] = true;
        }
      }
    }
    // 城寨廢墟：矩形城牆，每面牆留缺口
    for (i = 0; i < 8; i++) {
      var rw = ri(7, 14), rh = ri(6, 10), rx = ri(3, W - rw - 4), ry = ri(3, H - rh - 4);
      if (nearKey(rx + rw / 2, ry + rh / 2, 12)) continue;
      for (x = rx; x < rx + rw; x++) { grid[ry][x] = true; grid[ry + rh - 1][x] = true; }
      for (y = ry; y < ry + rh; y++) { grid[y][rx] = true; grid[y][rx + rw - 1] = true; }
      for (y = ry + 1; y < ry + rh - 1; y++) for (x = rx + 1; x < rx + rw - 1; x++) grid[y][x] = false;
      var gx = rx + ri(2, rw - 4), gy = ry + ri(2, rh - 4);
      grid[ry][gx] = grid[ry][gx + 1] = false;
      grid[ry + rh - 1][gx] = grid[ry + rh - 1][gx + 1] = false;
      grid[gy][rx] = grid[gy + 1][rx] = false;
      grid[gy][rx + rw - 1] = grid[gy + 1][rx + rw - 1] = false;
    }
    // 敵將據點：圍牆 + 正面缺口
    for (x = boss.x - 5; x <= boss.x + 5; x++) { grid[boss.y + 5][x] = Math.abs(x - boss.x) > 1; }
    for (y = boss.y - 5; y <= boss.y + 5; y++) { if (y > 0) grid[y][boss.x - 6] = Math.abs(y - boss.y) > 1; }

    // 連通：從起點 BFS (四方向)，走不到的空地填成岩石
    function bfs() {
      var dist = new Array(W * H).fill(-1), q = [start.y * W + start.x];
      dist[q[0]] = 0;
      for (var h = 0; h < q.length; h++) {
        var c = q[h], cx2 = c % W, cy2 = (c / W) | 0;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (dd) {
          var nx = cx2 + dd[0], ny = cy2 + dd[1], n = ny * W + nx;
          if (grid[ny][nx] || dist[n] >= 0) return;
          dist[n] = dist[c] + 1;
          q.push(n);
        });
      }
      return dist;
    }
    var dist = bfs();
    if (dist[boss.y * W + boss.x] < 0) {
      // 走不到敵將：從起點挖一條寬 3 的路 (先橫後直)
      for (x = start.x; x <= boss.x; x++) for (var k = -1; k <= 1; k++) grid[start.y + k][x] = false;
      for (y = boss.y; y <= start.y; y++) for (k = -1; k <= 1; k++) grid[y][boss.x + k] = false;
      dist = bfs();
    }
    for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) if (!grid[y][x] && dist[y * W + x] < 0) grid[y][x] = true;

    // 配置：已被佔用的格子
    var used = {};
    function key(px, py) { return py * W + px; }
    function freeAround(cx2, cy2, n) {
      var out = [];
      for (var rr = 0; rr < 6 && out.length < n; rr++) {
        for (var yy = cy2 - rr; yy <= cy2 + rr && out.length < n; yy++) {
          for (var xx = cx2 - rr; xx <= cx2 + rr && out.length < n; xx++) {
            if (cheb(xx, yy, cx2, cy2) !== rr || xx <= 0 || yy <= 0 || xx >= W - 1 || yy >= H - 1) continue;
            if (grid[yy][xx] || used[key(xx, yy)] || dist[key(xx, yy)] < 0) continue;
            used[key(xx, yy)] = true;
            out.push({ x: xx, y: yy });
          }
        }
      }
      return out;
    }
    var floor = [];
    for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) if (!grid[y][x]) floor.push({ x: x, y: y });

    var spawns = [];
    // 敵將據點：敵將 + 該關的完整軍隊
    var bossCells = freeAround(boss.x, boss.y, st.units.length + 1);
    spawns.push({ type: 'general', x: bossCells[0].x, y: bossCells[0].y, camp: 0 });
    st.units.forEach(function (t, j) { if (bossCells[j + 1]) spawns.push({ type: t, x: bossCells[j + 1].x, y: bossCells[j + 1].y, camp: 0 }); });

    // 一般敵營：離起點夠遠、彼此分散
    var nCamps = Math.round(E.CAMPS[0] + stageIdx * E.CAMPS[1]);
    var centers = [];
    for (var tries = 0; tries < 4000 && centers.length < nCamps; tries++) {
      var p = floor[Math.floor(rng() * floor.length)];
      if (cheb(p.x, p.y, start.x, start.y) < 20 || cheb(p.x, p.y, boss.x, boss.y) < 14) continue;
      if (centers.some(function (c) { return cheb(c.x, c.y, p.x, p.y) < 15; })) continue;
      centers.push(p);
    }
    var sizeBonus = Math.floor(stageIdx / 4);
    centers.forEach(function (c, j) {
      var n = ri(E.CAMP_SIZE[0], E.CAMP_SIZE[1]) + sizeBonus;
      freeAround(c.x, c.y, n).forEach(function (cell) {
        spawns.push({ type: st.units[Math.floor(rng() * st.units.length)], x: cell.x, y: cell.y, camp: j + 1 });
      });
    });

    // 寶箱：遠離起點，前 LOOT_CHESTS 個是裝備箱
    var chests = [];
    for (tries = 0; tries < 4000 && chests.length < E.CHESTS; tries++) {
      var q2 = floor[Math.floor(rng() * floor.length)];
      if (used[key(q2.x, q2.y)] || cheb(q2.x, q2.y, start.x, start.y) < 12) continue;
      if (chests.some(function (c) { return cheb(c.x, c.y, q2.x, q2.y) < 8; })) continue;
      used[key(q2.x, q2.y)] = true;
      chests.push({ x: q2.x, y: q2.y, loot: chests.length < E.LOOT_CHESTS });
    }

    // 我軍起點
    used[key(start.x, start.y)] = false;
    var startCells = freeAround(start.x, start.y, 12);

    return {
      cols: W, rows: H, stage: stageIdx, ilvl: stageIdx + 1,
      map: grid.map(function (row) { return row.map(function (w) { return w ? '#' : '.'; }).join(''); }),
      start: start, startCells: startCells, spawns: spawns, chests: chests, boss: boss, camps: centers.length + 1
    };
  };
})(window.Sango);
