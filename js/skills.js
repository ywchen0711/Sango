/*
 * 操作技巧與戰術 (不依賴 DOM，可在 Node 中模擬)
 *   主將技能：突進 (Shift，往滑鼠方向衝刺、無敵、撞暈第一個敵人)、旋風斬 (F，擊退周圍敵人)
 *   部隊指令：右鍵集火、陣型 (自由 / 方陣 / 散開)
 *   敵人的預警攻擊：敵方計策先出現紅色範圍才落下；敵將蓄力重擊 (可以躲，也可以用突進打斷)
 *   背擊：從敵人背後攻擊傷害提高
 */
(function (S) {
  'use strict';

  var B = S.Battle.prototype;
  function cheb(ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); }

  S.GENERAL_SKILLS_DEF = {
    dash:  { name: '突進',   key: 'Shift', cd: 6, range: 4, power: 1.6, stun: 1.0, invuln: 0.45,
             desc: '往滑鼠方向衝刺最多 4 格，途中無敵；撞到的第一個敵人受 1.6 倍傷害、被擊退並混亂 1 秒（可打斷敵將重擊）' },
    whirl: { name: '旋風斬', key: 'F', cd: 8, power: 1.3,
             desc: '對周圍一圈的敵人造成 1.3 倍傷害並全部擊退一格' }
  };
  S.TELEGRAPH = 1.2;              // 敵方計策的預警時間 (秒)
  S.SLAM = { cd: [7, 10], windup: 1.0, trigger: 2, radius: 1, power: 2.2, stun: 1.0 };   // 敵將重擊
  S.BACKSTAB = 1.3;               // 背擊傷害倍率
  S.STANCES = {
    free:   { name: '自由', key: 'C', desc: '士兵自行迎擊附近的敵人' },
    tight:  { name: '方陣', key: 'Z', desc: '士兵緊跟主將、防禦 +20%，只迎擊靠近主將的敵人', def: 1.2, engage: 4 },
    spread: { name: '散開', key: 'X', desc: '受到的範圍傷害減半，但攻擊 -10%', aoe: 0.5, atk: 0.9 }
  };
  S.STANCE_KEYS = ['free', 'tight', 'spread'];

  B.initSkills = function () {
    this.pendings = [];           // 預警中的攻擊 { kind, side, x, y, r, t, dur, ... }
    this.focus = [null, null];    // 集火目標
    this.focusT = [0, 0];
    this.stance = ['free', 'free'];
  };

  // ---- 每個模擬步 (由 tactics.js 的 updateEvents 呼叫) ----
  B.updateSkills = function (dt) {
    var self = this;
    for (var i = this.pendings.length - 1; i >= 0; i--) {
      var p = this.pendings[i];
      p.t += dt;
      if (p.t >= p.dur) { this.pendings.splice(i, 1); this.resolvePending(p); }
    }
    for (var side = 0; side < 2; side++) {
      var f = this.focus[side];
      if (f && (f.dead || (this.focusT[side] -= dt) <= 0)) this.focus[side] = null;
      var g = this.generals[side];
      if (g && g.skillCd) { g.skillCd.dash -= dt; g.skillCd.whirl -= dt; }
      if (g && g.invulnT > 0) g.invulnT -= dt;
    }
    this.units.forEach(function (u) { if (u.windup && (u.dead || u.findBuff('stun'))) self.cancelSlam(u); });
  };

  // ======================= 主將技能 =======================
  function cds(g) { if (!g.skillCd) g.skillCd = { dash: 0, whirl: 0 }; return g.skillCd; }
  B.skillCooldown = function (side, id) {
    var g = this.generals[side];
    return g ? Math.max(0, cds(g)[id]) : 0;
  };
  B.skillBlocked = function (side, id) {
    var g = this.generals[side];
    if (this.state !== 'fighting') return '戰鬥已結束';
    if (!g || g.dead) return '主將已陣亡';
    if (g.findBuff('stun')) return '混亂中';
    var cd = cds(g)[id];
    if (cd > 0) return '冷卻中 ' + Math.ceil(cd) + ' 秒';
    return '';
  };

  // 突進：往 (dx, dy) 方向 (任意實數) 衝刺；回傳無法施放的原因，成功回傳空字串
  B.generalDash = function (side, dx, dy) {
    var why = this.skillBlocked(side, 'dash');
    if (why) return why;
    var g = this.generals[side], def = S.GENERAL_SKILLS_DEF.dash;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.01) { dx = g.facing; dy = 0; len = 1; }
    dx /= len; dy /= len;
    var sx = g.x, sy = g.y, ex = g.x, ey = g.y, hit = null;
    for (var i = 1; i <= def.range; i++) {
      var nx = Math.round(sx + dx * i), ny = Math.round(sy + dy * i);
      if (nx === ex && ny === ey) continue;
      if (this.isWall(nx, ny) || !this.canStep(ex, ey, Math.sign(nx - ex), Math.sign(ny - ey), g, true)) break;
      var o = this.occ[this.idx(nx, ny)];
      if (o && o !== g) {
        if (o.side !== g.side) hit = o;
        break;                    // 撞到敵人 (攻擊) 或自己人 (停下)
      }
      ex = nx; ey = ny;
    }
    if (ex === g.x && ey === g.y && !hit) return '前方被擋住';
    cds(g).dash = def.cd;
    g.invulnT = def.invuln;
    if (ex !== g.x || ey !== g.y) {
      this.occ[this.idx(g.x, g.y)] = null;
      this.occ[this.idx(ex, ey)] = g;
      g.fromX = g.posX(); g.fromY = g.posY();
      g.x = ex; g.y = ey;
      g.moveT = 0;
      g.moveDur = 0.04 * Math.max(1, cheb(g.fromX, g.fromY, ex, ey));
      if (ex !== Math.round(g.fromX)) g.facing = Math.sign(ex - g.fromX);
      this.effects.push({ fx: 'trail', x: g.fromX, y: g.fromY, x2: ex, y2: ey, color: '#f8f0a0', t: 0, dur: 0.35 });
    }
    g.thinkCd = Math.max(g.thinkCd, g.moveDur + 0.05);
    if (g.order && g.order.kind !== 'walk') g.order = { kind: 'hold' };
    if (hit) {
      this.applyDamage(hit, this.calcDamage(g, hit, false, def.power, 0), '#fff080');
      if (!hit.dead) {
        this.addBuff(hit, { kind: 'stun', t: def.stun });
        this.addText(hit, '混亂', '#e070ff', 0.9, -0.4);
        this.knockback(hit, dx, dy);
      }
      this.addBurst(hit, '#fff080', 'boom');
    }
    this.addText(g, def.name + '!', '#fff080', 0.9, -0.6);
    this.sound(hit ? 'skillPhys' : 'arrow', g);
    return '';
  };

  // 旋風斬：周圍一圈的敵人受傷並擊退
  B.generalWhirl = function (side) {
    var why = this.skillBlocked(side, 'whirl');
    if (why) return why;
    var g = this.generals[side], def = S.GENERAL_SKILLS_DEF.whirl, self = this;
    cds(g).whirl = def.cd;
    var hits = this.alive(1 - side).filter(function (e) { return cheb(e.x, e.y, g.x, g.y) <= 1; });
    hits.forEach(function (e) {
      self.applyDamage(e, self.calcDamage(g, e, false, def.power, 0), '#fff080');
      if (!e.dead) self.knockback(e, e.x - g.x, e.y - g.y);
    });
    this.effects.push({ fx: 'ring', x: g.posX(), y: g.posY(), color: '#fff080', t: 0, dur: 0.4 });
    this.addText(g, def.name + '!', '#fff080', 0.9, -0.6);
    this.sound('skillPhys', g);
    return '';
  };

  // 擊退一格 (後方有空位才會退)
  B.knockback = function (e, dx, dy) {
    var sx = Math.sign(Math.round(dx)) || Math.sign(dx), sy = Math.sign(Math.round(dy)) || Math.sign(dy);
    var nx = e.x + sx, ny = e.y + sy;
    if (e.isMoving() || !this.canStep(e.x, e.y, sx, sy, e, false)) return;
    this.occ[this.idx(e.x, e.y)] = null;
    this.occ[this.idx(nx, ny)] = e;
    e.fromX = e.x; e.fromY = e.y;
    e.x = nx; e.y = ny;
    e.moveT = 0;
    e.moveDur = 0.15;
  };

  // ======================= 部隊指令 =======================
  B.setFocus = function (side, target) {
    if (!target || target.dead || target.side === side) return false;
    this.focus[side] = target;
    this.focusT[side] = 15;
    var self = this;
    this.alive(side).forEach(function (u) { if (!u.isGeneral) { u.target = target; u.retargetCd = 1.5; u.thinkCd = Math.min(u.thinkCd, self.rng() * 0.2); } });
    this.addText(target, '集火!', '#ff5040', 1.0, -0.6);
    return true;
  };
  B.setStance = function (side, key) {
    if (!S.STANCES[key]) return false;
    this.stance[side] = key;
    return true;
  };

  // 方陣：只考慮靠近主將的敵人；沒有就回到主將身邊。回傳 null 表示這次思考已處理完
  B.stanceFilter = function (u, enemies) {
    var g = this.generals[u.side];
    if (u.isGeneral || this.stance[u.side] !== 'tight' || !g || g.dead) return enemies;
    var R = S.STANCES.tight.engage;
    var near = enemies.filter(function (e) { return cheb(e.x, e.y, g.x, g.y) <= R; });
    if (near.length) return near;
    if (cheb(u.x, u.y, g.x, g.y) > 2) {
      var step = this.bfsStep(u, function (cx, cy) { return cheb(cx, cy, g.x, g.y) <= 2; }, g, 1500);
      if (step) { this.moveTo(u, step.x, step.y); return null; }
    }
    if (!this.tryAttack(u, enemies)) u.thinkCd = 0.2;
    return null;
  };

  // 範圍傷害倍率 (散開陣型的士兵減半)
  B.aoeMul = function (t) {
    return !t.isGeneral && this.stance && this.stance[t.side] === 'spread' ? S.STANCES.spread.aoe : 1;
  };

  // ======================= 預警攻擊 =======================
  // 敵方的目標型計策：先放預警範圍，S.TELEGRAPH 秒後才結算
  B.telegraphTactic = function (side, id, tx, ty) {
    var tc = S.TACTICS[id];
    this.pendings.push({ kind: 'tactic', side: side, id: id, x: tx, y: ty, r: tc.radius, t: 0, dur: S.TELEGRAPH, color: tc.color });
  };

  // 敵將重擊：附近有我軍就蓄力，地上出現紅框，蓄力結束時結算 (被混亂就中斷)
  B.slamThink = function (u, enemies) {
    if (u.windup) { u.thinkCd = 0.1; return true; }
    if (u.slamCd == null) u.slamCd = S.SLAM.cd[0] * this.rng();
    if (u.slamCd > 0) return false;
    var self = this, tgt = null;
    enemies.forEach(function (e) {
      if (!tgt && cheb(e.x, e.y, u.x, u.y) <= S.SLAM.trigger) tgt = e;
    });
    if (!tgt) return false;
    var p = { kind: 'slam', side: u.side, x: tgt.x, y: tgt.y, r: S.SLAM.radius, t: 0, dur: S.SLAM.windup, color: '#ff3020', src: u };
    u.windup = p;
    this.pendings.push(p);
    u.thinkCd = 0.1;
    if (tgt.x !== u.x) u.facing = Math.sign(tgt.x - u.x);
    this.addText(u, '蓄力!', '#ff4030', 1.0, -0.6);
    this.sound('alert', u);
    u.slamCd = S.SLAM.cd[0] + this.rng() * (S.SLAM.cd[1] - S.SLAM.cd[0]);
    return true;
  };
  B.cancelSlam = function (u) {
    var i = this.pendings.indexOf(u.windup);
    if (i >= 0) this.pendings.splice(i, 1);
    u.windup = null;
    if (!u.dead) { this.addText(u, '打斷!', '#80e0ff', 1.0, -0.9); this.sound('equip', u); }
  };

  B.resolvePending = function (p) {
    var self = this;
    if (p.kind === 'tactic') { this.applyTargetTactic(p.side, p.id, p.x, p.y); return; }
    if (p.kind === 'slam') {
      var u = p.src;
      u.windup = null;
      if (u.dead || u.findBuff('stun')) return;
      this.alive(1 - p.side).forEach(function (t) {
        if (cheb(t.x, t.y, p.x, p.y) > p.r || t.invulnT > 0) return;
        self.applyDamage(t, Math.round(self.calcDamage(u, t, false, S.SLAM.power, 0) * self.aoeMul(t)), '#ff6040');
        if (!t.dead) { self.addBuff(t, { kind: 'stun', t: S.SLAM.stun }); self.addText(t, '混亂', '#e070ff', 0.9, -0.4); }
      });
      for (var dx = -p.r; dx <= p.r; dx++) for (var dy = -p.r; dy <= p.r; dy++) {
        if (this.inBounds(p.x + dx, p.y + dy)) this.effects.push({ fx: 'burst', x: p.x + dx, y: p.y + dy, color: '#ff6040', t: 0, dur: 0.5 });
      }
      this.addText(u, '重擊!', '#ff4030', 1.2, -0.6);
      this.sound('boom', { x: p.x, y: p.y });
    }
  };
})(window.Sango);
