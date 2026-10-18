// 文字の辞書（仕様書7.1）。画面の文字はすべてここに置き、t('key', {n: 3}) で引く。
// ブラウザでは window.PonI18n、Node.js（テスト）では require('./i18n.js') で読む。
(function (root) {
  'use strict';

  var STR = {
    ja: {
      langBtn: 'EN',
      langBtnLabel: 'English に切り替え',
      tagline: '1タップで、連鎖が盤を走る',
      daily: '今日の3盤',
      dailySub: '{tag} · {date} · Easy＋Normal×2',
      dailySubNoNum: '{date} · Easy＋Normal×2',
      resume: '続きから {n}',
      doneLine: '済み {list}',
      streakBadge: '🔥{n}',
      fullClearCount: '完全クリア {a}/{b}',
      sizeTaps: '{n}×{n}・{t}回',
      bestChainVal: '最大連鎖 {n}',
      none: '—',
      howTo: '遊び方',
      noSound: '音は出ません',
      making: '盤を作っています…',
      makeFailed: '盤を作れませんでした。もう一度お試しください。',
      back: '‹ タイトル',
      backLabel: 'タイトルへ戻る',
      dailyLabel: '{c} {mode}',
      freeLabel: '{mode} {n}×{n}',
      taps: '手数',
      cleared: '消した',
      maxChain: '最大連鎖',
      clearStarts: '当たりの​1手目', // ​：狭い枠ではここで改行する（見た目は「当たりの1手目」）
      startsVal: '{n}か所',
      hintStart: 'どこから押す？（{n}回まで）',
      chaining: '連鎖中…',
      leftTaps: 'あと{n}回',
      stillClear: 'まだ全部消せる',
      noClear: 'もう全部は消せない（最高 {n}）',
      hintSep: '・',
      fullClear: '完全クリア✨',
      close: 'おしい！',
      over: 'ここまで',
      resultLine: '消した {a}/{b}・最大連鎖 {c}',
      nextDaily: '次の盤へ {c}',
      seeDaily: '今日の結果を見る',
      nextBoard: 'つぎの盤',
      retry: '同じ盤をもう一度',
      finalTitle: '今日の3盤 {tag}',
      finalLine: '{c} {mode} {a}/{b}{full} {chainLabel} {chain}',
      fullMark: ' 完全クリア✨',
      streak: '🔥 {n}日連続',
      day1: '1日目',
      shareStreak: '🔥{n}日連続',
      copy: 'コピー',
      share: '共有',
      copied: 'コピーしました',
      copyFailed: '上の文を長押し（右クリック）でコピーしてください',
      toTitle: 'タイトルへ',
      unsaved: 'この環境では記録を保存できません',
      helpTitle: '遊び方',
      help1: 'タイルを押すと弾けて、矢印の向きへ玉が飛ぶ',
      help2: '玉が当たったタイルも弾けて、また矢印の向きへ。空いたマスは通り抜ける',
      help3: '盤の外に出たら、その連鎖は終わり',
      help4: '決められた回数（Easy・Normal・Hard は3回、Professional は2回）までに全部消せたら「完全クリア」。どの盤も全部消せる手順がある',
      help5: '「当たりの1手目」は、1手目に押すと全部消せる道があるタイルの数（場所は出ません）',
      closeHelp: '閉じる',
      boardLabel: '盤。タイルを押すと連鎖が始まる',
      // 段階2・3
      dailyHard: '今日の Hard',
      dailyPro: '今日の Professional',
      resumeOne: '続きから',
      doneOne: '済み {r}',
      dailyOneLabel: '今日の {mode}',
      finalTitleOne: '今日の {mode} {tag}',
      finalLineOne: '{mode} {a}/{b}{full} {chainLabel} {chain}',
      rotateAll: '↻ 1手ごとに全部回る',
      cross: '十字',
      wall: '壁',
      double: '2枚重ね',
      rotor: '回転',
      specialSep: '・',
      helpHardTitle: 'Hard の特別タイル',
      helpCross: '十字：消えて、上下左右の4方向へ同時に撃つ',
      helpWall: '壁：消えない。玉はそこで止まる（押せない）',
      helpDouble: '2枚重ね：上の1枚だけ消えて撃つ。下の1枚（右下の小さな矢印）が残る',
      helpRotor: '回転：当たると消えずに時計回りに90度回り、玉は止まる。押すと今の向きへ撃って消える',
      helpPro: 'Professional：連鎖が終わるたびに、残りの矢印が全部時計回りに90度回る',
      // Pro の試し（テスト用。config.js の PRO_TRIAL が true のときだけ出す）
      proTrial: 'Professional の試し：',
      proTrialNote: 'A＝2回／B＝3回／C＝2回・当たりの1手目2か所以上。試し中は Professional の記録・連続日数を残しません',
      trialName: '{mode}（試し{v}）'
    },
    en: {
      langBtn: '日本語',
      langBtnLabel: 'Switch to Japanese',
      tagline: 'One tap. Watch the chain run.',
      daily: 'Daily 3',
      dailySub: '{tag} · {date} · Easy+Normal×2',
      dailySubNoNum: '{date} · Easy+Normal×2',
      resume: 'Resume {n}',
      doneLine: 'Done {list}',
      streakBadge: '🔥{n}',
      fullClearCount: 'Full clear {a}/{b}',
      sizeTaps: '{n}×{n} · {t} taps',
      bestChainVal: 'Best chain {n}',
      none: '—',
      howTo: 'How to play',
      noSound: 'No sound',
      making: 'Building boards…',
      makeFailed: 'Could not build the board. Please try again.',
      back: '‹ Title',
      backLabel: 'Back to title',
      dailyLabel: '{c} {mode}',
      freeLabel: '{mode} {n}×{n}',
      taps: 'Taps',
      cleared: 'Cleared',
      maxChain: 'Best chain',
      clearStarts: 'Starts',
      startsVal: '{n}',
      hintStart: 'Where to start? ({n} taps)',
      chaining: 'Chaining…',
      leftTaps: '{n} left',
      stillClear: 'Full clear still possible',
      noClear: 'Full clear no longer possible (max {n})',
      hintSep: ' · ',
      fullClear: 'Full clear✨',
      close: 'So close!',
      over: 'Done',
      resultLine: 'Cleared {a}/{b} · Best chain {c}',
      nextDaily: 'Next board {c}',
      seeDaily: 'See today\'s result',
      nextBoard: 'Next board',
      retry: 'Try this board again',
      finalTitle: 'Daily 3 {tag}',
      finalLine: '{c} {mode} {a}/{b}{full} {chainLabel} {chain}',
      fullMark: ' Full clear✨',
      streak: '🔥 {n}-day streak',
      day1: 'Day 1',
      shareStreak: '🔥{n}-day streak',
      copy: 'Copy',
      share: 'Share',
      copied: 'Copied',
      copyFailed: 'Long-press (or right-click) the text above to copy',
      toTitle: 'Back to title',
      unsaved: 'Records cannot be saved in this browser',
      helpTitle: 'How to play',
      help1: 'Tap a tile: it pops and shoots a ball in its arrow direction',
      help2: 'A tile hit by the ball pops too and shoots on. Empty cells let the ball pass',
      help3: 'When the ball leaves the board, the chain ends',
      help4: 'Clear every tile within the set taps (3 in Easy, Normal and Hard; 2 in Professional) for a Full clear. Every board can be fully cleared',
      help5: '"Starts" is how many first taps can still lead to a full clear (where is not shown)',
      closeHelp: 'Close',
      boardLabel: 'Board. Tap a tile to start a chain',
      dailyHard: 'Daily Hard',
      dailyPro: 'Daily Professional',
      resumeOne: 'Resume',
      doneOne: 'Done {r}',
      dailyOneLabel: 'Daily {mode}',
      finalTitleOne: 'Daily {mode} {tag}',
      finalLineOne: '{mode} {a}/{b}{full} {chainLabel} {chain}',
      rotateAll: '↻ All arrows turn after each tap',
      cross: 'Cross',
      wall: 'Wall',
      double: 'Double',
      rotor: 'Turner',
      specialSep: ' · ',
      helpHardTitle: 'Hard: special tiles',
      helpCross: 'Cross: pops and shoots in all 4 directions at once',
      helpWall: 'Wall: never pops. A ball stops there (cannot be tapped)',
      helpDouble: 'Double: only the top layer pops and shoots. The bottom one (small arrow) stays',
      helpRotor: 'Turner: when hit, it turns 90° clockwise and stops the ball. Tap it to shoot its current way',
      helpPro: 'Professional: after each chain, all remaining arrows turn 90° clockwise',
      proTrial: 'Professional trial:',
      proTrialNote: 'A = 2 taps / B = 3 taps / C = 2 taps, 2+ starts. Professional records and streaks are not kept during the trial',
      trialName: '{mode} (trial {v})'
    }
  };

  // 端末の言語から初期値を決める（ja で始まれば日本語、それ以外は英語）
  function detectLang(nav) {
    var l = (nav && nav.languages && nav.languages[0]) || (nav && nav.language) || '';
    return /^ja/i.test(l) ? 'ja' : 'en';
  }

  function format(s, params) {
    if (!params) return s;
    return s.replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m;
    });
  }

  function translate(lang, key, params) {
    var table = STR[lang] || STR.ja;
    var s = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;
    return format(s, params);
  }

  var CIRCLED = ['①', '②', '③'];

  // シェア文（仕様書7.3）。入れるのはゲーム名・#番号・各盤の「消した/全部」と✨・最大連鎖・連続日数・URL だけ。
  // 押した場所・盤の絵・当たりの1手目の数・手順は受け取らないので漏れない。
  // dayTag: '#12'（#1 以上の日）または '10/17'（DAY1 より前の日）。logic.js の dayTag で作る
  // boards: [{ removed, total, full, maxChain }]
  function shareText(lang, appName, dayTag, boards, streak, url) {
    var parts = boards.map(function (b, i) {
      return CIRCLED[i] + ' ' + b.removed + '/' + b.total + (b.full ? '✨' : '');
    });
    var maxChain = boards.reduce(function (m, b) { return Math.max(m, b.maxChain); }, 0);
    var lines = [
      appName + ' ' + dayTag + ' 💥 ' + parts.join(' '),
      translate(lang, 'maxChain') + ' ' + maxChain + (streak >= 2 ? ' ' + translate(lang, 'shareStreak', { n: streak }) : '')
    ];
    if (url) lines.push(url);
    return lines.join('\n');
  }

  // 今日の Hard／今日の Professional のシェア文（仕様書7.3）：「ジグポン #12 Hard 💥 41/41✨ 最大連鎖 19」
  // board: { removed, total, full, maxChain }。押した場所・盤の絵・当たりの1手目は受け取らない
  function shareTextOne(lang, appName, dayTag, modeName, board, streak, url) {
    var line = appName + ' ' + dayTag + ' ' + modeName + ' 💥 ' + board.removed + '/' + board.total + (board.full ? '✨' : '') +
      ' ' + translate(lang, 'maxChain') + ' ' + board.maxChain +
      (streak >= 2 ? ' ' + translate(lang, 'shareStreak', { n: streak }) : '');
    return url ? line + '\n' + url : line;
  }

  var I18N = { STR: STR, CIRCLED: CIRCLED, detectLang: detectLang, format: format, translate: translate, shareText: shareText, shareTextOne: shareTextOne };
  if (typeof module === 'object' && module.exports) module.exports = I18N;
  else root.PonI18n = I18N;
})(this);
