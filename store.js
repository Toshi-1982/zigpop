// 保存の読み書きと検査（仕様書8.3）。localStorage だけ使い、外には送らない。
// ブラウザでは window.PonStore、Node.js（テスト）では require('./store.js') で読む。
(function (root) {
  'use strict';
  var isNode = (typeof module === 'object' && module.exports);
  var C = isNode ? require('./config.js') : root.PonConfig;
  var L = isNode ? require('./logic.js') : root.PonLogic;

  var KEY = 'pon.v1';
  var CACHE_KEY = 'pon.cache.v1';
  var MAX_NUM = 99999999;
  var MODE_KEYS = ['easy', 'normal', 'hard', 'pro'];
  var DAILY_KEYS = ['main', 'hard', 'pro'];

  function isNum(v) { return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_NUM; }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function defaultDaily() {
    return { date: null, ver: null, boards: [], done: false, streak: 0, lastDoneDate: null, bestStreak: 0 };
  }
  function defaultData() {
    var modes = {};
    MODE_KEYS.forEach(function (m) { modes[m] = { played: 0, cleared: 0, bestChain: 0 }; });
    return {
      lang: null, // null＝まだ選んでいない（端末の言語を使う）
      seenHelp: false,
      proTrial: 'A', // Pro の試しで選んでいる案（PRO_TRIAL が true のときだけ使う）
      freeHardPair: null, // 自由練習の Hard で最後に始めた盤の組み合わせ（0〜5）。開き直しても順番が続くように
      modes: modes,
      daily: { main: defaultDaily(), hard: defaultDaily(), pro: defaultDaily() }
    };
  }

  // 今日の盤 i 番目のマス数・手数・枚数（Hard の枚数は盤の形と特別タイルで変わるので 1〜上限で検査）
  function boardShape(dailyKey, i) {
    var cfg = C.MODES[dailyKey === 'main' ? C.DAILY_MODES[i] : dailyKey];
    var size = cfg.n * cfg.n;
    if (dailyKey === 'hard') return { size: size, taps: cfg.taps, totalMax: size + 3 }; // 2枚重ねは最大3枚
    if (dailyKey === 'pro') return { size: size, taps: proTaps(Math.max), total: size, minTaps: proTaps(Math.min) }; // 試しの案 B は3回
    return { size: size, taps: cfg.taps, total: size };
  }
  // Pro の試しの案すべての手数の最大（pick＝Math.max）／最小（Math.min）
  // PRO_TRIAL が false（本番）なら試しの案は使わないので、MODES.pro の手数だけ
  function proTaps(pick) {
    var m = C.MODES.pro.taps, all = C.PRO_TRIAL ? (C.PRO_VARIANTS || {}) : {};
    Object.keys(all).forEach(function (k) { m = pick(m, all[k].taps); });
    return m;
  }
  function maxBoards(dailyKey) { return dailyKey === 'main' ? C.DAILY_MODES.length : 1; }

  // 1盤の記録を項目ごとに検査する。fix(…) で直した数を数える
  function sanitizeBoard(raw, shape, fix) {
    var b = { taps: [], removed: 0, total: shape.total || shape.size, full: false, maxChain: 0, done: false };
    if (!isObj(raw)) { fix(); return b; }
    var tapsOk = Array.isArray(raw.taps) && raw.taps.length <= shape.taps &&
      raw.taps.every(function (t) { return Number.isInteger(t) && t >= 0 && t < shape.size; });
    if (tapsOk) b.taps = raw.taps.slice(); else fix();
    var totalOk = shape.total ? raw.total === shape.total : (Number.isInteger(raw.total) && raw.total >= 1 && raw.total <= shape.totalMax);
    if (totalOk) b.total = raw.total; else fix();
    if (isNum(raw.removed) && raw.removed <= b.total) b.removed = raw.removed; else fix();
    if (typeof raw.full === 'boolean') b.full = raw.full; else fix();
    if (b.full !== (b.removed === b.total)) { b.full = (b.removed === b.total); fix(); }
    if (isNum(raw.maxChain) && raw.maxChain <= b.total) b.maxChain = raw.maxChain; else fix();
    if (typeof raw.done === 'boolean') b.done = raw.done; else fix();
    // まだ押していない盤は、消した数・最大連鎖・完全クリアも 0／false（1回押せば必ず1枚以上消える）
    if (b.taps.length === 0 && (b.removed !== 0 || b.maxChain !== 0 || b.full)) {
      b.removed = 0; b.maxChain = 0; b.full = false; fix();
    }
    if (b.taps.length > 0 && (b.removed < b.taps.length || b.maxChain < 1 || b.maxChain > b.removed)) {
      b.removed = Math.max(b.removed, b.taps.length); b.maxChain = Math.min(Math.max(1, b.maxChain), b.removed);
      b.full = b.removed === b.total; fix();
    }
    var shouldDone = b.full || b.taps.length === shape.taps; // 手数を使い切った／全部消えた
    // Pro の試し（2回の案）では手数を使い切っても taps が上限(3)より少ない。済みかどうかは盤がある数え直しで決める
    if (shape.minTaps && b.done && !shouldDone && b.taps.length >= shape.minTaps) shouldDone = true;
    if (b.done !== shouldDone) { b.done = shouldDone; fix(); }
    return b;
  }

  function sanitizeDaily(raw, dailyKey, fix) {
    var d = defaultDaily();
    if (!isObj(raw)) { fix(); return d; }
    if (raw.date === null || L.isDateStr(raw.date)) d.date = raw.date; else fix();
    if (raw.ver === null || (typeof raw.ver === 'string' && /^[\w.-]{1,32}$/.test(raw.ver))) d.ver = raw.ver; else fix();
    var max = maxBoards(dailyKey);
    if (Array.isArray(raw.boards)) {
      // 盤は①から順に並ぶ。数が多すぎるときは後ろを捨てる
      if (raw.boards.length > max) fix();
      for (var i = 0; i < Math.min(raw.boards.length, max); i++) {
        d.boards.push(sanitizeBoard(raw.boards[i], boardShape(dailyKey, i), fix));
      }
    } else fix();
    if (typeof raw.done === 'boolean') d.done = raw.done; else fix();
    var allDone = d.boards.length === max && d.boards.every(function (b) { return b.done; });
    if (d.done !== allDone) { d.done = allDone; fix(); }
    if (isNum(raw.streak)) d.streak = raw.streak; else fix();
    if (raw.lastDoneDate === null || L.isDateStr(raw.lastDoneDate)) d.lastDoneDate = raw.lastDoneDate; else fix();
    if (isNum(raw.bestStreak)) d.bestStreak = raw.bestStreak; else fix();
    if (d.bestStreak < d.streak) { d.bestStreak = d.streak; fix(); }
    return d;
  }

  // 読み込んだデータを検査し、おかしい項目だけ初期値に戻す。{ data, fixed（直した項目の数） }
  function sanitize(raw) {
    var fixed = 0;
    function fix() { fixed++; }
    var data = defaultData();
    if (!isObj(raw)) return { data: data, fixed: 1 };
    if (raw.lang === null || raw.lang === 'ja' || raw.lang === 'en') data.lang = raw.lang; else fix();
    if (typeof raw.seenHelp === 'boolean') data.seenHelp = raw.seenHelp; else fix();
    // Pro の試し（config.js の PRO_TRIAL）で選んだ案。前の版の保存データには無いので、無ければ黙って 'A'
    if (raw.proTrial === 'A' || raw.proTrial === 'B' || raw.proTrial === 'C') data.proTrial = raw.proTrial;
    else if (raw.proTrial !== undefined) fix();
    // 前の版の保存データには無いので、無ければ黙って null（played÷6 から始める）
    if (raw.freeHardPair === null || (Number.isInteger(raw.freeHardPair) && raw.freeHardPair >= 0 && raw.freeHardPair <= 5)) data.freeHardPair = raw.freeHardPair;
    else if (raw.freeHardPair !== undefined) fix();
    var modes = isObj(raw.modes) ? raw.modes : (fix(), {});
    MODE_KEYS.forEach(function (m) {
      var src = modes[m];
      if (!isObj(src)) { fix(); return; }
      ['played', 'cleared', 'bestChain'].forEach(function (f) {
        if (isNum(src[f])) data.modes[m][f] = src[f]; else fix();
      });
      if (data.modes[m].cleared > data.modes[m].played) { data.modes[m].cleared = data.modes[m].played; fix(); }
    });
    var daily = isObj(raw.daily) ? raw.daily : (fix(), {});
    DAILY_KEYS.forEach(function (k) { data.daily[k] = sanitizeDaily(daily[k], k, fix); });
    return { data: data, fixed: fixed };
  }

  // ---------- 連続日数（仕様書8.3） ----------
  // 3盤を終えた瞬間：前回が昨日なら +1、今日なら変えない、それ以外は 1
  function markDailyDone(d, date) {
    if (d.lastDoneDate === L.addDays(date, -1)) d.streak += 1;
    else if (d.lastDoneDate !== date) d.streak = 1;
    d.lastDoneDate = date;
    if (d.streak > d.bestStreak) d.bestStreak = d.streak;
  }
  // 表示用：前回が今日でも昨日でもなければ 0（保存値はそのまま）
  function shownStreak(d, today) {
    if (d.lastDoneDate === today || d.lastDoneDate === L.addDays(today, -1)) return d.streak;
    return 0;
  }
  // 保存してある今日の盤が、今日・今の版と違えば新しい日にする（連続日数は残す）
  function ensureDay(d, today, ver) {
    if (d.date === today && d.ver === ver) return false;
    d.date = today; d.ver = ver; d.boards = []; d.done = false;
    return true;
  }

  // 盤の一覧（作り置き）を使い、保存した手順を最初から再現して記録を数え直す。
  // 消した数・最大連鎖・完全クリア・終わったか・3盤とも済みか を手順から決め直す。変わったら true
  // dailyKey：'main'（今日の3盤。省略時）・'hard'・'pro'（盤は1つ）
  function recountDaily(d, list, dailyKey) {
    var before = JSON.stringify([d.boards, d.done]);
    var max = maxBoards(dailyKey || 'main');
    for (var i = 0; i < d.boards.length && i < list.length; i++) {
      var b = d.boards[i], board = list[i], cfg = C.MODES[board.mode];
      var r = L.replayBoard(board, b.taps);
      b.taps = r.taps;
      b.total = r.total;
      b.removed = r.removed;
      b.maxChain = r.maxChain;
      b.full = r.removed === b.total;
      b.done = b.full || b.taps.length >= cfg.taps;
    }
    // 終わっていない盤より後ろの盤は捨てる（盤は①から順に遊ぶ）
    for (var j = 0; j < d.boards.length; j++) {
      if (!d.boards[j].done) { d.boards.length = j + 1; break; }
    }
    d.done = d.boards.length === max && d.boards.every(function (x) { return x.done; });
    return JSON.stringify([d.boards, d.done]) !== before;
  }

  // ---------- 今日の盤の作り置き（pon.cache.v1） ----------
  function packBoards(date, ver, list) {
    return {
      date: date, ver: ver,
      main: list.map(function (b) {
        return { mode: b.mode, k: b.k, kind: b.kind, dirs: Array.from(b.dirs).join(''), solution: b.solution.slice(), starts: b.ev.starts, passed: b.passed };
      })
    };
  }
  // 作り置きを検査して盤の一覧に戻す。日付・版が違う・壊れているときは null（作り直す）
  function unpackBoards(raw, date, ver) {
    if (!isObj(raw) || raw.date !== date || raw.ver !== ver || !Array.isArray(raw.main) ||
      raw.main.length !== C.DAILY_MODES.length) return null;
    var list = [];
    for (var i = 0; i < raw.main.length; i++) {
      var e = raw.main[i], mode = C.DAILY_MODES[i], cfg = C.MODES[mode], size = cfg.n * cfg.n;
      if (!isObj(e) || e.mode !== mode || !isNum(e.k) || e.k >= C.MAX_K || e.kind !== 'std') return null;
      if (typeof e.dirs !== 'string' || e.dirs.length !== size || !/^[0-3]+$/.test(e.dirs)) return null;
      if (!Array.isArray(e.solution) || e.solution.length !== cfg.taps ||
        !e.solution.every(function (t) { return Number.isInteger(t) && t >= 0 && t < size; })) return null;
      if (!isNum(e.starts) || e.starts > size || typeof e.passed !== 'boolean') return null;
      var dirs = new Int8Array(size);
      for (var j = 0; j < size; j++) dirs[j] = e.dirs.charCodeAt(j) - 48;
      var b = { mode: mode, k: e.k, kind: e.kind, n: cfg.n, dirs: dirs, solution: e.solution.slice(), ev: { starts: e.starts, total: size }, passed: e.passed };
      if (!L.checkSolution(b)) return null;
      list.push(b);
    }
    return list;
  }

  // ---------- 読み書き ----------
  // getStorage は localStorage を返す関数（テストでは偽物を渡す）。例外が出たらメモリ上だけで遊ぶ
  function createStore(getStorage) {
    var st = { data: defaultData(), persistent: true, fixed: 0 };
    function storage() { return getStorage(); }

    st.load = function () {
      var text = null;
      try { text = storage().getItem(KEY); } catch (e) { st.persistent = false; return st.data; }
      if (text === null) return st.data;
      var raw;
      try { raw = JSON.parse(text); } catch (e) { raw = undefined; }
      var r = sanitize(raw);
      st.data = r.data;
      st.fixed = r.fixed;
      if (r.fixed) st.save();
      return st.data;
    };
    st.save = function () {
      if (!st.persistent) return false;
      try { storage().setItem(KEY, JSON.stringify(st.data)); return true; } catch (e) { st.persistent = false; return false; }
    };
    st.loadCache = function (date, ver) {
      try {
        var text = storage().getItem(CACHE_KEY);
        return text === null ? null : unpackBoards(JSON.parse(text), date, ver);
      } catch (e) { return null; }
    };
    // 作り置きは { date, ver, main: [...], hard: 盤, pro: 盤 }。同じ日付・版なら他の盤を残して書き足す
    function readCache(date, ver) {
      try {
        var text = storage().getItem(CACHE_KEY);
        var raw = text === null ? null : JSON.parse(text);
        if (isObj(raw) && raw.date === date && raw.ver === ver) return raw;
      } catch (e) { /* 壊れていれば作り直す */ }
      return { date: date, ver: ver };
    }
    function writeCache(raw) {
      try { storage().setItem(CACHE_KEY, JSON.stringify(raw)); } catch (e) { /* 作り置きは失っても困らない */ }
    }
    st.saveCache = function (date, ver, list) {
      var raw = readCache(date, ver);
      raw.main = packBoards(date, ver, list).main;
      writeCache(raw);
    };
    // 今日の Hard・今日の Professional の作り置き（key＝'hard'／'pro'）
    st.saveCacheOne = function (date, ver, key, board) {
      var raw = readCache(date, ver);
      raw[key] = L.packBoard(board);
      writeCache(raw);
    };
    st.loadCacheOne = function (date, ver, key) {
      var raw = readCache(date, ver);
      var b = isObj(raw[key]) ? L.unpackBoard(raw[key]) : null;
      if (!b) return null;
      // Hard の日に Normal の盤（作り方 normal）が出るのは、Hard の盤が作れなかったときだけ
      var okMode = key === 'hard' ? (b.mode === 'hard' || (b.mode === 'normal' && b.kind === 'normal')) : b.mode === key;
      return okMode ? b : null;
    };
    return st;
  }

  var S = {
    KEY: KEY, CACHE_KEY: CACHE_KEY,
    defaultData: defaultData, sanitize: sanitize, createStore: createStore,
    markDailyDone: markDailyDone, shownStreak: shownStreak, ensureDay: ensureDay, recountDaily: recountDaily,
    packBoards: packBoards, unpackBoards: unpackBoards
  };
  if (isNode) module.exports = S;
  else root.PonStore = S;
})(this);
