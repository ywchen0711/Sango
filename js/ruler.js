/*
 * 君主模式：選一位君主 (196 年 群雄割據)，麾下武將每個月輪流上奏建議，由君主「准奏」或「駁回」來推動天下大勢
 *   - 建議：開墾、商業、修城、徵兵、訓練、施捨、出征、登用、搜索、同盟、流言、褒賞、輸送、調派，打下城池後還要處置俘虜
 *   - 電腦勢力用同一套建議，自己判斷要不要做
 *   - 自動回覆：手動 / 智能判斷 / 全部准奏，可以設定「出征仍由我決定」與「自動推進月份」
 * 邏輯都在 S.Ruler (Node 也能跑：tools/ruler-sim.js)；有 document 時才建立畫面
 * 存檔在這台裝置 (localStorage: sango.ruler)
 */
(function (S) {
  'use strict';

  var EN = S.lang === 'en';
  function L(zh, en) { return EN ? en : zh; }
  var rnd = Math.random;
  function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
  function pick(a) { return a[Math.floor(rnd() * a.length)]; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function wpick(list) {         // [[東西, 權重], ...]
    var tot = 0; list.forEach(function (x) { tot += Math.max(0, x[1]); });
    if (tot <= 0) return null;
    var r = rnd() * tot;
    for (var i = 0; i < list.length; i++) { r -= Math.max(0, list[i][1]); if (r <= 0) return list[i][0]; }
    return list[list.length - 1][0];
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  // ======================= 劇本：196 年 群雄割據 =======================
  var LORDS = {
    caocao:     { n: ['曹操', 'Cao Cao'], col: '#4a7fd6' },
    liubei:     { n: ['劉備', 'Liu Bei'], col: '#3fae5a' },
    sunce:      { n: ['孫策', 'Sun Ce'], col: '#d84a3a' },
    yuanshao:   { n: ['袁紹', 'Yuan Shao'], col: '#d8b03a' },
    yuanshu:    { n: ['袁術', 'Yuan Shu'], col: '#e0803a' },
    liubiao:    { n: ['劉表', 'Liu Biao'], col: '#3ab0aa' },
    liuzhang:   { n: ['劉璋', 'Liu Zhang'], col: '#9a6ad0' },
    mateng:     { n: ['馬騰', 'Ma Teng'], col: '#a8784a' },
    gongsunzan: { n: ['公孫瓚', 'Gongsun Zan'], col: '#c8c8dc' },
    zhanglu:    { n: ['張魯', 'Zhang Lu'], col: '#d070a8' },
    lijue:      { n: ['李傕', 'Li Jue'], col: '#7a7a8a' }
  };
  // 難度 (1 簡單 ~ 5 困難)：照 tools/ruler-sim.js 用智能判斷自動玩的結果訂的
  var DIFF = { caocao: 1, liubiao: 1, liuzhang: 2, yuanshao: 2, sunce: 2, mateng: 3, liubei: 4, yuanshu: 4, gongsunzan: 4, lijue: 5, zhanglu: 5 };
  var LORD_ORDER = ['caocao', 'liubei', 'sunce', 'yuanshao', 'yuanshu', 'liubiao', 'liuzhang', 'mateng', 'gongsunzan', 'zhanglu', 'lijue'];
  // [id, 中文, English, x, y, 規模 1-3, 一開始的主人]
  var CITY_DATA = [
    ['beiping', '北平', 'Beiping', 800, 70, 2, 'gongsunzan'], ['nanpi', '南皮', 'Nanpi', 700, 160, 2, 'yuanshao'],
    ['jinyang', '晉陽', 'Jinyang', 480, 150, 2, 'yuanshao'], ['ye', '鄴', 'Ye', 610, 240, 3, 'yuanshao'],
    ['beihai', '北海', 'Beihai', 870, 230, 1, null], ['puyang', '濮陽', 'Puyang', 720, 300, 2, 'caocao'],
    ['chenliu', '陳留', 'Chenliu', 610, 340, 2, 'caocao'], ['luoyang', '洛陽', 'Luoyang', 460, 310, 3, null],
    ['changan', '長安', "Chang'an", 290, 310, 3, 'lijue'], ['tianshui', '天水', 'Tianshui', 150, 300, 1, 'mateng'],
    ['wuwei', '武威', 'Wuwei', 90, 160, 1, 'mateng'], ['hanzhong', '漢中', 'Hanzhong', 250, 430, 2, 'zhanglu'],
    ['wan', '宛', 'Wan', 470, 430, 2, null], ['xuchang', '許昌', 'Xuchang', 610, 420, 3, 'caocao'],
    ['xiaopei', '小沛', 'Xiaopei', 770, 370, 1, 'liubei'], ['xiapi', '下邳', 'Xiapi', 880, 380, 2, 'liubei'],
    ['runan', '汝南', 'Runan', 640, 500, 2, 'yuanshu'], ['shouchun', '壽春', 'Shouchun', 780, 480, 2, 'yuanshu'],
    ['xiangyang', '襄陽', 'Xiangyang', 470, 540, 3, 'liubiao'], ['jiangxia', '江夏', 'Jiangxia', 620, 590, 2, 'liubiao'],
    ['jianye', '建業', 'Jianye', 860, 570, 3, 'sunce'], ['wu', '吳', 'Wu', 920, 650, 2, 'sunce'],
    ['kuaiji', '會稽', 'Kuaiji', 870, 740, 1, 'sunce'], ['jiangling', '江陵', 'Jiangling', 420, 620, 2, 'liubiao'],
    ['changsha', '長沙', 'Changsha', 560, 700, 1, 'liubiao'], ['chengdu', '成都', 'Chengdu', 160, 590, 3, 'liuzhang'],
    ['jiangzhou', '江州', 'Jiangzhou', 290, 640, 1, 'liuzhang']
  ];
  var ROADS = [
    ['beiping', 'nanpi'], ['nanpi', 'jinyang'], ['nanpi', 'ye'], ['nanpi', 'beihai'], ['jinyang', 'ye'], ['jinyang', 'luoyang'],
    ['ye', 'puyang'], ['ye', 'chenliu'], ['ye', 'luoyang'], ['beihai', 'puyang'], ['beihai', 'xiapi'], ['puyang', 'chenliu'], ['puyang', 'xiaopei'],
    ['chenliu', 'luoyang'], ['chenliu', 'xuchang'], ['chenliu', 'xiaopei'], ['luoyang', 'changan'], ['luoyang', 'wan'], ['luoyang', 'xuchang'],
    ['changan', 'tianshui'], ['changan', 'hanzhong'], ['tianshui', 'wuwei'], ['tianshui', 'hanzhong'], ['hanzhong', 'chengdu'], ['hanzhong', 'jiangzhou'],
    ['wan', 'xuchang'], ['wan', 'xiangyang'], ['wan', 'runan'], ['xuchang', 'runan'], ['xuchang', 'xiaopei'], ['xiaopei', 'xiapi'], ['xiaopei', 'shouchun'],
    ['xiapi', 'shouchun'], ['xiapi', 'jianye'], ['runan', 'shouchun'], ['runan', 'jiangxia'], ['shouchun', 'jianye'], ['shouchun', 'jiangxia'],
    ['xiangyang', 'jiangxia'], ['xiangyang', 'jiangling'], ['jiangxia', 'jiangling'], ['jiangxia', 'jianye'], ['jiangxia', 'changsha'],
    ['jianye', 'wu'], ['wu', 'kuaiji'], ['jiangling', 'changsha'], ['jiangling', 'jiangzhou'], ['chengdu', 'jiangzhou']
  ];
  // [id, 中文, English, 武力, 智力, 政治, 魅力, 君主 (null = 在野), 所在城, 在野時是否需要搜索才找得到]
  var OFFICER_DATA = [
    ['caocao', '曹操', 'Cao Cao', 72, 91, 94, 96, 'caocao', 'chenliu'], ['xiahoudun', '夏侯惇', 'Xiahou Dun', 90, 58, 70, 82, 'caocao', 'puyang'],
    ['xiahouyuan', '夏侯淵', 'Xiahou Yuan', 91, 54, 62, 74, 'caocao', 'xuchang'], ['caoren', '曹仁', 'Cao Ren', 87, 62, 58, 75, 'caocao', 'xuchang'],
    ['xunyu', '荀彧', 'Xun Yu', 14, 95, 98, 89, 'caocao', 'xuchang'], ['guojia', '郭嘉', 'Guo Jia', 13, 98, 72, 80, 'caocao', 'chenliu'],
    ['dianwei', '典韋', 'Dian Wei', 96, 35, 20, 58, 'caocao', 'chenliu'], ['xuchu', '許褚', 'Xu Chu', 96, 36, 20, 63, 'caocao', 'puyang'],
    ['liubei', '劉備', 'Liu Bei', 73, 74, 78, 99, 'liubei', 'xiapi'], ['guanyu', '關羽', 'Guan Yu', 97, 75, 62, 93, 'liubei', 'xiaopei'],
    ['zhangfei', '張飛', 'Zhang Fei', 98, 30, 22, 44, 'liubei', 'xiaopei'], ['jianyong', '簡雍', 'Jian Yong', 30, 72, 74, 85, 'liubei', 'xiapi'],
    ['mizhu', '糜竺', 'Mi Zhu', 26, 68, 82, 85, 'liubei', 'xiapi'], ['sunqian', '孫乾', 'Sun Qian', 30, 76, 80, 82, 'liubei', 'xiapi'],
    ['sunce', '孫策', 'Sun Ce', 92, 69, 70, 92, 'sunce', 'jianye'], ['zhouyu', '周瑜', 'Zhou Yu', 71, 96, 86, 93, 'sunce', 'jianye'],
    ['chengpu', '程普', 'Cheng Pu', 79, 73, 71, 82, 'sunce', 'wu'], ['huanggai', '黃蓋', 'Huang Gai', 83, 70, 62, 76, 'sunce', 'wu'],
    ['handang', '韓當', 'Han Dang', 80, 51, 48, 71, 'sunce', 'kuaiji'], ['zhangzhao', '張昭', 'Zhang Zhao', 22, 80, 97, 77, 'sunce', 'jianye'],
    ['taishici', '太史慈', 'Taishi Ci', 93, 66, 58, 79, 'sunce', 'kuaiji'],
    ['yuanshao', '袁紹', 'Yuan Shao', 69, 70, 61, 93, 'yuanshao', 'ye'], ['yanliang', '顏良', 'Yan Liang', 93, 42, 30, 64, 'yuanshao', 'ye'],
    ['wenchou', '文醜', 'Wen Chou', 94, 25, 32, 60, 'yuanshao', 'nanpi'], ['tianfeng', '田豐', 'Tian Feng', 36, 94, 85, 72, 'yuanshao', 'ye'],
    ['jushou', '沮授', 'Ju Shou', 48, 92, 80, 79, 'yuanshao', 'nanpi'], ['shenpei', '審配', 'Shen Pei', 68, 80, 72, 72, 'yuanshao', 'ye'],
    ['zhanghe', '張郃', 'Zhang He', 89, 69, 57, 64, 'yuanshao', 'jinyang'], ['gaolan', '高覽', 'Gao Lan', 85, 40, 32, 55, 'yuanshao', 'jinyang'],
    ['liubiao', '劉表', 'Liu Biao', 60, 72, 82, 88, 'liubiao', 'xiangyang'], ['caimao', '蔡瑁', 'Cai Mao', 71, 70, 61, 57, 'liubiao', 'xiangyang'],
    ['kuaiyue', '蒯越', 'Kuai Yue', 30, 86, 82, 73, 'liubiao', 'xiangyang'], ['huangzu', '黃祖', 'Huang Zu', 72, 50, 44, 52, 'liubiao', 'jiangxia'],
    ['wenpin', '文聘', 'Wen Pin', 82, 63, 68, 74, 'liubiao', 'jiangling'], ['huangzhong', '黃忠', 'Huang Zhong', 93, 60, 52, 74, 'liubiao', 'changsha'],
    ['liuzhang', '劉璋', 'Liu Zhang', 42, 46, 62, 70, 'liuzhang', 'chengdu'], ['zhangren', '張任', 'Zhang Ren', 86, 79, 64, 72, 'liuzhang', 'jiangzhou'],
    ['yanyan', '嚴顏', 'Yan Yan', 83, 70, 68, 76, 'liuzhang', 'jiangzhou'], ['fazheng', '法正', 'Fa Zheng', 47, 94, 82, 78, 'liuzhang', 'chengdu'],
    ['huangquan', '黃權', 'Huang Quan', 48, 82, 82, 74, 'liuzhang', 'chengdu'], ['liyan', '李嚴', 'Li Yan', 84, 79, 77, 72, 'liuzhang', 'chengdu'],
    ['mateng', '馬騰', 'Ma Teng', 85, 50, 52, 86, 'mateng', 'wuwei'], ['machao', '馬超', 'Ma Chao', 97, 42, 26, 82, 'mateng', 'tianshui'],
    ['pangde', '龐德', 'Pang De', 94, 62, 42, 70, 'mateng', 'tianshui'], ['hansui', '韓遂', 'Han Sui', 73, 77, 64, 75, 'mateng', 'wuwei'],
    ['madai', '馬岱', 'Ma Dai', 84, 52, 48, 70, 'mateng', 'wuwei'],
    ['yuanshu', '袁術', 'Yuan Shu', 65, 61, 51, 70, 'yuanshu', 'shouchun'], ['jiling', '紀靈', 'Ji Ling', 85, 55, 43, 52, 'yuanshu', 'shouchun'],
    ['zhangxun', '張勳', 'Zhang Xun', 73, 58, 52, 55, 'yuanshu', 'runan'], ['yanxiang', '閻象', 'Yan Xiang', 22, 74, 76, 70, 'yuanshu', 'shouchun'],
    ['qiaorui', '橋蕤', 'Qiao Rui', 70, 48, 42, 52, 'yuanshu', 'runan'],
    ['gongsunzan', '公孫瓚', 'Gongsun Zan', 85, 64, 56, 80, 'gongsunzan', 'beiping'], ['zhaoyun', '趙雲', 'Zhao Yun', 96, 76, 65, 81, 'gongsunzan', 'beiping'],
    ['tiankai', '田楷', 'Tian Kai', 66, 54, 61, 56, 'gongsunzan', 'beiping'], ['guanjing', '關靖', 'Guan Jing', 48, 70, 72, 58, 'gongsunzan', 'beiping'],
    ['zhanglu', '張魯', 'Zhang Lu', 36, 79, 79, 87, 'zhanglu', 'hanzhong'], ['yanpu', '閻圃', 'Yan Pu', 28, 82, 78, 63, 'zhanglu', 'hanzhong'],
    ['yangren', '楊任', 'Yang Ren', 72, 45, 40, 50, 'zhanglu', 'hanzhong'],
    ['lijue', '李傕', 'Li Jue', 74, 26, 15, 22, 'lijue', 'changan'], ['guosi', '郭汜', 'Guo Si', 70, 26, 15, 18, 'lijue', 'changan'],
    ['jiaxu', '賈詡', 'Jia Xu', 48, 97, 85, 58, 'lijue', 'changan'], ['fanchou', '樊稠', 'Fan Chou', 73, 20, 18, 25, 'lijue', 'changan'],
    // 在野
    ['zhugeliang', '諸葛亮', 'Zhuge Liang', 38, 100, 95, 92, null, 'xiangyang', true], ['pangtong', '龐統', 'Pang Tong', 34, 97, 85, 69, null, 'changsha', true],
    ['xushu', '徐庶', 'Xu Shu', 65, 93, 81, 84, null, 'wan'], ['weiyan', '魏延', 'Wei Yan', 92, 69, 49, 40, null, 'changsha'],
    ['ganning', '甘寧', 'Gan Ning', 94, 76, 18, 58, null, 'jiangxia'], ['lumeng', '呂蒙', 'Lv Meng', 81, 89, 78, 79, null, 'wu', true],
    ['luxun', '陸遜', 'Lu Xun', 69, 96, 87, 90, null, 'kuaiji', true], ['simayi', '司馬懿', 'Sima Yi', 63, 96, 93, 87, null, 'luoyang', true],
    ['zhangliao', '張遼', 'Zhang Liao', 92, 78, 58, 77, null, 'xiaopei'], ['xuhuang', '徐晃', 'Xu Huang', 90, 74, 48, 71, null, 'luoyang'],
    ['lusu', '魯肅', 'Lu Su', 56, 92, 90, 88, null, 'xiapi', true], ['kongrong', '孔融', 'Kong Rong', 16, 82, 80, 88, null, 'beihai'],
    ['chengyu', '程昱', 'Cheng Yu', 52, 90, 80, 70, null, 'puyang', true], ['yujin', '于禁', 'Yu Jin', 79, 70, 68, 68, null, 'chenliu', true],
    ['lidian', '李典', 'Li Dian', 77, 78, 70, 76, null, 'xuchang', true], ['zhangxiu', '張繡', 'Zhang Xiu', 81, 63, 44, 64, null, 'wan'],
    ['liuye', '劉曄', 'Liu Ye', 32, 92, 80, 70, null, 'shouchun', true], ['taishixiang', '鍾繇', 'Zhong Yao', 30, 82, 90, 78, null, 'changan', true],
    ['xusheng', '徐盛', 'Xu Sheng', 83, 76, 62, 70, null, 'jianye', true], ['huangyueying', '黃月英', 'Huang Yueying', 30, 90, 84, 78, null, 'xiangyang', true],
    ['wangping', '王平', 'Wang Ping', 79, 72, 60, 64, null, 'hanzhong', true], ['zhangsong', '張松', 'Zhang Song', 18, 88, 84, 40, null, 'chengdu', true],
    ['tianyu', '田豫', 'Tian Yu', 76, 80, 74, 70, null, 'beiping', true], ['guanping', '關平', 'Guan Ping', 80, 66, 60, 72, null, 'jiangling', true]
  ];
  var CITY = {}, OFF = {};
  CITY_DATA.forEach(function (d) { CITY[d[0]] = { id: d[0], n: [d[1], d[2]], x: d[3], y: d[4], size: d[5], owner: d[6], adj: [] }; });
  ROADS.forEach(function (r) { CITY[r[0]].adj.push(r[1]); CITY[r[1]].adj.push(r[0]); });
  OFFICER_DATA.forEach(function (d) { OFF[d[0]] = { id: d[0], n: [d[1], d[2]], war: d[3], int: d[4], pol: d[5], cha: d[6], lord: d[7], city: d[8], hidden: !!d[9] }; });
  var MONTHS_TO_ALLY = 24;

  // ======================= 遊戲狀態 =======================
  var G = null;                   // 存檔的內容 (都是純資料)
  function cityName(id) { return CITY[id] ? (EN ? CITY[id].n[1] : CITY[id].n[0]) : ''; }
  function offName(id) { return OFF[id] ? (EN ? OFF[id].n[1] : OFF[id].n[0]) : ''; }
  function lordName(id) { return LORDS[id] ? (EN ? LORDS[id].n[1] : LORDS[id].n[0]) : L('無主', 'unclaimed'); }
  function cap(c) { return 300 + 250 * c.size; }                  // 農業 / 商業 / 城防的上限
  function troopCap(c) { return 10000 + 12000 * c.size; }
  function C(id) { return G.cities[id]; }
  function O(id) { return G.officers[id]; }
  function citiesOf(lord) { return Object.keys(G.cities).filter(function (k) { return G.cities[k].owner === lord; }); }
  function officersIn(city, lord) { return Object.keys(G.officers).filter(function (k) { var o = G.officers[k]; return !o.gone && o.city === city && o.lord === lord; }).map(O); }
  function officersOf(lord) { return Object.keys(G.officers).filter(function (k) { var o = G.officers[k]; return !o.gone && o.lord === lord; }).map(O); }
  function freeIn(city, visibleOnly) { return Object.keys(G.officers).filter(function (k) { var o = G.officers[k]; return !o.gone && !o.lord && o.city === city && (!visibleOnly || !o.hidden); }).map(O); }
  function allied(a, b) { if (!a || !b || a === b) return false; var other = a === G.player ? b : b === G.player ? a : null; return !!(other && G.allies[other] > 0); }
  function hostile(a, b) { return a !== b && !allied(a, b); }
  function frontier(cityId) { var c = C(cityId); return CITY[cityId].adj.some(function (a) { return hostile(C(a).owner, c.owner); }); }
  function best(list, k) { return list.reduce(function (m, o) { return Math.max(m, o[k]); }, 0); }
  function isRuler(o) { return o.lord && o.id === o.lord; }
  function power(lord) { return citiesOf(lord).reduce(function (s, k) { return s + C(k).troops; }, 0); }
  function round100(n) { return Math.round(n / 100) * 100; }

  function newGame(player) {
    G = { v: 1, player: player, year: 196, month: 1, cities: {}, officers: {}, lords: {}, allies: {}, queue: [], log: [], over: null, last: null,
      settings: { auto: 'manual', askAttack: true, advance: false, speed: 1500 } };
    Object.keys(LORDS).forEach(function (k) { G.lords[k] = { alive: true }; });
    CITY_DATA.forEach(function (d) {
      var s = d[5], c = { id: d[0], owner: d[6], size: s };
      c.farm = (cap(c) * (0.42 + rnd() * 0.12)) | 0; c.com = (cap(c) * (0.4 + rnd() * 0.12)) | 0; c.def = (cap(c) * (0.35 + rnd() * 0.15)) | 0;
      c.order = c.owner ? ri(60, 80) : ri(40, 55);
      c.troops = c.owner ? round100(3000 + s * 6000 + ri(0, 2500)) : round100(2500 + s * 1500);
      c.train = c.owner ? ri(45, 65) : 35;
      c.gold = c.owner ? 300 + s * 250 : 0; c.food = c.owner ? 2500 + s * 2000 : 1500;
      G.cities[c.id] = c;
    });
    OFFICER_DATA.forEach(function (d) {
      G.officers[d[0]] = { id: d[0], war: d[3], int: d[4], pol: d[5], cha: d[6], lord: d[7], city: d[8], hidden: !!d[9], loyalty: d[7] ? (d[7] === d[0] ? 100 : ri(72, 95)) : 0, gone: false };
    });
    // 君主稍微強一點：玩家一開始多一些軍資
    citiesOf(player).forEach(function (k) { C(k).gold += 200; C(k).food += 1000; });
    log(L('西元 196 年，天下大亂，群雄割據。', 'AD 196. The realm is in chaos, and warlords carve it up.'));
    log(L(lordName(player) + ' 立志統一天下！', lordName(player) + ' resolves to unite the realm!'), 'good');
    beginMonth();
    return G;
  }

  function log(text, kind) {
    G.log.push({ t: G.year + '/' + G.month, text: text, kind: kind || '' });
    if (G.log.length > 120) G.log.splice(0, G.log.length - 120);
  }

  // ======================= 戰鬥 (自動決定勝負) =======================
  function sidePower(troops, offs, train, def) {
    var w = offs.length ? best(offs, 'war') : 40, i = offs.length ? best(offs, 'int') : 35;
    return troops * (0.7 + train / 200) * (1 + (w * 0.7 + i * 0.3) / 120) * (def ? 1 + def / 1400 : 1);
  }
  // a: { troops, offs, train }   d: { troops, offs, train, def }   回傳 { win, at, dt, notes }
  function fight(a, d, quiet) {
    var at = a.troops, dt = d.troops, a0 = at, d0 = Math.max(1, dt), notes = [];
    var aw = a.offs.length ? a.offs.slice().sort(function (x, y) { return y.war - x.war; })[0] : null;
    var dw = d.offs.length ? d.offs.slice().sort(function (x, y) { return y.war - x.war; })[0] : null;
    // 一騎討
    if (aw && dw && rnd() < 0.3 && Math.max(aw.war, dw.war) >= 85) {
      var aWin = rnd() < clamp(0.5 + (aw.war - dw.war) / 40, 0.1, 0.9);
      if (aWin) dt *= 0.88; else at *= 0.88;
      if (!quiet) notes.push(L('⚔ 一騎討：' + offName(aw.id) + ' 對 ' + offName(dw.id) + '，' + offName(aWin ? aw.id : dw.id) + ' 獲勝！',
        '⚔ Duel: ' + offName(aw.id) + ' vs ' + offName(dw.id) + ' — ' + offName(aWin ? aw.id : dw.id) + ' wins!'));
    }
    // 火計
    var ai = a.offs.length ? best(a.offs, 'int') : 0, di = d.offs.length ? best(d.offs, 'int') : 30;
    if (ai >= 85 && rnd() < 0.25 + (ai - di) / 200) { dt *= 0.9; if (!quiet) notes.push(L('🔥 火計成功，敵軍大亂！', '🔥 A fire attack throws the enemy into chaos!')); }
    for (var r = 0; r < 12; r++) {
      var ap = sidePower(at, a.offs, a.train, 0), dp = sidePower(dt, d.offs, d.train, d.def);
      at -= dp * 0.085 * (0.8 + rnd() * 0.4); dt -= ap * 0.085 * (0.8 + rnd() * 0.4);
      if (dt <= d0 * 0.12 || dt <= 300) return { win: true, at: Math.max(0, at), dt: 0, notes: notes };
      if (at <= a0 * 0.35) return { win: false, at: Math.max(0, at), dt: Math.max(0, dt), notes: notes };
    }
    return { win: false, at: Math.max(0, at), dt: Math.max(0, dt), notes: notes };      // 圍城不下，撤兵
  }
  function attackParty(cityId, lead) {
    var c = C(cityId), others = officersIn(cityId, c.owner).filter(function (o) { return o.id !== lead.id && !isRuler(o); }).sort(function (x, y) { return y.war - x.war; });
    return [lead].concat(others.slice(0, 2));
  }
  function odds(from, to, troops, offs) {
    var t = C(to), dOffs = t.owner ? officersIn(to, t.owner) : [], win = 0, N = 60;
    for (var i = 0; i < N; i++) if (fight({ troops: troops, offs: offs, train: C(from).train }, { troops: t.troops, offs: dOffs, train: t.train, def: t.def }, true).win) win++;
    return Math.round(win / N * 100);
  }

  // 戰鬥結果套用到地圖上；回傳說明文字 (陣列)
  function resolveAttack(from, to, troops, offIds, parts) {
    var a = C(from), t = C(to), attacker = a.owner, defender = t.owner;
    var offs = offIds.map(O).filter(function (o) { return o && !o.gone && o.lord === attacker; });
    var dOffs = defender ? officersIn(to, defender) : [];
    parts = parts || {}; if (!parts[from]) parts[from] = troops;
    troops = 0;
    Object.keys(parts).forEach(function (j) { var cj = C(j); if (cj.owner !== attacker) return; var n = Math.min(parts[j], cj.troops); cj.troops -= n; troops += n; });
    var r = fight({ troops: troops, offs: offs, train: a.train }, { troops: t.troops, offs: dOffs, train: t.train, def: t.def });
    var out = r.notes.slice(), lead = offs[0];
    if (r.win) {
      t.owner = attacker; t.troops = round100(r.at); t.train = a.train; t.order = Math.max(20, t.order - 12); t.def = Math.round(t.def * 0.85);
      offs.forEach(function (o) { o.city = to; });
      out.unshift(L('🏯 ' + offName(lead.id) + ' 攻下了 ' + cityName(to) + '！', '🏯 ' + offName(lead.id) + ' takes ' + cityName(to) + '!'));
      // 守城的武將：逃到自己勢力的城，逃不掉就被俘
      var captured = [];
      dOffs.forEach(function (o) {
        var flee = CITY[to].adj.filter(function (k) { return C(k).owner === defender; });
        if (!flee.length) flee = citiesOf(defender);
        if (flee.length && (isRuler(o) || rnd() < 0.6)) o.city = pick(flee);
        else captured.push(o);
      });
      captured.forEach(function (o) {
        o.lord = null; o.loyalty = 0; o.captive = attacker; o.city = to;
        out.push(L('⛓ 俘虜了 ' + offName(o.id) + '。', '⛓ ' + offName(o.id) + ' is taken prisoner.'));
        if (attacker === G.player) G.queue.unshift({ type: 'captive', off: advisor(), city: to, tOff: o.id });
        else { o.captive = null; if (rnd() < 0.45) { o.lord = attacker; o.loyalty = ri(55, 75); } }
      });
      if (defender && !citiesOf(defender).length) eliminate(defender, attacker);
    } else {
      a.troops += round100(r.at); t.troops = round100(r.dt);
      out.unshift(L('💥 ' + offName(lead.id) + ' 攻打 ' + cityName(to) + ' 失利，帶著 ' + round100(r.at) + ' 兵撤回。',
        '💥 ' + offName(lead.id) + ' fails to take ' + cityName(to) + ' and falls back with ' + round100(r.at) + ' troops.'));
    }
    return { win: r.win, lines: out };
  }
  function eliminate(lord, by) {
    G.lords[lord].alive = false;
    log(L('🏴 ' + lordName(lord) + ' 勢力滅亡了。', '🏴 The house of ' + lordName(lord) + ' has fallen.'), lord === G.player ? 'bad' : 'good');
    officersOf(lord).forEach(function (o) {
      if (isRuler(o)) { o.gone = true; return; }
      o.lord = null; o.loyalty = 0; o.hidden = false;
    });
    if (lord === G.player) G.over = 'lose';
  }
  function advisor() {
    var offs = officersOf(G.player).filter(function (o) { return !isRuler(o); });
    return offs.length ? offs.sort(function (x, y) { return y.int - x.int; })[0].id : G.player;
  }

  // ======================= 建議 (奏報) =======================
  // 每一種建議：w(武將, 城) 想提出的程度；make(武將, 城, 勢力) 產生建議 (null = 不成立)；run(建議) 執行並回傳結果文字
  var TYPES = {
    farm: {
      icon: '🌾', w: function (o, c) { return c.farm < cap(c) ? o.pol * (c.farm < cap(c) * 0.6 ? 1.3 : 0.8) : 0; },
      make: function (o, c) { return c.gold >= 60 && c.farm < cap(c) ? { gold: 60, amount: Math.round(5 + o.pol / 9 + ri(0, 4)) } : null; },
      run: function (p, c) { var b = c.farm; c.farm = Math.min(cap(c), c.farm + p.amount); return L('農業 ' + b + ' → ' + c.farm, 'Farmland ' + b + ' → ' + c.farm); }
    },
    com: {
      icon: '💰', w: function (o, c) { return c.com < cap(c) ? o.pol * (c.com < cap(c) * 0.6 ? 1.3 : 0.8) : 0; },
      make: function (o, c) { return c.gold >= 60 && c.com < cap(c) ? { gold: 60, amount: Math.round(5 + o.pol / 9 + ri(0, 4)) } : null; },
      run: function (p, c) { var b = c.com; c.com = Math.min(cap(c), c.com + p.amount); return L('商業 ' + b + ' → ' + c.com, 'Commerce ' + b + ' → ' + c.com); }
    },
    wall: {
      icon: '🧱', w: function (o, c) { return c.def < cap(c) ? (o.war + o.int) / 2 * (frontier(c.id) ? 1.2 : 0.5) : 0; },
      make: function (o, c) { return c.gold >= 80 && c.def < cap(c) ? { gold: 80, amount: Math.round(5 + (o.war + o.int) / 20 + ri(0, 4)) } : null; },
      run: function (p, c) { var b = c.def; c.def = Math.min(cap(c), c.def + p.amount); return L('城防 ' + b + ' → ' + c.def, 'Walls ' + b + ' → ' + c.def); }
    },
    draft: {
      icon: '🪖', w: function (o, c) { return c.troops < troopCap(c) && c.order >= 35 ? o.war * (frontier(c.id) ? 1.4 : 0.6) : 0; },
      make: function (o, c) {
        var n = Math.min(round100(1500 + o.cha * 25), troopCap(c) - c.troops), g = Math.round(n / 25);
        return n >= 500 && c.gold >= g && c.order >= 35 ? { gold: g, amount: n } : null;
      },
      run: function (p, c) { c.troops += p.amount; c.order = Math.max(0, c.order - 5); return L('兵力 +' + p.amount + '（民心 −5）', 'Troops +' + p.amount + ' (order −5)'); }
    },
    train: {
      icon: '🏹', w: function (o, c) { return c.train < 100 ? o.war * (c.train < 70 ? 1.1 : 0.5) : 0; },
      make: function (o, c) { return c.train < 100 && c.food >= 300 ? { food: 300, amount: Math.round(3 + o.war / 12 + ri(0, 3)) } : null; },
      run: function (p, c) { var b = c.train; c.train = Math.min(100, c.train + p.amount); return L('訓練 ' + b + ' → ' + c.train, 'Training ' + b + ' → ' + c.train); }
    },
    relief: {
      icon: '🍚', w: function (o, c) { return c.order < 92 ? (o.pol + o.cha) / 2 * (c.order < 65 ? 2 : 0.5) : 0; },
      make: function (o, c) { return c.order < 92 && c.food >= 600 ? { food: 600, amount: Math.round(4 + (o.pol + o.cha) / 25 + ri(0, 3)) } : null; },
      run: function (p, c) { var b = c.order; c.order = Math.min(100, c.order + p.amount); return L('民心 ' + b + ' → ' + c.order, 'Order ' + b + ' → ' + c.order); }
    },
    attack: {
      icon: '⚔', w: function (o, c) { return (o.war >= 60 || o.int >= 80) && c.troops >= 6000 ? o.war * 1.4 : 0; },
      make: function (o, c, lord) {
        var own = round100(c.troops * 0.75), offs = attackParty(c.id, o), bestT = null, bestP = -1, bestFrom = null;
        if (own < 4000) return null;
        CITY[c.id].adj.forEach(function (k) {
          if (!hostile(C(k).owner, lord)) return;
          // 聯合出征：目標旁邊的其他我方城池各出一半兵力
          var from = {}; from[c.id] = own;
          CITY[k].adj.forEach(function (j) { if (j !== c.id && C(j).owner === lord && C(j).troops >= 6000) from[j] = round100(C(j).troops * 0.5); });
          var send = Object.keys(from).reduce(function (s, j) { return s + from[j]; }, 0), p = odds(c.id, k, send, offs);
          if (p > bestP) { bestP = p; bestT = k; bestFrom = from; }
        });
        if (!bestT || bestP < (o.war >= 85 ? 25 : 40)) return null;
        var total = Object.keys(bestFrom).reduce(function (s, j) { return s + bestFrom[j]; }, 0);
        return { target: bestT, troops: total, from: bestFrom, food: Math.round(total / 5), chance: bestP, offs: offs.map(function (x) { return x.id; }) };
      },
      run: function (p) {
        var r = resolveAttack(p.city, p.target, p.troops, p.offs, p.from);
        r.lines.slice(1).forEach(function (s) { log(s); });
        return r.lines[0];
      }
    },
    talent: {
      icon: '🤝', w: function (o, c) { return o.cha * (talentTargets(o, c).length ? 1.2 : 0); },
      make: function (o, c) {
        var list = talentTargets(o, c); if (!list.length) return null;
        list.sort(function (x, y) { return y.chance - x.chance || (y.t.war + y.t.int) - (x.t.war + x.t.int); });
        return { tOff: list[0].t.id, chance: list[0].chance };
      },
      run: function (p, c) {
        var t = O(p.tOff), was = t.lord;
        if (rnd() * 100 < p.chance) {
          t.lord = c.owner; t.city = c.id; t.loyalty = ri(65, 85); t.hidden = false;
          return L(offName(t.id) + (was ? ' 背棄了 ' + lordName(was) + '，' : ' ') + '投效了我軍！', offName(t.id) + (was ? ' leaves ' + lordName(was) + ' and' : '') + ' joins us!');
        }
        if (was) t.loyalty = Math.min(100, t.loyalty + 3);
        return L(offName(t.id) + ' 拒絕了邀請。', offName(t.id) + ' turns down the offer.');
      }
    },
    search: {
      icon: '🔍', w: function (o) { return (o.int + o.cha) / 4; },
      make: function () { return {}; },
      run: function (p, c) {
        var o = O(p.off), hid = freeIn(c.id).filter(function (x) { return x.hidden; });
        if (hid.length && rnd() * 100 < 35 + o.int / 3) {
          var t = pick(hid); t.hidden = false;
          return L('在城裡找到了在野的人才：' + offName(t.id) + '！可以試著登用。', 'Found a talent living quietly in town: ' + offName(t.id) + '! We can try to recruit them.');
        }
        if (rnd() < 0.45) { var g = ri(60, 220); c.gold += g; return L('找到了 ' + g + ' 金。', 'Found ' + g + ' gold.'); }
        return L('沒有找到什麼。', 'Nothing turned up.');
      }
    },
    ally: {
      icon: '🕊', w: function (o, c, lord) { return lord === G.player && c.gold >= 400 && allyTargets().length ? o.int * 0.45 : 0; },
      make: function (o, c, lord) {
        if (lord !== G.player || c.gold < 300) return null;
        var list = allyTargets(); if (!list.length) return null;
        var t = pick(list), ratio = power(t) / Math.max(1, power(G.player));
        return { target: null, lord: t, gold: 300, chance: Math.round(clamp(20 + o.int * 0.4 + o.cha * 0.2 - (ratio > 1.5 ? 25 : ratio > 1 ? 10 : 0), 5, 90)) };
      },
      run: function (p) {
        if (rnd() * 100 < p.chance) { G.allies[p.lord] = MONTHS_TO_ALLY; return L('與 ' + lordName(p.lord) + ' 締結同盟（' + MONTHS_TO_ALLY + ' 個月）！', 'Alliance with ' + lordName(p.lord) + ' sealed (' + MONTHS_TO_ALLY + ' months)!'); }
        return L(lordName(p.lord) + ' 拒絕了同盟。', lordName(p.lord) + ' refuses the alliance.');
      }
    },
    rumor: {
      icon: '🗣', w: function (o, c, lord) { return o.int >= 60 && rumorTargets(c, lord).length ? o.int * 0.6 : 0; },
      make: function (o, c, lord) {
        if (c.gold < 80) return null;
        var list = rumorTargets(c, lord); if (!list.length) return null;
        var t = pick(list), di = best(officersIn(t, C(t).owner), 'int') || 30;
        return { target: t, gold: 80, chance: Math.round(clamp(50 + (o.int - di) * 1.2, 10, 95)) };
      },
      run: function (p) {
        var t = C(p.target), o = O(p.off);
        if (rnd() * 100 < p.chance) {
          var d = Math.round(8 + o.int / 10); t.order = Math.max(0, t.order - d);
          officersIn(t.id, t.owner).forEach(function (x) { if (!isRuler(x)) x.loyalty = Math.max(0, x.loyalty - ri(3, 9)); });
          return L(cityName(t.id) + ' 人心惶惶，民心 −' + d + '，守將的忠誠也動搖了。', cityName(t.id) + ' is in uproar: order −' + d + ', and its officers waver.');
        }
        return L('流言被識破了。', 'The rumours are seen through.');
      }
    },
    reward: {
      icon: '🎁', w: function (o, c, lord) { var t = rewardTarget(lord, o); return t && c.gold >= 100 ? o.pol * 0.5 * (t.loyalty < 70 ? 2.2 : 1) : 0; },
      make: function (o, c, lord) { var t = rewardTarget(lord, o); return t && c.gold >= 100 ? { tOff: t.id, gold: 100, amount: ri(8, 14) } : null; },
      run: function (p) { var t = O(p.tOff), b = t.loyalty; t.loyalty = Math.min(100, t.loyalty + p.amount); return L(offName(t.id) + ' 感激涕零，忠誠 ' + b + ' → ' + t.loyalty, offName(t.id) + ' is deeply moved: loyalty ' + b + ' → ' + t.loyalty); }
    },
    supply: {
      icon: '🐎', w: function (o, c, lord) { return supplyTarget(c, lord) ? o.pol * 0.7 : 0; },
      make: function (o, c, lord) {
        var f = supplyTarget(c, lord); if (!f) return null;
        return { target: f, troops: round100(Math.max(0, c.troops - 5000) * 0.6), moveGold: Math.max(0, Math.round((c.gold - 300) * 0.5)), moveFood: Math.max(0, Math.round((c.food - 2000) * 0.5)) };
      },
      run: function (p, c) {
        var f = C(p.target), tr = Math.min(p.troops, c.troops), g = Math.min(p.moveGold, c.gold), fd = Math.min(p.moveFood, c.food);
        c.troops -= tr; f.troops += tr; c.gold -= g; f.gold += g; c.food -= fd; f.food += fd;
        return L('送往 ' + cityName(f.id) + '：兵 ' + tr + '、金 ' + g + '、糧 ' + fd, 'Sent to ' + cityName(f.id) + ': ' + tr + ' troops, ' + g + ' gold, ' + fd + ' food');
      }
    },
    move: {
      icon: '🚩', w: function (o, c, lord) { return !isRuler(o) && officersIn(c.id, lord).length >= 3 && moveTarget(c, lord) ? 45 : 0; },
      make: function (o, c, lord) { if (isRuler(o) || officersIn(c.id, lord).length < 3) return null; var t = moveTarget(c, lord); return t ? { target: t } : null; },
      run: function (p) { O(p.off).city = p.target; return L(offName(p.off) + ' 前往 ' + cityName(p.target) + ' 駐守。', offName(p.off) + ' now holds ' + cityName(p.target) + '.'); }
    },
    captive: {
      icon: '⛓', w: function () { return 0; }, make: function () { return null; },
      run: function (p, c) {
        var t = O(p.tOff);
        t.captive = null;
        if (rnd() * 100 < captiveChance(t)) { t.lord = G.player; t.city = c.id; t.loyalty = ri(55, 75); return L(offName(t.id) + ' 願意歸順！', offName(t.id) + ' agrees to serve you!'); }
        t.city = pick(CITY_DATA)[0]; t.hidden = false;
        return L(offName(t.id) + ' 寧死不降，只好放他離去。', offName(t.id) + ' will not yield, so you let them go.');
      }
    }
  };
  function captiveChance(t) { var r = O(G.player); return Math.round(clamp(45 + ((r ? r.cha : 70) - 70) * 0.8 - (t.war + t.int > 170 ? 15 : 0), 10, 90)); }
  function talentTargets(o, c) {
    var out = [];
    [c.id].concat(CITY[c.id].adj).forEach(function (k) {
      freeIn(k, true).forEach(function (t) { if (!t.captive) out.push({ t: t, chance: Math.round(clamp(40 + (o.cha - 60) * 1.1 + (k === c.id ? 10 : 0), 10, 95)) }); });
      var ow = C(k).owner;
      if (k !== c.id && ow && hostile(ow, c.owner)) officersIn(k, ow).forEach(function (t) {
        if (!isRuler(t) && t.loyalty < 80) out.push({ t: t, chance: Math.round(clamp(15 + (o.cha - 60) * 0.8 + (80 - t.loyalty) * 1.2, 5, 85)) });
      });
    });
    return out;
  }
  function allyTargets() {
    var seen = {};
    citiesOf(G.player).forEach(function (k) { CITY[k].adj.forEach(function (a) { var ow = C(a).owner; if (ow && ow !== G.player && !(G.allies[ow] > 0)) seen[ow] = 1; }); });
    return Object.keys(seen);
  }
  function rumorTargets(c, lord) { return CITY[c.id].adj.filter(function (k) { var ow = C(k).owner; return ow && hostile(ow, lord); }); }
  function rewardTarget(lord, o) {
    var list = officersOf(lord).filter(function (x) { return !isRuler(x) && x.id !== o.id && x.loyalty < 85; }).sort(function (a, b) { return a.loyalty - b.loyalty; });
    return list[0] || null;
  }
  function supplyTarget(c, lord) {
    if (frontier(c.id) || (c.troops < 12000 && c.gold < 800)) return null;
    var fronts = citiesOf(lord).filter(function (k) { return k !== c.id && frontier(k); }).sort(function (a, b) { return C(a).troops - C(b).troops; });
    return fronts[0] || null;
  }
  function moveTarget(c, lord) {
    var list = citiesOf(lord).filter(function (k) { return k !== c.id && officersIn(k, lord).length <= (frontier(k) ? 1 : 0); });
    list.sort(function (a, b) { return (frontier(b) ? 1 : 0) - (frontier(a) ? 1 : 0); });
    return list[0] || null;
  }

  // 一位武將在自己駐守的城想一個建議
  function propose(o, lord) {
    var c = C(o.city); if (!c || c.owner !== lord) return null;
    var tried = {};
    for (var n = 0; n < 4; n++) {
      var type = wpick(Object.keys(TYPES).filter(function (k) { return !tried[k]; }).map(function (k) { return [k, TYPES[k].w(o, c, lord)]; }));
      if (!type) return null;
      tried[type] = 1;
      var p = TYPES[type].make(o, c, lord);
      if (p) return Object.assign({ type: type, off: o.id, city: c.id }, p);
    }
    return null;
  }
  // 現在還付得起、還成立嗎
  function stillValid(p) {
    var c = C(p.city);
    if (p.type === 'captive') return O(p.tOff) && O(p.tOff).captive === G.player;
    var o = O(p.off);
    if (!c || c.owner !== G.player || !o || o.gone || o.lord !== G.player || o.city !== p.city) return false;
    if (p.type === 'attack' && (!hostile(C(p.target).owner, G.player) || c.troops < (p.from ? p.from[p.city] : p.troops) * 0.6)) return false;
    if (p.type === 'talent') { var t = O(p.tOff); if (!t || t.gone || t.lord === G.player) return false; }
    if (p.type === 'ally' && G.allies[p.lord] > 0) return false;
    return true;
  }
  function affordable(p) { var c = C(p.city); return c && c.gold >= (p.gold || 0) && c.food >= (p.food || 0); }
  function pay(p, c) { c.gold -= p.gold || 0; c.food -= p.food || 0; }

  // 智能判斷：值得做而且付得起才准奏
  function smartYes(p) {
    var c = C(p.city);
    if (!affordable(p)) return false;
    switch (p.type) {
      case 'attack': return p.chance >= 60;
      case 'ally': return p.chance >= 40 && c.gold >= 500;
      case 'rumor': return p.chance >= 50;
      case 'talent': return p.chance >= 25;
      case 'draft': return c.order >= 45;
      case 'relief': return c.order < 80;
      case 'captive': return true;
      default: return c.gold - (p.gold || 0) >= 40;
    }
  }

  // 君主做出決定：yes = 准奏
  function decide(yes) {
    var p = G.queue.shift(); if (!p) return null;
    var res;
    if (!stillValid(p)) res = { ok: false, text: L('情勢已變，這份奏報作廢了。', 'Things have changed; this proposal no longer applies.') };
    else if (p.type === 'captive') {
      var t = O(p.tOff);
      if (yes) res = { ok: true, text: TYPES.captive.run(p, C(p.city)) };
      else { t.captive = null; t.hidden = false; res = { ok: true, text: L('釋放了 ' + offName(t.id) + '。', offName(t.id) + ' is set free.') }; }
    } else if (!yes) {
      var o = O(p.off); o.loyalty = Math.max(0, o.loyalty - ri(1, 3));
      res = { ok: false, text: pick([L(offName(o.id) + '：「……遵命。」', offName(o.id) + ': "…As you command."'), L(offName(o.id) + '：「主公三思。」', offName(o.id) + ': "Please reconsider, my lord."'), L(offName(o.id) + ' 默默退下。', offName(o.id) + ' withdraws in silence.')]) };
    } else if (!affordable(p)) res = { ok: false, text: L('城裡的金或糧不夠，無法執行。', 'The city lacks the gold or food to do it.') };
    else {
      var c = C(p.city); pay(p, c); O(p.off).loyalty = Math.min(100, O(p.off).loyalty + 1);
      res = { ok: true, text: TYPES[p.type].run(p, c) };
    }
    res.p = p;
    G.last = { text: res.text, icon: TYPES[p.type].icon, yes: !!yes };
    log((TYPES[p.type].icon) + ' ' + res.text, yes && res.ok ? 'good' : '');
    checkEnd();
    return res;
  }

  // 電腦勢力：每座有武將的城每月做一件事
  function aiTurn() {
    Object.keys(G.cities).forEach(function (k) {
      var c = C(k), lord = c.owner;
      if (!lord || lord === G.player || !G.lords[lord].alive) return;
      var offs = officersIn(k, lord); if (!offs.length) return;
      // 招募同城的在野人才
      freeIn(k).forEach(function (t) { if (!t.captive && rnd() < 0.03) { t.lord = lord; t.loyalty = ri(60, 80); t.hidden = false; } });
      if (rnd() < 0.15) return;
      var p = propose(pick(offs), lord); if (!p) return;
      if (p.type === 'attack' && (p.chance < 62 || rnd() > 0.45)) return;                     // 電腦不會太衝動
      // 玩家的城：第一年不打、同盟不打、勝算要夠高才打
      if (p.type === 'attack' && C(p.target).owner === G.player && (G.allies[lord] > 0 || G.year * 12 + G.month < 196 * 12 + 13 || p.chance < 70)) return;
      if (p.type === 'talent' && O(p.tOff).lord === G.player && rnd() > 0.5) return;
      if (!affordable(p)) return;
      var prev = p.target ? C(p.target).owner : null, was = p.tOff ? O(p.tOff).lord : null, had = p.tOff ? O(p.tOff).lord !== lord : false;
      pay(p, c);
      var text = TYPES[p.type].run(p, c);
      // 紀錄：打我軍、搶我軍武將的事一定記；別人之間的攻城也記一筆
      if (p.type === 'attack') log((prev === G.player ? '🚨 ' : '') + lordName(lord) + L('軍：', ': ') + text, prev === G.player ? 'bad' : '');
      else if (p.type === 'talent' && was === G.player && had && O(p.tOff).lord === lord) log(L('😠 ', '😠 ') + lordName(lord) + L('挖走了 ', ' lures away ') + offName(p.tOff) + L('。', '.'), 'bad');
    });
  }

  // 每個月：收入、吃糧、電腦行動、事件、忠誠，然後武將上奏
  function nextMonth() {
    if (!G || G.over) return;
    if (G.queue.length) log(L('（' + G.queue.length + ' 份奏報被擱置了）', '(' + G.queue.length + ' proposals were left unanswered)'));
    G.queue.forEach(function (p) { if (p.type === 'captive') { var t = O(p.tOff); t.captive = null; t.hidden = false; } });
    G.queue = []; G.last = null;
    G.month++; if (G.month > 12) { G.month = 1; G.year++; }
    Object.keys(G.cities).forEach(function (k) {
      var c = C(k); if (!c.owner) return;
      var m = 0.5 + c.order / 200;
      c.gold += Math.round(c.com * 0.18 * m);
      c.food += Math.round(c.farm * 0.9 * m) - Math.round(c.troops / 60);
      if (c.food < 0) {
        c.food = 0; c.troops = round100(c.troops * 0.9);
        if (c.owner === G.player) log(L(cityName(k) + ' 糧食耗盡，士兵逃亡！', cityName(k) + ' runs out of food and soldiers desert!'), 'bad');
      }
      if (c.order < 60 && rnd() < 0.3) c.order++;
    });
    aiTurn();
    // 天災與豐收
    if (rnd() < 0.12) {
      var k = pick(Object.keys(G.cities)), c = C(k), mine = c.owner === G.player, ev = ri(0, 3);
      if (ev === 0) { c.food += 800 + c.size * 400; if (mine) log(L('🌾 ' + cityName(k) + ' 大豐收！', '🌾 A bumper harvest in ' + cityName(k) + '!'), 'good'); }
      if (ev === 1) { c.food = Math.round(c.food * 0.6); if (mine) log(L('🦗 ' + cityName(k) + ' 發生蝗災，糧食損失慘重。', '🦗 Locusts strike ' + cityName(k) + '; much food is lost.'), 'bad'); }
      if (ev === 2) { c.troops = round100(c.troops * 0.88); if (mine) log(L('🤒 ' + cityName(k) + ' 爆發瘟疫，兵力減少。', '🤒 Plague in ' + cityName(k) + '; troops are lost.'), 'bad'); }
      if (ev === 3) { c.farm = Math.round(c.farm * 0.9); if (mine) log(L('🌊 ' + cityName(k) + ' 發生洪水，農田受損。', '🌊 Floods damage the farms of ' + cityName(k) + '.'), 'bad'); }
    }
    // 忠誠太低的武將可能出奔
    officersOf(G.player).forEach(function (o) {
      if (!isRuler(o) && o.loyalty < 40 && rnd() < (40 - o.loyalty) / 200) {
        o.lord = null; o.loyalty = 0; o.hidden = false;
        log(L('😠 ' + offName(o.id) + ' 心懷不滿，離開了。', '😠 ' + offName(o.id) + ' leaves in discontent.'), 'bad');
      }
    });
    Object.keys(G.allies).forEach(function (k) {
      if (G.allies[k] > 0 && --G.allies[k] === 0) log(L('與 ' + lordName(k) + ' 的同盟到期了。', 'The alliance with ' + lordName(k) + ' has ended.'));
      if (!G.lords[k].alive) delete G.allies[k];
    });
    checkEnd();
    if (!G.over) beginMonth();
  }
  function beginMonth() {
    var offs = officersOf(G.player).filter(function (o) { return !isRuler(o) || officersOf(G.player).length === 1; });
    var n = Math.min(6, 2 + Math.floor(offs.length / 3)), used = {};
    for (var tries = 0; G.queue.filter(function (p) { return p.type !== 'captive'; }).length < n && tries < n * 4; tries++) {
      var o = pick(offs); if (!o || used[o.id]) continue;
      var p = propose(o, G.player); if (p) { used[o.id] = 1; G.queue.push(p); }
    }
  }
  function checkEnd() {
    if (G.over) return;
    var mine = citiesOf(G.player).length;
    if (!mine) { G.over = 'lose'; log(L('我軍失去了所有的城池……', 'We have lost every city…'), 'bad'); }
    else if (mine === CITY_DATA.length) { G.over = 'win'; log(L('🎉 天下統一！', '🎉 The realm is united!'), 'good'); }
  }

  // 自動回覆：回傳 true / false，或 null = 要問君主
  function autoAnswer(p) {
    var s = G.settings;
    if (s.auto === 'manual') return null;
    if (p.type === 'attack' && s.askAttack) return null;
    if (s.auto === 'all') return affordable(p) || p.type === 'captive';
    return smartYes(p);
  }
  function pump() {
    var done = [];
    while (G && !G.over && G.queue.length) {
      var a = autoAnswer(G.queue[0]); if (a === null) break;
      done.push(decide(a));
    }
    return done;
  }

  // 建議怎麼說 (畫面與紀錄用)
  function describe(p) {
    var o = O(p.off) || O(G.player), c = C(p.city), cn = cityName(p.city), tn = p.target ? cityName(p.target) : '', who = offName(p.tOff);
    var d = {
      farm:  [L('開墾農田', 'Develop farmland'), L('「' + cn + '的田地還有很多荒著，臣請開墾，以足軍糧。」', '"Much of ' + cn + '’s land lies fallow. Let me clear it and fill our granaries."')],
      com:   [L('振興商業', 'Promote trade'), L('「開放市集、減輕商稅，' + cn + '的金庫自然充實。」', '"Open the markets and ease the merchants’ taxes, and ' + cn + '’s treasury will fill."')],
      wall:  [L('修築城牆', 'Repair the walls'), L('「' + cn + '城牆年久失修，萬一敵軍來犯，恐怕難守。」', '"The walls of ' + cn + ' are crumbling. If the enemy comes, we could not hold."')],
      draft: [L('徵兵 ' + p.amount + ' 人', 'Raise ' + p.amount + ' troops'), L('「兵力不足，難以成事。臣請在' + cn + '募兵。」', '"We are short of soldiers. Let me raise men in ' + cn + '."')],
      train: [L('訓練士兵', 'Drill the troops'), L('「新兵還不熟陣法，臣願親自操練！」', '"The new recruits don’t know their formations. Let me drill them myself!"')],
      relief:[L('開倉賑民', 'Feed the people'), L('「百姓生活困苦，臣請開倉放糧，安定民心。」', '"The people are suffering. Let us open the granaries and win their hearts."')],
      attack:[L('出征 ' + tn, 'Attack ' + tn), (o && o.war >= 85) ? L('「' + tn + '不過如此！末將願領兵 ' + p.troops + '，必取此城！」', '"' + tn + ' is nothing! Give me ' + p.troops + ' men and the city is ours!"')
               : L('「' + tn + '守備有隙，正是用兵之時。請發兵 ' + p.troops + '。」', '"' + tn + ' has a gap in its defences. Now is the time — send ' + p.troops + ' men."')],
      talent:[L('登用 ' + who, 'Recruit ' + who), O(p.tOff) && O(p.tOff).lord ? L('「' + who + ' 在' + lordName(O(p.tOff).lord) + '麾下並不得志，臣願前往遊說。」', '"' + who + ' is unhappy under ' + lordName(O(p.tOff).lord) + '. Let me go and win them over."')
               : L('「聽說 ' + who + ' 是難得的人才，臣願登門拜訪，請他出仕。」', '"I hear ' + who + ' is a rare talent. Let me call on them and invite them to serve."')],
      search:[L('搜索人才', 'Search for talent'), L('「' + cn + '城中或許隱藏著賢才，臣想去四處訪查。」', '"There may be hidden talent in ' + cn + '. Let me go and look."')],
      ally:  [L('與' + lordName(p.lord) + '同盟', 'Ally with ' + lordName(p.lord)), L('「四面皆敵，不如與' + lordName(p.lord) + '結盟，專心對付其他人。」', '"We are surrounded. Better to ally with ' + lordName(p.lord) + ' and deal with the rest."')],
      rumor: [L('在' + tn + '散布流言', 'Spread rumours in ' + tn), L('「派人到' + tn + '散布流言，讓他們自亂陣腳。」', '"Let us send agents to ' + tn + ' to spread rumours and set them against each other."')],
      reward:[L('褒賞 ' + who, 'Reward ' + who), L('「' + who + ' 近來似有怨言，請主公賜金以安其心。」', '"' + who + ' has been grumbling lately. A gift of gold would set their heart at ease."')],
      supply:[L('輸送物資到' + tn, 'Send supplies to ' + tn), L('「' + tn + '是前線，請把' + cn + '的兵馬糧草送過去。」', '"' + tn + ' is on the front line. Let us send ' + cn + '’s troops and supplies there."')],
      move:  [L('調往 ' + tn, 'Transfer to ' + tn), L('「' + tn + '缺少守將，臣願前往鎮守。」', '"' + tn + ' has no one to hold it. Let me go and take command."')],
      captive:[L('處置俘虜 ' + who, 'Decide the fate of ' + who), L('「我軍俘虜了 ' + who + '。主公要勸他歸順嗎？（駁回＝釋放）」', '"We have captured ' + who + '. Shall we try to win them over? (Reject = set free)"')]
    }[p.type];
    var bits = [];
    if (p.gold) bits.push(L('金 ', 'gold ') + p.gold);
    if (p.food) bits.push(L('糧 ', 'food ') + p.food);
    var helpers = p.from ? Object.keys(p.from).filter(function (j) { return j !== p.city; }).map(cityName) : [];
    if (p.type === 'attack') bits.push(L('兵 ', 'troops ') + p.troops + (helpers.length ? L('（' + helpers.join('、') + ' 支援）', ' (with help from ' + helpers.join(', ') + ')') : '') + L('　隨行：', ' · with ') + p.offs.map(offName).join(L('、', ', ')));
    if (p.type === 'supply') bits.push(L('兵 ', 'troops ') + p.troops + L('　金 ', ' · gold ') + p.moveGold + L('　糧 ', ' · food ') + p.moveFood);
    var gain = { farm: L('農業 +', 'farmland +'), com: L('商業 +', 'trade +'), wall: L('城防 +', 'walls +'), train: L('訓練 +', 'training +'), relief: L('民心 +', 'order +'), reward: L('忠誠 +', 'loyalty +') }[p.type];
    var chance = p.type === 'captive' ? captiveChance(O(p.tOff)) : p.chance;
    return { icon: TYPES[p.type].icon, title: d[0], speech: d[1], cost: bits.join(L('　', ' · ')), gain: gain ? gain + p.amount : '', chance: chance == null ? null : chance, city: c };
  }

  S.Ruler = {
    LORDS: LORDS, LORD_ORDER: LORD_ORDER, CITY: CITY, OFF: OFF,
    newGame: newGame, nextMonth: nextMonth, decide: decide, pump: pump, describe: describe, autoAnswer: autoAnswer,
    get G() { return G; }, set G(v) { G = v; },
    citiesOf: citiesOf, officersOf: officersOf, officersIn: officersIn, freeIn: freeIn, power: power, cityName: cityName, offName: offName, lordName: lordName,
    cap: cap, troopCap: troopCap, frontier: frontier, isRuler: isRuler
  };

  // ======================= 畫面 =======================
  if (typeof document === 'undefined') return;
  var KEY = 'sango.ruler', root = document.getElementById('ruler');
  if (!root) return;
  var screen = 'pick', selected = null, advTimer = null, flash = [];
  function save() { try { localStorage.setItem(KEY, JSON.stringify(G)); } catch (e) { /* 存不了就算了 */ } }
  function loadSave() { try { var d = JSON.parse(localStorage.getItem(KEY)); return d && d.v === 1 ? d : null; } catch (e) { return null; } }
  function col(lord) { return lord ? LORDS[lord].col : '#55555f'; }
  function fmt(n) { return EN ? (n >= 10000 ? (n / 1000).toFixed(0) + 'k' : String(n)) : (n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + '萬' : String(n)); }
  function seal(id, lord) { var nmz = OFF[id] ? OFF[id].n[0] : '?'; return '<span class="r-seal" style="background:' + col(lord) + '">' + esc(nmz.charAt(0)) + '</span>'; }
  function stats(o) { return L('武', 'WAR ') + o.war + L(' 智', ' INT ') + o.int + L(' 政', ' POL ') + o.pol + L(' 魅', ' CHA ') + o.cha; }

  // ---- 選君主 ----
  function renderPick() {
    screen = 'pick'; stopAdvance();
    var sv = loadSave();
    var rows = LORD_ORDER.map(function (k) {
      var cs = CITY_DATA.filter(function (d) { return d[6] === k; }), os = OFFICER_DATA.filter(function (d) { return d[7] === k; });
      var stars = DIFF[k];
      var top = os.slice().sort(function (a, b) { return (b[3] + b[4]) - (a[3] + a[4]); }).slice(0, 4).map(function (d) { return EN ? d[2] : d[1]; }).join(L('、', ', '));
      return '<button class="r-lord" data-lord="' + k + '"><span class="r-swatch" style="background:' + col(k) + '"></span>' +
        '<b>' + esc(lordName(k)) + '</b><small>' + L('城 ', 'cities ') + cs.length + L('　武將 ', ' · officers ') + os.length + '</small>' +
        '<small class="r-diff">' + L('難度 ', 'difficulty ') + '★★★★★'.slice(0, stars) + '<span>' + '★★★★★'.slice(stars) + '</span></small>' +
        '<small class="r-top">' + esc(top) + '</small></button>';
    }).join('');
    root.innerHTML = '<h2>' + L('👑 君主模式 · 196 年 群雄割據', '👑 Ruler Mode · AD 196, the Warlords') + '</h2>' +
      '<p class="r-intro">' + L('選擇一位君主。麾下武將每個月會輪流上奏建議：開墾、徵兵、出征、登用人才……由你「准奏」或「駁回」。也可以設定自動回覆，讓天下大勢自己運轉。',
        'Choose a ruler. Each month your officers bring you proposals — farming, drafting, attacks, recruiting talent… — and you approve or reject them. You can also let proposals be answered automatically and watch history unfold.') + '</p>' +
      (sv && !sv.over ? '<button id="r-continue" class="primary">' + L('▶ 繼續：' + lordName(sv.player) + '　' + sv.year + ' 年 ' + sv.month + ' 月', '▶ Continue: ' + lordName(sv.player) + ', ' + sv.year + '/' + sv.month) + '</button>' : '') +
      '<div class="r-lords">' + rows + '</div>';
    Array.prototype.forEach.call(root.querySelectorAll('.r-lord'), function (b) {
      b.addEventListener('click', function () {
        var go = function () { newGame(b.getAttribute('data-lord')); selected = O(G.player).city; flash = pump(); save(); renderPlay(); };
        if (sv && !sv.over) twice(b, '<b>' + L('再按一次：開始新遊戲', 'Press again to start a new game') + '</b><small>' + L('（會覆蓋目前的存檔）', '(replaces your saved game)') + '</small>', go); else go();
      });
    });
    var cont = document.getElementById('r-continue');
    if (cont) cont.addEventListener('click', function () { G = sv; selected = (O(G.player) && O(G.player).city) || citiesOf(G.player)[0]; flash = pump(); renderPlay(); });
  }

  // ---- 地圖 ----
  function mapSvg(p) {
    var s = '<svg class="r-map" viewBox="0 0 1000 800" role="img" aria-label="map">' +
      '<rect width="1000" height="800" rx="18" fill="#26302a"/>' +
      '<path d="M60,250 C200,260 300,230 420,240 C520,250 560,200 660,210 C760,220 820,200 960,190" stroke="#c8a85a" stroke-opacity=".35" stroke-width="14" fill="none"/>' +
      '<path d="M120,640 C230,600 330,670 430,650 C520,630 560,640 640,620 C720,600 790,610 960,600" stroke="#4a8ad8" stroke-opacity=".35" stroke-width="16" fill="none"/>';
    ROADS.forEach(function (r) { var a = CITY[r[0]], b = CITY[r[1]]; s += '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="#5c5a48" stroke-width="4"/>'; });
    if (p && p.target && CITY[p.target] && CITY[p.city]) {
      var a = CITY[p.city], b = CITY[p.target], hostileMove = p.type === 'attack' || p.type === 'rumor';
      s += '<line class="r-arrow" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="' + (hostileMove ? '#ff5a4a' : '#ffd84a') + '" stroke-width="7" stroke-dasharray="16 10"/>';
    }
    Object.keys(CITY).forEach(function (k) {
      var c = CITY[k], g = C(k), me = g.owner === G.player, r = 14 + c.size * 4;
      s += '<g class="r-city" data-city="' + k + '">' +
        (k === selected ? '<circle cx="' + c.x + '" cy="' + c.y + '" r="' + (r + 9) + '" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="6 5"/>' : '') +
        '<circle cx="' + c.x + '" cy="' + c.y + '" r="' + r + '" fill="' + col(g.owner) + '" stroke="' + (me ? '#ffd84a' : '#141418') + '" stroke-width="' + (me ? 5 : 3) + '"/>' +
        '<text x="' + c.x + '" y="' + (c.y + r + 24) + '" text-anchor="middle" class="r-cn">' + esc(cityName(k)) + '</text>' +
        '<text x="' + c.x + '" y="' + (c.y + 7) + '" text-anchor="middle" class="r-ct">' + esc(fmt(g.troops)) + '</text></g>';
    });
    return s + '</svg>';
  }

  // ---- 奏報卡 ----
  function cardHtml() {
    var res = flash.length ? '<div class="r-results">' + flash.slice(-4).map(function (r) {
      return '<p class="' + (r.ok ? 'ok' : '') + '">' + TYPES[r.p.type].icon + ' ' + esc(r.text) + '</p>';
    }).join('') + '</div>' : '';
    if (G.over) {
      return res + '<div class="r-card r-over"><h3>' + (G.over === 'win' ? L('🎉 天下統一！', '🎉 The realm is united!') : L('🏳 霸業未竟……', '🏳 Your ambition has ended…')) + '</h3>' +
        '<p>' + G.year + L(' 年 ', '/') + G.month + L(' 月', '') + '</p><button id="r-new" class="primary">' + L('重新選擇君主', 'Choose a ruler again') + '</button></div>';
    }
    var p = G.queue[0];
    if (!p) {
      return res + '<div class="r-card r-empty"><p>' + L('本月的奏報都處理完了。', 'All of this month’s proposals have been answered.') + '</p>' +
        '<button id="r-next" class="primary big">' + L('下個月 ▶', 'Next month ▶') + '</button>' + (G.settings.advance ? '<small>' + L('（自動推進中）', '(advancing automatically)') + '</small>' : '') + '</div>';
    }
    var o = O(p.off) || O(G.player), d = describe(p);
    return res + '<div class="r-card">' +
      '<div class="r-who">' + seal(o.id, o.lord || G.player) + '<div><b>' + esc(offName(o.id)) + '</b> <small>@' + esc(cityName(o.city)) + '</small><br><small>' + stats(o) + L('　忠誠 ', ' · loyalty ') + o.loyalty + '</small></div></div>' +
      '<h3>' + d.icon + ' ' + esc(d.title) + '</h3>' +
      '<p class="r-speech">' + esc(d.speech) + '</p>' +
      '<p class="r-detail">' + (d.cost ? '<span>' + L('花費：', 'Cost: ') + esc(d.cost) + '</span>' : '') + (d.gain ? '<span>' + L('預估：', 'Expected: ') + esc(d.gain) + '</span>' : '') +
      (d.chance != null ? '<span class="' + (d.chance >= 60 ? 'hi' : d.chance >= 35 ? 'mid' : 'lo') + '">' + L('成功率 ', 'success ') + d.chance + '%</span>' : '') + '</p>' +
      '<div class="r-btns"><button id="r-yes" class="primary">' + (p.type === 'captive' ? L('✔ 勸降', '✔ Win over') : L('✔ 准奏', '✔ Approve')) + '</button>' +
      '<button id="r-no">' + (p.type === 'captive' ? L('✖ 釋放', '✖ Release') : L('✖ 駁回', '✖ Reject')) + '</button></div>' +
      '<small class="r-left">' + (G.queue.length > 1 ? L('還有 ' + (G.queue.length - 1) + ' 份奏報', (G.queue.length - 1) + ' more waiting') : L('這是本月最後一份奏報', 'Last proposal this month')) + '</small></div>';
  }

  function cityHtml() {
    var k = selected; if (!k || !G.cities[k]) return '';
    var c = C(k), offs = c.owner ? officersIn(k, c.owner) : [], free = freeIn(k, true).filter(function (o) { return !o.captive; });
    var bar = function (v, m) { return '<span class="r-bar"><i style="width:' + Math.round(clamp(v / m, 0, 1) * 100) + '%"></i></span>'; };
    return '<div class="r-cityinfo"><h3><span class="r-swatch" style="background:' + col(c.owner) + '"></span>' + esc(cityName(k)) + ' <small>' + esc(lordName(c.owner)) + (allied(c.owner, G.player) ? L('（同盟）', ' (ally)') : '') + '</small></h3>' +
      '<table><tr><td>' + L('兵力', 'Troops') + '</td><td>' + c.troops + '</td><td>' + L('訓練', 'Training') + '</td><td>' + c.train + '</td></tr>' +
      '<tr><td>' + L('金', 'Gold') + '</td><td>' + c.gold + '</td><td>' + L('糧', 'Food') + '</td><td>' + c.food + '</td></tr>' +
      '<tr><td>' + L('農業', 'Farms') + '</td><td>' + c.farm + bar(c.farm, cap(c)) + '</td><td>' + L('商業', 'Trade') + '</td><td>' + c.com + bar(c.com, cap(c)) + '</td></tr>' +
      '<tr><td>' + L('城防', 'Walls') + '</td><td>' + c.def + bar(c.def, cap(c)) + '</td><td>' + L('民心', 'Order') + '</td><td>' + c.order + bar(c.order, 100) + '</td></tr></table>' +
      (offs.length ? '<div class="r-offs">' + offs.map(function (o) { return '<span title="' + esc(stats(o)) + '">' + seal(o.id, o.lord) + esc(offName(o.id)) + (o.lord === G.player && !isRuler(o) ? '<small>' + o.loyalty + '</small>' : '') + '</span>'; }).join('') + '</div>' : '<p class="r-none">' + L('沒有武將駐守', 'No officers here') + '</p>') +
      (free.length ? '<p class="r-free">' + L('在野：', 'Unaffiliated: ') + free.map(function (o) { return esc(offName(o.id)); }).join(L('、', ', ')) + '</p>' : '') + '</div>';
  }

  function settingsHtml() {
    var s = G.settings;
    var opt = function (v, t) { return '<option value="' + v + '"' + (s.auto === v ? ' selected' : '') + '>' + t + '</option>'; };
    var sp = function (v, t) { return '<option value="' + v + '"' + (s.speed === v ? ' selected' : '') + '>' + t + '</option>'; };
    return '<div class="r-settings"><label>' + L('自動回覆奏報', 'Answer proposals') + ' <select id="r-auto">' + opt('manual', L('手動（每份都問我）', 'Manually (ask me)')) + opt('smart', L('智能判斷', 'Smart (judge for me)')) + opt('all', L('全部准奏', 'Approve everything')) + '</select></label>' +
      '<label><input type="checkbox" id="r-askatk"' + (s.askAttack ? ' checked' : '') + '> ' + L('出征仍由我決定', 'Always ask me about attacks') + '</label>' +
      '<label><input type="checkbox" id="r-adv"' + (s.advance ? ' checked' : '') + '> ' + L('自動推進月份', 'Advance months automatically') + '</label>' +
      '<select id="r-speed">' + sp(3000, L('慢', 'Slow')) + sp(1500, L('中', 'Normal')) + sp(600, L('快', 'Fast')) + '</select>' +
      '<button id="r-quit">' + L('重選君主', 'Change ruler') + '</button></div>';
  }

  function renderPlay() {
    screen = 'play';
    var mine = citiesOf(G.player), tot = function (k) { return mine.reduce(function (s, c) { return s + C(c)[k]; }, 0); };
    var p = G.queue[0];
    root.innerHTML =
      '<div class="r-top"><b class="r-date">' + G.year + L(' 年 ', '/') + G.month + L(' 月', '') + '</b>' +
      '<span class="r-swatch" style="background:' + col(G.player) + '"></span><b>' + esc(lordName(G.player)) + '</b>' +
      '<span>🏯 ' + mine.length + '/' + CITY_DATA.length + '</span><span>👤 ' + officersOf(G.player).length + '</span>' +
      '<span>💰 ' + tot('gold') + '</span><span>🌾 ' + tot('food') + '</span><span>⚔ ' + fmt(tot('troops')) + '</span>' +
      Object.keys(G.allies).filter(function (k) { return G.allies[k] > 0; }).map(function (k) { return '<span class="r-ally">🕊 ' + esc(lordName(k)) + ' ' + G.allies[k] + L('月', 'mo') + '</span>'; }).join('') + '</div>' +
      settingsHtml() +
      '<div class="r-main"><div class="r-mapwrap">' + mapSvg(p) + '</div><div class="r-side">' + cardHtml() + cityHtml() + '</div></div>' +
      '<ol class="r-log">' + G.log.slice(-30).reverse().map(function (e) { return '<li class="' + e.kind + '"><small>' + e.t + '</small> ' + esc(e.text) + '</li>'; }).join('') + '</ol>';
    bind();
    scheduleAdvance();
  }
  function bind() {
    var on = function (id, ev, fn) { var el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
    on('r-yes', 'click', function () { answer(true); });
    on('r-no', 'click', function () { answer(false); });
    on('r-next', 'click', function () { advance(); });
    on('r-new', 'click', function () { try { localStorage.removeItem(KEY); } catch (e) { /* 無妨 */ } renderPick(); });
    on('r-quit', 'click', function (e) { twice(e.currentTarget, L('再按一次回到選君主（已存檔）', 'Press again (game is saved)'), function () { save(); renderPick(); }); });
    on('r-auto', 'change', function (e) { G.settings.auto = e.target.value; flash = flash.concat(pump()); save(); renderPlay(); });
    on('r-askatk', 'change', function (e) { G.settings.askAttack = e.target.checked; flash = flash.concat(pump()); save(); renderPlay(); });
    on('r-adv', 'change', function (e) { G.settings.advance = e.target.checked; save(); renderPlay(); });
    on('r-speed', 'change', function (e) { G.settings.speed = Number(e.target.value); save(); renderPlay(); });
    Array.prototype.forEach.call(root.querySelectorAll('.r-city'), function (g) {
      g.addEventListener('click', function () { selected = g.getAttribute('data-city'); renderPlay(); });
    });
  }
  function answer(yes) {
    var p = G.queue[0]; if (!p) return;
    flash = [decide(yes)].concat(pump());
    if (G.queue[0]) selected = G.queue[0].city;
    sfx(yes ? 'ok' : 'cancel');
    save(); renderPlay();
  }
  function advance() {
    stopAdvance();
    nextMonth();
    flash = pump();
    if (G.queue[0]) selected = G.queue[0].city;
    else if (!G.cities[selected] || G.cities[selected].owner !== G.player) selected = citiesOf(G.player)[0] || selected;
    save(); renderPlay();
  }
  function stopAdvance() { if (advTimer) { clearTimeout(advTimer); advTimer = null; } }
  function scheduleAdvance() {
    stopAdvance();
    if (screen === 'play' && G && !G.over && G.settings.advance && !G.queue.length && isOn()) advTimer = setTimeout(advance, G.settings.speed);
  }
  // 需要確認的按鈕：第一次按只換成提示文字，三秒內再按一次才執行 (不用 window.confirm，有些環境不會跳出對話框)
  function twice(el, ask, fn) {
    if (el.getAttribute('data-armed')) { fn(); return; }
    var old = el.innerHTML; el.setAttribute('data-armed', '1'); el.classList.add('r-armed'); el.innerHTML = ask;
    setTimeout(function () { if (document.body.contains(el)) { el.removeAttribute('data-armed'); el.classList.remove('r-armed'); el.innerHTML = old; } }, 3000);
  }
  function sfx(name) { try { if (S.Sound) S.Sound.play(name); } catch (e) { /* 沒有這個音效也沒關係 */ } }

  // ======================= 兩種模式切換 =======================
  var MODE_KEY = 'sango.mode';
  function isOn() { return document.body.classList.contains('mode-ruler'); }
  function setMode(m) {
    try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* 無妨 */ }
    document.body.classList.toggle('mode-ruler', m === 'ruler');
    Array.prototype.forEach.call(document.querySelectorAll('#modes [data-mode]'), function (b) { b.classList.toggle('on', b.getAttribute('data-mode') === m); });
    root.hidden = m !== 'ruler';
    if (m === 'ruler') { if (S.game && S.game.stop) S.game.stop(); if (screen === 'play' && G) renderPlay(); else renderPick(); }
    else stopAdvance();
  }
  Array.prototype.forEach.call(document.querySelectorAll('#modes [data-mode]'), function (b) {
    b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
  });
  var mode = 'ruler';
  try { mode = localStorage.getItem(MODE_KEY) || 'ruler'; } catch (e) { /* 無妨 */ }
  setMode(mode === 'general' ? 'general' : 'ruler');
  window.__ruler = { get G() { return G; }, answer: answer, advance: advance, renderPlay: renderPlay, start: function (k) { newGame(k); selected = O(G.player).city; flash = pump(); save(); renderPlay(); } };
})(window.Sango);
