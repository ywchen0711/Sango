/*
 * 點陣圖資料 (16x16 單位、24x24 頭像)，皆面向右；左右翻轉在繪製時處理。
 * 調色盤字元：o 輪廓 a 盔甲 b 盔甲陰影 s 皮膚 w 金屬 k 木柄 h 馬 H 馬陰影 y 金飾
 */
(function (S) {
  'use strict';

  var COMMON = { s: '#f8b878', w: '#ffffff', k: '#a05818', y: '#f8d838' };

  S.SIDE_PALETTES = [
    { o: '#181828', a: '#f0f0f8', b: '#6888e8', h: '#b87030', H: '#683810' },
    { o: '#380800', a: '#e04020', b: '#f8b070', h: '#b87030', H: '#683810' }
  ];
  var GENERAL_HORSE = { h: '#f0f0f0', H: '#8890a0' };

  // 替換最後幾列 (腳) 產生走路第二格
  function withRows(base, start, rows) {
    var out = base.slice();
    for (var i = 0; i < rows.length; i++) out[start + i] = rows[i];
    return out;
  }

  var SPEAR = [
    '...........w....',
    '..........www...',
    '...........k....',
    '....ooo....k....',
    '...oaaao...k....',
    '...osssoo..k....',
    '....ssso...k....',
    '...oaaaasssk....',
    '..oabaaao..k....',
    '..oabaaao..k....',
    '...oaaao...k....',
    '...obbbo...k....',
    '...oo.oo...k....',
    '...oo.oo........',
    '..ooo.ooo.......',
    '................'
  ];

  var ARCHER = [
    '................',
    '...........k....',
    '....ooo.....k...',
    '...oaaao.....k..',
    '...osssoo....k..',
    '....ssso......k.',
    '...oaaaasssswwk.',
    '..oabaaao.....k.',
    '..oabaaao....k..',
    '...oaaao.....k..',
    '...obbbo....k...',
    '...oo.oo...k....',
    '...oo.oo........',
    '..ooo.ooo.......',
    '................',
    '................'
  ];

  var CAVALRY = [
    '.......ooo......',
    '......oaaao...w.',
    '......osssoo..k.',
    '.......ssso..k..',
    '......oaaassk...',
    '.....oabaaaok.oo',
    '.....oaaaaaoohHo',
    '..o.oobbbbbohhHo',
    '.oHohhhhhhhhhhho',
    '.oHhhhhhhhhhhoo.',
    '..ohhhhhhhhhho..',
    '...ohhooooohho..',
    '...oho....oho...',
    '...oo.....oo....',
    '..oo.....oo.....',
    '................'
  ];
  var CAVALRY_LEGS = [
    '..oho.....oho...',
    '..oo.......oo...',
    '.oo.......oo....'
  ];

  var GENERAL = withRows(CAVALRY, 0, [
    '......yoooy.....',
    '......oyyyo...y.'
  ]);

  S.SPRITE_DATA = {
    spear:   [SPEAR, withRows(SPEAR, 12, ['...oooo....k....', '...oo..oo.......', '..oo....oo......'])],
    archer:  [ARCHER, withRows(ARCHER, 11, ['...oooo....k....', '...oo..oo.......', '..oo....oo......'])],
    cavalry: [CAVALRY, withRows(CAVALRY, 12, CAVALRY_LEGS)],
    general: [GENERAL, withRows(GENERAL, 12, CAVALRY_LEGS)],
    wolf: [[
      '................',
      '................',
      '................',
      '...........o.o..',
      '..........ofofo.',
      '..........offffo',
      'o.........offefo',
      'of.oooooooffffnn',
      'offffffffffffoo.',
      '.offfffffffffo..',
      '..offfffffffdo..',
      '..odffdddffddo..',
      '..of.of...of.of.',
      '..of.of...of.of.',
      '..oo.oo...oo.oo.',
      '................'
    ], [
      '................',
      '................',
      '................',
      '...........o.o..',
      '..........ofofo.',
      '..........offffo',
      'o.........offefo',
      'of.oooooooffffnn',
      'offffffffffffoo.',
      '.offfffffffffo..',
      '..offfffffffdo..',
      '..odffdddffddo..',
      '..of..of.of..of.',
      '..of..of.of..of.',
      '..oo..oo.oo..oo.',
      '................'
    ]],
    boar: [[
      '................',
      '................',
      '................',
      '................',
      '....o.o.o.o.....',
      '...oddddddddoo..',
      '..odddddddddddo.',
      '.oddddddddddeddo',
      '.odddddddddddddn',
      '.oddddddddddddtn',
      '..oddddddddddto.',
      '..oddddddddddo..',
      '...od.od..od.od.',
      '...od.od..od.od.',
      '...oo.oo..oo.oo.',
      '................'
    ], [
      '................',
      '................',
      '................',
      '................',
      '....o.o.o.o.....',
      '...oddddddddoo..',
      '..odddddddddddo.',
      '.oddddddddddeddo',
      '.odddddddddddddn',
      '.oddddddddddddtn',
      '..oddddddddddto.',
      '..oddddddddddo..',
      '...od..od.od..od',
      '...od..od.od..od',
      '...oo..oo.oo..oo',
      '................'
    ]],
    bear: [[
      '................',
      '................',
      '...........oo...',
      '..........odoo..',
      '....oooooodddoo.',
      '...oddddddddedo.',
      '..odddddddddddno',
      '.oddddddddddddo.',
      '.odddddddddddo..',
      '.odddddddddddo..',
      '.oddddddddddddo.',
      '.oddddddddddddo.',
      '..odd.odd.odd.o.',
      '..odd.odd.odd.o.',
      '..ooo.ooo.ooo...',
      '................'
    ], [
      '................',
      '................',
      '...........oo...',
      '..........odoo..',
      '....oooooodddoo.',
      '...oddddddddedo.',
      '..odddddddddddno',
      '.oddddddddddddo.',
      '.odddddddddddo..',
      '.odddddddddddo..',
      '.oddddddddddddo.',
      '.oddddddddddddo.',
      '..odd..odd.odd..',
      '..odd..odd.odd..',
      '..ooo..ooo.ooo..',
      '................'
    ]],
    deer: [[
      '..........t.t...',
      '..........tt.t..',
      '...........tt...',
      '..........offo..',
      '..........ofeo..',
      '..........offnn.',
      '.w.......offo...',
      'owoooooooffo....',
      '.offffffffffo...',
      '.offffffffffo...',
      '..offffffffo....',
      '..of.of..of.of..',
      '..of.of..of.of..',
      '..of.of..of.of..',
      '..oo.oo..oo.oo..',
      '................'
    ], [
      '..........t.t...',
      '..........tt.t..',
      '...........tt...',
      '..........offo..',
      '..........ofeo..',
      '..........offnn.',
      '.w.......offo...',
      'owoooooooffo....',
      '.offffffffffo...',
      '.offffffffffo...',
      '..offffffffo....',
      '..of.of..of.of..',
      '..of..of.of..of.',
      '..of..of.of..of.',
      '..oo..oo.oo..oo.',
      '................'
    ]]
  };

  // 動物 (探索模式的野外)：毛色固定，不分陣營
  var ANIMAL_PALETTES = {
    wolf: { o: '#202020', f: '#909098', d: '#606068', e: '#f8d838', n: '#202020' },
    boar: { o: '#201008', d: '#6a4020', e: '#f84020', n: '#c08060', t: '#f8f0d0' },
    bear: { o: '#100804', d: '#4a2a14', e: '#f8f0d0', n: '#201008' },
    deer: { o: '#382010', f: '#c08040', e: '#202020', n: '#382010', t: '#e8d8b0', w: '#ffffff' }
  };


  // 頭像：O 輪廓 H 頭盔 h 頭盔飾 S 臉 E 眼 M 嘴 B 鬍鬚 A 鎧甲 a 鎧甲紋
  S.PORTRAIT_DATA = [
    '........OOOOOOOO........',
    '......OOHHHHHHHHOO......',
    '.....OHHHHhhhhHHHHO.....',
    '....OHHHHHHHHHHHHHHO....',
    '....OHHHHHHHHHHHHHHO....',
    '...OHHOOOOOOOOOOOOHHO...',
    '...OHOSSSSSSSSSSSSOHO...',
    '...OHOSSSSSSSSSSSSOHO...',
    '...OHOSOOOSSSSOOOSOHO...',
    '...OHOSSEESSSSEESSOHO...',
    '...OHOSSSSSSSSSSSSOHO...',
    '...OHOSSSSSOOSSSSSOHO...',
    '...OHOSSSSSSSSSSSSOHO...',
    '...OHOSBSSSSSSSSBSOHO...',
    '...OHOSBBSMMMMSBBSOHO...',
    '...OHOSBBBBBBBBBBSOHO...',
    '...OHHOSBBBBBBBBSOHHO...',
    '....OHHOSBBBBBBSOHHO....',
    '.....OHHOOBBBBOOHHO.....',
    '....OOAAAOOOOOOAAAOO....',
    '..OOAAAAAAAAAAAAAAAAOO..',
    '.OAAAAaAAAAAAAAAAaAAAAO.',
    'OAAAAAaAAAAAAAAAAaAAAAAO',
    'OAAAAAaAAAAAAAAAAaAAAAAO'
  ];

  function merge() {
    var out = {};
    for (var i = 0; i < arguments.length; i++) {
      for (var k in arguments[i]) out[k] = arguments[i][k];
    }
    return out;
  }

  function paint(rows, pal, solid) {
    var c = document.createElement('canvas');
    c.width = rows[0].length;
    c.height = rows.length;
    var g = c.getContext('2d');
    for (var y = 0; y < rows.length; y++) {
      for (var x = 0; x < rows[y].length; x++) {
        var ch = rows[y][x];
        if (ch === '.') continue;
        var col = solid || pal[ch];
        if (!col) continue;
        g.fillStyle = col;
        g.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  // 回傳 sprites[side][type] = { frames: [canvas...], flash: [canvas...] }
  S.buildSprites = function () {
    var out = [{}, {}];
    for (var side = 0; side < 2; side++) {
      for (var type in S.SPRITE_DATA) {
        var pal = ANIMAL_PALETTES[type] || merge(COMMON, S.SIDE_PALETTES[side], type === 'general' ? GENERAL_HORSE : {});
        var data = S.SPRITE_DATA[type];
        out[side][type] = {
          frames: data.map(function (r) { return paint(r, pal); }),
          flash: data.map(function (r) { return paint(r, null, '#ffffff'); })
        };
      }
    }
    return out;
  };

  S.buildPortrait = function (side, army) {
    var sp = S.SIDE_PALETTES[side];
    var skin = '#f0a040';
    var pal = {
      O: '#000000', H: side === 0 ? '#f0f0f8' : '#f8d0a0', h: sp.b,
      S: skin, E: '#000000', M: '#802000', B: army.beard || skin,
      A: sp.b, a: sp.o
    };
    return paint(S.PORTRAIT_DATA, pal);
  };
})(window.Sango);
