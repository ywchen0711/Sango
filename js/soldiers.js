/*
 * 士兵 (仿暗黑破壞神 2 的傭兵，再加上品質與詞綴)：
 *   每個士兵有名字、職業、品質 (普通 / 魔法 / 稀有 / 傳說)、前綴 / 中綴 / 後綴、四個技能、等級、自己的裝備 (武器 / 頭盔 / 鎧甲)
 *   戰鬥時轉成 battle.js 的 preset (能力值都先算好)
 *
 * 士兵物件 (存在進度裡)：
 *   { id, name, cls, q, title?, uid?, affixes: [{ k, g, t, v }], lv, sp, skills: [{ id, lv }] ×4,
 *     equip: { weapon, helm, armor }, active }
 */
(function (S) {
  'use strict';

  // ---- 職業：三個兵種各三種 (沿用兵種的外觀與相剋)；mul 為能力倍率，pool 為技能池 ----
  S.CLASSES = {
    spear:       { name: '長槍兵', type: 'spear',   price: 100, mul: {},
                   pool: ['charge', 'pierce', 'sweep', 'double', 'rally', 'ironwall', 'vigor'] },
    shield:      { name: '盾兵',   type: 'spear',   price: 120, mul: { hp: 1.2, atk: 0.75, def: 1.5, spr: 1.2 },
                   pool: ['sweep', 'ironwall', 'vigor', 'rally', 'heal', 'pierce'] },
    halberd:     { name: '戟兵',   type: 'spear',   price: 130, mul: { atk: 1.25, def: 0.85, hp: 1.05 },
                   pool: ['sweep', 'double', 'charge', 'pierce', 'swift', 'vigor'] },
    archer:      { name: '弓手',   type: 'archer',  price: 120, mul: {},
                   pool: ['double', 'pierce', 'sharpshoot', 'swift', 'fire', 'thunder'] },
    crossbow:    { name: '弩兵',   type: 'archer',  price: 140, mul: { atk: 1.35, hp: 0.95 }, attackMul: 1.25,
                   pool: ['pierce', 'sharpshoot', 'double', 'vigor', 'confuse', 'ironwall'] },
    strategist:  { name: '謀士',   type: 'archer',  price: 160, mul: { atk: 0.6, int: 1.8, spr: 1.4, mp: 1.6, hp: 0.85 },
                   pool: ['fire', 'thunder', 'confuse', 'heal', 'rally', 'sharpshoot'] },
    cavalry:     { name: '騎兵',   type: 'cavalry', price: 150, mul: {},
                   pool: ['charge', 'double', 'swift', 'sweep', 'confuse', 'vigor'] },
    heavycav:    { name: '重騎',   type: 'cavalry', price: 190, mul: { hp: 1.25, def: 1.35, atk: 1.1 }, moveMul: 1.2,
                   pool: ['charge', 'sweep', 'ironwall', 'vigor', 'pierce', 'rally'] },
    horsearcher: { name: '弓騎',   type: 'cavalry', price: 180, mul: { atk: 0.85, hp: 0.9 }, ranged: true, range: 3,
                   pool: ['double', 'pierce', 'sharpshoot', 'swift', 'charge', 'fire'] }
  };
  S.CLASS_KEYS = Object.keys(S.CLASSES);
  S.BASE_CLASS = { spear: 'spear', archer: 'archer', cavalry: 'cavalry' };   // 舊存檔的兵種 → 職業

  // ---- 技能：主動技能沿用 S.SKILLS (config.js)；另有四個被動技能 ----
  S.PASSIVES = {
    ironwall:   { name: '鐵壁', desc: '防禦 +3% / 級' },
    vigor:      { name: '強健', desc: '兵力 +3% / 級' },
    swift:      { name: '疾攻', desc: '攻擊間隔 -2% / 級' },
    sharpshoot: { name: '神射', desc: '攻擊 +2% / 級，5 級起射程 +1' }
  };
  S.SKILL_MAX = 10;
  S.skillName = function (id) { return (S.SKILLS[id] || S.PASSIVES[id]).name; };
  S.skillDesc = function (id, lv) {
    if (S.PASSIVES[id]) return S.PASSIVES[id].desc;
    return S.SKILLS[id].desc + '（威力 +' + Math.round((lv - 1) * 6) + '%）';
  };

  // ---- 品質 (顏色沿用裝備的品質) ----
  S.SOLDIER_QUALITIES = {
    normal: { name: '普通', mul: 1,    price: 1 },
    magic:  { name: '魔法', mul: 1.06, price: 2 },
    rare:   { name: '稀有', mul: 1.12, price: 4 },
    unique: { name: '傳說', mul: 1.2,  price: 8 }
  };

  // ---- 士兵的詞綴：前綴 = 能力 %、後綴 = 固定數值、中綴 = 特效 % ----
  // tiers：[稱號, 最低等級, 最小值, 最大值]
  S.SOLDIER_AFFIXES = {
    prefix: {
      atkPct: { label: '攻擊', unit: '%', tiers: [['勇猛', 1, 5, 9], ['驍勇', 8, 10, 16], ['無畏', 18, 17, 25]] },
      hpPct:  { label: '兵力', unit: '%', tiers: [['強壯', 1, 6, 10], ['魁梧', 8, 11, 18], ['金剛', 18, 19, 28]] },
      defPct: { label: '防禦', unit: '%', tiers: [['堅毅', 1, 5, 9], ['剛毅', 8, 10, 16], ['不動', 18, 17, 25]] },
      intPct: { label: '智力', unit: '%', tiers: [['聰穎', 1, 6, 10], ['博學', 8, 11, 18], ['神機', 18, 19, 28]] }
    },
    infix: {
      crit:     { label: '致命一擊', unit: '%', tiers: [['狂戰', 3, 5, 9], ['戰狂', 15, 10, 15]] },
      leech:    { label: '吸血', unit: '%', tiers: [['嗜血', 3, 3, 6], ['飲血', 15, 7, 10]] },
      burn:     { label: '機率燃燒', unit: '%', tiers: [['烈焰', 3, 10, 20], ['業火', 15, 21, 30]] },
      stun:     { label: '機率混亂', unit: '%', tiers: [['雷鳴', 5, 5, 9], ['天雷', 16, 10, 14]] },
      swiftPct: { label: '攻擊速度', unit: '%', tiers: [['疾風', 3, 6, 10], ['神速', 15, 11, 18]] }
    },
    suffix: {
      atk: { label: '攻擊', unit: '', tiers: [['豪力', 1, 1, 2], ['勇武', 8, 3, 4], ['霸王', 18, 5, 7]] },
      def: { label: '防禦', unit: '', tiers: [['鐵壁', 1, 1, 2], ['金城', 8, 3, 4], ['磐石', 18, 5, 7]] },
      hp:  { label: '兵力', unit: '', tiers: [['長命', 1, 10, 20], ['不死', 8, 21, 35], ['神魂', 18, 36, 55]] },
      spr: { label: '精神', unit: '', tiers: [['赤心', 1, 1, 2], ['壯志', 8, 3, 4], ['英魄', 18, 5, 7]] }
    }
  };
  var EPITHETS = ['破軍', '血月', '蒼狼', '赤霄', '玄武', '蒼穹', '鬼哭', '龍吟', '天狼', '斷魂', '幽冥', '狂龍', '孤星', '飛燕'];
  var SURNAMES = '王李張劉陳楊趙黃周吳徐孫馬朱胡郭何高林羅鄭梁謝宋唐許韓馮鄧曹彭曾蕭田董袁潘于蔣蔡余杜葉程蘇魏呂丁任沈姚盧姜崔鍾譚陸汪范金石廖賈夏韋付方白鄒孟熊秦邱江尹薛閻段雷侯龍史陶黎賀顧毛郝龔邵萬錢嚴覃武戴莫孔向湯'.split('');
  var GIVEN = '勇猛義忠安平飛虎龍豹雲山德仁明武剛強興遠英傑雄威烈鋒岳峰濤浩然振邦國華文成昭弘毅超群霸奎彪虔典俊朗'.split('');

  // ---- 傳說士兵：固定的名將級人物 ----
  S.UNIQUE_SOLDIERS = {
    zhoucang:   { name: '周倉',   cls: 'shield',      ilvl: 3,  skills: ['sweep', 'ironwall', 'vigor', 'rally'],
                  bonus: { hpPct: 30, defPct: 30, atk: 2 } },
    liaohua:    { name: '廖化',   cls: 'spear',       ilvl: 5,  skills: ['charge', 'pierce', 'double', 'vigor'],
                  bonus: { atkPct: 25, crit: 10 } },
    madai:      { name: '馬岱',   cls: 'cavalry',     ilvl: 7,  skills: ['charge', 'swift', 'double', 'sweep'],
                  bonus: { atkPct: 20, swiftPct: 15, hpPct: 10 } },
    gaoshun:    { name: '高順',   cls: 'heavycav',    ilvl: 10, skills: ['charge', 'ironwall', 'sweep', 'vigor'],
                  bonus: { atkPct: 25, defPct: 30, stun: 8 } },
    taishici:   { name: '太史慈', cls: 'horsearcher', ilvl: 13, skills: ['double', 'sharpshoot', 'pierce', 'swift'],
                  bonus: { atkPct: 30, crit: 12, hpPct: 15 } },
    fazheng:    { name: '法正',   cls: 'strategist',  ilvl: 16, skills: ['fire', 'thunder', 'confuse', 'heal'],
                  bonus: { intPct: 40, sprPct: 30, burn: 20 } }
  };

  function rnd(a, b) { return a + Math.floor(S.random() * (b - a + 1)); }
  function pick(list) { return list[Math.floor(S.random() * list.length)]; }
  var seq = 0;
  function newId() { return Date.now().toString(36) + (seq++).toString(36) + Math.floor(S.random() * 1e6).toString(36); }

  // ======================= 產生士兵 =======================
  // opts = { cls?, q?, ilvl, lv?, unique? }
  S.makeSoldier = function (opts) {
    var ilvl = Math.max(1, Math.min(S.MAX_ILVL, opts.ilvl || 1));
    if (opts.unique) {
      var u = S.UNIQUE_SOLDIERS[opts.unique];
      return { id: newId(), name: u.name, cls: u.cls, q: 'unique', uid: opts.unique, affixes: [], lv: opts.lv || 0, sp: opts.lv || 0,
               skills: u.skills.map(function (id) { return { id: id, lv: 1 }; }), equip: {}, active: false };
    }
    var cls = opts.cls || pick(S.CLASS_KEYS);
    var q = opts.q || 'normal';
    var sol = { id: newId(), name: pick(SURNAMES) + pick(GIVEN) + (S.random() < 0.4 ? pick(GIVEN) : ''), cls: cls, q: q,
                affixes: [], lv: opts.lv || 0, sp: opts.lv || 0, equip: {}, active: false,
                skills: S.pickDistinct(S.CLASSES[cls].pool, 4, S.random).map(function (id) { return { id: id, lv: 1 }; }) };
    var nPre = 0, nSuf = 0, nInf = 0;
    if (q === 'magic') { var r = S.random(); nPre = r < 0.75 ? 1 : 0; nSuf = r >= 0.5 ? 1 : 0; nInf = S.random() < 0.15 ? 1 : 0; }
    if (q === 'rare') { nPre = rnd(1, 2); nSuf = rnd(1, 2); if (nPre + nSuf < 3) nPre++; nInf = S.random() < 0.5 ? 1 : 0; }
    [['prefix', nPre], ['infix', nInf], ['suffix', nSuf]].forEach(function (p) {
      var keys = Object.keys(S.SOLDIER_AFFIXES[p[0]]).filter(function (k) { return S.SOLDIER_AFFIXES[p[0]][k].tiers[0][1] <= ilvl; });
      S.pickDistinct(keys, Math.min(p[1], keys.length), S.random).forEach(function (k) {
        var tiers = S.SOLDIER_AFFIXES[p[0]][k].tiers;
        var ok = tiers.map(function (t, i) { return i; }).filter(function (i) { return tiers[i][1] <= ilvl; });
        var t = ok[ok.length - 1 - Math.floor(S.random() * Math.min(2, ok.length))];
        sol.affixes.push({ k: k, g: p[0], t: t, v: rnd(tiers[t][2], tiers[t][3]) });
      });
    });
    if (q === 'rare') sol.title = pick(EPITHETS);
    return sol;
  };

  // 徵兵處的候選人：品質依物品等級，等級跟著進度
  S.rollRecruits = function (ilvl, n) {
    var list = [];
    for (var i = 0; i < n; i++) {
      var r = S.random(), q = r < 0.5 ? 'normal' : r < 0.82 ? 'magic' : 'rare';
      var uniques = Object.keys(S.UNIQUE_SOLDIERS).filter(function (id) { return S.UNIQUE_SOLDIERS[id].ilvl <= ilvl; });
      var lv = Math.max(0, Math.floor((ilvl - 2) * 0.6) - rnd(0, 2));
      if (uniques.length && S.random() < 0.015 + ilvl * 0.001) list.push(S.makeSoldier({ unique: pick(uniques), ilvl: ilvl, lv: lv }));
      else list.push(S.makeSoldier({ q: q, ilvl: ilvl, lv: lv }));
    }
    return list;
  };

  // ======================= 讀取士兵資訊 =======================
  S.soldierTitle = function (sol) {
    if (sol.q === 'unique') return '';
    if (sol.q === 'rare') return '「' + sol.title + '」';
    var names = {};
    (sol.affixes || []).forEach(function (a) {
      if (!names[a.g]) names[a.g] = S.SOLDIER_AFFIXES[a.g][a.k].tiers[a.t][0];
    });
    return ['prefix', 'infix', 'suffix'].filter(function (g) { return names[g]; }).map(function (g) { return names[g]; }).join('・');
  };
  S.soldierFullName = function (sol) {
    var t = S.soldierTitle(sol);
    return (t ? t + ' ' : '') + sol.name;
  };
  S.soldierAffixLines = function (sol) {
    var lines = [];
    (sol.affixes || []).forEach(function (a) {
      var def = S.SOLDIER_AFFIXES[a.g][a.k];
      lines.push({ group: a.g, name: def.tiers[a.t][0], line: def.label + ' +' + a.v + def.unit });
    });
    if (sol.q === 'unique') {
      var b = S.UNIQUE_SOLDIERS[sol.uid].bonus;
      Object.keys(b).forEach(function (k) { lines.push({ group: 'unique', name: '傳說', line: bonusLabel(k) + ' +' + b[k] + (/Pct$|crit|leech|burn|stun/.test(k) ? '%' : '') }); });
    }
    return lines;
  };
  function bonusLabel(k) {
    return { hpPct: '兵力', atkPct: '攻擊', defPct: '防禦', intPct: '智力', sprPct: '精神', swiftPct: '攻擊速度',
             atk: '攻擊', def: '防禦', hp: '兵力', spr: '精神', crit: '致命一擊', leech: '吸血', burn: '機率燃燒', stun: '機率混亂' }[k] || k;
  }

  // 等級提升的費用 (每個士兵各自升級；約為以前「兵種等級」的三分之一，因為以前一次升一整個兵種)
  S.soldierLevelCost = function (lv) { return Math.round(S.levelCost(lv) * 0.35); };
  S.soldierPrice = function (sol) {
    var base = S.CLASSES[sol.cls].price * S.SOLDIER_QUALITIES[sol.q].price;
    return Math.round(base * (1 + 0.15 * sol.lv) / 10) * 10;
  };
  S.SOLDIER_EQUIP = { weapon: '武器', helm: '頭盔', armor: '鎧甲' };   // 比照暗黑 2 的傭兵
  S.SOLDIER_EQUIP_KEYS = ['weapon', 'helm', 'armor'];

  // ======================= 能力計算 → 戰鬥用的 preset =======================
  S.soldierStats = function (sol) {
    var C = S.CLASSES[sol.cls], T = S.UNIT_TYPES[C.type], Q = S.SOLDIER_QUALITIES[sol.q];
    var lvMul = 1 + sol.lv * S.LEVEL.BONUS;
    var st = {};
    ['hp', 'mp', 'atk', 'def', 'int', 'spr'].forEach(function (k) { st[k] = T[k] * (C.mul[k] || 1) * Q.mul * lvMul; });
    var pct = { hp: 0, atk: 0, def: 0, int: 0, spr: 0 }, flat = { hp: 0, atk: 0, def: 0, int: 0, spr: 0 };
    var procs = { crit: 0, leech: 0, burn: 0, stun: 0, slow: 0, pierce: 0 }, swift = 0, moveMul = C.moveMul || 1, rangeBonus = 0;
    function addBonus(k, v) {
      var m = /^(hp|atk|def|int|spr)Pct$/.exec(k);
      if (m) pct[m[1]] += v;
      else if (flat[k] != null) flat[k] += v;
      else if (procs[k] != null) procs[k] += v;
      else if (k === 'swiftPct') swift += v;
    }
    (sol.affixes || []).forEach(function (a) { addBonus(a.k, a.v); });
    if (sol.q === 'unique') { var b = S.UNIQUE_SOLDIERS[sol.uid].bonus; Object.keys(b).forEach(function (k) { addBonus(k, b[k]); }); }
    // 被動技能
    var skillLv = {};
    (sol.skills || []).forEach(function (s) {
      skillLv[s.id] = s.lv;
      if (s.id === 'ironwall') pct.def += 3 * s.lv;
      if (s.id === 'vigor') pct.hp += 3 * s.lv;
      if (s.id === 'swift') swift += 2 * s.lv;
      if (s.id === 'sharpshoot') { pct.atk += 2 * s.lv; if (s.lv >= 5) rangeBonus = 1; }
    });
    // 裝備：武力 → 攻擊、體力 → 兵力、智力 → 智力、統率 → 防禦 / 精神；中綴特效同樣有效
    S.SOLDIER_EQUIP_KEYS.forEach(function (slot) {
      var it = sol.equip && sol.equip[slot];
      if (!it) return;
      var i = S.itemInfo(it).stats;
      flat.atk += (i.war || 0) * 0.4;
      flat.hp += (i.hp || 0) * 4;
      flat.int += (i.int || 0) * 0.4;
      flat.def += (i.lead || 0) * 0.3;
      flat.spr += (i.lead || 0) * 0.2;
      ['crit', 'leech', 'burn', 'stun', 'slow', 'pierce'].forEach(function (k) { procs[k] += i[k] || 0; });
      if (i.speed) moveMul /= 1 + i.speed / 100;
    });
    ['hp', 'atk', 'def', 'int', 'spr'].forEach(function (k) { st[k] = st[k] * (1 + pct[k] / 100) + flat[k]; });
    var CAP = { crit: 60, leech: 30, burn: 75, stun: 40, slow: 75, pierce: 70 };
    Object.keys(procs).forEach(function (k) { procs[k] = Math.min(CAP[k], procs[k]); });
    var phys = [], magic = [];
    (sol.skills || []).forEach(function (s) {
      var sk = S.SKILLS[s.id];
      if (!sk) return;
      (sk.kind === 'magic' ? magic : phys).push(s.id);
    });
    return {
      type: C.type, name: sol.name, lv: sol.lv, quality: sol.q,
      hp: Math.round(st.hp), mp: Math.round(st.mp), atk: Math.round(st.atk), def: Math.round(st.def),
      int: Math.round(st.int), spr: Math.round(st.spr),
      physSkills: phys, magicSkills: magic, skillLv: skillLv, procs: procs,
      moveMul: moveMul, attackMul: (C.attackMul || 1) / (1 + swift / 100),
      ranged: C.ranged != null ? C.ranged : !!T.ranged, range: (C.range || T.range) + (T.ranged || C.ranged ? rangeBonus : 0)
    };
  };

  // ======================= 舊版存檔 =======================
  // 舊版的士兵是兵種字串，等級是整個兵種共用的 levels[type]
  S.normalizeSoldier = function (x, levels) {
    if (typeof x === 'string') {
      if (!S.UNIT_TYPES[x]) return null;
      var sol = S.makeSoldier({ cls: S.BASE_CLASS[x], q: 'normal', ilvl: 1, lv: (levels && levels[x]) || 0 });
      sol.active = true;
      return sol;
    }
    if (!x || !S.CLASSES[x.cls] || !S.SOLDIER_QUALITIES[x.q]) return null;
    if (x.q === 'unique' && !S.UNIQUE_SOLDIERS[x.uid]) return null;
    x.affixes = (x.affixes || []).filter(function (a) { return S.SOLDIER_AFFIXES[a.g] && S.SOLDIER_AFFIXES[a.g][a.k]; });
    x.skills = (x.skills || []).filter(function (s) { return S.SKILLS[s.id] || S.PASSIVES[s.id]; });
    x.equip = x.equip || {};
    S.SOLDIER_EQUIP_KEYS.forEach(function (k) { x.equip[k] = x.equip[k] ? S.normalizeItem(x.equip[k]) : null; });
    x.lv = x.lv || 0;
    x.sp = x.sp || 0;
    return x;
  };
})(window.Sango);
