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
    var bonus = this.level * S.LEVEL.BONUS + (this.isGeneral ? 0 : army.troopBonus || 0);
    if (bonus) {
      var mul = 1 + bonus;
      var self = this;
      ['maxHp', 'maxMp', 'atk', 'def', 'int', 'spr'].forEach(function (k) { self[k] = Math.round(self[k] * mul); });
    }
    this.hp = this.maxHp;
    this.mp = this.maxMp;
    var nSkills = this.isGeneral ? S.GENERAL_SKILLS : 1;
    this.physSkills = preset ? preset.physSkills.slice() : S.pickDistinct(S.PHYSICAL_SKILLS, nSkills, rng);
    this.magicSkills = preset ? preset.magicSkills.slice() : S.pickDistinct(S.MAGIC_SKILLS, nSkills, rng);
    this.buffs = [];   // { kind: 'stat'|'burn'|'stun', t: 剩餘秒數, ... }
    this.range = st.range;
    this.ranged = !!st.ranged;
    this.moveTime = st.moveTime / (this.isGeneral ? 1 + (army.speedBonus || 0) : 1);   // 裝備：主將移動速度
    this.attackTime = st.attackTime;
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
    this.initEvents(opts);
    this.walls = new Array(S.COLS * S.ROWS);
    this.occ = new Array(S.COLS * S.ROWS);
    for (var y = 0; y < S.ROWS; y++) {
      for (var x = 0; x < S.COLS; x++) {
        this.walls[this.idx(x, y)] = S.MAP[y][x] === '#';
        this.occ[this.idx(x, y)] = null;
      }
    }
    this.deploy(0);
    this.deploy(1);
    this.order = this.units.map(function (u, i) { return i; });
  }

  // 是否由玩家操控 (主將不會自行出陣，計策由玩家施放)
  Battle.prototype.isHuman = function (side) { return !!this.control[side]; };

  Battle.prototype.idx = function (x, y) { return y * S.COLS + x; };
  Battle.prototype.inBounds = function (x, y) { return x >= 0 && y >= 0 && x < S.COLS && y < S.ROWS; };
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
        var x = side === 0 ? slots[i][0] : S.COLS - 1 - slots[i][0];
        var y = slots[i][1];
        if (self.isFree(x, y, null)) return self.addUnit(side, type, x, y, army, preset);
      }
      // 陣型格用完：找己方半場任一空格
      for (var cx = 0; cx < S.COLS / 2; cx++) {
        for (var cy = 0; cy < S.ROWS; cy++) {
          var px = side === 0 ? cx : S.COLS - 1 - cx;
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
      if (this.time >= S.TIME_LIMIT) this.timeUp();
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

    // 玩家手動下令的主將 (移動 / 攻擊 / 固守，見 tactics.js)
    if (u.order) { this.followOrder(u, enemies); return; }

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
      if (s > bestScore) { bestScore = s; best = e; }
    }
    return best;
  };

  // 全域選目標：實際路徑距離 / 相剋偏好，並避免全部擠同一個目標
  Battle.prototype.chooseTarget = function (u, enemies) {
    var field = this.distanceField(u.x, u.y);
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

  // 只考慮城牆的 BFS 距離場
  Battle.prototype.distanceField = function (sx, sy) {
    var field = new Array(S.COLS * S.ROWS).fill(-1);
    var q = [this.idx(sx, sy)];
    field[q[0]] = 0;
    for (var h = 0; h < q.length; h++) {
      var c = q[h], cx = c % S.COLS, cy = (c / S.COLS) | 0;
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
    return this.bfsStep(u, function (cx, cy) { return self.inRangeAt(u, cx, cy, target); }, target);
  };

  // BFS 找到第一個符合 goal(x, y) 的格子，回傳第一步；走不到就朝 fallback 貪婪靠近
  Battle.prototype.bfsStep = function (u, goal, fallback) {
    var N = S.COLS * S.ROWS;
    var prev = new Array(N).fill(-2);
    var start = this.idx(u.x, u.y);
    prev[start] = -1;
    var q = [start];
    for (var h = 0; h < q.length; h++) {
      var c = q[h], cx = c % S.COLS, cy = (c / S.COLS) | 0;
      if (c !== start && goal(cx, cy)) {
        while (prev[c] !== start) c = prev[c];
        return { x: c % S.COLS, y: (c / S.COLS) | 0 };
      }
      var order = this.shuffledDirs();
      for (var d = 0; d < 8; d++) {
        var dx = order[d][0], dy = order[d][1];
        if (!this.canStep(cx, cy, dx, dy, u, false)) continue;
        var n = this.idx(cx + dx, cy + dy);
        if (prev[n] !== -2) continue;
        prev[n] = c;
        q.push(n);
      }
    }
    return this.greedyStep(u, fallback);
  };

  // 路被擋住：沿著 (忽略單位的) 距離場往目標靠近一步
  Battle.prototype.greedyStep = function (u, target) {
    var field = this.distanceField(target.x, target.y);
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
    this.occ[this.idx(u.x, u.y)] = null;
    this.occ[this.idx(nx, ny)] = u;
    var diag = nx !== u.x && ny !== u.y;
    u.fromX = u.x; u.fromY = u.y;
    if (nx !== u.x) u.facing = sign(nx - u.x);
    u.x = nx; u.y = ny;
    u.moveT = 0;
    u.moveDur = u.moveTime * (diag ? 1.3 : 1);
    u.charged = u.type === 'cavalry';
    u.thinkCd = 0;
  };

  // ======================= 戰鬥 =======================
  var PHYS_SKILL_COLOR = '#ffe060';
  var MAGIC_SKILL_COLOR = '#80e0ff';
  var MAGIC_COLOR = '#c080ff';

  Battle.prototype.attack = function (u, e) {
    u.atkCd = u.attackTime * (0.9 + this.rng() * 0.2);

    // 隨機決定物理或魔法，再判定是否發動特技
    var magic = this.rng() < u.int / (u.atk + u.int);
    var pool = magic ? u.magicSkills : u.physSkills;
    var sk = S.SKILLS[pool[(this.rng() * pool.length) | 0]];
    var skill = null;
    if (u.mp >= sk.mp && this.rng() < S.SKILL_CHANCE) {
      if (sk.support) {
        if (this.castSupport(u, sk)) { u.mp -= sk.mp; this.countSkill(sk); u.charged = false; return; }
      } else {
        skill = sk;
        u.mp -= sk.mp;
        this.countSkill(sk);
        this.addText(u, sk.name, magic ? MAGIC_SKILL_COLOR : PHYS_SKILL_COLOR, 1.0, -0.5);
      }
    }

    var hit = { magic: magic, skill: skill, mul: 1 };
    var adjacent = cheb(u.x, u.y, e.x, e.y) <= 1;
    if (!magic && u.ranged && adjacent) hit.mul *= S.UNIT_TYPES[u.type].meleePenalty;
    if (!magic && u.charged) hit.mul *= S.UNIT_TYPES.cavalry.chargeBonus;
    u.charged = false;

    if (magic || (u.ranged && !adjacent)) {
      var dist = euclid(u.x, u.y, e.x, e.y);
      this.projectiles.push({
        sx: u.x, sy: u.y, tx: e.x, ty: e.y, t: 0, dur: 0.1 + dist * (magic ? 0.1 : 0.07),
        kind: magic ? 'orb' : 'arrow', color: skill && skill.color || MAGIC_COLOR,
        src: u, target: e, hit: hit, side: u.side
      });
    } else {
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
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      for (var h = 0; h < (sk.hits || 1) && !t.dead; h++) {
        this.applyDamage(t, this.calcDamage(u, t, hit.magic, power, sk.ignoreDef || 0), hit.magic ? '#e0b0ff' : null);
      }
      if (t.dead) continue;
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
      var amt = u.stat('int') * sk.heal * (0.85 + this.rng() * 0.3);
      amt = Math.max(1, Math.round(amt));
      best.hp = Math.min(best.maxHp, best.hp + amt);
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
    }
    var dmg = base * strength * matchup * (14 / (guard + 4)) * morale * mul * (0.85 + this.rng() * 0.3);
    return Math.max(1, Math.round(dmg));
  };

  Battle.prototype.applyDamage = function (e, dmg, color) {
    if (e.dead) return;
    e.hp -= dmg;
    e.flashT = 0.12;
    this.addText(e, '-' + dmg, color || (e.side === 0 ? '#a8d8ff' : '#ffc8a8'), 0.8);
    if (e.hp <= 0) this.kill(e);
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
    if (e.isGeneral) {
      this.addText(e, army.name + ' 陣亡', '#ff5040', 1.6);
      this.log.push(this.time.toFixed(1) + 's ' + army.name + ' 陣亡');
    } else {
      this.log.push(this.time.toFixed(1) + 's ' + army.name + '軍 ' + e.name + ' 潰滅');
    }
    this.checkVictory();
  };

  Battle.prototype.checkVictory = function () {
    if (this.state !== 'fighting') return;
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
    return s;
  };

  S.Battle = Battle;
  S.Unit = Unit;
})(window.Sango);
