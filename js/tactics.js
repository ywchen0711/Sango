/*
 * 主將計策與隨機事件 (不依賴 DOM，可在 Node 中無畫面模擬)
 * 軍令 / 計策：玩家決定施放時機；電腦方由 aiTactics 判斷
 * 隨機事件：寶箱、天候變化、伏兵
 */
(function (S) {
  'use strict';

  var B = S.Battle.prototype;

  function cheb(ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); }
  function between(rng, r) { return r[0] + rng() * (r[1] - r[0]); }

  // 依 weight 權重抽一個 key
  function weighted(rng, table) {
    var keys = Object.keys(table), total = 0;
    keys.forEach(function (k) { total += table[k].weight; });
    var r = rng() * total;
    for (var i = 0; i < keys.length; i++) {
      r -= table[keys[i]].weight;
      if (r < 0) return keys[i];
    }
    return keys[keys.length - 1];
  }

  B.initEvents = function (opts) {
    this.control = (opts.control || [false, false]).slice();   // true = 玩家操控該方
    var armies = this.armies;   // 裝備可增加開戰軍令 (army.commandBonus)
    this.command = [0, 1].map(function (side) {
      return Math.min(S.COMMAND.MAX, S.COMMAND.START + (armies[side].commandBonus || 0));
    });
    this.tacticCd = [{}, {}];
    this.globalCd = [0, 0];
    this.chests = [];
    this.chestSeq = 0;
    this.chestT = between(this.rng, S.CHEST.FIRST);
    this.chestAiT = 0;
    this.weather = 'clear';
    this.weatherT = between(this.rng, S.WEATHER_CHANGE);
    this.ambushDone = false;
    this.aiT = [0.5 + this.rng(), 0.5 + this.rng()];   // 錯開雙方判斷時機，避免固定一方先施放
    this.notices = [];            // 畫面上方的事件通知 { text, color, t, dur }
    this.tacticUses = {};
    this.chestOpens = {};
    this.initSkills();            // 主將技能、集火、陣型、預警攻擊 (skills.js)
  };

  B.updateEvents = function (dt) {
    var C = S.COMMAND;
    this.updateSkills(dt);
    for (var side = 0; side < 2; side++) {
      if (this.generalAlive(side)) this.gainCommand(side, C.REGEN * dt);
      this.globalCd[side] -= dt;
      var cds = this.tacticCd[side];
      for (var k in cds) cds[k] -= dt;
      if (!this.isHuman(side) || this.autoTactics[side]) {   // 玩家方可開「自動計策」交給電腦判斷
        this.aiT[side] -= dt;
        if (this.aiT[side] <= 0) { this.aiT[side] = 0.6 + this.rng() * 0.8; this.aiTactics(side); }
      }
    }

    this.chestAiT -= dt;
    if (this.chestAiT <= 0) { this.chestAiT = 0.5; this.assignChests(); }

    this.weatherT -= dt;
    if (this.weatherT <= 0) { this.weatherT = between(this.rng, S.WEATHER_CHANGE); this.changeWeather(); }

    if (this.explore) { this.updateExplore(dt); return; }   // 探索：寶箱事先擺好、沒有伏兵

    this.chestT -= dt;
    if (this.chestT <= 0) { this.chestT = between(this.rng, S.CHEST.INTERVAL); this.spawnChest(); }

    if (!this.ambushDone && this.time >= S.AMBUSH.AFTER && this.rng() < S.AMBUSH.CHANCE * dt) this.ambush();
  };

  // 探索模式：視野、非戰鬥回復
  B.updateExplore = function (dt) {
    var E = S.EXPLORE, self = this;
    this.visionT = (this.visionT || 0) - dt;
    if (this.visionT <= 0) { this.visionT = 0.2; this.updateVision(); }
    this.regenT = (this.regenT || 0) - dt;
    if (this.regenT > 0) return;
    this.regenT = 0.5;
    // 熔岩：站在上面的單位每秒損失兵力
    this.units.forEach(function (u) {
      if (u.dead || !self.here(u) || u.isMoving()) return;
      var burn = self.terrainAt(u.x, u.y).burn;
      if (burn) self.applyDamage(u, Math.max(1, Math.round(u.maxHp * burn * 0.5)), '#ff8040');
    });
    this.alive(0).forEach(function (u) {
      var danger = self.unitsNear(1, u.x, u.y, E.REGEN_SAFE).some(function (e) { return e.awake && !e.passive; });
      if (danger || u.hp >= u.maxHp || self.terrainAt(u.x, u.y).burn) return;
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * E.REGEN * 0.5);
      u.mp = Math.min(u.maxMp, u.mp + u.maxMp * E.REGEN * 0.5);
    });
  };

  B.rollChestItem = function () { return weighted(this.rng, S.CHEST_ITEMS); };

  B.notify = function (text, color) {
    this.notices.push({ text: text, color: color || '#ffffff', t: 0, dur: 2.5 });
    this.log.push(this.time.toFixed(1) + 's ' + text);
  };

  B.gainCommand = function (side, v) {
    this.command[side] = Math.min(S.COMMAND.MAX, this.command[side] + v);
  };

  // ======================= 計策 =======================
  // 回傳無法施放的原因；可以施放時回傳空字串
  B.tacticBlocked = function (side, id) {
    var tc = S.TACTICS[id];
    if (this.state !== 'fighting') return S.t('戰鬥已結束');
    if (!this.generalAlive(side)) return S.t('主將已陣亡');
    var cd = this.tacticCd[side][id] || 0;
    if (cd > 0) return S.t('冷卻中 ') + Math.ceil(cd) + S.t(' 秒');
    if (this.command[side] < tc.cost) return S.t('軍令不足');
    if (this.globalCd[side] > 0) return S.t('剛下達過命令');
    return '';
  };

  // 範圍內的敵人；落雷 (radius 0) 自動吸附到點選位置周圍 1 格內最近的敵人
  B.tacticTargets = function (side, id, tx, ty) {
    var tc = S.TACTICS[id];
    var enemies = this.alive(1 - side);
    if (tc.radius > 0) {
      return enemies.filter(function (e) { return cheb(e.x, e.y, tx, ty) <= tc.radius; });
    }
    var best = null, bestD = 2;
    enemies.forEach(function (e) {
      var d = cheb(e.x, e.y, tx, ty);
      if (d < bestD) { bestD = d; best = e; }
    });
    return best ? [best] : [];
  };

  // 施放計策；需要指定位置的計策要傳入 (tx, ty)。成功回傳 true
  B.useTactic = function (side, id, tx, ty) {
    var tc = S.TACTICS[id];
    if (!tc || this.tacticBlocked(side, id)) return false;
    var g = this.generals[side];
    var army = this.armies[side];
    var self = this;

    if (tc.target) {
      var targets = this.tacticTargets(side, id, tx, ty);
      if (!targets.length) return false;
      if (tc.radius === 0) { tx = targets[0].x; ty = targets[0].y; }   // 落雷吸附到目標所在的格子
      // 敵方的計策先出現預警範圍才落下 (玩家可以躲)；玩家的計策立即生效
      if (side === 1) this.telegraphTactic(side, id, tx, ty);
      else this.applyTargetTactic(side, id, tx, ty);
    } else if (tc.healAll) {                      // 回春：全軍回復兵力、解除燃燒
      var hpct = tc.healAll.base + army[tc.healAll.from] / tc.healAll.scale;
      this.alive(side).forEach(function (a) {
        var amt = Math.round(a.maxHp * hpct);
        a.hp = Math.min(a.maxHp, a.hp + amt);
        a.buffs = a.buffs.filter(function (bf) { return bf.kind !== 'burn'; });
        self.addBurst(a, tc.color);
        self.addText(a, '+' + amt, tc.color, 0.9);
      });
    } else if (tc.buff) {
      var b = tc.buff;
      var mul = b.mul + army[b.from] / b.scale;
      this.alive(side).forEach(function (a) {
        self.addBuff(a, { kind: 'stat', stat: b.stat, mul: mul, t: b.dur });
        self.addBurst(a, tc.color);
        self.addText(a, b.label, tc.color, 0.9, -0.4);
      });
    }

    this.command[side] -= tc.cost;
    this.tacticCd[side][id] = tc.cd;
    this.globalCd[side] = S.COMMAND.GLOBAL_CD;
    this.tacticUses[tc.name] = (this.tacticUses[tc.name] || 0) + 1;
    this.sound(tc.target && side === 1 ? 'alert' : 'tac_' + id, tx != null ? { x: tx, y: ty } : g);
    this.addText(g, tc.name + '!', tc.color, 1.4, -0.6);
    this.notify(army.name + S.t(' 施展「') + tc.name + S.t('」'), tc.color);
    return true;
  };

  // 目標型計策的結算 (玩家立即、敵方在預警結束時)：範圍內的敵人受到魔法傷害與附加狀態
  B.applyTargetTactic = function (side, id, tx, ty) {
    var tc = S.TACTICS[id], army = this.armies[side], self = this;
    var targets = tc.radius > 0 ? this.tacticTargets(side, id, tx, ty) :
      this.alive(1 - side).filter(function (e) { return e.x === tx && e.y === ty; });
    var power = tc.power * (tc.element === 'fire' ? this.fireMul() : 1);
    var ti = S.TACTIC_INT.base + army.int * S.TACTIC_INT.ratio;
    var caster = { side: side, isGeneral: true, stat: function () { return ti; } };
    for (var dx = -tc.radius; dx <= tc.radius; dx++) {
      for (var dy = -tc.radius; dy <= tc.radius; dy++) {
        if (this.inBounds(tx + dx, ty + dy)) this.effects.push({ fx: 'burst', x: tx + dx, y: ty + dy, color: tc.color, t: 0, dur: 0.6 });
      }
    }
    if (tc.fx === 'bolt') this.effects.push({ fx: 'bolt', x: tx, y: ty, color: tc.color, t: 0, dur: 0.3 });
    targets.forEach(function (t) {
      if (t.invulnT > 0) return;
      var dmg = self.calcDamage(caster, t, true, power, 0) * (tc.radius > 0 ? self.aoeMul(t) : 1);
      if (tc.element === 'fire' && S.UNIT_TYPES[t.type].fireWeak) dmg *= S.UNIT_TYPES[t.type].fireWeak;   // 藤甲怕火
      self.applyDamage(t, Math.max(1, Math.round(dmg)), '#e0b0ff');
      if (t.dead) return;
      if (tc.burn) self.applyBurn(caster, t, tc.burn);
      if (tc.slow) {                              // 水計：緩速並澆熄燃燒
        self.addBuff(t, { kind: 'slow', t: tc.slow });
        t.buffs = t.buffs.filter(function (bf) { return bf.kind !== 'burn'; });
        self.addText(t, S.t('緩速'), '#a0e8ff', 0.9, -0.4);
      }
      if (tc.stun) {
        self.addBuff(t, { kind: 'stun', t: tc.stun });
        self.addText(t, S.t('混亂'), '#e070ff', 0.9, -0.4);
      }
      if (tc.fx) self.addBurst(t, tc.color, tc.fx);
    });
    if (side === 1) this.sound('tac_' + id, { x: tx, y: ty });
  };

  // 主將出陣 / 待機 (待機時退回布陣位置，只反擊射程內的敵人)
  B.orderGeneral = function (side, engage) {
    var g = this.generals[side];
    if (!g || g.dead || this.state !== 'fighting' || g.engaged === engage) return false;
    g.engaged = engage;
    g.held = !engage;             // 玩家下令待命：不會自行出陣
    g.target = null;
    g.order = null;
    this.addText(g, engage ? S.t('出陣!') : S.t('撤退!'), engage ? '#f8d838' : '#80c0ff', 1.0);
    return true;
  };

  // ---- WASD 直接操控主將：按住方向鍵一格一格走，放開後交還給主將自己判斷 (自動找最近的敵人) ----
  B.setWalk = function (side, dx, dy) {
    var g = this.generals[side];
    if (!g || g.dead || this.state !== 'fighting') return;
    if (dx || dy) {
      g.order = { kind: 'walk', dx: dx, dy: dy };
      g.engaged = true;
      g.held = false;
      g.target = null;
      if (!g.isMoving()) g.thinkCd = 0;
    } else if (g.order && g.order.kind === 'walk') {
      g.order = null;             // 沒有在操控：自動迎擊最近的敵人
      g.thinkCd = 0;
    }
  };

  // 朝 (dx, dy) 走一步；斜向被擋住時沿著牆滑動
  B.walkStep = function (u, dx, dy) {
    var tries = [[dx, dy]];
    if (dx && dy) tries.push([dx, 0], [0, dy]);
    for (var i = 0; i < tries.length; i++) {
      var tx = u.x + tries[i][0], ty = u.y + tries[i][1];
      if (this.canStep(u.x, u.y, tries[i][0], tries[i][1], u, false) ||
          (this.canSwap(u, tx, ty) && this.canStep(u.x, u.y, tries[i][0], tries[i][1], u, true))) {
        this.moveTo(u, tx, ty);
        return;
      }
    }
    if (dx) u.facing = dx;
    u.thinkCd = 0.05;
  };

  // ---- 手動操控主將 ----
  // order：{ kind: 'move', x, y } 走到指定格 (途中不停下交戰)
  //        { kind: 'attack', target } 追擊指定敵人
  //        { kind: 'hold' } 原地固守，只打射程內的敵人
  // 抵達目的地 / 目標被擊破後清除命令，主將自己去找最近的敵人 (探索模式只找附近的)
  B.commandGeneral = function (side, order) {
    var g = this.generals[side];
    if (!g || g.dead || this.state !== 'fighting') return false;
    if (order.kind === 'move' && (this.isWall(order.x, order.y) || (g.x === order.x && g.y === order.y))) return false;
    if (order.kind === 'attack' && (!order.target || order.target.dead || order.target.side === side)) return false;
    g.order = order;
    g.engaged = true;
    g.target = order.kind === 'attack' ? order.target : null;
    g.thinkCd = 0;
    return true;
  };

  B.followOrder = function (u, enemies) {
    var o = u.order;
    if (o.kind === 'walk') { this.walkStep(u, o.dx, o.dy); return; }
    // 探索模式：主將跑太前面就先等部隊 (射程內有敵人照常攻擊)
    if (this.explore && o.kind !== 'hold' && this.armyLagging(u)) {
      if (!this.tryAttack(u, enemies)) u.thinkCd = 0.2;
      return;
    }
    if (o.kind === 'attack') {
      var t = o.target;
      if (t.dead) { u.order = null; u.thinkCd = 0.1; return; }
      u.target = t;
      if (this.inRangeAt(u, u.x, u.y, t)) {
        if (t.x !== u.x) u.facing = t.x > u.x ? 1 : -1;
        if (u.atkCd <= 0) this.attack(u, t);
        u.thinkCd = 0.05;
        return;
      }
      var step = this.pathStep(u, t);
      if (step) this.moveTo(u, step.x, step.y);
      else u.thinkCd = 0.2;
      return;
    }
    if (o.kind === 'move') {
      var arrived = u.x === o.x && u.y === o.y ||
        (!this.isFree(o.x, o.y, u) && Math.max(Math.abs(u.x - o.x), Math.abs(u.y - o.y)) <= 1);   // 目的地被佔住，就停在旁邊
      if (arrived) {
        u.order = null;
        u.thinkCd = 0.05;
        return;
      } else {
        if (!this.stepToward(u, o)) u.thinkCd = 0.2;
        return;
      }
    }
    // 固守
    if (!this.tryAttack(u, enemies)) u.thinkCd = 0.2;
  };

  // ---- 電腦方 AI：依戰況決定施放計策 ----
  B.aiTactics = function (side) {
    if (!this.generalAlive(side) || this.globalCd[side] > 0) return;
    var self = this, rng = this.rng;
    var enemies = this.alive(1 - side), allies = this.alive(side);
    if (this.explore) {
      var g = this.generals[side];
      if (side === 1 && (!this.bossAwake || !this.here(g))) return;
      enemies = this.unitsNear(1 - side, g.x, g.y, 12).filter(function (e) { return e.awake; });
      allies = this.unitsNear(side, g.x, g.y, 12);
      if (!allies.length) return;
    }
    if (!enemies.length) return;
    var pts = this.command[side];
    function ready(id) { return !self.tacticBlocked(side, id) && rng() < 0.6; }
    function engaged(a) { return enemies.some(function (e) { return cheb(a.x, a.y, e.x, e.y) <= 1; }); }

    // 火計：找最密集的敵軍 (大雨時不用)
    if (this.weather !== 'rain' && ready('fire')) {
      var best = null, bestN = 0;
      enemies.forEach(function (c) {
        var n = self.tacticTargets(side, 'fire', c.x, c.y).length;
        if (n > bestN) { bestN = n; best = c; }
      });
      if (best && (bestN >= 3 || (bestN >= 2 && pts >= 8))) {
        if (this.useTactic(side, 'fire', best.x, best.y)) return;
      }
    }
    // 落雷：軍令有餘裕時打兵力最多的敵隊 (優先主將)
    if (pts >= S.TACTICS.thunder.cost + 2 && ready('thunder')) {
      var tgt = null, score = 0;
      enemies.forEach(function (e) {
        var s = e.hp * (e.isGeneral ? 1.5 : 1);
        if (s > score) { score = s; tgt = e; }
      });
      if (tgt && this.useTactic(side, 'thunder', tgt.x, tgt.y)) return;
    }
    // 鼓舞 / 堅守：多數部隊交戰中才使用
    var fighting = allies.filter(engaged).length;
    if (fighting >= 3 && ready('rally') && this.useTactic(side, 'rally')) return;
    var hpRatio = allies.reduce(function (s, a) { return s + a.hp / a.maxHp; }, 0) / allies.length;
    if (hpRatio < 0.5 && allies.length >= 3 && ready('cure') && this.useTactic(side, 'cure')) return;
    if (fighting >= 3 && hpRatio < 0.65 && ready('guard') && this.useTactic(side, 'guard')) return;
    // 水計：敵軍擠成一大團時
    if (pts >= S.TACTICS.flood.cost + 1 && ready('flood')) {
      var fb = null, fn = 0;
      enemies.forEach(function (c) {
        var n = self.tacticTargets(side, 'flood', c.x, c.y).length;
        if (n > fn) { fn = n; fb = c; }
      });
      if (fb && fn >= 4) this.useTactic(side, 'flood', fb.x, fb.y);
    }
  };

  // ======================= 寶箱 =======================
  B.chestAt = function (x, y) {
    for (var i = 0; i < this.chests.length; i++) {
      if (this.chests[i].x === x && this.chests[i].y === y) return this.chests[i];
    }
    return null;
  };

  // 在中央區域的空地放寶箱 (雙方距離相近，需要爭奪)
  B.spawnChest = function () {
    if (this.chests.length >= S.CHEST.MAX) return;
    var free = [];
    for (var x = 4; x < this.cols - 4; x++) {
      for (var y = 0; y < this.rows; y++) {
        if (this.isFree(x, y, null) && !this.chestAt(x, y)) free.push({ x: x, y: y });
      }
    }
    if (!free.length) return;
    var p = free[(this.rng() * free.length) | 0];
    var chest = { id: this.chestSeq++, x: p.x, y: p.y, item: weighted(this.rng, S.CHEST_ITEMS), open: true, born: this.time };
    this.chests.push(chest);
    this.notify(S.t('寶箱出現了！'), '#f8d838');
  };

  B.openChest = function (u, chest) {
    this.chests.splice(this.chests.indexOf(chest), 1);
    chest.open = false;
    this.units.forEach(function (o) { if (o.chestGoal === chest) { o.chestGoal = null; o.chestForced = false; } });
    var army = this.armies[u.side];
    var self = this;
    if (chest.loot) {               // 探索模式的裝備箱
      var item = chest.quality ? S.makeItem({ ilvl: this.explore.ilvl, mf: this.mf, quality: chest.quality }) : S.rollLoot(this.explore.ilvl, this.mf);
      var info = S.itemInfo(item), color = S.QUALITIES[info.q].color;
      if (u.side === 0) this.lootFound.push(item);
      this.addText(u, info.name, color, 1.6, -0.6);
      this.addBurst(u, color);
      this.notify(u.name + S.t(' 打開裝備箱：【') + S.QUALITIES[info.q].name + S.t('】') + info.name, color);
      this.sound('loot_' + info.q, u);
      return;
    }
    var it = S.CHEST_ITEMS[chest.item];
    this.chestOpens[it.name] = (this.chestOpens[it.name] || 0) + 1;
    this.addText(u, it.name, it.color, 1.4, -0.6);
    this.addBurst(u, it.color);
    this.notify(army.name + S.t('軍 ') + u.name + S.t(' 開啟寶箱：') + it.name + (chest.item === 'trap' ? S.t('！') : ''), it.color);
    this.sound(chest.item === 'trap' ? 'boom' : 'chest', u);

    if (it.heal) this.heal(u, u.maxHp * it.heal);
    if (it.healAll) this.alive(u.side).forEach(function (a) { self.heal(a, a.maxHp * it.healAll); });
    if (it.command) this.gainCommand(u.side, it.command);
    if (it.buff) this.addBuff(u, { kind: 'stat', stat: it.buff.stat, mul: it.buff.mul, t: it.buff.dur });
    if (it.damage) {
      this.addBurst(u, it.color, 'boom');
      this.applyDamage(u, Math.max(1, Math.round(u.maxHp * it.damage)), it.color);
      if (!u.dead && it.stun) this.addBuff(u, { kind: 'stun', t: it.stun });
    }
  };

  B.heal = function (u, amt) {
    amt = Math.max(1, Math.round(Math.min(amt, u.maxHp - u.hp)));
    if (u.hp >= u.maxHp) return;
    u.hp += amt;
    this.addText(u, '+' + amt, '#60ff90', 0.9);
  };

  // 可以去撿寶箱的部隊 (主將不會自行離開)，依實際路徑距離由近到遠
  B.chestSeekers = function (side, chest) {
    var field = this.distanceField(chest.x, chest.y, this.explore ? 24 : null);
    var self = this;
    return this.alive(side).filter(function (u) { return !u.isGeneral; })
      .map(function (u) { return { u: u, d: field[self.idx(u.x, u.y)] }; })
      .filter(function (c) { return c.d >= 0; })
      .sort(function (a, b) { return a.d - b.d; });
  };

  // 自動派兵：附近沒在交戰的士兵會去撿；電腦方會派較遠的士兵
  B.assignChests = function () {
    var self = this, g0 = this.generals[0];
    this.chests.forEach(function (chest) {
      if (self.explore && (!g0 || g0.dead || cheb(chest.x, chest.y, g0.x, g0.y) > 10)) return;
      for (var side = 0; side < (self.explore ? 1 : 2); side++) {
        var taken = self.units.some(function (u) { return !u.dead && u.side === side && u.chestGoal === chest; });
        if (taken) continue;
        var maxD = self.isHuman(side) ? S.CHEST.AUTO_DIST : S.CHEST.AI_DIST;
        var enemies = self.alive(1 - side);
        var list = self.chestSeekers(side, chest);
        for (var i = 0; i < list.length && list[i].d <= maxD; i++) {
          var u = list[i].u;
          if (u.chestGoal) continue;
          if (enemies.some(function (e) { return self.inRangeAt(u, u.x, u.y, e); })) continue;
          u.chestGoal = chest;
          u.chestForced = false;
          break;
        }
      }
    });
  };

  // 玩家點選寶箱：派最近的士兵優先去撿
  B.fetchChest = function (side, chest) {
    if (!chest || !chest.open || this.state !== 'fighting') return null;
    var list = this.chestSeekers(side, chest);
    if (!list.length) return null;
    this.units.forEach(function (o) {
      if (o.side === side && o.chestGoal === chest) { o.chestGoal = null; o.chestForced = false; }
    });
    var u = list[0].u;
    u.chestGoal = chest;
    u.chestForced = true;
    u.thinkCd = 0;
    this.addText(u, S.t('去撿!'), '#f8d838', 0.8, -0.5);
    return u;
  };

  // ======================= 天候 =======================
  B.changeWeather = function () {
    var next = weighted(this.rng, S.WEATHER);
    if (next === this.weather) return;
    this.weather = next;
    var w = S.WEATHER[next];
    this.notify(S.t('天候變化：') + w.name + (w.desc ? S.t('（') + w.desc + S.t('）') : ''), '#c0e0ff');
  };

  B.fireMul = function () { return S.WEATHER[this.weather].fireMul || 1; };

  B.rangeOf = function (u) {
    if (!u.ranged) return u.range;
    return Math.max(2, u.range - (S.WEATHER[this.weather].rangeMinus || 0));
  };

  // ======================= 伏兵 =======================
  // 從戰場上下兩側中央殺出一隊士兵，偏向剩餘戰力較少的一方
  B.ambush = function () {
    this.ambushDone = true;
    var power = [0, 1].map(function (side) {
      return this.alive(side).reduce(function (s, u) { return s + u.hp / u.maxHp; }, 0);
    }, this);
    var loser = power[0] < power[1] ? 0 : power[1] < power[0] ? 1 : (this.rng() * 2) | 0;
    var side = this.rng() < S.AMBUSH.LOSER_BIAS ? loser : 1 - loser;
    var free = [];
    for (var x = 4; x < this.cols - 4; x++) {
      [0, this.rows - 1].forEach(function (y) {
        if (this.isFree(x, y, null) && !this.chestAt(x, y)) free.push({ x: x, y: y });
      }, this);
    }
    if (!free.length) return;
    var p = free[(this.rng() * free.length) | 0];
    var type = S.UNIT_KINDS[(this.rng() * S.UNIT_KINDS.length) | 0];
    var u = this.addUnit(side, type, p.x, p.y, this.armies[side]);
    this.order.push(u.id);
    this.addText(u, S.t('伏兵!'), '#f8d838', 1.6, -0.6);
    this.addBurst(u, '#f8d838');
    this.notify(this.armies[side].name + S.t('軍 伏兵') + S.UNIT_TYPES[type].name + S.t('殺出！'), '#f8d838');
    this.sound('alert');
  };
})(window.Sango);
