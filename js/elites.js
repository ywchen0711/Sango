/*
 * 精英敵人與神壇 (仿暗黑破壞神 2；不依賴 DOM，可在 Node 中模擬)
 *   精英：生命 2 倍，帶 1–2 個詞綴，被打倒必定掉落魔法以上的裝備
 *   神壇：探索地圖上的一次性增益，我軍走上去就會啟動
 */
(function (S) {
  'use strict';

  var B = S.Battle.prototype;
  function cheb(ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); }

  S.ELITE_HP = 2;
  S.ELITE_AFFIXES = {
    berserk:  { name: '狂暴', desc: '攻擊 ×1.5' },
    swift:    { name: '疾風', desc: '移動與攻擊加快' },
    stone:    { name: '石膚', desc: '防禦 ×1.8' },
    vampire:  { name: '吸血', desc: '造成傷害的 25% 回復自己' },
    fire:     { name: '火焰', desc: '死亡時爆炸，燒傷周圍敵人' },
    summoner: { name: '召喚', desc: '第一次遇敵時叫出兩隊援兵' }
  };
  S.ELITE_KEYS = Object.keys(S.ELITE_AFFIXES);

  // 隨機 1–2 個不重複的精英詞綴
  S.rollEliteAffixes = function (rng) {
    rng = rng || S.random;
    var n = rng() < 0.6 ? 1 : 2;
    return S.pickDistinct(S.ELITE_KEYS, n, rng);
  };

  // 把單位變成精英
  B.makeElite = function (u, ids) {
    u.elite = ids.slice();
    u.maxHp = u.hp = Math.round(u.maxHp * S.ELITE_HP);
    ids.forEach(function (id) {
      if (id === 'berserk') { u.atk = Math.round(u.atk * 1.5); u.int = Math.round(u.int * 1.3); }
      if (id === 'swift') { u.moveTime *= 0.6; u.attackTime *= 0.75; }
      if (id === 'stone') { u.def = Math.round(u.def * 1.8); u.spr = Math.round(u.spr * 1.5); }
    });
    u.name = ids.map(function (id) { return S.ELITE_AFFIXES[id].name; }).join('・') + '的' + u.name;
  };
  B.hasElite = function (u, id) { return !!u.elite && u.elite.indexOf(id) >= 0; };

  // 一般出征：敵方士兵依機率成為精英
  B.rollElites = function (chance) {
    var self = this;
    this.units.forEach(function (u) {
      if (u.side === 1 && !u.isGeneral && self.rng() < chance) self.makeElite(u, S.rollEliteAffixes(self.rng));
    });
  };

  // 精英被打倒：火焰強化爆炸；必定掉落魔法以上的裝備
  B.eliteOnKill = function (e) {
    var self = this;
    if (this.hasElite(e, 'fire')) {
      this.addBurst(e, '#ff6020', 'boom');
      this.addText(e, '爆炸!', '#ff6020', 1.2, -0.6);
      this.alive(1 - e.side).forEach(function (o) {
        if (cheb(o.x, o.y, e.x, e.y) > 1) return;
        self.applyDamage(o, Math.max(1, Math.round(o.maxHp * 0.15)), '#ff8040');
        if (!o.dead) self.applyBurn(e, o, { ratio: 0.5, dur: 4 });
      });
    }
    if (e.side !== 1 || !this.lootFound) return;
    var item = S.makeItem({ ilvl: this.ilvl, quality: this.rng() < 0.75 ? 'magic' : 'rare' });
    var info = S.itemInfo(item), color = S.QUALITIES[info.q].color;
    this.lootFound.push(item);
    this.addText(e, info.name, color, 1.6, -1.1);
    this.notify('擊倒精英 ' + e.name + '！獲得【' + S.QUALITIES[info.q].name + '】' + info.name, color);
  };

  // 吸血：造成傷害後回復
  B.eliteOnHit = function (u, dmg) {
    if (!this.hasElite(u, 'vampire') || u.dead) return;
    u.hp = Math.min(u.maxHp, u.hp + dmg * 0.25);
  };

  // 召喚：第一次有敵人靠近時，在身邊叫出兩隊同兵種的援兵
  B.eliteThink = function (u, enemies) {
    if (!this.hasElite(u, 'summoner') || u.summoned) return;
    if (!enemies.some(function (e) { return cheb(e.x, e.y, u.x, u.y) <= 6; })) return;
    u.summoned = true;
    var n = 0;
    for (var r = 1; r <= 3 && n < 2; r++) {
      for (var y = u.y - r; y <= u.y + r && n < 2; y++) {
        for (var x = u.x - r; x <= u.x + r && n < 2; x++) {
          if (cheb(x, y, u.x, u.y) !== r || !this.isFree(x, y, null) || this.chestAt(x, y)) continue;
          var m = this.addUnit(u.side, u.type, x, y, this.armies[u.side]);
          m.camp = u.camp;
          m.awake = true;
          m.engaged = true;
          this.order.push(m.id);
          if (this.campLeft && u.camp != null) this.campLeft[u.camp]++;
          this.addBurst(m, '#c080ff');
          n++;
        }
      }
    }
    if (n) {
      this.addText(u, '召喚!', '#c080ff', 1.2, -0.6);
      this.notify(u.name + ' 叫出了援兵！', '#c080ff');
    }
  };

  // ======================= 神壇 (探索模式) =======================
  S.SHRINES = {
    war:     { name: '戰神壇', color: '#ff6040', desc: '全軍攻擊 +30%，60 秒' },
    guard:   { name: '守護壇', color: '#60a0ff', desc: '全軍防禦 +40%，60 秒' },
    heal:    { name: '回春壇', color: '#60ff90', desc: '全軍兵力全滿，一隊陣亡士兵歸隊' },
    exp:     { name: '經驗壇', color: '#80e0ff', desc: '這場戰鬥的經驗值 +50%' },
    fortune: { name: '財寶壇', color: '#f8d838', desc: '立刻獲得一件稀有裝備' },
    command: { name: '軍令壇', color: '#e070ff', desc: '軍令全滿，計策冷卻歸零' }
  };
  S.SHRINE_KEYS = Object.keys(S.SHRINES);

  B.shrineAt = function (x, y) {
    var list = this.shrines || [];
    for (var i = 0; i < list.length; i++) if (list[i].x === x && list[i].y === y) return list[i];
    return null;
  };

  B.touchShrine = function (u, sh) {
    if (sh.used || u.side !== 0) return;
    sh.used = true;
    var def = S.SHRINES[sh.type], self = this, mine = this.alive(0);
    if (sh.type === 'war') mine.forEach(function (a) { self.addBuff(a, { kind: 'stat', stat: 'atk', mul: 1.3, t: 60 }); });
    if (sh.type === 'guard') mine.forEach(function (a) { self.addBuff(a, { kind: 'stat', stat: 'def', mul: 1.4, t: 60 }); });
    if (sh.type === 'heal') { mine.forEach(function (a) { a.hp = a.maxHp; }); this.reinforce(); }
    if (sh.type === 'exp') this.expBonus = (this.expBonus || 0) + 0.5;
    if (sh.type === 'fortune') this.lootFound.push(S.makeItem({ ilvl: this.ilvl, quality: 'rare' }));
    if (sh.type === 'command') { this.command[0] = S.COMMAND.MAX; this.tacticCd[0] = {}; this.globalCd[0] = 0; }
    mine.forEach(function (a) { if (cheb(a.x, a.y, u.x, u.y) <= 6) self.addBurst(a, def.color); });
    this.addText(u, def.name, def.color, 1.8, -0.6);
    this.notify('啟動' + def.name + '：' + def.desc, def.color);
  };
})(window.Sango);
