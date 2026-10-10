/*
 * 過關模式：建立武將 → 營地 (選關卡、招募士兵、提升能力) → 出征 → 結算
 * 進度透過 S.store (js/account.js) 儲存：登入存 Supabase，未登入存在本機
 *
 * 進度 profile：
 *   general  { name, hp, war, int, lead, beard }   主將能力
 *   soldiers ['spear', 'archer', ...]              擁有的士兵
 *   levels   { spear, archer, cavalry }            兵種等級
 *   gold / exp                                     金錢 / 經驗值
 *   cleared                                        已通過的關卡數 (第 cleared+1 關以後未解鎖)
 *   stats    { wins, losses }   settings { speed, bars }
 */
(function (S) {
  'use strict';

  var C = S.CAMPAIGN;
  var createEl = document.getElementById('create');
  var campEl = document.getElementById('camp');
  var resultEl = document.getElementById('result');
  var fieldEl = document.getElementById('field');
  var SHORT = { spear: S.t('槍'), archer: S.t('弓'), cavalry: S.t('騎') };
  var BEARDS = [['', S.t('無')], ['#282018', S.t('黑')], ['#6a4020', S.t('棕')], ['#c8c8c8', S.t('白')]];
  var STAT_DESC = {
    hp: S.t('主將兵力'),
    war: S.t('主將攻擊、鼓舞效果'),
    int: S.t('主將魔法、火計 / 落雷傷害'),
    lead: S.t('主將防禦、全軍士兵防禦、堅守效果')
  };

  var profile = null;
  var view = null;                // 'create' | 'camp' | 'battle' | 'result'
  var stageIdx = 0;               // 營地選中的關卡
  var campMsg = '';

  function sfx(name, delay) {
    if (!S.Sound) return;
    if (delay) setTimeout(function () { S.Sound.play(name); }, delay); else S.Sound.play(name);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function unitName(t) { return S.UNIT_TYPES[t].name; }
  var BARRACKS = 30;              // 營舍上限 (出戰最多 S.CAMPAIGN.MAX_UNITS 隊)
  var RECRUITS = 6;               // 徵兵處的候選人數
  var pickedId = null;            // 營舍裡選中的士兵
  // 營地的分頁：出征 / 主將 / 營舍 / 酒館 / 商店 (記在這台裝置上)
  var CAMP_TABS = [['go', S.t('⚔ 出征')], ['general', S.t('👤 主將')], ['barracks', S.t('🏕 營舍')], ['tavern', S.t('🍶 酒館')], ['shop', S.t('🏪 商店')]];
  var campTab = 'go';
  try { campTab = localStorage.getItem('sango.campTab') || 'go'; } catch (e) { /* 無痕模式等 */ }
  if (!CAMP_TABS.some(function (t) { return t[0] === campTab; })) campTab = 'go';
  function activeCount() { return profile.soldiers.filter(function (x) { return x.active; }).length; }
  function findSoldier(id) { for (var i = 0; i < profile.soldiers.length; i++) if (profile.soldiers[i].id === id) return profile.soldiers[i]; return null; }
  function className(sol) { return S.CLASSES[sol.cls].name; }

  function save() {
    return S.store.save(profile).catch(function () {});
  }

  function show(v) {
    view = v;
    createEl.hidden = v !== 'create';
    campEl.hidden = v !== 'camp';
    resultEl.hidden = v !== 'result';
    fieldEl.hidden = v === 'create' || v == null || (v === 'camp' && campTab !== 'go');
  }

  // ======================= 讀取進度 =======================
  function loadProfile() {
    S.game.stop();
    show(null);
    return S.store.load().then(function (p) {
      profile = p;
      if (!profile) { renderCreate(); return; }
      // 舊資料補齊欄位；士兵轉成角色 (舊版的兵種等級算進每個士兵，之後歸零)
      profile.levels = Object.assign({ spear: 0, archer: 0, cavalry: 0 }, profile.levels);
      profile.soldiers = (profile.soldiers || []).map(function (x) { return S.normalizeSoldier(x, profile.levels); }).filter(Boolean);
      profile.levels = { spear: 0, archer: 0, cavalry: 0 };
      if (!activeCount()) profile.soldiers.slice(0, C.MAX_UNITS).forEach(function (x) { x.active = true; });
      profile.soldiers.filter(function (x) { return x.active; }).slice(C.MAX_UNITS).forEach(function (x) { x.active = false; });
      profile.recruits = (profile.recruits || []).map(function (x) { return S.normalizeSoldier(x); }).filter(Boolean);
      profile.stats = Object.assign({ wins: 0, losses: 0 }, profile.stats);
      profile.gold = Number(profile.gold) || 0;
      profile.exp = Number(profile.exp) || 0;
      profile.cleared = Math.min(S.STAGES.length, Number(profile.cleared) || 0);
      profile.clearedBy = Object.assign({ normal: profile.cleared, nightmare: 0, hell: 0 }, profile.clearedBy);
      if (!diffUnlocked(profile.difficulty)) profile.difficulty = 'normal';
      profile.items = (profile.items || []).map(S.normalizeItem).filter(Boolean);
      // 裝備搬到 10 個位置 (舊版的武器 / 防具 / 寶物三欄也會自動轉換)，放不下的放回背包
      var moved = S.migrateEquip(profile.equip);
      profile.equip = moved.equip;
      profile.items = profile.items.concat(moved.extra);
      profile.shop = (profile.shop || []).map(S.normalizeItem).filter(Boolean);
      if (!profile.shop.length || !profile.recruits.length) restock();
      save();                     // 把轉換後的新格式存回去
      S.game.applySettings(profile.settings);
      stageIdx = Math.min(clr(), S.STAGES.length - 1);
      campMsg = '';
      renderCamp();
    }).catch(function (err) {
      profile = null;
      show(null);
      campEl.hidden = false;
      campEl.innerHTML = S.t('<p class="msg error">讀取進度失敗：') + esc((err && err.message) || err) +
        S.t('</p><button id="btn-reload">重試</button>');
      document.getElementById('btn-reload').addEventListener('click', loadProfile);
    });
  }

  // ======================= 建立武將 =======================
  function renderCreate() {
    show('create');
    var cr = C.CREATE;
    var stats = {};
    S.STAT_KEYS.forEach(function (k) { stats[k] = cr.BASE + cr.POINTS / 4; });
    var units = ['spear', 'spear', 'archer', 'archer', 'cavalry'].slice(0, C.START_UNITS);
    while (units.length < C.START_UNITS) units.push('spear');

    createEl.innerHTML =
      S.t('<h2>建立你的武將</h2>') +
      '<div class="cr-row">' +
        S.t('<label>名字 <input id="cr-name" maxlength="8" placeholder="例如：趙雲"></label>') +
        S.t('<label>鬍子 <select id="cr-beard">') + BEARDS.map(function (b) {
          return '<option value="' + b[0] + '">' + b[1] + '</option>';
        }).join('') + '</select></label>' +
      '</div>' +
      '<table class="cr-stats"><tbody>' + S.STAT_KEYS.map(function (k) {
        return '<tr><th>' + S.STAT_NAMES[k] + '</th>' +
          '<td><button data-stat="' + k + '" data-d="-5">−5</button><button data-stat="' + k + '" data-d="-1">−</button></td>' +
          '<td class="val" id="cr-' + k + '"></td>' +
          '<td><button data-stat="' + k + '" data-d="1">+</button><button data-stat="' + k + '" data-d="5">+5</button></td>' +
          '<td class="desc">' + STAT_DESC[k] + '</td></tr>';
      }).join('') + '</tbody></table>' +
      S.t('<p>剩餘點數 <b id="cr-left"></b>　<small>（每項 ') + cr.MIN + '–' + cr.MAX + S.t('）</small></p>') +
      S.t('<h3>初始士兵（') + C.START_UNITS + S.t(' 隊）</h3>') +
      '<div class="cr-units">' + units.map(function (t, i) {
        return '<select data-unit="' + i + '">' + S.CLASS_KEYS.map(function (k) {
          return '<option value="' + k + '"' + (k === t ? ' selected' : '') + '>' + S.CLASSES[k].name + '</option>';
        }).join('') + '</select>';
      }).join('') + '</div>' +
      S.t('<p class="hint">槍兵 剋 騎兵 · 騎兵 剋 弓兵 · 弓兵 剋 槍兵</p>') +
      S.t('<div class="cr-row"><button id="cr-random">🎲 隨機分配</button>') +
      S.t('<button id="cr-ok" class="primary">確定，開始征戰</button></div>') +
      '<p class="msg" id="cr-msg"></p>';

    function left() {
      return cr.BASE * S.STAT_KEYS.length + cr.POINTS -
        S.STAT_KEYS.reduce(function (s, k) { return s + stats[k]; }, 0);
    }
    function refresh() {
      S.STAT_KEYS.forEach(function (k) { document.getElementById('cr-' + k).textContent = stats[k]; });
      document.getElementById('cr-left').textContent = left();
      Array.prototype.forEach.call(createEl.querySelectorAll('[data-stat]'), function (b) {
        var k = b.dataset.stat, d = Number(b.dataset.d);
        b.disabled = d > 0 ? stats[k] >= cr.MAX || left() <= 0 : stats[k] <= cr.MIN;
      });
    }
    createEl.onclick = function (e) {   // 用 onclick 覆寫，重新建立時不會重複綁定
      var b = e.target.closest('[data-stat]');
      if (!b) return;
      var k = b.dataset.stat, d = Number(b.dataset.d);
      if (d > 0) d = Math.min(d, left());
      stats[k] = Math.max(cr.MIN, Math.min(cr.MAX, stats[k] + d));
      refresh();
    };
    document.getElementById('cr-random').addEventListener('click', function () {
      S.STAT_KEYS.forEach(function (k) { stats[k] = cr.MIN; });
      while (left() > 0) {
        var k = S.STAT_KEYS[(S.random() * 4) | 0];
        if (stats[k] < cr.MAX) stats[k]++;
      }
      Array.prototype.forEach.call(createEl.querySelectorAll('[data-unit]'), function (sel) {
        sel.value = S.CLASS_KEYS[(S.random() * S.CLASS_KEYS.length) | 0];
      });
      refresh();
    });
    document.getElementById('cr-ok').addEventListener('click', function () {
      var name = document.getElementById('cr-name').value.trim();
      var msg = document.getElementById('cr-msg');
      if (!name) { msg.textContent = S.t('請輸入武將名字'); return; }
      if (left() > 0) { msg.textContent = S.t('還有 ') + left() + S.t(' 點能力沒有分配'); return; }
      var soldiers = Array.prototype.map.call(createEl.querySelectorAll('[data-unit]'), function (sel) {
        var sol = S.makeSoldier({ cls: sel.value, q: 'normal', ilvl: 1 });
        sol.active = true;
        return sol;
      });
      profile = {
        general: { name: name, hp: stats.hp, war: stats.war, int: stats.int, lead: stats.lead,
                   beard: document.getElementById('cr-beard').value || null },
        soldiers: soldiers,
        levels: { spear: 0, archer: 0, cavalry: 0 },
        items: [],                  // 背包裡 (未裝備) 的裝備
        equip: S.migrateEquip({}).equip,
        gold: C.START_GOLD,
        exp: 0,
        cleared: 0,
        clearedBy: { normal: 0, nightmare: 0, hell: 0 },
        difficulty: 'normal',
        stats: { wins: 0, losses: 0 },
        settings: S.game.getSettings()
      };
      restock();
      stageIdx = 0;
      campMsg = name + S.t(' 出陣！先從第 1 關開始吧');
      save();
      renderCamp();
    });
    refresh();
  }

  // ======================= 營地 =======================
  // ======================= 難度 =======================
  // profile.clearedBy[難度] = 該難度已通過的關卡數；profile.cleared 保留普通難度的進度 (舊版相容)
  function diffKey() { return profile.difficulty || 'normal'; }
  function D() { return S.DIFFICULTIES[diffKey()]; }
  function clr() { return profile.clearedBy[diffKey()] || 0; }
  function setClr(n) {
    profile.clearedBy[diffKey()] = n;
    if (diffKey() === 'normal') profile.cleared = n;
  }
  function diffUnlocked(k) {
    var i = S.DIFFICULTY_KEYS.indexOf(k);
    if (i <= 0) return i === 0;
    return (profile.clearedBy[S.DIFFICULTY_KEYS[i - 1]] || 0) >= S.STAGES.length;
  }
  function stageIlvl(i) { return Math.min(S.MAX_ILVL, i + 1 + D().ilvl); }
  function battleOpts(i) { return { eliteChance: D().elite, ilvl: stageIlvl(i), mf: playerArmy().procs.mf }; }

  function playerArmy() { return S.playerArmy(profile); }
  function playerLevels() { return S.playerLevels(profile); }
  function enemyArmy(st) {
    return Object.assign({}, st.general, { units: st.units.slice() });
  }
  function levelText(st) {
    var lv = S.stageLevels(st, diffKey());
    var vals = ['general', 'spear', 'archer', 'cavalry'].map(function (k) { return lv[k]; });
    if (vals.every(function (v) { return v === vals[0]; })) return vals[0] ? 'Lv' + vals[0] : '';
    return S.t('主將Lv') + lv.general + S.t(' 槍Lv') + lv.spear + S.t(' 弓Lv') + lv.archer + S.t(' 騎Lv') + lv.cavalry;
  }
  function stageLabel(i) { return (diffKey() === 'normal' ? '' : S.t('【') + D().name + S.t('】')) + S.t('第 ') + (i + 1) + S.t(' 關 ') + S.STAGES[i].title; }

  // ======================= 裝備 =======================
  var SHOP_SIZE = 9;                // 每個部位各一件
  var bagFilter = 'all', bagSort = 'new';   // 背包的篩選 / 排序
  function shopLevel() { return Math.min(S.MAX_ILVL, clr() + 1 + D().ilvl); }
  function restock() {
    profile.shop = S.rollShop(shopLevel(), SHOP_SIZE);
    profile.recruits = S.rollRecruits(shopLevel(), RECRUITS);
  }

  function itemName(item) {
    var info = S.itemInfo(item);
    return '<span class="iname q-' + info.q + '">' + esc(info.name) + '</span>';
  }
  // 一件裝備：名稱 (品質顏色)、品質 / 欄位、屬性
  function itemLine(item, buttons, extra) {
    var info = S.itemInfo(item);
    return '<div class="item">' + itemName(item) +
      '<span class="itag">' + S.QUALITIES[info.q].name + S.t('・') + S.ITEM_SLOTS[info.slot] +
        (info.setId ? S.t('・') + S.SETS[info.setId].name : '') + '</span>' +
      '<span class="idesc">' + info.lines.join(S.t('、')) + (extra || '') + '</span>' +
      '<span class="ibtns">' + buttons + '</span>' +
      (info.affixes && info.affixes.length ? '<span class="iaff">' + info.affixes.map(function (a) {
        return '<span class="aff-' + a.group + S.t('">【') + S.AFFIX_GROUPS[a.group] + S.t('】') + a.name + S.t('：') + a.line + '</span>';
      }).join('') + '</span>' : '') + '</div>';
  }
  // 和目前裝備比較 (估價高低；戒指和比較差的那枚比)
  function compare(item) {
    var cur = profile.equip[S.equipTarget(profile.equip, item)];
    if (!cur) return S.t(' <small class="up">▲ 空欄</small>');
    var d = S.itemValue(item) - S.itemValue(cur);
    return d > 0 ? ' <small class="up">▲</small>' : d < 0 ? ' <small class="down">▼</small>' : '';
  }
  // 把背包第 i 件裝上，原本那一欄的裝備放回背包
  function equipItem(i) {
    var item = profile.items[i];
    profile.items.splice(i, 1);
    var old = S.equipInto(profile.equip, item);
    if (old) profile.items.push(old);
  }
  // 放進背包；該欄位空著就直接裝上；背包滿了自動賣掉。回傳說明文字
  function gainItem(item) {
    if (S.hasEmptySlot(profile.equip, item)) { S.equipInto(profile.equip, item); return S.t('（已裝備）'); }
    if (profile.items.length >= S.BAG_SIZE) {
      var gain = S.itemSellPrice(item);
      profile.gold += gain;
      return S.t('（背包已滿，自動賣出 +') + gain + S.t(' 金）');
    }
    profile.items.push(item);
    return '';
  }

  function renderEquipBox() {
    var sets = S.setStatus(profile.equip);
    return S.t('<div class="box wide"><h3>裝備 <small>') +
        S.QUALITY_KEYS.map(function (q) { return '<span class="q-' + q + '">' + S.QUALITIES[q].name + '</span>'; }).join(' ') +
      '</small></h3>' +
      '<div class="equip-slots doll">' + S.EQUIP_SLOT_KEYS.map(function (slot) {   // 仿暗黑 2 的人形配置
        var item = profile.equip[slot];
        return '<div class="slot s-' + slot + (item ? ' q-' + item.q + '-border' : '') + '"><span class="slot-name">' + S.EQUIP_SLOTS[slot] + '</span>' +
          (item ? itemLine(item, '<button data-unequip="' + slot + S.t('">卸下</button>')) : S.t('<span class="muted">（空）</span>')) + '</div>';
      }).join('') + '</div>' +
      sets.map(function (s) {
        return S.t('<p class="set-status q-set">套裝「') + s.name + S.t('」') + s.count + '/' + s.total + S.t('：') +
          s.bonus.map(function (b) {
            return '<span class="' + (b.active ? 'on' : 'off') + '">' + b.n + S.t(' 件 ') + S.statLines(b.stats).join(S.t('、')) + '</span>';
          }).join(S.t('　')) + '</p>';
      }).join('') +
      S.t('<h4>背包 <small>') + profile.items.length + ' / ' + S.BAG_SIZE + S.t(' 件</small></h4>') +
      renderBagTools() +
      renderBagList(true) +
      '</div>';
  }
  // 背包清單：主將分頁可以裝備 + 賣出；商店分頁只賣出
  function renderBagList(canEquip) {
    return profile.items.length ? bagView().map(function (i) {
      var item = profile.items[i];
      return itemLine(item, (canEquip ? '<button data-equip="' + i + S.t('">裝備</button>') : '') +
        '<button data-sellitem="' + i + S.t('">賣出<small>') + S.itemSellPrice(item) + S.t(' 金</small></button>'), compare(item));
    }).join('') || S.t('<p class="hint">這個部位沒有裝備</p>') : S.t('<p class="hint">還沒有裝備。打贏戰鬥會掉落裝備，也可以到「商店」購買</p>');
  }
  function renderShop() {
    return S.t('<div class="box wide"><h3>商店 <small>物品等級 ') + shopLevel() + S.t('，每場戰鬥後進新貨</small></h3>') +
      (profile.shop.length ? profile.shop.map(function (item, i) {
        var price = S.itemValue(item);
        return itemLine(item, '<button data-buyitem="' + i + '"' + (profile.gold < price ? ' disabled' : '') + S.t('>購買<small>') +
          price + S.t(' 金</small></button>'), compare(item));
      }).join('') : S.t('<p class="hint">貨架空了，打完下一場戰鬥會進新貨</p>')) +
      '</div>' +
      S.t('<div class="box wide"><h3>賣出 <small>背包 ') + profile.items.length + ' / ' + S.BAG_SIZE + S.t(' 件</small></h3>') +
      renderBagTools() + renderBagList(false) +
      '</div>';
  }

  // 背包：篩選 + 排序後要顯示的索引
  function bagView() {
    var idx = profile.items.map(function (it, i) { return i; }).filter(function (i) {
      return bagFilter === 'all' || S.itemInfo(profile.items[i]).slot === bagFilter;
    });
    if (bagSort === 'value') idx.sort(function (a, b) { return S.itemValue(profile.items[b]) - S.itemValue(profile.items[a]); });
    else if (bagSort === 'quality') idx.sort(function (a, b) {
      return S.QUALITY_KEYS.indexOf(profile.items[b].q) - S.QUALITY_KEYS.indexOf(profile.items[a].q) ||
        S.itemValue(profile.items[b]) - S.itemValue(profile.items[a]);
    });
    else idx.reverse();           // 最新撿到的在前面
    return idx;
  }
  function renderBagTools() {
    if (!profile.items.length) return '';
    var count = {};
    profile.items.forEach(function (it) { count[S.itemInfo(it).slot] = (count[S.itemInfo(it).slot] || 0) + 1; });
    var nNormal = profile.items.filter(function (it) { return it.q === 'normal'; }).length;
    var nMagic = profile.items.filter(function (it) { return it.q === 'magic'; }).length;
    return '<div class="bag-tools"><span class="bag-filter">' +
      [['all', S.t('全部'), profile.items.length]].concat(S.ITEM_SLOT_KEYS.map(function (k) { return [k, S.ITEM_SLOTS[k].split(S.t('・'))[0], count[k] || 0]; }))
        .map(function (f) {
          return '<button data-bagfilter="' + f[0] + '"' + (bagFilter === f[0] ? ' class="on"' : '') + (f[2] ? '' : ' disabled') + '>' +
            f[1] + '<small>' + f[2] + '</small></button>';
        }).join('') + '</span>' +
      S.t('<span class="bag-sort">排序 ') + [['new', S.t('最新')], ['value', S.t('價值')], ['quality', S.t('品質')]].map(function (o) {
        return '<button data-bagsort="' + o[0] + '"' + (bagSort === o[0] ? ' class="on"' : '') + '>' + o[1] + '</button>';
      }).join('') + '</span>' +
      '<span class="bag-sell"><button data-sellall="normal"' + (nNormal ? '' : ' disabled') + S.t('>賣出全部普通<small>') + nNormal + '</small></button>' +
      '<button data-sellall="magic"' + (nMagic ? '' : ' disabled') + S.t('>賣出全部魔法<small>') + nMagic + '</small></button></span></div>';
  }

  // ======================= 營舍 / 徵兵處 =======================
  function soldierLabel(sol) {
    return '<span class="sname q-' + sol.q + '">' + esc(S.soldierFullName(sol)) + '</span>';
  }
  function soldierSkillsText(sol) {
    return sol.skills.map(function (k) { return S.skillName(k.id) + (k.lv > 1 ? k.lv : ''); }).join(S.t('・'));
  }
  function soldierAffixText(sol) {
    return S.soldierAffixLines(sol).map(function (a) {
      return '<span class="aff-' + a.group + '">' + (a.group === 'unique' ? '' : S.t('【') + S.AFFIX_GROUPS[a.group] + S.t('】') + a.name + S.t('：')) + a.line + '</span>';
    }).join('');
  }
  function renderBarracks() {
    var picked = pickedId && findSoldier(pickedId);
    return S.t('<div class="box wide"><h3>營舍 <small>出戰 ') + activeCount() + ' / ' + C.MAX_UNITS + S.t('・共 ') + profile.soldiers.length + ' / ' + BARRACKS + S.t(' 人</small></h3>') +
      '<div class="cards">' + profile.soldiers.map(function (sol) {
        var st = S.soldierStats(sol);
        return '<div class="card' + (sol.active ? ' active' : '') + (picked === sol ? ' picked' : '') + ' q-' + sol.q + '-border" data-pick="' + sol.id + '">' +
          soldierLabel(sol) +
          '<span class="cmeta">' + className(sol) + S.t('　Lv') + sol.lv + (sol.sp ? S.t('　<b class="sp">技能點 ') + sol.sp + '</b>' : '') + '</span>' +
          S.t('<span class="cstat">兵 ') + st.hp + S.t('　攻 ') + st.atk + S.t('　防 ') + st.def + S.t('　智 ') + st.int + '</span>' +
          '<span class="cskill">' + soldierSkillsText(sol) + '</span>' +
          '<button data-active="' + sol.id + '" class="' + (sol.active ? 'on' : '') + '"' +
            (!sol.active && activeCount() >= C.MAX_UNITS ? S.t(' disabled title="出戰已滿 9 隊"') : '') + '>' + (sol.active ? S.t('出戰中') : S.t('休息中')) + '</button>' +
          '</div>';
      }).join('') + '</div>' +
      (picked ? renderSoldierDetail(picked) : S.t('<p class="hint">點選士兵查看技能、升級與裝備</p>')) +
      '</div>';
  }
  function renderSoldierDetail(sol) {
    var st = S.soldierStats(sol), cost = S.soldierLevelCost(sol.lv), maxLv = sol.lv >= S.LEVEL.MAX;
    var fits = profile.items.map(function (it, i) { return i; }).filter(function (i) {
      return S.SOLDIER_EQUIP[S.itemInfo(profile.items[i]).slot];
    }).sort(function (a, b) { return S.itemValue(profile.items[b]) - S.itemValue(profile.items[a]); }).slice(0, 8);
    return '<div class="sdetail">' +
      '<div class="shead">' + soldierLabel(sol) + '<span class="muted">' + S.SOLDIER_QUALITIES[sol.q].name + S.t('・') + className(sol) +
        S.t('　Lv') + sol.lv + '</span>' +
        '<button data-solv="' + sol.id + '"' + (maxLv || profile.exp < cost ? ' disabled' : '') + '>' +
          (maxLv ? S.t('已達上限') : 'Lv▲<small>' + cost + S.t(' 經驗</small>')) + '</button>' +
        '<button data-dismiss="' + sol.id + '" class="danger"' + (profile.soldiers.length <= 1 ? ' disabled' : '') + S.t('>解僱</button></div>') +
      S.t('<div class="sstats">兵力 ') + st.hp + S.t('　MP ') + st.mp + S.t('　攻擊 ') + st.atk + S.t('　防禦 ') + st.def + S.t('　智力 ') + st.int + S.t('　精神 ') + st.spr +
        (st.ranged ? S.t('　射程 ') + st.range : '') +
        (Object.keys(st.procs).some(function (k) { return st.procs[k]; }) ? S.t('　<span class="aff-infix">') + S.statLines(st.procs).join(S.t('、')) + '</span>' : '') + '</div>' +
      (S.soldierAffixLines(sol).length ? '<div class="iaff">' + soldierAffixText(sol) + '</div>' : '') +
      S.t('<h4>技能 <small>每升一級得到 1 點技能點（目前 ') + sol.sp + S.t(' 點），技能最高 ') + S.SKILL_MAX + S.t(' 級</small></h4>') +
      '<div class="skills">' + sol.skills.map(function (k, i) {
        var passive = !!S.PASSIVES[k.id];
        return '<div class="skill' + (passive ? ' passive' : '') + '"><b>' + S.skillName(k.id) + '</b> Lv' + k.lv +
          '<small>' + (passive ? S.t('被動・') : '') + S.skillDesc(k.id, k.lv) + '</small>' +
          '<button data-skill="' + i + '"' + (!sol.sp || k.lv >= S.SKILL_MAX ? ' disabled' : '') + '>▲</button></div>';
      }).join('') + '</div>' +
      S.t('<h4>裝備 <small>武力→攻擊、體力→兵力、智力→智力、統率→防禦 / 精神；開戰軍令等主將專用屬性對士兵無效</small></h4>') +
      '<div class="sequip">' + S.SOLDIER_EQUIP_KEYS.map(function (slot) {
        var it = sol.equip[slot];
        return '<div class="slot">' + '<span class="slot-name">' + S.SOLDIER_EQUIP[slot] + '</span>' +
          (it ? itemLine(it, '<button data-sunequip="' + slot + S.t('">卸下</button>')) : S.t('<span class="muted">（空）</span>')) + '</div>';
      }).join('') + '</div>' +
      (fits.length ? S.t('<h4>倉庫裡可以裝備的 <small>依價值排序，前 8 件</small></h4>') + fits.map(function (i) {
        return itemLine(profile.items[i], '<button data-sequip="' + i + S.t('">裝備</button>'));
      }).join('') : '') +
      '</div>';
  }
  function rerollCost() { return 30 + shopLevel() * 15; }
  function renderRecruits() {
    var full = profile.soldiers.length >= BARRACKS;
    return S.t('<div class="box wide"><h3>酒館 <small>招募士兵，每場戰鬥後換一批人') + (full ? S.t('・營舍已滿') : '') + '</small>' +
      '<button data-reroll="1" class="reroll"' + (profile.gold < rerollCost() ? ' disabled' : '') + S.t('>🍶 換一批<small>') + rerollCost() + S.t(' 金</small></button></h3>') +
      (profile.recruits.length ? profile.recruits.map(function (sol, i) {
        var price = S.soldierPrice(sol), st = S.soldierStats(sol);
        return '<div class="item recruit">' + soldierLabel(sol) +
          '<span class="itag">' + S.SOLDIER_QUALITIES[sol.q].name + S.t('・') + className(sol) + S.t('・Lv') + sol.lv + '</span>' +
          S.t('<span class="idesc">兵 ') + st.hp + S.t('　攻 ') + st.atk + S.t('　防 ') + st.def + S.t('　智 ') + st.int + S.t('　技能：') + soldierSkillsText(sol) + '</span>' +
          '<span class="ibtns"><button data-hire="' + i + '"' + (full || profile.gold < price ? ' disabled' : '') + S.t('>招募<small>') + price + S.t(' 金</small></button></span>') +
          (S.soldierAffixLines(sol).length ? '<span class="iaff">' + soldierAffixText(sol) + '</span>' : '') + '</div>';
      }).join('') : S.t('<p class="hint">今天酒館裡沒有人想從軍，下次再來吧</p>')) +
      '</div>';
  }

  function preview() {
    var st = S.STAGES[stageIdx];
    S.game.setup([playerArmy(), enemyArmy(st)], [playerLevels(), S.stageLevels(st, diffKey())], null, battleOpts(stageIdx));
    S.game.setCaption({ title: stageLabel(stageIdx), sub: 'vs ' + st.general.name + S.t('　按「出征」開戰') });
  }

  function renderCamp() {
    show('camp');
    var g = profile.general;
    var army = playerArmy();          // 含裝備加成

    campEl.innerHTML =
      '<div class="camp-head">' +
        '<div class="gen"><b>' + esc(g.name) + '</b> ' + S.STAT_KEYS.map(function (k) {
          var plus = army[k] - g[k];
          return '<span>' + S.STAT_NAMES[k] + ' ' + army[k] + (plus ? '<small class="plus">(+' + plus + ')</small>' : '') + '</span>';
        }).join('') + '</div>' +
        (S.PROC_KEYS.some(function (k) { return army.procs[k]; }) ?
          S.t('<div class="procs">特效：') + S.statLines(army.procs).join(S.t('、')) + '</div>' : '') +
        '<div class="res"><span class="gold">💰 ' + profile.gold + S.t(' 金</span>') +
          '<span class="exp">⭐ ' + profile.exp + S.t(' 經驗</span>') +
          S.t('<span class="muted">戰績 ') + profile.stats.wins + S.t('勝 ') + profile.stats.losses + S.t('敗</span></div>') +
      '</div>' +
      (campMsg ? '<p class="msg">' + esc(campMsg) + '</p>' : '') +
      '<nav class="camp-tabs">' + CAMP_TABS.map(function (t) {
        return '<button data-tab="' + t[0] + '"' + (t[0] === campTab ? ' class="on"' : '') + '>' + t[1] + tabBadge(t[0]) + '</button>';
      }).join('') + '</nav>' +
      '<div class="camp-page">' + renderTab() + '</div>' +
      S.t('<div class="camp-foot"><button id="btn-reset" class="danger">重新建立武將</button></div>');

    if (campTab === 'go') preview();
  }

  // 分頁上的提示：可以升級 / 有技能點 / 有新的人或貨
  function tabBadge(tab) {
    var g = profile.general, n = 0;
    if (tab === 'general') n = S.STAT_KEYS.some(function (k) { return g[k] < C.STAT_MAX && profile.exp >= S.statCost(g[k]); }) ? '▲' : 0;
    if (tab === 'barracks') n = profile.soldiers.reduce(function (s, sol) { return s + (sol.sp || 0); }, 0);
    if (tab === 'tavern') n = profile.recruits.length;
    if (tab === 'shop') n = profile.shop.length;
    return n ? '<small class="badge' + (tab === 'general' || tab === 'barracks' ? ' hot' : '') + '">' + n + '</small>' : '';
  }

  function renderTab() {
    var g = profile.general, st = S.STAGES[stageIdx];
    var first = stageIdx >= clr();
    var rate = (first ? 1 : C.REPLAY_RATE) * D().reward;
    if (campTab === 'general') {
      return '<div class="camp-cols">' +
        S.t('<div class="box"><h3>主將能力 <small>用經驗值（目前 ') + profile.exp + S.t('）</small></h3>') +
          '<table class="ups"><tbody>' +
          S.STAT_KEYS.map(function (k) {
            var max = g[k] >= C.STAT_MAX, cost = S.statCost(g[k]);
            return '<tr><th>' + S.STAT_NAMES[k] + '</th><td>' + g[k] + '</td><td>' +
              '<button data-up="' + k + '"' + (max || profile.exp < cost ? ' disabled' : '') +
              ' title="' + STAT_DESC[k] + '">' + (max ? S.t('已達上限') : '+' + C.STAT_STEP + '<small>' + cost + S.t(' 經驗</small>')) +
              '</button></td></tr>';
          }).join('') +
          '</tbody></table>' +
          S.t('<p class="hint">士兵的等級與技能在「營舍」裡各自提升</p>') +
        '</div>' +
        renderEquipBox() +
      '</div>';
    }
    if (campTab === 'barracks') return '<div class="camp-cols">' + renderBarracks() + '</div>';
    if (campTab === 'tavern') return '<div class="camp-cols">' + renderRecruits() + '</div>';
    if (campTab === 'shop') return '<div class="camp-cols">' + renderShop() + '</div>';
    return '<div class="diffs">' + S.DIFFICULTY_KEYS.map(function (k, i) {
        var dd = S.DIFFICULTIES[k], open = diffUnlocked(k);
        return '<button class="diff' + (k === diffKey() ? ' selected' : '') + '" data-diff="' + k + '"' + (open ? '' : ' disabled') +
          ' style="--dc:' + dd.color + '" title="' + (open ? S.t('敵軍 +') + dd.lv + S.t(' 級、物品等級 +') + dd.ilvl + S.t('、獎勵 ×') + dd.reward :
          S.t('全破') + S.DIFFICULTIES[S.DIFFICULTY_KEYS[i - 1]].name + S.t('難度後解鎖')) + '">' +
          (open ? '' : '🔒 ') + dd.name + '<small>' + (profile.clearedBy[k] || 0) + '/' + S.STAGES.length + '</small></button>';
      }).join('') + '</div>' +
      S.t('<h3>關卡 <small>') + D().name + S.t('難度　已通過 ') + clr() + ' / ' + S.STAGES.length +
        (D().lv ? S.t('　敵軍 +') + D().lv + S.t(' 級・獎勵 ×') + D().reward : '') + '</small></h3>' +
      '<div class="stages">' + S.STAGES.map(function (s, i) {
        var locked = i > clr();
        var cls = 'stage' + (i < clr() ? ' cleared' : '') + (i === stageIdx ? ' selected' : '');
        return '<button class="' + cls + '" data-stage="' + i + '"' + (locked ? ' disabled' : '') + '>' +
          (locked ? '🔒 ' : i < clr() ? '✔ ' : '') + (i + 1) + '. ' + s.title +
          '<small>' + s.general.name + '</small></button>';
      }).join('') + '</div>' +
      '<div class="stage-info">' +
        '<div><b>' + stageLabel(stageIdx) + S.t('</b>　敵將 ') + st.general.name +
          S.t('（') + S.STAT_KEYS.map(function (k) { return S.STAT_NAMES[k] + st.general[k]; }).join(' ') + S.t('）<br>') +
          S.t('敵軍 ') + S.UNIT_KINDS.concat(S.ENEMY_KINDS).map(function (k) {
            var n = st.units.filter(function (t) { return t === k; }).length;
            return n ? unitName(k) + '×' + n : '';
          }).filter(Boolean).join(' ') + (levelText(st) ? S.t('　') + levelText(st) : '') + '<br>' +
          S.t('獎勵 💰 ') + Math.round(st.gold * rate) + S.t(' 金 ⭐ ') + Math.round(st.exp * rate) + S.t(' 經驗') +
          S.t('　🎁 隨機裝備') + (first && st.drops ? S.t('＋') + st.drops.map(function (dr) {
            if (dr.unique) return '<span class="q-unique">' + S.UNIQUES[dr.unique].name + '</span>';
            if (dr.set) return '<span class="q-set">' + S.SET_ITEMS[dr.set].name + '</span>';
            return '<span class="q-' + dr.quality + '">' + S.QUALITIES[dr.quality].name + S.t('裝備</span>');
          }).join(S.t('、')) : '') +
          (first ? '' : S.t('<small>（重打 ') + Math.round(C.REPLAY_RATE * 100) + S.t('%）</small>')) +
        '</div>' +
        S.t('<div class="go-btns"><button id="btn-go" class="primary big" title="一場定勝負的會戰">⚔ 出征</button>') +
          S.t('<button id="btn-explore" class="primary big explore" title="在 20 倍大的地圖上四處探索、擊破敵營、開寶箱，最後打倒敵將">🗺 探索</button>') +
          S.t('<small>探索：獎勵 ×') + S.EXPLORE.REWARD_MULT + S.t('，途中撿到的裝備都能帶走</small></div>') +
      '</div>';
  }

  campEl.addEventListener('click', function (e) {
    if (view !== 'camp' || !profile) return;
    var b = e.target.closest('button') || e.target.closest('[data-pick]');
    if (!b || b.disabled) return;
    var d = b.dataset, C2 = C;
    if (d.tab) {
      if (d.tab === campTab) return;
      campTab = d.tab;
      try { localStorage.setItem('sango.campTab', campTab); } catch (err) { /* 存不了就算了 */ }
      campMsg = '';
      sfx('click');
    } else if (d.diff) {
      if (!diffUnlocked(d.diff) || d.diff === diffKey()) return;
      profile.difficulty = d.diff;
      stageIdx = Math.min(clr(), S.STAGES.length - 1);
      restock();
      campMsg = S.t('切換到') + D().name + S.t('難度：敵軍 +') + D().lv + S.t(' 級，掉落的物品等級 +') + D().ilvl + S.t('，獎勵 ×') + D().reward;
      save();
    } else if (d.stage != null) {
      stageIdx = Number(d.stage);
      campMsg = '';
    } else if (d.reroll) {
      if (profile.gold < rerollCost()) return;
      profile.gold -= rerollCost();
      profile.recruits = S.rollRecruits(shopLevel(), RECRUITS);
      campMsg = S.t('酒館來了一批新面孔');
      sfx('coin');
      save();
    } else if (d.hire != null) {
      var rec = profile.recruits[Number(d.hire)], price = rec && S.soldierPrice(rec);
      if (!rec || profile.gold < price || profile.soldiers.length >= BARRACKS) return;
      profile.gold -= price;
      profile.recruits.splice(Number(d.hire), 1);
      rec.active = activeCount() < C2.MAX_UNITS;
      profile.soldiers.push(rec);
      pickedId = rec.id;
      campMsg = S.t('招募了') + className(rec) + ' ' + S.soldierFullName(rec) + (rec.active ? S.t('（出戰）') : S.t('（營舍待命）'));
      sfx(rec.q === 'unique' ? 'loot_unique' : 'coin');
      save();
    } else if (d.active) {
      var sa = findSoldier(d.active);
      if (!sa) return;
      if (!sa.active && activeCount() >= C2.MAX_UNITS) return;
      if (sa.active && activeCount() <= 1) { campMsg = S.t('至少要有一隊士兵出戰'); renderCamp(); return; }
      sa.active = !sa.active;
      campMsg = S.soldierFullName(sa) + (sa.active ? S.t(' 出戰') : S.t(' 回營舍休息'));
      save();
    } else if (d.solv) {
      var sl = findSoldier(d.solv), lc = sl && S.soldierLevelCost(sl.lv);
      if (!sl || profile.exp < lc || sl.lv >= S.LEVEL.MAX) return;
      profile.exp -= lc;
      sl.lv++;
      sl.sp++;
      campMsg = S.soldierFullName(sl) + S.t(' 升到 Lv') + sl.lv + S.t('，得到 1 點技能點');
      sfx('levelup');
      save();
    } else if (d.skill != null) {
      var sk = findSoldier(pickedId), skill = sk && sk.skills[Number(d.skill)];
      if (!skill || !sk.sp || skill.lv >= S.SKILL_MAX) return;
      sk.sp--;
      skill.lv++;
      campMsg = S.soldierFullName(sk) + S.t(' 的「') + S.skillName(skill.id) + S.t('」提升到 ') + skill.lv + S.t(' 級');
      sfx('levelup');
      save();
    } else if (d.sequip != null) {
      var se = findSoldier(pickedId), sit = profile.items[Number(d.sequip)];
      var sslot = sit && S.itemInfo(sit).slot;
      if (!se || !S.SOLDIER_EQUIP[sslot]) return;
      profile.items.splice(Number(d.sequip), 1);
      if (se.equip[sslot]) profile.items.push(se.equip[sslot]);
      se.equip[sslot] = sit;
      campMsg = S.soldierFullName(se) + S.t(' 裝備了') + S.itemInfo(sit).name;
      sfx('equip');
      save();
    } else if (d.sunequip) {
      var su = findSoldier(pickedId);
      if (!su || !su.equip[d.sunequip]) return;
      if (profile.items.length >= S.BAG_SIZE) { campMsg = S.t('倉庫已滿，無法卸下'); renderCamp(); return; }
      profile.items.push(su.equip[d.sunequip]);
      su.equip[d.sunequip] = null;
      campMsg = S.soldierFullName(su) + S.t(' 卸下了裝備');
      sfx('equip');
      save();
    } else if (d.dismiss) {
      var sd = findSoldier(d.dismiss);
      if (!sd || profile.soldiers.length <= 1) return;
      var refund = Math.floor(S.soldierPrice(sd) * 0.3);
      if (!window.confirm(S.t('解僱 ') + S.soldierFullName(sd) + S.t('？退回 ') + refund + S.t(' 金，身上的裝備會放回倉庫'))) return;
      S.SOLDIER_EQUIP_KEYS.forEach(function (k) { if (sd.equip[k]) profile.items.push(sd.equip[k]); });
      profile.soldiers.splice(profile.soldiers.indexOf(sd), 1);
      if (!activeCount()) profile.soldiers[0].active = true;
      profile.gold += refund;
      pickedId = null;
      campMsg = S.t('解僱了 ') + S.soldierFullName(sd) + S.t('，退回 ') + refund + S.t(' 金');
      sfx('coin');
      save();
    } else if (d.pick) {
      pickedId = pickedId === d.pick ? null : d.pick;
    } else if (d.up) {
      var sc = S.statCost(profile.general[d.up]);
      if (profile.exp < sc || profile.general[d.up] >= C2.STAT_MAX) return;
      profile.exp -= sc;
      profile.general[d.up] = Math.min(C2.STAT_MAX, profile.general[d.up] + C2.STAT_STEP);
      campMsg = S.STAT_NAMES[d.up] + S.t(' 提升到 ') + profile.general[d.up];
      sfx('levelup');
      save();
    } else if (d.bagfilter) {
      bagFilter = d.bagfilter;
    } else if (d.bagsort) {
      bagSort = d.bagsort;
    } else if (d.sellall) {
      var list = profile.items.filter(function (it) { return it.q === d.sellall; });
      var total = list.reduce(function (sum, it) { return sum + S.itemSellPrice(it); }, 0);
      if (!list.length || !window.confirm(S.t('賣掉背包裡全部 ') + list.length + S.t(' 件') + S.QUALITIES[d.sellall].name + S.t('裝備，獲得 ') + total + S.t(' 金？'))) return;
      profile.items = profile.items.filter(function (it) { return it.q !== d.sellall; });
      profile.gold += total;
      campMsg = S.t('賣掉 ') + list.length + S.t(' 件') + S.QUALITIES[d.sellall].name + S.t('裝備，獲得 ') + total + S.t(' 金');
      sfx('coin');
      save();
    } else if (d.buyitem != null) {
      var bi = profile.shop[Number(d.buyitem)], price = bi && S.itemValue(bi);
      if (!bi || profile.gold < price) return;
      if (profile.items.length >= S.BAG_SIZE && !S.hasEmptySlot(profile.equip, bi)) { campMsg = S.t('背包已滿，先賣掉一些裝備吧'); renderCamp(); return; }
      profile.gold -= price;
      profile.shop.splice(Number(d.buyitem), 1);
      campMsg = S.t('購買了') + S.itemInfo(bi).name + gainItem(bi);
      sfx('coin');
      save();
    } else if (d.equip != null) {
      var ei = profile.items[Number(d.equip)];
      equipItem(Number(d.equip));
      campMsg = S.t('裝備了') + S.itemInfo(ei).name;
      sfx('equip');
      save();
    } else if (d.unequip) {
      var ui = profile.equip[d.unequip];
      if (!ui) return;
      if (profile.items.length >= S.BAG_SIZE) { campMsg = S.t('背包已滿，無法卸下'); renderCamp(); return; }
      profile.items.push(ui);
      profile.equip[d.unequip] = null;
      campMsg = S.t('卸下了') + S.itemInfo(ui).name;
      sfx('equip');
      save();
    } else if (d.sellitem != null) {
      var si = profile.items[Number(d.sellitem)], gain = S.itemSellPrice(si), sname = S.itemInfo(si).name;
      if (si.q !== 'normal' && !window.confirm(S.t('賣掉「') + sname + S.t('」，獲得 ') + gain + S.t(' 金？'))) return;
      profile.items.splice(Number(d.sellitem), 1);
      profile.gold += gain;
      campMsg = S.t('賣掉') + sname + S.t('，獲得 ') + gain + S.t(' 金');
      sfx('coin');
      save();
    } else if (b.id === 'btn-go') {
      exploring = false;
      startBattle();
      return;
    } else if (b.id === 'btn-explore') {
      startExplore();
      return;
    } else if (b.id === 'btn-reset') {
      if (!window.confirm(S.t('確定要刪除「') + profile.general.name + S.t('」和所有進度，重新建立武將嗎？'))) return;
      profile = null;
      S.store.save(null).catch(function () {});
      renderCreate();
      return;
    } else {
      return;
    }
    renderCamp();
  });

  // ======================= 出征與結算 =======================
  var exploring = false;          // 這場是探索模式

  function startExplore() {
    var st = S.STAGES[stageIdx];
    exploring = true;
    S.game.setup([playerArmy(), enemyArmy(st)], [playerLevels(), S.stageLevels(st, diffKey())],
                 S.makeExplore(stageIdx, null, diffKey()), battleOpts(stageIdx));
    S.game.setCaption(null);
    startBattle();
  }

  function startBattle() {
    show('battle');
    S.game.start();
    fieldEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // 被收服的流浪武者加入營舍 (營舍滿了就只能讓他離開)；回傳說明 [{ sol, joined }]
  function takeRecruits() {
    return S.game.getRecruited().map(function (sol) {
      if (profile.soldiers.length >= BARRACKS) return { sol: sol, joined: false };
      sol.active = activeCount() < C.MAX_UNITS;
      profile.soldiers.push(sol);
      return { sol: sol, joined: true };
    });
  }
  function recruitText(list) {
    return list.map(function (r) {
      return '<span class="sname q-' + r.sol.q + '">' + esc(S.soldierFullName(r.sol)) + S.t('</span>（') + className(r.sol) + ' Lv' + r.sol.lv + S.t('）') +
        (r.joined ? (r.sol.active ? S.t('加入並出戰') : S.t('加入營舍')) : S.t('<span class="muted">營舍已滿，只好讓他離開</span>'));
    }).join(S.t('、'));
  }

  S.game.onRetreat = function () {
    S.game.stop();
    if (exploring) {              // 探索模式撤退：撿到的裝備可以帶回來
      var found = S.game.getLoot();
      found.forEach(gainItem);
      var joined = takeRecruits().filter(function (r) { return r.joined; });
      campMsg = S.t('已撤退') + (found.length ? S.t('，帶回 ') + found.length + S.t(' 件裝備') : S.t('，這次沒有撿到裝備')) +
        (joined.length ? S.t('；') + joined.map(function (r) { return S.soldierFullName(r.sol); }).join(S.t('、')) + S.t(' 加入了營舍') : '');
      save();
    } else {
      campMsg = S.t('已撤退，這場戰鬥沒有獎勵');
    }
    renderCamp();
  };

  S.game.onSettings = function () {
    if (!profile) return;
    profile.settings = S.game.getSettings();
    save();
  };

  S.game.onOver = function (winner) {
    if (!profile || view !== 'battle') return;
    S.game.stop();                // 收起暫停 / 撤退與計策列，戰場停在結束畫面
    var st = S.STAGES[stageIdx];
    var first = stageIdx >= clr();
    var win = winner === 0;
    var gold = 0, exp, note;
    var mult = (exploring ? S.EXPLORE.REWARD_MULT : 1) * D().reward;
    var expBonus = S.game.getExpBonus();   // 經驗壇
    if (win) {
      var rate = (first ? 1 : C.REPLAY_RATE) * mult;
      gold = Math.round(st.gold * rate * (1 + playerArmy().procs.gf / 100));   // 聚財
      exp = Math.round(st.exp * rate * (1 + expBonus));
      note = (first ? S.t('首次過關') : S.t('重打獎勵 ') + Math.round(C.REPLAY_RATE * 100) + '%') + (exploring ? S.t('・探索 ×') + S.EXPLORE.REWARD_MULT : '') +
        (D().reward > 1 ? S.t('・') + D().name + ' ×' + D().reward : '') + (expBonus ? S.t('・經驗壇 +') + Math.round(expBonus * 100) + '%' : '');
      profile.stats.wins++;
      if (first) setClr(stageIdx + 1);
    } else {
      exp = Math.round(st.exp * C.LOSS_EXP_RATE * D().reward * (1 + expBonus));
      note = (winner < 0 ? S.t('平手視為未過關') : S.t('戰敗')) + S.t('，仍獲得部分經驗');
      profile.stats.losses++;
    }
    profile.gold += gold;
    profile.exp += exp;
    // 戰利品：一般出征打贏掉落一件隨機裝備；探索模式是途中撿到的裝備 (輸了也能帶走)；首次過關另有關卡指定的裝備
    // 一般出征：打贏才拿得到 (含精英掉落)；探索模式：撿到的都能帶走
    var loot = exploring ? S.game.getLoot().slice() : win ? [S.rollLoot(stageIlvl(stageIdx), playerArmy().procs.mf)].concat(S.game.getLoot()) : [];
    if (win && first) (st.drops || []).forEach(function (dr) { loot.push(S.makeItem(Object.assign({ ilvl: stageIlvl(stageIdx) }, dr))); });
    var lootNotes = loot.map(gainItem);
    var newcomers = takeRecruits();   // 探索中收服的流浪武者
    // 結算音效：勝利 / 敗北，接著是戰利品中最好的品質
    sfx(win ? 'win' : 'lose');
    var bestQ = -1;
    loot.forEach(function (it) { bestQ = Math.max(bestQ, S.QUALITY_KEYS.indexOf(S.itemInfo(it).q)); });
    if (bestQ >= 0) sfx('loot_' + S.QUALITY_KEYS[bestQ], 1300);
    restock();
    save();

    var unlock = '';
    if (win && first) {
      var nextDiff = S.DIFFICULTY_KEYS[S.DIFFICULTY_KEYS.indexOf(diffKey()) + 1];
      unlock = clr() < S.STAGES.length ? S.t('🔓 解鎖') + stageLabel(clr()) :
        nextDiff ? '🏆 ' + D().name + S.t('難度制霸！🔓 解鎖') + S.DIFFICULTIES[nextDiff].name + S.t('難度：敵人更強，掉落更好的裝備') :
        S.t('🏆 恭喜！地獄難度全部制霸，天下無敵！');
    }
    show('result');
    resultEl.innerHTML =
      '<h2 class="' + (win ? 'win' : 'lose') + '">' + (win ? S.t('勝利！') : winner < 0 ? S.t('平手') : S.t('敗北…')) + '</h2>' +
      '<p>' + stageLabel(stageIdx) + S.t('　vs ') + st.general.name + '</p>' +
      '<p class="reward">' + (gold ? '💰 +' + gold + S.t(' 金　') : '') + '⭐ +' + exp + S.t(' 經驗 <small>（') + note + S.t('）</small></p>') +
      (loot.length ? S.t('<div class="loot"><b>🎁 戰利品</b>') + loot.map(function (item, i) {
        return itemLine(item, '', lootNotes[i] ? ' <small>' + lootNotes[i] + '</small>' : '');
      }).join('') + '</div>' : '') +
      (newcomers.length ? '<p class="newcomer">🤝 ' + recruitText(newcomers) + '</p>' : '') +
      (unlock ? '<p class="unlock">' + unlock + '</p>' : '') +
      (win ? '' : S.t('<p class="hint">回營地招募士兵、升級士兵與技能、換裝備後再挑戰吧</p>')) +
      S.t('<div class="cr-row"><button id="btn-camp" class="primary">回營地</button>') +
      S.t('<button id="btn-again">再戰一次</button></div>');
    document.getElementById('btn-camp').addEventListener('click', function () {
      S.game.stop();
      if (win && first && clr() < S.STAGES.length) stageIdx = clr();
      campMsg = '';
      renderCamp();
    });
    document.getElementById('btn-again').addEventListener('click', function () {
      if (exploring) { startExplore(); return; }
      preview();
      startBattle();
    });
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ======================= 啟動 =======================
  S.store.onChange = loadProfile;
  S.store.ready.then(loadProfile);
})(window.Sango);
