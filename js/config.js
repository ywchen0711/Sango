/*
 * 三國志 霸王的大陸 風格 自動戰鬥 — 參數設定
 * 調整數值、地圖、陣型、雙方武將與兵種編成都在這個檔案。
 */
window.Sango = window.Sango || {};

(function (S) {
  'use strict';

  // ---- 畫面 (NES 解析度 256x240，放大 SCALE 倍) ----
  S.TILE = 16;
  S.COLS = 16;
  S.ROWS = 11;
  S.FIELD_W = S.COLS * S.TILE;          // 256
  S.FIELD_H = S.ROWS * S.TILE;          // 176
  S.PANEL_H = 64;
  S.VIEW_W = S.FIELD_W;
  S.VIEW_H = S.FIELD_H + S.PANEL_H;     // 240
  S.SCALE = 3;
  S.SIM_DT = 1 / 60;                    // 固定模擬步長 (秒)

  // ---- 地圖：'#' 城牆 (不可通行)，'.' 地面 ----
  S.MAP = [
    '................',
    '......#..#......',
    '......#..#......',
    '......####......',
    '................',
    '................',
    '................',
    '......####......',
    '......#..#......',
    '......#..#......',
    '................'
  ];

  // ---- 兵種 ----
  // hp: 兵力  mp: 魔力  atk: 攻擊  def: 防禦  int: 智力 (魔法攻擊)  spr: 精神 (魔法防禦)
  // range: 射程(格)  moveTime: 走一格秒數  attackTime: 攻擊間隔秒數
  // 士兵的每項數值在開戰時隨機浮動 ±STAT_VARIANCE
  S.UNIT_TYPES = {
    spear:   { name: '槍兵', hp: 200, mp: 40, atk: 12, def: 10, int: 5, spr: 7,
               range: 1, moveTime: 0.50, attackTime: 1.0 },
    archer:  { name: '弓兵', hp: 180, mp: 60, atk: 10, def: 6,  int: 8, spr: 9,
               range: 4, moveTime: 0.55, attackTime: 1.4,
               ranged: true, meleePenalty: 0.5 },       // 被貼身時物理攻擊減半
    cavalry: { name: '騎兵', hp: 190, mp: 30, atk: 13, def: 8,  int: 4, spr: 5,
               range: 1, moveTime: 0.28, attackTime: 1.1,
               chargeBonus: 1.3 },                       // 移動後第一擊衝鋒加成
    // 主將：與士兵同一尺度，再依武將能力加成 (見 S.GENERAL_STATS)，一樣有隨機浮動
    general: { name: '主將', hp: 0, mp: 30, atk: 6, def: 8, int: 4, spr: 6,
               range: 1, moveTime: 0.40, attackTime: 0.9 }
  };
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
    charge:  { name: '突擊', kind: 'physical', mp: 10, power: 1.8, desc: '1.8 倍物理傷害' },
    double:  { name: '連擊', kind: 'physical', mp: 12, power: 0.8, hits: 2, desc: '0.8 倍物理傷害 ×2' },
    pierce:  { name: '破甲', kind: 'physical', mp: 12, power: 1.2, ignoreDef: 0.5,
               debuff: { stat: 'def', mul: 0.7, dur: 6, label: '防↓' }, desc: '無視一半防禦，目標防禦 -30% 6 秒' },
    sweep:   { name: '橫掃', kind: 'physical', mp: 15, power: 1.0, area: 1, desc: '波及目標周圍 1 格的敵人' },
    // 魔法特技
    fire:    { name: '火計', kind: 'magic', mp: 15, power: 1.2, area: 1, burn: { ratio: 0.6, dur: 4 }, element: 'fire',
               color: '#ff7020', desc: '範圍魔法傷害並燃燒 4 秒' },
    thunder: { name: '落雷', kind: 'magic', mp: 18, power: 2.2, color: '#ffff80', fx: 'bolt', desc: '2.2 倍魔法傷害' },
    confuse: { name: '妖術', kind: 'magic', mp: 16, power: 0.8, stun: 2, color: '#e070ff', desc: '魔法傷害並使目標混亂 2 秒' },
    heal:    { name: '治療', kind: 'magic', mp: 14, heal: 4, support: true, color: '#60ff90',
               desc: '回復附近兵力最低的友軍 (智力 ×4)' },
    rally:   { name: '鼓舞', kind: 'magic', mp: 15, support: true, radius: 2, color: '#ff9040',
               buff: { stat: 'atk', mul: 1.25, dur: 6, label: '攻↑' }, desc: '周圍 2 格友軍攻擊 +25% 6 秒' }
  };
  S.PHYSICAL_SKILLS = ['charge', 'double', 'pierce', 'sweep'];
  S.MAGIC_SKILLS = ['fire', 'thunder', 'confuse', 'heal', 'rally'];

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
    fire:    { name: '火計', key: '1', cost: 4, cd: 12, target: true, radius: 1, power: 1.6, element: 'fire',
               burn: { ratio: 0.6, dur: 5 }, color: '#ff7020', desc: '指定位置 3×3 範圍魔法傷害並燃燒 5 秒（依主將智力）' },
    thunder: { name: '落雷', key: '2', cost: 5, cd: 14, target: true, radius: 0, power: 3.2, stun: 2.5,
               color: '#ffff80', fx: 'bolt', desc: '對單一敵隊造成大量魔法傷害並混亂 2.5 秒（依主將智力）' },
    rally:   { name: '鼓舞', key: '3', cost: 4, cd: 16, color: '#ff9040',
               buff: { stat: 'atk', mul: 1.0, from: 'war', scale: 200, dur: 8, label: '攻↑' },
               desc: '全軍攻擊提升 8 秒（依主將武力）' },
    guard:   { name: '堅守', key: '4', cost: 3, cd: 16, color: '#60a0ff',
               buff: { stat: 'def', mul: 1.15, from: 'lead', scale: 500, dur: 8, label: '防↑' },
               desc: '全軍防禦提升 8 秒（依主將統率）' }
  };
  S.TACTIC_IDS = ['fire', 'thunder', 'rally', 'guard'];
  // 計策的魔法傷害以「計策智力 = base + 武將智力 × ratio」計算 (比主將本身的智力起伏小，避免智將一面倒)
  S.TACTIC_INT = { base: 9, ratio: 1 / 20 };

  // ---- 隨機事件 ----
  // 寶箱：每隔 interval 秒在空地出現，單位走上去即可開啟 (也可能是陷阱)
  S.CHEST = {
    FIRST: [5, 10],                // 第一個寶箱出現時間範圍
    INTERVAL: [9, 16],            // 之後每隔幾秒出現一個
    MAX: 2,                        // 場上最多幾個
    AUTO_DIST: 3,                  // 附近幾步內沒在交戰的士兵會自行去撿
    AI_DIST: 7                     // 電腦方會派最近幾步內的士兵去撿
  };
  // weight: 出現權重
  S.CHEST_ITEMS = {
    potion: { name: '傷藥', weight: 3, heal: 0.5, color: '#60ff90', desc: '開啟的部隊回復 50% 兵力' },
    food:   { name: '兵糧', weight: 2, healAll: 0.12, color: '#a0ff60', desc: '全軍回復 12% 兵力' },
    book:   { name: '兵書', weight: 3, command: 3, color: '#f8d838', desc: '軍令 +3' },
    sword:  { name: '寶劍', weight: 2, buff: { stat: 'atk', mul: 1.4, dur: 20, label: '攻↑' }, color: '#ff6040',
              desc: '開啟的部隊攻擊 +40% 20 秒' },
    armor:  { name: '鎧甲', weight: 2, buff: { stat: 'def', mul: 1.5, dur: 20, label: '防↑' }, color: '#60a0ff',
              desc: '開啟的部隊防禦 +50% 20 秒' },
    trap:   { name: '陷阱', weight: 2, damage: 0.3, stun: 2, color: '#ff4040', desc: '爆炸！損失 30% 兵力並混亂 2 秒' }
  };

  // 天候：每隔一段時間可能變化，影響火攻與射程
  S.WEATHER_CHANGE = [15, 30];     // 幾秒判定一次天候變化
  S.WEATHER = {
    clear: { name: '晴天', weight: 4 },
    wind:  { name: '大風', weight: 2, fireMul: 1.5, burnBonus: 2, desc: '火攻傷害 +50%、燃燒延長' },
    rain:  { name: '大雨', weight: 2, fireMul: 0.4, noBurn: true, desc: '火攻傷害大減且不會燃燒' },
    fog:   { name: '濃霧', weight: 2, rangeMinus: 2, desc: '弓兵射程 -2' }
  };

  // 伏兵：每場最多一次，於指定時間後機率出現，偏向兵力較少的一方
  S.AMBUSH = { AFTER: 25, CHANCE: 0.03, LOSER_BIAS: 0.75 };   // CHANCE：每秒觸發機率

  // ---- 相剋：key 剋 value ----
  S.COUNTER = { spear: 'cavalry', cavalry: 'archer', archer: 'spear' };
  S.COUNTER_BONUS = 1.5;
  S.COUNTER_MALUS = 0.7;

  S.matchup = function (atkType, defType) {
    if (S.COUNTER[atkType] === defType) return S.COUNTER_BONUS;
    if (S.COUNTER[defType] === atkType) return S.COUNTER_MALUS;
    return 1;
  };

  // ---- 戰鬥規則 ----
  S.GENERAL_HOLD_TIME = 25;        // 主將最多在後方觀望幾秒
  S.GENERAL_ENGAGE_DIST = 3;       // 敵軍進入幾格內主將出擊
  S.GENERAL_ENGAGE_FRIENDS = 3;    // 己方士兵剩幾隊以下主將出擊
  S.MORALE_PENALTY = 0.75;         // 主將陣亡後全軍攻擊倍率
  S.KITE_CHANCE = 0.6;             // 弓兵被貼身時後撤機率
  S.KITE_COOLDOWN = 2.5;
  S.LUNGE_TIME = 0.25;             // 近戰攻擊動畫秒數
  S.TIME_LIMIT = 600;              // 安全上限：超時以剩餘戰力比例判定

  // ---- 布陣 (左軍座標，右軍自動左右鏡像) ----
  S.FORMATION = {
    general: [[0, 5]],
    spear:   [[3, 4], [3, 6], [3, 5], [3, 3], [3, 7], [3, 2], [3, 8], [2, 5], [2, 3], [2, 7]],
    archer:  [[1, 4], [1, 6], [1, 5], [2, 4], [2, 6], [1, 3], [1, 7], [2, 3], [2, 7], [1, 2]],
    cavalry: [[2, 1], [2, 9], [3, 1], [3, 9], [1, 1], [1, 9], [2, 2], [2, 8], [0, 1], [0, 9]]
  };

  S.UNIT_KINDS = ['spear', 'archer', 'cavalry'];
  S.UNITS_PER_ARMY = 9;

  // ---- 經驗值與升級 (登入後才有；資料存在 Supabase) ----
  // 戰鬥結束依結果獲得經驗值 (觀戰不給)；每花 COST 點經驗值可把主將或某一兵種升一級
  // 每級讓玩家方該單位的 HP / MP / 攻擊 / 防禦 / 智力 / 精神 +BONUS
  S.EXP = { win: 100, draw: 50, loss: 30 };
  S.LEVEL = { COST: 100, BONUS: 0.05, MAX: 20 };
  S.LEVEL_KEYS = ['general', 'spear', 'archer', 'cavalry'];

  // ---- 雙方軍隊 (hp=體力 war=武力 int=智力 lead=統率；統率提升士兵防禦) ----
  // 為了公平：預設兩軍兵種編成相同，武將能力取捨不同但總體戰力相當 (以 tools/simulate.js 驗證約 50:50)
  S.DEFAULT_ARMIES = [
    { name: '于禁', hp: 85, war: 78, int: 58, lead: 84, beard: null,
      units: ['spear', 'spear', 'spear', 'archer', 'archer', 'archer', 'cavalry', 'cavalry', 'cavalry'] },
    { name: '張飛', hp: 88, war: 98, int: 30, lead: 63, beard: '#282018',
      units: ['spear', 'spear', 'spear', 'archer', 'archer', 'archer', 'cavalry', 'cavalry', 'cavalry'] }
  ];
})(window.Sango);
