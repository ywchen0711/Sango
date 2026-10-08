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
      profile.items = (profile.items || []).filter(function (id) { return S.EQUIPMENT[id]; });
      profile.equip = Object.assign({ weapon: null, armor: null, treasure: null }, profile.equip);
      S.game.applySettings(profile.settings);
      stageIdx = Math.min(profile.cleared, S.STAGES.length - 1);
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
        equip: { weapon: null, armor: null, treasure: null },
        gold: C.START_GOLD,
        exp: 0,
        cleared: 0,
        stats: { wins: 0, losses: 0 },
        settings: S.game.getSettings()
      };
      sortSoldiers();
      stageIdx = 0;
      campMsg = name + ' 出陣！先從第 1 關開始吧';
      save();
      renderCamp();
    });
    refresh();
  }

  // ======================= 營地 =======================
  function playerArmy() { return S.playerArmy(profile); }
  function playerLevels() { return S.playerLevels(profile); }
  function enemyArmy(st) {
    return Object.assign({}, st.general, { units: st.units.slice() });
  }
  function levelText(st) {
    var lv = S.stageLevels(st);
    var vals = ['general', 'spear', 'archer', 'cavalry'].map(function (k) { return lv[k]; });
    if (vals.every(function (v) { return v === vals[0]; })) return vals[0] ? 'Lv' + vals[0] : '';
    return '主將Lv' + lv.general + ' 槍Lv' + lv.spear + ' 弓Lv' + lv.archer + ' 騎Lv' + lv.cavalry;
  }
  function stageLabel(i) { return '第 ' + (i + 1) + ' 關 ' + S.STAGES[i].title; }

  // 裝備：目前裝備的三件、背包、商店
  function itemLine(id, buttons) {
    var it = S.EQUIPMENT[id];
    return '<div class="item"><span class="iname">' + it.name + '</span>' +
      '<span class="idesc">' + S.equipDesc(it) + '</span><span class="ibtns">' + buttons + '</span></div>';
  }
  // 把背包第 i 件裝上，原本那一欄的裝備放回背包
  function equipItem(i) {
    var id = profile.items[i], slot = S.EQUIPMENT[id].slot;
    profile.items.splice(i, 1);
    if (profile.equip[slot]) profile.items.push(profile.equip[slot]);
    profile.equip[slot] = id;
  }
  function sellPrice(id) { return Math.floor(S.equipValue(S.EQUIPMENT[id]) * C.SELL_RATE); }

  function renderEquipBox() {
    var shop = Object.keys(S.EQUIPMENT).filter(function (id) { return S.EQUIPMENT[id].price > 0; });
    return '<div class="box wide"><h3>裝備 <small>主將的武器 / 防具 / 寶物</small></h3>' +
      '<div class="equip-slots">' + S.EQUIP_SLOT_KEYS.map(function (slot) {
        var id = profile.equip[slot];
        return '<div class="slot"><span class="slot-name">' + S.EQUIP_SLOTS[slot] + '</span>' +
          (id ? itemLine(id, '<button data-unequip="' + slot + '">卸下</button>') : '<span class="muted">（無）</span>') + '</div>';
      }).join('') + '</div>' +
      '<h4>背包 <small>' + profile.items.length + ' 件</small></h4>' +
      (profile.items.length ? profile.items.map(function (id, i) {
        return itemLine(id, '<button data-equip="' + i + '">裝備</button>' +
          '<button data-sellitem="' + i + '">賣出<small>' + sellPrice(id) + ' 金</small></button>');
      }).join('') : '<p class="hint">還沒有裝備。可以在下方商店購買，部分關卡首次過關也會獲得裝備</p>') +
      '<h4>商店</h4>' +
      shop.map(function (id) {
        var it = S.EQUIPMENT[id];
        return itemLine(id, '<span class="slot-tag">' + S.EQUIP_SLOTS[it.slot] + '</span>' +
          '<button data-buyitem="' + id + '"' + (profile.gold < it.price ? ' disabled' : '') + '>購買<small>' + it.price + ' 金</small></button>');
      }).join('') +
      '</div>';
  }

  function preview() {
    var st = S.STAGES[stageIdx];
    S.game.setup([playerArmy(), enemyArmy(st)], [playerLevels(), S.stageLevels(st)]);
    S.game.setCaption({ title: stageLabel(stageIdx), sub: 'vs ' + st.general.name + '　按「出征」開戰' });
  }

  function renderCamp() {
    show('camp');
    var g = profile.general, st = S.STAGES[stageIdx];
    var first = stageIdx >= profile.cleared;
    var rate = first ? 1 : C.REPLAY_RATE;
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
        '<div class="res"><span class="gold">💰 ' + profile.gold + ' 金</span>' +
          '<span class="exp">⭐ ' + profile.exp + ' 經驗</span>' +
          '<span class="muted">戰績 ' + profile.stats.wins + '勝 ' + profile.stats.losses + '敗</span></div>' +
      '</div>' +
      (campMsg ? '<p class="msg">' + esc(campMsg) + '</p>' : '') +

      '<h3>關卡 <small>已通過 ' + profile.cleared + ' / ' + S.STAGES.length + '</small></h3>' +
      '<div class="stages">' + S.STAGES.map(function (s, i) {
        var locked = i > profile.cleared;
        var cls = 'stage' + (i < profile.cleared ? ' cleared' : '') + (i === stageIdx ? ' selected' : '');
        return '<button class="' + cls + '" data-stage="' + i + '"' + (locked ? ' disabled' : '') + '>' +
          (locked ? '🔒 ' : i < profile.cleared ? '✔ ' : '') + (i + 1) + '. ' + s.title +
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
          (first && st.drops ? '　🎁 ' + st.drops.map(function (id) { return S.EQUIPMENT[id].name; }).join('、') : '') +
          (first ? '' : '<small>（重打 ' + Math.round(C.REPLAY_RATE * 100) + '%）</small>') +
        '</div>' +
        '<button id="btn-go" class="primary big">⚔ 出征</button>' +
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
            var max = g[k] >= C.STAT_MAX;
            return '<tr><th>' + S.STAT_NAMES[k] + '</th><td>' + g[k] + '</td><td>' +
              '<button data-up="' + k + '"' + (max || profile.exp < C.STAT_COST ? ' disabled' : '') +
              ' title="' + STAT_DESC[k] + '">' + (max ? '已達上限' : '+' + C.STAT_STEP + '<small>' + C.STAT_COST + ' 經驗</small>') +
              '</button></td></tr>';
          }).join('') +
          S.UNIT_KINDS.map(function (t) {
            var lv = profile.levels[t], max = lv >= S.LEVEL.MAX;
            return '<tr><th>' + unitName(t) + '</th><td>Lv' + lv + '</td><td>' +
              '<button data-lv="' + t + '"' + (max || profile.exp < C.LEVEL_COST ? ' disabled' : '') +
              ' title="全部' + unitName(t) + '能力 +' + Math.round(S.LEVEL.BONUS * 100) + '%">' +
              (max ? '已達上限' : 'Lv▲<small>' + C.LEVEL_COST + ' 經驗</small>') + '</button></td></tr>';
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
    if (d.stage != null) {
      stageIdx = Number(d.stage);
      campMsg = '';
    } else if (d.buy) {
      if (profile.soldiers.length >= C2.MAX_UNITS || profile.gold < C2.PRICE[d.buy]) return;
      profile.gold -= C2.PRICE[d.buy];
      profile.soldiers.push(d.buy);
      sortSoldiers();
      campMsg = '招募了' + unitName(d.buy);
      save();
    } else if (d.sell != null) {
      var t = profile.soldiers[Number(d.sell)];
      var refund = Math.floor(C2.PRICE[t] * C2.SELL_RATE);
      if (profile.soldiers.length <= 1 || !window.confirm('賣掉一隊' + unitName(t) + '，退回 ' + refund + ' 金？')) return;
      profile.soldiers.splice(Number(d.sell), 1);
      profile.gold += refund;
      campMsg = '賣掉一隊' + unitName(t) + '，獲得 ' + refund + ' 金';
      save();
    } else if (d.up) {
      if (profile.exp < C2.STAT_COST || profile.general[d.up] >= C2.STAT_MAX) return;
      profile.exp -= C2.STAT_COST;
      profile.general[d.up] = Math.min(C2.STAT_MAX, profile.general[d.up] + C2.STAT_STEP);
      campMsg = S.STAT_NAMES[d.up] + ' 提升到 ' + profile.general[d.up];
      save();
    } else if (d.lv) {
      if (profile.exp < C2.LEVEL_COST || profile.levels[d.lv] >= S.LEVEL.MAX) return;
      profile.exp -= C2.LEVEL_COST;
      profile.levels[d.lv]++;
      campMsg = unitName(d.lv) + ' 升到 Lv' + profile.levels[d.lv];
      save();
    } else if (d.buyitem) {
      var bi = S.EQUIPMENT[d.buyitem];
      if (!bi || !bi.price || profile.gold < bi.price) return;
      profile.gold -= bi.price;
      profile.items.push(d.buyitem);
      if (!profile.equip[bi.slot]) equipItem(profile.items.length - 1);   // 該欄位空著就直接裝上
      campMsg = '購買了' + bi.name;
      save();
    } else if (d.equip != null) {
      var ei = S.EQUIPMENT[profile.items[Number(d.equip)]];
      equipItem(Number(d.equip));
      campMsg = '裝備了' + ei.name;
      save();
    } else if (d.unequip) {
      var uid = profile.equip[d.unequip];
      if (!uid) return;
      profile.items.push(uid);
      profile.equip[d.unequip] = null;
      campMsg = '卸下了' + S.EQUIPMENT[uid].name;
      save();
    } else if (d.sellitem != null) {
      var sid = profile.items[Number(d.sellitem)], gain = sellPrice(sid);
      if (!window.confirm('賣掉' + S.EQUIPMENT[sid].name + '，獲得 ' + gain + ' 金？')) return;
      profile.items.splice(Number(d.sellitem), 1);
      profile.gold += gain;
      campMsg = '賣掉' + S.EQUIPMENT[sid].name + '，獲得 ' + gain + ' 金';
      save();
    } else if (b.id === 'btn-go') {
      startBattle();
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
  function startBattle() {
    show('battle');
    S.game.start();
    fieldEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  S.game.onRetreat = function () {
    S.game.stop();
    campMsg = '已撤退，這場戰鬥沒有獎勵';
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
    var first = stageIdx >= profile.cleared;
    var win = winner === 0;
    var gold = 0, exp, note;
    if (win) {
      var rate = first ? 1 : C.REPLAY_RATE;
      gold = Math.round(st.gold * rate);
      exp = Math.round(st.exp * rate);
      note = first ? '首次過關' : '重打獎勵 ' + Math.round(C.REPLAY_RATE * 100) + '%';
      profile.stats.wins++;
      if (first) profile.cleared = stageIdx + 1;
    } else {
      exp = Math.round(st.exp * C.LOSS_EXP_RATE);
      note = (winner < 0 ? '平手視為未過關' : '戰敗') + '，仍獲得部分經驗';
      profile.stats.losses++;
    }
    profile.gold += gold;
    profile.exp += exp;
    // 首次過關獲得裝備 (該欄位空著就直接裝上)
    var drops = win && first ? (st.drops || []).filter(function (id) { return S.EQUIPMENT[id]; }) : [];
    drops.forEach(function (id) {
      profile.items.push(id);
      if (!profile.equip[S.EQUIPMENT[id].slot]) equipItem(profile.items.length - 1);
    });
    save();

    var unlock = '';
    if (win && first) {
      unlock = profile.cleared >= S.STAGES.length ? '🏆 恭喜！全部 ' + S.STAGES.length + ' 關制霸天下！' :
        '🔓 解鎖' + stageLabel(profile.cleared);
    }
    show('result');
    resultEl.innerHTML =
      '<h2 class="' + (win ? 'win' : 'lose') + '">' + (win ? '勝利！' : winner < 0 ? '平手' : '敗北…') + '</h2>' +
      '<p>' + stageLabel(stageIdx) + '　vs ' + st.general.name + '</p>' +
      '<p class="reward">' + (gold ? '💰 +' + gold + ' 金　' : '') + '⭐ +' + exp + ' 經驗 <small>（' + note + '）</small></p>' +
      (drops.length ? '<p class="drop">🎁 獲得裝備：' + drops.map(function (id) {
        var it = S.EQUIPMENT[id];
        return '<b>' + it.name + '</b><small>（' + S.equipDesc(it) + '）</small>';
      }).join('、') + '</p>' : '') +
      (unlock ? '<p class="unlock">' + unlock + '</p>' : '') +
      (win ? '' : '<p class="hint">回營地招募士兵、提升能力、購買裝備後再挑戰吧</p>') +
      '<div class="cr-row"><button id="btn-camp" class="primary">回營地</button>' +
      '<button id="btn-again">再戰一次</button></div>';
    document.getElementById('btn-camp').addEventListener('click', function () {
      S.game.stop();
      if (win && first && profile.cleared < S.STAGES.length) stageIdx = profile.cleared;
      campMsg = '';
      renderCamp();
    });
    document.getElementById('btn-again').addEventListener('click', function () {
      preview();
      startBattle();
    });
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ======================= 啟動 =======================
  S.store.onChange = loadProfile;
  S.store.ready.then(loadProfile);
})(window.Sango);
