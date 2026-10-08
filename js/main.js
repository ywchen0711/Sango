/*
 * 主迴圈與戰鬥介面（玩家固定是藍軍；關卡、營地流程在 js/campaign.js）
 */
(function (S) {
  'use strict';

  var canvas = document.getElementById('screen');
  var battleBar = document.getElementById('battle-bar');
  var btnStart = document.getElementById('btn-start');
  var btnRetreat = document.getElementById('btn-retreat');
  var selSpeed = document.getElementById('sel-speed');
  var chkBars = document.getElementById('chk-bars');
  var roster = document.getElementById('roster');
  var tacticsEl = document.getElementById('tactics');
  var tacInfo = document.getElementById('tac-info');
  var tacHint = document.getElementById('tac-hint');
  var btnGeneral = document.getElementById('btn-general');
  var eventsEl = document.getElementById('events');

  var renderer = new S.Renderer(canvas);
  var armies = S.DEFAULT_ARMIES.map(function (a) { return Object.assign({}, a, { units: a.units.slice() }); });
  var levels = null;
  var battle, running = false, speed = 1, last = 0, acc = 0, tableT = 0;
  var active = false;             // 正式出征中 (營地預覽時為 false：不能下令、不能開始)
  var overFired = false;
  var rowById = {}, rosterSize = 0;
  var SIDE_NAMES = ['我軍', '敵軍'];
  var SHORT = { spear: '槍', archer: '弓', cavalry: '騎' };
  var humanSide = 0;              // 玩家固定操控藍軍
  var aiming = null;              // 正在瞄準的計策 id
  var mouseTile = null;
  var hintT = 0, uiT = 0, logLen = -1;

  function newBattle() {
    battle = S.currentBattle = new S.Battle(armies, { control: [true, false], levels: levels });   // S.currentBattle：方便在主控台除錯
    running = false;
    overFired = false;
    acc = 0;
    logLen = -1;
    cancelAim();
    buildRoster();
    updateUI();
    updateTactics();
    updateLog();
  }

  function updateUI() {
    battleBar.hidden = !active;
    btnStart.textContent = running ? '⏸ 暫停' : '▶ 繼續';
    btnStart.disabled = battle.state === 'over';
    btnRetreat.disabled = battle.state === 'over';
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

  function canCommand() { return active && battle.state === 'fighting'; }

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
    tacticsEl.hidden = !active;
    if (!active) return;
    var side = humanSide;
    var g = battle.generals[side];
    var alive = battle.generalAlive(side);
    tacInfo.className = 'tac-info side' + side;
    tacInfo.textContent = armies[side].name + '　軍令 ' +
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
    rowById = {};
    rosterSize = battle.units.length;
    roster.innerHTML = [0, 1].map(function (side) {
      var army = armies[side];
      var count = { spear: 0, archer: 0, cavalry: 0 };
      army.units.forEach(function (t) { count[t.type || t]++; });
      var summary = S.UNIT_KINDS.map(function (k) { return SHORT[k] + '×' + count[k]; }).join(' ');
      var numbers = { spear: 0, archer: 0, cavalry: 0 };
      var rows = battle.units.filter(function (u) { return u.side === side; }).map(function (u) {
        var label = (u.isGeneral ? u.name : u.name + (++numbers[u.type])) +
          (u.level ? ' <small class="lv">Lv' + u.level + '</small>' : '');
        return '<tr data-id="' + u.id + '"><td class="name">' + label + '</td>' +
          '<td class="hp"></td><td class="mp"></td>' +
          '<td>' + u.atk + '</td><td>' + u.def + '</td><td>' + u.int + '</td><td>' + u.spr + '</td>' +
          skillCell(u.physSkills) + skillCell(u.magicSkills) + '</tr>';
      }).join('');
      return '<section class="army side' + side + '"><h2>' + SIDE_NAMES[side] + '・' + esc(army.name) +
        ' <small>' + summary + '</small></h2>' +
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

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

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
    renderer.hoverChest = mouseTile && active && !aiming ? battle.chestAt(tx, ty) : null;
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
    if (!active || battle.state === 'over') return;
    running = !running;
    updateUI();
  }

  function frame(ts) {
    var dt = Math.min(0.1, (ts - last) / 1000 || 0);
    last = ts;
    if (running) {
      acc += dt * speed;
      while (acc >= S.SIM_DT && battle.state !== 'over') {
        battle.step(S.SIM_DT);
        acc -= S.SIM_DT;
      }
      tableT -= dt;
      if (tableT <= 0) {
        tableT = 0.2;
        if (rosterSize !== battle.units.length) buildRoster();   // 伏兵加入
        refreshRoster();
      }
      if (battle.state === 'over' && !overFired) {
        overFired = true;
        running = false;
        refreshRoster();
        updateUI();
        if (S.game.onOver) S.game.onOver(battle.winner);
      }
    }
    uiT -= dt;
    if (uiT <= 0) { uiT = 0.1; updateTactics(); updateLog(); if (aiming) updateAim(); }
    if (hintT > 0) { hintT -= dt; if (hintT <= 0) tacHint.textContent = ''; }
    renderer.draw(battle, running);
    requestAnimationFrame(frame);
  }

  btnStart.addEventListener('click', toggle);
  btnRetreat.addEventListener('click', function () {
    if (!active || battle.state === 'over') return;
    var wasRunning = running;
    running = false;
    updateUI();
    if (window.confirm('確定要撤退嗎？這場戰鬥不會獲得任何獎勵。')) { if (S.game.onRetreat) S.game.onRetreat(); }
    else { running = wasRunning; updateUI(); }
  });
  selSpeed.addEventListener('change', function () {
    speed = Number(selSpeed.value);
    selSpeed.blur();
    if (S.game.onSettings) S.game.onSettings();
  });
  chkBars.addEventListener('change', function () {
    renderer.showBars = chkBars.checked;
    if (S.game.onSettings) S.game.onSettings();
  });
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (!active || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' ||
        (t.tagName === 'INPUT' && t.type !== 'checkbox')) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.code === 'KeyQ') toggleGeneral();
    else if (e.code === 'Escape') { cancelAim(); hint(''); updateTactics(); }
    else {
      S.TACTIC_IDS.forEach(function (id) {
        if (e.key === S.TACTICS[id].key) onTactic(id);
      });
    }
  });

  // ======================= 給 js/campaign.js 用的介面 =======================
  S.game = {
    onOver: null,                 // function (winner)：戰鬥結束
    onRetreat: null,              // 玩家按了撤退
    onSettings: null,             // 速度 / 兵力條改變
    // 布陣預覽：armies = [我軍, 敵軍]，lv = [我軍等級, 敵軍等級]
    setup: function (newArmies, lv) {
      armies = newArmies;
      levels = lv;
      active = false;
      newBattle();
    },
    // 正式開戰
    start: function () {
      renderer.caption = null;
      active = true;
      running = true;
      updateUI();
      updateTactics();
    },
    // 離開戰鬥 (回營地)
    stop: function () {
      active = false;
      running = false;
      cancelAim();
      updateUI();
      updateTactics();
    },
    setCaption: function (c) { renderer.caption = c; },
    getSettings: function () { return { speed: speed, bars: chkBars.checked }; },
    applySettings: function (set) {
      set = set || {};
      if (set.speed) { speed = Number(set.speed); selSpeed.value = String(speed); }
      if (set.bars != null) { chkBars.checked = !!set.bars; renderer.showBars = chkBars.checked; }
    }
  };

  newBattle();
  requestAnimationFrame(frame);
})(window.Sango);
