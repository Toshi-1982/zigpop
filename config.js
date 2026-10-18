// 設定の1か所（仕様書8.1・8.2）。名前・URL・#1の日付・生成の版・モードの数値はここだけで変える。
// ブラウザでは window.PonConfig、Node.js（テスト）では require('./config.js') で読む。
(function (root) {
  'use strict';

  var CONFIG = {
    // ゲーム名（決定 2026-10-17）。変えたら manifest.webmanifest と index.html の
    // <title>・apple-mobile-web-app-title も同じ日本語名にする（テストで一致を確かめる）
    APP_NAME: { ja: 'ジグポン', en: 'ZigPop' },

    // シェア文の最後に付けるURL（空なら行ごと出さない）。決定 2026-10-18：GitHub Pages でテスト公開
    SHARE_URL: 'https://toshi-1982.github.io/zigpop/',

    // 今日の盤の通し番号 #1 の日付（仮置き：テスト中は 2026-11-01。公開日に変える）
    DAY1: '2026-11-01',

    // 生成の版の切り替え日（仕様書4.8）。その日付の盤は、その日に使っていた版で作る。
    // 段階1の公開前は表を足さずに ver を直接変えてよい。
    VERSIONS: [
      { from: '2000-01-01', ver: 'pon-v1' }
    ],

    MAX_K: 100,     // 種ずらしの上限（k = 0〜99）
    MAX_BUILD: 200, // 1つの種の中で盤づくりを試す上限

    // 今日の3盤（Easy 1＋Normal 2）
    DAILY_MODES: ['easy', 'normal', 'normal'],

    // モードの数値（仕様書3.2・4.2・4.3）。確率は千分率・割合は百分率
    MODES: {
      easy: {
        key: 'easy', name: 'Easy', n: 5, taps: 3,
        stopPermille: 50,     // 止める確率 p＝5%
        noClearMaxTaps: 1,    // 条件1：この手数以下では完全クリアできない（Easy は1回だけ不可）
        clearPermille: 10,    // 条件2：適当に押して完全クリアになる確率 1%以下
        avgPct: 65,           // 条件3：適当に押したときの消える枚数の期待値 65%以下
        bigPct: 50            // 条件4：1手目で盤の50%以上消える手がある
      },
      normal: {
        key: 'normal', name: 'Normal', n: 6, taps: 3,
        stopPermille: 50,
        noClearMaxTaps: 2,
        clearPermille: 10,
        avgPct: 60,
        bigPct: 50
      },
      // 段階2：7×7の枠に盤の形（7種×向き8）、特別タイル4種から毎盤2種（仕様書3.3・3.4）
      hard: {
        key: 'hard', name: 'Hard', n: 7, taps: 3,
        stopPermille: 50,
        noClearMaxTaps: 2,
        clearPermille: 5,     // 0.5%以下
        avgPct: 55,
        bigPct: 40,
        maxK: 200,            // 種ずらしの上限（Hard だけ200）
        shapes: true,
        staged: true,         // 条件を 4→1→2・3 の順に調べる（仕様書4.5）
        specials: { cross: [1, 2], wall: [2, 4], double: [2, 3], rotor: [1, 2] } // 枚数の範囲
      },
      // 段階3：6×6・2回、1手ごとに残りの矢印が全部時計回りに90度（仕様書3.5）
      // 決定（2026-10-18）：試しの案 C＝2回のまま、品質条件に「当たりの1手目が2か所以上」を足す
      pro: {
        key: 'pro', name: 'Professional', n: 6, taps: 2,
        stopPermille: 50,
        noClearMaxTaps: 1,
        clearPermille: 10,
        avgPct: 55,
        bigPct: 50,
        minStarts: 2,         // 条件5：当たりの1手目が2か所以上（案 C）
        maxK: 200,            // 1つの種あたりの合格率が約9%と低いので、種ずらしの上限を Hard と同じ200に
        rotateEach: true
      }
    },
    // タイトルに並べるモード
    FREE_MODES: ['easy', 'normal', 'hard', 'pro'],

    // Professional の難しさの試し（テスト用）。2026-10-18 に案 C に決まったので false。
    // true にするとタイトルに「試し：A／B／C」の切り替えが出る。false なら切り替えは出ず、MODES.pro（＝案 C）を使う
    PRO_TRIAL: false,
    PRO_VARIANTS: {} // 下で作る
  };

  // 試しの案（PRO_TRIAL が true のときだけ使う）。もとは MODES.pro（案 C）
  // 案 A：2回・当たりの1手目の条件なし（上限100）
  // 案 B：3回。条件は Normal と同じ考え方で「2回以下では不可・完全クリアの確率1%以下」、期待値55%以下・1手目50%以上。安い順に調べる
  // 案 C：MODES.pro と同じ条件
  (function () {
    var base = CONFIG.MODES.pro;
    function copy(extra) {
      var o = {};
      Object.keys(base).forEach(function (k) { o[k] = base[k]; });
      Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
      return o;
    }
    CONFIG.PRO_VARIANTS.A = copy({ variant: 'A', minStarts: 0, maxK: 100 });
    CONFIG.PRO_VARIANTS.B = copy({ variant: 'B', taps: 3, noClearMaxTaps: 2, staged: true, minStarts: 0, maxK: 100 });
    CONFIG.PRO_VARIANTS.C = copy({ variant: 'C' });
  })();

  if (typeof module === 'object' && module.exports) module.exports = CONFIG;
  else root.PonConfig = CONFIG;
})(this);
