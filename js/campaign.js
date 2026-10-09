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
  var SHORT = { spear: '槍', archer: '弓', cavalry: '騎' };
  var BEARDS = [['', '無'], ['#282018', '黑'], ['#6a4020', '棕'], ['#c8c8c8', '白']];
  var STAT_DESC = {
    hp: '主將兵力',
    war: '主將攻擊、鼓舞效果',
    int: '主將魔法、火計 / 落雷傷害',
    lead: '主將防禦、全軍士兵防禦、堅守效果'
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
  function sortSoldiers() {
    profile.soldiers.sort(function (a, b) { return S.UNIT_KINDS.indexOf(a) - S.UNIT_KINDS.indexOf(b); });
  }

  function save() {
    return S.store.save(profile).catch(function () {});
  }

  function show(v) {
    view = v;
    createEl.hidden = v !== 'create';
    campEl.hidden = v !== 'camp';
    resultEl.hidden = v !== 'result';
    fieldEl.hidden = v === 'create' || v == null;
  }

  // ======================= 讀取進度 =======================
  function loadProfile() {
    S.game.stop();
    show(null);
    return S.store.load().then(function (p) {
      profile = p;
      if (!profile) { renderCreate(); return; }
      // 舊資料補齊欄位
      profile.levels = Object.assign({ spear: 0, archer: 0, cavalry: 0 }, profile.levels);
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
      if (!profile.shop.length) restock();
      save();                     // 把轉換後的新格式存回去
      S.game.applySettings(profile.settings);
      stageIdx = Math.min(clr(), S.STAGES.length - 1);
      campMsg = '';
      renderCamp();
    }).catch(function (err) {
      profile = null;
      show(null);
      campEl.hidden = false;
      campEl.innerHTML = '<p class="msg error">讀取進度失敗：' + esc((err && err.message) || err) +
        '</p><button id="btn-reload">重試</button>';
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
      '<h2>建立你的武將</h2>' +
      '<div class="cr-row">' +
        '<label>名字 <input id="cr-name" maxlength="8" placeholder="例如：趙雲"></label>' +
        '<label>鬍子 <select id="cr-beard">' + BEARDS.map(function (b) {
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
      '<p>剩餘點數 <b id="cr-left"></b>　<small>（每項 ' + cr.MIN + '–' + cr.MAX + '）</small></p>' +
      '<h3>初始士兵（' + C.START_UNITS + ' 隊）</h3>' +
      '<div class="cr-units">' + units.map(function (t, i) {
        return '<select data-unit="' + i + '">' + S.UNIT_KINDS.map(function (k) {
          return '<option value="' + k + '"' + (k === t ? ' selected' : '') + '>' + unitName(k) + '</option>';
        }).join('') + '</select>';
      }).join('') + '</div>' +
      '<p class="hint">槍兵 剋 騎兵 · 騎兵 剋 弓兵 · 弓兵 剋 槍兵</p>' +
      '<div class="cr-row"><button id="cr-random">🎲 隨機分配</button>' +
      '<button id="cr-ok" class="primary">確定，開始征戰</button></div>' +
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
        sel.value = S.UNIT_KINDS[(S.random() * 3) | 0];
      });
      refresh();
    });
    document.getElementById('cr-ok').addEventListener('click', function () {
      var name = document.getElementById('cr-name').value.trim();
      var msg = document.getElementById('cr-msg');
      if (!name) { msg.textContent = '請輸入武將名字'; return; }
      if (left() > 0) { msg.textContent = '還有 ' + left() + ' 點能力沒有分配'; return; }
      var soldiers = Array.prototype.map.call(createEl.querySelectorAll('[data-unit]'), function (sel) { return sel.value; });
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
      sortSoldiers();
      restock();
      stageIdx = 0;
      campMsg = name + ' 出陣！先從第 1 關開始吧';
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
    return '主將Lv' + lv.general + ' 槍Lv' + lv.spear + ' 弓Lv' + lv.archer + ' 騎Lv' + lv.cavalry;
  }
  function stageLabel(i) { return (diffKey() === 'normal' ? '' : '【' + D().name + '】') + '第 ' + (i + 1) + ' 關 ' + S.STAGES[i].title; }

  // ======================= 裝備 =======================
  var SHOP_SIZE = 9;                // 每個部位各一件
  var bagFilter = 'all', bagSort = 'new';   // 背包的篩選 / 排序
  function shopLevel() { return Math.min(S.MAX_ILVL, clr() + 1 + D().ilvl); }
  function restock() { profile.shop = S.rollShop(shopLevel(), SHOP_SIZE); }

  function itemName(item) {
    var info = S.itemInfo(item);
    return '<span class="iname q-' + info.q + '">' + esc(info.name) + '</span>';
  }
  // 一件裝備：名稱 (品質顏色)、品質 / 欄位、屬性
  function itemLine(item, buttons, extra) {
    var info = S.itemInfo(item);
    return '<div class="item">' + itemName(item) +
      '<span class="itag">' + S.QUALITIES[info.q].name + '・' + S.ITEM_SLOTS[info.slot] +
        (info.setId ? '・' + S.SETS[info.setId].name : '') + '</span>' +
      '<span class="idesc">' + info.lines.join('、') + (extra || '') + '</span>' +
      '<span class="ibtns">' + buttons + '</span>' +
      (info.affixes && info.affixes.length ? '<span class="iaff">' + info.affixes.map(function (a) {
        return '<span class="aff-' + a.group + '">【' + S.AFFIX_GROUPS[a.group] + '】' + a.name + '：' + a.line + '</span>';
      }).join('') + '</span>' : '') + '</div>';
  }
  // 和目前裝備比較 (估價高低；戒指和比較差的那枚比)
  function compare(item) {
    var cur = profile.equip[S.equipTarget(profile.equip, item)];
    if (!cur) return ' <small class="up">▲ 空欄</small>';
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
    if (S.hasEmptySlot(profile.equip, item)) { S.equipInto(profile.equip, item); return '（已裝備）'; }
    if (profile.items.length >= S.BAG_SIZE) {
      var gain = S.itemSellPrice(item);
      profile.gold += gain;
      return '（背包已滿，自動賣出 +' + gain + ' 金）';
    }
    profile.items.push(item);
    return '';
  }

  function renderEquipBox() {
    var sets = S.setStatus(profile.equip);
    return '<div class="box wide"><h3>裝備 <small>' +
        S.QUALITY_KEYS.map(function (q) { return '<span class="q-' + q + '">' + S.QUALITIES[q].name + '</span>'; }).join(' ') +
      '</small></h3>' +
      '<div class="equip-slots doll">' + S.EQUIP_SLOT_KEYS.map(function (slot) {   // 仿暗黑 2 的人形配置
        var item = profile.equip[slot];
        return '<div class="slot s-' + slot + (item ? ' q-' + item.q + '-border' : '') + '"><span class="slot-name">' + S.EQUIP_SLOTS[slot] + '</span>' +
          (item ? itemLine(item, '<button data-unequip="' + slot + '">卸下</button>') : '<span class="muted">（空）</span>') + '</div>';
      }).join('') + '</div>' +
      sets.map(function (s) {
        return '<p class="set-status q-set">套裝「' + s.name + '」' + s.count + '/' + s.total + '：' +
          s.bonus.map(function (b) {
            return '<span class="' + (b.active ? 'on' : 'off') + '">' + b.n + ' 件 ' + S.statLines(b.stats).join('、') + '</span>';
          }).join('　') + '</p>';
      }).join('') +
      '<h4>背包 <small>' + profile.items.length + ' / ' + S.BAG_SIZE + ' 件</small></h4>' +
      renderBagTools() +
      (profile.items.length ? bagView().map(function (i) {
        var item = profile.items[i];
        return itemLine(item, '<button data-equip="' + i + '">裝備</button>' +
          '<button data-sellitem="' + i + '">賣出<small>' + S.itemSellPrice(item) + ' 金</small></button>', compare(item));
      }).join('') || '<p class="hint">這個部位沒有裝備</p>' : '<p class="hint">還沒有裝備。打贏戰鬥會掉落裝備，也可以在下方商店購買</p>') +
      '<h4>商店 <small>物品等級 ' + shopLevel() + '，每場戰鬥後進新貨</small></h4>' +
      profile.shop.map(function (item, i) {
        var price = S.itemValue(item);
        return itemLine(item, '<button data-buyitem="' + i + '"' + (profile.gold < price ? ' disabled' : '') + '>購買<small>' +
          price + ' 金</small></button>', compare(item));
      }).join('') +
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
      [['all', '全部', profile.items.length]].concat(S.ITEM_SLOT_KEYS.map(function (k) { return [k, S.ITEM_SLOTS[k].split('・')[0], count[k] || 0]; }))
        .map(function (f) {
          return '<button data-bagfilter="' + f[0] + '"' + (bagFilter === f[0] ? ' class="on"' : '') + (f[2] ? '' : ' disabled') + '>' +
            f[1] + '<small>' + f[2] + '</small></button>';
        }).join('') + '</span>' +
      '<span class="bag-sort">排序 ' + [['new', '最新'], ['value', '價值'], ['quality', '品質']].map(function (o) {
        return '<button data-bagsort="' + o[0] + '"' + (bagSort === o[0] ? ' class="on"' : '') + '>' + o[1] + '</button>';
      }).join('') + '</span>' +
      '<span class="bag-sell"><button data-sellall="normal"' + (nNormal ? '' : ' disabled') + '>賣出全部普通<small>' + nNormal + '</small></button>' +
      '<button data-sellall="magic"' + (nMagic ? '' : ' disabled') + '>賣出全部魔法<small>' + nMagic + '</small></button></span></div>';
  }

  function preview() {
    var st = S.STAGES[stageIdx];
    S.game.setup([playerArmy(), enemyArmy(st)], [playerLevels(), S.stageLevels(st, diffKey())], null, battleOpts(stageIdx));
    S.game.setCaption({ title: stageLabel(stageIdx), sub: 'vs ' + st.general.name + '　按「出征」開戰' });
  }

  function renderCamp() {
    show('camp');
    var g = profile.general, st = S.STAGES[stageIdx];
    var first = stageIdx >= clr();
    var rate = (first ? 1 : C.REPLAY_RATE) * D().reward;
    var count = { spear: 0, archer: 0, cavalry: 0 };
    profile.soldiers.forEach(function (t) { count[t]++; });
    var full = profile.soldiers.length >= C.MAX_UNITS;
    var army = playerArmy();          // 含裝備加成

    campEl.innerHTML =
      '<div class="camp-head">' +
        '<div class="gen"><b>' + esc(g.name) + '</b> ' + S.STAT_KEYS.map(function (k) {
          var plus = army[k] - g[k];
          return '<span>' + S.STAT_NAMES[k] + ' ' + army[k] + (plus ? '<small class="plus">(+' + plus + ')</small>' : '') + '</span>';
        }).join('') + '</div>' +
        (S.PROC_KEYS.some(function (k) { return army.procs[k]; }) ?
          '<div class="procs">特效：' + S.statLines(army.procs).join('、') + '</div>' : '') +
        '<div class="res"><span class="gold">💰 ' + profile.gold + ' 金</span>' +
          '<span class="exp">⭐ ' + profile.exp + ' 經驗</span>' +
          '<span class="muted">戰績 ' + profile.stats.wins + '勝 ' + profile.stats.losses + '敗</span></div>' +
      '</div>' +
      (campMsg ? '<p class="msg">' + esc(campMsg) + '</p>' : '') +

      '<div class="diffs">' + S.DIFFICULTY_KEYS.map(function (k, i) {
        var dd = S.DIFFICULTIES[k], open = diffUnlocked(k);
        return '<button class="diff' + (k === diffKey() ? ' selected' : '') + '" data-diff="' + k + '"' + (open ? '' : ' disabled') +
          ' style="--dc:' + dd.color + '" title="' + (open ? '敵軍 +' + dd.lv + ' 級、物品等級 +' + dd.ilvl + '、獎勵 ×' + dd.reward :
          '全破' + S.DIFFICULTIES[S.DIFFICULTY_KEYS[i - 1]].name + '難度後解鎖') + '">' +
          (open ? '' : '🔒 ') + dd.name + '<small>' + (profile.clearedBy[k] || 0) + '/' + S.STAGES.length + '</small></button>';
      }).join('') + '</div>' +
      '<h3>關卡 <small>' + D().name + '難度　已通過 ' + clr() + ' / ' + S.STAGES.length +
        (D().lv ? '　敵軍 +' + D().lv + ' 級・獎勵 ×' + D().reward : '') + '</small></h3>' +
      '<div class="stages">' + S.STAGES.map(function (s, i) {
        var locked = i > clr();
        var cls = 'stage' + (i < clr() ? ' cleared' : '') + (i === stageIdx ? ' selected' : '');
        return '<button class="' + cls + '" data-stage="' + i + '"' + (locked ? ' disabled' : '') + '>' +
          (locked ? '🔒 ' : i < clr() ? '✔ ' : '') + (i + 1) + '. ' + s.title +
          '<small>' + s.general.name + '</small></button>';
      }).join('') + '</div>' +
      '<div class="stage-info">' +
        '<div><b>' + stageLabel(stageIdx) + '</b>　敵將 ' + st.general.name +
          '（' + S.STAT_KEYS.map(function (k) { return S.STAT_NAMES[k] + st.general[k]; }).join(' ') + '）<br>' +
          '敵軍 ' + S.UNIT_KINDS.map(function (k) {
            var n = st.units.filter(function (t) { return t === k; }).length;
            return n ? unitName(k) + '×' + n : '';
          }).filter(Boolean).join(' ') + (levelText(st) ? '　' + levelText(st) : '') + '<br>' +
          '獎勵 💰 ' + Math.round(st.gold * rate) + ' 金 ⭐ ' + Math.round(st.exp * rate) + ' 經驗' +
          '　🎁 隨機裝備' + (first && st.drops ? '＋' + st.drops.map(function (dr) {
            if (dr.unique) return '<span class="q-unique">' + S.UNIQUES[dr.unique].name + '</span>';
            if (dr.set) return '<span class="q-set">' + S.SET_ITEMS[dr.set].name + '</span>';
            return '<span class="q-' + dr.quality + '">' + S.QUALITIES[dr.quality].name + '裝備</span>';
          }).join('、') : '') +
          (first ? '' : '<small>（重打 ' + Math.round(C.REPLAY_RATE * 100) + '%）</small>') +
        '</div>' +
        '<div class="go-btns"><button id="btn-go" class="primary big" title="一場定勝負的會戰">⚔ 出征</button>' +
          '<button id="btn-explore" class="primary big explore" title="在 20 倍大的地圖上四處探索、擊破敵營、開寶箱，最後打倒敵將">🗺 探索</button>' +
          '<small>探索：獎勵 ×' + S.EXPLORE.REWARD_MULT + '，途中撿到的裝備都能帶走</small></div>' +
      '</div>' +

      '<div class="camp-cols">' +
        '<div class="box"><h3>軍隊 <small>' + profile.soldiers.length + ' / ' + C.MAX_UNITS + ' 隊</small></h3>' +
          '<div class="soldiers">' + profile.soldiers.map(function (t, i) {
            return '<span class="soldier ' + t + '">' + unitName(t) +
              '<button data-sell="' + i + '" title="賣出，退回 ' + Math.floor(C.PRICE[t] * C.SELL_RATE) + ' 金"' +
              (profile.soldiers.length <= 1 ? ' disabled' : '') + '>×</button></span>';
          }).join('') + '</div>' +
          '<div class="buy">' + S.UNIT_KINDS.map(function (t) {
            return '<button data-buy="' + t + '"' + (full || profile.gold < C.PRICE[t] ? ' disabled' : '') + '>' +
              '招募' + unitName(t) + '<small>' + C.PRICE[t] + ' 金</small></button>';
          }).join('') + '</div>' +
          (full ? '<p class="hint">軍隊已滿，可以先賣掉士兵再招募其他兵種</p>' : '') +
        '</div>' +
        '<div class="box"><h3>能力提升 <small>用經驗值</small></h3>' +
          '<table class="ups"><tbody>' +
          S.STAT_KEYS.map(function (k) {
            var max = g[k] >= C.STAT_MAX, cost = S.statCost(g[k]);
            return '<tr><th>' + S.STAT_NAMES[k] + '</th><td>' + g[k] + '</td><td>' +
              '<button data-up="' + k + '"' + (max || profile.exp < cost ? ' disabled' : '') +
              ' title="' + STAT_DESC[k] + '">' + (max ? '已達上限' : '+' + C.STAT_STEP + '<small>' + cost + ' 經驗</small>') +
              '</button></td></tr>';
          }).join('') +
          S.UNIT_KINDS.map(function (t) {
            var lv = profile.levels[t], max = lv >= S.LEVEL.MAX, cost = S.levelCost(lv);
            return '<tr><th>' + unitName(t) + '</th><td>Lv' + lv + '</td><td>' +
              '<button data-lv="' + t + '"' + (max || profile.exp < cost ? ' disabled' : '') +
              ' title="全部' + unitName(t) + '能力 +' + Math.round(S.LEVEL.BONUS * 100) + '%">' +
              (max ? '已達上限' : 'Lv▲<small>' + cost + ' 經驗</small>') + '</button></td></tr>';
          }).join('') +
          '</tbody></table>' +
        '</div>' +
        renderEquipBox() +
      '</div>' +
      '<div class="camp-foot"><button id="btn-reset" class="danger">重新建立武將</button></div>';

    preview();
  }

  campEl.addEventListener('click', function (e) {
    if (view !== 'camp' || !profile) return;
    var b = e.target.closest('button');
    if (!b || b.disabled) return;
    var d = b.dataset, C2 = C;
    if (d.diff) {
      if (!diffUnlocked(d.diff) || d.diff === diffKey()) return;
      profile.difficulty = d.diff;
      stageIdx = Math.min(clr(), S.STAGES.length - 1);
      restock();
      campMsg = '切換到' + D().name + '難度：敵軍 +' + D().lv + ' 級，掉落的物品等級 +' + D().ilvl + '，獎勵 ×' + D().reward;
      save();
    } else if (d.stage != null) {
      stageIdx = Number(d.stage);
      campMsg = '';
    } else if (d.buy) {
      if (profile.soldiers.length >= C2.MAX_UNITS || profile.gold < C2.PRICE[d.buy]) return;
      profile.gold -= C2.PRICE[d.buy];
      profile.soldiers.push(d.buy);
      sortSoldiers();
      campMsg = '招募了' + unitName(d.buy);
      sfx('coin');
      save();
    } else if (d.sell != null) {
      var t = profile.soldiers[Number(d.sell)];
      var refund = Math.floor(C2.PRICE[t] * C2.SELL_RATE);
      if (profile.soldiers.length <= 1 || !window.confirm('賣掉一隊' + unitName(t) + '，退回 ' + refund + ' 金？')) return;
      profile.soldiers.splice(Number(d.sell), 1);
      profile.gold += refund;
      campMsg = '賣掉一隊' + unitName(t) + '，獲得 ' + refund + ' 金';
      sfx('coin');
      save();
    } else if (d.up) {
      var sc = S.statCost(profile.general[d.up]);
      if (profile.exp < sc || profile.general[d.up] >= C2.STAT_MAX) return;
      profile.exp -= sc;
      profile.general[d.up] = Math.min(C2.STAT_MAX, profile.general[d.up] + C2.STAT_STEP);
      campMsg = S.STAT_NAMES[d.up] + ' 提升到 ' + profile.general[d.up];
      sfx('levelup');
      save();
    } else if (d.lv) {
      var lc = S.levelCost(profile.levels[d.lv]);
      if (profile.exp < lc || profile.levels[d.lv] >= S.LEVEL.MAX) return;
      profile.exp -= lc;
      profile.levels[d.lv]++;
      campMsg = unitName(d.lv) + ' 升到 Lv' + profile.levels[d.lv];
      sfx('levelup');
      save();
    } else if (d.bagfilter) {
      bagFilter = d.bagfilter;
    } else if (d.bagsort) {
      bagSort = d.bagsort;
    } else if (d.sellall) {
      var list = profile.items.filter(function (it) { return it.q === d.sellall; });
      var total = list.reduce(function (sum, it) { return sum + S.itemSellPrice(it); }, 0);
      if (!list.length || !window.confirm('賣掉背包裡全部 ' + list.length + ' 件' + S.QUALITIES[d.sellall].name + '裝備，獲得 ' + total + ' 金？')) return;
      profile.items = profile.items.filter(function (it) { return it.q !== d.sellall; });
      profile.gold += total;
      campMsg = '賣掉 ' + list.length + ' 件' + S.QUALITIES[d.sellall].name + '裝備，獲得 ' + total + ' 金';
      sfx('coin');
      save();
    } else if (d.buyitem != null) {
      var bi = profile.shop[Number(d.buyitem)], price = bi && S.itemValue(bi);
      if (!bi || profile.gold < price) return;
      if (profile.items.length >= S.BAG_SIZE && !S.hasEmptySlot(profile.equip, bi)) { campMsg = '背包已滿，先賣掉一些裝備吧'; renderCamp(); return; }
      profile.gold -= price;
      profile.shop.splice(Number(d.buyitem), 1);
      campMsg = '購買了' + S.itemInfo(bi).name + gainItem(bi);
      sfx('coin');
      save();
    } else if (d.equip != null) {
      var ei = profile.items[Number(d.equip)];
      equipItem(Number(d.equip));
      campMsg = '裝備了' + S.itemInfo(ei).name;
      sfx('equip');
      save();
    } else if (d.unequip) {
      var ui = profile.equip[d.unequip];
      if (!ui) return;
      if (profile.items.length >= S.BAG_SIZE) { campMsg = '背包已滿，無法卸下'; renderCamp(); return; }
      profile.items.push(ui);
      profile.equip[d.unequip] = null;
      campMsg = '卸下了' + S.itemInfo(ui).name;
      sfx('equip');
      save();
    } else if (d.sellitem != null) {
      var si = profile.items[Number(d.sellitem)], gain = S.itemSellPrice(si), sname = S.itemInfo(si).name;
      if (si.q !== 'normal' && !window.confirm('賣掉「' + sname + '」，獲得 ' + gain + ' 金？')) return;
      profile.items.splice(Number(d.sellitem), 1);
      profile.gold += gain;
      campMsg = '賣掉' + sname + '，獲得 ' + gain + ' 金';
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
      if (!window.confirm('確定要刪除「' + profile.general.name + '」和所有進度，重新建立武將嗎？')) return;
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

  S.game.onRetreat = function () {
    S.game.stop();
    if (exploring) {              // 探索模式撤退：撿到的裝備可以帶回來
      var found = S.game.getLoot();
      found.forEach(gainItem);
      campMsg = '已撤退' + (found.length ? '，帶回 ' + found.length + ' 件裝備' : '，這次沒有撿到裝備');
      save();
    } else {
      campMsg = '已撤退，這場戰鬥沒有獎勵';
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
      note = (first ? '首次過關' : '重打獎勵 ' + Math.round(C.REPLAY_RATE * 100) + '%') + (exploring ? '・探索 ×' + S.EXPLORE.REWARD_MULT : '') +
        (D().reward > 1 ? '・' + D().name + ' ×' + D().reward : '') + (expBonus ? '・經驗壇 +' + Math.round(expBonus * 100) + '%' : '');
      profile.stats.wins++;
      if (first) setClr(stageIdx + 1);
    } else {
      exp = Math.round(st.exp * C.LOSS_EXP_RATE * D().reward * (1 + expBonus));
      note = (winner < 0 ? '平手視為未過關' : '戰敗') + '，仍獲得部分經驗';
      profile.stats.losses++;
    }
    profile.gold += gold;
    profile.exp += exp;
    // 戰利品：一般出征打贏掉落一件隨機裝備；探索模式是途中撿到的裝備 (輸了也能帶走)；首次過關另有關卡指定的裝備
    // 一般出征：打贏才拿得到 (含精英掉落)；探索模式：撿到的都能帶走
    var loot = exploring ? S.game.getLoot().slice() : win ? [S.rollLoot(stageIlvl(stageIdx), playerArmy().procs.mf)].concat(S.game.getLoot()) : [];
    if (win && first) (st.drops || []).forEach(function (dr) { loot.push(S.makeItem(Object.assign({ ilvl: stageIlvl(stageIdx) }, dr))); });
    var lootNotes = loot.map(gainItem);
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
      unlock = clr() < S.STAGES.length ? '🔓 解鎖' + stageLabel(clr()) :
        nextDiff ? '🏆 ' + D().name + '難度制霸！🔓 解鎖' + S.DIFFICULTIES[nextDiff].name + '難度：敵人更強，掉落更好的裝備' :
        '🏆 恭喜！地獄難度全部制霸，天下無敵！';
    }
    show('result');
    resultEl.innerHTML =
      '<h2 class="' + (win ? 'win' : 'lose') + '">' + (win ? '勝利！' : winner < 0 ? '平手' : '敗北…') + '</h2>' +
      '<p>' + stageLabel(stageIdx) + '　vs ' + st.general.name + '</p>' +
      '<p class="reward">' + (gold ? '💰 +' + gold + ' 金　' : '') + '⭐ +' + exp + ' 經驗 <small>（' + note + '）</small></p>' +
      (loot.length ? '<div class="loot"><b>🎁 戰利品</b>' + loot.map(function (item, i) {
        return itemLine(item, '', lootNotes[i] ? ' <small>' + lootNotes[i] + '</small>' : '');
      }).join('') + '</div>' : '') +
      (unlock ? '<p class="unlock">' + unlock + '</p>' : '') +
      (win ? '' : '<p class="hint">回營地招募士兵、提升能力、購買裝備後再挑戰吧</p>') +
      '<div class="cr-row"><button id="btn-camp" class="primary">回營地</button>' +
      '<button id="btn-again">再戰一次</button></div>';
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
