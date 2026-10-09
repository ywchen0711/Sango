/*
 * 語言切換：中文 / English
 * S.t('中文') 在英文模式下查 S.EN 字典 (i18n-en.js)，查不到就照原樣顯示中文
 * 語言存在這台裝置 (localStorage)，切換時重新載入頁面 (進度都已存檔)
 */
window.Sango = window.Sango || {};

(function (S) {
  'use strict';

  var lang = 'zh';
  try {
    var saved = window.localStorage && localStorage.getItem('sango.lang');
    if (saved === 'zh' || saved === 'en') lang = saved;
    else if (typeof navigator !== 'undefined' && navigator.language && !/^zh/i.test(navigator.language)) lang = 'en';   // 第一次來：看瀏覽器語言
  } catch (e) { /* Node 模擬或無痕模式：用中文 */ }
  S.lang = lang;
  S.EN = S.EN || {};

  S.t = function (s) {
    if (S.lang !== 'en') return s;
    var v = S.EN[s];
    return v == null ? s : v;
  };

  S.setLang = function (l) {
    try { localStorage.setItem('sango.lang', l); } catch (e) { /* 存不了也照樣切換這一次 */ }
    location.reload();
  };

  // 士兵的名字 (存檔裡是中文)：英文模式顯示拼音，例如 張勇虎 → Zhang Yonghu
  var PINYIN = {
    '王': 'Wang', '李': 'Li', '張': 'Zhang', '劉': 'Liu', '陳': 'Chen', '楊': 'Yang', '趙': 'Zhao', '黃': 'Huang', '周': 'Zhou', '吳': 'Wu',
    '徐': 'Xu', '孫': 'Sun', '馬': 'Ma', '朱': 'Zhu', '胡': 'Hu', '郭': 'Guo', '何': 'He', '高': 'Gao', '林': 'Lin', '羅': 'Luo',
    '鄭': 'Zheng', '梁': 'Liang', '謝': 'Xie', '宋': 'Song', '唐': 'Tang', '許': 'Xu', '韓': 'Han', '馮': 'Feng', '鄧': 'Deng', '曹': 'Cao',
    '彭': 'Peng', '曾': 'Zeng', '蕭': 'Xiao', '田': 'Tian', '董': 'Dong', '袁': 'Yuan', '潘': 'Pan', '于': 'Yu', '蔣': 'Jiang', '蔡': 'Cai',
    '余': 'Yu', '杜': 'Du', '葉': 'Ye', '程': 'Cheng', '蘇': 'Su', '魏': 'Wei', '呂': 'Lv', '丁': 'Ding', '任': 'Ren', '沈': 'Shen',
    '姚': 'Yao', '盧': 'Lu', '姜': 'Jiang', '崔': 'Cui', '鍾': 'Zhong', '譚': 'Tan', '陸': 'Lu', '汪': 'Wang', '范': 'Fan', '金': 'Jin',
    '石': 'Shi', '廖': 'Liao', '賈': 'Jia', '夏': 'Xia', '韋': 'Wei', '付': 'Fu', '方': 'Fang', '白': 'Bai', '鄒': 'Zou', '孟': 'Meng',
    '熊': 'Xiong', '秦': 'Qin', '邱': 'Qiu', '江': 'Jiang', '尹': 'Yin', '薛': 'Xue', '閻': 'Yan', '段': 'Duan', '雷': 'Lei', '侯': 'Hou',
    '龍': 'Long', '史': 'Shi', '陶': 'Tao', '黎': 'Li', '賀': 'He', '顧': 'Gu', '毛': 'Mao', '郝': 'Hao', '龔': 'Gong', '邵': 'Shao',
    '萬': 'Wan', '錢': 'Qian', '嚴': 'Yan', '覃': 'Qin', '武': 'Wu', '戴': 'Dai', '莫': 'Mo', '孔': 'Kong', '向': 'Xiang', '湯': 'Tang',
    '勇': 'Yong', '猛': 'Meng', '義': 'Yi', '忠': 'Zhong', '安': 'An', '平': 'Ping', '飛': 'Fei', '虎': 'Hu', '豹': 'Bao', '雲': 'Yun',
    '山': 'Shan', '德': 'De', '仁': 'Ren', '明': 'Ming', '剛': 'Gang', '強': 'Qiang', '興': 'Xing', '遠': 'Yuan', '英': 'Ying', '傑': 'Jie',
    '雄': 'Xiong', '威': 'Wei', '烈': 'Lie', '鋒': 'Feng', '岳': 'Yue', '峰': 'Feng', '濤': 'Tao', '浩': 'Hao', '然': 'Ran', '振': 'Zhen',
    '邦': 'Bang', '國': 'Guo', '華': 'Hua', '文': 'Wen', '成': 'Cheng', '昭': 'Zhao', '弘': 'Hong', '毅': 'Yi', '超': 'Chao', '群': 'Qun',
    '霸': 'Ba', '奎': 'Kui', '彪': 'Biao', '虔': 'Qian', '典': 'Dian', '俊': 'Jun', '朗': 'Lang'
  };
  S.romanize = function (name) {
    if (S.lang !== 'en' || !name) return name;
    var chars = String(name).split('');
    if (!chars.every(function (c) { return PINYIN[c]; })) return S.t(name);   // 不是隨機產生的名字 (傳說士兵等)：查字典
    var given = chars.slice(1).map(function (c, i) { return i ? PINYIN[c].toLowerCase() : PINYIN[c]; }).join('');
    return PINYIN[chars[0]] + (given ? ' ' + given : '');
  };

  // ---- 頁面上的固定文字 (index.html)：英文模式時逐段替換 ----
  function norm(s) { return s.replace(/\s+/g, ' ').trim(); }
  function translatePage() {
    var D = {};
    Object.keys(S.EN).forEach(function (k) { D[norm(k)] = S.EN[k]; });
    var help = document.querySelector('.help');
    if (help && S.EN_HELP) help.innerHTML = S.EN_HELP;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null), node, list = [];
    while ((node = walker.nextNode())) list.push(node);
    list.forEach(function (n) {
      var p = n.parentNode && n.parentNode.nodeName;
      if (p === 'SCRIPT' || p === 'STYLE') return;
      var key = norm(n.nodeValue);
      if (key && D[key] != null) n.nodeValue = n.nodeValue.replace(n.nodeValue.trim(), D[key]);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[title],[placeholder],[aria-label]'), function (el) {
      ['title', 'placeholder', 'aria-label'].forEach(function (a) {
        var v = el.getAttribute(a);
        if (v && D[norm(v)] != null) el.setAttribute(a, D[norm(v)]);
      });
    });
    if (D[norm(document.title)]) document.title = D[norm(document.title)];
    document.documentElement.lang = 'en';
  }

  // ---- 切換按鈕 (右上角) ----
  function addButton() {
    var b = document.createElement('button');
    b.id = 'btn-lang';
    b.className = 'lang-btn';
    b.textContent = S.lang === 'en' ? '中文' : 'EN';
    b.title = S.lang === 'en' ? '切換成中文' : 'Switch to English';
    b.addEventListener('click', function () {
      var field = document.getElementById('field'), camp = document.getElementById('camp'), result = document.getElementById('result');
      var inBattle = field && !field.hidden && camp && camp.hidden && result && result.hidden;
      if (inBattle && !window.confirm(S.lang === 'en' ? 'Switching language reloads the page. The current battle will be lost. Continue?'
                                                       : '切換語言會重新載入頁面，目前這場戰鬥會中斷。確定嗎？')) return;
      S.setLang(S.lang === 'en' ? 'zh' : 'en');
    });
    document.body.appendChild(b);
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', function () {
      if (S.lang === 'en') translatePage();
      addButton();
    });
  }
})(window.Sango);
