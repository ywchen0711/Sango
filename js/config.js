/*
 * 三國志 霸王的大陸 風格 自動戰鬥 — 參數設定
 * 調整數值、地圖、陣型、雙方武將與兵種編成都在這個檔案。
 */
window.Sango = window.Sango || {};

(function (S) {
  'use strict';

  // ---- 畫面 (戰場 32x22 格，邏輯解析度 512x416，放大 SCALE 倍) ----
  S.TILE = 16;
  S.COLS = 32;
  S.ROWS = 22;
  S.FIELD_W = S.COLS * S.TILE;          // 512
  S.FIELD_H = S.ROWS * S.TILE;          // 352
  S.PANEL_H = 64;
  S.VIEW_W = S.FIELD_W;
  S.VIEW_H = S.FIELD_H + S.PANEL_H;     // 416
  S.SCALE = 3;
  S.SIM_DT = 1 / 60;                    // 固定模擬步長 (秒)

  // ---- 地圖：'#' 城牆 (不可通行)，'.' 地面 ----
  // 左右、上下對稱：中央兩座城寨、中路石柱分出三條路、兩翼岩石
  S.MAP = [
    '................................',
    '................................',
    '............#......#............',
    '............#......#............',
    '.......##...#......#...##.......',
    '.......##...#......#...##.......',
    '............########............',
    '................................',
    '................................',
    '..........#..........#..........',
    '..........#..........#..........',
    '..........#..........#..........',
    '..........#..........#..........',
    '................................',
    '................................',
    '............########............',
    '.......##...#......#...##.......',
    '.......##...#......#...##.......',
    '............#......#............',
    '............#......#............',
    '................................',
    '................................'
  ];

  // ---- 兵種 ----
  // hp: 兵力  mp: 魔力  atk: 攻擊  def: 防禦  int: 智力 (魔法攻擊)  spr: 精神 (魔法防禦)
  // range: 射程(格)  moveTime: 走一格秒數  attackTime: 攻擊間隔秒數
  // 士兵的每項數值在開戰時隨機浮動 ±STAT_VARIANCE
  S.UNIT_TYPES = {
    spear:   { name: S.t('槍兵'), hp: 200, mp: 40, atk: 12, def: 10, int: 5, spr: 7,
               range: 1, moveTime: 0.50, attackTime: 1.0 },
    archer:  { name: S.t('弓兵'), hp: 180, mp: 60, atk: 10, def: 6,  int: 8, spr: 9,
               range: 4, moveTime: 0.55, attackTime: 1.4,
               ranged: true, meleePenalty: 0.5 },       // 被貼身時物理攻擊減半
    cavalry: { name: S.t('騎兵'), hp: 190, mp: 30, atk: 13, def: 8,  int: 4, spr: 5,
               range: 1, moveTime: 0.28, attackTime: 1.1,
               chargeBonus: 1.3 },                       // 移動後第一擊衝鋒加成
    // 主將：與士兵同一尺度，再依武將能力加成 (見 S.GENERAL_STATS)，一樣有隨機浮動
    general: { name: S.t('主將'), hp: 0, mp: 30, atk: 6, def: 8, int: 4, spr: 6,
               range: 1, moveTime: 0.40, attackTime: 0.9 },
    // 野外的動物 (探索模式)：能力會隨關卡成長，見 explore.js 的 S.ANIMALS
    wolf: { name: S.t('野狼'), hp: 115, mp: 0, atk: 10, def: 6, int: 0, spr: 4, range: 1, moveTime: 0.32, attackTime: 0.9, beast: true },
    boar: { name: S.t('野豬'), hp: 190, mp: 0, atk: 13, def: 9, int: 0, spr: 4, range: 1, moveTime: 0.36, attackTime: 1.2, beast: true },
    bear: { name: S.t('熊'), hp: 420, mp: 0, atk: 18, def: 12, int: 0, spr: 8, range: 1, moveTime: 0.55, attackTime: 1.5, beast: true },
    deer: { name: S.t('鹿'), hp: 90, mp: 0, atk: 1, def: 4, int: 0, spr: 3, range: 1, moveTime: 0.28, attackTime: 2.0, beast: true },
    tiger: { name: S.t('猛虎'), hp: 300, mp: 0, atk: 21, def: 10, int: 0, spr: 6, range: 1, moveTime: 0.30, attackTime: 1.0, beast: true },
    snake: { name: S.t('毒蛇'), hp: 110, mp: 0, atk: 12, def: 5, int: 0, spr: 4, range: 1, moveTime: 0.45, attackTime: 1.2, beast: true,
             venom: { ratio: 0.45, dur: 5 } },                // 咬到會中毒 (每秒損失 攻擊 × ratio)

    // ---- 敵軍特殊兵種 (只出現在敵方)：base = 相剋、布陣、等級都比照哪個基本兵種 ----
    // skills：固定的特技池 (phys / magic)；procs：天生的特效；fireWeak：受到火攻的傷害倍率；trample：普通攻擊波及周圍幾格
    rattan:   { name: S.t('藤甲兵'), base: 'spear', hp: 210, mp: 30, atk: 12, def: 16, int: 3, spr: 5,
                range: 1, moveTime: 0.55, attackTime: 1.1, fireWeak: 2,
                skills: { phys: ['shieldBash', 'sweep', 'pierce'], magic: ['guardian'] } },
    sorcerer: { name: S.t('黃巾術士'), base: 'archer', hp: 140, mp: 80, atk: 5, def: 5, int: 12, spr: 11,
                range: 3, moveTime: 0.55, attackTime: 1.5, ranged: true, meleePenalty: 0.5,
                skills: { phys: [], magic: ['fire', 'thunder', 'confuse', 'poison', 'ice', 'drain'] } },
    assassin: { name: S.t('刺客'), base: 'cavalry', hp: 145, mp: 30, atk: 15, def: 6, int: 4, spr: 6,
                range: 1, moveTime: 0.30, attackTime: 0.85, procs: { crit: 20 },
                skills: { phys: ['double', 'triple', 'execute', 'pierce'], magic: [] } },
    elephant: { name: S.t('戰象'), base: 'cavalry', hp: 280, mp: 20, atk: 14, def: 11, int: 2, spr: 6,
                range: 1, moveTime: 0.62, attackTime: 1.8, trample: 1,
                skills: { phys: ['sweep', 'knockStrike', 'charge'], magic: [] } }
  };
  S.ENEMY_KINDS = ['rattan', 'sorcerer', 'assassin', 'elephant'];
  // 兵種的「基本兵種」：相剋、布陣、等級加成都用它 (槍兵 / 弓兵 / 騎兵本身就是基本兵種)
  S.baseType = function (t) { var d = S.UNIT_TYPES[t]; return (d && d.base) || t; };
  S.STAT_VARIANCE = 0.15;

  // 主將數值 = 兵種基礎值 + 武將能力 × 係數
  // HP = 體力 ×5   MP = 智力 /2   攻擊 = 武力 /6   防禦 = 統率 /20   智力 = 智力 /8   精神 = 統率 /20
  S.GENERAL_STATS = {
    hp:  { from: 'hp',   ratio: 5 },
    mp:  { from: 'int',  ratio: 1 / 2 },
    atk: { from: 'war',  ratio: 1 / 6 },
    def: { from: 'lead', ratio: 1 / 20 },
    int: { from: 'int',  ratio: 1 / 8 },
    spr: { from: 'lead', ratio: 1 / 20 }
  };
  S.GENERAL_SKILLS = 2;            // 主將物理 / 魔法特技各幾個 (共四個)；士兵各一個

  // ---- 亂數：使用瀏覽器 / Node 的加密亂數源 (crypto)，不是固定種子 ----
  var cryptoObj = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto :
    (typeof require === 'function' ? require('crypto').webcrypto : null);
  var randBuf = new Uint32Array(256), randPos = randBuf.length;
  S.random = function () {
    if (!cryptoObj) return Math.random();
    if (randPos >= randBuf.length) { cryptoObj.getRandomValues(randBuf); randPos = 0; }
    return randBuf[randPos++] / 4294967296;
  };
  // 從清單隨機取 n 個不重複的元素
  S.pickDistinct = function (list, n, rng) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = (rng() * (i + 1)) | 0;
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a.slice(0, n);
  };

  // ---- 物理 / 魔法 ----
  // 每次攻擊隨機決定物理或魔法，魔法機率 = 智力 / (攻擊 + 智力)
  // 物理傷害：攻擊 vs 防禦，吃兵種相剋；魔法傷害：智力 vs 精神，無視相剋
  // 攻擊時若 MP 足夠，有 SKILL_CHANCE 機率改用對應的物理特技 / 魔法特技
  S.SKILL_CHANCE = 0.35;
  S.MP_REGEN = 1.5;                // 每秒回復 MP
  S.SUPPORT_RANGE = 3;             // 治療的施放距離

  // power: 傷害倍率  hits: 段數  area: 波及目標周圍幾格的敵人  ignoreDef: 無視防禦比例
  // debuff/buff: 數值倍率與秒數  burn: 每秒傷害 = 智力 × ratio  stun: 混亂秒數 (無法行動)
  S.SKILLS = {
    // 物理特技
    charge:  { name: S.t('突擊'), kind: 'physical', mp: 10, power: 1.8, desc: S.t('1.8 倍物理傷害') },
    double:  { name: S.t('連擊'), kind: 'physical', mp: 12, power: 0.8, hits: 2, desc: S.t('0.8 倍物理傷害 ×2') },
    pierce:  { name: S.t('破甲'), kind: 'physical', mp: 12, power: 1.2, ignoreDef: 0.5,
               debuff: { stat: 'def', mul: 0.7, dur: 6, label: S.t('防↓') }, desc: S.t('無視一半防禦，目標防禦 -30% 6 秒') },
    sweep:   { name: S.t('橫掃'), kind: 'physical', mp: 15, power: 1.0, area: 1, desc: S.t('波及目標周圍 1 格的敵人') },
    // 魔法特技
    fire:    { name: S.t('火計'), kind: 'magic', mp: 15, power: 1.2, area: 1, burn: { ratio: 0.6, dur: 4 }, element: 'fire',
               color: '#ff7020', desc: S.t('範圍魔法傷害並燃燒 4 秒') },
    thunder: { name: S.t('落雷'), kind: 'magic', mp: 18, power: 2.2, color: '#ffff80', fx: 'bolt', desc: S.t('2.2 倍魔法傷害') },
    confuse: { name: S.t('妖術'), kind: 'magic', mp: 16, power: 0.8, stun: 2, color: '#e070ff', desc: S.t('魔法傷害並使目標混亂 2 秒') },
    heal:    { name: S.t('治療'), kind: 'magic', mp: 14, heal: 4, support: true, color: '#60ff90',
               desc: S.t('回復附近兵力最低的友軍 (智力 ×4)') },
    rally:   { name: S.t('鼓舞'), kind: 'magic', mp: 15, support: true, radius: 2, color: '#ff9040',
               buff: { stat: 'atk', mul: 1.25, dur: 6, label: S.t('攻↑') }, desc: S.t('周圍 2 格友軍攻擊 +25% 6 秒') },
    // ---- 更多特技 ----
    // slow: 緩速秒數 (移動與攻擊變慢)  drain: 傷害的多少比例回復自己  knock: 擊退一格
    triple:      { name: S.t('三段突'), kind: 'physical', mp: 16, power: 0.6, hits: 3, desc: S.t('0.6 倍物理傷害 ×3') },
    shieldBash:  { name: S.t('盾擊'),   kind: 'physical', mp: 14, power: 1.1, stun: 1.2, desc: S.t('1.1 倍物理傷害並使目標混亂 1.2 秒') },
    arrowRain:   { name: S.t('箭雨'),   kind: 'physical', mp: 20, power: 0.75, area: 2, color: '#e0d080', desc: S.t('波及目標周圍 2 格的敵人') },
    execute:     { name: S.t('斬首'),   kind: 'physical', mp: 18, power: 1.5, ignoreDef: 0.8, desc: S.t('1.5 倍物理傷害，無視八成防禦') },
    knockStrike: { name: S.t('震退'),   kind: 'physical', mp: 12, power: 1.3, knock: true, desc: S.t('1.3 倍物理傷害並把目標擊退一格') },
    ice:         { name: S.t('冰封'),   kind: 'magic', mp: 16, power: 1.3, slow: 4, color: '#a0e8ff', desc: S.t('魔法傷害並使目標緩速 4 秒') },
    poison:      { name: S.t('毒霧'),   kind: 'magic', mp: 18, power: 0.6, area: 1, burn: { ratio: 0.8, dur: 6 }, color: '#90e040',
                   desc: S.t('範圍魔法傷害並中毒 6 秒') },
    drain:       { name: S.t('吸魂'),   kind: 'magic', mp: 18, power: 1.4, drain: 0.5, color: '#c060ff', desc: S.t('1.4 倍魔法傷害，傷害的一半回復自己') },
    meteor:      { name: S.t('隕石'),   kind: 'magic', mp: 28, power: 1.7, area: 1, stun: 1, element: 'fire', color: '#ff9040', fx: 'bolt',
                   desc: S.t('大範圍火屬性魔法傷害並混亂 1 秒') },
    guardian:    { name: S.t('護盾'),   kind: 'magic', mp: 15, support: true, radius: 2, color: '#60a0ff',
                   buff: { stat: 'def', mul: 1.3, dur: 6, label: S.t('防↑') }, desc: S.t('周圍 2 格友軍防禦 +30% 6 秒') },
    focus:       { name: S.t('凝神'),   kind: 'magic', mp: 15, support: true, radius: 2, color: '#c0a0ff',
                   buff: { stat: 'int', mul: 1.3, dur: 6, label: S.t('智↑') }, desc: S.t('周圍 2 格友軍智力 +30% 6 秒') }
  };
  S.PHYSICAL_SKILLS = ['charge', 'double', 'pierce', 'sweep', 'triple', 'shieldBash', 'arrowRain', 'execute', 'knockStrike'];
  S.MAGIC_SKILLS = ['fire', 'thunder', 'confuse', 'heal', 'rally', 'ice', 'poison', 'drain', 'meteor', 'guardian', 'focus'];

  // ---- 主將計策 (玩家可決定施放時機；電腦方由 AI 判斷) ----
  // 軍令：隨時間累積、擊破敵隊額外獲得；主將陣亡後無法再下令
  S.COMMAND = {
    START: 2,                      // 開戰時軍令
    MAX: 10,
    REGEN: 0.25,                   // 每秒回復
    PER_KILL: 1,                   // 每擊破一隊敵軍
    GLOBAL_CD: 1.5                 // 任兩個計策之間的最短間隔 (秒)
  };
  // target: 需要在戰場上點選位置  radius: 影響範圍 (格)  power: 以主將智力計算的魔法傷害倍率
  // buff.scale: 依主將能力加成 (mul + 能力 / scale)
  S.TACTICS = {
    fire:    { name: S.t('火計'), key: '1', cost: 4, cd: 12, target: true, radius: 1, power: 1.6, element: 'fire',
               burn: { ratio: 0.6, dur: 5 }, color: '#ff7020', desc: S.t('指定位置 3×3 範圍魔法傷害並燃燒 5 秒（依主將智力）') },
    thunder: { name: S.t('落雷'), key: '2', cost: 5, cd: 14, target: true, radius: 0, power: 3.2, stun: 2.5,
               color: '#ffff80', fx: 'bolt', desc: S.t('對單一敵隊造成大量魔法傷害並混亂 2.5 秒（依主將智力）') },
    rally:   { name: S.t('鼓舞'), key: '3', cost: 4, cd: 16, color: '#ff9040',
               buff: { stat: 'atk', mul: 1.0, from: 'war', scale: 200, dur: 8, label: S.t('攻↑') },
               desc: S.t('全軍攻擊提升 8 秒（依主將武力）') },
    guard:   { name: S.t('堅守'), key: '4', cost: 3, cd: 16, color: '#60a0ff',
               buff: { stat: 'def', mul: 1.15, from: 'lead', scale: 500, dur: 8, label: S.t('防↑') },
               desc: S.t('全軍防禦提升 8 秒（依主將統率）') },
    flood:   { name: S.t('水計'), key: '5', cost: 5, cd: 18, target: true, radius: 2, power: 1.0, slow: 6, color: '#40a0ff',
               desc: S.t('指定位置 5×5 範圍魔法傷害並緩速 6 秒，順便澆熄燃燒（依主將智力）') },
    cure:    { name: S.t('回春'), key: '6', cost: 6, cd: 30, color: '#60ff90', healAll: { base: 0.08, from: 'int', scale: 1500 },
               desc: S.t('全軍回復兵力並解除燃燒（依主將智力）') }
  };
  S.TACTIC_IDS = ['fire', 'thunder', 'rally', 'guard', 'flood', 'cure'];
  // 計策的魔法傷害以「計策智力 = base + 武將智力 × ratio」計算 (比主將本身的智力起伏小，避免智將一面倒)
  S.TACTIC_INT = { base: 9, ratio: 1 / 20 };

  // ---- 隨機事件 ----
  // 寶箱：每隔 interval 秒在空地出現，單位走上去即可開啟 (也可能是陷阱)
  S.CHEST = {
    FIRST: [5, 10],                // 第一個寶箱出現時間範圍
    INTERVAL: [9, 16],            // 之後每隔幾秒出現一個
    MAX: 2,                        // 場上最多幾個
    AUTO_DIST: 5,                  // 附近幾步內沒在交戰的士兵會自行去撿
    AI_DIST: 11                    // 電腦方會派最近幾步內的士兵去撿
  };
  // weight: 出現權重
  S.CHEST_ITEMS = {
    potion: { name: S.t('傷藥'), weight: 3, heal: 0.5, color: '#60ff90', desc: S.t('開啟的部隊回復 50% 兵力') },
    food:   { name: S.t('兵糧'), weight: 2, healAll: 0.12, color: '#a0ff60', desc: S.t('全軍回復 12% 兵力') },
    book:   { name: S.t('兵書'), weight: 3, command: 3, color: '#f8d838', desc: S.t('軍令 +3') },
    sword:  { name: S.t('寶劍'), weight: 2, buff: { stat: 'atk', mul: 1.4, dur: 20, label: S.t('攻↑') }, color: '#ff6040',
              desc: S.t('開啟的部隊攻擊 +40% 20 秒') },
    armor:  { name: S.t('鎧甲'), weight: 2, buff: { stat: 'def', mul: 1.5, dur: 20, label: S.t('防↑') }, color: '#60a0ff',
              desc: S.t('開啟的部隊防禦 +50% 20 秒') },
    trap:   { name: S.t('陷阱'), weight: 2, damage: 0.3, stun: 2, color: '#ff4040', desc: S.t('爆炸！損失 30% 兵力並混亂 2 秒') },
    elixir: { name: S.t('仙丹'), weight: 1, heal: 1.0, color: '#ffe080', desc: S.t('開啟的部隊兵力全滿') },
    wine:   { name: S.t('美酒'), weight: 2, buff: { stat: 'int', mul: 1.5, dur: 20, label: S.t('智↑') }, color: '#c0a0ff',
              desc: S.t('開啟的部隊智力 +50% 20 秒') }
  };

  // 天候：每隔一段時間可能變化，影響火攻與射程
  S.WEATHER_CHANGE = [15, 30];     // 幾秒判定一次天候變化
  S.WEATHER = {
    clear: { name: S.t('晴天'), weight: 4 },
    wind:  { name: S.t('大風'), weight: 2, fireMul: 1.5, burnBonus: 2, desc: S.t('火攻傷害 +50%、燃燒延長') },
    rain:  { name: S.t('大雨'), weight: 2, fireMul: 0.4, noBurn: true, desc: S.t('火攻傷害大減且不會燃燒') },
    fog:   { name: S.t('濃霧'), weight: 2, rangeMinus: 2, desc: S.t('弓兵射程 -2') }
  };

  // 伏兵：每場最多一次，於指定時間後機率出現，偏向兵力較少的一方
  S.AMBUSH = { AFTER: 25, CHANCE: 0.03, LOSER_BIAS: 0.75 };   // CHANCE：每秒觸發機率

  // ---- 相剋：key 剋 value ----
  S.COUNTER = { spear: 'cavalry', cavalry: 'archer', archer: 'spear' };
  S.COUNTER_BONUS = 1.5;
  S.COUNTER_MALUS = 0.7;

  S.matchup = function (atkType, defType) {
    atkType = S.baseType(atkType); defType = S.baseType(defType);
    if (S.COUNTER[atkType] === defType) return S.COUNTER_BONUS;
    if (S.COUNTER[defType] === atkType) return S.COUNTER_MALUS;
    return 1;
  };

  // ---- 戰鬥規則 ----
  S.GENERAL_HOLD_TIME = 25;        // 主將最多在後方觀望幾秒
  S.GENERAL_RETREAT_HP = 0.35;     // 玩家主將兵力低於這個比例時，不會自動追擊
  S.GENERAL_ENGAGE_DIST = 3;       // 敵軍進入幾格內主將出擊
  S.GENERAL_ENGAGE_FRIENDS = 3;    // 己方士兵剩幾隊以下主將出擊
  S.MORALE_PENALTY = 0.75;         // 主將陣亡後全軍攻擊倍率
  S.KITE_CHANCE = 0.6;             // 弓兵被貼身時後撤機率
  S.KITE_COOLDOWN = 2.5;
  S.LUNGE_TIME = 0.25;             // 近戰攻擊動畫秒數
  S.TIME_LIMIT = 600;              // 安全上限：超時以剩餘戰力比例判定

  // ---- 布陣 (左軍座標，右軍自動左右鏡像) ----
  S.FORMATION = {
    general: [[1, 10], [1, 11]],
    spear:   [[6, 10], [6, 11], [6, 9], [6, 12], [6, 8], [6, 13], [6, 7], [6, 14], [5, 9], [5, 12]],
    archer:  [[3, 10], [3, 11], [3, 9], [3, 12], [4, 8], [4, 13], [3, 8], [3, 13], [4, 7], [4, 14]],
    cavalry: [[5, 4], [5, 17], [6, 5], [6, 16], [4, 4], [4, 17], [5, 6], [5, 15], [3, 5], [3, 16]]
  };

  S.UNIT_KINDS = ['spear', 'archer', 'cavalry'];
  S.UNITS_PER_ARMY = 9;

  // ======================= 過關模式 =======================
  // 建立角色：四項能力各從 BASE 起，另有 POINTS 點自由分配 (每項 MIN–MAX)；初始士兵 START_UNITS 隊
  // 營地：金錢買士兵 (最多 MAX_UNITS 隊，賣出退 SELL_RATE)；經驗值提升主將能力或兵種等級
  S.CAMPAIGN = {
    CREATE: { BASE: 50, POINTS: 40, MIN: 30, MAX: 85 },
    START_UNITS: 5,
    START_GOLD: 0,
    MAX_UNITS: 9,
    PRICE: { spear: 100, archer: 120, cavalry: 150 },
    SELL_RATE: 0.5,
    STAT_COST: 100,                // 主將能力 +STAT_STEP 需要的經驗值
    STAT_STEP: 3,
    STAT_MAX: 150,
    LEVEL_COST: 100,               // 兵種升一級需要的經驗值
    REPLAY_RATE: 0.5,              // 重打已過關卡的獎勵倍率
    LOSS_EXP_RATE: 0.3             // 戰敗仍可獲得的經驗值比例 (沒有金錢)
  };
  S.STAT_NAMES = { hp: S.t('體力'), war: S.t('武力'), int: S.t('智力'), lead: S.t('統率') };
  S.STAT_KEYS = ['hp', 'war', 'int', 'lead'];
  // 兵種等級：每級該兵種 HP / MP / 攻擊 / 防禦 / 智力 / 精神 +BONUS
  S.LEVEL = { BONUS: 0.05, MAX: 40 };
  // 升級費用遞增：前期都是 100 經驗，越高越貴 (噩夢 / 地獄的經驗值倍率很高，避免一下子升太多)
  S.levelCost = function (lv) { return S.CAMPAIGN.LEVEL_COST + 25 * Math.max(0, lv - 5); };   // Lv5 以前都是 100
  S.statCost = function (v) { return S.CAMPAIGN.STAT_COST + Math.max(0, v - 75) * 6; };       // 75 以前都是 100

  // ---- 裝備 (品質、詞綴、套裝、暗金的資料與邏輯在 js/items.js) ----
  // 仿暗黑破壞神 2 的 10 個裝備位置；物品部位 (ITEM_SLOTS) 只有 9 種，戒指可以戴兩枚
  S.ITEM_SLOTS = { weapon: S.t('武器'), shield: S.t('副手'), helm: S.t('頭盔'), armor: S.t('鎧甲'), gloves: S.t('護手'),
                   belt: S.t('腰帶'), boots: S.t('戰靴・坐騎'), amulet: S.t('護符'), ring: S.t('戒指') };
  S.ITEM_SLOT_KEYS = ['weapon', 'shield', 'helm', 'armor', 'gloves', 'belt', 'boots', 'amulet', 'ring'];
  S.EQUIP_SLOTS = { helm: S.t('頭盔'), amulet: S.t('護符'), weapon: S.t('武器'), armor: S.t('鎧甲'), shield: S.t('副手'),
                    ring1: S.t('戒指'), belt: S.t('腰帶'), ring2: S.t('戒指'), gloves: S.t('護手'), boots: S.t('戰靴・坐騎') };
  S.EQUIP_SLOT_KEYS = ['helm', 'amulet', 'weapon', 'armor', 'shield', 'ring1', 'belt', 'ring2', 'gloves', 'boots'];
  S.equipKeysFor = function (itemSlot) { return itemSlot === 'ring' ? ['ring1', 'ring2'] : [itemSlot]; };

  // 關卡：general 敵將能力，units 敵軍士兵，gold / exp 首次過關獎勵
  // drops 首次過關額外獲得的裝備：{ quality: 'rare' } 隨機稀有、{ unique: id } 暗金、{ set: id } 套裝 (見 js/items.js)
  // lv 敵軍等級：數字 = 全體同等級；也可以分別指定 { general, spear, archer, cavalry }
  // diff：難度 (S.DIFFICULTIES 的 key)，敵軍全體再加上該難度的等級
  S.stageLevels = function (st, diff) {
    var lv = typeof st.lv === 'object' ? Object.assign({ general: 0, spear: 0, archer: 0, cavalry: 0 }, st.lv) :
      { general: st.lv, spear: st.lv, archer: st.lv, cavalry: st.lv };
    var D = diff ? S.DIFFICULTIES[diff] : null;
    var bonus = D ? D.lv + Math.round(D.perStage * Math.max(0, S.STAGES.indexOf(st))) : 0;   // 越後面的關卡加越多
    Object.keys(lv).forEach(function (k) { lv[k] += bonus; });
    return lv;
  };

  // ---- 難度 (仿暗黑破壞神 2)：全破普通 10 關解鎖噩夢，全破噩夢解鎖地獄 ----
  // lv：敵軍全體等級加成 (再加上 perStage × 關卡序號)  ilvl：掉落物品等級加成  reward：金錢 / 經驗倍率
  // elite：一般出征時每隊敵兵成為精英的機率  campElite：探索模式每座敵營有精英的機率
  S.DIFFICULTIES = {
    normal:    { name: S.t('普通'), lv: 0,  perStage: 0.12,ilvl: 0,  reward: 1,   elite: 0.05, campElite: 0.5,  color: '#e8e8f0' },
    nightmare: { name: S.t('噩夢'), lv: 5,  perStage: 0.65,ilvl: 10, reward: 2.5, elite: 0.15, campElite: 0.75, color: '#ff9040' },
    hell:      { name: S.t('地獄'), lv: 10, perStage: 1.0, ilvl: 20, reward: 5,   elite: 0.25, campElite: 1,    color: '#ff4040' }
  };
  S.DIFFICULTY_KEYS = ['normal', 'nightmare', 'hell'];
  S.STAGES = [
    { title: S.t('黃巾之亂'), general: { name: S.t('程遠志'), hp: 45, war: 52, int: 20, lead: 30, beard: '#403020' },
      units: ['spear', 'spear', 'archer', 'archer'], lv: 0, gold: 120, exp: 100 },
    { title: S.t('廣宗之戰'), general: { name: S.t('張寶'), hp: 55, war: 45, int: 72, lead: 45, beard: '#202020' },
      units: ['spear', 'spear', 'archer', 'sorcerer', 'cavalry'], lv: 0, gold: 140, exp: 150 },
    { title: S.t('汜水關'), general: { name: S.t('華雄'), hp: 80, war: 86, int: 35, lead: 60, beard: '#282018' },
      units: ['spear', 'spear', 'archer', 'archer', 'cavalry', 'assassin'], lv: { general: 1 }, gold: 160, exp: 200, drops: [{ quality: 'rare' }] },
    { title: S.t('壽春討伐'), general: { name: S.t('紀靈'), hp: 75, war: 82, int: 42, lead: 70, beard: null },
      units: ['spear', 'spear', 'rattan', 'archer', 'archer', 'cavalry', 'cavalry'], lv: { general: 2, spear: 1, archer: 1, cavalry: 1 }, gold: 180, exp: 250 },
    { title: S.t('白馬之圍'), general: { name: S.t('顏良'), hp: 85, war: 92, int: 35, lead: 66, beard: '#302010' },
      units: ['spear', 'spear', 'rattan', 'archer', 'archer', 'sorcerer', 'cavalry', 'cavalry', 'elephant'], lv: { general: 2, spear: 1 }, gold: 200, exp: 300, drops: [{ unique: 'dilu' }] },
    { title: S.t('延津之戰'), general: { name: S.t('文醜'), hp: 85, war: 90, int: 30, lead: 70, beard: '#201810' },
      units: ['spear', 'spear', 'rattan', 'archer', 'archer', 'assassin', 'cavalry', 'cavalry', 'elephant'], lv: { general: 3, spear: 2, archer: 1, cavalry: 2 }, gold: 220, exp: 350, drops: [{ unique: 'warDrum' }] },
    { title: S.t('合肥之戰'), general: { name: S.t('張遼'), hp: 85, war: 92, int: 78, lead: 92, beard: '#202020' },
      units: ['spear', 'rattan', 'rattan', 'archer', 'archer', 'sorcerer', 'cavalry', 'assassin', 'assassin'], lv: { general: 4, spear: 3, archer: 3, cavalry: 3 }, gold: 240, exp: 400 },
    { title: S.t('博望坡'), general: { name: S.t('夏侯惇'), hp: 90, war: 90, int: 58, lead: 86, beard: '#181818' },
      units: ['spear', 'spear', 'rattan', 'archer', 'sorcerer', 'sorcerer', 'cavalry', 'cavalry', 'elephant'], lv: { general: 4, spear: 3, archer: 3, cavalry: 4 }, gold: 260, exp: 450, drops: [{ unique: 'qinggang' }] },
    { title: S.t('樊城之戰'), general: { name: S.t('關羽'), hp: 95, war: 97, int: 75, lead: 95, beard: '#101010' },
      units: ['spear', 'spear', 'rattan', 'archer', 'archer', 'sorcerer', 'cavalry', 'assassin', 'elephant'], lv: { general: 5, spear: 4, archer: 4, cavalry: 4 }, gold: 300, exp: 500, drops: [{ set: 'dragonBlade' }] },
    { title: S.t('虎牢關'), general: { name: S.t('呂布'), hp: 98, war: 100, int: 26, lead: 85, beard: null },
      units: ['spear', 'spear', 'rattan', 'archer', 'archer', 'sorcerer', 'assassin', 'cavalry', 'elephant'], lv: { general: 6, spear: 6, archer: 5, cavalry: 6 }, gold: 500, exp: 600, drops: [{ set: 'halberd' }, { set: 'redHare' }] }
  ];

  // ---- 雙方軍隊 (hp=體力 war=武力 int=智力 lead=統率；統率提升士兵防禦) ----
  // 為了公平：預設兩軍兵種編成相同，武將能力取捨不同但總體戰力相當 (以 tools/simulate.js 驗證約 50:50)
  S.DEFAULT_ARMIES = [
    { name: S.t('于禁'), hp: 85, war: 78, int: 58, lead: 84, beard: null,
      units: ['spear', 'spear', 'spear', 'archer', 'archer', 'archer', 'cavalry', 'cavalry', 'cavalry'] },
    { name: S.t('張飛'), hp: 88, war: 98, int: 30, lead: 63, beard: '#282018',
      units: ['spear', 'spear', 'spear', 'archer', 'archer', 'archer', 'cavalry', 'cavalry', 'cavalry'] }
  ];
})(window.Sango);
