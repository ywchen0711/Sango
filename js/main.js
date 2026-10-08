/*
 * 主迴圈與介面控制
 */
(function (S) {
  'use strict';

  var canvas = document.getElementById('screen');
  var btnStart = document.getElementById('btn-start');
  var btnRestart = document.getElementById('btn-restart');
  var btnRandom = document.getElementById('btn-random');
  var selSpeed = document.getElementById('sel-speed');
  var chkBars = document.getElementById('chk-bars');
  var roster = document.getElementById('roster');
  var btnDraft = document.getElementById('btn-draft');
  var draftEl = document.getElementById('draft');
  var draftTurn = document.getElementById('draft-turn');
  var draftPicks = document.getElementById('draft-picks');
  var draftGenerals = document.getElementById('draft-generals');
  var draftSoldiers = document.getElementById('draft-soldiers');
  var selControl = document.getElementById('sel-control');
  var tacticsEl = document.getElementById('tactics');
  var tacInfo = document.getElementById('tac-info');
  var tacHint = document.getElementById('tac-hint');
  var btnGeneral = document.getElementById('btn-general');
  var eventsEl = document.getElementById('events');

  var renderer = new S.Renderer(canvas);
  var armies = S.DEFAULT_ARMIES.map(function (a) { return Object.assign({}, a, { units: a.units.slice() }); });
  var battle, running = false, speed = 1, last = 0, acc = 0, tableT = 0;
  var rowById = {}, rosterSize = 0;
  var draft = null;
  var SIDE_NAMES = ['藍軍', '紅軍'];
  var SHORT = { spear: '槍', archer: '弓', cavalry: '騎' };
  var humanSide = 0;              // 玩家操控的一方；-1 = 觀戰
  var aiming = null;              // 正在瞄準的計策 id
  var mouseTile = null;
  var hintT = 0, uiT = 0, logLen = -1;
  var playerLevels = null;        // 登入玩家的等級 (js/account.js 設定)，只加在玩家操控的一方

  function control() { return [humanSide === 0, humanSide === 1]; }

  function levels() {
    if (!playerLevels || humanSide < 0) return null;
    var l = [null, null];
    l[humanSide] = playerLevels;
    return l;
  }

  function newBattle() {
    battle = S.currentBattle = new S.Battle(armies, { control: control(), levels: levels() });   // S.currentBattle：方便在主控台除錯
    running = false;
    acc = 0;
    logLen = -1;
    cancelAim();
    buildRoster();
    updateUI();
    updateTactics();
    updateLog();
  }

  function updateUI() {
    btnStart.textContent = running ? '⏸ 暫停' : '▶ 開始';
    btnStart.disabled = battle.state === 'over' || !!draft;
    btnRestart.disabled = btnRandom.disabled = btnDraft.disabled = !!draft;
  }

  // ======================= 計策列 =======================
  var tacButtons = {};
  document.getElementById('tac-buttons').innerHTML = S.TACTIC_IDS.map(function (id) {
    var tc = S.TACTICS[id];
    return '<button class="tac" data-tac="' + id + '" title="' + tc.desc + '"></button>';
  }).join('');
  S.TACTIC_IDS.forEach(function (id) {
    var btn = tacticsEl.querySelector('[data-tac="' + id + '"]');
    tacButtons[id] = btn;
    btn.addEventListener('click', function () { onTactic(id); });
  });
  btnGeneral.addEventListener('click', toggleGeneral);

  function hint(text) { tacHint.textContent = text; hintT = 2.5; }

  function canCommand() { return humanSide >= 0 && !draft && battle.state === 'fighting'; }

  function onTactic(id) {
    if (!canCommand()) return;
    if (aiming === id) { cancelAim(); updateTactics(); return; }
    var why = battle.tacticBlocked(humanSide, id);
    if (why) { hint(S.TACTICS[id].name + '：' + why); return; }
    if (S.TACTICS[id].target) {
      aiming = id;
      canvas.classList.add('aiming');
      hint('點選戰場上的目標位置施放「' + S.TACTICS[id].name + '」（右鍵 / Esc 取消）');
      updateAim();
    } else {
      battle.useTactic(humanSide, id);
    }
    updateTactics();
  }

  function cancelAim() {
    aiming = null;
    renderer.aim = null;
    canvas.classList.remove('aiming');
  }

  function toggleGeneral() {
    if (!canCommand()) return;
    var g = battle.generals[humanSide];
    if (g && !g.dead) battle.orderGeneral(humanSide, !g.engaged);
    updateTactics();
  }

  function updateAim() {
    if (!aiming || !mouseTile) { renderer.aim = null; return; }
    var tc = S.TACTICS[aiming];
    renderer.aim = {
      x: mouseTile.x, y: mouseTile.y, radius: tc.radius, color: tc.color,
      targets: battle.tacticTargets(humanSide, aiming, mouseTile.x, mouseTile.y)
    };
  }

  function updateTactics() {
    tacticsEl.hidden = humanSide < 0;
    if (humanSide < 0) return;
    var side = humanSide;
    var g = battle.generals[side];
    var alive = battle.generalAlive(side);
    tacInfo.className = 'tac-info side' + side;
    tacInfo.textContent = SIDE_NAMES[side] + ' ' + armies[side].name + '　軍令 ' +
      (alive ? Math.floor(battle.command[side]) : 0) + '/' + S.COMMAND.MAX;
    btnGeneral.innerHTML = (g && g.engaged ? '主將撤退' : '主將出陣') + '<kbd>Q</kbd>';
    btnGeneral.title = g && g.engaged ? '主將退回後方待機，只反擊射程內的敵人' : '主將親自上陣衝殺';
    btnGeneral.disabled = !alive || !canCommand();
    S.TACTIC_IDS.forEach(function (id) {
      var tc = S.TACTICS[id];
      var cd = battle.tacticCd[side][id] || 0;
      var why = canCommand() ? battle.tacticBlocked(side, id) : '—';
      var btn = tacButtons[id];
      btn.innerHTML = tc.name + (cd > 0 ? '<small>' + Math.ceil(cd) + 's</small>' : '<small>' + tc.cost + '令</small>') +
        '<kbd>' + tc.key + '</kbd>';
      btn.disabled = !!why && aiming !== id;
      btn.classList.toggle('aiming', aiming === id);
    });
    if (aiming && battle.tacticBlocked(side, aiming)) cancelAim();
  }

  // 戰報：最新的在最上面
  function updateLog() {
    if (battle.log.length === logLen) return;
    logLen = battle.log.length;
    eventsEl.innerHTML = battle.log.slice(-6).reverse().map(function (l) { return '<li>' + l + '</li>'; }).join('');
  }

  // ---- 單位數值表 ----
  function skillCell(ids) {
    return '<td class="skill ' + S.SKILLS[ids[0]].kind + '">' + ids.map(function (id) {
      var sk = S.SKILLS[id];
      return '<span title="' + sk.desc + '（MP ' + sk.mp + '）">' + sk.name + '</span>';
    }).join(' ') + '</td>';
  }

  function buildRoster() {
    var short = SHORT;
    rowById = {};
    rosterSize = battle.units.length;
    roster.innerHTML = [0, 1].map(function (side) {
      var army = armies[side];
      var count = { spear: 0, archer: 0, cavalry: 0 };
      army.units.forEach(function (t) { count[t.type || t]++; });
      var summary = S.UNIT_KINDS.map(function (k) { return short[k] + '×' + count[k]; }).join(' ');
      var numbers = { spear: 0, archer: 0, cavalry: 0 };
      var rows = battle.units.filter(function (u) { return u.side === side; }).map(function (u) {
        var label = (u.isGeneral ? u.name : u.name + (++numbers[u.type])) +
          (u.level ? ' <small class="lv">Lv' + u.level + '</small>' : '');
        return '<tr data-id="' + u.id + '"><td class="name">' + label + '</td>' +
          '<td class="hp"></td><td class="mp"></td>' +
          '<td>' + u.atk + '</td><td>' + u.def + '</td><td>' + u.int + '</td><td>' + u.spr + '</td>' +
          skillCell(u.physSkills) + skillCell(u.magicSkills) + '</tr>';
      }).join('');
      return '<section class="army side' + side + '"><h2>' + army.name + '軍 <small>' + summary + '</small></h2>' +
        '<table><thead><tr><th>單位</th><th>HP</th><th>MP</th><th>攻擊</th><th>防禦</th><th>智力</th><th>精神</th>' +
        '<th>物理特技</th><th>魔法特技</th></tr></thead><tbody>' + rows + '</tbody></table></section>';
    }).join('');

    Array.prototype.forEach.call(roster.querySelectorAll('tr[data-id]'), function (tr) {
      var id = Number(tr.dataset.id);
      rowById[id] = { tr: tr, hp: tr.querySelector('.hp'), mp: tr.querySelector('.mp') };
      tr.addEventListener('mouseenter', function () { setHighlight(id); });
      tr.addEventListener('mouseleave', function () { setHighlight(-1); });
    });
    refreshRoster();
  }

  function refreshRoster() {
    battle.units.forEach(function (u) {
      var row = rowById[u.id];
      if (!row) return;
      row.hp.textContent = Math.max(0, Math.ceil(u.hp)) + '/' + u.maxHp;
      row.mp.textContent = Math.floor(u.mp) + '/' + u.maxMp;
      row.tr.classList.toggle('dead', u.dead);
    });
  }

  function setHighlight(id) {
    if (renderer.highlightId === id) return;
    var old = rowById[renderer.highlightId];
    if (old) old.tr.classList.remove('hl');
    renderer.highlightId = id;
    if (rowById[id]) rowById[id].tr.classList.add('hl');
  }

  // 滑鼠指到戰場上的單位 → 表格對應列高亮；瞄準計策；指到寶箱
  canvas.addEventListener('mousemove', function (e) {
    var lx = e.offsetX / canvas.clientWidth * S.VIEW_W;
    var ly = e.offsetY / canvas.clientHeight * S.VIEW_H;
    var tx = Math.floor(lx / S.TILE), ty = Math.floor(ly / S.TILE);
    mouseTile = battle.inBounds(tx, ty) ? { x: tx, y: ty } : null;
    updateAim();
    renderer.hoverChest = mouseTile && humanSide >= 0 && !aiming ? battle.chestAt(tx, ty) : null;
    canvas.classList.toggle('pointer', !!renderer.hoverChest);
    var found = -1;
    battle.units.forEach(function (u) {
      if (u.dead) return;
      var x = u.posX() * S.TILE, y = u.posY() * S.TILE;
      if (lx >= x && lx < x + S.TILE && ly >= y && ly < y + S.TILE) found = u.id;
    });
    setHighlight(found);
  });
  canvas.addEventListener('mouseleave', function () {
    setHighlight(-1);
    mouseTile = null;
    renderer.hoverChest = null;
    updateAim();
  });

  // 點擊：瞄準中 → 施放計策；點到寶箱 → 派最近的士兵去撿
  canvas.addEventListener('click', function () {
    if (!canCommand() || !mouseTile) return;
    if (aiming) {
      if (battle.useTactic(humanSide, aiming, mouseTile.x, mouseTile.y)) { cancelAim(); hint(''); }
      else hint('範圍內沒有敵軍');
      updateTactics();
      return;
    }
    var chest = battle.chestAt(mouseTile.x, mouseTile.y);
    if (chest) {
      var u = battle.fetchChest(humanSide, chest);
      hint(u ? '派' + u.name + '去撿寶箱' : '沒有部隊能到達寶箱');
    }
  });
  canvas.addEventListener('contextmenu', function (e) {
    if (aiming) { e.preventDefault(); cancelAim(); hint(''); updateTactics(); }
  });

  function toggle() {
    if (battle.state === 'over' || draft) return;
    running = !running;
    updateUI();
  }

  function randomize() {
    armies.forEach(function (a) {
      a.units = [];
      for (var i = 0; i < S.UNITS_PER_ARMY; i++) a.units.push(S.UNIT_KINDS[(S.random() * 3) | 0]);
    });
    newBattle();
  }

  // ======================= 選將模式 =======================
  function startDraft() {
    draft = new S.Draft();
    running = false;
    renderer.drafting = true;
    draftEl.hidden = false;
    roster.hidden = true;
    renderDraft();
    updateUI();
  }

  function endDraft(apply) {
    if (apply) armies = draft.armies();
    draft = null;
    renderer.drafting = false;
    draftEl.hidden = true;
    roster.hidden = false;
    newBattle();
  }

  function onDraftPick(kind, id) {
    if (!draft || !draft.pick(kind, id)) return;
    afterPick();
  }

  function afterPick() {
    if (draft.done()) endDraft(true);
    else renderDraft();
  }

  function ownerClass(kind, id) {
    var side = draft.owner[kind][id];
    if (side != null) return 'own' + side;
    return draft.canPick(kind, id) ? 'pickable' : 'idle';
  }

  function renderDraft() {
    var cur = draft.current();
    var nSoldier = draft.picks[cur.side].soldiers.length + 1;
    draftTurn.className = 'turn side' + cur.side;
    draftTurn.textContent = SIDE_NAMES[cur.side] + (cur.kind === 'general' ? ' 選擇主將' :
      ' 選擇士兵（' + nSoldier + '/' + S.DRAFT.PICKS + '）');

    draftPicks.innerHTML = [0, 1].map(function (side) {
      var p = draft.picks[side];
      var gen = p.general ? '<b>' + p.general.name + '</b>' : '<i>—</i>';
      var sol = p.soldiers.map(function (u) { return '<span class="chip ' + u.type + '">' + SHORT[u.type] + '</span>'; });
      for (var i = sol.length; i < S.DRAFT.PICKS; i++) sol.push('<span class="chip empty">·</span>');
      return '<div class="side' + side + (cur.side === side ? ' active' : '') + '">' +
        SIDE_NAMES[side] + '：' + gen + ' ' + sol.join('') + '</div>';
    }).join('');

    draftGenerals.innerHTML = '<thead><tr><th>武將</th><th>體力</th><th>武力</th><th>智力</th><th>統率</th><th>合計</th></tr></thead><tbody>' +
      draft.generals.map(function (g) {
        return '<tr class="' + ownerClass('general', g.id) + '" data-kind="general" data-id="' + g.id + '">' +
          '<td class="name">' + g.name + '</td><td>' + g.hp + '</td><td>' + g.war + '</td><td>' + g.int + '</td>' +
          '<td>' + g.lead + '</td><td class="muted">' + (g.hp + g.war + g.int + g.lead) + '</td></tr>';
      }).join('') + '</tbody>';

    draftSoldiers.innerHTML = '<thead><tr><th>兵種</th><th>HP</th><th>MP</th><th>攻擊</th><th>防禦</th><th>智力</th><th>精神</th>' +
      '<th>物理特技</th><th>魔法特技</th></tr></thead><tbody>' +
      draft.soldiers.map(function (u) {
        return '<tr class="' + ownerClass('soldier', u.id) + '" data-kind="soldier" data-id="' + u.id + '">' +
          '<td class="name ' + u.type + '">' + S.UNIT_TYPES[u.type].name + '</td>' +
          '<td>' + u.hp + '</td><td>' + u.mp + '</td><td>' + u.atk + '</td><td>' + u.def + '</td>' +
          '<td>' + u.int + '</td><td>' + u.spr + '</td>' + skillCell(u.physSkills) + skillCell(u.magicSkills) + '</tr>';
      }).join('') + '</tbody>';
  }

  [draftGenerals, draftSoldiers].forEach(function (table) {
    table.addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-kind]');
      if (tr) onDraftPick(tr.dataset.kind, Number(tr.dataset.id));
    });
  });
  document.getElementById('btn-draft-auto').addEventListener('click', function () {
    if (draft && draft.autoPick()) afterPick();
  });
  document.getElementById('btn-draft-cancel').addEventListener('click', function () { endDraft(false); });

  function frame(ts) {
    var dt = Math.min(0.1, (ts - last) / 1000 || 0);
    last = ts;
    if (running) {
      acc += dt * speed;
      while (acc >= S.SIM_DT) {
        battle.step(S.SIM_DT);
        acc -= S.SIM_DT;
      }
      if (battle.state === 'over' && !btnStart.disabled) {
        updateUI();
        if (S.onBattleOver) S.onBattleOver(battle.winner, humanSide);   // 給帳號系統記錄戰績
      }
      tableT -= dt;
      if (tableT <= 0) {
        tableT = 0.2;
        if (rosterSize !== battle.units.length) buildRoster();   // 伏兵加入
        refreshRoster();
      }
    }
    uiT -= dt;
    if (uiT <= 0) { uiT = 0.1; updateTactics(); updateLog(); if (aiming) updateAim(); }
    if (hintT > 0) { hintT -= dt; if (hintT <= 0) tacHint.textContent = ''; }
    renderer.draw(battle, running);
    requestAnimationFrame(frame);
  }

  btnStart.addEventListener('click', toggle);
  btnRestart.addEventListener('click', newBattle);
  btnRandom.addEventListener('click', randomize);
  btnDraft.addEventListener('click', startDraft);
  selSpeed.addEventListener('change', function () { speed = Number(selSpeed.value); });
  selControl.addEventListener('change', function () {
    humanSide = Number(selControl.value);
    battle.control = control();
    if (battle.time === 0 && !running) { newBattle(); selControl.blur(); return; }   // 還沒開打：重新布陣讓等級加成換邊
    cancelAim();
    updateTactics();
    selControl.blur();
  });
  chkBars.addEventListener('change', function () { renderer.showBars = chkBars.checked; });
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'SELECT' || (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') || draft) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.code === 'KeyR') newBattle();
    else if (e.code === 'KeyQ') toggleGeneral();
    else if (e.code === 'Escape') { cancelAim(); hint(''); updateTactics(); }
    else {
      S.TACTIC_IDS.forEach(function (id) {
        if (e.key === S.TACTICS[id].key) onTactic(id);
      });
    }
  });

  // ======================= 存檔介面（給 js/account.js 用） =======================
  S.game = {
    getState: function () {
      return {
        armies: JSON.parse(JSON.stringify(armies)),
        settings: { speed: speed, bars: chkBars.checked, control: humanSide }
      };
    },
    applyState: function (st) {
      if (draft) endDraft(false);
      if (st.armies && st.armies.length === 2) armies = st.armies;
      var set = st.settings || {};
      if (set.speed) { speed = Number(set.speed); selSpeed.value = String(speed); }
      if (set.bars != null) { chkBars.checked = !!set.bars; renderer.showBars = chkBars.checked; }
      if (set.control != null) { humanSide = Number(set.control); selControl.value = String(humanSide); }
      newBattle();
    },
    // 設定玩家等級；還沒開打就立刻重新布陣套用，否則下一場生效。回傳是否已套用
    setLevels: function (lv) {
      playerLevels = lv;
      if (battle.time === 0 && !running && !draft) { newBattle(); return true; }
      return false;
    }
  };

  newBattle();
  if (/[?&]auto\b/.test(location.search)) toggle();   // index.html?auto 直接開戰
  if (/[?&]draft\b/.test(location.search)) startDraft();   // index.html?draft 直接進入選將模式
  requestAnimationFrame(frame);
})(window.Sango);
