/*
 * 繪製：以 256x240 邏輯座標作畫，整體放大 SCALE 倍 (點陣圖不平滑，文字保持清晰)
 */
(function (S) {
  'use strict';

  var FONT = '"Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif';
  var PANEL_BG = '#f8c4bc';
  var BAR_COLORS = ['#58a8f8', '#f86838'];
  // 小地圖的地貌顏色
  var MINI_COLORS = { '.': [70, 110, 60], '#': [150, 150, 150], '~': [50, 100, 190], 'T': [30, 70, 30], 'f': [45, 90, 40],
                      's': [90, 100, 55], 'i': [200, 225, 240], 'l': [220, 80, 20] };

  function Renderer(canvas) {
    this.canvas = canvas;
    canvas.width = S.VIEW_W * S.SCALE;
    canvas.height = S.VIEW_H * S.SCALE;
    this.ctx = canvas.getContext('2d');
    this.field = buildField(S.MAP, false);
    this.fieldMap = S.MAP;
    this.cam = { x: 0, y: 0 };      // 鏡頭左上角 (邏輯像素)；探索模式跟著主將
    this.sprites = S.buildSprites();
    this.portraits = [];
    this.showBars = true;
    this.highlightId = -1;
    this.caption = null;            // { title, sub }：營地預覽時蓋在戰場上的標題
    this.commanding = false;        // 玩家正在操控主將
    this.aim = null;                // 計策瞄準預覽 { x, y, radius, color, targets }
    this.hoverChest = null;
  }

  // ---- 地面 + 城牆 (預先畫好)：一般戰鬥是磚地；探索模式的野外是草地 (theme 'grass')、洞穴是岩地 (theme 'cave') ----
  function buildField(map, theme) {
    var grass = !!theme;
    var cols = map[0].length, rows = map.length;
    var c = document.createElement('canvas');
    c.width = cols * S.TILE;
    c.height = rows * S.TILE;
    var g = c.getContext('2d');
    var seed = 7;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }

    function bricks(x0, y0, w, h, shades, mortar) {
      g.fillStyle = mortar;
      g.fillRect(x0, y0, w, h);
      for (var y = 0; y < h; y += 8) {
        var off = (y / 8) % 2 ? 8 : 0;
        for (var x = -off; x < w; x += 16) {
          g.fillStyle = shades[(rnd() * shades.length) | 0];
          var bx = Math.max(x0 + x + 1, x0), bw = Math.min(x0 + x + 16, x0 + w) - bx;
          if (bw > 0) g.fillRect(bx, y0 + y + 1, bw, 7);
        }
      }
    }
    if (theme === 'cave') {
      var DIRT = ['#6e6252', '#6a5e4e', '#72665a', '#665a4a'];
      for (var cy = 0; cy < c.height; cy += 8) {
        for (var cx = 0; cx < c.width; cx += 8) {
          g.fillStyle = DIRT[(rnd() * DIRT.length) | 0];
          g.fillRect(cx, cy, 8, 8);
        }
      }
      for (var q = 0; q < cols * rows; q++) {         // 碎石
        g.fillStyle = rnd() < 0.7 ? '#544a3c' : '#8a8070';
        g.fillRect((rnd() * c.width) | 0, (rnd() * c.height) | 0, 2, 1);
      }
      return drawTerrain(g, map, cols, rows, rnd, theme), c;
    }
    if (grass) {
      var GREENS = ['#5c8c3c', '#5a883a', '#60903e', '#56843a', '#5e8a40'];
      for (var gy = 0; gy < c.height; gy += 8) {
        for (var gx = 0; gx < c.width; gx += 8) {
          g.fillStyle = GREENS[(rnd() * GREENS.length) | 0];
          g.fillRect(gx, gy, 8, 8);
        }
      }
      for (var k = 0; k < cols * rows * 1.5; k++) {   // 草叢與小花
        var r = rnd();
        g.fillStyle = r < 0.85 ? '#4a7830' : r < 0.95 ? '#78a050' : '#e8e080';
        g.fillRect((rnd() * c.width) | 0, (rnd() * c.height) | 0, 1, r < 0.85 ? 2 : 1);
      }
      return drawTerrain(g, map, cols, rows, rnd, theme), c;
    } else {
      bricks(0, 0, c.width, c.height, ['#a8a8a8', '#a0a0a0', '#a4a4a4', '#b0b0b0', '#a0a0a0', '#8c8c8c'], '#888888');
    }

    function wall(x, y) { return x >= 0 && y >= 0 && x < cols && y < rows && map[y][x] === '#'; }
    var T = S.TILE;
    for (var ty = 0; ty < rows; ty++) {
      for (var tx = 0; tx < cols; tx++) {
        if (!wall(tx, ty)) {
          // 城牆下方的陰影
          if (wall(tx, ty - 1)) { g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(tx * T, ty * T, T, 4); }
          continue;
        }
        var px = tx * T, py = ty * T;
        bricks(px, py, T, T, ['#d0d0d0', '#c8c8c8', '#d8d8d8'], '#a0a0a0');
        g.fillStyle = '#202020';
        if (!wall(tx - 1, ty)) g.fillRect(px, py, 3, T);
        if (!wall(tx + 1, ty)) g.fillRect(px + T - 3, py, 3, T);
        if (!wall(tx, ty - 1) && ty > 0) g.fillRect(px, py, T, 3);
        if (!wall(tx, ty + 1)) g.fillRect(px, py + T - 3, T, 3);
        g.fillStyle = '#f0f0f0';
        if (!wall(tx - 1, ty)) g.fillRect(px + 3, py, 1, T);
        if (!wall(tx, ty - 1) && ty > 0) g.fillRect(px, py + 3, T, 1);
      }
    }
    return c;
  }

  // ---- 探索地圖的地貌：岩石、深水、樹木、森林、沼澤、冰原、熔岩 ----
  function drawTerrain(g, map, cols, rows, rnd, theme) {
    var T = S.TILE, cave = theme === 'cave';
    function at(x, y) { return x >= 0 && y >= 0 && x < cols && y < rows ? map[y][x] : '#'; }
    function speckle(px, py, colors, n, w, h) {
      for (var i = 0; i < n; i++) {
        g.fillStyle = colors[(rnd() * colors.length) | 0];
        g.fillRect(px + ((rnd() * (T - (w || 1))) | 0), py + ((rnd() * (T - (h || 1))) | 0), w || 1, h || 1);
      }
    }
    // 先畫地面類 (森林 / 沼澤 / 冰原 / 熔岩 / 水)
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < cols; x++) {
        var ch = map[y][x], px = x * T, py = y * T;
        if (ch === 'f' || ch === 'T') {
          g.fillStyle = '#3c6a2c'; g.fillRect(px, py, T, T);
          speckle(px, py, ['#2e5422', '#46783a', '#335e26'], 10, 2, 2);
        } else if (ch === 's') {
          g.fillStyle = '#4e5a34'; g.fillRect(px, py, T, T);
          g.fillStyle = '#3a4a3a'; g.fillRect(px + 2 + ((rnd() * 4) | 0), py + 4 + ((rnd() * 6) | 0), 7, 3);
          speckle(px, py, ['#6a7a40', '#2c3a28', '#80904c'], 6, 2, 1);
        } else if (ch === 'i') {
          g.fillStyle = '#c8e0f0'; g.fillRect(px, py, T, T);
          speckle(px, py, ['#e8f4ff', '#a8c8e0', '#ffffff'], 5, 4, 1);
        } else if (ch === 'l') {
          g.fillStyle = '#c83810'; g.fillRect(px, py, T, T);
          speckle(px, py, ['#f88820', '#f8c040', '#801808'], 9, 3, 2);
        } else if (ch === '~') {
          g.fillStyle = cave ? '#1c3450' : '#2860a8'; g.fillRect(px, py, T, T);
          speckle(px, py, cave ? ['#2c4a6a'] : ['#4880c8', '#3870b8'], 3, 5, 1);
          // 岸邊
          g.fillStyle = cave ? '#2a2620' : '#c8b878';
          if (at(x, y - 1) !== '~' && at(x, y - 1) !== '#') g.fillRect(px, py, T, 2);
          if (at(x, y + 1) !== '~' && at(x, y + 1) !== '#') g.fillRect(px, py + T - 2, T, 2);
          if (at(x - 1, y) !== '~' && at(x - 1, y) !== '#') g.fillRect(px, py, 2, T);
          if (at(x + 1, y) !== '~' && at(x + 1, y) !== '#') g.fillRect(px + T - 2, py, 2, T);
        }
      }
    }
    // 再畫立體的障礙物 (岩石、樹木)
    for (y = 0; y < rows; y++) {
      for (x = 0; x < cols; x++) {
        ch = map[y][x]; px = x * T; py = y * T;
        if (ch === '#') {
          var top = at(x, y - 1) !== '#', bottom = at(x, y + 1) !== '#';
          g.fillStyle = cave ? '#2a221c' : '#7a7468'; g.fillRect(px, py, T, T);
          speckle(px, py, cave ? ['#3a3028', '#201a14'] : ['#8a8478', '#6a6458', '#94907e'], 7, 3, 2);
          if (top) { g.fillStyle = cave ? '#4a4036' : '#a8a294'; g.fillRect(px, py, T, 3); }
          if (bottom) { g.fillStyle = cave ? '#14100c' : '#4a463e'; g.fillRect(px, py + T - 4, T, 4); }
          if (at(x - 1, y) !== '#') { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(px, py, 2, T); }
          if (bottom && y + 1 < rows) { g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(px, py + T, T, 3); }
        } else if (ch === 'T') {
          g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(px + 8, py + 14, 6, 2, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#5a3818'; g.fillRect(px + 7, py + 9, 3, 6);
          g.fillStyle = '#1e4a1a'; g.beginPath(); g.arc(px + 8, py + 6, 6.5, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#2e6a26'; g.beginPath(); g.arc(px + 7, py + 5, 4.5, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#4a8a3a'; g.fillRect(px + 5, py + 2, 3, 2);
        }
      }
    }
  }

  Renderer.prototype.portrait = function (side, army) {
    var key = side + ':' + army.name;
    if (!this.portraits[side] || this.portraits[side].key !== key) {
      this.portraits[side] = { key: key, img: S.buildPortrait(side, army) };
    }
    return this.portraits[side].img;
  };

  Renderer.prototype.text = function (str, x, y, size, color, align, stroke) {
    var g = this.ctx;
    g.font = 'bold ' + size + 'px ' + FONT;
    g.textAlign = align || 'left';
    g.textBaseline = 'middle';
    if (stroke) {
      g.lineWidth = size / 4;
      g.strokeStyle = stroke;
      g.lineJoin = 'round';
      g.strokeText(str, x, y);
    }
    g.fillStyle = color;
    g.fillText(str, x, y);
  };

  // ---- 主繪製 ----
  Renderer.prototype.draw = function (battle, running) {
    var g = this.ctx, T = S.TILE, cam = this.cam;
    if (this.fieldMap !== battle.map) {             // 換地圖 (探索模式每次都是新的大地圖，洞穴 / 迷宮各自一張)
      this.fieldCache = (this.fieldCache || []).filter(function (f) { return battle.areas && battle.areas.some(function (a) { return a.map === f.map; }); });
      var cached = this.fieldCache.filter(function (f) { return f.map === battle.map; })[0];
      if (!cached) {
        var theme = battle.areas ? battle.areas[battle.area].theme : battle.explore ? 'grass' : null;
        cached = { map: battle.map, canvas: buildField(battle.map, theme) };
        if (battle.areas) this.fieldCache.push(cached);
      }
      this.field = cached.canvas;
      this.fieldMap = battle.map;
      this.mini = null;
    }
    this.updateCamera(battle);
    g.setTransform(S.SCALE, 0, 0, S.SCALE, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.field, cam.x, cam.y, S.FIELD_W, S.FIELD_H, 0, 0, S.FIELD_W, S.FIELD_H);

    // 戰場上的東西以世界座標畫，鏡頭位移後裁切在戰場範圍內
    g.save();
    g.beginPath(); g.rect(0, 0, S.FIELD_W, S.FIELD_H); g.clip();
    g.setTransform(S.SCALE, 0, 0, S.SCALE, -cam.x * S.SCALE, -cam.y * S.SCALE);
    this.drawChests(battle);
    this.drawPendings(battle);
    var x0 = cam.x / T - 1, y0 = cam.y / T - 1, x1 = (cam.x + S.FIELD_W) / T + 1, y1 = (cam.y + S.FIELD_H) / T + 1;
    function onScreen(x, y) { return x >= x0 && x <= x1 && y >= y0 && y <= y1; }
    function shown(u) {           // 探索模式：看不到的敵人不畫
      return battle.here(u) && onScreen(u.posX(), u.posY()) && (u.side === 0 || battle.isVisible(Math.round(u.posX()), Math.round(u.posY())));
    }
    var list = battle.units.filter(function (u) { return (!u.dead || u.deathT > 0) && shown(u); });
    list.sort(function (a, b) { return a.posY() - b.posY(); });
    for (var i = 0; i < list.length; i++) this.drawUnit(list[i], battle.time);
    for (var p = 0; p < battle.projectiles.length; p++) {
      var pr = battle.projectiles[p];
      if (pr.kind === 'orb') this.drawOrb(pr); else this.drawArrow(pr);
    }
    for (var e = 0; e < battle.effects.length; e++) {
      var fx = battle.effects[e];
      if (onScreen(fx.x, fx.y) && battle.isVisible(Math.round(fx.x), Math.round(fx.y))) this.drawEffect(fx);
    }
    if (battle.portals) this.drawPortalLabels(battle);
    this.drawAim();
    this.drawOrders(battle);
    this.drawFocus(battle);
    if (battle.explore) this.drawFog(battle, Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1));
    g.restore();

    this.drawWeather(battle);
    this.drawNotices(battle);
    if (battle.explore) this.drawMinimap(battle);
    this.drawPanel(battle);
    this.drawOverlay(battle, running);
  };

  // 預警範圍：紅色閃爍，越接近落下越濃
  Renderer.prototype.drawPendings = function (battle) {
    var g = this.ctx, T = S.TILE;
    (battle.pendings || []).forEach(function (p) {
      var k = Math.min(1, p.t / p.dur), x = (p.x - p.r) * T, y = (p.y - p.r) * T, w = (2 * p.r + 1) * T;
      var blink = 0.5 + 0.5 * Math.sin(Date.now() / 60);
      g.fillStyle = 'rgba(255,40,20,' + (0.12 + 0.35 * k) + ')';
      g.fillRect(x, y, w, w);
      g.fillStyle = 'rgba(255,60,30,' + (0.25 + 0.2 * blink) + ')';
      var inner = w * k;                          // 由中心向外擴張的實心方塊 = 倒數
      g.fillRect(x + (w - inner) / 2, y + (w - inner) / 2, inner, inner);
      g.strokeStyle = 'rgba(255,' + Math.round(80 + 120 * blink) + ',60,0.95)';
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, w - 1, w - 1);
    });
  };

  // 集火目標：旋轉的紅色準星
  Renderer.prototype.drawFocus = function (battle) {
    var f = battle.focus && battle.focus[0];
    if (!f || f.dead || !battle.isVisible(f.x, f.y)) return;
    var g = this.ctx, T = S.TILE, cx = f.posX() * T + 8, cy = f.posY() * T + 8, a = Date.now() / 300;
    g.strokeStyle = '#ff4030';
    g.lineWidth = 1;
    for (var i = 0; i < 4; i++) {
      var ang = a + i * Math.PI / 2, r = 10;
      var px = cx + Math.cos(ang) * r, py = cy + Math.sin(ang) * r;
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px - Math.cos(ang) * 3 + Math.cos(ang + Math.PI / 2) * 2.5, py - Math.sin(ang) * 3 + Math.sin(ang + Math.PI / 2) * 2.5);
      g.moveTo(px, py);
      g.lineTo(px - Math.cos(ang) * 3 - Math.cos(ang + Math.PI / 2) * 2.5, py - Math.sin(ang) * 3 - Math.sin(ang + Math.PI / 2) * 2.5);
      g.stroke();
    }
  };

  // 鏡頭：探索模式以主將為中心 (邊界停住)；一般戰鬥固定在左上角
  Renderer.prototype.updateCamera = function (battle) {
    var cam = this.cam, T = S.TILE;
    if (!battle.explore) { cam.x = cam.y = 0; return; }
    var u = battle.generals[0];
    if (!u || u.dead) u = battle.alive(0)[0];
    if (!u) return;
    var maxX = battle.cols * T - S.FIELD_W, maxY = battle.rows * T - S.FIELD_H;
    cam.x = Math.round(Math.max(0, Math.min(maxX, u.posX() * T + T / 2 - S.FIELD_W / 2)));
    cam.y = Math.round(Math.max(0, Math.min(maxY, u.posY() * T + T / 2 - S.FIELD_H / 2)));
  };

  // 戰爭迷霧：沒去過的地方全黑，去過但現在看不到的地方變暗
  Renderer.prototype.drawFog = function (battle, x0, y0, x1, y1) {
    var g = this.ctx, T = S.TILE, W = battle.cols;
    for (var y = Math.max(0, y0); y <= Math.min(battle.rows - 1, y1); y++) {
      for (var x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
        var i = y * W + x;
        if (battle.vis[i]) continue;
        g.fillStyle = battle.seen[i] ? 'rgba(0,0,0,0.45)' : '#000';
        g.fillRect(x * T, y * T, T, T);
      }
    }
  };

  // 小地圖 (戰場右下角)：探索過的地形、我軍、看得到的敵人、寶箱、敵將據點、目前畫面範圍
  Renderer.prototype.drawMinimap = function (battle) {
    var g = this.ctx, W = battle.cols, H = battle.rows, now = Date.now();
    if (!this.mini || now - this.miniT > 300) {
      if (!this.mini) { this.mini = document.createElement('canvas'); this.mini.width = W; this.mini.height = H; }
      this.miniT = now;
      var mg = this.mini.getContext('2d'), img = mg.createImageData(W, H), d = img.data;
      for (var i = 0; i < W * H; i++) {
        var o = i * 4;
        if (!battle.seen[i]) { d[o + 3] = 0; continue; }
        var col = MINI_COLORS[battle.map[(i / W) | 0][i % W]] || (battle.walls[i] ? [150, 150, 150] : [70, 110, 60]);
        if (battle.areas && battle.areas[battle.area].theme === 'cave') col = battle.walls[i] ? (col[2] > 150 ? col : [60, 50, 40]) : col === MINI_COLORS['.'] ? [120, 104, 86] : col;
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 230;
      }
      mg.putImageData(img, 0, 0);
    }
    var s = 0.75, mw = W * s, mh = H * s, mx = S.FIELD_W - mw - 4, my = S.FIELD_H - mh - 4;
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(mx - 1, my - 1, mw + 2, mh + 2);
    g.drawImage(this.mini, mx, my, mw, mh);
    battle.chests.forEach(function (c) {
      if (!battle.seen[c.y * W + c.x]) return;
      g.fillStyle = c.loot ? '#f8a030' : '#f8d838';
      g.fillRect(mx + c.x * s - 0.5, my + c.y * s - 0.5, 1.5, 1.5);
    });
    (battle.shrines || []).forEach(function (sh) {
      if (sh.used || !battle.seen[sh.y * W + sh.x]) return;
      g.fillStyle = S.SHRINES[sh.type].color;
      g.fillRect(mx + sh.x * s - 1, my + sh.y * s - 1, 2, 2);
    });
    (battle.portals || []).forEach(function (p) {
      if (!battle.seen[p.y * W + p.x]) return;
      g.fillStyle = p.exit ? '#f0f0a0' : '#c060ff';
      g.fillRect(mx + p.x * s - 1.5, my + p.y * s - 1.5, 3, 3);
    });
    var boss = battle.explore.boss;
    if (!battle.area && battle.seen[boss.y * W + boss.x] && battle.generalAlive(1)) this.text('★', mx + boss.x * s, my + boss.y * s, 6, '#ff5040', 'center', '#000');
    battle.units.forEach(function (u) {
      if (u.dead || !battle.here(u) || (u.side === 1 && !battle.isVisible(u.x, u.y))) return;
      g.fillStyle = u.side === 0 ? (u.isGeneral ? '#ffffff' : '#58a8f8') : u.animal ? '#e0a040' : '#ff4030';
      var sz = u.isGeneral ? 2.5 : 1.5;
      g.fillRect(mx + u.x * s - sz / 2, my + u.y * s - sz / 2, sz, sz);
    });
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 0.5;
    g.strokeRect(mx + this.cam.x / S.TILE * s, my + this.cam.y / S.TILE * s, S.FIELD_W / S.TILE * s, S.FIELD_H / S.TILE * s);
  };

  // ---- 洞穴 / 迷宮的出入口：野外是黑色洞口，洞裡是往上的階梯；上方標名稱 ----
  Renderer.prototype.drawPortals = function (battle) {
    var g = this.ctx, T = S.TILE, self = this;
    (battle.portals || []).forEach(function (p) {
      if (!battle.seen[p.y * battle.cols + p.x]) return;
      var x = p.x * T, y = p.y * T, glow = 0.5 + 0.5 * Math.sin(Date.now() / 300);
      if (p.exit) {
        g.fillStyle = '#8a8070'; g.fillRect(x + 1, y + 2, 14, 13);
        for (var i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#b0a690' : '#d0c8b0'; g.fillRect(x + 2 + i, y + 3 + i * 3, 12 - i * 2, 3); }
        g.fillStyle = 'rgba(255,255,200,' + (0.2 + 0.3 * glow) + ')'; g.fillRect(x + 1, y + 2, 14, 13);
      } else {
        g.fillStyle = '#5a5248'; g.beginPath(); g.ellipse(x + 8, y + 10, 8, 7, 0, Math.PI, 0); g.fill(); g.fillRect(x, y + 10, 16, 5);
        g.fillStyle = '#100808'; g.beginPath(); g.ellipse(x + 8, y + 11, 5, 5, 0, Math.PI, 0); g.fill(); g.fillRect(x + 3, y + 11, 10, 4);
        g.fillStyle = 'rgba(192,96,255,' + (0.25 + 0.35 * glow) + ')'; g.fillRect(x + 4, y + 9, 8, 6);
      }
    });
  };
  // 出入口的名稱 (畫在單位上方，才不會被擋住)
  Renderer.prototype.drawPortalLabels = function (battle) {
    var T = S.TILE, self = this;
    (battle.portals || []).forEach(function (p) {
      if (!battle.seen[p.y * battle.cols + p.x]) return;
      self.text(p.exit ? '出口' : p.name, p.x * T + 8, p.y * T - 3, 6, p.exit ? '#ffffc0' : '#e0b0ff', 'center', '#000');
    });
  };

  // ---- 玩家主將：操控中畫黃框；移動命令畫虛線與目的地 X，攻擊命令標出目標 ----
  Renderer.prototype.drawOrders = function (battle) {
    var u = battle.generals[0];
    if (!u || u.dead) return;
    var g = this.ctx, T = S.TILE;
    var gx = u.posX() * T, gy = u.posY() * T;
    var o = u.order;
    if (o && (o.kind === 'move' || o.kind === 'attack')) {
      var tx, ty;
      if (o.kind === 'move') { tx = o.x * T; ty = o.y * T; } else { tx = o.target.posX() * T; ty = o.target.posY() * T; }
      var color = o.kind === 'move' ? 'rgba(128,200,255,0.9)' : 'rgba(255,80,64,0.95)';
      g.strokeStyle = color;
      g.lineWidth = 1;
      g.setLineDash([3, 2]);
      g.beginPath();
      g.moveTo(gx + 8, gy + 8);
      g.lineTo(tx + 8, ty + 8);
      g.stroke();
      g.setLineDash([]);
      g.beginPath();
      if (o.kind === 'move') {
        g.moveTo(tx + 4.5, ty + 4.5); g.lineTo(tx + 11.5, ty + 11.5);
        g.moveTo(tx + 11.5, ty + 4.5); g.lineTo(tx + 4.5, ty + 11.5);
      } else {
        g.rect(tx - 0.5, ty - 0.5, T + 1, T + 1);
      }
      g.stroke();
    }
    if (this.commanding && Math.floor(Date.now() / 250) % 2 === 0) {   // 用真實時間閃爍，暫停中也看得到
      g.strokeStyle = '#f8f040';
      g.lineWidth = 1;
      g.strokeRect(gx - 0.5, gy - 0.5, T + 1, T + 1);
    }
  };

  // ---- 寶箱 (上下浮動、閃光)；派去撿的部隊畫一條虛線 ----
  Renderer.prototype.drawChests = function (battle) {
    var g = this.ctx, T = S.TILE;
    var self = this;
    this.drawPortals(battle);
    battle.units.forEach(function (u) {
      if (u.dead || !u.chestGoal || !battle.here(u)) return;
      g.strokeStyle = u.side === 0 ? 'rgba(88,168,248,0.8)' : 'rgba(248,104,56,0.8)';
      g.lineWidth = u.chestForced ? 1 : 0.5;
      g.setLineDash([2, 2]);
      g.beginPath();
      g.moveTo(u.posX() * T + 8, u.posY() * T + 8);
      g.lineTo(u.chestGoal.x * T + 8, u.chestGoal.y * T + 9);
      g.stroke();
      g.setLineDash([]);
    });
    (battle.shrines || []).forEach(function (sh) {
      if (!battle.seen[sh.y * battle.cols + sh.x]) return;
      var def = S.SHRINES[sh.type], x = sh.x * T, y = sh.y * T;
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 2, y + 13, 12, 2);
      g.fillStyle = '#707070'; g.fillRect(x + 3, y + 9, 10, 5);
      g.fillStyle = '#a0a0a0'; g.fillRect(x + 4, y + 7, 8, 3);
      if (sh.used) return;
      var f = Math.sin(battle.time * 8 + sh.x) * 1.2;
      g.fillStyle = def.color; g.globalAlpha = 0.35;
      g.beginPath(); g.arc(x + 8, y + 4, 6, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
      g.beginPath(); g.ellipse(x + 8, y + 3.5 + f * 0.3, 2.5, 4 + f * 0.4, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff'; g.fillRect(x + 7.5, y + 3, 1, 3);
    });
    battle.chests.forEach(function (c) {
      if (battle.explore && !battle.seen[c.y * battle.cols + c.x]) return;
      var x = c.x * T, y = c.y * T + Math.round(Math.sin((battle.time - c.born) * 4) * 0.8);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(x + 3, c.y * T + 13, 10, 2);
      g.fillStyle = '#301808';
      g.fillRect(x + 2, y + 4, 12, 10);
      g.fillStyle = '#a05818';
      g.fillRect(x + 3, y + 8, 10, 5);
      g.fillStyle = '#c87830';
      g.fillRect(x + 3, y + 5, 10, 3);
      g.fillStyle = '#f8d838';
      g.fillRect(x + 2, y + 8, 12, 1);
      g.fillRect(x + 7, y + 7, 2, 3);
      if (Math.floor((battle.time - c.born) * 3) % 3 === 0) {
        g.fillStyle = '#ffffff';
        g.fillRect(x + 12, y + 2, 1, 3);
        g.fillRect(x + 11, y + 3, 3, 1);
      }
      if (self.hoverChest === c) {
        g.strokeStyle = '#f8f040';
        g.lineWidth = 1;
        g.strokeRect(x + 0.5, c.y * T + 0.5, 15, 15);
      }
    });
  };

  // ---- 天候：雨絲、霧、風 ----
  Renderer.prototype.drawWeather = function (battle) {
    var g = this.ctx, t = battle.time, W = S.FIELD_W, H = S.FIELD_H, i, x, y;
    if (battle.weather === 'rain') {
      g.fillStyle = 'rgba(30,50,110,0.18)';
      g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(200,220,255,0.55)';
      g.lineWidth = 0.6;
      g.beginPath();
      for (i = 0; i < 60; i++) {
        x = (i * 37 + t * 50) % (W + 20) - 10;
        y = (i * 53 + t * 220) % (H + 20) - 10;
        g.moveTo(x, y); g.lineTo(x - 2, y + 6);
      }
      g.stroke();
    } else if (battle.weather === 'fog') {
      g.fillStyle = 'rgba(230,230,235,0.28)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(240,240,245,0.22)';
      for (i = 0; i < 6; i++) {
        x = (i * 71 + t * 6) % (W + 80) - 40;
        y = 15 + (i * 47) % (H - 30);
        g.beginPath(); g.ellipse(x, y, 34, 10, 0, 0, Math.PI * 2); g.fill();
      }
    } else if (battle.weather === 'wind') {
      g.strokeStyle = 'rgba(255,255,255,0.45)';
      g.lineWidth = 0.6;
      g.beginPath();
      for (i = 0; i < 14; i++) {
        x = (i * 61 + t * 160) % (W + 40) - 20;
        y = (i * 29 + Math.sin(t * 2 + i) * 3) % H;
        g.moveTo(x, y); g.lineTo(x + 12, y);
      }
      g.stroke();
    }
  };

  // ---- 計策瞄準預覽 ----
  Renderer.prototype.drawAim = function () {
    var a = this.aim;
    if (!a) return;
    var g = this.ctx, T = S.TILE;
    var r = a.radius;
    g.fillStyle = a.color;
    g.globalAlpha = 0.25;
    g.fillRect((a.x - r) * T, (a.y - r) * T, (2 * r + 1) * T, (2 * r + 1) * T);
    g.globalAlpha = 1;
    g.strokeStyle = a.color;
    g.lineWidth = 1;
    g.strokeRect((a.x - r) * T + 0.5, (a.y - r) * T + 0.5, (2 * r + 1) * T - 1, (2 * r + 1) * T - 1);
    (a.targets || []).forEach(function (u) {
      g.strokeStyle = '#ffffff';
      g.strokeRect(u.posX() * T + 0.5, u.posY() * T + 0.5, T - 1, T + 1);
    });
  };

  // ---- 事件通知 (畫面上方) ----
  Renderer.prototype.drawNotices = function (battle) {
    var list = battle.notices.slice(-3);
    var g = this.ctx;
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      var y = 7 + i * 10;
      g.globalAlpha = Math.min(1, (n.dur - n.t) * 2, n.t * 6);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(0, y - 4.5, S.FIELD_W, 9);
      this.text(n.text, S.FIELD_W / 2, y, 6, n.color, 'center', '#000');
    }
    g.globalAlpha = 1;
  };

  Renderer.prototype.drawUnit = function (u, time) {
    if (u.dead && Math.floor(u.deathT * 16) % 2) return;   // 陣亡閃爍
    var g = this.ctx;
    var T = S.TILE;
    var x = u.posX() * T, y = u.posY() * T;
    if (u.lungeT > 0) {
      var k = Math.sin(Math.PI * u.lungeT / S.LUNGE_TIME) * 5;
      x += u.lungeDx * k; y += u.lungeDy * k;
    }
    var frame = u.isMoving() ? Math.floor(u.walkT * 8) % 2 : 0;
    if (frame && u.type !== 'cavalry' && u.type !== 'general') y -= 1;
    x = Math.round(x); y = Math.round(y);

    if (u.windup && !u.dead) {    // 敵將蓄力：紅色光暈
      g.fillStyle = 'rgba(255,50,30,' + (0.35 + 0.3 * Math.sin(Date.now() / 50)) + ')';
      g.beginPath(); g.arc(x + 8, y + 8, 11, 0, Math.PI * 2); g.fill();
    }
    if (u.invulnT > 0 && Math.floor(Date.now() / 40) % 2) g.globalAlpha = 0.5;   // 突進中無敵
    if (u.quality && u.quality !== 'normal' && !u.dead) {   // 我軍士兵的品質：腳下的色條
      g.fillStyle = S.QUALITIES[u.quality].color;
      g.fillRect(x + 3, y + 14, 10, 1);
    }
    if (u.elite && !u.dead) {     // 精英：腳下閃動的紫色光環
      g.fillStyle = 'rgba(200,110,255,' + (0.35 + 0.2 * Math.sin(time * 5)) + ')';
      g.beginPath(); g.ellipse(x + 8, y + 14, 9, 3.5, 0, 0, Math.PI * 2); g.fill();
    }
    var set = this.sprites[u.side][u.type];
    var img = (u.flashT > 0 || u.dead) ? set.flash[frame] : set.frames[frame];
    if (u.facing < 0) {
      g.save();
      g.translate(x + T, y);
      g.scale(-1, 1);
      g.drawImage(img, 0, 0);
      g.restore();
    } else {
      g.drawImage(img, x, y);
    }

    g.globalAlpha = 1;
    if (u.dead) return;
    if (this.showBars) {
      g.fillStyle = '#202020';
      g.fillRect(x + 2, y + 15, 12, 2.5);
      g.fillStyle = u.isGeneral ? '#f8d838' : BAR_COLORS[u.side];
      g.fillRect(x + 2, y + 15, 12 * Math.max(0, u.hp / u.maxHp), 1.5);
      g.fillStyle = '#8060ff';
      g.fillRect(x + 2, y + 16.5, 12 * u.mp / u.maxMp, 1);
    }
    this.drawStatus(u, x, y, time);
    if (u.elite) this.text(u.name, x + 8, y - 4, 4.5, '#e0a0ff', 'center', '#000');
    if (u.wanderer) this.text('流浪武者 ' + S.soldierFullName(u.wanderer), x + 8, y - 4, 4.5, S.QUALITIES[u.wanderer.q].color, 'center', '#000');
    if (u.id === this.highlightId) {
      g.strokeStyle = '#f8f040';
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, 15, 17);
    }
  };

  // 狀態圖示：混亂 (旋轉星星)、燃燒、攻↑、防↓
  Renderer.prototype.drawStatus = function (u, x, y, time) {
    var g = this.ctx;
    if (u.findBuff('stun')) {
      for (var i = 0; i < 2; i++) {
        var a = time * 6 + i * Math.PI;
        g.fillStyle = '#f8f040';
        g.fillRect(x + 8 + Math.cos(a) * 4 - 1, y - 1 + Math.sin(a) * 1.5, 2, 2);
      }
    }
    if (u.findBuff('burn') && Math.floor(time * 10) % 2) {
      g.fillStyle = '#ff7020';
      g.fillRect(x + 1, y + 3, 2, 3);
      g.fillStyle = '#ffd040';
      g.fillRect(x + 1.5, y + 4.5, 1, 1.5);
    }
    if (u.findBuff('stat', 'atk')) {
      g.fillStyle = '#ff5040';
      g.fillRect(x + 13, y + 3, 1, 3);
      g.fillRect(x + 12, y + 4, 3, 1);
    }
    if (u.findBuff('stat', 'def')) {
      g.fillStyle = '#4080ff';
      g.fillRect(x + 13, y + 7, 1, 3);
      g.fillRect(x + 12, y + 8, 3, 1);
    }
  };

  Renderer.prototype.drawOrb = function (p) {
    var g = this.ctx, T = S.TILE;
    var t = Math.min(1, p.t / p.dur);
    var x = (p.sx + (p.tx - p.sx) * t) * T + 8;
    var y = (p.sy + (p.ty - p.sy) * t) * T + 6;
    g.globalAlpha = 0.45;
    g.fillStyle = p.color;
    g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(x, y, 1.5, 0, Math.PI * 2); g.fill();
  };

  Renderer.prototype.drawArrow = function (p) {
    var g = this.ctx, T = S.TILE;
    var dist = Math.hypot(p.tx - p.sx, p.ty - p.sy);
    function at(t) {
      return {
        x: (p.sx + (p.tx - p.sx) * t) * T + 8,
        y: (p.sy + (p.ty - p.sy) * t) * T + 8 - Math.sin(Math.PI * t) * dist * 3
      };
    }
    var t = Math.min(1, p.t / p.dur);
    var a = at(t), b = at(Math.min(1, t + 0.05));
    var ang = Math.atan2(b.y - a.y, b.x - a.x);
    var cx = Math.cos(ang), cy = Math.sin(ang);
    g.lineWidth = 1;
    g.strokeStyle = '#f8f0d0';
    g.beginPath();
    g.moveTo(a.x - cx * 5, a.y - cy * 5);
    g.lineTo(a.x, a.y);
    g.stroke();
    g.fillStyle = '#303030';
    g.fillRect(a.x - 0.75, a.y - 0.75, 1.5, 1.5);
  };

  Renderer.prototype.drawEffect = function (fx) {
    var g = this.ctx;
    var k = fx.t / fx.dur;
    var cx = fx.x * S.TILE + 8, cy = fx.y * S.TILE + 8;
    g.globalAlpha = Math.min(1, (1 - k) * 2);
    if (fx.fx === 'trail') {
      g.strokeStyle = fx.color;
      g.lineWidth = 6 * (1 - k);
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(fx.x2 * S.TILE + 8, fx.y2 * S.TILE + 8); g.stroke();
      g.lineCap = 'butt';
    } else if (fx.fx === 'ring') {
      g.strokeStyle = fx.color;
      g.lineWidth = 3 * (1 - k) + 0.5;
      g.beginPath(); g.arc(cx, cy, 6 + k * 18, 0, Math.PI * 2); g.stroke();
    } else if (fx.fx === 'text') {
      this.text(fx.text, cx, cy - 6 - k * 8, 6, fx.color, 'center', '#000');
    } else if (fx.fx === 'boom') {
      // 陷阱爆炸：放射狀碎片
      g.fillStyle = fx.color;
      for (var d = 0; d < 8; d++) {
        var ang = d * Math.PI / 4, rr = 2 + k * 12;
        g.fillRect(cx + Math.cos(ang) * rr - 1, cy + Math.sin(ang) * rr - 1, 2, 2);
      }
      g.globalAlpha *= 0.4;
      g.beginPath(); g.arc(cx, cy, 3 + k * 6, 0, Math.PI * 2); g.fill();
    } else if (fx.fx === 'bolt') {
      // 落雷：從畫面上方劈下的折線
      g.strokeStyle = fx.color;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx + 2, 0);
      for (var yy = 0, s = 1; yy < cy; yy += 10, s = -s) g.lineTo(cx + s * 3, Math.min(cy, yy + 10));
      g.stroke();
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(cx, cy, 4 * (1 - k) + 1, 0, Math.PI * 2); g.fill();
    } else {
      g.strokeStyle = fx.color;
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(cx, cy, 2 + k * 9, 0, Math.PI * 2); g.stroke();
      g.globalAlpha *= 0.35;
      g.fillStyle = fx.color;
      g.beginPath(); g.arc(cx, cy, 2 + k * 7, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  };

  // ---- 下方狀態面板 (仿原作：頭像 + 體/騎/弓/步) ----
  Renderer.prototype.drawPanel = function (battle) {
    var g = this.ctx;
    var y0 = S.FIELD_H;
    g.fillStyle = PANEL_BG;
    g.fillRect(0, y0, S.VIEW_W, S.PANEL_H);
    g.fillStyle = '#d89890';
    g.fillRect(0, y0, S.VIEW_W, 1);

    var rows = [['體', 'hp'], ['騎', 'cavalry'], ['弓', 'archer'], ['步', 'spear']];
    for (var side = 0; side < 2; side++) {
      var army = battle.armies[side];
      var st = battle.stats(side);
      var px = side === 0 ? 6 : S.VIEW_W - 30;
      var py = y0 + 6;
      g.fillStyle = '#000';
      g.fillRect(px - 1, py - 1, 26, 26);
      g.fillStyle = '#fff8f0';
      g.fillRect(px, py, 24, 24);
      g.drawImage(this.portrait(side, army), px, py);
      if (!battle.generalAlive(side)) {
        g.fillStyle = 'rgba(40,0,0,0.55)';
        g.fillRect(px, py, 24, 24);
        this.text('敗', px + 12, py + 12, 12, '#ff5040', 'center', '#000');
      }
      this.text(army.name, px + 12, y0 + 40, 8, '#202020', 'center');
      this.text('武' + army.war + ' 統' + army.lead, px + 12, y0 + 53, 5.5, '#604040', 'center');

      for (var i = 0; i < rows.length; i++) {
        var ry = y0 + 9 + i * 14;
        var val = String(st[rows[i][1]]);
        if (side === 0) {
          this.text(rows[i][0], 37, ry, 10, '#202020', 'left');
          this.text(val, 82, ry, 10, '#202020', 'right');
        } else {
          this.text(val, S.VIEW_W - 82, ry, 10, '#202020', 'left');
          this.text(rows[i][0], S.VIEW_W - 37, ry, 10, '#202020', 'right');
        }
      }
    }
    // 軍令格 (每格 1 點)
    var C = S.COMMAND;
    for (side = 0; side < 2; side++) {
      var gx = side === 0 ? 88 : S.VIEW_W - 88 - C.MAX * 3;
      var cmd = battle.generalAlive(side) ? battle.command[side] : 0;
      this.text('軍令 ' + Math.floor(cmd), gx + C.MAX * 1.5, y0 + 48, 5.5, '#604040', 'center');
      for (var c = 0; c < C.MAX; c++) {
        var fill = Math.max(0, Math.min(1, cmd - c));
        g.fillStyle = '#806060';
        g.fillRect(gx + c * 3, y0 + 54, 2, 5);
        if (fill > 0) {
          g.fillStyle = fill >= 1 ? '#e8b020' : '#c09050';
          g.fillRect(gx + c * 3, y0 + 54 + 5 * (1 - fill), 2, 5 * fill);
        }
      }
    }
    var w = S.WEATHER[battle.weather];
    this.text(w.name, S.VIEW_W / 2, y0 + 55, 6, battle.weather === 'clear' ? '#806060' : '#2050a0', 'center');

    var t = Math.floor(battle.time);
    var mm = String(Math.floor(t / 60)).padStart(2, '0'), ss = String(t % 60).padStart(2, '0');
    this.text('VS', S.VIEW_W / 2, y0 + 22, 12, '#a03030', 'center');
    this.text(mm + ':' + ss, S.VIEW_W / 2, y0 + 42, 8, '#404040', 'center');
  };

  Renderer.prototype.banner = function (title, sub) {
    var g = this.ctx;
    var cy = S.FIELD_H / 2;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(0, cy - 20, S.VIEW_W, sub ? 40 : 28);
    this.text(title, S.VIEW_W / 2, cy - (sub ? 6 : 6), 14, '#f8d838', 'center', '#000');
    if (sub) this.text(sub, S.VIEW_W / 2, cy + 11, 7, '#ffffff', 'center');
  };

  Renderer.prototype.drawOverlay = function (battle, running) {
    if (this.caption) {
      this.banner(this.caption.title, this.caption.sub);
    } else if (battle.state === 'over') {
      var title = battle.winner < 0 ? '平手' : battle.winner === 0 ? '勝利！' : '敗北…';
      this.banner(title, (battle.timedOut ? '時間到 · ' : '') + '戰果請看下方');
    } else if (!running) {
      this.banner('暫停');
    } else if (battle.time < 1.2) {
      this.banner('開戰！');
    }
  };

  S.Renderer = Renderer;
})(window.Sango);
