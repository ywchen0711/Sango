/*
 * 帳號登入、存檔、經驗值與升級（資料存在 Supabase，設定見 js/supabase-config.js）
 *
 * Supabase 的 saves 表每位玩家一列，data 欄位內容：
 *   armies / settings：按「存檔」時的編成與設定（讀檔時套用）
 *   stats / exp / levels：戰績、經驗值、等級（有變化就自動儲存）
 */
(function (S) {
  'use strict';

  var bar = document.getElementById('account');
  var cfg = window.SANGO_SUPABASE || {};
  var LEVEL_NAMES = { general: '主將', spear: '槍兵', archer: '弓兵', cavalry: '騎兵' };

  var client = null, user = null;
  var loadout = null;             // { armies, settings } 最後一次手動存檔的內容
  var profile = null;             // { stats, exp, levels }
  var writing = Promise.resolve();

  function newProfile() {
    var levels = {};
    S.LEVEL_KEYS.forEach(function (k) { levels[k] = 0; });
    return { stats: { wins: 0, losses: 0, draws: 0, watched: 0 }, exp: 0, levels: levels };
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  // Supabase 的英文錯誤訊息翻成中文
  function errText(err) {
    var m = (err && err.message) || String(err);
    if (/Invalid login credentials/i.test(m)) return 'Email 或密碼錯誤';
    if (/already registered|already been registered/i.test(m)) return '這個 email 已經註冊過';
    if (/Email not confirmed/i.test(m)) return '請先到信箱點確認連結';
    if (/Password should be at least/i.test(m)) return '密碼至少需要 6 個字元';
    if (/invalid/i.test(m) && /email/i.test(m)) return 'Email 格式不正確';
    if (/Failed to fetch|NetworkError/i.test(m)) return '無法連線 Supabase';
    if (/rate limit/i.test(m)) return '嘗試次數太多，請稍後再試';
    return m;
  }

  // ======================= 畫面 =======================
  function renderLoggedOut(msg, isError) {
    bar.innerHTML =
      '<form class="login">' +
        '<input name="email" type="email" placeholder="Email" autocomplete="username" required>' +
        '<input name="password" type="password" placeholder="密碼（至少 6 字）" autocomplete="current-password" minlength="6" required>' +
        '<button type="submit" data-act="login">登入</button>' +
        '<button type="submit" data-act="register">註冊</button>' +
        '<span class="acc-msg"></span>' +
      '</form>';
    message(msg || '登入後可以存檔，戰鬥還能獲得經驗值升級部隊', isError);
    var form = bar.querySelector('form');
    var act = 'login';
    Array.prototype.forEach.call(form.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { act = b.dataset.act; });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var creds = { email: form.email.value.trim(), password: form.password.value };
      message(act === 'login' ? '登入中…' : '註冊中…');
      var req = act === 'login' ? client.auth.signInWithPassword(creds) : client.auth.signUp(creds);
      req.then(function (r) {
        if (r.error) throw r.error;
        if (!r.data.session) { message('註冊成功！請到信箱點確認連結後再登入'); return; }
        onSignedIn(r.data.session.user, act === 'register');
      }).catch(function (err) { message(errText(err), true); });
    });
  }

  function renderLoggedIn(msg, isError) {
    var st = profile.stats, cost = S.LEVEL.COST;
    var name = (user.email || '').split('@')[0];
    bar.innerHTML =
      '<div class="acc-row">' +
        '<span class="acc-user" title="' + esc(user.email || '') + '">👤 ' + esc(name) + '</span>' +
        '<span class="acc-stats">戰績 ' + st.wins + '勝 ' + st.losses + '敗 ' + st.draws + '和' +
          (st.watched ? '　觀戰 ' + st.watched : '') + '</span>' +
        '<button data-act="save">💾 存檔</button>' +
        '<button data-act="load">📂 讀檔</button>' +
        '<button data-act="logout">登出</button>' +
      '</div>' +
      '<div class="acc-row levels">' +
        '<span class="acc-exp" title="勝 +' + S.EXP.win + '、和 +' + S.EXP.draw + '、敗 +' + S.EXP.loss + '（觀戰不加）">' +
          '經驗值 <b>' + profile.exp + '</b></span>' +
        S.LEVEL_KEYS.map(function (k) {
          var lv = profile.levels[k] || 0;
          var max = lv >= S.LEVEL.MAX;
          return '<button class="lvup" data-lv="' + k + '"' + (max || profile.exp < cost ? ' disabled' : '') +
            ' title="' + (max ? '已達最高等級' : '花 ' + cost + ' 經驗值升到 Lv' + (lv + 1) +
            '（能力 +' + Math.round((lv + 1) * S.LEVEL.BONUS * 100) + '%）') + '">' +
            LEVEL_NAMES[k] + ' Lv' + lv + (max ? '' : ' ▲') + '</button>';
        }).join('') +
        '<span class="acc-msg"></span>' +
      '</div>';
    message(msg || '', isError);
    bar.querySelector('[data-act=save]').addEventListener('click', saveLoadout);
    bar.querySelector('[data-act=load]').addEventListener('click', function () { applyLoadout(true); });
    bar.querySelector('[data-act=logout]').addEventListener('click', function () { client.auth.signOut(); });
    Array.prototype.forEach.call(bar.querySelectorAll('[data-lv]'), function (b) {
      b.addEventListener('click', function () { levelUp(b.dataset.lv); });
    });
  }

  function message(text, isError) {
    var el = bar.querySelector('.acc-msg');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('error', !!isError);
  }

  // ======================= 資料庫 =======================
  function writeRow() {
    var data = Object.assign({}, loadout || {}, profile);
    var row = { user_id: user.id, data: data, updated_at: new Date().toISOString() };
    // 依序寫入，避免兩次寫入互相覆蓋
    writing = writing.then(function () {
      return client.from('saves').upsert(row).then(function (r) { if (r.error) throw r.error; });
    });
    return writing.catch(function (err) {
      writing = Promise.resolve();
      message('儲存失敗：' + errText(err), true);
      throw err;
    });
  }

  function onSignedIn(u, isNew) {
    user = u;
    message('讀取存檔中…');
    client.from('saves').select('data, updated_at').eq('user_id', u.id).maybeSingle().then(function (r) {
      if (r.error) throw r.error;
      var d = r.data && r.data.data;
      profile = newProfile();
      loadout = null;
      if (d) {
        Object.assign(profile.stats, d.stats);
        profile.exp = Number(d.exp) || 0;
        Object.assign(profile.levels, d.levels);
        if (d.armies) loadout = { armies: d.armies, settings: d.settings, savedAt: r.data.updated_at };
      }
      S.game.setLevels(profile.levels);
      if (loadout) applyLoadout(false);
      else renderLoggedIn(isNew ? '註冊成功！打完一場就能獲得經驗值' : '歡迎！目前還沒有存檔');
    }).catch(function (err) {
      profile = null;
      renderLoggedOut('讀取存檔失敗：' + errText(err), true);
    });
  }

  function saveLoadout() {
    var st = S.game.getState();
    loadout = { armies: st.armies, settings: st.settings };
    writeRow().then(function () { renderLoggedIn('已存檔 ' + new Date().toLocaleTimeString()); }, function () {});
  }

  function applyLoadout(manual) {
    if (!loadout) { renderLoggedIn('沒有存檔', manual); return; }
    S.game.applyState(loadout);
    renderLoggedIn('已讀取' + (loadout.savedAt ? ' ' + new Date(loadout.savedAt).toLocaleString() + ' 的' : '') + '存檔');
  }

  function levelUp(key) {
    var lv = profile.levels[key] || 0;
    if (profile.exp < S.LEVEL.COST || lv >= S.LEVEL.MAX) return;
    profile.exp -= S.LEVEL.COST;
    profile.levels[key] = lv + 1;
    var applied = S.game.setLevels(profile.levels);
    renderLoggedIn(LEVEL_NAMES[key] + ' 升到 Lv' + (lv + 1) + '！' + (applied ? '' : '下一場戰鬥生效'));
    writeRow().catch(function () {});
  }

  // 戰鬥結束 → 記錄戰績、獲得經驗值
  S.onBattleOver = function (winner, humanSide) {
    if (!user || !profile) return;
    var gain = 0, st = profile.stats;
    if (humanSide < 0) st.watched++;
    else if (winner < 0) { st.draws++; gain = S.EXP.draw; }
    else if (winner === humanSide) { st.wins++; gain = S.EXP.win; }
    else { st.losses++; gain = S.EXP.loss; }
    profile.exp += gain;
    renderLoggedIn(humanSide < 0 ? '觀戰不會獲得經驗值' :
      (winner === humanSide ? '勝利！' : winner < 0 ? '平手。' : '敗北…') + '經驗值 +' + gain);
    writeRow().catch(function () {});
  };

  // ======================= 啟動 =======================
  if (!window.supabase || !cfg.url || /YOUR-/.test(cfg.url + cfg.key)) {
    bar.innerHTML = '<span class="acc-msg">尚未設定 Supabase（js/supabase-config.js），目前無法登入與存檔</span>';
    return;
  }
  client = window.supabase.createClient(cfg.url, cfg.key);
  client.auth.onAuthStateChange(function (event) {
    if (event === 'SIGNED_OUT') {
      user = profile = loadout = null;
      S.game.setLevels(null);
      renderLoggedOut('已登出');
    }
  });
  client.auth.getSession().then(function (r) {
    var session = r.data && r.data.session;
    if (session) { bar.innerHTML = '<span class="acc-msg"></span>'; onSignedIn(session.user, false); }
    else renderLoggedOut();
  });
})(window.Sango);
