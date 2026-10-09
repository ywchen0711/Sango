/*
 * 音效：全部用 Web Audio 即時合成 (不需要音檔)
 * 戰鬥邏輯只把事件放進 battle.sfx (見 battle.js 的 sound())，由 main.js 每一幀取出播放
 * 瀏覽器規定要等使用者第一次點擊 / 按鍵後才能出聲
 */
(function (S) {
  'use strict';

  var LEVELS = [0.8, 0.35, 0];                 // 大聲 / 小聲 / 靜音
  var ICONS = ['🔊', '🔉', '🔇'];
  var MAX_VOICES = 40;                         // 同時發聲的元件上限 (一個音效約 2–5 個)，大混戰時不會變成噪音
  var MIN_GAP = { hit: 0.045, arrow: 0.05, magic: 0.06, death: 0.05, skillPhys: 0.08, skillMagic: 0.08 };

  var ctx = null, master = null, noiseBuf = null, ends = [], last = {};
  var Snd = S.Sound = { level: 0 };

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = LEVELS[Snd.level];
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, ensure, true); });

  Snd.setLevel = function (i) {
    Snd.level = Math.max(0, Math.min(LEVELS.length - 1, i | 0));
    if (master) master.gain.value = LEVELS[Snd.level];
  };
  Snd.icon = function () { return ICONS[Snd.level]; };
  Snd.cycle = function () { Snd.setLevel((Snd.level + 1) % LEVELS.length); ensure(); return Snd.level; };
  Snd.played = 0;                              // 測試用：實際播出的音效數

  // ---- 合成元件 ----
  // 振盪器：freq → to (滑音)，type 波形，dur 秒，vol 音量，at 延遲
  function tone(freq, dur, type, vol, to, at, attack) {
    var t0 = ctx.currentTime + (at || 0);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(out);
    o.start(t0); o.stop(t0 + dur + 0.02);
    ends.push(t0 + dur);
  }
  // 雜訊：經過濾波器 (type、頻率 f → f2)
  function noise(dur, vol, ftype, f, f2, at, q) {
    var t0 = ctx.currentTime + (at || 0);
    var src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf;
    src.loop = true;
    flt.type = ftype || 'bandpass';
    flt.frequency.setValueAtTime(f || 1000, t0);
    if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    flt.Q.value = q || 1;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt); flt.connect(g); g.connect(out);
    src.start(t0); src.stop(t0 + dur + 0.02);
    ends.push(t0 + dur);
  }
  function arp(notes, step, dur, type, vol, at) {
    notes.forEach(function (f, i) { tone(f, dur, type, vol, null, (at || 0) + i * step); });
  }
  var out = null;                              // 目前這個音效的輸出 (帶有距離音量)

  // ---- 音效表 ----
  var FX = {
    hit:         function () { noise(0.08, 0.35, 'bandpass', 1800, 500, 0, 1.2); tone(160, 0.07, 'square', 0.08, 80); },
    arrow:       function () { noise(0.13, 0.12, 'highpass', 5000, 2000); tone(1300, 0.1, 'sine', 0.04, 700); },
    magic:       function () { tone(600, 0.18, 'sine', 0.1, 1300); tone(900, 0.15, 'triangle', 0.05, 1800, 0.03); },
    skillPhys:   function () { noise(0.16, 0.3, 'bandpass', 1200, 300, 0, 2); tone(220, 0.14, 'sawtooth', 0.08, 110); },
    skillMagic:  function () { arp([660, 880, 1320], 0.05, 0.12, 'sine', 0.09); },
    heal:        function () { tone(523, 0.3, 'sine', 0.1, 784, 0, 0.03); tone(659, 0.3, 'sine', 0.07, 988, 0.08, 0.03); },
    rally:       function () { tone(220, 0.3, 'sawtooth', 0.07, null, 0, 0.02); tone(330, 0.35, 'sawtooth', 0.07, null, 0.12, 0.02); },
    tac_fire:    function () { noise(0.7, 0.4, 'lowpass', 400, 2600); tone(120, 0.5, 'sawtooth', 0.12, 50); },
    tac_thunder: function () { noise(0.06, 0.5, 'highpass', 3000); noise(1.1, 0.45, 'lowpass', 500, 120, 0.04); tone(70, 0.8, 'sine', 0.3, 40, 0.04); },
    tac_rally:   function () { arp([220, 277, 330, 440], 0.1, 0.3, 'sawtooth', 0.07); },
    tac_guard:   function () { tone(196, 0.5, 'square', 0.06, null, 0, 0.03); tone(247, 0.5, 'square', 0.05, null, 0.05, 0.03); noise(0.2, 0.15, 'bandpass', 2500, 1200, 0, 3); },
    death:       function () { tone(220, 0.25, 'square', 0.07, 60); noise(0.12, 0.15, 'lowpass', 900, 200); },
    generalDeath:function () { tone(300, 0.9, 'sawtooth', 0.12, 70); tone(110, 1.2, 'sine', 0.25, 55); noise(0.4, 0.2, 'lowpass', 600, 100); },
    chest:       function () { tone(880, 0.07, 'square', 0.06); tone(1175, 0.1, 'square', 0.06, null, 0.07); },
    boom:        function () { noise(0.6, 0.6, 'lowpass', 1500, 150); tone(90, 0.45, 'sine', 0.45, 35); },
    summon:      function () { tone(250, 0.45, 'triangle', 0.12, 900); tone(375, 0.45, 'triangle', 0.08, 1350, 0.1); },
    alert:       function () { tone(1400, 0.05, 'square', 0.06); tone(1400, 0.05, 'square', 0.06, null, 0.08); },
    bossAlert:   function () { tone(80, 0.5, 'sine', 0.5, 45); tone(80, 0.5, 'sine', 0.5, 45, 0.35); tone(110, 0.9, 'sawtooth', 0.06, 98, 0.1, 0.1); },
    shrine:      function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 1.0, 'sine', 0.07, null, i * 0.06, 0.15); }); },
    reinforce:   function () { tone(330, 0.2, 'sawtooth', 0.07); tone(440, 0.3, 'sawtooth', 0.07, null, 0.15); },
    loot_normal: function () { tone(700, 0.06, 'square', 0.05); },
    loot_magic:  function () { tone(880, 0.15, 'sine', 0.1, 1320); },
    loot_rare:   function () { arp([988, 1319, 1568], 0.06, 0.18, 'triangle', 0.1); },
    loot_set:    function () { arp([784, 988, 1175, 1568], 0.07, 0.3, 'sine', 0.11); },
    loot_unique: function () {           // 暗金：銅鑼般的長尾音
      tone(220, 1.6, 'sine', 0.25, null, 0, 0.005); tone(441, 1.2, 'sine', 0.12); tone(663, 0.9, 'sine', 0.08);
      tone(1760, 0.6, 'triangle', 0.04, null, 0.05); noise(0.3, 0.1, 'bandpass', 4000, 2000, 0, 4);
    },
    coin:        function () { tone(1319, 0.06, 'square', 0.06); tone(1760, 0.12, 'square', 0.06, null, 0.06); },
    equip:       function () { noise(0.06, 0.25, 'bandpass', 3000, 1500, 0, 3); tone(400, 0.08, 'square', 0.05, 300); },
    levelup:     function () { arp([523, 659, 784, 1047], 0.07, 0.2, 'triangle', 0.1); },
    win:         function () { arp([523, 587, 659, 784, 880], 0.11, 0.18, 'square', 0.07); [523, 659, 784, 1047].forEach(function (f) { tone(f, 1.0, 'triangle', 0.07, null, 0.6, 0.02); }); },
    lose:        function () { arp([392, 349, 311], 0.25, 0.4, 'sawtooth', 0.06); tone(262, 1.2, 'sawtooth', 0.07, 196, 0.75); }
  };

  // 播放：vol 為距離造成的音量比例 (0–1)
  Snd.play = function (name, vol) {
    if (!FX[name] || Snd.level === LEVELS.length - 1 || !ctx || ctx.state !== 'running') return false;
    var now = ctx.currentTime, gap = MIN_GAP[name] || 0.03;
    // 依預計結束時間計算還在發聲的數量 (不靠 onended，分頁切到背景再回來也不會卡住)
    ends = ends.filter(function (t) { return t > now; });
    if (ends.length >= MAX_VOICES) return false;
    if (last[name] != null && now - last[name] < gap) return false;
    last[name] = now;
    out = ctx.createGain();
    out.gain.value = vol == null ? 1 : vol;
    out.connect(master);
    FX[name]();
    Snd.played++;
    return true;
  };
  Snd.names = function () { return Object.keys(FX); };
  Snd.time = function () { return ctx ? ctx.currentTime : -1; };   // 測試用
})(window.Sango);
