// 盤の計算（乱数・連鎖エンジン・生成・総当たり・品質の条件・日付）。DOM を使わない。
// ブラウザでは window.PonLogic、Node.js（テスト）では require('./logic.js') で読む。
(function (root) {
  'use strict';
  var C = (typeof module === 'object' && module.exports) ? require('./config.js') : root.PonConfig;

  // 向き：0=上 1=右 2=下 3=左
  var DR = [-1, 0, 1, 0];
  var DC = [0, 1, 0, -1];

  // ---------- 乱数と種（仕様書4.1） ----------
  // FNV-1a（32bit）
  function hashStr(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // mulberry32（32bit 整数の計算だけ。Math.random は使わない）
  function makeRng(seed) {
    var a = seed >>> 0;
    function next() {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    }
    return {
      next: next,
      int: function (m) { return next() % m; },
      permille: function (p) { return (next() % 1000) < p; }
    };
  }

  // 種の文字列：生成の版|用途|日付|盤番号|k
  function seedString(ver, purpose, dateKey, boardIndex, k) {
    return ver + '|' + purpose + '|' + dateKey + '|' + boardIndex + '|k' + k;
  }

  // ---------- 連鎖エンジン（仕様書3.6。矢印だけの盤は玉が常に1つなので速い版） ----------
  // idx から向き d に進んで、最初にある「まだある」マスを返す（なければ -1＝盤の外）
  function firstAlive(present, n, idx, d) {
    var r = (idx / n) | 0, c = idx % n;
    for (;;) {
      r += DR[d]; c += DC[d];
      if (r < 0 || r >= n || c < 0 || c >= n) return -1;
      if (present[r * n + c]) return r * n + c;
    }
  }

  // 1回のタップの連鎖。present を書き換え、弾けた順に out へ入れ、弾けた枚数を返す。
  // タイルは弾けると消えるので同じタイルに2回当たらず、枚数は盤のマス数を超えない（必ず終わる）。
  function fire(present, dirs, n, start, out) {
    var cnt = 0, cur = start;
    present[cur] = 0;
    out[cnt++] = cur;
    for (;;) {
      var j = firstAlive(present, n, cur, dirs[cur]);
      if (j < 0) break;
      present[j] = 0;
      out[cnt++] = j;
      cur = j;
    }
    return cnt;
  }

  function fullPresent(size) {
    var p = new Uint8Array(size);
    for (var i = 0; i < size; i++) p[i] = 1;
    return p;
  }

  // ---------- 盤づくり（仕様書4.2：完全クリアの手順から前向きに決める） ----------
  function pickAlive(alive, remaining, rng) {
    var k = rng.int(remaining);
    for (var i = 0; i < alive.length; i++) {
      if (alive[i]) { if (k === 0) return i; k--; }
    }
    return -1;
  }

  // 1回作ってみる。失敗なら null
  function buildOnce(cfg, rng) {
    var n = cfg.n, size = n * n;
    var dirs = new Int8Array(size);
    var alive = fullPresent(size);
    for (var i = 0; i < size; i++) dirs[i] = -1;
    var remaining = size;
    var solution = [];
    var cd = [0, 0, 0, 0], ci = [0, 0, 0, 0], ex = [0, 0, 0, 0];
    for (var t = 0; t < cfg.taps; t++) {
      if (remaining === 0) return null; // 手数より早く全部消える盤は作らない
      var last = (t === cfg.taps - 1);
      var cur = pickAlive(alive, remaining, rng);
      solution.push(cur);
      alive[cur] = 0; remaining--;
      for (;;) {
        // 向き未定のタイルが弾けた：いまの盤で「続く向き」と「止まる向き（盤の外）」に分ける
        var nc = 0, ne = 0;
        for (var d = 0; d < 4; d++) {
          var j = firstAlive(alive, n, cur, d);
          if (j >= 0) { cd[nc] = d; ci[nc] = j; nc++; } else { ex[ne++] = d; }
        }
        var stop = (nc === 0);
        // 最後の手は止めない（続く向きがある限り続ける）
        if (!stop && ne > 0 && !last) stop = rng.permille(cfg.stopPermille);
        if (stop) { dirs[cur] = ex[rng.int(ne)]; break; }
        var pick = rng.int(nc);
        dirs[cur] = cd[pick];
        cur = ci[pick];
        alive[cur] = 0; remaining--;
      }
    }
    if (remaining > 0) return null; // 未定のタイルが残った
    var board = { n: n, dirs: dirs, solution: solution };
    if (!checkSolution(board)) return null;
    return board;
  }

  // 決まった向きだけで最初から本番のルールで動かし、その手順で全部消えるか確かめる
  function checkSolution(board) {
    var size = board.n * board.n;
    var present = fullPresent(size);
    var out = new Int16Array(size);
    var total = 0;
    for (var s = 0; s < board.solution.length; s++) {
      if (!present[board.solution[s]]) return false;
      total += fire(present, board.dirs, board.n, board.solution[s], out);
    }
    return total === size;
  }

  // ---------- 品質の条件（仕様書4.3：1手ごとに残りのタップできるタイルから等しい確率で押す人） ----------
  // 総当たり（深さ優先、マス番号の小さい順）。各手の重みに 1÷その時点でタップできる数 を掛けて合計する。
  // 全部消えたらそこで終わり（それ以上押さない）。
  function evaluate(board, cfg) {
    var n = board.n, size = n * n, dirs = board.dirs, taps = cfg.taps;
    var present = fullPresent(size);
    var total = size;
    var bufs = [];
    for (var b = 0; b < taps; b++) bufs.push(new Int16Array(size));
    var pClear = 0, expRemoved = 0, minClear = Infinity, firstMax = 0, best = 0, starts = 0;
    var foundClear = false;

    function dfs(depth, removed, alive, w) {
      if (removed === total || depth === taps) {
        expRemoved += w * removed;
        if (removed > best) best = removed;
        if (removed === total) {
          pClear += w;
          foundClear = true;
          if (depth < minClear) minClear = depth;
        }
        return;
      }
      var cw = w / alive;
      var buf = bufs[depth];
      for (var i = 0; i < size; i++) {
        if (!present[i]) continue;
        var c = fire(present, dirs, n, i, buf);
        if (depth === 0) { if (c > firstMax) firstMax = c; foundClear = false; }
        dfs(depth + 1, removed + c, alive - c, cw);
        if (depth === 0 && foundClear) starts++;
        for (var j = 0; j < c; j++) present[buf[j]] = 1;
      }
    }
    dfs(0, 0, total, 1);

    var cond = [
      minClear > cfg.noClearMaxTaps,                 // 1. 早く完全クリアできない
      pClear * 1000 <= cfg.clearPermille,            // 2. 適当に押して完全クリアになる確率
      expRemoved * 100 <= total * cfg.avgPct,        // 3. 適当に押したときの消える枚数の期待値
      firstMax * 100 >= total * cfg.bigPct           // 4. 1手目で盤の半分以上消える手がある
    ];
    var fails = 0;
    for (var q = 0; q < cond.length; q++) if (!cond[q]) fails++;
    return {
      total: total, pClear: pClear, expRemoved: expRemoved, minClear: minClear,
      firstMax: firstMax, best: best, starts: starts, cond: cond, fails: fails
    };
  }

  // いまの盤から残り tapsLeft 回でいくつ消せるか（最大）。全部消せたら打ち切る（ヒント：まだ全部消せるか）
  function bestReachable(present, dirs, n, tapsLeft) {
    var size = n * n;
    var p = new Uint8Array(present);
    var remain = 0;
    for (var i = 0; i < size; i++) remain += p[i];
    if (remain === 0 || tapsLeft <= 0) return { best: 0, remain: remain, canClear: remain === 0 };
    var bufs = [];
    for (var b = 0; b < tapsLeft; b++) bufs.push(new Int16Array(size));
    var best = 0;
    function dfs(depth, removed) {
      if (removed > best) best = removed;
      if (best === remain || depth === tapsLeft) return;
      var buf = bufs[depth];
      for (var i = 0; i < size && best < remain; i++) {
        if (!p[i]) continue;
        var c = fire(p, dirs, n, i, buf);
        dfs(depth + 1, removed + c);
        for (var j = 0; j < c; j++) p[buf[j]] = 1;
      }
    }
    dfs(0, 0);
    return { best: best, remain: remain, canClear: best === remain };
  }

  // ---------- 種ずらしと次善の盤（仕様書4.4・4.5） ----------
  // k = 0..MAX_K-1 を順に試し、条件を全部満たす最初の盤。なければ満たさない条件の数が最少、同じなら k が最小の盤
  // pair：Hard の特別タイルの組み合わせ（PAIRS の番号 0〜5）。省略時は pairFor で決める。k の探索のあいだは固定
  function pickBoard(modeKey, ver, purpose, dateKey, boardIndex, pair) {
    var cfg = C.MODES[modeKey];
    var gen = isGeneric(cfg);
    var maxK = cfg.maxK || C.MAX_K;
    var chosen = null;
    var opts = cfg.specials ? { pair: (pair >= 0 && pair < PAIRS.length) ? pair : pairFor(dateKey, boardIndex) } : undefined;
    for (var k = 0; k < maxK; k++) {
      var board = gen ? buildForKG(cfg, ver, purpose, dateKey, boardIndex, k, opts) : buildForK(cfg, ver, purpose, dateKey, boardIndex, k);
      if (!board) continue;
      var ev = gen ? evaluateG(board, cfg) : evaluate(board, cfg);
      if (!chosen || ev.fails < chosen.ev.fails) {
        board.mode = modeKey; board.k = k; board.kind = 'std'; board.ev = ev; board.variant = cfg.variant || null;
        chosen = board;
      }
      if (ev.fails === 0) break;
    }
    // どの k でも完全クリアの盤が作れなかった（仕様書4.5）：同じ形・特別タイルなしで作り直す → それもだめなら Normal の盤
    if (!chosen && cfg.specials) {
      var pb = buildForKG(cfg, ver, purpose, dateKey, boardIndex, 0, { plain: true });
      if (pb) { pb.mode = modeKey; pb.k = 0; pb.kind = 'plain'; pb.ev = evaluateG(pb, cfg, true); chosen = pb; }
    }
    if (!chosen && modeKey === 'hard') {
      var nb = pickBoard('normal', ver, purpose, dateKey, boardIndex);
      if (nb) { nb.kind = 'normal'; return nb; }
    }
    if (chosen) {
      if (opts) chosen.pair = opts.pair;
      chosen.passed = (chosen.ev.fails === 0);
      // 4か1で落ちた次善の盤は、当たりの1手目を出すために最後まで数える（選び方は変えない）
      if (chosen.ev.partial) { var full = evaluateG(chosen, cfg, true); full.fails = chosen.ev.fails; chosen.ev = full; }
      chosen.total = totalLayers(chosen);
    }
    return chosen;
  }

  // 1つの k の中で、完全クリアの盤ができるまで最大 MAX_BUILD 回作り直す
  function buildForK(cfg, ver, purpose, dateKey, boardIndex, k) {
    var rng = makeRng(hashStr(seedString(ver, purpose, dateKey, boardIndex, k)));
    for (var a = 0; a < C.MAX_BUILD; a++) {
      var b = buildOnce(cfg, rng);
      if (b) return b;
    }
    return null;
  }

  // ======================================================================
  // 段階2・3：Hard（盤の形・特別タイル）と Professional（1手ごとに全部回る）
  // ======================================================================
  // マスの種類：0=穴 1=普通 2=十字 3=壁 4=2枚重ね 5=回転
  var K_HOLE = 0, K_NORMAL = 1, K_CROSS = 2, K_WALL = 3, K_DOUBLE = 4, K_ROTOR = 5;
  var SPECIAL_KINDS = { cross: K_CROSS, wall: K_WALL, double: K_DOUBLE, rotor: K_ROTOR };
  var SPECIAL_NAMES = ['cross', 'wall', 'double', 'rotor'];
  // 4種から2種の組み合わせ（6通り）
  var PAIRS = [['cross', 'wall'], ['cross', 'double'], ['cross', 'rotor'], ['wall', 'double'], ['wall', 'rotor'], ['double', 'rotor']];

  // 盤の形（仕様書3.4。7×7、穴にするマス [行,列]）
  function rectCells(r0, r1, c0, c1) {
    var a = [];
    for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) a.push([r, c]);
    return a;
  }
  var SHAPES = [
    { id: 'full', holes: [] },
    { id: 'corners', holes: [[0, 0], [0, 6], [6, 0], [6, 6]] },
    { id: 'center', holes: rectCells(2, 4, 2, 4) },
    { id: 'ell', holes: rectCells(0, 2, 4, 6) },
    { id: 'notch', holes: rectCells(0, 2, 2, 4) },
    { id: 'plus', holes: rectCells(0, 1, 0, 1).concat(rectCells(0, 1, 5, 6), rectCells(5, 6, 0, 1), rectCells(5, 6, 5, 6)) },
    { id: 'dots', holes: [[1, 1], [1, 5], [5, 1], [5, 5], [3, 3]] }
  ];
  // 向き o（0〜7）：o&4 なら左右反転、そのあと o&3 回だけ時計回りに90度
  function orientCell(r, c, o, n) {
    if (o & 4) c = n - 1 - c;
    for (var i = 0; i < (o & 3); i++) { var t = r; r = c; c = n - 1 - t; }
    return r * n + c;
  }
  function shapeKinds(n, shape, orient) {
    var kinds = new Uint8Array(n * n);
    for (var i = 0; i < kinds.length; i++) kinds[i] = K_NORMAL;
    SHAPES[shape].holes.forEach(function (h) { kinds[orientCell(h[0], h[1], orient, n)] = K_HOLE; });
    return kinds;
  }

  // 層の数（消すべき枚数）：普通・十字・回転は1、2枚重ねは2、壁と穴は0
  function layersOf(k) { return k === K_DOUBLE ? 2 : (k === K_HOLE || k === K_WALL ? 0 : 1); }
  var plainKindsCache = {};
  function kindsOf(board) {
    if (board.kinds) return board.kinds;
    var size = board.n * board.n;
    if (!plainKindsCache[size]) {
      var a = new Uint8Array(size);
      for (var i = 0; i < size; i++) a[i] = K_NORMAL;
      plainKindsCache[size] = a;
    }
    return plainKindsCache[size];
  }
  function totalLayers(board) {
    var kinds = kindsOf(board), t = 0;
    for (var i = 0; i < kinds.length; i++) t += layersOf(kinds[i]);
    return t;
  }

  // 盤の状態：lay＝残りの層（壁は1のまま消えない、穴は0）、dir＝いま上にある矢印の向き（未定は -1）、low＝2枚重ねの下の向き
  function newState(board) {
    var n = board.n, size = n * n, kinds = kindsOf(board);
    var st = { n: n, size: size, kinds: kinds, lay: new Uint8Array(size), dir: new Int8Array(size),
      low: board.dirs2 || null, hits: null, total: 0 };
    for (var i = 0; i < size; i++) {
      var k = kinds[i];
      st.lay[i] = k === K_HOLE ? 0 : (k === K_DOUBLE ? 2 : 1);
      st.dir[i] = board.dirs[i];
      st.total += layersOf(k);
    }
    return st;
  }
  function copyState(st) {
    return { n: st.n, size: st.size, kinds: st.kinds, lay: new Uint8Array(st.lay), dir: new Int8Array(st.dir),
      low: st.low, hits: null, total: st.total };
  }
  // タップできる：穴・空き・壁を除く、まだあるタイル
  function tappable(st, i) {
    var k = st.kinds[i];
    return k !== K_HOLE && k !== K_WALL && st.lay[i] > 0;
  }
  function countTappable(st) {
    var c = 0;
    for (var i = 0; i < st.size; i++) if (tappable(st, i)) c++;
    return c;
  }
  function remainingLayers(st) {
    var c = 0;
    for (var i = 0; i < st.size; i++) if (st.kinds[i] !== K_WALL) c += st.lay[i];
    return c;
  }
  // Professional：残りの矢印を全部時計回りに90度（向き未定のタイルはそのまま）
  function rotateAll(st) {
    for (var i = 0; i < st.size; i++) if (st.lay[i] > 0 && st.dir[i] >= 0) st.dir[i] = (st.dir[i] + 1) & 3;
  }

  // ---------- 時刻を進める連鎖エンジン（仕様書3.6。玉が複数になる十字・同時に当たる場合を含む） ----------
  var MAXB = 1024;
  var BA_P = new Int16Array(MAXB), BA_D = new Int8Array(MAXB), BA_R = new Int32Array(MAXB);
  var BB_P = new Int16Array(MAXB), BB_D = new Int8Array(MAXB), BB_R = new Int32Array(MAXB);
  var NX_P = BB_P, NX_D = BB_D, NX_R = BB_R, nxCount = 0;
  var HIT = new Int16Array(256), ROT = new Int16Array(256);
  var MARK = new Int32Array(256), markStamp = 0;
  var REC = null;

  function spawn(i, d, t) {
    NX_P[nxCount] = i; NX_D[nxCount] = d;
    if (REC) { NX_R[nxCount] = REC.balls.length; REC.balls.push({ from: i, d: d, t0: t, t1: -1, end: -1 }); }
    nxCount++;
  }
  // 1層を弾けさせ、撃つ向きに玉を置く（gen があれば向き未定のタイルの向きをここで決める）
  function popLayer(st, i, t, gen) {
    var k = st.kinds[i];
    if (k === K_CROSS) {
      st.lay[i] = 0;
      if (REC) REC.pops.push({ t: t, i: i, k: k, d: -1, top: false });
      spawn(i, 0, t); spawn(i, 1, t); spawn(i, 2, t); spawn(i, 3, t);
      return;
    }
    var d = st.dir[i];
    if (d < 0) d = gen.decide(st, i);
    var top = (k === K_DOUBLE && st.lay[i] === 2);
    if (REC) REC.pops.push({ t: t, i: i, k: k, d: d, top: top });
    if (top) { st.lay[i] = 1; st.dir[i] = st.low ? st.low[i] : -1; } else st.lay[i] = 0;
    spawn(i, d, t);
  }

  // 1回のタップ。弾けた層の数を返す（上限の時刻を超えたら -1）。rec を渡すと演出用の記録を入れる
  // 注意：玉の置き場など共有のバッファを使うので、fireG の途中で別の fireG を呼ばない（入れ子・同時に使わない）
  function fireG(st, start, rec, gen) {
    var n = st.n, kinds = st.kinds, lay = st.lay;
    var curP = BA_P, curD = BA_D, curR = BA_R;
    NX_P = BB_P; NX_D = BB_D; NX_R = BB_R; nxCount = 0;
    REC = rec || null;
    popLayer(st, start, 0, gen);
    var cnt = 1, t = 0, limit = 7 * (st.total + 1);
    var nb = nxCount;
    // 次の玉の置き場と入れ替える
    var tp = curP, td = curD, tr = curR;
    curP = NX_P; curD = NX_D; curR = NX_R; NX_P = tp; NX_D = td; NX_R = tr;
    while (nb > 0) {
      t++;
      if (t > limit) { REC = null; return -1; }
      // 「この時刻に当たった」の印。MARK は32bit整数なので、上限に来たら印を全部消して1から数え直す
      if (++markStamp >= 0x7fffffff) { MARK.fill(0); markStamp = 1; }
      var nh = 0, nr = 0;
      nxCount = 0;
      for (var b = 0; b < nb; b++) {
        var p = curP[b], d = curD[b];
        var r = ((p / n) | 0) + DR[d], c = (p % n) + DC[d];
        if (r < 0 || r >= n || c < 0 || c >= n) { if (REC) endBall(curR[b], t, -1); continue; }
        var q = r * n + c, k = kinds[q];
        if (k === K_HOLE || lay[q] === 0) { // 穴・空いたマスは通り抜ける
          NX_P[nxCount] = q; NX_D[nxCount] = d; NX_R[nxCount] = curR[b]; nxCount++;
          continue;
        }
        if (REC) endBall(curR[b], t, q);
        if (k === K_WALL) continue;               // 壁：止まる
        if (MARK[q] === markStamp) continue;     // 同じ時刻に2つ以上当たっても1回
        MARK[q] = markStamp;
        if (k === K_ROTOR) ROT[nr++] = q; else HIT[nh++] = q;
      }
      // 当たったタイルをマス番号の小さい順に1回ずつ弾けさせる（新しい玉は次の時刻から進む）
      for (var x = 1; x < nh; x++) {
        var v = HIT[x], y = x - 1;
        while (y >= 0 && HIT[y] > v) { HIT[y + 1] = HIT[y]; y--; }
        HIT[y + 1] = v;
      }
      for (var h = 0; h < nh; h++) { popLayer(st, HIT[h], t, gen); cnt++; }
      // 当たった回転タイルは90度だけ回る（玉は止まる）
      for (var g = 0; g < nr; g++) {
        var q2 = ROT[g];
        if (st.hits) st.hits[q2]++;
        if (st.dir[q2] >= 0) st.dir[q2] = (st.dir[q2] + 1) & 3;
        if (REC) REC.rots.push({ t: t, i: q2 });
      }
      nb = nxCount;
      tp = curP; td = curD; tr = curR;
      curP = NX_P; curD = NX_D; curR = NX_R; NX_P = tp; NX_D = td; NX_R = tr;
    }
    if (REC) REC.tEnd = t;
    REC = null;
    return cnt;
  }
  function endBall(id, t, end) { var bl = REC.balls[id]; bl.t1 = t; bl.end = end; }

  // 押した後の盤（演出と記録）：状態を進め、Professional なら最後の手でなければ全部回す
  function tapState(st, cfg, idx, tapIndex, rec) {
    var c = fireG(st, idx, rec, null);
    if (cfg.rotateEach && tapIndex < cfg.taps - 1) rotateAll(st);
    return c;
  }

  // ---------- 盤づくり（仕様書4.2の一般化） ----------
  function makeDecider(cfg, board, rng) {
    var cd = [0, 0, 0, 0], ex = [0, 0, 0, 0];
    var gen = {
      last: false, t: 0,
      decide: function (st, i) {
        var n = st.n, nc = 0, ne = 0;
        for (var d = 0; d < 4; d++) {
          // その向きに進んで最初にある、穴でも空きでもないマス
          var r = (i / n) | 0, c = i % n, kind = -1;
          for (;;) {
            r += DR[d]; c += DC[d];
            if (r < 0 || r >= n || c < 0 || c >= n) break;
            var q = r * n + c;
            if (st.kinds[q] !== K_HOLE && st.lay[q] > 0) { kind = st.kinds[q]; break; }
          }
          // 盤の外・壁・回転（玉を止める）＝止まる向き。普通・十字・2枚重ね＝続く向き
          if (kind === -1 || kind === K_WALL || kind === K_ROTOR) ex[ne++] = d; else cd[nc++] = d;
        }
        var stop = (nc === 0);
        if (!stop && ne > 0 && !gen.last) stop = rng.permille(cfg.stopPermille);
        var dd = stop ? ex[rng.int(ne)] : cd[rng.int(nc)];
        var k = st.kinds[i];
        if (k === K_DOUBLE && st.lay[i] === 1) board.dirs2[i] = dd;
        else if (k === K_ROTOR) board.dirs[i] = (dd - st.hits[i] + 64) & 3;      // 最初の向き＝その向き−当たった回数
        else if (cfg.rotateEach) board.dirs[i] = (dd - gen.t + 64) & 3;          // 最初の向き＝その向き−回った回数
        else board.dirs[i] = dd;
        return dd;
      }
    };
    return gen;
  }

  // 1回作ってみる（Hard・Professional）。失敗なら null。opts.plain：特別タイルなし（同じ形で作り直す）
  function buildOnceG(cfg, rng, opts) {
    var n = cfg.n, size = n * n;
    var shape = -1, orient = 0, specials = [];
    var kinds;
    if (cfg.shapes) {
      shape = rng.int(SHAPES.length);
      orient = rng.int(8);
      kinds = shapeKinds(n, shape, orient);
    } else {
      kinds = new Uint8Array(size);
      for (var i0 = 0; i0 < size; i0++) kinds[i0] = K_NORMAL;
    }
    if (cfg.specials && !(opts && opts.plain)) {
      // 組み合わせ：opts.pair（0〜5）で決まっていればそれ（今日の Hard・自由練習は k の探索の外で決める）。なければ乱数
      var pi = (opts && opts.pair >= 0 && opts.pair < PAIRS.length) ? opts.pair : rng.int(PAIRS.length);
      specials = PAIRS[pi].slice();
      specials.forEach(function (name) {
        var range = cfg.specials[name];
        var cnt = range[0] + rng.int(range[1] - range[0] + 1);
        for (var c = 0; c < cnt; c++) {
          var free = 0;
          for (var j = 0; j < size; j++) if (kinds[j] === K_NORMAL) free++;
          if (free === 0) break;
          var pick = rng.int(free);
          for (var j2 = 0; j2 < size; j2++) {
            if (kinds[j2] !== K_NORMAL) continue;
            if (pick === 0) { kinds[j2] = SPECIAL_KINDS[name]; break; }
            pick--;
          }
        }
      });
    }
    var board = { mode: cfg.key, n: n, kinds: kinds, dirs: new Int8Array(size), dirs2: new Int8Array(size),
      solution: [], shape: shape, orient: orient, specials: specials };
    for (var i = 0; i < size; i++) { board.dirs[i] = -1; board.dirs2[i] = -1; }
    var st = newState(board);
    st.hits = new Uint8Array(size);
    var gen = makeDecider(cfg, board, rng);
    var removed = 0, total = st.total;
    var cand = new Int16Array(size), rot = new Int16Array(size);
    for (var t = 0; t < cfg.taps; t++) {
      if (removed === total) return null; // 手数より早く全部消える盤は作らない
      var nc = 0, nr = 0;
      for (var q = 0; q < size; q++) {
        if (!tappable(st, q)) continue;
        cand[nc++] = q;
        if (kinds[q] === K_ROTOR) rot[nr++] = q;
      }
      var left = cfg.taps - t, start;
      // 回転は押さないと消えない：残りの回転の数 ≥ 残りの手数なら回転から。それ以外は回転を50%で優先
      if (nr > 0 && (nr >= left || rng.permille(500))) start = rot[rng.int(nr)];
      else start = cand[rng.int(nc)];
      board.solution.push(start);
      gen.last = (t === cfg.taps - 1);
      gen.t = t;
      var c2 = fireG(st, start, null, gen);
      if (c2 < 0) return null; // 上限で打ち切り（起きない想定）。その盤は捨てる
      removed += c2;
      if (cfg.rotateEach && t < cfg.taps - 1) rotateAll(st);
    }
    if (removed !== total) return null; // 未定のタイル（弾けていない層・押されていない回転）が残った
    board.total = total;
    if (!checkSolutionG(board, cfg)) return null;
    return board;
  }

  // 決まった向きだけで最初から本番のルールで動かし、その手順で全部消えるか（途中で全部消えない・打ち切りなし）
  function checkSolutionG(board, cfg) {
    var size = board.n * board.n, kinds = kindsOf(board);
    for (var i = 0; i < size; i++) {
      var k = kinds[i];
      if ((k === K_NORMAL || k === K_DOUBLE || k === K_ROTOR) && !(board.dirs[i] >= 0 && board.dirs[i] <= 3)) return false;
      if (k === K_DOUBLE && !(board.dirs2 && board.dirs2[i] >= 0 && board.dirs2[i] <= 3)) return false;
    }
    var st = newState(board), removed = 0;
    for (var s = 0; s < board.solution.length; s++) {
      var idx = board.solution[s];
      if (removed === st.total || !tappable(st, idx)) return false;
      var c = tapState(st, cfg, idx, s, null);
      if (c < 0) return false;
      removed += c;
    }
    return removed === st.total;
  }

  // ---------- 品質の条件（Hard・Professional。数え方は4.3と同じ） ----------
  // cfg.staged（Hard）：4（深さ1）→1（深さ2）→2・3（深さ3）の順に調べ、4か1で落ちた盤は2・3を調べず不合格（2・3も満たさないと数える）
  function evaluateG(board, cfg, forceFull) {
    var st = newState(board), size = st.size, total = st.total, taps = cfg.taps;
    var snapL = [], snapD = [];
    for (var b = 0; b <= taps; b++) { snapL.push(new Uint8Array(size)); snapD.push(new Int8Array(size)); }
    function save(dp) { snapL[dp].set(st.lay); snapD[dp].set(st.dir); }
    function restore(dp) { st.lay.set(snapL[dp]); st.dir.set(snapD[dp]); }
    function play(i, depth) {
      var c = fireG(st, i, null, null);
      if (c < 0) throw new Error('chain limit');
      if (cfg.rotateEach && depth < taps - 1) rotateAll(st);
      return c;
    }

    if (cfg.staged && !forceFull) {
      // 深さ1：1手目の最大（条件4）と、1回で全部消えるか
      var fm = 0, clearIn = Infinity;
      save(0);
      for (var i = 0; i < size; i++) {
        if (!tappable(st, i)) continue;
        var c1 = play(i, 0);
        if (c1 > fm) fm = c1;
        if (c1 === total) clearIn = 1;
        restore(0);
      }
      var c4 = fm * 100 >= total * cfg.bigPct;
      // 深さ2：2回以下で全部消えるか（条件1）
      if (c4 && clearIn > cfg.noClearMaxTaps && cfg.noClearMaxTaps >= 2) {
        outer:
        for (var a = 0; a < size; a++) {
          if (!tappable(st, a)) continue;
          var ca = play(a, 0);
          if (ca < total) {
            save(1);
            for (var a2 = 0; a2 < size; a2++) {
              if (!tappable(st, a2)) continue;
              var cb = play(a2, 1);
              restore(1);
              if (ca + cb === total) { clearIn = 2; restore(0); break outer; }
            }
          }
          restore(0);
        }
      }
      var c1ok = clearIn > cfg.noClearMaxTaps;
      if (!c4 || !c1ok) {
        return { total: total, pClear: NaN, expRemoved: NaN, minClear: clearIn, firstMax: fm, best: 0, starts: 0,
          cond: [c1ok, false, false, c4], fails: (c1ok ? 0 : 1) + (c4 ? 0 : 1) + 2, partial: true };
      }
    }

    var pClear = 0, expRemoved = 0, minClear = Infinity, firstMax = 0, best = 0, starts = 0, foundClear = false;
    function dfs(depth, removed, w) {
      if (removed === total || depth === taps) {
        expRemoved += w * removed;
        if (removed > best) best = removed;
        if (removed === total) { pClear += w; foundClear = true; if (depth < minClear) minClear = depth; }
        return;
      }
      var cw = w / countTappable(st);
      save(depth);
      for (var i2 = 0; i2 < size; i2++) {
        if (!tappable(st, i2)) continue;
        var c = play(i2, depth);
        if (depth === 0) { if (c > firstMax) firstMax = c; foundClear = false; }
        dfs(depth + 1, removed + c, cw);
        if (depth === 0 && foundClear) starts++;
        restore(depth);
      }
    }
    dfs(0, 0, 1);
    var cond = [
      minClear > cfg.noClearMaxTaps,
      pClear * 1000 <= cfg.clearPermille,
      expRemoved * 100 <= total * cfg.avgPct,
      firstMax * 100 >= total * cfg.bigPct
    ];
    if (cfg.minStarts) cond.push(starts >= cfg.minStarts); // 5. 当たりの1手目が◯か所以上（Pro の試し 案C）
    var fails = 0;
    for (var q = 0; q < cond.length; q++) if (!cond[q]) fails++;
    return { total: total, pClear: pClear, expRemoved: expRemoved, minClear: minClear, firstMax: firstMax,
      best: best, starts: starts, cond: cond, fails: fails, partial: false };
  }

  // いまの状態から残り tapsLeft 回でいくつ消せるか（最大）。全部消せたら打ち切る（ヒント）
  function bestReachableG(st0, cfg, tapsLeft) {
    var st = copyState(st0), size = st.size;
    var remain = remainingLayers(st);
    if (remain === 0 || tapsLeft <= 0) return { best: 0, remain: remain, canClear: remain === 0 };
    var snapL = [], snapD = [];
    for (var b = 0; b < tapsLeft; b++) { snapL.push(new Uint8Array(size)); snapD.push(new Int8Array(size)); }
    var best = 0;
    function dfs(depth, removed) {
      if (removed > best) best = removed;
      if (best === remain || depth === tapsLeft) return;
      snapL[depth].set(st.lay); snapD[depth].set(st.dir);
      for (var i = 0; i < size && best < remain; i++) {
        if (!tappable(st, i)) continue;
        var c = fireG(st, i, null, null);
        if (cfg.rotateEach && depth < tapsLeft - 1) rotateAll(st);
        dfs(depth + 1, removed + c);
        st.lay.set(snapL[depth]); st.dir.set(snapD[depth]);
      }
    }
    dfs(0, 0);
    return { best: best, remain: remain, canClear: best === remain };
  }

  // 1つの k の中で、完全クリアの盤ができるまで最大 MAX_BUILD 回作り直す（Hard・Professional）
  function buildForKG(cfg, ver, purpose, dateKey, boardIndex, k, opts) {
    var rng = makeRng(hashStr(seedString(ver, purpose, dateKey, boardIndex, k)));
    for (var a = 0; a < C.MAX_BUILD; a++) {
      var b = buildOnceG(cfg, rng, opts);
      if (b) return b;
    }
    return null;
  }

  function isGeneric(cfg) { return !!(cfg.shapes || cfg.specials || cfg.rotateEach); }

  // 押した手順を最初から再現する（全モード共通。押せない手が出たらそこで止める）
  function replayBoard(board, taps) {
    var cfg = C.MODES[board.mode];
    var st = newState(board);
    var removed = 0, maxChain = 0, used = [];
    for (var i = 0; i < taps.length && i < cfg.taps; i++) {
      var t = taps[i];
      if (!(t >= 0 && t < st.size) || !tappable(st, t) || removed === st.total) break;
      var c = tapState(st, cfg, t, i, null);
      if (c < 0) break;
      removed += c;
      if (c > maxChain) maxChain = c;
      used.push(t);
    }
    return { st: st, removed: removed, maxChain: maxChain, taps: used, total: st.total };
  }

  // 1手のあとのヒント（全モード共通）：残りの手数でまだ全部消せるか／最高いくつか
  function hintAfter(board, st, tapsLeft) {
    var cfg = C.MODES[board.mode];
    if (!isGeneric(cfg)) {
      var present = new Uint8Array(st.size);
      for (var i = 0; i < st.size; i++) present[i] = st.lay[i] > 0 ? 1 : 0;
      return bestReachable(present, board.dirs, board.n, tapsLeft);
    }
    return bestReachableG(st, cfg, tapsLeft);
  }

  // 盤を保存・受け渡しできる形にする（作り置き・Worker）
  function dirStr(a) {
    var s = '';
    for (var i = 0; i < a.length; i++) s += a[i] < 0 ? '-' : String(a[i]);
    return s;
  }
  function packBoard(b) {
    return {
      mode: b.mode, k: b.k, kind: b.kind, n: b.n,
      kinds: b.kinds ? Array.prototype.join.call(b.kinds, '') : null,
      dirs: dirStr(b.dirs), dirs2: b.dirs2 ? dirStr(b.dirs2) : null,
      solution: b.solution.slice(), starts: b.ev.starts, passed: !!b.passed,
      shape: typeof b.shape === 'number' ? b.shape : -1, orient: b.orient || 0, specials: (b.specials || []).slice(),
      variant: b.variant || null
    };
  }
  function isInt(v, lo, hi) { return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi; }
  function parseDirs(s, size, allowNone) {
    if (typeof s !== 'string' || s.length !== size || !(allowNone ? /^[0-3-]+$/ : /^[0-3]+$/).test(s)) return null;
    var a = new Int8Array(size);
    for (var i = 0; i < size; i++) a[i] = s[i] === '-' ? -1 : s.charCodeAt(i) - 48;
    return a;
  }
  // 検査して盤に戻す。おかしければ null
  function unpackBoard(e) {
    if (!e || typeof e !== 'object') return null;
    var cfg = C.MODES[e.mode];
    if (!cfg || e.n !== cfg.n || !isInt(e.k, 0, 999) || ['std', 'plain', 'normal'].indexOf(e.kind) < 0) return null;
    // Pro の試し：いま選んでいる案と違う案の盤は使わない（手数や条件が違う）
    if ((cfg.variant || null) !== (e.variant || null)) return null;
    var size = cfg.n * cfg.n;
    var b = { mode: e.mode, k: e.k, kind: e.kind, n: cfg.n, passed: !!e.passed, variant: e.variant || null,
      shape: isInt(e.shape, -1, SHAPES.length - 1) ? e.shape : -1, orient: isInt(e.orient, 0, 7) ? e.orient : 0, specials: [] };
    if (e.kinds !== null && e.kinds !== undefined) {
      if (typeof e.kinds !== 'string' || e.kinds.length !== size || !/^[0-5]+$/.test(e.kinds)) return null;
      b.kinds = new Uint8Array(size);
      for (var i = 0; i < size; i++) b.kinds[i] = e.kinds.charCodeAt(i) - 48;
    }
    b.dirs = parseDirs(e.dirs, size, !!b.kinds || !!cfg.rotateEach);
    if (!b.dirs) return null;
    if (e.dirs2 !== null && e.dirs2 !== undefined) { b.dirs2 = parseDirs(e.dirs2, size, true); if (!b.dirs2) return null; }
    if (Array.isArray(e.specials) && e.specials.length <= 2 && e.specials.every(function (s) { return SPECIAL_NAMES.indexOf(s) >= 0; })) b.specials = e.specials.slice();
    if (!Array.isArray(e.solution) || e.solution.length !== cfg.taps || !e.solution.every(function (t) { return isInt(t, 0, size - 1); })) return null;
    b.solution = e.solution.slice();
    b.total = totalLayers(b);
    if (!isInt(e.starts, 0, size)) return null;
    b.ev = { starts: e.starts, total: b.total };
    var ok = isGeneric(cfg) ? checkSolutionG(b, cfg) : checkSolution(b);
    return ok ? b : null;
  }

  // ---------- 今日の Hard・今日の Professional・表（daily-k.json・free-k.json） ----------
  // Hard の特別タイルの組み合わせ（PAIRS の番号 0〜5）を k の探索の外で決める（決定 2026-10-18：偏りをなくす）。
  // 日付なら 2000-01-01 からの日数を6で割った余り（DAY1 を公開日に変えても盤が変わらないよう、DAY1 は使わない。
  // 負の日数でも 0〜5 になる計算）。日付でなければ（自由練習）盤番号を6で割った余り
  var PAIR_EPOCH = Date.UTC(2000, 0, 1);
  function pairFor(dateKey, boardIndex) {
    if (isDateStr(dateKey)) {
      var days = Math.round((dateToUTC(dateKey) - PAIR_EPOCH) / 86400000);
      return ((days % PAIRS.length) + PAIRS.length) % PAIRS.length;
    }
    var i = boardIndex | 0;
    return ((i % PAIRS.length) + PAIRS.length) % PAIRS.length;
  }

  // 自由練習の Hard の組み合わせの順番（表・Worker・本体のどれで作っても同じ決まり）：
  // prevPair＝いま遊んでいる（最後に始めた）盤の組み合わせ（開き直しても続くよう pon.v1 の freeHardPair に保存）。
  // まだ1盤も始めていなければ played（自由練習の Hard を遊び終えた数。仕様8.3）を6で割った余りから始める。
  // そのあとは1つずつ進むので、続く6盤は必ず6通り
  function nextFreePair(prevPair, played) {
    var n = PAIRS.length;
    if (Number.isInteger(prevPair) && prevPair >= 0 && prevPair < n) return (prevPair + 1) % n;
    return (((played | 0) % n) + n) % n;
  }
  // ---------- 自由練習の Hard の「次の2盤」の待ち行列の決まり（DOM・Worker を使わない純粋な関数。game.js が使う） ----------
  // 箱 { pair, board, pending }：pending＝Worker が作っている途中、board＝作り終えた盤（null なら作れなかった）
  // 使える箱＝作っている途中か、盤がある箱。「作り終えたが盤なし」（Worker が null を返した・落ちた）は無いものとして外す
  function usableBox(q) { return !!q && (q.pending || !!q.board); }
  // いま欲しい2つ（次の盤とその次）の組み合わせ
  function wantedPairs(lastPair, played) {
    var p0 = nextFreePair(lastPair, played);
    return [p0, (p0 + 1) % PAIRS.length];
  }
  // 待ち行列を整理する：残す箱（欲しい組み合わせで使える箱）と、Worker に新しく頼む組み合わせ（Worker が使えなければ頼まない）
  function planHardQueue(queue, lastPair, played, workerOk) {
    var want = wantedPairs(lastPair, played);
    var keep = (queue || []).filter(function (q) { return usableBox(q) && want.indexOf(q.pair) >= 0; });
    var request = workerOk ? want.filter(function (p) { return !keep.some(function (q) { return q.pair === p; }); }) : [];
    return { keep: keep, request: request };
  }
  // Hard を始めるときにどの盤を使うか：
  // 'queue'＝作り終えた盤 ／ 'table'＝1盤目で表がある ／ 'wait'＝Worker が作っている途中の盤を待つ ／ 'main'＝本体で作る
  function decideHardStart(queue, lastPair, played, fromTitle, hasTable, workerOk) {
    var pair = nextFreePair(lastPair, played);
    var q = null;
    (queue || []).forEach(function (x) { if (x.pair === pair && usableBox(x)) q = x; });
    if (q && q.board) return { act: 'queue', pair: pair, box: q };
    if (fromTitle && hasTable) return { act: 'table', pair: pair };
    if (q && q.pending && workerOk) return { act: 'wait', pair: pair, box: q };
    return { act: 'main', pair: pair };
  }

  // free-k.json（30盤）のうち、使う盤の番号：played を30で割った余りに近い、組み合わせが pair の盤（i を6で割った余り＝pair）
  function freeTableIndex(played, pair) {
    var base = (((played | 0) % 30) + 30) % 30;
    return base - (base % PAIRS.length) + pair;
  }

  // 表の {k, kind, starts, pair} から盤を1回だけ作る（総当たりはしない）。
  // 表の pair が日付・盤番号から決まる組み合わせ（pairFor）と違えば、古い表か書き換えられた表なので使わない（null。呼び出し側が作り直す）
  function boardFromEntry(modeKey, ver, purpose, dateKey, boardIndex, entry) {
    var cfg = C.MODES[modeKey], b = null;
    var pair = pairFor(dateKey, boardIndex);
    if (entry.kind === 'std' && entry.pair !== undefined && entry.pair !== pair) return null;
    if (entry.kind === 'std') { b = buildForKG(cfg, ver, purpose, dateKey, boardIndex, entry.k, { pair: pair }); if (b) b.pair = pair; }
    else if (entry.kind === 'plain') b = buildForKG(cfg, ver, purpose, dateKey, boardIndex, entry.k, { plain: true });
    else if (entry.kind === 'normal') { b = buildForK(C.MODES.normal, ver, purpose, dateKey, boardIndex, entry.k); if (b) b.mode = 'normal'; }
    if (!b) return null;
    b.mode = b.mode || modeKey;
    b.k = entry.k; b.kind = entry.kind;
    b.total = totalLayers(b);
    b.ev = { starts: entry.starts, total: b.total };
    b.passed = null; // 表から作った盤は合否を計算しない
    return b;
  }
  function tableEntry(table, dateKey) {
    if (!table || !Array.isArray(table.days)) return null;
    for (var i = 0; i < table.days.length; i++) if (table.days[i].date === dateKey) return table.days[i];
    return null;
  }
  // 今日の Hard（表にあれば表から、なければ作る）
  function dailyHard(dateStr, table) {
    var ver = versionFor(dateStr);
    var e = table && table.ver === ver ? tableEntry(table, dateStr) : null;
    if (e) { var b = boardFromEntry('hard', ver, 'dailyHard', dateStr, 0, e); if (b) return b; }
    return pickBoard('hard', ver, 'dailyHard', dateStr, 0);
  }
  function dailyPro(dateStr) {
    return pickBoard('pro', versionFor(dateStr), 'dailyPro', dateStr, 0);
  }
  // 自由練習の Hard の1盤目（free-k.json の i 番目）
  function freeTableBoard(table, i) {
    var ver = versionFor(null);
    if (!table || table.ver !== ver || !Array.isArray(table.boards)) return null;
    var e = table.boards[i % table.boards.length];
    if (!e || e.i !== i % table.boards.length) return null;
    return boardFromEntry('hard', ver, 'free', 'hard', e.i, e);
  }

  // 今日の3盤
  function dailyBoards(dateStr) {
    var ver = versionFor(dateStr);
    var list = [];
    for (var i = 0; i < C.DAILY_MODES.length; i++) {
      list.push(pickBoard(C.DAILY_MODES[i], ver, 'daily', dateStr, i));
    }
    return list;
  }

  // 自由練習の盤（seedKey は「時刻＋回数」の文字列）。pair：Hard の組み合わせ（回数から決めて渡す。省略時は 0）
  function freeBoard(modeKey, seedKey, pair) {
    return pickBoard(modeKey, versionFor(null), 'free', modeKey + ':' + seedKey, 0, pair);
  }

  // 押した手順を最初から再現する（今日の盤の続きから）。押せない手が出たらそこで止める
  function replay(n, dirs, taps) {
    var size = n * n;
    var present = fullPresent(size);
    var out = new Int16Array(size);
    var removed = 0, maxChain = 0, used = [];
    for (var i = 0; i < taps.length; i++) {
      var t = taps[i];
      if (!(t >= 0 && t < size) || !present[t] || removed === size) break;
      var c = fire(present, dirs, n, t, out);
      removed += c;
      if (c > maxChain) maxChain = c;
      used.push(t);
    }
    return { present: present, removed: removed, maxChain: maxChain, taps: used };
  }

  // ---------- 日付（仕様書7.2：端末のその土地の日付） ----------
  function pad2(v) { return (v < 10 ? '0' : '') + v; }
  function localDateStr(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function isDateStr(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split('-');
    var t = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return t.getUTCFullYear() === +p[0] && t.getUTCMonth() === +p[1] - 1 && t.getUTCDate() === +p[2];
  }
  function dateToUTC(s) {
    var p = s.split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]);
  }
  function addDays(s, days) {
    var d = new Date(dateToUTC(s) + days * 86400000);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  // 通し番号：DAY1 を #1 とした日数（DAY1 より前は 0 以下）
  function dayNumber(s) {
    return Math.round((dateToUTC(s) - dateToUTC(C.DAY1)) / 86400000) + 1;
  }
  // 画面・シェア文に出す日の名札：#1 以上なら「#12」、DAY1 より前（#0 以下）なら日付「10/17」（負の # を出さない）
  function dayTag(s) {
    var n = dayNumber(s);
    if (n >= 1) return '#' + n;
    var p = s.split('-');
    return (+p[1]) + '/' + (+p[2]);
  }
  // その日付の生成の版（null なら今の版）
  function versionFor(s) {
    var ver = C.VERSIONS[0].ver;
    for (var i = 0; i < C.VERSIONS.length; i++) {
      if (s === null || C.VERSIONS[i].from <= s) ver = C.VERSIONS[i].ver;
    }
    return ver;
  }

  // 1盤の結果の見出し（完全クリア／8割以上はおしい／それ以外）
  function resultKind(removed, total) {
    if (removed === total) return 'full';
    if (removed * 10 >= total * 8) return 'close';
    return 'over';
  }

  // Pro の試し（config.js の PRO_TRIAL）：案 A／B／C を切り替える。MODES.pro を選んだ案の設定に差し替える
  // PRO_TRIAL が false（本番）なら、どの値でも MODES.pro（案 C）に戻して null を返す
  var BASE_PRO = C.MODES.pro;
  function setProVariant(v) {
    var all = C.PRO_VARIANTS || {};
    if (!C.PRO_TRIAL) { C.MODES.pro = BASE_PRO; return null; }
    if (!all[v]) v = 'A';
    C.MODES.pro = all[v];
    return v;
  }
  function proVariant() { return C.MODES.pro.variant || null; }

  // テスト用：同時に当たった印の番号を上限の近くに進める（数え直しが正しく働くかを確かめる）
  function _setMarkStamp(v) { MARK.fill(0); markStamp = v; }

  var L = {
    DR: DR, DC: DC, _setMarkStamp: _setMarkStamp,
    hashStr: hashStr, makeRng: makeRng, seedString: seedString,
    firstAlive: firstAlive, fire: fire, buildOnce: buildOnce, buildForK: buildForK,
    checkSolution: checkSolution, evaluate: evaluate, bestReachable: bestReachable,
    pickBoard: pickBoard, dailyBoards: dailyBoards, freeBoard: freeBoard, replay: replay,
    localDateStr: localDateStr, isDateStr: isDateStr, addDays: addDays, dayNumber: dayNumber, dayTag: dayTag,
    versionFor: versionFor, resultKind: resultKind,
    // 段階2・3
    K: { HOLE: K_HOLE, NORMAL: K_NORMAL, CROSS: K_CROSS, WALL: K_WALL, DOUBLE: K_DOUBLE, ROTOR: K_ROTOR },
    SPECIAL_NAMES: SPECIAL_NAMES, SPECIAL_KINDS: SPECIAL_KINDS, SHAPES: SHAPES, PAIRS: PAIRS,
    orientCell: orientCell, shapeKinds: shapeKinds, kindsOf: kindsOf, totalLayers: totalLayers,
    newState: newState, copyState: copyState, tappable: tappable, countTappable: countTappable,
    remainingLayers: remainingLayers, rotateAll: rotateAll, fireG: fireG, tapState: tapState,
    buildOnceG: buildOnceG, buildForKG: buildForKG, checkSolutionG: checkSolutionG, evaluateG: evaluateG,
    bestReachableG: bestReachableG, isGeneric: isGeneric, replayBoard: replayBoard, hintAfter: hintAfter,
    packBoard: packBoard, unpackBoard: unpackBoard, boardFromEntry: boardFromEntry, tableEntry: tableEntry,
    dailyHard: dailyHard, dailyPro: dailyPro, freeTableBoard: freeTableBoard, pairFor: pairFor, nextFreePair: nextFreePair, freeTableIndex: freeTableIndex,
    usableBox: usableBox, wantedPairs: wantedPairs, planHardQueue: planHardQueue, decideHardStart: decideHardStart,
    setProVariant: setProVariant, proVariant: proVariant
  };
  if (typeof module === 'object' && module.exports) module.exports = L;
  else root.PonLogic = L;
})(this);
