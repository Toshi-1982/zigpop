// 画面・操作・演出（仕様書6章）。盤の計算は logic.js、保存は store.js、文字は i18n.js。
(function () {
  'use strict';
  var C = window.PonConfig, L = window.PonLogic, I = window.PonI18n, S = window.PonStore;
  var CIRCLED = I.CIRCLED;
  var K = L.K;

  // 色（仕様書6.2）
  var COL = { board: '#FFFDF8', frame: '#D9D0C1', grid: '#ECE5D8', ink: '#2B2723', gray: '#8C8478', red: '#D9472B', tile: '#FFFFFF' };

  function $(id) { return document.getElementById(id); }
  function nowSec() { return performance.now() / 1000; }
  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  var isHttp = /^https?:$/.test(location.protocol);

  // 演出用の乱数（破片・紙片のゆらぎだけ。盤の生成には使わない）
  var fxRng = L.makeRng((Date.now() % 4294967296) >>> 0);
  function frand() { return fxRng.next() / 4294967296; }

  // ===== 保存と言語 =====
  var store = S.createStore(function () { return window.localStorage; });
  store.load();
  var lang = store.data.lang || I.detectLang(navigator);
  // Professional の試し A／B／C（config.js の PRO_TRIAL。false なら切り替えを出さず MODES.pro＝案 C）
  var trialOn = !!C.PRO_TRIAL;
  L.setProVariant(trialOn ? store.data.proTrial : null);
  function t(key, params) { return I.translate(lang, key, params); }

  // ===== 状態 =====
  var screen = 'title';
  // { kind:'daily', key:'main'|'hard'|'pro', date, list, index } または { kind:'free', mode, board }
  var session = null;
  var game = null;    // いま遊んでいる盤
  var freeCount = 0;
  var guideNext = false; // 初回の1盤目：盤の中央のタイルに朱の輪を脈打たせる
  var histPushed = false;

  var canvas = $('board');
  var ctx = canvas.getContext('2d');
  var view = { size: 300, pad: 8, cell: 50 };

  // ===== 同梱の表（daily-k.json・free-k.json）と Web Worker（仕様書4.6） =====
  // file:// で開いたときは読めないので、盤はその場で作る（「盤を作っています…」を出す）
  var tables = { daily: null, free: null };
  function fetchJson(url) {
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  var tablesReady = isHttp
    ? Promise.all([fetchJson('daily-k.json'), fetchJson('free-k.json')]).then(function (a) { tables.daily = a[0]; tables.free = a[1]; })
    : Promise.resolve();

  var worker = null, jobs = {}, jobId = 0;
  if (isHttp && window.Worker) {
    try {
      worker = new Worker('gen-worker.js');
      worker.onmessage = function (e) {
        var cb = jobs[e.data.id];
        delete jobs[e.data.id];
        if (cb) cb(e.data.board ? L.unpackBoard(e.data.board) : null);
      };
      // Worker が動かない（読み込めない・落ちる）：待っている処理には null を返し、待ち行列を空にして、以後は本体で作る
      worker.onerror = function () {
        worker = null;
        var pending = jobs; jobs = {};
        Object.keys(pending).forEach(function (k) { pending[k](null); });
        queue = [];
      };
    } catch (e) { worker = null; }
  }
  function genInWorker(msg, cb) {
    if (!worker) return false;
    msg.id = ++jobId;
    jobs[msg.id] = cb;
    worker.postMessage(msg);
    return true;
  }
  // 自由練習の Hard：組み合わせの順番と待ち行列の決まりは logic.js の純粋な関数（nextFreePair・planHardQueue・decideHardStart）。
  // 最後に始めた盤の組み合わせは pon.v1 の freeHardPair に保存（開き直しても順番が続く）。queue＝Worker に頼んだ「次の2盤」
  var queue = [];
  function lastHardPair() { return store.data.freeHardPair; }
  // 次の2盤を Worker で作っておく。いらなくなった組み合わせの箱・盤のない箱（Worker が null を返した）は外して頼み直す
  function prepareHard() {
    var plan = L.planHardQueue(queue, lastHardPair(), store.data.modes.hard.played, !!worker);
    queue = plan.keep;
    plan.request.forEach(function (p) {
      var q = { pair: p, board: null, pending: true, waiters: [] };
      freeCount++;
      var ok = genInWorker({ type: 'free', mode: 'hard', seed: Date.now() + '-' + freeCount, pair: p }, function (b) {
        q.pending = false;
        q.board = b; // null なら「盤のない箱」。次の decideHardStart・planHardQueue で外れる
        var w = q.waiters; q.waiters = [];
        w.forEach(function (f) { f(); });
      });
      if (ok) queue.push(q);
    });
  }

  // ===== 画面の切り替え =====
  function show(id) {
    screen = id;
    ['title', 'loading', 'game', 'final'].forEach(function (s) {
      $('screen-' + s).classList.toggle('active', s === id);
    });
    if (id !== 'title') pushHistory();
    window.scrollTo(0, 0);
  }

  function applyStaticText() {
    document.documentElement.lang = lang;
    document.title = C.APP_NAME[lang];
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    $('title-name').textContent = C.APP_NAME[lang];
    $('btn-lang').textContent = t('langBtn');
    $('btn-lang').setAttribute('aria-label', t('langBtnLabel'));
    $('btn-back').setAttribute('aria-label', t('backLabel'));
    canvas.setAttribute('aria-label', t('boardLabel'));
  }

  function todayStr() { return L.localDateStr(new Date()); }
  function shortDate(s) { var p = s.split('-'); return (+p[1]) + '/' + (+p[2]); }
  // 表示用のモード名（試し中の Professional は「Professional（試しB）」）
  function modeName(m) {
    if (m === 'pro' && trialOn) return t('trialName', { mode: C.MODES.pro.name, v: L.proVariant() });
    return C.MODES[m].name;
  }
  // 今日の盤を保存するときの版。試し中の Pro は案ごとに別の盤なので、案を変えると今日の Pro は新しくなる
  function dailyVer(key, date) {
    var v = L.versionFor(date);
    return (key === 'pro' && trialOn) ? v + '-trial' + L.proVariant() : v;
  }

  // ===== 画面1：タイトル =====
  function renderTitle() {
    var today = todayStr();
    var main = store.data.daily.main;
    if (S.ensureDay(main, today, L.versionFor(today))) store.save();

    recountDaily('main', today);
    // DAY1 より前（#0 以下）の日は # を出さず日付だけ
    $('daily-l2').textContent = L.dayNumber(today) >= 1
      ? t('dailySub', { tag: L.dayTag(today), date: shortDate(today) })
      : t('dailySubNoNum', { date: shortDate(today) });
    var l3 = $('daily-l3');
    if (main.done) {
      var list = main.boards.map(function (b, i) { return CIRCLED[i] + (b.full ? '✨' : b.removed + '/' + b.total); }).join(' ');
      l3.textContent = t('doneLine', { list: list }); l3.hidden = false;
    } else if (main.boards.length > 0) {
      l3.textContent = t('resume', { n: CIRCLED[currentDailyIndex(main)] }); l3.hidden = false;
    } else {
      l3.hidden = true;
    }
    var streak = S.shownStreak(main, today);
    $('daily-streak').hidden = streak < 2;
    $('daily-streak').textContent = t('streakBadge', { n: streak });

    ['hard', 'pro'].forEach(function (key) { renderDailyOne(key, today); });

    // Professional の試し A／B／C（PRO_TRIAL が true のときだけ）
    $('pro-trial').hidden = !trialOn;
    var tb = document.querySelectorAll('.trial-btn');
    for (var ti = 0; ti < tb.length; ti++) tb[ti].setAttribute('aria-pressed', String(tb[ti].getAttribute('data-trial') === L.proVariant()));
    $('daily-pro-l1').textContent = trialOn ? t('dailyPro') + ' ' + L.proVariant() : t('dailyPro');

    var box = $('mode-buttons');
    box.textContent = '';
    C.FREE_MODES.forEach(function (m) {
      var cfg = C.MODES[m], rec = store.data.modes[m];
      if (m === 'pro' && trialOn) rec = { played: 0, cleared: 0, bestChain: 0 }; // 試し中は試し前の記録を出さない
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn mode-btn';
      b.appendChild(row('mode-name', modeName(m), 'mode-rec', rec.played ? t('fullClearCount', { a: rec.cleared, b: rec.played }) : t('none')));
      b.appendChild(row('mode-sub', t('sizeTaps', { n: cfg.n, t: cfg.taps }), 'mode-sub', rec.played ? t('bestChainVal', { n: rec.bestChain }) : t('none')));
      b.addEventListener('click', function () { startFree(m, true); });
      box.appendChild(b);
    });
    prepareHard(); // タイトルを表示したら、自由練習の Hard の盤を裏で1つ作り始める
  }
  // 今日の Hard／今日の Professional のボタン（2行目：未プレイ＝盤の大きさ／途中＝続きから／済み＝結果）
  function renderDailyOne(key, today) {
    var d = store.data.daily[key];
    if (S.ensureDay(d, today, dailyVer(key, today))) store.save();
    recountDaily(key, today);
    var l2 = $('daily-' + key + '-l2');
    if (d.done && d.boards[0]) {
      var b = d.boards[0];
      l2.textContent = t('doneOne', { r: b.full ? '✨' : b.removed + '/' + b.total });
    } else if (d.boards.length > 0) {
      l2.textContent = t('resumeOne');
    } else {
      l2.textContent = t('sizeTaps', { n: C.MODES[key].n, t: C.MODES[key].taps });
    }
    var streak = (key === 'pro' && trialOn) ? 0 : S.shownStreak(d, today); // 試し中の Pro は連続日数を出さない
    $('daily-' + key + '-streak').hidden = streak < 2;
    $('daily-' + key + '-streak').textContent = t('streakBadge', { n: streak });
  }
  function row(c1, s1, c2, s2) {
    var d = document.createElement('span');
    d.className = 'mode-row';
    var a = document.createElement('span'); a.className = c1; a.textContent = s1;
    var b = document.createElement('span'); b.className = c2; b.textContent = s2;
    d.appendChild(a); d.appendChild(b);
    return d;
  }

  function goTitle() {
    if (histPushed) { history.back(); return; } // popstate でタイトルへ
    showTitle();
  }
  function showTitle() {
    game = null;
    session = null;
    closeHelp();
    renderTitle();
    show('title');
  }

  // ===== 戻る操作（仕様書6.1）：遊ぶ画面に入るとき1件積み、popstate でタイトルへ =====
  function pushHistory() {
    if (histPushed) return;
    history.pushState({ pon: 1 }, '');
    histPushed = true;
  }
  window.addEventListener('popstate', function () {
    histPushed = false;
    if (screen !== 'title') showTitle();
  });

  // ===== 今日の盤（今日の3盤・今日の Hard・今日の Professional） =====
  function currentDailyIndex(d) {
    for (var i = 0; i < d.boards.length; i++) if (!d.boards[i].done) return i;
    return d.boards.length;
  }
  function boardCount(key) { return key === 'main' ? C.DAILY_MODES.length : 1; }
  function loadCached(key, date) {
    var ver = L.versionFor(date);
    if (key === 'main') return store.loadCache(date, ver);
    var b = store.loadCacheOne(date, ver, key);
    return b ? [b] : null;
  }

  // 作り置きの盤があれば、保存した手順を再現して記録を数え直す（書き換えられた「済み」を信じない）
  function recountDaily(key, today) {
    var d = store.data.daily[key];
    if (d.date !== today) return;
    var list = loadCached(key, today);
    if (list && S.recountDaily(d, list, key)) store.save();
  }

  function startDaily(key) {
    var today = todayStr(), ver = L.versionFor(today);
    var d = store.data.daily[key];
    if (S.ensureDay(d, today, dailyVer(key, today))) store.save();
    recountDaily(key, today);
    if (d.done) { showFinal(key); return; }
    var cached = loadCached(key, today);
    if (cached) { beginDaily(key, today, cached); return; }
    show('loading');
    function done(list) {
      if (!list || list.some(function (b) { return !b; })) {
        if (screen === 'loading') { window.alert(t('makeFailed')); showTitle(); }
        return;
      }
      if (key === 'main') store.saveCache(today, ver, list); else store.saveCacheOne(today, ver, key, list[0]);
      if (screen === 'loading') beginDaily(key, today, list);
    }
    // 「作成中」を描いてから作る
    afterPaint(function () {
      if (key === 'main') { done(L.dailyBoards(today)); return; }
      if (key === 'pro') { // Worker があれば裏で作る（試しの案も渡す）。なければ本体で
        if (!genInWorker({ type: 'dailyPro', date: today, variant: L.proVariant() }, function (wb) { done([wb || L.dailyPro(today)]); })) done([L.dailyPro(today)]);
        return;
      }
      // 今日の Hard：表（daily-k.json）にあれば k と作り方で1回作るだけ。なければ Worker（なければ本体）で作る
      tablesReady.then(function () {
        if (screen !== 'loading') return;
        var e = tables.daily && tables.daily.ver === ver ? L.tableEntry(tables.daily, today) : null;
        var b = e ? L.boardFromEntry('hard', ver, 'dailyHard', today, 0, e) : null;
        if (b) { done([b]); return; }
        if (!genInWorker({ type: 'dailyHard', date: today }, function (wb) { done([wb || L.dailyHard(today, null)]); })) {
          afterPaint(function () { done([L.dailyHard(today, null)]); });
        }
      });
    });
  }
  // 「盤を作っています…」を1フレーム描いてから fn を呼ぶ（2回目の requestAnimationFrame は描いた後に来る）
  function afterPaint(fn) {
    requestAnimationFrame(function () { requestAnimationFrame(fn); });
  }

  function beginDaily(key, date, list) {
    var d = store.data.daily[key];
    session = { kind: 'daily', key: key, date: date, list: list, index: currentDailyIndex(d) };
    maybeFirstHelp();
    startDailyBoard(session.index);
  }

  function startDailyBoard(i) {
    session.index = i;
    var d = store.data.daily[session.key];
    var board = session.list[i];
    var rec = d.boards[i];
    var label = session.key === 'main'
      ? t('dailyLabel', { c: CIRCLED[i], mode: modeName(board.mode) })
      : t('dailyOneLabel', { mode: modeName(session.key) });
    startGame(board, label, rec ? rec.taps : []);
    if (!rec) return;
    // 記録は手順から再現した値に合わせる（再現できない手は捨てる）
    rec.taps = rec.taps.slice(0, game.taps);
    writeDailyRecord(rec, game);
    if (game.ended) showResult(); // 保存の上では途中でも、再現すると終わっていた盤
  }

  // 1回押すたびに今日の盤の記録を保存する（途中で閉じても続きから）
  function saveDailyTap(idx, g) {
    var d = store.data.daily[session.key];
    var i = session.index;
    if (!d.boards[i]) {
      d.boards[i] = { taps: [], removed: 0, total: g.total, full: false, maxChain: 0, done: false };
    }
    var rec = d.boards[i];
    rec.taps.push(idx);
    writeDailyRecord(rec, g);
  }
  function writeDailyRecord(rec, g) {
    var d = store.data.daily[session.key];
    var i = session.index;
    rec.total = g.total;
    rec.removed = g.removed;
    rec.maxChain = g.maxChain;
    rec.full = g.removed === g.total;
    rec.done = g.ended;
    if (rec.done && i === boardCount(session.key) - 1 && !d.done) {
      d.done = true;
      if (!(trialOn && session.key === 'pro')) S.markDailyDone(d, session.date); // 試し中の Pro は連続日数を残さない
    }
    store.save();
  }

  // ===== 自由練習 =====
  // fromTitle：タイトルから押した（1盤目）。Hard は、Worker が作り終えた次の盤があればそれ、
  // なければ1盤目は free-k.json（同じ組み合わせの盤）、それもなければ Worker の盤を待つ（Worker がなければ本体で作る）
  function startFree(mode, fromTitle) {
    game = null;
    show('loading');
    if (mode === 'hard') {
      var played = store.data.modes.hard.played;
      var d0 = L.decideHardStart(queue, lastHardPair(), played, false, false, !!worker);
      if (d0.act === 'queue') { useFree(mode, d0.box.board, d0.pair); return; }
      tablesReady.then(function () {
        if (screen !== 'loading') return;
        var tb = null;
        var d = L.decideHardStart(queue, lastHardPair(), played, fromTitle, !!tables.free, !!worker);
        if (d.act === 'queue') { useFree(mode, d.box.board, d.pair); return; }
        // 表の盤を使ったら、同じ組み合わせで Worker が作っている盤は useFree→prepareHard で捨てて次の組み合わせを頼む
        if (d.act === 'table') tb = L.freeTableBoard(tables.free, L.freeTableIndex(played, d.pair));
        if (tb) { useFree(mode, tb, d.pair); return; }
        if (d.act === 'table') d = L.decideHardStart(queue, lastHardPair(), played, false, false, !!worker); // 表が使えなかった
        if (d.act === 'queue') { useFree(mode, d.box.board, d.pair); return; }
        if (d.act === 'wait') { // 裏で作っている盤を待つ（「盤を作っています…」のまま）。盤がなければ本体で作る
          d.box.waiters.push(function () {
            if (screen !== 'loading') return;
            if (d.box.board) useFree(mode, d.box.board, d.pair); else buildFreeHere(mode, false);
          });
          return;
        }
        buildFreeHere(mode, false); // Worker が使えない・盤のない箱しかない：本体で作る
      });
      return;
    }
    buildFreeHere(mode, fromTitle);
  }
  // 本体で作る（Easy・Normal と、Worker が使えないときの Hard・Professional）
  function buildFreeHere(mode, fromTitle) {
    if (mode === 'hard') {
      var pair = L.nextFreePair(lastHardPair(), store.data.modes.hard.played);
      freeCount++;
      var hseed = Date.now() + '-' + freeCount;
      afterPaint(function () {
        if (screen !== 'loading') return;
        var tb = fromTitle ? L.freeTableBoard(tables.free, L.freeTableIndex(store.data.modes.hard.played, pair)) : null;
        useFree(mode, tb || L.freeBoard(mode, hseed, pair), pair);
      });
      return;
    }
    freeCount++;
    var seed = Date.now() + '-' + freeCount;
    // Professional は Worker があれば裏で作る（試しの案も渡す）
    if (mode === 'pro' && genInWorker({ type: 'free', mode: 'pro', seed: seed, variant: L.proVariant() }, function (b) {
      if (screen === 'loading') useFree(mode, b || L.freeBoard(mode, seed));
    })) return;
    afterPaint(function () {
      if (screen !== 'loading') return; // 待つ間に戻る操作でタイトルへ戻った
      useFree(mode, L.freeBoard(mode, seed));
    });
  }
  // pair：Hard のとき、この盤の組み合わせ（次の組み合わせはここから1つ進む）
  function useFree(mode, board, pair) {
    if (!board) { window.alert(t('makeFailed')); showTitle(); return; }
    session = { kind: 'free', mode: mode, board: board };
    maybeFirstHelp();
    startFreeBoard();
    if (mode === 'hard') {
      store.data.freeHardPair = pair; // 開き直しても次は「この盤＋1」から
      store.save();
      prepareHard(); // 遊んでいる間に次の2盤を作る（いらなくなった組み合わせの盤は捨てる）
    }
  }
  function startFreeBoard() {
    var b = session.board;
    startGame(b, t('freeLabel', { mode: modeName(session.mode), n: b.n }), []);
  }

  function maybeFirstHelp() {
    if (store.data.seenHelp) return;
    store.data.seenHelp = true;
    store.save();
    guideNext = true;
    setTimeout(openHelp, 0);
  }

  // ===== 画面2：遊ぶ =====
  function startGame(board, label, replayTaps) {
    var cfg = C.MODES[board.mode];
    var n = board.n, size = n * n;
    var r = L.replayBoard(board, replayTaps || []);
    game = {
      board: board, cfg: cfg, n: n, total: r.total, kinds: L.kindsOf(board),
      st: r.st,                                   // 計算上の盤
      vlay: new Uint8Array(r.st.lay),             // 描いている盤（演出が追いつくまで残す）
      vdir: new Int8Array(r.st.dir),
      popT: new Float64Array(size).fill(-1), popDir: new Int8Array(size),
      rotT: new Float64Array(size).fill(-1),
      taps: r.taps.length, removed: r.removed, maxChain: r.maxChain,
      shownRemoved: r.removed, shownChain: 0, shownMax: r.maxChain,
      busy: false, ended: r.removed === r.total || r.taps.length >= cfg.taps,
      anim: null, turn: null, rings: [], parts: [], shake: 0,
      guide: guideNext && r.taps.length === 0, hover: -1, down: null
    };
    guideNext = false;
    $('game-label').textContent = label;
    renderSubRow(board);
    $('result').hidden = true;
    show('game');
    layout();
    updateHud();
    if (game.taps === 0) setHint(t('hintStart', { n: cfg.taps }));
    else hintAfterTap();
    kick();
  }

  // 補足の行（Hard：その盤の特別タイルの絵と名前。Pro：「↻ 1手ごとに全部回る」）
  function renderSubRow(board) {
    var sub = $('game-sub');
    sub.textContent = '';
    if (board.mode === 'hard' && board.specials && board.specials.length) {
      board.specials.forEach(function (name, i) {
        if (i > 0) sub.appendChild(document.createTextNode(t('specialSep')));
        sub.appendChild(iconCanvas(name, 18));
        var s = document.createElement('span');
        s.textContent = t(name);
        sub.appendChild(s);
      });
      sub.hidden = false;
    } else if (board.mode === 'pro') {
      sub.textContent = t('rotateAll');
      sub.hidden = false;
    } else {
      sub.hidden = true;
    }
  }

  function updateHud() {
    $('hud-taps').textContent = game.taps + '/' + game.cfg.taps;
    $('hud-cleared').textContent = game.shownRemoved + '/' + game.total;
    $('hud-chain').textContent = Math.max(game.shownMax, game.shownChain);
    $('hud-starts').textContent = t('startsVal', { n: game.board.ev.starts });
  }
  function setHint(s) { $('hint').textContent = s; }

  // 1手のあと：残りの手数で総当たりして、まだ全部消せるか／最高いくつか（仕様書6.4）
  function hintAfterTap() {
    var left = game.cfg.taps - game.taps;
    var r = L.hintAfter(game.board, game.st, left);
    var s = r.canClear ? t('stillClear') : t('noClear', { n: (game.removed + r.best) + '/' + game.total });
    setHint(t('leftTaps', { n: left }) + t('hintSep') + s);
  }

  // ===== 盤の大きさ（仕様書6.4） =====
  function safeInsets() {
    var cs = getComputedStyle($('safe-probe'));
    return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  }
  function layout() {
    if (!game) return;
    var frameW = $('app').getBoundingClientRect().width;
    var vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    var ins = safeInsets();
    var usable = vh - ins.top - ins.bottom;
    var subH = $('game-sub').hidden ? 0 : 24; // 補足の行 20px＋上の余白4px
    var s = Math.floor(Math.min(frameW - 24, usable - 44 - 52 - subH - 28 - 16, 456));
    s = Math.max(220, s);
    var dpr = window.devicePixelRatio || 1;
    canvas.style.width = s + 'px';
    canvas.style.height = s + 'px';
    canvas.width = Math.round(s * dpr);
    canvas.height = Math.round(s * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    $('board-wrap').style.width = s + 'px';
    view.size = s;
    view.pad = Math.max(4, Math.round(s * 0.025));
    view.cell = (s - view.pad * 2) / game.n;
    // 結果の板：幅＝S−16、高さ＝Sの70%（下限172px・上限S）
    var res = $('result');
    res.style.width = (s - 16) + 'px';
    res.style.height = Math.min(s, Math.max(172, Math.round(s * 0.7))) + 'px';
    draw(nowSec());
  }
  var resizeTimer = null;
  function onResize() {
    if (resizeTimer) return;
    resizeTimer = setTimeout(function () { resizeTimer = null; layout(); }, 150);
  }

  function cellCenter(idx) {
    var r = (idx / game.n) | 0, c = idx % game.n;
    return { x: view.pad + (c + 0.5) * view.cell, y: view.pad + (r + 0.5) * view.cell };
  }
  function cellAt(e) {
    var rect = canvas.getBoundingClientRect();
    var c = Math.floor((e.clientX - rect.left - view.pad) / view.cell);
    var r = Math.floor((e.clientY - rect.top - view.pad) / view.cell);
    if (r < 0 || c < 0 || r >= game.n || c >= game.n) return -1;
    return r * game.n + c;
  }

  // ===== タップ（仕様書6.1：同じマスで、動きが10px以内なら押した。マウスは左ボタンだけ） =====
  canvas.addEventListener('pointerdown', function (e) {
    if (!game) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    game.down = { id: e.pointerId, x: e.clientX, y: e.clientY, cell: cellAt(e) };
  });
  canvas.addEventListener('pointerup', function (e) {
    if (!game || !game.down || game.down.id !== e.pointerId) return;
    var d = game.down;
    game.down = null;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) return;
    var idx = cellAt(e);
    if (idx < 0 || idx !== d.cell) return;
    // 連鎖中・回転中は無視。穴・空き・壁は押せない（手数も減らない）
    if (game.busy || game.ended || !L.tappable(game.st, idx)) return;
    tap(idx);
  });
  canvas.addEventListener('pointercancel', function () { if (game) game.down = null; });
  canvas.addEventListener('pointermove', function (e) {
    if (!game || e.pointerType !== 'mouse') return;
    var idx = cellAt(e);
    if (idx !== game.hover) { game.hover = idx; draw(nowSec()); }
  });
  canvas.addEventListener('pointerleave', function () {
    if (game && game.hover !== -1) { game.hover = -1; draw(nowSec()); }
  });

  function tap(idx) {
    var g = game;
    g.busy = true;
    g.guide = false;
    // 先にルールどおり計算して保存し、その記録の順に演出する
    var rec = { pops: [], balls: [], rots: [], tEnd: 0 };
    var cnt = Math.max(0, L.tapState(g.st, g.cfg, idx, g.taps, rec));
    g.taps++;
    g.removed += cnt;
    if (cnt > g.maxChain) g.maxChain = cnt;
    g.ended = (g.removed === g.total) || (g.taps >= g.cfg.taps);
    if (session.kind === 'daily') saveDailyTap(idx, g);
    else if (g.ended) saveFreeResult(g);
    g.anim = makeAnim(rec);
    g.shownChain = 0;
    setHint(t('chaining'));
    updateHud();
    kick();
  }

  // 演出の時刻表：1時刻＝玉が1マス進む。速さは毎秒10マスから、弾けるたびに0.6ずつ速く（上限22）。遅くはしない
  function makeAnim(rec) {
    var popsAt = [];
    rec.pops.forEach(function (p) { popsAt[p.t] = (popsAt[p.t] || 0) + 1; });
    var times = [0], popped = 0;
    for (var s = 0; s <= rec.tEnd; s++) {
      popped += popsAt[s] || 0;
      times.push(times[s] + 1 / Math.min(22, 10 + 0.6 * popped));
    }
    return { rec: rec, times: times, t0: nowSec(), pi: 0, ri: 0, finished: false, endAt: 0 };
  }
  function animStep(a, now) {
    var el = now - a.t0, tm = a.times, s = 0;
    while (s < tm.length - 2 && tm[s + 1] <= el) s++;
    var f = (el - tm[s]) / (tm[s + 1] - tm[s]);
    return s + Math.min(1, Math.max(0, f));
  }

  function saveFreeResult(g) {
    if (trialOn && session.mode === 'pro') return; // 試し中の Professional は記録を残さない（案ごとに難しさが違うため）
    var rec = store.data.modes[session.mode];
    rec.played = Math.min(99999999, rec.played + 1);
    if (g.removed === g.total) rec.cleared = Math.min(99999999, rec.cleared + 1);
    if (g.maxChain > rec.bestChain) rec.bestChain = g.maxChain;
    store.save();
  }

  // ===== 演出（仕様書6.2：輪は1本・スローなし・光らせない） =====
  function applyPop(p, now) {
    var g = game, cs = view.cell, i = p.i;
    if (p.top) { g.vlay[i] = 1; g.vdir[i] = g.board.dirs2[i]; } // 2枚重ね：上だけ消えて下が残る
    else { g.vlay[i] = 0; g.popT[i] = now; g.popDir[i] = p.d; }
    g.shownChain++;
    g.shownRemoved++;
    var c = cellCenter(i);
    g.rings.push({ x: c.x, y: c.y, t0: now });
    if (!reducedMotion()) {
      for (var k = 0; k < 6; k++) {
        var a = frand() * Math.PI * 2, sp = cs * (1.5 + frand() * 2.5);
        g.parts.push({
          x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 0, max: 0.35 + frand() * 0.25, color: k % 2 ? COL.red : COL.ink,
          w: cs * 0.08, h: cs * 0.08, rot: 0, vr: 0, g: cs * 4
        });
      }
      g.shake = Math.min(3, g.shake + 0.6);
    }
    updateHud();
  }
  function applyRot(r, now) {
    var g = game;
    g.vdir[r.i] = (g.vdir[r.i] + 1) & 3;
    g.rotT[r.i] = now;
  }

  function endChain(now) {
    var g = game;
    if (g.shownChain > g.shownMax) g.shownMax = g.shownChain;
    g.shownChain = 0;
    updateHud();
    if (g.ended) {
      var full = g.removed === g.total;
      if (full) celebrate();
      setTimeout(function () { if (game === g) showResult(); }, full ? 700 : 400);
    } else if (g.cfg.rotateEach) {
      g.turn = { t0: now }; // Professional：残りの矢印を全部回す（0.3秒。その間は押せない）
    } else {
      hintAfterTap();
      g.busy = false;
    }
  }
  function endTurn() {
    var g = game;
    for (var i = 0; i < g.vlay.length; i++) if (g.vlay[i] > 0 && g.vdir[i] >= 0) g.vdir[i] = (g.vdir[i] + 1) & 3;
    g.turn = null;
    hintAfterTap();
    g.busy = false;
  }

  function celebrate() {
    if (reducedMotion()) return;
    var S0 = view.size, cs = view.cell, cols = [COL.red, COL.ink, COL.gray];
    for (var i = 0; i < 60; i++) {
      game.parts.push({
        x: frand() * S0, y: -10 - frand() * S0 * 0.3,
        vx: (frand() - 0.5) * cs, vy: cs * (1 + frand() * 1.5),
        life: 0, max: 1.6 + frand() * 0.8, color: cols[i % 3],
        w: cs * 0.06, h: cs * 0.22, rot: frand() * Math.PI, vr: (frand() - 0.5) * 8, g: cs * 1.5
      });
    }
  }

  var running = false, lastTs = 0;
  function kick() {
    if (running) return;
    running = true;
    lastTs = performance.now();
    requestAnimationFrame(frame);
  }
  function frame(ts) {
    if (!game || screen !== 'game') { running = false; return; }
    var dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    var now = nowSec();
    update(dt, now);
    draw(now);
    var g = game;
    var active = g && (g.anim || g.turn || g.parts.length || g.rings.length || g.shake > 0.05 || g.guide || recent(now));
    if (active) requestAnimationFrame(frame); else running = false;
  }
  function recent(now) {
    for (var i = 0; i < game.popT.length; i++) {
      if (game.popT[i] >= 0 && now - game.popT[i] < 0.25) return true;
      if (game.rotT[i] >= 0 && now - game.rotT[i] < 0.2) return true;
    }
    return false;
  }

  function update(dt, now) {
    var g = game, a = g.anim;
    if (a && !a.finished) {
      var tau = animStep(a, now), pops = a.rec.pops, rots = a.rec.rots;
      while (a.pi < pops.length && pops[a.pi].t <= tau) applyPop(pops[a.pi++], now);
      while (a.ri < rots.length && rots[a.ri].t <= tau) applyRot(rots[a.ri++], now);
      if (now - a.t0 >= a.times[a.times.length - 1]) {
        while (a.pi < pops.length) applyPop(pops[a.pi++], now);
        while (a.ri < rots.length) applyRot(rots[a.ri++], now);
        a.finished = true;
        a.endAt = now;
        endChain(now);
      }
    }
    if (a && a.finished && now - a.endAt > 0.9) g.anim = null; // 通った跡が消えたら記録も捨てる
    if (g.turn && now - g.turn.t0 >= 0.3) endTurn();
    g.rings = g.rings.filter(function (r) { return now - r.t0 < 0.35; });
    g.parts = g.parts.filter(function (p) {
      p.life += dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
      return p.life < p.max;
    });
    g.shake *= Math.exp(-dt * 14);
  }

  // ===== タイルの絵（平らな正方形＋線の矢印。特別タイルは仕様書3.3の描き方） =====
  function arrowPath(c2, len, h) {
    c2.moveTo(0, len / 2); c2.lineTo(0, -len / 2);
    c2.moveTo(-h, -len / 2 + h); c2.lineTo(0, -len / 2); c2.lineTo(h, -len / 2 + h);
  }
  function square(c2, cell, cx, cy, scale, fill, border) {
    var s = cell * 0.88 * scale, r = cell * 0.06 * scale;
    roundRect(c2, cx - s / 2, cy - s / 2, s, s, r);
    c2.fillStyle = fill; c2.fill();
    c2.lineWidth = Math.max(1.5, cell * 0.035);
    c2.strokeStyle = border; c2.stroke();
  }
  // 普通のタイル（ctx・セルの大きさを受け取るので遊び方の小さな盤でも使う）。angle：Professional の回転中の追加の角度（1＝90度）
  function drawTile(c2, cell, cx, cy, dir, scale, alpha, border, angle) {
    c2.save();
    c2.globalAlpha = alpha;
    square(c2, cell, cx, cy, scale, COL.tile, border);
    c2.translate(cx, cy);
    c2.rotate((dir + (angle || 0)) * Math.PI / 2);
    var len = cell * 0.56 * scale;
    c2.lineWidth = cell * 0.07 * scale;
    c2.lineCap = 'round'; c2.lineJoin = 'round';
    c2.strokeStyle = COL.ink;
    c2.beginPath(); arrowPath(c2, len, len * 0.3); c2.stroke();
    c2.restore();
  }
  // 特別タイルも含めた1マス。lay：残りの層、dir：いまの向き、low：2枚重ねの下の向き、spin：回転タイルの回る途中（0〜1）
  function drawCell(c2, cell, cx, cy, kind, lay, dir, low, scale, alpha, border, angle, spin) {
    if (kind === K.NORMAL || (kind === K.DOUBLE && lay === 1)) { drawTile(c2, cell, cx, cy, dir, scale, alpha, border, angle); return; }
    c2.save();
    c2.globalAlpha = alpha;
    c2.lineCap = 'round'; c2.lineJoin = 'round';
    var lw = cell * 0.07 * scale;
    if (kind === K.WALL) { // 灰色の塗り＋斜線。矢印なし
      var s = cell * 0.88 * scale;
      roundRect(c2, cx - s / 2, cy - s / 2, s, s, cell * 0.06 * scale);
      c2.fillStyle = COL.gray; c2.fill();
      c2.save(); c2.clip();
      c2.strokeStyle = 'rgba(255,255,255,0.55)'; c2.lineWidth = Math.max(1, cell * 0.04);
      c2.beginPath();
      for (var k = -3; k <= 3; k++) { var o = k * s / 3.5; c2.moveTo(cx - s / 2 + o, cy + s / 2); c2.lineTo(cx + s / 2 + o, cy - s / 2); }
      c2.stroke(); c2.restore();
      // 枠（restore では描きかけの線は戻らないので、四角をもう一度なぞる）
      roundRect(c2, cx - s / 2, cy - s / 2, s, s, cell * 0.06 * scale);
      c2.lineWidth = Math.max(1.5, cell * 0.035); c2.strokeStyle = COL.gray; c2.stroke();
    } else if (kind === K.CROSS) { // タイルの中に4方向の短い矢印（＋形）
      square(c2, cell, cx, cy, scale, COL.tile, border);
      c2.translate(cx, cy);
      c2.strokeStyle = COL.ink; c2.lineWidth = lw * 0.85;
      for (var d = 0; d < 4; d++) {
        c2.save(); c2.rotate(d * Math.PI / 2);
        var a0 = cell * 0.05 * scale, a1 = cell * 0.31 * scale, h = cell * 0.1 * scale;
        c2.beginPath(); c2.moveTo(0, -a0); c2.lineTo(0, -a1);
        c2.moveTo(-h, -a1 + h); c2.lineTo(0, -a1); c2.lineTo(h, -a1 + h); c2.stroke();
        c2.restore();
      }
    } else if (kind === K.DOUBLE) { // 2枚目の枠を右下へずらし、下の矢印は右下の隅に小さく
      var off = cell * 0.07 * scale;
      square(c2, cell, cx + off / 2, cy + off / 2, scale * 0.94, COL.tile, border);
      square(c2, cell, cx - off / 2, cy - off / 2, scale * 0.94, COL.tile, border);
      c2.translate(cx - off / 2, cy - off / 2);
      c2.save(); c2.rotate(dir * Math.PI / 2);
      var len = cell * 0.5 * scale;
      c2.strokeStyle = COL.ink; c2.lineWidth = lw;
      c2.beginPath(); arrowPath(c2, len, len * 0.3); c2.stroke();
      c2.restore();
      c2.translate(cell * 0.27 * scale, cell * 0.27 * scale);
      c2.rotate(low * Math.PI / 2);
      var sl = cell * 0.2 * scale;
      c2.strokeStyle = COL.gray; c2.lineWidth = Math.max(1, lw * 0.5);
      c2.beginPath(); arrowPath(c2, sl, sl * 0.35); c2.stroke();
    } else if (kind === K.ROTOR) { // 円形のタイル＋矢印＋円周に時計回りの小さな弧
      var rad = cell * 0.43 * scale;
      c2.beginPath(); c2.arc(cx, cy, rad, 0, Math.PI * 2);
      c2.fillStyle = COL.tile; c2.fill();
      c2.lineWidth = Math.max(1.5, cell * 0.035); c2.strokeStyle = border; c2.stroke();
      c2.translate(cx, cy);
      c2.save(); c2.rotate((dir - 1 + (spin === undefined ? 1 : spin) + (angle || 0)) * Math.PI / 2);
      var ln = cell * 0.46 * scale;
      c2.strokeStyle = COL.ink; c2.lineWidth = lw;
      c2.beginPath(); arrowPath(c2, ln, ln * 0.3); c2.stroke();
      c2.restore();
      var ar = rad * 0.8, e0 = -Math.PI * 0.95, e1 = -Math.PI * 0.62;
      c2.strokeStyle = COL.gray; c2.lineWidth = Math.max(1, cell * 0.03);
      c2.beginPath(); c2.arc(0, 0, ar, e0, e1); c2.stroke();
      var ex = Math.cos(e1) * ar, ey = Math.sin(e1) * ar, hh = cell * 0.07 * scale;
      c2.beginPath(); c2.moveTo(ex - hh, ey - hh * 0.2); c2.lineTo(ex, ey); c2.lineTo(ex - hh * 0.3, ey + hh); c2.stroke();
    }
    c2.restore();
  }
  // 小さな絵（補足の行・遊び方）
  function iconCanvas(name, px) {
    var c = document.createElement('canvas'), dpr = window.devicePixelRatio || 1;
    c.width = Math.round(px * dpr); c.height = Math.round(px * dpr);
    c.style.width = px + 'px'; c.style.height = px + 'px';
    c.className = 'tile-icon';
    c.setAttribute('aria-hidden', 'true');
    var c2 = c.getContext('2d');
    c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    var kind = L.SPECIAL_KINDS[name];
    drawCell(c2, px, px / 2, px / 2, kind, kind === K.DOUBLE ? 2 : 1, 1, 2, 1, 1, COL.ink);
    return c;
  }

  function roundRect(c2, x, y, w, h, r) {
    c2.beginPath();
    c2.moveTo(x + r, y);
    c2.lineTo(x + w - r, y); c2.arcTo(x + w, y, x + w, y + r, r);
    c2.lineTo(x + w, y + h - r); c2.arcTo(x + w, y + h, x + w - r, y + h, r);
    c2.lineTo(x + r, y + h); c2.arcTo(x, y + h, x, y + h - r, r);
    c2.lineTo(x, y + r); c2.arcTo(x, y, x + r, y, r);
    c2.closePath();
  }
  // 盤：白の無地＋細い区切り線。kinds があれば穴のマスは描かない（画面背景が見える）
  function drawBoardBase(c2, size, pad, cell, n, kinds) {
    var hasHoles = false;
    if (kinds) for (var h = 0; h < kinds.length; h++) if (kinds[h] === K.HOLE) { hasHoles = true; break; }
    if (!hasHoles) {
      c2.fillStyle = COL.board;
      c2.fillRect(0, 0, size, size);
      c2.strokeStyle = COL.grid; c2.lineWidth = 1;
      c2.beginPath();
      for (var i = 1; i < n; i++) {
        var p = Math.round(pad + i * cell) + 0.5;
        c2.moveTo(pad, p); c2.lineTo(size - pad, p);
        c2.moveTo(p, pad); c2.lineTo(p, size - pad);
      }
      c2.stroke();
      c2.strokeStyle = COL.frame;
      c2.strokeRect(0.5, 0.5, size - 1, size - 1);
      return;
    }
    for (var j = 0; j < kinds.length; j++) {
      if (kinds[j] === K.HOLE) continue;
      var x = pad + (j % n) * cell, y = pad + ((j / n) | 0) * cell;
      c2.fillStyle = COL.board;
      c2.fillRect(x - 0.5, y - 0.5, cell + 1, cell + 1);
      c2.strokeStyle = COL.grid; c2.lineWidth = 1;
      c2.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(cell) - 1, Math.round(cell) - 1);
    }
  }

  function ballPos(bl, tau) {
    var a = cellCenter(bl.from), k = (Math.min(tau, bl.t1) - bl.t0) * view.cell;
    return { x: a.x + L.DC[bl.d] * k, y: a.y + L.DR[bl.d] * k };
  }

  function draw(now) {
    var g = game;
    if (!g) return;
    var S0 = view.size, n = g.n, cs = view.cell;
    ctx.clearRect(0, 0, S0, S0);
    ctx.save();
    if (g.shake > 0.05) ctx.translate((frand() - 0.5) * g.shake, (frand() - 0.5) * g.shake);
    drawBoardBase(ctx, S0, view.pad, cs, n, g.board.kinds);

    var a = g.anim, tau = a ? (a.finished ? Infinity : animStep(a, now)) : 0;
    // 連鎖の通った跡（朱の細い折れ線。玉が止まってから0.9秒で消える）
    if (a) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = COL.red;
      ctx.lineWidth = Math.max(1.5, cs * 0.04);
      var el = now - a.t0;
      a.rec.balls.forEach(function (bl) {
        if (tau < bl.t0) return;
        var fade = tau >= bl.t1 ? Math.max(0, 1 - (el - a.times[Math.min(bl.t1, a.times.length - 1)]) / 0.9) : 1;
        if (fade <= 0) return;
        var p0 = cellCenter(bl.from), p1 = ballPos(bl, tau);
        ctx.globalAlpha = fade * 0.7;
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }

    // タイル
    var turnF = g.turn ? Math.min(1, (now - g.turn.t0) / 0.3) : 0;
    for (var i = 0; i < n * n; i++) {
      var kind = g.kinds[i];
      if (kind === K.HOLE) continue;
      var c = cellCenter(i);
      if (g.vlay[i] > 0) {
        var hov = (i === g.hover && !g.busy && !g.ended && kind !== K.WALL);
        var spin = g.rotT[i] >= 0 ? Math.min(1, (now - g.rotT[i]) / 0.2) : 1;
        var ang = (kind !== K.WALL && kind !== K.CROSS) ? turnF : 0;
        drawCell(ctx, cs, c.x, c.y, kind, g.vlay[i], g.vdir[i], g.board.dirs2 ? g.board.dirs2[i] : 0, 1, 1, hov ? COL.red : COL.ink, ang, spin);
      } else if (g.popT[i] >= 0) {
        var f = (now - g.popT[i]) / 0.25; // 枠が一瞬朱になって小さく消える
        if (f < 1) drawCell(ctx, cs, c.x, c.y, kind === K.DOUBLE ? K.NORMAL : kind, 1, g.popDir[i], 0, 1 - 0.3 * f, 1 - f, COL.red);
      }
    }

    // 初回の1盤目：盤の中央のタイルに朱の輪が脈打つ（答えは教えない）
    if (g.guide) {
      var mid = ((n / 2) | 0) * n + ((n / 2) | 0);
      if (L.tappable(g.st, mid)) {
        var mc = cellCenter(mid);
        var k = reducedMotion() ? 0.5 : (Math.sin(now * 5) + 1) / 2;
        ctx.strokeStyle = COL.red; ctx.lineWidth = 2;
        ctx.globalAlpha = 0.5 + 0.5 * k;
        ctx.beginPath(); ctx.arc(mc.x, mc.y, cs * (0.5 + 0.08 * k), 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // 弾けたときの輪（1本だけ・0.35秒）
    ctx.strokeStyle = COL.red;
    g.rings.forEach(function (r) {
      var f2 = (now - r.t0) / 0.35;
      ctx.globalAlpha = 1 - f2;
      ctx.lineWidth = Math.max(1, cs * 0.03);
      ctx.beginPath(); ctx.arc(r.x, r.y, cs * (0.3 + 0.45 * f2), 0, Math.PI * 2); ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // 玉の尾と玉（朱）。十字のあとは玉が複数
    if (a && !a.finished) {
      ctx.lineCap = 'round';
      a.rec.balls.forEach(function (bl) {
        if (tau < bl.t0 || tau >= bl.t1) return;
        var p = ballPos(bl, tau), q = ballPos(bl, Math.max(bl.t0, tau - 0.6));
        ctx.strokeStyle = COL.red; ctx.globalAlpha = 0.8;
        ctx.lineWidth = Math.max(1.5, cs * 0.05);
        ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = COL.red;
        ctx.beginPath(); ctx.arc(p.x, p.y, cs * 0.09, 0, Math.PI * 2); ctx.fill();
      });
    }

    // 破片・紙片
    g.parts.forEach(function (p) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    ctx.restore();
  }

  // ===== 1盤の結果（盤の上に重ねる板） =====
  function showResult() {
    var g = game;
    var kind = L.resultKind(g.removed, g.total);
    setHint('');
    $('result-head').textContent = t(kind === 'full' ? 'fullClear' : kind);
    $('result-line').textContent = t('resultLine', { a: g.removed, b: g.total, c: g.maxChain });
    var box = $('result-buttons');
    box.textContent = '';
    if (session.kind === 'daily') {
      var i = session.index, key = session.key;
      if (i < boardCount(key) - 1) {
        addButton(box, t('nextDaily', { c: CIRCLED[i + 1] }), 'btn-primary', function () { startDailyBoard(i + 1); });
      } else {
        addButton(box, t('seeDaily'), 'btn-primary', function () { showFinal(key); });
      }
    } else {
      addButton(box, t('nextBoard'), 'btn-primary', function () { startFree(session.mode, false); });
      addButton(box, t('retry'), 'btn-outline', startFreeBoard);
    }
    $('result').hidden = false;
    // 0.5秒は押せない（連打で次へ進まないため）
    var btns = box.querySelectorAll('button');
    btns.forEach(function (b) { b.disabled = true; });
    setTimeout(function () { btns.forEach(function (b) { b.disabled = false; }); }, 500);
  }
  function addButton(parent, label, cls, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ' + cls;
    b.textContent = label;
    b.addEventListener('click', fn);
    parent.appendChild(b);
  }

  // ===== 画面4：今日の結果とシェア（今日の Hard／Professional も同じ形で1行） =====
  function showFinal(key) {
    var d = store.data.daily[key];
    var tag = L.dayTag(d.date);
    var streak = (key === 'pro' && trialOn) ? 0 : S.shownStreak(d, todayStr()); // 試し中の Pro は連続日数を出さない
    var lines = $('final-lines');
    lines.textContent = '';
    if (key === 'main') {
      $('final-title').textContent = t('finalTitle', { tag: tag });
      d.boards.forEach(function (b, i) {
        var div = document.createElement('div');
        div.textContent = t('finalLine', {
          c: CIRCLED[i], mode: modeName(C.DAILY_MODES[i]), a: b.removed, b: b.total,
          full: b.full ? t('fullMark') : '', chainLabel: t('maxChain'), chain: b.maxChain
        });
        lines.appendChild(div);
      });
      $('share-text').textContent = I.shareText(lang, C.APP_NAME[lang], tag, d.boards, streak, C.SHARE_URL);
    } else {
      var b = d.boards[0], name = modeName(key);
      $('final-title').textContent = t('finalTitleOne', { mode: name, tag: tag });
      var div = document.createElement('div');
      div.textContent = t('finalLineOne', { mode: name, a: b.removed, b: b.total, full: b.full ? t('fullMark') : '', chainLabel: t('maxChain'), chain: b.maxChain });
      lines.appendChild(div);
      $('share-text').textContent = I.shareTextOne(lang, C.APP_NAME[lang], tag, name, b, streak, C.SHARE_URL);
    }
    $('final-streak').textContent = streak >= 2 ? t('streak', { n: streak }) : (streak === 1 ? t('day1') : '');
    $('copy-msg').textContent = '';
    $('btn-share').hidden = !navigator.share;
    $('final-unsaved').hidden = store.persistent;
    game = null;
    show('final');
  }

  function copyText(text) {
    function fallback() {
      var ok = false;
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed'; ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (e) { ok = false; }
      $('copy-msg').textContent = ok ? t('copied') : t('copyFailed');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { $('copy-msg').textContent = t('copied'); }, fallback);
    } else {
      fallback();
    }
  }

  // ===== 画面3：遊び方（3×3で矢印2本の連鎖が走る小さな盤＋Hard の特別タイルの絵） =====
  var help = { open: false, t0: 0, ctx: null };
  function openHelp() {
    $('help').hidden = false;
    help.open = true;
    help.t0 = nowSec();
    var c = $('help-canvas'), dpr = window.devicePixelRatio || 1;
    c.width = Math.round(132 * dpr); c.height = Math.round(132 * dpr);
    help.ctx = c.getContext('2d');
    help.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var icons = document.querySelectorAll('[data-icon]');
    for (var i = 0; i < icons.length; i++) {
      icons[i].textContent = '';
      icons[i].appendChild(iconCanvas(icons[i].getAttribute('data-icon'), 28));
    }
    requestAnimationFrame(helpFrame);
    $('btn-help-close').focus();
  }
  function closeHelp() {
    $('help').hidden = true;
    help.open = false;
  }
  // (2,0)↑ を押す → 玉が上へ → (0,0)→ が弾ける → 玉が右へ抜ける。(2,2)← は残る
  var HELP_TILES = [{ i: 6, d: 0 }, { i: 0, d: 1 }, { i: 8, d: 3 }];
  function helpFrame() {
    if (!help.open) return;
    var c2 = help.ctx, size = 132, pad = 6, cell = (size - pad * 2) / 3;
    var T = (nowSec() - help.t0) % 3.2;
    function ctr(i) { return { x: pad + (i % 3 + 0.5) * cell, y: pad + (((i / 3) | 0) + 0.5) * cell }; }
    c2.clearRect(0, 0, size, size);
    drawBoardBase(c2, size, pad, cell, 3, null);
    var popA = 0.8, popB = popA + 0.4, out = popB + 0.45;
    HELP_TILES.forEach(function (tile, k) {
      var p = ctr(tile.i), tp = k === 0 ? popA : (k === 1 ? popB : Infinity);
      if (T < tp) drawTile(c2, cell, p.x, p.y, tile.d, 1, 1, COL.ink);
      else if (T < tp + 0.25) drawTile(c2, cell, p.x, p.y, tile.d, 1 - 0.3 * (T - tp) / 0.25, 1 - (T - tp) / 0.25, COL.red);
    });
    if (T < popA) { // 押す前：押すタイルに朱の輪
      var a = ctr(6);
      c2.strokeStyle = COL.red; c2.lineWidth = 2;
      c2.beginPath(); c2.arc(a.x, a.y, cell * 0.52, 0, Math.PI * 2); c2.stroke();
    }
    var bx = null, by = null, A = ctr(6), B = ctr(0);
    if (T >= popA && T < popB) { var f = (T - popA) / (popB - popA); bx = A.x; by = A.y + (B.y - A.y) * f; }
    else if (T >= popB && T < out) { var f2 = (T - popB) / (out - popB); bx = B.x + (size + 10 - B.x) * f2; by = B.y; }
    if (T >= popA && T < out + 0.6) { // 通った跡
      c2.strokeStyle = COL.red; c2.lineWidth = 1.5; c2.globalAlpha = 0.7;
      c2.beginPath(); c2.moveTo(A.x, A.y);
      c2.lineTo(B.x, T < popB ? by : B.y);
      if (T >= popB) c2.lineTo(bx === null ? size : bx, B.y);
      c2.stroke(); c2.globalAlpha = 1;
    }
    if (bx !== null) { c2.fillStyle = COL.red; c2.beginPath(); c2.arc(bx, by, cell * 0.09, 0, Math.PI * 2); c2.fill(); }
    requestAnimationFrame(helpFrame);
  }

  // ===== ボタン・イベント =====
  $('btn-lang').addEventListener('click', function () {
    lang = lang === 'ja' ? 'en' : 'ja';
    store.data.lang = lang;
    store.save();
    applyStaticText();
    renderTitle();
  });
  $('btn-daily').addEventListener('click', function () { startDaily('main'); });
  $('btn-daily-hard').addEventListener('click', function () { startDaily('hard'); });
  $('btn-daily-pro').addEventListener('click', function () { startDaily('pro'); });
  // Professional の試しの案を切り替えて保存（今日の Pro は案ごとに別の盤になる）
  Array.prototype.forEach.call(document.querySelectorAll('.trial-btn'), function (btn) {
    btn.addEventListener('click', function () {
      store.data.proTrial = L.setProVariant(btn.getAttribute('data-trial'));
      store.save();
      renderTitle();
    });
  });
  $('btn-help').addEventListener('click', openHelp);
  $('btn-help-close').addEventListener('click', closeHelp);
  $('help').addEventListener('click', function (e) { if (e.target === $('help')) closeHelp(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && help.open) closeHelp(); });
  $('btn-back').addEventListener('click', goTitle);
  $('btn-final-title').addEventListener('click', goTitle);
  $('btn-copy').addEventListener('click', function () { copyText($('share-text').textContent); });
  $('btn-share').addEventListener('click', function () {
    navigator.share({ text: $('share-text').textContent }).catch(function () { /* 閉じただけなら何もしない */ });
  });
  window.addEventListener('resize', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  // アプリが前面に戻ったら今日の日付を計算し直す
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && screen === 'title') renderTitle();
  });

  applyStaticText();
  renderTitle();

  // PWA（http(s) で開いたときだけ。file:// では使えないがそのまま遊べる）
  if ('serviceWorker' in navigator && isHttp) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 登録できなくても遊べる */ });
    });
  }
})();
