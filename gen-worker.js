// 裏で盤を作る Web Worker（仕様書4.6の3）。画面を止めずに Hard の盤を作る。
// 受け取る：{ id, type: 'free', mode, seed, variant, pair（Hard の組み合わせ 0〜5） } ／ { id, type: 'dailyHard', date } ／ { id, type: 'dailyPro', date, variant }
// 返す：{ id, board }（logic.js の packBoard の形。作れなければ board: null）
/* global importScripts, PonLogic */
importScripts('config.js', 'logic.js');

self.onmessage = function (e) {
  var m = e.data || {};
  var board = null;
  try {
    // Pro の試し：画面で選んでいる案に合わせる（Worker は config.js を別に読むので毎回そろえる）
    PonLogic.setProVariant(typeof m.variant === 'string' ? m.variant : null);
    if (m.type === 'dailyPro' && PonLogic.isDateStr(m.date)) {
      board = PonLogic.dailyPro(m.date);
    } else if (m.type === 'free' && typeof m.mode === 'string' && typeof m.seed === 'string') {
      board = PonLogic.freeBoard(m.mode, m.seed, typeof m.pair === 'number' ? m.pair : undefined);
    } else if (m.type === 'dailyHard' && PonLogic.isDateStr(m.date)) {
      board = PonLogic.dailyHard(m.date, null);
    }
  } catch (err) {
    board = null;
  }
  self.postMessage({ id: m.id, board: board ? PonLogic.packBoard(board) : null });
};
