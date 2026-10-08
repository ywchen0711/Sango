/*
 * 繪製：以 256x240 邏輯座標作畫，整體放大 SCALE 倍 (點陣圖不平滑，文字保持清晰)
 */
(function (S) {
  'use strict';

  var FONT = '"Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif';
  var PANEL_BG = '#f8c4bc';
  var BAR_COLORS = ['#58a8f8', '#f86838'];

  function Renderer(canvas) {
    this.canvas = canvas;
    canvas.width = S.VIEW_W * S.SCALE;
    canvas.height = S.VIEW_H * S.SCALE;
    this.ctx = canvas.getContext('2d');
    this.field = buildField();
    this.sprites = S.buildSprites();
    this.portraits = [];
    this.showBars = true;
    this.highlightId = -1;
    this.caption = null;            // { title, sub }：營地預覽時蓋在戰場上的標題
    this.commanding = false;        // 玩家正在操控主將
    this.aim = null;                // 計策瞄準預覽 { x, y, radius, color, targets }
    this.hoverChest = null;
  }

  // ---- 磚地 + 城牆 (預先畫好) ----
  function buildField() {
    var c = document.createElement('canvas');
    c.width = S.FIELD_W;
    c.height = S.FIELD_H;
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
    bricks(0, 0, S.FIELD_W, S.FIELD_H, ['#a8a8a8', '#a0a0a0', '#a4a4a4', '#b0b0b0', '#a0a0a0', '#8c8c8c'], '#888888');

    function wall(x, y) { return x >= 0 && y >= 0 && x < S.COLS && y < S.ROWS && S.MAP[y][x] === '#'; }
    var T = S.TILE;
    for (var ty = 0; ty < S.ROWS; ty++) {
      for (var tx = 0; tx < S.COLS; tx++) {
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
    var g = this.ctx;
    g.setTransform(S.SCALE, 0, 0, S.SCALE, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.field, 0, 0);
    this.drawChests(battle);

    var list = battle.units.filter(function (u) { return !u.dead || u.deathT > 0; });
    list.sort(function (a, b) { return a.posY() - b.posY(); });
    for (var i = 0; i < list.length; i++) this.drawUnit(list[i], battle.time);
    for (var p = 0; p < battle.projectiles.length; p++) {
      var pr = battle.projectiles[p];
      if (pr.kind === 'orb') this.drawOrb(pr); else this.drawArrow(pr);
    }
    for (var e = 0; e < battle.effects.length; e++) this.drawEffect(battle.effects[e]);
    this.drawWeather(battle);
    this.drawAim();
    this.drawOrders(battle);
    this.drawNotices(battle);

    this.drawPanel(battle);
    this.drawOverlay(battle, running);
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
    battle.units.forEach(function (u) {
      if (u.dead || !u.chestGoal) return;
      g.strokeStyle = u.side === 0 ? 'rgba(88,168,248,0.8)' : 'rgba(248,104,56,0.8)';
      g.lineWidth = u.chestForced ? 1 : 0.5;
      g.setLineDash([2, 2]);
      g.beginPath();
      g.moveTo(u.posX() * T + 8, u.posY() * T + 8);
      g.lineTo(u.chestGoal.x * T + 8, u.chestGoal.y * T + 9);
      g.stroke();
      g.setLineDash([]);
    });
    battle.chests.forEach(function (c) {
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
    if (fx.fx === 'text') {
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
