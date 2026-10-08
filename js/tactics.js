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
  };

  B.updateEvents = function (dt) {
    var C = S.COMMAND;
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

    this.chestT -= dt;
    if (this.chestT <= 0) { this.chestT = between(this.rng, S.CHEST.INTERVAL); this.spawnChest(); }
    this.chestAiT -= dt;
    if (this.chestAiT <= 0) { this.chestAiT = 0.5; this.assignChests(); }

    this.weatherT -= dt;
    if (this.weatherT <= 0) { this.weatherT = between(this.rng, S.WEATHER_CHANGE); this.changeWeather(); }

    if (!this.ambushDone && this.time >= S.AMBUSH.AFTER && this.rng() < S.AMBUSH.CHANCE * dt) this.ambush();
  };

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
    if (this.state !== 'fighting') return '戰鬥已結束';
    if (!this.generalAlive(side)) return '主將已陣亡';
    var cd = this.tacticCd[side][id] || 0;
    if (cd > 0) return '冷卻中 ' + Math.ceil(cd) + ' 秒';
    if (this.command[side] < tc.cost) return '軍令不足';
    if (this.globalCd[side] > 0) return '剛下達過命令';
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
      var power = tc.power * (tc.element === 'fire' ? this.fireMul() : 1);
      var ti = S.TACTIC_INT.base + army.int * S.TACTIC_INT.ratio;
      var caster = { side: side, isGeneral: true, stat: function () { return ti; } };
      if (tc.radius > 0) {
        for (var dx = -tc.radius; dx <= tc.radius; dx++) {
          for (var dy = -tc.radius; dy <= tc.radius; dy++) {
            if (this.inBounds(tx + dx, ty + dy)) {
              this.effects.push({ fx: 'burst', x: tx + dx, y: ty + dy, color: tc.color, t: 0, dur: 0.6 });
            }
          }
        }
      }
      targets.forEach(function (t) {
        self.applyDamage(t, self.calcDamage(caster, t, true, power, 0), '#e0b0ff');
        if (t.dead) return;
        if (tc.burn) self.applyBurn(caster, t, tc.burn);
        if (tc.stun) {
          self.addBuff(t, { kind: 'stun', t: tc.stun });
          self.addText(t, '混亂', '#e070ff', 0.9, -0.4);
        }
        if (tc.fx) self.addBurst(t, tc.color, tc.fx);
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
    this.addText(g, tc.name + '!', tc.color, 1.4, -0.6);
    this.notify(army.name + ' 施展「' + tc.name + '」', tc.color);
    return true;
  };

  // 主將出陣 / 待機 (待機時退回布陣位置，只反擊射程內的敵人)
  B.orderGeneral = function (side, engage) {
    var g = this.generals[side];
    if (!g || g.dead || this.state !== 'fighting' || g.engaged === engage) return false;
    g.engaged = engage;
    g.held = !engage;             // 玩家下令待命：不會自行出陣
    g.target = null;
    g.order = null;
    this.addText(g, engage ? '出陣!' : '撤退!', engage ? '#f8d838' : '#80c0ff', 1.0);
    return true;
  };

  // ---- 手動操控主將 ----
  // order：{ kind: 'move', x, y } 走到指定格 (途中不停下交戰)
  //        { kind: 'attack', target } 追擊指定敵人
  //        { kind: 'hold' } 原地固守，只打射程內的敵人 (抵達目的地 / 目標被擊破後自動轉為固守)
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
    if (o.kind === 'attack') {
      var t = o.target;
      if (t.dead) { u.order = { kind: 'hold' }; u.thinkCd = 0.1; return; }
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
      if (u.x === o.x && u.y === o.y) { u.order = { kind: 'hold' }; }
      else if (!this.isFree(o.x, o.y, u) && Math.max(Math.abs(u.x - o.x), Math.abs(u.y - o.y)) <= 1) {
        u.order = { kind: 'hold' };   // 目的地被佔住，就停在旁邊
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
    if (fighting >= 3 && hpRatio < 0.65 && ready('guard')) this.useTactic(side, 'guard');
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
    for (var x = 4; x < S.COLS - 4; x++) {
      for (var y = 0; y < S.ROWS; y++) {
        if (this.isFree(x, y, null) && !this.chestAt(x, y)) free.push({ x: x, y: y });
      }
    }
    if (!free.length) return;
    var p = free[(this.rng() * free.length) | 0];
    var chest = { id: this.chestSeq++, x: p.x, y: p.y, item: weighted(this.rng, S.CHEST_ITEMS), open: true, born: this.time };
    this.chests.push(chest);
    this.notify('寶箱出現了！', '#f8d838');
  };

  B.openChest = function (u, chest) {
    this.chests.splice(this.chests.indexOf(chest), 1);
    chest.open = false;
    this.units.forEach(function (o) { if (o.chestGoal === chest) { o.chestGoal = null; o.chestForced = false; } });
    var it = S.CHEST_ITEMS[chest.item];
    var army = this.armies[u.side];
    var self = this;
    this.chestOpens[it.name] = (this.chestOpens[it.name] || 0) + 1;
    this.addText(u, it.name, it.color, 1.4, -0.6);
    this.addBurst(u, it.color);
    this.notify(army.name + '軍 ' + u.name + ' 開啟寶箱：' + it.name + (chest.item === 'trap' ? '！' : ''), it.color);

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
    var field = this.distanceField(chest.x, chest.y);
    var self = this;
    return this.alive(side).filter(function (u) { return !u.isGeneral; })
      .map(function (u) { return { u: u, d: field[self.idx(u.x, u.y)] }; })
      .filter(function (c) { return c.d >= 0; })
      .sort(function (a, b) { return a.d - b.d; });
  };

  // 自動派兵：附近沒在交戰的士兵會去撿；電腦方會派較遠的士兵
  B.assignChests = function () {
    var self = this;
    this.chests.forEach(function (chest) {
      for (var side = 0; side < 2; side++) {
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
    this.addText(u, '去撿!', '#f8d838', 0.8, -0.5);
    return u;
  };

  // ======================= 天候 =======================
  B.changeWeather = function () {
    var next = weighted(this.rng, S.WEATHER);
    if (next === this.weather) return;
    this.weather = next;
    var w = S.WEATHER[next];
    this.notify('天候變化：' + w.name + (w.desc ? '（' + w.desc + '）' : ''), '#c0e0ff');
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
    for (var x = 4; x < S.COLS - 4; x++) {
      [0, S.ROWS - 1].forEach(function (y) {
        if (this.isFree(x, y, null) && !this.chestAt(x, y)) free.push({ x: x, y: y });
      }, this);
    }
    if (!free.length) return;
    var p = free[(this.rng() * free.length) | 0];
    var type = S.UNIT_KINDS[(this.rng() * S.UNIT_KINDS.length) | 0];
    var u = this.addUnit(side, type, p.x, p.y, this.armies[side]);
    this.order.push(u.id);
    this.addText(u, '伏兵!', '#f8d838', 1.6, -0.6);
    this.addBurst(u, '#f8d838');
    this.notify(this.armies[side].name + '軍 伏兵' + S.UNIT_TYPES[type].name + '殺出！', '#f8d838');
  };
})(window.Sango);
