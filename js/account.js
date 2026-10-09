/*
 * 帳號登入與進度儲存
 *   登入：進度存在 Supabase 的 saves 表 (設定見 js/supabase-config.js)
 *   未登入：以訪客身分遊玩，進度存在這台裝置的瀏覽器 (localStorage)
 * 給 js/campaign.js 用的介面：S.store.ready / load() / save(profile)，登入狀態改變時呼叫 S.store.onChange()
 */
(function (S) {
  'use strict';

  var bar = document.getElementById('account');
  var cfg = window.SANGO_SUPABASE || {};
  var GUEST_KEY = 'sango-guest-profile';
  var VERSION = 2;                // 進度格式版本 (舊版的自由對戰存檔不相容)

  var client = null, user = null;
  var writing = Promise.resolve();
  var readyResolve;

  var store = S.store = {
    ready: new Promise(function (r) { readyResolve = r; }),
    onChange: null,
    isCloud: function () { return !!user; },
    load: function () { return user ? loadCloud() : Promise.resolve(loadGuest()); },
    save: function (profile) {
      if (profile) profile.version = VERSION;
      return user ? saveCloud(profile) : Promise.resolve(saveGuest(profile));
    }
  };

  function valid(p) { return p && p.version === VERSION && p.general ? p : null; }

  // ======================= 訪客 (localStorage) =======================
  function loadGuest() {
    try { return valid(JSON.parse(localStorage.getItem(GUEST_KEY))); } catch (e) { return null; }
  }
  function saveGuest(profile) {
    try {
      if (profile) localStorage.setItem(GUEST_KEY, JSON.stringify(profile));
      else localStorage.removeItem(GUEST_KEY);
    } catch (e) { message('瀏覽器無法儲存進度', true); }
  }

  // ======================= Supabase =======================
  function loadCloud() {
    return client.from('saves').select('data').eq('user_id', user.id).maybeSingle().then(function (r) {
      if (r.error) throw r.error;
      var p = valid(r.data && r.data.data);
      if (p) return p;
      // 帳號裡還沒有進度：把這台裝置的訪客進度帶進來
      var guest = loadGuest();
      if (!guest) return null;
      return saveCloud(guest).then(function () {
        saveGuest(null);
        message('已把訪客進度存到帳號');
        return guest;
      });
    });
  }

  function saveCloud(profile) {
    var row = { user_id: user.id, data: profile || {}, updated_at: new Date().toISOString() };
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

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

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
    message(msg || '訪客模式：進度只存在這台裝置，登入後可存到雲端、換裝置繼續玩', isError);
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
        setUser(r.data.session.user, act === 'register' ? '註冊成功！' : '');
      }).catch(function (err) { message(errText(err), true); });
    });
  }

  function renderLoggedIn(msg) {
    var name = (user.email || '').split('@')[0];
    bar.innerHTML =
      '<span class="acc-user" title="' + esc(user.email || '') + '">👤 ' + esc(name) + '</span>' +
      '<span class="acc-note">進度自動存到雲端</span>' +
      '<button data-act="logout">登出</button>' +
      '<span class="acc-msg"></span>';
    message(msg || '');
    bar.querySelector('[data-act=logout]').addEventListener('click', function () { client.auth.signOut(); });
  }

  function message(text, isError) {
    var el = bar.querySelector('.acc-msg');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('error', !!isError);
  }

  function setUser(u, msg) {
    user = u;
    if (u) renderLoggedIn(msg); else renderLoggedOut(msg);
    if (store.onChange) store.onChange();
  }

  // ======================= 啟動 =======================
  if (!window.supabase || !cfg.url || /YOUR-/.test(cfg.url + cfg.key)) {
    bar.innerHTML = '<span class="acc-msg">尚未設定 Supabase（js/supabase-config.js），以訪客模式遊玩，進度只存在這台裝置</span>';
    readyResolve();
    return;
  }
  client = window.supabase.createClient(cfg.url, cfg.key);
  client.auth.onAuthStateChange(function (event) {
    if (event === 'SIGNED_OUT' && user) setUser(null, '已登出，切換為訪客模式');
  });
  client.auth.getSession().then(function (r) {
    var session = r.data && r.data.session;
    user = session ? session.user : null;
    if (user) renderLoggedIn(); else renderLoggedOut();
  }, function () { renderLoggedOut(); }).then(readyResolve);
})(window.Sango);
