/*
 * 戰鬥邏輯 (不依賴 DOM，可在 Node 中無畫面模擬)
 * 格子制移動：每個單位佔一格，8 方向移動，BFS 尋路。
 */
(function (S) {
  'use strict';

  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function cheb(ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); }
  function euclid(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
  function sign(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }

  // ======================= Unit =======================
  // preset: 選將模式預先亂數產生的士兵 { type, hp, mp, atk, def, int, spr, physSkills, magicSkills }
  function Unit(battle, side, type, x, y, army, preset) {
    var st = S.UNIT_TYPES[type];
    this.id = battle.units.length;
    this.side = side;
    this.type = type;
    this.isGeneral = type === 'general';
    this.name = this.isGeneral ? army.name : st.name;
    this.x = x; this.y = y;           // 邏輯格 (移動中為目的地)
    this.homeX = x; this.homeY = y;   // 布陣位置 (主將待機時退回)
    this.fromX = x; this.fromY = y;   // 移動起點 (繪製用)
    this.moveT = 0; this.moveDur = 0; this.walkT = 0;
    this.facing = side === 0 ? 1 : -1;
    var rng = battle.rng;
    function roll(v) { return Math.max(1, Math.round(v * (1 + (rng() * 2 - 1) * S.STAT_VARIANCE))); }
    if (this.isGeneral) {
      var gs = S.GENERAL_STATS;
      function gen(k) { return roll(st[k] + army[gs[k].from] * gs[k].ratio); }
      this.maxHp = gen('hp');
      this.maxMp = gen('mp');
      this.atk = gen('atk');
      this.def = gen('def');
      this.int = gen('int');
      this.spr = gen('spr');
    } else if (preset) {
      this.maxHp = preset.hp;
      this.maxMp = preset.mp;
      this.atk = preset.atk;
      this.def = Math.max(1, Math.round(preset.def * (1 + army.lead / 400)));
      this.int = preset.int;
      this.spr = preset.spr;
    } else {
      this.maxHp = roll(st.hp);
      this.maxMp = roll(st.mp);
      this.atk = roll(st.atk);
      this.def = roll(st.def * (1 + army.lead / 400));
      this.int = roll(st.int);
      this.spr = roll(st.spr);
    }
    // 等級加成 (opts.levels[side] = { general: 2, spear: 1, ... }) 與裝備的全軍士兵加成 (army.troopBonus)
    var lv = battle.levels && battle.levels[side];
    this.level = (lv && lv[type]) || 0;
    var named = preset && preset.name != null;   // 士兵角色 (soldiers.js)：能力已含等級，名字、技能等級、特效都由 preset 帶入
    var bonus = (named ? 0 : this.level * S.LEVEL.BONUS) + (this.isGeneral ? 0 : army.troopBonus || 0);   // 士兵角色的等級已算在 preset 裡
    if (bonus) {
      var mul = 1 + bonus;
      var self = this;
      ['maxHp', 'maxMp', 'atk', 'def', 'int', 'spr'].forEach(function (k) { self[k] = Math.round(self[k] * mul); });
    }
    if (named) {
      this.name = preset.name;
      this.named = true;
      this.level = preset.lv || 0;
      this.quality = preset.quality;
      this.skillLv = preset.skillLv || null;
      this.procs = preset.procs || null;
    }
    this.hp = this.maxHp;
    this.mp = this.maxMp;
    var nSkills = this.isGeneral ? S.GENERAL_SKILLS : 2;   // 一般士兵物理 / 魔法各兩個 (和士兵角色的四個技能對等)
    this.physSkills = preset ? preset.physSkills.slice() : S.pickDistinct(S.PHYSICAL_SKILLS, nSkills, rng);
    this.magicSkills = preset ? preset.magicSkills.slice() : S.pickDistinct(S.MAGIC_SKILLS, nSkills, rng);
    this.buffs = [];   // { kind: 'stat'|'burn'|'stun', t: 剩餘秒數, ... }
    this.range = named && preset.range ? preset.range : st.range;
    this.ranged = named && preset.ranged != null ? preset.ranged : !!st.ranged;
    this.moveTime = st.moveTime / (this.isGeneral ? 1 + (army.speedBonus || 0) : 1) * (named ? preset.moveMul || 1 : 1);   // 裝備：主將移動速度
    this.attackTime = st.attackTime * (named ? preset.attackMul || 1 : 1);
    this.atkCd = battle.rng() * 0.6;
    this.thinkCd = battle.rng() * 0.4;
    this.retargetCd = 0;
    this.kiteCd = 0;
    this.target = null;
    this.chestGoal = null;            // 正要去開的寶箱
    this.chestForced = false;         // 玩家下令：優先於交戰
    this.order = null;                // 玩家手動操控主將的命令
    this.charged = false;
    this.engaged = !this.isGeneral;
    this.dead = false;
    this.deathT = 0;
    this.flashT = 0;
    this.lungeT = 0; this.lungeDx = 0; this.lungeDy = 0;
  }

  Unit.prototype.isMoving = function () { return this.moveT < this.moveDur; };
  Unit.prototype.progress = function () { return this.isMoving() ? this.moveT / this.moveDur : 1; };
  Unit.prototype.posX = function () { return this.fromX + (this.x - this.fromX) * this.progress(); };
  Unit.prototype.posY = function () { return this.fromY + (this.y - this.fromY) * this.progress(); };

  // 套用增益 / 減益後的數值
  Unit.prototype.stat = function (name) {
    var v = this[name];
    for (var i = 0; i < this.buffs.length; i++) {
      if (this.buffs[i].kind === 'stat' && this.buffs[i].stat === name) v *= this.buffs[i].mul;
    }
    return v;
  };
  Unit.prototype.findBuff = function (kind, stat) {
    for (var i = 0; i < this.buffs.length; i++) {
      var b = this.buffs[i];
      if (b.kind === kind && (!stat || b.stat === stat)) return b;
    }
    return null;
  };

  // ======================= Battle =======================
  function Battle(armies, opts) {
    opts = opts || {};
    // 指定 seed 時可重現 (除錯用)；否則每次都用加密亂數源
    this.seed = opts.seed != null ? opts.seed : null;
    this.rng = this.seed != null ? mulberry32(this.seed) : S.random;
    this.armies = armies;
    this.levels = opts.levels || null;
    this.autoTactics = opts.autoTactics || [false, false];   // 玩家方的計策交給電腦判斷
    this.units = [];
    this.projectiles = [];
    this.effects = [];
    this.log = [];
    this.skillUses = {};
    this.time = 0;
    this.state = 'fighting';
    this.winner = -1;
    this.generals = [null, null];
    // 地圖：一般戰鬥用 S.MAP；探索模式 (opts.explore，見 explore.js) 用產生的大地圖
    this.explore = opts.explore || null;
    this.map = this.explore ? this.explore.map : S.MAP;
    this.cols = this.map[0].length;
    this.rows = this.map.length;
    this.timeLimit = this.explore ? Infinity : S.TIME_LIMIT;
    this.ilvl = opts.ilvl || (this.explore && this.explore.ilvl) || 1;   // 精英、神壇掉落的物品等級
    this.mf = opts.mf || 0;       // 尋寶 % (裝備的中綴)：戰鬥中掉落的裝備品質更好
    this.lootFound = [];          // 這場戰鬥撿到的裝備 (精英掉落、探索的寶箱 / 敵營 / 神壇)
    this.recruited = [];          // 被收服、願意加入的流浪武者 (soldiers.js 的士兵物件)
    this.sfx = [];                // 音效事件 { n: 名稱, x, y }，由 main.js 取出播放 (Node 模擬時沒人取，會被截斷)
    this.initEvents(opts);
    this.walls = new Array(this.cols * this.rows);
    this.occ = new Array(this.cols * this.rows);
    for (var y = 0; y < this.rows; y++) {
      for (var x = 0; x < this.cols; x++) {
        this.walls[this.idx(x, y)] = this.map[y][x] === '#';
        this.occ[this.idx(x, y)] = null;
      }
    }
    if (this.explore) this.deployExplore();
    else { this.deploy(0); this.deploy(1); }
    if (opts.eliteChance && !this.explore) this.rollElites(opts.eliteChance);   // 一般出征：敵兵依機率成為精英
    this.order = this.units.map(function (u, i) { return i; });
  }

  // ======================= 探索模式 =======================
  // 我軍在起點附近；敵軍依 explore.spawns 配置 (camp 0 = 敵將據點)，一開始都在沉睡
  Battle.prototype.deployExplore = function () {
    var ex = this.explore, self = this;
    var cells = ex.startCells.slice();
    var mine = this.armies[0];
    var g = this.addUnit(0, 'general', cells[0].x, cells[0].y, mine);
    g.engaged = true;
    g.maxHp = g.hp = Math.round(g.maxHp * S.EXPLORE.HERO_HP);
    mine.units.forEach(function (t, i) {
      var c = cells[i + 1];
      if (c) self.addUnit(0, typeof t === 'string' ? t : t.type, c.x, c.y, mine, typeof t === 'string' ? null : t);
    });
    ex.spawns.forEach(function (sp) {
      var u = sp.wanderer ? self.addUnit(1, sp.type, sp.x, sp.y, self.armies[1], S.soldierStats(sp.wanderer))
                          : self.addUnit(1, sp.type, sp.x, sp.y, self.armies[1]);
      if (sp.wanderer) u.wanderer = sp.wanderer;
      u.camp = sp.camp;
      u.awake = false;
      u.engaged = true;
      if (sp.elite) self.makeElite(u, sp.elite);
    });
    this.shrines = (ex.shrines || []).map(function (sh) { return { x: sh.x, y: sh.y, type: sh.type, used: false }; });
    this.units.forEach(function (u) { if (u.side === 0) u.awake = true; });
    this.campLeft = {};
    this.units.forEach(function (u) { if (u.side === 1) self.campLeft[u.camp] = (self.campLeft[u.camp] || 0) + 1; });
    this.campsCleared = 0;
    this.chests = ex.chests.map(function (c, i) {
      return { id: i, x: c.x, y: c.y, loot: c.loot, item: c.loot ? 'loot' : null, open: true, born: 0 };
    });
    this.chests.forEach(function (c) { if (!c.loot) c.item = self.rollChestItem(); });
    this.seen = new Uint8Array(this.cols * this.rows);   // 戰爭迷霧：探索過的格子
    this.vis = new Uint8Array(this.cols * this.rows);    // 目前看得到的格子
    this.updateVision();
  };

  Battle.prototype.unitsNear = function (side, x, y, r) {
    var out = [];
    for (var i = 0; i < this.units.length; i++) {
      var o = this.units[i];
      if (!o.dead && o.side === side && cheb(x, y, o.x, o.y) <= r) out.push(o);
    }
    return out;
  };

  // 主將跑太前面：附近的士兵不到一半就先等部隊跟上
  Battle.prototype.armyLagging = function (g) {
    var R = S.EXPLORE.COHESION, n = 0, near = 0;
    for (var i = 0; i < this.units.length; i++) {
      var o = this.units[i];
      if (o.dead || o.side !== g.side || o.isGeneral) continue;
      n++;
      if (cheb(o.x, o.y, g.x, g.y) <= R) near++;
    }
    return n > 0 && near * 2 < n;
  };

  Battle.prototype.wakeCamp = function (camp) {
    var first = true, self = this;
    this.units.forEach(function (o) {
      if (o.dead || o.side !== 1 || o.camp !== camp || o.awake) return;
      o.awake = true;
      o.thinkCd = self.rng() * 0.3;
      if (first) { self.addText(o, '!', '#ff4040', 1.0, -0.6); self.sound('alert', o); first = false; }
    });
    if (camp === 0 && !this.bossAwake) {
      this.bossAwake = true;
      this.notify('敵將 ' + this.armies[1].name + ' 察覺了你！', '#ff6040');
      this.sound('bossAlert');
    }
  };

  // 擊破一座敵營：掉落一件裝備
  Battle.prototype.checkCampCleared = function (camp, last) {
    this.campLeft[camp]--;
    if (this.campLeft[camp] > 0) return;
    this.campsCleared++;
    this.reinforce();
    var item = S.rollLoot(this.explore.ilvl, this.mf);
    this.lootFound.push(item);
    var info = S.itemInfo(item);
    this.addText(last, '戰利品!', S.QUALITIES[info.q].color, 1.6, -0.6);
    this.notify('擊破敵營！獲得【' + S.QUALITIES[info.q].name + '】' + info.name, S.QUALITIES[info.q].color);
    this.sound('loot_' + info.q);
  };

  // 流浪武者被打倒：有機率被收服，戰鬥結束後加入營舍
  Battle.prototype.tryRecruit = function (e) {
    var sol = e.wanderer, chance = S.EXPLORE.RECRUIT_CHANCE[sol.q] || 0.3;
    if (this.rng() < chance) {
      this.recruited.push(sol);
      this.addText(e, '願意加入!', '#80ff80', 2.0, -1.0);
      this.notify(S.soldierFullName(sol) + '（' + S.CLASSES[sol.cls].name + '）被你的武勇折服，願意加入！', '#80ff80');
      this.sound(sol.q === 'unique' ? 'loot_unique' : 'shrine', e);
    } else {
      this.notify(S.soldierFullName(sol) + ' 敗走了…', '#a0a0b0');
    }
  };

  // 援軍：一隊陣亡的士兵帶著一半兵力回到主將身邊
  Battle.prototype.reinforce = function () {
    var g = this.generals[0];
    if (!g || g.dead) return;
    var u = null;
    for (var i = 0; i < this.units.length; i++) {
      var o = this.units[i];
      if (o.side === 0 && o.dead && !o.isGeneral) { u = o; break; }
    }
    if (!u) return;
    for (var r = 1; r <= 4; r++) {
      for (var y = g.y - r; y <= g.y + r; y++) {
        for (var x = g.x - r; x <= g.x + r; x++) {
          if (cheb(x, y, g.x, g.y) !== r || !this.isFree(x, y, null) || this.chestAt(x, y)) continue;
          u.dead = false; u.deathT = 0; u.buffs = []; u.target = null; u.chestGoal = null;
          u.hp = Math.round(u.maxHp * 0.5); u.mp = 0;
          u.x = u.fromX = x; u.y = u.fromY = y; u.moveT = u.moveDur = 0;
          this.occ[this.idx(x, y)] = u;
          this.addText(u, '援軍!', '#80c0ff', 1.4, -0.6);
          this.notify(u.name + ' 歸隊了！', '#80c0ff');
          this.sound('reinforce');
          return;
        }
      }
    }
  };

  // 探索模式的思考：回傳這個單位要考慮的敵人；回傳 null 表示這次思考已處理完 (沉睡 / 跟隨 / 回營)
  Battle.prototype.exploreThink = function (u) {
    var E = S.EXPLORE;
    if (u.side === 1) {
      if (!u.awake) {
        if (this.unitsNear(0, u.x, u.y, E.AGGRO).length) this.wakeCamp(u.camp);
        else { u.thinkCd = 0.4 + this.rng() * 0.3; return null; }
      }
      var far = cheb(u.x, u.y, u.homeX, u.homeY) > E.LEASH;
      var foes = far ? [] : this.unitsNear(0, u.x, u.y, E.CHASE);
      if (foes.length) return foes;
      // 附近沒有我軍：回營，到家後恢復沉睡並回滿兵力
      if (u.x === u.homeX && u.y === u.homeY) { u.awake = false; u.hp = u.maxHp; u.target = null; u.thinkCd = 0.5; return null; }
      if (!this.stepToward(u, { x: u.homeX, y: u.homeY })) {
        if (cheb(u.x, u.y, u.homeX, u.homeY) <= 1) { u.awake = false; u.hp = u.maxHp; }
        u.thinkCd = 0.4;
      }
      return null;
    }
    var near = this.unitsNear(1, u.x, u.y, E.ENGAGE);
    var f = this.focus[0];        // 集火目標：稍遠也會去打
    if (f && !f.dead && !u.isGeneral && cheb(f.x, f.y, u.x, u.y) <= E.CHASE && near.indexOf(f) < 0) near.push(f);
    if (u.order) return this.alive(1);
    if (near.length) return near;
    if (u.chestGoal && u.chestGoal.open && this.stepToward(u, u.chestGoal)) return null;
    // 附近沒有敵人：士兵跟著主將走
    var g = this.generals[0];
    if (!u.isGeneral && g && !g.dead && cheb(u.x, u.y, g.x, g.y) > E.FOLLOW) {
      var step = this.bfsStep(u, function (cx, cy) { return cheb(cx, cy, g.x, g.y) <= 2; }, g, 2500);
      if (step) { this.moveTo(u, step.x, step.y); return null; }
    }
    u.thinkCd = 0.25 + this.rng() * 0.15;
    return null;
  };

  // 視野：我軍附近 VISION 格內看得到，並記錄為探索過
  Battle.prototype.updateVision = function () {
    var R = S.EXPLORE.VISION, W = this.cols, H = this.rows, vis = this.vis, seen = this.seen;
    vis.fill(0);
    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (u.dead || u.side !== 0) continue;
      for (var y = Math.max(0, u.y - R); y <= Math.min(H - 1, u.y + R); y++) {
        for (var x = Math.max(0, u.x - R); x <= Math.min(W - 1, u.x + R); x++) {
          var dx = x - u.x, dy = y - u.y;
          if (dx * dx + dy * dy <= R * R + R) { vis[y * W + x] = 1; seen[y * W + x] = 1; }
        }
      }
    }
  };
  Battle.prototype.isVisible = function (x, y) {
    return !this.explore || (this.inBounds(x, y) && this.vis[this.idx(x, y)] === 1);
  };

  // 登記音效事件 (at：發生的位置，可省略)
  Battle.prototype.sound = function (name, at) {
    if (this.sfx.length > 60) this.sfx.splice(0, 30);
    this.sfx.push({ n: name, x: at ? at.x : null, y: at ? at.y : null });
  };

  // 是否由玩家操控 (主將不會自行出陣，計策由玩家施放)
  Battle.prototype.isHuman = function (side) { return !!this.control[side]; };

  Battle.prototype.idx = function (x, y) { return y * this.cols + x; };
  Battle.prototype.inBounds = function (x, y) { return x >= 0 && y >= 0 && x < this.cols && y < this.rows; };
  Battle.prototype.isWall = function (x, y) { return !this.inBounds(x, y) || this.walls[this.idx(x, y)]; };
  Battle.prototype.isFree = function (x, y, self) {
    if (this.isWall(x, y)) return false;
    var o = this.occ[this.idx(x, y)];
    return o === null || o === self;
  };

  // 能否從 (cx,cy) 走 (dx,dy) 一步；斜走不可切牆角
  Battle.prototype.canStep = function (cx, cy, dx, dy, self, ignoreUnits) {
    var nx = cx + dx, ny = cy + dy;
    if (this.isWall(nx, ny)) return false;
    if (!ignoreUnits && !this.isFree(nx, ny, self)) return false;
    if (dx && dy && (this.isWall(cx + dx, cy) || this.isWall(cx, cy + dy))) return false;
    return true;
  };

  Battle.prototype.deploy = function (side) {
    var army = this.armies[side];
    var self = this;
    function place(type, preset) {
      var slots = S.FORMATION[type] || [];
      for (var i = 0; i < slots.length; i++) {
        var x = side === 0 ? slots[i][0] : self.cols - 1 - slots[i][0];
        var y = slots[i][1];
        if (self.isFree(x, y, null)) return self.addUnit(side, type, x, y, army, preset);
      }
      // 陣型格用完：找己方半場任一空格
      for (var cx = 0; cx < self.cols / 2; cx++) {
        for (var cy = 0; cy < self.rows; cy++) {
          var px = side === 0 ? cx : self.cols - 1 - cx;
          if (self.isFree(px, cy, null)) return self.addUnit(side, type, px, cy, army, preset);
        }
      }
    }
    place('general');
    // units 的元素可以是兵種字串，或選將模式的預設士兵物件
    army.units.forEach(function (u) {
      if (typeof u === 'string') place(u);
      else place(u.type, u);
    });
  };

  Battle.prototype.addUnit = function (side, type, x, y, army, preset) {
    var u = new Unit(this, side, type, x, y, army, preset);
    this.units.push(u);
    this.occ[this.idx(x, y)] = u;
    if (u.isGeneral) this.generals[side] = u;
    return u;
  };

  Battle.prototype.alive = function (side) {
    return this.units.filter(function (u) { return !u.dead && u.side === side; });
  };

  Battle.prototype.generalAlive = function (side) {
    var g = this.generals[side];
    return !!g && !g.dead;
  };

  // ---- 每個模擬步 ----
  Battle.prototype.step = function (dt) {
    if (this.state === 'fighting') {
      this.time += dt;
      if (this.time >= this.timeLimit) this.timeUp();
      else this.updateEvents(dt);
    }
    // 每步打亂行動順序，避免固定某一方先動
    var order = this.order;
    for (var k = order.length - 1; k > 0; k--) {
      var j = (this.rng() * (k + 1)) | 0;
      var t = order[k]; order[k] = order[j]; order[j] = t;
    }
    for (var i = 0; i < order.length; i++) this.updateUnit(this.units[order[i]], dt);

    for (var p = this.projectiles.length - 1; p >= 0; p--) {
      var pr = this.projectiles[p];
      pr.t += dt;
      if (pr.t >= pr.dur) {
        this.resolveHit(pr.src, pr.target, pr.hit);
        this.projectiles.splice(p, 1);
      }
    }
    for (var e = this.effects.length - 1; e >= 0; e--) {
      this.effects[e].t += dt;
      if (this.effects[e].t >= this.effects[e].dur) this.effects.splice(e, 1);
    }
    for (var n = this.notices.length - 1; n >= 0; n--) {
      this.notices[n].t += dt;
      if (this.notices[n].t >= this.notices[n].dur) this.notices.splice(n, 1);
    }
  };

  Battle.prototype.updateUnit = function (u, dt) {
    if (u.dead) { if (u.deathT > 0) u.deathT -= dt; return; }
    u.flashT -= dt; u.lungeT -= dt; u.atkCd -= dt; u.retargetCd -= dt; u.kiteCd -= dt;
    u.mp = Math.min(u.maxMp, u.mp + S.MP_REGEN * dt);
    this.updateBuffs(u, dt);
    if (u.dead) return;

    if (u.isMoving()) {
      u.moveT += dt;
      u.walkT += dt;
      if (!u.isMoving()) {
        u.fromX = u.x; u.fromY = u.y; u.moveT = u.moveDur = 0;
        var chest = this.chestAt(u.x, u.y);
        if (chest) this.openChest(u, chest);
        var shrine = this.shrines && this.shrineAt(u.x, u.y);
        if (shrine) this.touchShrine(u, shrine);
      }
      return;
    }
    if (this.state !== 'fighting' || u.findBuff('stun')) return;
    u.thinkCd -= dt;
    if (u.thinkCd > 0) return;
    this.think(u);
  };

  // ======================= AI =======================
  Battle.prototype.inRangeAt = function (u, tx, ty, e) {
    return u.ranged ? euclid(tx, ty, e.x, e.y) <= this.rangeOf(u) : cheb(tx, ty, e.x, e.y) <= 1;
  };

  Battle.prototype.think = function (u) {
    var enemies = this.alive(1 - u.side);
    if (!enemies.length) return;
    if (this.explore) {
      enemies = this.exploreThink(u);
      if (!enemies) return;
    }
    if (u.elite) this.eliteThink(u, enemies);
    if (u.isGeneral && u.side === 1 && this.slamThink(u, enemies)) return;   // 敵將蓄力重擊
    if (!u.isGeneral) { enemies = this.stanceFilter(u, enemies); if (!enemies) return; }   // 方陣

    // 玩家手動下令的主將 (移動 / 攻擊 / 固守，見 tactics.js)
    if (u.order) { this.followOrder(u, enemies); return; }
    // 玩家的主將沒有被操控時會自動作戰；但兵力低於 35% 就不主動追擊，只反擊射程內的敵人 (讓他有時間回復)
    if (u.isGeneral && this.isHuman(u.side) && !u.held && u.hp < u.maxHp * S.GENERAL_RETREAT_HP) {
      if (!this.tryAttack(u, enemies)) u.thinkCd = 0.3;
      return;
    }

    // 主將：玩家按 Q 下令待命時退回後方 (只反擊射程內的敵人)；沒下令時和電腦一樣自行判斷出陣
    if (!u.engaged && this.isHuman(u.side) && u.held) {
      if (!this.tryAttack(u, enemies)) this.walkHome(u);
      return;
    }
    // 電腦方主將：先在後方觀望，敵軍接近 / 己方兵少 / 超過觀望時間才出擊
    if (!u.engaged) {
      var near = enemies.some(function (e) { return cheb(u.x, u.y, e.x, e.y) <= S.GENERAL_ENGAGE_DIST; });
      var friends = this.alive(u.side).length - 1;
      if (near || friends <= S.GENERAL_ENGAGE_FRIENDS || this.time >= S.GENERAL_HOLD_TIME) {
        u.engaged = true;
        this.addText(u, '出陣!', '#f8d838', 1.0);
      } else {
        u.thinkCd = 0.3;
        return;
      }
    }

    // 寶箱：已消失就放棄；玩家下令的優先於交戰
    if (u.chestGoal && !u.chestGoal.open) { u.chestGoal = null; u.chestForced = false; }
    if (u.chestGoal && u.chestForced && this.stepToward(u, u.chestGoal)) return;

    // 弓兵被貼身：機率後撤拉開距離
    if (u.ranged && u.kiteCd <= 0) {
      var adjacent = enemies.some(function (e) { return cheb(u.x, u.y, e.x, e.y) <= 1; });
      if (adjacent && this.rng() < S.KITE_CHANCE) {
        var r = this.findRetreat(u, enemies);
        if (r) { u.kiteCd = S.KITE_COOLDOWN; this.moveTo(u, r.x, r.y); return; }
      }
    }

    // 射程內有敵人：攻擊 (冷卻中就原地等待)
    if (this.tryAttack(u, enemies)) return;
    if (u.chestGoal && this.stepToward(u, u.chestGoal)) return;

    // 選目標並朝目標前進
    if (!u.target || u.target.dead || u.retargetCd <= 0) {
      u.target = this.chooseTarget(u, enemies);
      u.retargetCd = 1 + this.rng() * 0.5;
    }
    var step = this.pathStep(u, u.target);
    if (step) this.moveTo(u, step.x, step.y);
    else u.thinkCd = 0.2 + this.rng() * 0.2;
  };

  Battle.prototype.tryAttack = function (u, enemies) {
    var self = this;
    var inRange = enemies.filter(function (e) { return self.inRangeAt(u, u.x, u.y, e); });
    if (!inRange.length) return false;
    var best = this.pickInRange(u, inRange);
    u.target = best;
    if (best.x !== u.x) u.facing = sign(best.x - u.x);
    if (u.atkCd <= 0) this.attack(u, best);
    u.thinkCd = 0.05;
    return true;
  };

  // 走向某一格 (寶箱等)；走不動回傳 false
  Battle.prototype.stepToward = function (u, pos) {
    if (u.x === pos.x && u.y === pos.y) return false;
    var step = this.bfsStep(u, function (cx, cy) { return cx === pos.x && cy === pos.y; }, pos);
    if (!step) return false;
    this.moveTo(u, step.x, step.y);
    return true;
  };

  // 待機中的主將退回布陣位置
  Battle.prototype.walkHome = function (u) {
    var home = { x: u.homeX, y: u.homeY };
    if ((u.x !== home.x || u.y !== home.y) && this.isFree(home.x, home.y, u) && this.stepToward(u, home)) return;
    u.thinkCd = 0.3;
  };

  // 射程內挑：相剋 > 殘兵 > 主將
  Battle.prototype.pickInRange = function (u, list) {
    var best = null, bestScore = -Infinity;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var s = S.matchup(u.type, e.type) + (1 - e.hp / e.maxHp) * 0.5 + (e.isGeneral ? 0.3 : 0);
      if (e === u.target) s += 0.2;
      if (this.focus && e === this.focus[u.side] && !u.isGeneral) s += 5;   // 集火
      if (s > bestScore) { bestScore = s; best = e; }
    }
    return best;
  };

  // 全域選目標：實際路徑距離 / 相剋偏好，並避免全部擠同一個目標
  Battle.prototype.chooseTarget = function (u, enemies) {
    var focus = this.focus && this.focus[u.side];
    if (focus && !focus.dead && !u.isGeneral && enemies.indexOf(focus) >= 0) return focus;   // 集火
    var field = this.distanceField(u.x, u.y, this.explore ? S.EXPLORE.CHASE + 6 : null);
    var allies = this.alive(u.side);
    var best = null, bestScore = Infinity;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      var d = field[this.idx(e.x, e.y)];
      if (d < 0) d = 99;
      var pref = S.matchup(u.type, e.type) * (e.isGeneral ? 1.15 : 1);
      var crowd = 0;
      for (var j = 0; j < allies.length; j++) {
        if (allies[j] !== u && allies[j].target === e) crowd++;
      }
      var score = (d + 1) / pref * (1 + 0.2 * crowd) * (0.95 + this.rng() * 0.1);
      if (e === u.target) score *= 0.8;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  };

  // 只考慮城牆的 BFS 距離場；maxD：只展開到這個距離 (大地圖省時間)
  Battle.prototype.distanceField = function (sx, sy, maxD) {
    var W = this.cols;
    var field = new Array(W * this.rows).fill(-1);
    var q = [this.idx(sx, sy)];
    field[q[0]] = 0;
    for (var h = 0; h < q.length; h++) {
      var c = q[h], cx = c % W, cy = (c / W) | 0;
      if (maxD != null && field[c] >= maxD) continue;
      for (var d = 0; d < 8; d++) {
        if (!this.canStep(cx, cy, DIRS[d][0], DIRS[d][1], null, true)) continue;
        var n = this.idx(cx + DIRS[d][0], cy + DIRS[d][1]);
        if (field[n] >= 0) continue;
        field[n] = field[c] + 1;
        q.push(n);
      }
    }
    return field;
  };

  // BFS (避開其他單位) 找到能攻擊目標的格子，回傳第一步
  Battle.prototype.pathStep = function (u, target) {
    var self = this;
    return this.bfsStep(u, function (cx, cy) { return self.inRangeAt(u, cx, cy, target); }, target,
      this.explore && !u.isGeneral ? 3000 : null);   // 大地圖上士兵只找附近；主將的命令要能走遠路
  };

  // BFS 找到第一個符合 goal(x, y) 的格子，回傳第一步；走不到就朝 fallback 貪婪靠近
  // maxNodes：最多展開幾格 (大地圖上一般士兵只找附近，主將的移動命令不限制)
  Battle.prototype.bfsStep = function (u, goal, fallback, maxNodes) {
    var W = this.cols;
    var prev = new Array(W * this.rows).fill(-2);
    var start = this.idx(u.x, u.y);
    prev[start] = -1;
    var q = [start];
    var limit = maxNodes || Infinity;
    for (var h = 0; h < q.length && h < limit; h++) {
      var c = q[h], cx = c % W, cy = (c / W) | 0;
      if (c !== start && goal(cx, cy)) {
        while (prev[c] !== start) c = prev[c];
        return { x: c % W, y: (c / W) | 0 };
      }
      var order = this.shuffledDirs();
      for (var d = 0; d < 8; d++) {
        var dx = order[d][0], dy = order[d][1];
        if (!this.canStep(cx, cy, dx, dy, u, false) &&
            !(c === start && this.canSwap(u, cx + dx, cy + dy) && this.canStep(cx, cy, dx, dy, u, true))) continue;
        var n = this.idx(cx + dx, cy + dy);
        if (prev[n] !== -2) continue;
        prev[n] = c;
        q.push(n);
      }
    }
    return this.greedyStep(u, fallback);
  };

  // 探索模式的主將可以和身旁沒在移動的我方士兵交換位置 (不會被自己的部隊困住)
  Battle.prototype.canSwap = function (u, x, y) {
    if (!u.isGeneral || !this.inBounds(x, y) || !(this.explore || (u.order && u.order.kind === 'walk'))) return false;
    var o = this.occ[this.idx(x, y)];
    return !!o && o !== u && o.side === u.side && !o.isMoving() && !o.dead;
  };

  // 路被擋住：沿著 (忽略單位的) 距離場往目標靠近一步
  Battle.prototype.greedyStep = function (u, target) {
    var field = this.distanceField(target.x, target.y,
      this.explore && !u.isGeneral ? Math.max(Math.abs(u.x - target.x), Math.abs(u.y - target.y)) + 12 : null);
    var cur = field[this.idx(u.x, u.y)];
    var best = null, bestD = cur;
    var order = this.shuffledDirs();
    for (var d = 0; d < 8; d++) {
      var dx = order[d][0], dy = order[d][1];
      if (!this.canStep(u.x, u.y, dx, dy, u, false)) continue;
      var v = field[this.idx(u.x + dx, u.y + dy)];
      if (v >= 0 && v < bestD) { bestD = v; best = { x: u.x + dx, y: u.y + dy }; }
    }
    return best;
  };

  Battle.prototype.shuffledDirs = function () {
    var a = DIRS.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = (this.rng() * (i + 1)) | 0;
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };

  // 弓兵後撤：找一個不與任何敵人相鄰的空格，偏向己方後方
  Battle.prototype.findRetreat = function (u, enemies) {
    var best = null, bestScore = -Infinity;
    for (var d = 0; d < 8; d++) {
      var dx = DIRS[d][0], dy = DIRS[d][1];
      if (!this.canStep(u.x, u.y, dx, dy, u, false)) continue;
      var nx = u.x + dx, ny = u.y + dy;
      var minD = Infinity;
      for (var i = 0; i < enemies.length; i++) minD = Math.min(minD, cheb(nx, ny, enemies[i].x, enemies[i].y));
      if (minD <= 1) continue;
      var score = minD + (u.side === 0 ? -nx : nx) * 0.1;
      if (score > bestScore) { bestScore = score; best = { x: nx, y: ny }; }
    }
    return best;
  };

  Battle.prototype.moveTo = function (u, nx, ny) {
    var other = this.occ[this.idx(nx, ny)];
    if (other && other !== u && this.canSwap(u, nx, ny)) {
      // 和我方士兵交換位置：士兵退到主將原本的格子
      this.occ[this.idx(u.x, u.y)] = other;
      other.fromX = other.x; other.fromY = other.y;
      other.x = u.x; other.y = u.y;
      other.moveT = 0;
      other.moveDur = other.moveTime;
      other.thinkCd = Math.max(other.thinkCd, 0.3);
    } else {
      this.occ[this.idx(u.x, u.y)] = null;
    }
    this.occ[this.idx(nx, ny)] = u;
    var diag = nx !== u.x && ny !== u.y;
    u.fromX = u.x; u.fromY = u.y;
    if (nx !== u.x) u.facing = sign(nx - u.x);
    u.x = nx; u.y = ny;
    u.moveT = 0;
    u.moveDur = u.moveTime * (diag ? 1.3 : 1) * (u.findBuff('slow') ? 1.5 : 1);   // 緩速
    u.charged = u.type === 'cavalry';
    u.thinkCd = 0;
  };

  // ======================= 戰鬥 =======================
  var PHYS_SKILL_COLOR = '#ffe060';
  var MAGIC_SKILL_COLOR = '#80e0ff';
  var MAGIC_COLOR = '#c080ff';

  Battle.prototype.attack = function (u, e) {
    u.atkCd = u.attackTime * (0.9 + this.rng() * 0.2) * (u.findBuff('slow') ? 1.5 : 1);   // 緩速

    // 隨機決定物理或魔法，再判定是否發動特技
    var magic = this.rng() < u.int / (u.atk + u.int);
    var pool = magic ? u.magicSkills : u.physSkills;
    var skId = pool.length ? pool[(this.rng() * pool.length) | 0] : null;
    var sk = skId ? S.SKILLS[skId] : null;
    var skLv = (u.skillLv && skId && u.skillLv[skId]) || 1;   // 士兵的技能等級：威力 +6% / 級、發動率 +0.5% / 級
    var skill = null;
    if (sk && u.mp >= sk.mp && this.rng() < S.SKILL_CHANCE + 0.005 * (skLv - 1)) {
      if (sk.support) {
        u.skillMul = 1 + 0.06 * (skLv - 1);
        if (this.castSupport(u, sk)) { u.mp -= sk.mp; this.countSkill(sk); u.charged = false; return; }
      } else {
        skill = sk;
        u.mp -= sk.mp;
        this.countSkill(sk);
        this.addText(u, sk.name, magic ? MAGIC_SKILL_COLOR : PHYS_SKILL_COLOR, 1.0, -0.5);
        this.sound(magic ? 'skillMagic' : 'skillPhys', u);
      }
    }

    var hit = { magic: magic, skill: skill, mul: skill ? 1 + 0.06 * (skLv - 1) : 1 };
    var adjacent = cheb(u.x, u.y, e.x, e.y) <= 1;
    if (!magic && u.ranged && adjacent) hit.mul *= S.UNIT_TYPES[u.type].meleePenalty || 0.5;
    if (!magic && u.charged) hit.mul *= S.UNIT_TYPES.cavalry.chargeBonus;
    u.charged = false;

    if (magic || (u.ranged && !adjacent)) {
      this.sound(magic ? 'magic' : 'arrow', u);
      var dist = euclid(u.x, u.y, e.x, e.y);
      this.projectiles.push({
        sx: u.x, sy: u.y, tx: e.x, ty: e.y, t: 0, dur: 0.1 + dist * (magic ? 0.1 : 0.07),
        kind: magic ? 'orb' : 'arrow', color: skill && skill.color || MAGIC_COLOR,
        src: u, target: e, hit: hit, side: u.side
      });
    } else {
      this.sound('hit', u);
      u.lungeT = S.LUNGE_TIME;
      u.lungeDx = sign(e.x - u.x);
      u.lungeDy = sign(e.y - u.y);
      this.resolveHit(u, e, hit);
    }
  };

  // 命中結算：傷害、範圍波及、多段、附加狀態
  Battle.prototype.resolveHit = function (u, e, hit) {
    if (e.dead) return;
    var sk = hit.skill || {};
    var power = (sk.power || 1) * hit.mul * (sk.element === 'fire' ? this.fireMul() : 1);
    var targets = [e];
    if (sk.area) {
      this.alive(e.side).forEach(function (o) {
        if (o !== e && cheb(o.x, o.y, e.x, e.y) <= sk.area) targets.push(o);
      });
    }
    // 主將的中綴特效 (裝備)：破甲、致命一擊、吸血、燃燒 / 混亂 / 緩速
    var procs = u.procs || (u.isGeneral && this.armies[u.side] && this.armies[u.side].procs);   // 士兵也可以有特效
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      for (var h = 0; h < (sk.hits || 1) && !t.dead; h++) {
        var ignore = Math.min(0.9, (sk.ignoreDef || 0) + (procs && !hit.magic ? procs.pierce / 100 : 0));
        var dmg = this.calcDamage(u, t, hit.magic, power, ignore);
        if (t !== e) dmg = Math.max(1, Math.round(dmg * this.aoeMul(t)));   // 範圍波及 (散開陣型減半)
        if (procs && procs.crit && this.rng() < procs.crit / 100) {
          dmg *= 2;
          this.addText(t, '致命!', '#ff4060', 0.9, -0.9);
        }
        this.applyDamage(t, dmg, hit.magic ? '#e0b0ff' : null);
        if (u.elite) this.eliteOnHit(u, dmg);
        if (procs && procs.leech && !u.dead) u.hp = Math.min(u.maxHp, u.hp + dmg * procs.leech / 100);
      }
      if (t.dead) continue;
      if (procs) this.applyProcs(u, t, procs);
      if (sk.debuff) {
        this.addBuff(t, { kind: 'stat', stat: sk.debuff.stat, mul: sk.debuff.mul, t: sk.debuff.dur });
        this.addText(t, sk.debuff.label, '#80b0ff', 0.9, -0.4);
      }
      if (sk.burn) this.applyBurn(u, t, sk.burn);
      if (sk.stun) {
        this.addBuff(t, { kind: 'stun', t: sk.stun });
        this.addText(t, '混亂', '#e070ff', 0.9, -0.4);
      }
      if (hit.skill) this.addBurst(t, sk.color || '#ffffff', sk.fx);
      else if (hit.magic) this.addBurst(t, MAGIC_COLOR);
    }
  };

  // 輔助類魔法特技 (治療 / 鼓舞)；沒有合適對象時回傳 false，改用一般攻擊
  Battle.prototype.castSupport = function (u, sk) {
    var allies = this.alive(u.side);
    var self = this;
    if (sk.heal) {
      var best = null, low = 0.7;
      allies.forEach(function (a) {
        var r = a.hp / a.maxHp;
        if (r < low && cheb(a.x, a.y, u.x, u.y) <= S.SUPPORT_RANGE) { low = r; best = a; }
      });
      if (!best) return false;
      var amt = u.stat('int') * sk.heal * (u.skillMul || 1) * (0.85 + this.rng() * 0.3);
      amt = Math.max(1, Math.round(amt));
      best.hp = Math.min(best.maxHp, best.hp + amt);
      this.sound('heal', best);
      this.addText(best, '+' + amt, '#60ff90', 0.9);
      this.addBurst(best, sk.color);
    } else if (sk.buff) {
      var targets = allies.filter(function (a) {
        return cheb(a.x, a.y, u.x, u.y) <= sk.radius && !a.findBuff('stat', sk.buff.stat);
      });
      if (targets.length < 2) return false;
      targets.forEach(function (a) {
        self.addBuff(a, { kind: 'stat', stat: sk.buff.stat, mul: sk.buff.mul, t: sk.buff.dur });
        self.addBurst(a, sk.color);
      });
      this.addText(u, sk.buff.label, sk.color, 0.9, -0.4);
      this.sound('rally', u);
    } else {
      return false;
    }
    this.addText(u, sk.name, MAGIC_SKILL_COLOR, 1.0, -0.5);
    return true;
  };

  Battle.prototype.calcDamage = function (u, e, magic, mul, ignoreDef) {
    var strength = u.isGeneral ? 1 : 0.4 + 0.6 * u.hp / u.maxHp;   // 兵越少攻擊越弱
    var morale = this.generalAlive(u.side) ? 1 : S.MORALE_PENALTY;
    var base, guard, matchup;
    if (magic) {
      base = u.stat('int'); guard = e.stat('spr'); matchup = 1;
    } else {
      base = u.stat('atk'); guard = e.stat('def') * (1 - ignoreDef); matchup = S.matchup(u.type, e.type);
      // 背擊：從目標面向的反方向攻擊
      if (u.x != null && e.facing && u.x !== e.x && (u.x - e.x) * e.facing < 0) {
        mul *= S.BACKSTAB;
        if (u.side === 0 && this.rng() < 0.35) this.addText(e, '背擊!', '#ffb040', 0.7, -0.9);
      }
    }
    // 陣型：散開的士兵攻擊 -10%、方陣的士兵防禦 +20%
    if (this.stance) {
      if (!u.isGeneral && this.stance[u.side] === 'spread') mul *= S.STANCES.spread.atk;
      if (!e.isGeneral && this.stance[e.side] === 'tight') guard *= S.STANCES.tight.def;
    }
    var dmg = base * strength * matchup * (14 / (guard + 4)) * morale * mul * (0.85 + this.rng() * 0.3);
    if (!isFinite(dmg)) dmg = 1;
    return Math.max(1, Math.round(dmg));
  };

  Battle.prototype.applyDamage = function (e, dmg, color) {
    if (e.dead) return;
    if (e.invulnT > 0) return;    // 突進中無敵
    if (this.explore && !e.awake) this.wakeCamp(e.camp);   // 被打就醒來
    e.hp -= dmg;
    e.flashT = 0.12;
    this.addText(e, '-' + dmg, color || (e.side === 0 ? '#a8d8ff' : '#ffc8a8'), 0.8);
    if (e.hp <= 0) this.kill(e);
  };

  // 中綴特效：依機率讓目標燃燒 / 混亂 / 緩速
  Battle.prototype.applyProcs = function (u, t, procs) {
    if (procs.burn && this.rng() < procs.burn / 100) this.applyBurn(u, t, { ratio: 0.3, dur: 3 });
    if (procs.stun && !t.findBuff('stun') && this.rng() < procs.stun / 100) {
      this.addBuff(t, { kind: 'stun', t: 1 });
      this.addText(t, '雷霆', '#ffff80', 0.8, -0.4);
    }
    if (procs.slow && this.rng() < procs.slow / 100) {
      if (!t.findBuff('slow')) this.addText(t, '緩速', '#80d0ff', 0.8, -0.4);
      this.addBuff(t, { kind: 'slow', t: 2 });
    }
  };

  // 同類狀態只保留一個 (重新施放會刷新時間)
  Battle.prototype.addBuff = function (u, buff) {
    var old = u.findBuff(buff.kind, buff.stat);
    if (old) u.buffs.splice(u.buffs.indexOf(old), 1);
    u.buffs.push(buff);
  };

  // 燃燒 (受天候影響：大雨不燃燒、大風延長)
  Battle.prototype.applyBurn = function (u, t, burn) {
    var w = S.WEATHER[this.weather];
    if (w.noBurn) return;
    var dps = Math.max(1, Math.round(u.stat('int') * burn.ratio));
    this.addBuff(t, { kind: 'burn', dps: dps, t: burn.dur + (w.burnBonus || 0), tick: 1 });
  };

  Battle.prototype.updateBuffs = function (u, dt) {
    for (var i = u.buffs.length - 1; i >= 0 && !u.dead; i--) {
      var b = u.buffs[i];
      b.t -= dt;
      if (b.kind === 'burn') {
        b.tick -= dt;
        if (b.tick <= 0) { b.tick += 1; this.applyDamage(u, b.dps, '#ff9040'); }
      }
      if (b.t <= 0 && !u.dead) u.buffs.splice(i, 1);
    }
  };

  Battle.prototype.countSkill = function (sk) {
    this.skillUses[sk.name] = (this.skillUses[sk.name] || 0) + 1;
  };

  Battle.prototype.addBurst = function (u, color, fx) {
    this.effects.push({ fx: fx || 'burst', x: u.posX(), y: u.posY(), color: color, t: 0, dur: fx === 'bolt' ? 0.3 : 0.4 });
  };

  Battle.prototype.kill = function (e) {
    e.hp = 0;
    e.dead = true;
    e.deathT = 0.8;
    e.buffs = [];
    this.occ[this.idx(e.x, e.y)] = null;
    if (this.generalAlive(1 - e.side)) this.gainCommand(1 - e.side, S.COMMAND.PER_KILL);
    var army = this.armies[e.side];
    this.sound(e.isGeneral ? 'generalDeath' : 'death', e);
    if (e.isGeneral) {
      this.addText(e, army.name + ' 陣亡', '#ff5040', 1.6);
      this.log.push(this.time.toFixed(1) + 's ' + army.name + ' 陣亡');
    } else {
      this.log.push(this.time.toFixed(1) + 's ' + army.name + '軍 ' + e.name + ' 潰滅');
    }
    if (e.elite) this.eliteOnKill(e);
    if (e.wanderer) this.tryRecruit(e);
    else if (this.explore && e.side === 1 && e.camp > 0) this.checkCampCleared(e.camp, e);
    this.checkVictory();
  };

  Battle.prototype.checkVictory = function () {
    if (this.state !== 'fighting') return;
    if (this.explore) {           // 探索：我方主將陣亡就輸，打倒敵將就贏
      if (!this.generalAlive(0)) { this.state = 'over'; this.winner = 1; }
      else if (!this.generalAlive(1)) { this.state = 'over'; this.winner = 0; }
      return;
    }
    var a0 = this.alive(0).length, a1 = this.alive(1).length;
    if (a0 && a1) return;
    this.state = 'over';
    this.winner = a0 ? 0 : a1 ? 1 : -1;
  };

  Battle.prototype.timeUp = function () {
    var ratio = [0, 1].map(function (side) {
      var cur = 0, max = 0;
      this.units.forEach(function (u) { if (u.side === side) { cur += u.hp / u.maxHp; max += 1; } });
      return cur / max;
    }, this);
    this.state = 'over';
    this.timedOut = true;
    this.winner = ratio[0] === ratio[1] ? -1 : ratio[0] > ratio[1] ? 0 : 1;
  };

  // dy: 垂直偏移 (格)，讓特技名稱顯示在傷害數字上方
  Battle.prototype.addText = function (u, text, color, dur, dy) {
    this.effects.push({ fx: 'text', x: u.posX(), y: u.posY() + (dy || 0), text: text, color: color, t: 0, dur: dur });
  };

  // 面板數字：體 騎 弓 步
  Battle.prototype.stats = function (side) {
    var s = { hp: 0, cavalry: 0, archer: 0, spear: 0 };
    this.units.forEach(function (u) {
      if (u.side !== side || u.dead) return;
      if (u.isGeneral) s.hp = u.hp;
      else s[u.type] += u.hp;
    });
    Object.keys(s).forEach(function (k) { s[k] = Math.ceil(s[k]); });   // 探索模式的回復會產生小數
    return s;
  };

  S.Battle = Battle;
  S.Unit = Unit;
})(window.Sango);
