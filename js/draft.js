/*
 * 選將模式：亂數產生武將與士兵，雙方輪流挑選 (不依賴 DOM，可在 Node 中測試)
 * 流程：藍軍選主將 → 紅軍選主將 → 從士兵池輪流選 (紅軍先選，補償藍軍先選主將)
 */
(function (S) {
  'use strict';

  S.DRAFT = {
    GENERALS: 20,             // 武將池數量
    SOLDIERS: 20,             // 士兵池數量
    PICKS: 5,                 // 每方選幾個士兵
    VARIANCE: 0.25,           // 士兵數值隨機浮動 (比一般模式大，讓挑選有差異)
    STAT_MIN: 35,             // 武將能力範圍
    STAT_MAX: 100
  };

  S.GENERAL_NAMES = [
    '曹操', '劉備', '孫權', '關羽', '張飛', '趙雲', '馬超', '黃忠', '諸葛亮', '周瑜',
    '呂布', '典韋', '許褚', '夏侯惇', '夏侯淵', '張遼', '徐晃', '于禁', '甘寧', '太史慈',
    '陸遜', '呂蒙', '魏延', '姜維', '司馬懿', '郭嘉', '荀彧', '袁紹', '顏良', '文醜',
    '董卓', '華雄', '龐德', '孫策', '黃蓋', '程普', '龐統', '法正', '馬岱', '張郃',
    '曹仁', '凌統', '周泰', '徐庶', '鄧艾', '鍾會', '高順', '張角'
  ];
  var BEARDS = [null, null, '#282018', '#101010', '#504030', '#a0a0a0'];

  function randInt(rng, lo, hi) { return lo + ((rng() * (hi - lo + 1)) | 0); }

  // 產生 n 位不重複姓名的亂數武將 { name, hp, war, int, lead, beard }
  S.randomGenerals = function (n, rng) {
    rng = rng || S.random;
    var D = S.DRAFT;
    return S.pickDistinct(S.GENERAL_NAMES, n, rng).map(function (name, i) {
      return {
        id: i, name: name,
        hp: randInt(rng, D.STAT_MIN, D.STAT_MAX),
        war: randInt(rng, D.STAT_MIN, D.STAT_MAX),
        int: randInt(rng, D.STAT_MIN, D.STAT_MAX),
        lead: randInt(rng, D.STAT_MIN, D.STAT_MAX),
        beard: BEARDS[(rng() * BEARDS.length) | 0]
      };
    });
  };

  // 產生 n 個亂數士兵 (兵種、數值、物理 / 魔法特技各一)
  S.randomSoldiers = function (n, rng) {
    rng = rng || S.random;
    function roll(v) { return Math.max(1, Math.round(v * (1 + (rng() * 2 - 1) * S.DRAFT.VARIANCE))); }
    var out = [];
    for (var i = 0; i < n; i++) {
      var type = S.UNIT_KINDS[(rng() * S.UNIT_KINDS.length) | 0];
      var st = S.UNIT_TYPES[type];
      out.push({
        id: i, type: type,
        hp: roll(st.hp), mp: roll(st.mp), atk: roll(st.atk),
        def: roll(st.def), int: roll(st.int), spr: roll(st.spr),
        physSkills: S.pickDistinct(S.PHYSICAL_SKILLS, 1, rng),
        magicSkills: S.pickDistinct(S.MAGIC_SKILLS, 1, rng)
      });
    }
    return out;
  };

  // ======================= Draft =======================
  function Draft(rng) {
    var D = S.DRAFT;
    this.generals = S.randomGenerals(D.GENERALS, rng);
    this.soldiers = S.randomSoldiers(D.SOLDIERS, rng);
    // 挑選順序：每一步 { side, kind }
    this.order = [{ side: 0, kind: 'general' }, { side: 1, kind: 'general' }];
    for (var i = 0; i < D.PICKS * 2; i++) this.order.push({ side: (i + 1) % 2, kind: 'soldier' });
    this.step = 0;
    this.picks = [{ general: null, soldiers: [] }, { general: null, soldiers: [] }];
    this.owner = { general: {}, soldier: {} };   // id → side
  }

  Draft.prototype.done = function () { return this.step >= this.order.length; };
  Draft.prototype.current = function () { return this.order[this.step] || null; };

  Draft.prototype.canPick = function (kind, id) {
    var cur = this.current();
    return !!cur && cur.kind === kind && this.owner[kind][id] == null;
  };

  Draft.prototype.pick = function (kind, id) {
    if (!this.canPick(kind, id)) return false;
    var side = this.current().side;
    this.owner[kind][id] = side;
    if (kind === 'general') this.picks[side].general = this.generals[id];
    else this.picks[side].soldiers.push(this.soldiers[id]);
    this.step++;
    return true;
  };

  // 為目前這一方隨機挑一個
  Draft.prototype.autoPick = function (rng) {
    var cur = this.current();
    if (!cur) return false;
    var pool = cur.kind === 'general' ? this.generals : this.soldiers;
    var self = this;
    var free = pool.filter(function (x) { return self.owner[cur.kind][x.id] == null; });
    return this.pick(cur.kind, free[((rng || S.random)() * free.length) | 0].id);
  };

  // 選完後轉成 Battle 使用的軍隊格式
  Draft.prototype.armies = function () {
    return this.picks.map(function (p) {
      var g = p.general;
      return { name: g.name, hp: g.hp, war: g.war, int: g.int, lead: g.lead, beard: g.beard,
               units: p.soldiers.slice() };
    });
  };

  S.Draft = Draft;
})(window.Sango);
