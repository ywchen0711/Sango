/*
 * 主迴圈與戰鬥介面（玩家固定是藍軍；關卡、營地流程在 js/campaign.js）
 */
(function (S) {
  'use strict';

  var canvas = document.getElementById('screen');
  var btnStart = document.getElementById('btn-start');
  var btnRetreat = document.getElementById('btn-retreat');
  var speedEl = document.getElementById('speed');
  var chkBars = document.getElementById('chk-bars');
  var chkAutoTac = document.getElementById('chk-autotac');
  var btnSound = document.getElementById('btn-sound');
  var btnDash = document.getElementById('btn-dash');
  var btnWhirl = document.getElementById('btn-whirl');
  var stanceBtns = document.querySelectorAll('[data-stance]');
  var stanceKey = 'free';         // 我軍陣型 (下一場戰鬥沿用)
  var mouseWorld = null;          // 滑鼠所在的地圖座標 (格)，突進方向用
  var roster = document.getElementById('roster');
  var tacticsEl = document.getElementById('tactics');
  var tacInfo = document.getElementById('tac-info');
  var tacHint = document.getElementById('tac-hint');
  var btnGeneral = document.getElementById('btn-general');
  var btnCommand = document.getElementById('btn-command');
  var eventsEl = document.getElementById('events');

  var renderer = S.currentRenderer = new S.Renderer(canvas);   // S.currentRenderer：方便在主控台除錯
  var armies = S.DEFAULT_ARMIES.map(function (a) { return Object.assign({}, a, { units: a.units.slice() }); });
  var levels = null;
  var explore = null;             // 探索模式的地圖 (S.makeExplore)；一般戰鬥為 null
  var extra = {};                 // 其他戰鬥參數：eliteChance (敵兵成為精英的機率)、ilvl (掉落的物品等級)
  var battle, running = false, speed = 1, last = 0, acc = 0, tableT = 0;
  var active = false;             // 正式出征中 (營地預覽時為 false：不能下令、不能開始)
  var overFired = false;
  var rowById = {}, rosterSize = 0;
  var SIDE_NAMES = ['我軍', '敵軍'];
  var SHORT = { spear: '槍', archer: '弓', cavalry: '騎' };
  var humanSide = 0;              // 玩家固定操控藍軍
  var aiming = null;              // 正在瞄準的計策 id
  var commanding = false;         // 操控主將中：點地面移動、點敵人攻擊
  var mouseTile = null, hoverUnit = null;
  var hintT = 0, uiT = 0, logLen = -1;

  function newBattle() {
    battle = S.currentBattle = new S.Battle(armies, { control: [true, false], autoTactics: [chkAutoTac.checked, false],
                                                      levels: levels, explore: explore,
                                                      eliteChance: extra.eliteChance, ilvl: extra.ilvl, mf: extra.mf });   // S.currentBattle：方便在主控台除錯
    battle.setStance(humanSide, stanceKey);
    running = false;
    overFired = false;
    acc = 0;
    logLen = -1;
    cancelAim();
    setCommanding(false);
    buildRoster();
    updateUI();
    updateTactics();
    updateLog();
  }

  function updateUI() {
    btnStart.hidden = btnRetreat.hidden = !active;   // 速度與兵力條一直顯示，暫停 / 撤退只在戰鬥中
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

  // ---- 主將技能與陣型 ----
  function doDash() {
    if (!canCommand()) return;
    var g = battle.generals[humanSide];
    if (!g || g.dead) return;
    var dx, dy;
    if (mouseWorld) { dx = mouseWorld.x - g.posX(); dy = mouseWorld.y - g.posY(); }
    else {                        // 沒有滑鼠 (觸控)：衝向最近的敵人
      var best = null, bd = 1e9;
      battle.alive(1 - humanSide).forEach(function (e) {
        var d = Math.max(Math.abs(e.x - g.x), Math.abs(e.y - g.y));
        if (d < bd && battle.isVisible(e.x, e.y)) { bd = d; best = e; }
      });
      dx = best ? best.x - g.x : g.facing; dy = best ? best.y - g.y : 0;
    }
    var why = battle.generalDash(humanSide, dx, dy);
    if (why) hint(S.GENERAL_SKILLS_DEF.dash.name + '：' + why);
    updateTactics();
  }
  function doWhirl() {
    if (!canCommand()) return;
    var why = battle.generalWhirl(humanSide);
    if (why) hint(S.GENERAL_SKILLS_DEF.whirl.name + '：' + why);
    updateTactics();
  }
  function setStanceKey(k, user) {
    stanceKey = k;
    if (battle) battle.setStance(humanSide, k);
    Array.prototype.forEach.call(stanceBtns, function (b) { b.classList.toggle('on', b.dataset.stance === k); });
    if (user) { hint('陣型：' + S.STANCES[k].name + '（' + S.STANCES[k].desc + '）'); if (S.game.onSettings) S.game.onSettings(); }
  }
  btnDash.addEventListener('click', doDash);
  btnWhirl.addEventListener('click', doWhirl);
  btnDash.title = S.GENERAL_SKILLS_DEF.dash.desc;
  btnWhirl.title = S.GENERAL_SKILLS_DEF.whirl.desc;
  Array.prototype.forEach.call(stanceBtns, function (b) {
    b.title = S.STANCES[b.dataset.stance].desc;
    b.addEventListener('click', function () { setStanceKey(b.dataset.stance, true); b.blur(); });
  });
  setStanceKey('free');
  btnCommand.addEventListener('click', function () { setCommanding(!commanding); updateTactics(); });

  function hint(text) { tacHint.textContent = text; hintT = 2.5; }

  function canCommand() { return active && battle.state === 'fighting'; }

  function onTactic(id) {
    if (!canCommand()) return;
    if (aiming === id) { cancelAim(); updateTactics(); return; }
    var why = battle.tacticBlocked(humanSide, id);
    if (why) { hint(S.TACTICS[id].name + '：' + why); return; }
    if (S.TACTICS[id].target) {
      setCommanding(false);
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

  // 操控主將模式
  function setCommanding(on) {
    on = on && canCommand() && battle.generalAlive(humanSide);
    if (on && aiming) cancelAim();
    commanding = renderer.commanding = !!on;
    canvas.classList.toggle('commanding', commanding);
    if (on) hint('操控' + armies[humanSide].name + '：點地面移動（右鍵 / Esc 結束）');
  }

  function commandAt(tile, unit) {
    var ok;
    if (unit && unit.side !== humanSide) {
      ok = battle.commandGeneral(humanSide, { kind: 'attack', target: unit });
      hint(ok ? '攻擊' + unit.name + '！' : '無法攻擊');
    } else {
      ok = battle.commandGeneral(humanSide, { kind: 'move', x: tile.x, y: tile.y });
      hint(ok ? '移動到指定位置' : '無法移動到那裡');
    }
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
    btnGeneral.innerHTML = (g && g.engaged ? '主將待命' : '主將出陣') + '<kbd>Q</kbd>';
    btnGeneral.title = g && g.engaged ? '主將退回後方待機，只反擊射程內的敵人' : '主將親自上陣衝殺';
    btnGeneral.disabled = !alive || !canCommand();
    if (commanding && (!alive || !canCommand())) setCommanding(false);
    btnCommand.disabled = !alive || !canCommand();
    [['dash', btnDash], ['whirl', btnWhirl]].forEach(function (p) {
      var def = S.GENERAL_SKILLS_DEF[p[0]], cd = battle.skillCooldown(side, p[0]);
      p[1].innerHTML = def.name + (cd > 0 ? '<small>' + Math.ceil(cd) + 's</small>' : '') + '<kbd>' + def.key + '</kbd>';
      p[1].disabled = !canCommand() || !!battle.skillBlocked(side, p[0]);
    });
    btnCommand.classList.toggle('aiming', commanding);
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
    if (!ids.length) return '<td class="skill">—</td>';   // 士兵角色可能沒有物理或魔法技能 (四個技能都是另一類或被動)
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
      // 探索模式的敵軍太多，只列敵將
      var rows = battle.units.filter(function (u) { return u.side === side && (!explore || side === 0 || u.isGeneral); }).map(function (u) {
        var label = (u.isGeneral || u.named ? u.name : u.name + (++numbers[u.type])) +
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

  // 滑鼠位置 → 戰場格子與該處的單位 (點擊時也重算，手機點擊沒有 mousemove)
  // 探索模式加上鏡頭位移換成地圖座標；指到下方面板不算
  function locate(e) {
    var sx = e.offsetX / canvas.clientWidth * S.VIEW_W;
    var sy = e.offsetY / canvas.clientHeight * S.VIEW_H;
    mouseTile = hoverUnit = null;
    if (sy >= S.FIELD_H) return;
    var lx = sx + renderer.cam.x, ly = sy + renderer.cam.y;
    mouseWorld = { x: lx / S.TILE - 0.5, y: ly / S.TILE - 0.5 };
    var tx = Math.floor(lx / S.TILE), ty = Math.floor(ly / S.TILE);
    mouseTile = battle.inBounds(tx, ty) ? { x: tx, y: ty } : null;
    battle.units.forEach(function (u) {
      if (u.dead || !battle.here(u) || !battle.isVisible(u.x, u.y)) return;
      var x = u.posX() * S.TILE, y = u.posY() * S.TILE;
      if (lx >= x && lx < x + S.TILE && ly >= y && ly < y + S.TILE) hoverUnit = u;
    });
  }

  // 滑鼠指到戰場上的單位 → 表格對應列高亮；瞄準計策；指到寶箱 / 可操控的主將
  canvas.addEventListener('mousemove', function (e) {
    locate(e);
    updateAim();
    renderer.hoverChest = mouseTile && active && !aiming && !commanding ? battle.chestAt(mouseTile.x, mouseTile.y) : null;
    var myGeneral = hoverUnit && hoverUnit === battle.generals[humanSide] && canCommand();
    canvas.classList.toggle('pointer', !!renderer.hoverChest || !!myGeneral);
    canvas.classList.toggle('commanding', commanding);
    canvas.classList.toggle('attack', !!hoverUnit && hoverUnit.side !== humanSide && canCommand() && !aiming);
    setHighlight(hoverUnit ? hoverUnit.id : -1);
  });
  canvas.addEventListener('mouseleave', function () {
    setHighlight(-1);
    mouseTile = hoverUnit = null;
    renderer.hoverChest = null;
    updateAim();
  });

  // 點擊：瞄準中 → 施放計策；操控主將中 → 移動 / 攻擊；點自己的主將 → 開始操控；點到寶箱 → 派最近的士兵去撿
  canvas.addEventListener('click', function (e) {
    locate(e);
    if (!canCommand() || !mouseTile) return;
    if (aiming) {
      if (battle.useTactic(humanSide, aiming, mouseTile.x, mouseTile.y)) { cancelAim(); hint(''); }
      else hint('範圍內沒有敵軍');
      updateTactics();
      return;
    }
    var myGeneral = battle.generals[humanSide];
    if (hoverUnit && hoverUnit.side !== humanSide) {   // 左鍵點敵人：主將攻擊這個目標
      commandAt(mouseTile, hoverUnit);
      return;
    }
    var portal = explore && battle.portalAt(mouseTile.x, mouseTile.y);
    if (portal && battle.seen[battle.idx(portal.x, portal.y)]) {   // 點洞穴入口 / 出口：主將走過去並進入
      var okP = battle.commandGeneral(humanSide, { kind: 'move', x: portal.x, y: portal.y });
      hint(okP ? (portal.exit ? '走向出口' : '前往 ' + portal.name) : '無法前往');
      return;
    }
    if (explore) { hint('用 W A S D 移動主將，點敵人攻擊；走進洞穴入口可以切換場景'); return; }
    if (hoverUnit && hoverUnit === myGeneral) {
      setCommanding(!commanding);
      if (!commanding) hint('');
      updateTactics();
      return;
    }
    if (commanding) { commandAt(mouseTile, hoverUnit); return; }
    var chest = battle.chestAt(mouseTile.x, mouseTile.y);
    if (chest) {
      var u = battle.fetchChest(humanSide, chest);
      hint(u ? '派' + u.name + '去撿寶箱' : '沒有部隊能到達寶箱');
    }
  });
  canvas.addEventListener('contextmenu', function (e) {
    if (aiming) { e.preventDefault(); cancelAim(); hint(''); updateTactics(); }
    else if (commanding) { e.preventDefault(); setCommanding(false); hint(''); updateTactics(); }
    else if (canCommand()) {      // 右鍵敵人：全軍集火
      e.preventDefault();
      locate(e);
      if (hoverUnit && hoverUnit.side !== humanSide && battle.setFocus(humanSide, hoverUnit)) hint('全軍集火：' + hoverUnit.name);
    }
  });

  function toggle() {
    if (!active || battle.state === 'over') return;
    running = !running;
    updateUI();
  }

  // 音效：取出戰鬥登記的事件播放；探索模式依離畫面中心的距離調整音量，太遠就不播
  function playSfx() {
    if (!battle.sfx.length) return;
    var list = battle.sfx;
    battle.sfx = [];
    if (!S.Sound) return;
    var cx = (renderer.cam.x + S.FIELD_W / 2) / S.TILE, cy = (renderer.cam.y + S.FIELD_H / 2) / S.TILE;
    list.forEach(function (ev) {
      var vol = 1;
      if (explore && ev.x != null) {
        var d = Math.max(Math.abs(ev.x - cx), Math.abs(ev.y - cy));
        if (d > 22) return;
        vol = d < 10 ? 1 : 1 - (d - 10) / 16;
      }
      S.Sound.play(ev.n, vol);
    });
  }
  btnSound.addEventListener('click', function () {
    S.Sound.cycle();
    btnSound.textContent = S.Sound.icon();
    btnSound.blur();
    if (S.game.onSettings) S.game.onSettings();
  });

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
    playSfx();
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
  // 速度按鈕 (+ / − 快捷鍵切換)
  var SPEEDS = [1, 2, 4, 8];
  function setSpeed(v, user) {
    speed = SPEEDS.indexOf(v) >= 0 ? v : 1;
    Array.prototype.forEach.call(speedEl.querySelectorAll('[data-speed]'), function (b) {
      b.classList.toggle('on', Number(b.dataset.speed) === speed);
    });
    if (user && S.game.onSettings) S.game.onSettings();
  }
  speedEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-speed]');
    if (b) { setSpeed(Number(b.dataset.speed), true); b.blur(); }
  });
  setSpeed(1);
  chkAutoTac.addEventListener('change', function () {
    battle.autoTactics[0] = chkAutoTac.checked;
    hint(chkAutoTac.checked ? '計策交給電腦判斷施放（你仍可手動施放）' : '計策改由你手動施放');
    if (S.game.onSettings) S.game.onSettings();
  });
  chkBars.addEventListener('change', function () {
    renderer.showBars = chkBars.checked;
    if (S.game.onSettings) S.game.onSettings();
  });
  // ---- WASD / 方向鍵 直接操控主將 ----
  var WALK_KEYS = { KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0],
                    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  var held = {};                  // 目前按住的方向 (鍵盤或螢幕方向鍵)
  function applyWalk() {
    var dx = 0, dy = 0;
    Object.keys(held).forEach(function (k) { if (held[k]) { dx += held[k][0]; dy += held[k][1]; } });
    dx = Math.sign(dx); dy = Math.sign(dy);
    if (battle && active) battle.setWalk(humanSide, dx, dy);
  }
  function releaseAll() { held = {}; applyWalk(); }
  window.addEventListener('blur', releaseAll);
  document.addEventListener('keyup', function (e) {
    if (WALK_KEYS[e.code] && held[e.code]) { delete held[e.code]; applyWalk(); }
  });
  // 觸控裝置的方向搖桿 (疊在戰場左下角)：手指在圓盤上的方向 → 八方位，放開就停
  var pad = document.querySelector('.dpad'), knob = pad.querySelector('.knob'), padPointer = null;
  function padMove(e) {
    var r = pad.getBoundingClientRect(), R = r.width / 2;
    var vx = e.clientX - (r.left + R), vy = e.clientY - (r.top + R), dist = Math.sqrt(vx * vx + vy * vy);
    var reach = Math.min(dist, R * 0.4) / Math.max(dist, 1);          // 小圓點跟著手指，但不超出圓盤
    knob.style.transform = 'translate(' + Math.round(vx * reach) + 'px,' + Math.round(vy * reach) + 'px)';
    if (dist < R * 0.22) { delete held.pad; applyWalk(); return; }   // 太靠近中心：不動
    var oct = Math.round(Math.atan2(vy, vx) / (Math.PI / 4));          // 八方位
    var DIRS8 = { 0: [1, 0], 1: [1, 1], 2: [0, 1], 3: [-1, 1], 4: [-1, 0], '-4': [-1, 0], '-3': [-1, -1], '-2': [0, -1], '-1': [1, -1] };
    held.pad = DIRS8[oct];
    applyWalk();
  }
  function padEnd(e) {
    if (e.pointerId !== padPointer) return;
    padPointer = null;
    pad.classList.remove('on');
    knob.style.transform = '';
    delete held.pad;
    applyWalk();
  }
  pad.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    padPointer = e.pointerId;
    try { pad.setPointerCapture(e.pointerId); } catch (err) {}
    pad.classList.add('on');
    padMove(e);
  });
  pad.addEventListener('pointermove', function (e) { if (e.pointerId === padPointer) { e.preventDefault(); padMove(e); } });
  pad.addEventListener('pointerup', padEnd);
  pad.addEventListener('pointercancel', padEnd);
  pad.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  // 有些裝置的 (pointer: coarse) 判斷不準：一碰觸控螢幕就顯示搖桿
  window.addEventListener('touchstart', function () { document.body.classList.add('touch'); }, { once: true, passive: true });

  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' ||
        (t.tagName === 'INPUT' && t.type !== 'checkbox')) return;
    var si = SPEEDS.indexOf(speed);
    if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') { setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, si + 1)], true); return; }
    if (e.key === '-' || e.code === 'NumpadSubtract') { setSpeed(SPEEDS[Math.max(0, si - 1)], true); return; }
    if (!active) return;
    if (WALK_KEYS[e.code]) {
      e.preventDefault();         // 方向鍵不要捲動網頁
      if (!held[e.code]) { held[e.code] = WALK_KEYS[e.code]; applyWalk(); }
      return;
    }
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { if (!e.repeat) doDash(); }
    else if (e.code === 'KeyF') { if (!e.repeat) doWhirl(); }
    else if (e.code === 'KeyZ') setStanceKey('tight', true);
    else if (e.code === 'KeyX') setStanceKey('spread', true);
    else if (e.code === 'KeyC') setStanceKey('free', true);
    else if (e.code === 'KeyQ') toggleGeneral();
    else if (e.code === 'KeyE') { setCommanding(!commanding); updateTactics(); }
    else if (e.code === 'Escape') { cancelAim(); setCommanding(false); hint(''); updateTactics(); }
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
    // ex：探索模式的地圖 (S.makeExplore)，一般戰鬥省略
    setup: function (newArmies, lv, ex, opts) {
      armies = newArmies;
      levels = lv;
      explore = ex || null;
      extra = opts || {};
      active = false;
      newBattle();
    },
    // 探索模式途中撿到的裝備
    getLoot: function () { return (battle && battle.lootFound) || []; },
    getExpBonus: function () { return (battle && battle.expBonus) || 0; },   // 經驗壇
    getRecruited: function () { return (battle && battle.recruited) || []; },   // 被收服的流浪武者
    isExplore: function () { return !!explore; },
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
      held = {};
      active = false;
      running = false;
      cancelAim();
      setCommanding(false);
      updateUI();
      updateTactics();
    },
    setCaption: function (c) { renderer.caption = c; },
    getSettings: function () { return { speed: speed, bars: chkBars.checked, autoTactics: chkAutoTac.checked, sound: S.Sound.level, stance: stanceKey }; },
    applySettings: function (set) {
      set = set || {};
      if (set.speed) setSpeed(Number(set.speed));
      if (set.bars != null) { chkBars.checked = !!set.bars; renderer.showBars = chkBars.checked; }
      if (set.stance && S.STANCES[set.stance]) setStanceKey(set.stance);
      if (set.sound != null) { S.Sound.setLevel(set.sound); btnSound.textContent = S.Sound.icon(); }
      if (set.autoTactics != null) { chkAutoTac.checked = !!set.autoTactics; if (battle) battle.autoTactics[0] = chkAutoTac.checked; }
    }
  };

  newBattle();
  requestAnimationFrame(frame);
})(window.Sango);
