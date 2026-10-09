/*
 * 裝備系統 (仿暗黑破壞神 2)：五種品質 × 基底 × 隨機詞綴，加上暗金與套裝
 *
 * 裝備物件 (存在進度裡)：
 *   普通 / 魔法 / 稀有：{ q: 'normal' | 'magic' | 'rare', base, ilvl, affixes: [{ k, pre, t, v }], rname }
 *   暗金：{ q: 'unique', id }      套裝：{ q: 'set', id }
 * 能力欄位：hp / war / int / lead 加到主將能力；command 開戰軍令；troops 全軍士兵能力 %；speed 主將移動速度 %
 */
(function (S) {
  'use strict';

  // ---- 品質 ----
  S.QUALITIES = {
    normal: { name: '普通', color: '#e8e8e8', mult: 1 },
    magic:  { name: '魔法', color: '#7c9cff', mult: 1.2 },
    rare:   { name: '稀有', color: '#f8e050', mult: 1.5 },
    set:    { name: '套裝', color: '#40d040', mult: 2 },
    unique: { name: '暗金', color: '#d8a860', mult: 2 }
  };
  S.QUALITY_KEYS = ['normal', 'magic', 'rare', 'set', 'unique'];

  // ---- 基底：每個欄位五種，ilvl 為最低物品等級，其餘為基本屬性 ----
  S.ITEM_BASES = {
    sword:   { name: '鐵劍',   slot: 'weapon',   ilvl: 1, war: 2 },
    spear:   { name: '長槍',   slot: 'weapon',   ilvl: 3, war: 4 },
    blade:   { name: '大刀',   slot: 'weapon',   ilvl: 5, war: 6 },
    ji:      { name: '鐵戟',   slot: 'weapon',   ilvl: 7, war: 8 },
    bawang:  { name: '霸王槍', slot: 'weapon',   ilvl: 9, war: 10 },
    longdan: { name: '龍膽槍', slot: 'weapon',   ilvl: 12, war: 13 },
    shenbing:{ name: '神兵戟', slot: 'weapon',   ilvl: 22, war: 17 },
    cloth:   { name: '布衣',   slot: 'armor',    ilvl: 1, hp: 3 },
    leather: { name: '皮甲',   slot: 'armor',    ilvl: 3, hp: 6 },
    chain:   { name: '鎖子甲', slot: 'armor',    ilvl: 5, hp: 8, lead: 1 },
    iron:    { name: '鐵甲',   slot: 'armor',    ilvl: 7, hp: 11, lead: 2 },
    shanwen: { name: '山文甲', slot: 'armor',    ilvl: 9, hp: 14, lead: 3 },
    yulin:   { name: '魚鱗甲', slot: 'armor',    ilvl: 12, hp: 18, lead: 4 },
    longlin: { name: '龍鱗鎧', slot: 'armor',    ilvl: 22, hp: 24, lead: 6 },
    charm:   { name: '護身符', slot: 'treasure', ilvl: 1, int: 2 },
    book:    { name: '兵書',   slot: 'treasure', ilvl: 3, int: 3, lead: 1 },
    jade:    { name: '玉珮',   slot: 'treasure', ilvl: 5, int: 4, lead: 2 },
    tally:   { name: '虎符',   slot: 'treasure', ilvl: 7, int: 4, lead: 3 },
    seal:    { name: '金印',   slot: 'treasure', ilvl: 9, int: 5, lead: 4 },
    jade2:   { name: '和氏璧', slot: 'treasure', ilvl: 12, int: 7, lead: 5 },
    xiseal:  { name: '傳國玉璽', slot: 'treasure', ilvl: 22, int: 9, lead: 7 }
  };

  // ---- 詞綴：前綴 (形容詞) / 後綴 (名詞)，各三個層級 ----
  // tiers：[名稱, 最低物品等級, 最小值, 最大值]；troops / speed 的數值單位是 %
  // slots：只會出現在哪些欄位 (省略 = 全部)
  S.AFFIXES = {
    prefix: {
      war:   { tiers: [['鋒利的', 1, 1, 3], ['銳利的', 4, 4, 6], ['無雙的', 7, 7, 9], ['萬夫莫敵的', 12, 10, 13], ['天下無雙的', 22, 14, 18]] },
      hp:    { tiers: [['結實的', 1, 2, 4], ['堅固的', 4, 5, 8], ['不壞的', 7, 9, 12], ['金剛的', 12, 13, 17], ['不朽的', 22, 18, 24]] },
      int:   { tiers: [['聰慧的', 1, 1, 3], ['睿智的', 4, 4, 6], ['神算的', 7, 7, 9], ['鬼謀的', 12, 10, 13], ['天機的', 22, 14, 18]] },
      lead:  { tiers: [['勇猛的', 1, 1, 3], ['威嚴的', 4, 3, 5], ['霸氣的', 7, 6, 8], ['王者的', 12, 9, 11], ['帝王的', 22, 12, 15]] },
      speed: { tiers: [['輕快的', 3, 8, 15], ['疾風的', 7, 16, 25], ['追風的', 15, 26, 35]], slots: ['armor', 'treasure'] }
    },
    suffix: {
      war:     { tiers: [['猛虎', 1, 1, 3], ['蛟龍', 4, 4, 6], ['霸王', 7, 7, 9], ['戰神', 12, 10, 13], ['武神', 22, 14, 18]] },
      hp:      { tiers: [['活力', 1, 2, 4], ['巨人', 4, 5, 8], ['不死鳥', 7, 9, 12], ['玄武', 12, 13, 17], ['麒麟', 22, 18, 24]] },
      int:     { tiers: [['賢者', 1, 1, 3], ['臥龍', 5, 4, 7], ['鳳雛', 12, 8, 11], ['仙人', 22, 12, 16]] },
      troops:  { tiers: [['兵勢', 2, 1, 2], ['軍威', 5, 3, 4], ['霸業', 8, 5, 6], ['天下', 14, 7, 8], ['一統', 24, 9, 11]] },
      command: { tiers: [['號令', 3, 1, 1], ['天命', 8, 2, 2], ['王道', 18, 3, 3]], slots: ['weapon', 'treasure'] }
    }
  };
  var STAT_LABEL = { hp: '體力', war: '武力', int: '智力', lead: '統率' };
  var RARE_NAMES = ['破軍', '血月', '蒼狼', '赤霄', '玄武', '驚雷', '鬼哭', '龍吟', '天狼', '斷魂', '烈焰', '寒霜', '孤星', '飛燕'];

  // ---- 暗金：固定屬性的名品 ----
  S.UNIQUES = {
    dilu:      { name: '的盧',     slot: 'treasure', ilvl: 3,  speed: 30, hp: 8 },
    mingguang: { name: '明光鎧',   slot: 'armor',    ilvl: 4,  hp: 20, lead: 8 },
    sunzi:     { name: '孫子兵法', slot: 'treasure', ilvl: 5,  int: 12, command: 2 },
    warDrum:   { name: '戰鼓',     slot: 'treasure', ilvl: 6,  troops: 6, lead: 3 },
    qinggang:  { name: '青釭劍',   slot: 'weapon',   ilvl: 6,  war: 12, int: 4 },
    yitian:    { name: '倚天劍',   slot: 'weapon',   ilvl: 8,  war: 14, command: 1 },
    shemao:    { name: '丈八蛇矛', slot: 'weapon',   ilvl: 14, war: 22, hp: 8 },
    taiping:   { name: '太平要術', slot: 'treasure', ilvl: 15, int: 20, command: 2 },
    xuanwu:    { name: '玄武甲',   slot: 'armor',    ilvl: 16, hp: 32, lead: 10 },
    qixing:    { name: '七星寶刀', slot: 'weapon',   ilvl: 18, war: 18, int: 10, command: 1 },
    jueying:   { name: '絕影',     slot: 'treasure', ilvl: 20, speed: 50, hp: 14, war: 6 },
    bawangyin: { name: '霸王之印', slot: 'treasure', ilvl: 25, troops: 10, war: 8, lead: 8 }
  };

  // ---- 套裝：bonus[n] = 同一套穿滿 n 件時的額外加成 ----
  S.SETS = {
    lubu:   { name: '飛將', pieces: ['halberd', 'beastArmor', 'redHare'],
              bonus: { 2: { war: 6 }, 3: { troops: 6, command: 2 } } },
    guanyu: { name: '武聖', pieces: ['dragonBlade', 'greenRobe', 'chunqiu'],
              bonus: { 2: { lead: 6 }, 3: { war: 8, troops: 5 } } },
    caocao: { name: '魏武', pieces: ['weiSword', 'weiRobe', 'mengde'],
              bonus: { 2: { troops: 6 }, 3: { war: 10, lead: 10, command: 2 } } }
  };
  S.SET_ITEMS = {
    halberd:     { name: '方天畫戟',   slot: 'weapon',   set: 'lubu',   ilvl: 10, war: 18 },
    beastArmor:  { name: '獸面吞頭鎧', slot: 'armor',    set: 'lubu',   ilvl: 9,  hp: 16, lead: 4 },
    redHare:     { name: '赤兔馬',     slot: 'treasure', set: 'lubu',   ilvl: 10, war: 5, speed: 40 },
    dragonBlade: { name: '青龍偃月刀', slot: 'weapon',   set: 'guanyu', ilvl: 9,  war: 15, lead: 5 },
    greenRobe:   { name: '綠錦戰袍',   slot: 'armor',    set: 'guanyu', ilvl: 8,  hp: 12, int: 4 },
    chunqiu:     { name: '春秋左傳',   slot: 'treasure', set: 'guanyu', ilvl: 8,  int: 8, lead: 4 },
    weiSword:    { name: '魏武劍',     slot: 'weapon',   set: 'caocao', ilvl: 20, war: 16, int: 6 },
    weiRobe:     { name: '魏武袍',     slot: 'armor',    set: 'caocao', ilvl: 20, hp: 22, lead: 8 },
    mengde:      { name: '孟德新書',   slot: 'treasure', set: 'caocao', ilvl: 22, int: 14, command: 2 }
  };

  var STATS = ['hp', 'war', 'int', 'lead', 'command', 'troops', 'speed'];
  // 估價：每點能力值多少金
  var PRICE = { hp: 25, war: 50, int: 40, lead: 40, command: 250, troops: 70, speed: 15 };
  S.ITEM_SELL_RATE = 0.35;
  S.MAX_ILVL = 30;                // 地獄第 10 關 = 物品等級 30
  S.BAG_SIZE = 24;

  function rnd(a, b) { return a + Math.floor(S.random() * (b - a + 1)); }
  function pick(list) { return list[Math.floor(S.random() * list.length)]; }
  function weighted(pairs) {           // [[值, 權重], ...]
    var total = pairs.reduce(function (s, p) { return s + p[1]; }, 0), r = S.random() * total;
    for (var i = 0; i < pairs.length; i++) { r -= pairs[i][1]; if (r < 0) return pairs[i][0]; }
    return pairs[pairs.length - 1][0];
  }

  // ======================= 產生裝備 =======================
  // 依物品等級決定品質的機率 (越後面的關卡越容易出好東西)
  function rollQuality(ilvl) {
    var w = [
      ['normal', Math.max(10, 60 - 4 * ilvl)],
      ['magic', 30],
      ['rare', Math.min(30, 6 + 1.2 * ilvl)]
    ];
    if (eligible(S.SET_ITEMS, ilvl).length) w.push(['set', Math.min(8, 0.5 + 0.3 * ilvl)]);
    if (eligible(S.UNIQUES, ilvl).length) w.push(['unique', Math.min(10, 1 + 0.4 * ilvl)]);
    return weighted(w);
  }
  function eligible(table, ilvl, slot) {
    return Object.keys(table).filter(function (id) {
      return table[id].ilvl <= ilvl && (!slot || table[id].slot === slot);
    });
  }

  function rollAffix(group, k, slot, ilvl) {
    var def = S.AFFIXES[group][k];
    var tiers = def.tiers.map(function (t, i) { return i; }).filter(function (i) { return def.tiers[i][1] <= ilvl; });
    var t = tiers[tiers.length - 1 - Math.floor(S.random() * Math.min(2, tiers.length))];   // 偏向最高的兩個層級
    var tier = def.tiers[t];
    return { k: k, pre: group === 'prefix', t: t, v: rnd(tier[2], tier[3]) };
  }
  function affixPool(group, slot, ilvl, used) {
    return Object.keys(S.AFFIXES[group]).filter(function (k) {
      var def = S.AFFIXES[group][k];
      return used.indexOf(k) < 0 && def.tiers[0][1] <= ilvl && (!def.slots || def.slots.indexOf(slot) >= 0);
    });
  }

  // 產生一件裝備：opts = { ilvl, quality?, slot?, unique?, set? }
  S.makeItem = function (opts) {
    var ilvl = Math.max(1, Math.min(S.MAX_ILVL, opts.ilvl || 1));
    if (opts.unique) return { q: 'unique', id: opts.unique };
    if (opts.set) return { q: 'set', id: opts.set };
    var q = opts.quality || rollQuality(ilvl);
    if (q === 'unique' || q === 'set') {
      var table = q === 'unique' ? S.UNIQUES : S.SET_ITEMS;
      var ids = eligible(table, ilvl, opts.slot);
      if (ids.length) return { q: q, id: pick(ids) };
      q = 'rare';
    }
    // 基底：偏向該物品等級能出的最高兩種
    var bases = Object.keys(S.ITEM_BASES).filter(function (id) {
      var b = S.ITEM_BASES[id];
      return b.ilvl <= ilvl && (!opts.slot || b.slot === opts.slot);
    });
    var top = Math.max.apply(null, bases.map(function (id) { return S.ITEM_BASES[id].ilvl; }));
    var good = bases.filter(function (id) { return S.ITEM_BASES[id].ilvl >= top - 2; });
    var base = pick(S.random() < 0.7 ? good : bases);
    var slot = S.ITEM_BASES[base].slot;
    var item = { q: q, base: base, ilvl: ilvl, affixes: [] };
    var nPre = 0, nSuf = 0;
    if (q === 'magic') {
      var r = S.random();
      nPre = r < 0.75 ? 1 : 0;
      nSuf = r >= 0.5 ? 1 : 0;
    } else if (q === 'rare') {
      var n = rnd(3, 4);
      nPre = Math.min(2, n - 1 - Math.floor(S.random() * 2));
      nSuf = n - nPre;
    }
    ['prefix', 'suffix'].forEach(function (group) {
      var used = [];
      for (var i = 0; i < (group === 'prefix' ? nPre : nSuf); i++) {
        var pool = affixPool(group, slot, ilvl, used);
        if (!pool.length) break;
        var k = pick(pool);
        used.push(k);
        item.affixes.push(rollAffix(group, k, slot, ilvl));
      }
    });
    if (q === 'rare') item.rname = pick(RARE_NAMES);
    return item;
  };

  // 戰利品：打贏第 stage 關 (1–10) 掉落一件
  S.rollLoot = function (stage) { return S.makeItem({ ilvl: stage }); };

  // 商店貨架：以普通 / 魔法為主，偶爾有稀有
  S.rollShop = function (ilvl, n) {
    var list = [];
    for (var i = 0; i < n; i++) {
      list.push(S.makeItem({ ilvl: ilvl, quality: weighted([['normal', 50], ['magic', 42], ['rare', 8]]),
                             slot: S.EQUIP_SLOT_KEYS[i % 3] }));
    }
    return list;
  };

  // ======================= 讀取裝備資訊 =======================
  // 回傳 { name, slot, q, stats, lines, setId }
  S.itemInfo = function (item) {
    var stats = {}, lines = [], def, name;
    STATS.forEach(function (k) { stats[k] = 0; });
    function add(src) { STATS.forEach(function (k) { if (src[k]) stats[k] += src[k]; }); }
    if (item.q === 'unique' || item.q === 'set') {
      def = (item.q === 'unique' ? S.UNIQUES : S.SET_ITEMS)[item.id];
      add(def);
      return { name: def.name, slot: def.slot, q: item.q, stats: stats, lines: statLines(stats), setId: def.set || null };
    }
    var base = S.ITEM_BASES[item.base];
    add(base);
    var pre = null, suf = null;
    item.affixes.forEach(function (a) {
      var tier = S.AFFIXES[a.pre ? 'prefix' : 'suffix'][a.k].tiers[a.t];
      stats[a.k] += a.v;
      if (a.pre && !pre) pre = tier[0];
      if (!a.pre && !suf) suf = tier[0];
    });
    if (item.q === 'rare') name = item.rname + base.name;
    else if (item.q === 'magic') name = (pre || '') + (suf || '') + base.name;
    else name = base.name;
    return { name: name, slot: base.slot, q: item.q, stats: stats, lines: statLines(stats), setId: null };
  };

  function statLines(st) {
    var lines = [];
    ['war', 'hp', 'int', 'lead'].forEach(function (k) { if (st[k]) lines.push(STAT_LABEL[k] + ' +' + st[k]); });
    if (st.command) lines.push('開戰軍令 +' + st.command);
    if (st.troops) lines.push('全軍士兵能力 +' + st.troops + '%');
    if (st.speed) lines.push('主將移動速度 +' + st.speed + '%');
    return lines;
  }
  S.statLines = statLines;

  S.itemValue = function (item) {
    var info = S.itemInfo(item), v = 0;
    STATS.forEach(function (k) { v += (info.stats[k] || 0) * PRICE[k]; });
    return Math.max(10, Math.round(v * S.QUALITIES[info.q].mult / 10) * 10);
  };
  S.itemSellPrice = function (item) { return Math.floor(S.itemValue(item) * S.ITEM_SELL_RATE); };

  // ======================= 套裝加成 / 上場軍隊 =======================
  // 回傳 [{ id, name, count, total, bonus: [{ n, stats, active }] }]
  S.setStatus = function (equip) {
    var counts = {};
    S.EQUIP_SLOT_KEYS.forEach(function (slot) {
      var it = equip && equip[slot];
      if (it && it.q === 'set') { var s = S.SET_ITEMS[it.id].set; counts[s] = (counts[s] || 0) + 1; }
    });
    return Object.keys(counts).map(function (id) {
      var set = S.SETS[id];
      return { id: id, name: set.name, count: counts[id], total: set.pieces.length,
               bonus: Object.keys(set.bonus).map(function (n) {
                 return { n: Number(n), stats: set.bonus[n], active: counts[id] >= Number(n) };
               }) };
    });
  };

  // 進度 → 上場的玩家軍隊 (主將能力 = 基本 + 裝備 + 套裝加成)；campaign.js 與 tools/campaign-sim.js 共用
  S.playerArmy = function (profile) {
    var g = profile.general;
    var army = { name: g.name, hp: g.hp, war: g.war, int: g.int, lead: g.lead, beard: g.beard,
                 units: profile.soldiers.slice(), commandBonus: 0, troopBonus: 0, speedBonus: 0 };
    function add(st) {
      ['hp', 'war', 'int', 'lead'].forEach(function (k) { if (st[k]) army[k] += st[k]; });
      army.commandBonus += st.command || 0;
      army.troopBonus += (st.troops || 0) / 100;
      army.speedBonus += (st.speed || 0) / 100;
    }
    var equip = profile.equip || {};
    S.EQUIP_SLOT_KEYS.forEach(function (slot) { if (equip[slot]) add(S.itemInfo(equip[slot]).stats); });
    S.setStatus(equip).forEach(function (s) {
      s.bonus.forEach(function (b) { if (b.active) add(b.stats); });
    });
    return army;
  };
  S.playerLevels = function (profile) {
    var l = profile.levels;
    return { general: 0, spear: l.spear, archer: l.archer, cavalry: l.cavalry };
  };

  // ======================= 舊版存檔 (裝備是字串 id) =======================
  var LEGACY = {
    ironSword: { q: 'normal', base: 'sword', ilvl: 1, affixes: [] },
    steelSpear: { q: 'normal', base: 'spear', ilvl: 3, affixes: [] },
    leather: { q: 'normal', base: 'leather', ilvl: 3, affixes: [] },
    ironArmor: { q: 'normal', base: 'iron', ilvl: 7, affixes: [] },
    brightArmor: { q: 'unique', id: 'mingguang' },
    artOfWar: { q: 'normal', base: 'book', ilvl: 3, affixes: [] },
    sunzi: { q: 'unique', id: 'sunzi' },
    warDrum: { q: 'unique', id: 'warDrum' },
    qinggang: { q: 'unique', id: 'qinggang' },
    dragonBlade: { q: 'set', id: 'dragonBlade' },
    halberd: { q: 'set', id: 'halberd' },
    redHare: { q: 'set', id: 'redHare' }
  };
  // 檢查 / 轉換一件裝備；無效回傳 null
  S.normalizeItem = function (it) {
    if (typeof it === 'string') it = LEGACY[it] ? JSON.parse(JSON.stringify(LEGACY[it])) : null;
    if (!it || !S.QUALITIES[it.q]) return null;
    if (it.q === 'unique') return S.UNIQUES[it.id] ? it : null;
    if (it.q === 'set') return S.SET_ITEMS[it.id] ? it : null;
    if (!S.ITEM_BASES[it.base]) return null;
    it.affixes = (it.affixes || []).filter(function (a) {
      var g = S.AFFIXES[a.pre ? 'prefix' : 'suffix'][a.k];
      return g && g.tiers[a.t];
    });
    return it;
  };
})(window.Sango);
