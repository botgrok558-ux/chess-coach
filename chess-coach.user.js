// ==UserScript==
// @name         Chess Coach Live (Deutsch)
// @namespace    https://github.com/botgrok558-ux/chess-coach
// @version      1.0.0
// @description  Live-Kommentar und Tipps für Chess.com auf Deutsch. Tipps NUR gegen den Computer, in der Analyse und beim Training (Fair Play). Gegen Menschen: Analyse erst nach der Partie.
// @author       Liburn
// @match        https://www.chess.com/*
// @match        https://chess.com/*
// @require      https://cdn.jsdelivr.net/npm/chess.js@0.10.3/chess.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      cdn.jsdelivr.net
// @connect      unpkg.com
// @run-at       document-idle
// @homepageURL  https://botgrok558-ux.github.io/chess-coach/
// @downloadURL  https://raw.githubusercontent.com/botgrok558-ux/chess-coach/main/chess-coach.user.js
// @updateURL    https://raw.githubusercontent.com/botgrok558-ux/chess-coach/main/chess-coach.user.js
// ==/UserScript==

/* global Chess, GM_xmlhttpRequest, GM_getValue, GM_setValue, module */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // CORE (pure logic, also used by the Node tests)
  // ---------------------------------------------------------------------------
  function makeCore(ChessCtor) {
    // FAIR PLAY: hard-coded whitelist. Engine help ONLY on these chess.com paths.
    // Everything else (live games, daily games, unknown pages) = no hints.
    var ASSIST_PATHS = Object.freeze([
      '/play/computer', '/game/computer', '/analysis', '/practice', '/puzzles', '/lessons'
    ]);
    var LOCKED_NOTE = 'Live gegen Menschen: Tipps aus (Fair Play). Analyse nach der Partie verfügbar.';

    function isChessComHost(host) {
      host = String(host || '').toLowerCase();
      return host === 'chess.com' || /\.chess\.com$/.test(host);
    }

    function isAssistAllowed(url) {
      var u;
      try { u = new URL(String(url)); } catch (e) { return false; }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
      if (!isChessComHost(u.hostname)) return false;
      var path = decodeURIComponent(u.pathname).toLowerCase().replace(/\/+/g, '/');
      if (path.indexOf('..') !== -1) return false;
      for (var i = 0; i < ASSIST_PATHS.length; i++) {
        var p = ASSIST_PATHS[i];
        if (path === p || path === p + '/' || path.indexOf(p + '/') === 0) return true;
      }
      return false;
    }

    var PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
    var NAME_NOM = { p: 'Der Bauer', n: 'Der Springer', b: 'Der Läufer', r: 'Der Turm', q: 'Die Dame', k: 'Der König' };
    var NAME_ACC = { p: 'den Bauern', n: 'den Springer', b: 'den Läufer', r: 'den Turm', q: 'die Dame', k: 'den König' };
    var NAME_PLAIN = { p: 'Bauer', n: 'Springer', b: 'Läufer', r: 'Turm', q: 'Dame', k: 'König' };
    var COLOR_NAME = { w: 'Weiß', b: 'Schwarz' };

    var CLASSES = {
      best: { key: 'best', label: 'Bester Zug', sym: '★', color: '#5fd068' },
      good: { key: 'good', label: 'Gut', sym: '✓', color: '#9bc75a' },
      inaccuracy: { key: 'inaccuracy', label: 'Ungenauigkeit', sym: '?!', color: '#f2c94c' },
      mistake: { key: 'mistake', label: 'Fehler', sym: '?', color: '#f29a4c' },
      blunder: { key: 'blunder', label: 'Patzer', sym: '??', color: '#eb5757' }
    };

    // engine score object {cp} or {mate} (white POV) -> centipawns (white POV)
    function scoreToCp(s) {
      if (!s) return 0;
      if (typeof s.mate === 'number') {
        if (s.mate === 0) return 0;
        return s.mate > 0 ? 10000 - s.mate * 10 : -10000 - s.mate * 10;
      }
      return typeof s.cp === 'number' ? s.cp : 0;
    }

    function winPct(cp) {
      cp = Math.max(-1000, Math.min(1000, cp));
      return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
    }

    // evalBefore/evalAfter: white POV centipawns. mover: 'w'|'b'
    function classifyMove(o) {
      var sign = o.mover === 'w' ? 1 : -1;
      var before = winPct(sign * o.evalBefore);
      var after = winPct(sign * o.evalAfter);
      var drop = Math.max(0, before - after);
      var c;
      if (o.bestUci && o.playedUci && o.bestUci === o.playedUci) c = CLASSES.best;
      else if (drop < 2) c = CLASSES.best;
      else if (drop < 6) c = CLASSES.good;
      else if (drop < 12) c = CLASSES.inaccuracy;
      else if (drop < 22) c = CLASSES.mistake;
      else c = CLASSES.blunder;
      return { key: c.key, label: c.label, sym: c.sym, color: c.color, drop: Math.round(drop * 10) / 10 };
    }

    function formatEval(s) {
      if (!s) return '0.0';
      if (typeof s.mate === 'number') return s.mate === 0 ? '#' : (s.mate > 0 ? '+' : '-') + 'M' + Math.abs(s.mate);
      var v = (s.cp || 0) / 100;
      return (v > 0 ? '+' : '') + v.toFixed(1);
    }

    function evalBarPct(s) { return winPct(scoreToCp(s)); } // % white

    var DE_LETTER = { K: 'K', Q: 'D', R: 'T', B: 'L', N: 'S' };
    function toGermanSan(san) {
      return String(san || '').replace(/[KQRBN]/g, function (ch) { return DE_LETTER[ch]; });
    }

    var SPEECH_PIECE = { K: 'König ', Q: 'Dame ', R: 'Turm ', B: 'Läufer ', N: 'Springer ' };
    function sanToSpeech(san) {
      san = String(san || '');
      if (/^O-O-O/.test(san)) return 'lange Rochade' + (san.indexOf('#') > -1 ? ', Matt' : san.indexOf('+') > -1 ? ', Schach' : '');
      if (/^O-O/.test(san)) return 'kurze Rochade' + (san.indexOf('#') > -1 ? ', Matt' : san.indexOf('+') > -1 ? ', Schach' : '');
      var out = san.replace(/=([QRBN])/, function (_, p) { return ' wird ' + SPEECH_PIECE[p].trim(); });
      out = out.replace(/^([KQRBN])/, function (_, p) { return SPEECH_PIECE[p]; });
      out = out.replace('x', ' schlägt ').replace('#', ', Matt').replace('+', ', Schach');
      return out.replace(/\s+/g, ' ').trim();
    }

    // ---------- board helpers ----------
    var FILES = 'abcdefgh';
    function sqToXY(sq) { return [FILES.indexOf(sq[0]), parseInt(sq[1], 10) - 1]; }
    function xyToSq(x, y) { return FILES[x] + (y + 1); }
    // grid[y][x] from chess.js board() (board()[0] is rank 8)
    function gridFromGame(game) {
      var b = game.board(), g = [];
      for (var y = 0; y < 8; y++) { g[y] = []; for (var x = 0; x < 8; x++) g[y][x] = b[7 - y][x]; }
      return g;
    }

    // all pieces of `color` attacking square sq
    function attackersOf(grid, sq, color) {
      var xy = sqToXY(sq), tx = xy[0], ty = xy[1], res = [];
      function at(x, y) { return (x >= 0 && x < 8 && y >= 0 && y < 8) ? grid[y][x] : undefined; }
      function add(x, y, types) { var p = at(x, y); if (p && p.color === color && types.indexOf(p.type) > -1) res.push({ sq: xyToSq(x, y), type: p.type }); }
      var pd = color === 'w' ? -1 : 1; // pawn of color sits one rank "behind"
      add(tx - 1, ty + pd, ['p']); add(tx + 1, ty + pd, ['p']);
      [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]].forEach(function (d) { add(tx + d[0], ty + d[1], ['n']); });
      for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) if (dx || dy) add(tx + dx, ty + dy, ['k']);
      [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (d) {
        var diag = d[0] && d[1];
        var types = diag ? ['b', 'q'] : ['r', 'q'];
        var x = tx + d[0], y = ty + d[1];
        while (x >= 0 && x < 8 && y >= 0 && y < 8) {
          var p = grid[y][x];
          if (p) { if (p.color === color && types.indexOf(p.type) > -1) res.push({ sq: xyToSq(x, y), type: p.type }); break; }
          x += d[0]; y += d[1];
        }
      });
      return res;
    }

    // pieces of `color` that can be won: attacked & undefended, or attacked by a cheaper piece
    function findHanging(game, color) {
      var grid = gridFromGame(game), opp = color === 'w' ? 'b' : 'w', out = [];
      for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) {
        var p = grid[y][x];
        if (!p || p.color !== color || p.type === 'k') continue;
        var sq = xyToSq(x, y);
        var att = attackersOf(grid, sq, opp);
        if (!att.length) continue;
        var def = attackersOf(grid, sq, color);
        var minAtt = Math.min.apply(null, att.map(function (a) { return PIECE_VALUE[a.type]; }));
        if (!def.length || minAtt < PIECE_VALUE[p.type]) out.push({ sq: sq, type: p.type, value: PIECE_VALUE[p.type], defended: def.length > 0 });
      }
      out.sort(function (a, b) { return b.value - a.value; });
      return out;
    }

    // ---------- openings (SAN prefixes, German names) ----------
    var OPENINGS = [
      ['e4', 'Königsbauernspiel'], ['d4', 'Damenbauernspiel'], ['c4', 'Englische Eröffnung'], ['Nf3', 'Réti-Eröffnung'],
      ['f4', 'Bird-Eröffnung'], ['b3', 'Larsen-Eröffnung'], ['g3', 'Königsfianchetto'],
      ['e4 e5', 'Offene Partie'], ['e4 e5 Nf3 Nc6 Bb5', 'Spanische Partie'], ['e4 e5 Nf3 Nc6 Bc4', 'Italienische Partie'],
      ['e4 e5 Nf3 Nc6 Bc4 Bc5', 'Italienisch (Giuoco Piano)'], ['e4 e5 Nf3 Nc6 Bc4 Bc5 b4', 'Evans-Gambit'],
      ['e4 e5 Nf3 Nc6 Bc4 Nf6', 'Zweispringerspiel im Nachzug'], ['e4 e5 Nf3 Nc6 Bc4 Nd4', 'Blackburne-Schilling-Gambit'],
      ['e4 e5 Nf3 Nc6 d4', 'Schottische Partie'], ['e4 e5 Nf3 Nc6 Nc3 Nf6', 'Vierspringerspiel'],
      ['e4 e5 Nf3 Nf6', 'Russische Verteidigung (Petrow)'], ['e4 e5 Nf3 d6', 'Philidor-Verteidigung'],
      ['e4 e5 f4', 'Königsgambit'], ['e4 e5 Nc3', 'Wiener Partie'], ['e4 e5 Bc4', 'Läuferspiel'],
      ['e4 e5 Qh5', 'Parham-Angriff (frühe Dame)'], ['e4 e5 d4', 'Mittelgambit'],
      ['e4 c5', 'Sizilianische Verteidigung'], ['e4 c5 Nc3', 'Sizilianisch, geschlossen'], ['e4 c5 c3', 'Sizilianisch, Alapin'],
      ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', 'Sizilianisch, Najdorf'],
      ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6', 'Sizilianisch, Drachen'],
      ['e4 e6', 'Französische Verteidigung'], ['e4 c6', 'Caro-Kann-Verteidigung'], ['e4 d5', 'Skandinavische Verteidigung'],
      ['e4 d6', 'Pirc-Verteidigung'], ['e4 g6', 'Moderne Verteidigung'], ['e4 Nf6', 'Aljechin-Verteidigung'],
      ['d4 d5', 'Geschlossene Partie'], ['d4 d5 c4', 'Damengambit'], ['d4 d5 c4 e6', 'Abgelehntes Damengambit'],
      ['d4 d5 c4 dxc4', 'Angenommenes Damengambit'], ['d4 d5 c4 c6', 'Slawische Verteidigung'],
      ['d4 d5 Bf4', 'Londoner System'], ['d4 Nf6 Bf4', 'Londoner System'], ['d4 d5 Nf3 Nf6 Bf4', 'Londoner System'],
      ['d4 d5 e4', 'Blackmar-Diemer-Gambit'], ['d4 Nf6', 'Indische Verteidigung'],
      ['d4 Nf6 c4 g6', 'Königsindische Verteidigung'], ['d4 Nf6 c4 g6 Nc3 d5', 'Grünfeld-Indisch'],
      ['d4 Nf6 c4 e6 Nc3 Bb4', 'Nimzowitsch-Indisch'], ['d4 Nf6 c4 e6 Nf3 b6', 'Damenindisch'],
      ['d4 Nf6 c4 c5 d5 b5', 'Wolga-Gambit'], ['d4 f5', 'Holländische Verteidigung']
    ];
    function openingName(sans) {
      var best = null, bestLen = 0;
      for (var i = 0; i < OPENINGS.length; i++) {
        var seq = OPENINGS[i][0].split(' ');
        if (seq.length > sans.length || seq.length <= bestLen) continue;
        var ok = true;
        for (var j = 0; j < seq.length; j++) if (String(sans[j]).replace(/[+#]/g, '') !== seq[j]) { ok = false; break; }
        if (ok) { best = OPENINGS[i][1]; bestLen = seq.length; }
      }
      return best;
    }

    // ---------- commentary ----------
    // move: chess.js verbose move; fenBefore: FEN before it; ply: 0-based ply index
    function explainMove(fenBefore, move, ply) {
      var notes = [];
      var g = new ChessCtor(fenBefore);
      var mover = move.color, opp = mover === 'w' ? 'b' : 'w';
      var oppHangBefore = findHanging(g, opp);
      var castleBefore = g.fen().split(' ')[2];
      g.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });

      if (g.in_checkmate()) { notes.push('Schachmatt! Die Partie ist vorbei.'); return notes; }
      if (g.in_stalemate()) { notes.push('Patt – die Partie endet remis.'); return notes; }
      if (move.flags.indexOf('k') > -1 || move.flags.indexOf('q') > -1) notes.push('Rochade – der König steht jetzt sicherer und der Turm kommt ins Spiel.');
      if (move.captured) notes.push(COLOR_NAME[mover] + ' schlägt ' + NAME_ACC[move.captured] + ' auf ' + move.to + '.');
      if (move.promotion) notes.push('Bauernumwandlung: ' + NAME_PLAIN[move.promotion] + '!');
      if (g.in_check()) notes.push('Schach!');

      var backRank = mover === 'w' ? '1' : '8';
      if ((move.piece === 'n' || move.piece === 'b') && move.from[1] === backRank && ply < 24) notes.push('Entwickelt eine Leichtfigur – genau das will man in der Eröffnung.');
      if (['d4', 'e4', 'd5', 'e5'].indexOf(move.to) > -1 && (move.piece === 'p' || move.piece === 'n')) notes.push('Kämpft um das Zentrum.');
      if (move.piece === 'q' && ply < 12 && !move.captured) notes.push('Die Dame kommt früh raus – sie kann leicht von Leichtfiguren gejagt werden.');
      if (move.piece === 'k' && move.flags.indexOf('k') === -1 && move.flags.indexOf('q') === -1 && ply < 40) {
        var rightsLost = mover === 'w' ? /[KQ]/.test(castleBefore) : /[kq]/.test(castleBefore);
        if (rightsLost) notes.push('Der König zieht – das Rochaderecht geht verloren.');
      }
      if (move.piece === 'p' && (move.from[0] === 'f' || move.from[0] === 'g' || move.from[0] === 'h') && ply < 20 && !move.captured) {
        var kingSide = mover === 'w' ? castleBefore.indexOf('K') > -1 : castleBefore.indexOf('k') > -1;
        if (move.from[0] === 'f' || kingSide) notes.push('Vorsicht: Bauernzüge vor dem König können ihn schwächen.');
      }

      // own pieces left hanging after the move
      var ownHang = findHanging(g, mover).filter(function (h) { return h.value >= 3 || !h.defended; });
      if (ownHang.length) {
        var h = ownHang[0];
        notes.push('Achtung: ' + NAME_NOM[h.type] + ' auf ' + h.sq + (h.defended ? ' kann günstig geschlagen werden.' : ' ist ungedeckt und hängt.'));
      }
      // new attacks on opponent pieces
      var oppHangAfter = findHanging(g, opp);
      var newTargets = oppHangAfter.filter(function (a) {
        return a.value >= 3 && !oppHangBefore.some(function (b) { return b.sq === a.sq; });
      });
      if (newTargets.length && !g.in_check()) notes.push('Greift ' + NAME_ACC[newTargets[0].type] + ' auf ' + newTargets[0].sq + ' an.');
      // missed free material
      var missed = oppHangBefore.filter(function (a) { return a.value >= 3 && a.sq !== move.to; });
      if (missed.length) notes.push('Verpasst? ' + NAME_NOM[missed[0].type] + ' auf ' + missed[0].sq + ' war schlagbar.');
      return notes;
    }

    // ---------- DOM parsing helpers ----------
    function parsePieceClass(className) {
      var c = ' ' + String(className || '') + ' ';
      var code = c.match(/\s([wb][pnbrqk])\s/);
      var sq = c.match(/\ssquare-([1-8])([1-8])\s/);
      if (!code || !sq) return null;
      return { code: code[1], sq: FILES[parseInt(sq[1], 10) - 1] + sq[2] };
    }

    // pieces: [{code:'wp', sq:'e2'}] -> FEN placement field
    function placementFromPieces(pieces) {
      var map = {};
      pieces.forEach(function (p) { map[p.sq] = p.code; });
      var rows = [];
      for (var r = 8; r >= 1; r--) {
        var row = '', empty = 0;
        for (var f = 0; f < 8; f++) {
          var code = map[FILES[f] + r];
          if (!code) { empty++; continue; }
          if (empty) { row += empty; empty = 0; }
          row += code[0] === 'w' ? code[1].toUpperCase() : code[1];
        }
        if (empty) row += empty;
        rows.push(row);
      }
      return rows.join('/');
    }

    function placementOf(game) { return game.fen().split(' ')[0]; }

    function fenFromPlacement(placement, turn) {
      var rows = placement.split('/');
      function at(sq) {
        var r = 8 - parseInt(sq[1], 10), f = FILES.indexOf(sq[0]), row = rows[r] || '', x = 0;
        for (var i = 0; i < row.length; i++) {
          var ch = row[i];
          if (/\d/.test(ch)) { x += parseInt(ch, 10); if (x > f) return null; }
          else { if (x === f) return ch; x++; }
        }
        return null;
      }
      var c = '';
      if (at('e1') === 'K') { if (at('h1') === 'R') c += 'K'; if (at('a1') === 'R') c += 'Q'; }
      if (at('e8') === 'k') { if (at('h8') === 'r') c += 'k'; if (at('a8') === 'r') c += 'q'; }
      return placement + ' ' + (turn || 'w') + ' ' + (c || '-') + ' - 0 1';
    }

    var DE_TO_EN = { S: 'N', L: 'B', T: 'R', D: 'Q' };
    function parseMoveText(text, figurine) {
      var t = String(text || '').replace(/\s+/g, '').replace(/[SLTD]/g, function (ch) { return DE_TO_EN[ch]; });
      t = t.replace(/^\d+\.+/, '');
      if (figurine && !/^[KQRBN]/.test(t) && !/^O-O/.test(t)) t = figurine + t;
      var m = t.match(/^(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=?[QRBN])?)[+#]?/);
      if (!m) return null;
      return m[0].replace(/^([a-h]\d?x?[a-h][1-8])([QRBN])$/, '$1=$2');
    }

    function uciOf(m) { return m.from + m.to + (m.promotion || ''); }

    // ---------- position tracker ----------
    function Tracker() { this.reset(); }
    Tracker.prototype.reset = function (fen) {
      this.game = fen ? new ChessCtor(fen) : new ChessCtor();
      this.startFen = this.game.fen();
      this.history = []; // {san, uci, from, to, color, piece, captured, promotion, flags, fenBefore, fenAfter, ply}
    };
    Tracker.prototype._push = function (mv, fenBefore) {
      this.history.push({
        san: mv.san, uci: uciOf(mv), from: mv.from, to: mv.to, color: mv.color, piece: mv.piece,
        captured: mv.captured, promotion: mv.promotion, flags: mv.flags,
        fenBefore: fenBefore, fenAfter: this.game.fen(), ply: this.history.length
      });
    };
    Tracker.prototype._findMove = function (game, target) {
      var moves = game.moves({ verbose: true });
      for (var i = 0; i < moves.length; i++) {
        game.move(moves[i]);
        var ok = placementOf(game) === target;
        game.undo();
        if (ok) return moves[i];
      }
      return null;
    };
    // hints: {moveList:[san...]|null, lastMoveSquares:[sq...], pieceAt:function(sq)->code}
    Tracker.prototype.update = function (placement, hints) {
      hints = hints || {};
      if (placement === placementOf(this.game)) return { type: 'none' };
      var fenBefore = this.game.fen();
      // 1) one move
      var mv = this._findMove(this.game, placement);
      if (mv) { var made = this.game.move(mv); this._push(made, fenBefore); return { type: 'move', count: 1 }; }
      // 2) two moves (premove / fast reply)
      var moves = this.game.moves({ verbose: true });
      for (var i = 0; i < moves.length; i++) {
        var m1 = this.game.move(moves[i]);
        var m2 = this._findMove(this.game, placement);
        if (m2) {
          var fenMid = this.game.fen();
          this.game.undo();
          this.game.move(m1); this._push(m1, fenBefore);
          var mm2 = this.game.move(m2); this._push(mm2, fenMid);
          return { type: 'move', count: 2 };
        }
        this.game.undo();
      }
      // 3) takeback / navigating backwards
      for (var k = this.history.length - 1; k >= 0; k--) {
        if (this.history[k].fenBefore.split(' ')[0] === placement) {
          this.history = this.history.slice(0, k);
          this.game = new ChessCtor(k ? this.history[k - 1].fenAfter : this.startFen);
          // rebuild game history so undo works
          var g = new ChessCtor(this.startFen);
          for (var q = 0; q < this.history.length; q++) g.move(this.history[q].san, { sloppy: true });
          this.game = g;
          return { type: 'undo' };
        }
      }
      // 4) rebuild from move list
      if (hints.moveList && hints.moveList.length) {
        var t = new Tracker();
        var good = true;
        for (var j = 0; j < hints.moveList.length; j++) {
          var fb = t.game.fen();
          var r = t.game.move(hints.moveList[j], { sloppy: true });
          if (!r) { good = false; break; }
          t._push(r, fb);
        }
        if (good && placementOf(t.game) === placement) {
          this.game = t.game; this.history = t.history; this.startFen = t.startFen;
          return { type: 'reset', source: 'movelist' };
        }
      }
      // 5) start position
      var start = new ChessCtor();
      if (placementOf(start) === placement) { this.reset(); return { type: 'reset', source: 'start' }; }
      // 6) fallback: build a FEN; guess side to move
      var turn = 'w';
      if (hints.lastMoveSquares && hints.pieceAt) {
        for (var s = 0; s < hints.lastMoveSquares.length; s++) {
          var code = hints.pieceAt(hints.lastMoveSquares[s]);
          if (code) { turn = code[0] === 'w' ? 'b' : 'w'; break; }
        }
      } else if (hints.moveList) turn = hints.moveList.length % 2 ? 'b' : 'w';
      var fen = fenFromPlacement(placement, turn);
      var test = new ChessCtor();
      if (!test.load(fen)) {
        var other = fenFromPlacement(placement, turn === 'w' ? 'b' : 'w');
        if (!test.load(other)) return { type: 'invalid' };
        fen = other;
      }
      this.reset(fen);
      return { type: 'reset', source: 'fen' };
    };
    Tracker.prototype.sans = function () { return this.history.map(function (h) { return h.san; }); };
    Tracker.prototype.isGameOverOnBoard = function () { return this.game.game_over(); };

    return {
      ASSIST_PATHS: ASSIST_PATHS, LOCKED_NOTE: LOCKED_NOTE, CLASSES: CLASSES,
      isChessComHost: isChessComHost, isAssistAllowed: isAssistAllowed,
      scoreToCp: scoreToCp, winPct: winPct, classifyMove: classifyMove, formatEval: formatEval, evalBarPct: evalBarPct,
      toGermanSan: toGermanSan, sanToSpeech: sanToSpeech, attackersOf: attackersOf, gridFromGame: gridFromGame,
      findHanging: findHanging, openingName: openingName, explainMove: explainMove,
      parsePieceClass: parsePieceClass, placementFromPieces: placementFromPieces, placementOf: placementOf,
      fenFromPlacement: fenFromPlacement, parseMoveText: parseMoveText, uciOf: uciOf, Tracker: Tracker,
      NAME_NOM: NAME_NOM, NAME_ACC: NAME_ACC, COLOR_NAME: COLOR_NAME
    };
  }

  // Node test hook
  if (typeof module !== 'undefined' && module.exports && typeof window === 'undefined') {
    module.exports = { makeCore: makeCore };
    return;
  }

  // ---------------------------------------------------------------------------
  // BROWSER PART
  // ---------------------------------------------------------------------------
  var ChessLib = (typeof Chess !== 'undefined') ? Chess : window.Chess;
  if (!ChessLib) { console.error('[ChessCoach] chess.js fehlt'); return; }
  var Core = makeCore(ChessLib);
  var W = window;
  W.__ChessCoachCore = Core;

  var ENGINE_URLS = [
    'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js',
    'https://unpkg.com/stockfish.js@10.0.2/stockfish.js'
  ];
  var LIVE_DEPTH = 14, LIVE_MS = 1500, REVIEW_DEPTH = 12, REVIEW_MS = 900;

  // ---------- storage ----------
  var store = {
    get: function (k, d) {
      try { if (typeof GM_getValue === 'function') { var v = GM_getValue(k); return v === undefined ? d : v; } } catch (e) { /* ignore */ }
      try { var s = localStorage.getItem('chesscoach_' + k); return s === null ? d : JSON.parse(s); } catch (e) { return d; }
    },
    set: function (k, v) {
      try { if (typeof GM_setValue === 'function') { GM_setValue(k, v); return; } } catch (e) { /* ignore */ }
      try { localStorage.setItem('chesscoach_' + k, JSON.stringify(v)); } catch (e) { /* ignore */ }
    }
  };

  // ---------- URL (hard-coded fair-play gate) ----------
  function currentUrl() {
    // On chess.com ALWAYS the real URL. The override exists only for the local test page.
    if (Core.isChessComHost(location.hostname)) return location.href;
    return W.__COACH_TEST_URL__ || location.href;
  }
  function assistAllowed() { return Core.isAssistAllowed(currentUrl()); }

  // ---------- engine ----------
  function httpGet(url) {
    return new Promise(function (resolve, reject) {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET', url: url, timeout: 30000,
          onload: function (r) { (r.status >= 200 && r.status < 300) ? resolve(r.responseText) : reject(new Error('HTTP ' + r.status)); },
          onerror: function () { reject(new Error('Netzwerkfehler')); }, ontimeout: function () { reject(new Error('Timeout')); }
        });
      } else {
        fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }).then(resolve, reject);
      }
    });
  }

  function Engine() { this.worker = null; this.readyP = null; this.listeners = []; this.chain = Promise.resolve(); this.name = ''; }
  Engine.prototype.init = function () {
    var self = this;
    if (this.readyP) return this.readyP;
    this.readyP = (async function () {
      var src = null, lastErr = null;
      for (var i = 0; i < ENGINE_URLS.length && !src; i++) {
        try { src = await httpGet(ENGINE_URLS[i]); } catch (e) { lastErr = e; }
      }
      if (!src) throw lastErr || new Error('Engine nicht geladen');
      var blobUrl = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
      self.worker = new Worker(blobUrl);
      self.worker.onmessage = function (e) {
        var line = typeof e.data === 'string' ? e.data : String(e.data);
        self.listeners.slice().forEach(function (f) { f(line); });
      };
      self.worker.onerror = function (e) { console.error('[ChessCoach] Engine-Fehler', e); };
      await self._wait('uci', 'uciok', function (l) { var m = l.match(/^id name (.*)/); if (m) self.name = m[1]; });
      self.send('setoption name Hash value 32');
      await self._wait('isready', 'readyok');
    })();
    return this.readyP;
  };
  Engine.prototype.send = function (c) { this.worker.postMessage(c); };
  Engine.prototype._off = function (f) { var i = this.listeners.indexOf(f); if (i > -1) this.listeners.splice(i, 1); };
  Engine.prototype._wait = function (cmd, token, onLine) {
    var self = this;
    return new Promise(function (res) {
      var f = function (l) { if (onLine) onLine(l); if (l.indexOf(token) === 0) { self._off(f); res(); } };
      self.listeners.push(f); self.send(cmd);
    });
  };
  // returns {bestmove, score:{cp}|{mate} (white POV), pv:[uci], depth} or null if stale
  Engine.prototype.analyze = function (fen, opts, isStale) {
    var self = this;
    opts = opts || {};
    var run = async function () {
      if (isStale && isStale()) return null;
      await self.init();
      return new Promise(function (resolve) {
        var turn = fen.split(' ')[1], last = { depth: 0, score: { cp: 0 }, pv: [] };
        var f = function (l) {
          if (l.indexOf('info') === 0 && l.indexOf(' pv ') > -1 && !/ multipv [2-9]/.test(l)) {
            var d = l.match(/ depth (\d+)/), cp = l.match(/ score cp (-?\d+)/), mate = l.match(/ score mate (-?\d+)/), pv = l.match(/ pv (.*)$/);
            if (/ (lowerbound|upperbound)/.test(l)) return;
            var sgn = turn === 'w' ? 1 : -1;
            last = {
              depth: d ? +d[1] : 0,
              score: mate ? { mate: sgn * +mate[1] } : { cp: sgn * (cp ? +cp[1] : 0) },
              pv: pv ? pv[1].trim().split(/\s+/) : []
            };
          } else if (l.indexOf('bestmove') === 0) {
            clearTimeout(timer); self._off(f);
            var bm = l.split(/\s+/)[1];
            resolve({ bestmove: bm && bm !== '(none)' ? bm : null, score: last.score, pv: last.pv, depth: last.depth });
          }
        };
        self.listeners.push(f);
        self.send('position fen ' + fen);
        self.send('go depth ' + (opts.depth || LIVE_DEPTH));
        var timer = setTimeout(function () { self.send('stop'); }, opts.movetime || LIVE_MS);
      });
    };
    var p = this.chain.then(run, run);
    this.chain = p.catch(function () { /* keep chain alive */ });
    return p;
  };

  // ---------- DOM reading ----------
  function findBoard() {
    var c = Array.prototype.slice.call(document.querySelectorAll('wc-chess-board, chess-board, .board'))
      .filter(function (el) { return el.querySelector('.piece'); });
    if (!c.length) return null;
    c.sort(function (a, b) {
      var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    });
    return c[0];
  }
  function readPieces(board) {
    var out = [], seen = {};
    board.querySelectorAll('.piece').forEach(function (el) {
      if (el.classList.contains('ghost') || el.classList.contains('promotion-piece')) return;
      if (el.closest('.promotion-window')) return;
      var p = Core.parsePieceClass(el.getAttribute('class'));
      if (!p) return;
      if (seen[p.sq] && el.classList.contains('dragging')) return;
      seen[p.sq] = true;
      out.push(p);
    });
    return out;
  }
  function readHighlights(board) {
    var sqs = [];
    board.querySelectorAll('.highlight').forEach(function (el) {
      var m = (el.getAttribute('class') || '').match(/square-([1-8])([1-8])/);
      if (m) sqs.push('abcdefgh'[+m[1] - 1] + m[2]);
    });
    return sqs;
  }
  function isFlipped(board) {
    if (board.classList.contains('flipped')) return true;
    var host = board.closest('.flipped');
    return !!host && host !== document.body;
  }
  function readMoveList() {
    var root = document.querySelector('wc-simple-move-list, wc-move-list, vertical-move-list, .vertical-move-list, .move-list-wrapper, .move-list, .play-controller-moveList, [data-cy="move-list"]');
    if (!root) return null;
    var nodes = Array.prototype.slice.call(root.querySelectorAll('.node.white-move, .node.black-move, .node[data-ply], [data-ply]'));
    var main = nodes.filter(function (n) { return n.classList.contains('main-line-ply'); });
    if (main.length) nodes = main;
    nodes = nodes.filter(function (n) { return !n.closest('.subline, .variation, .move-list-variation'); });
    var sans = [];
    for (var i = 0; i < nodes.length; i++) {
      var fig = nodes[i].querySelector('[data-figurine]');
      var san = Core.parseMoveText(nodes[i].textContent, fig ? fig.getAttribute('data-figurine') : null);
      if (!san) return sans.length ? sans : null;
      sans.push(san);
    }
    return sans;
  }
  function domGameOver() {
    var sel = '.game-over-modal-content, [data-cy="game-over-modal-content"], .game-over-modal-container, .game-over-header-component, .game-result-component, .game-over-message-component, .board-modal-container .game-over, [data-cy="game-over-modal"]';
    var el = document.querySelector(sel);
    if (el && el.getClientRects().length) return true;
    var res = document.querySelectorAll('.game-result, .move-list-result, [data-cy="game-result"]');
    for (var i = 0; i < res.length; i++) {
      if (/^\s*(1-0|0-1|1\/2-1\/2|½-½)\s*$/.test(res[i].textContent)) return true;
    }
    return false;
  }

  // ---------- UI ----------
  var CSS = [
    '#cc-panel{position:fixed;z-index:2147483000;width:320px;background:#1e1f22;color:#e8e8e8;border:1px solid #3a3b40;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.5);font:13px/1.45 -apple-system,Segoe UI,Roboto,Arial,sans-serif;user-select:none}',
    '#cc-panel *{box-sizing:border-box}',
    '#cc-head{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#2b2d31;border-radius:12px 12px 0 0;cursor:move}',
    '#cc-head b{flex:1;font-size:13px}',
    '#cc-head button{background:#3a3c42;color:#ddd;border:0;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:12px}',
    '#cc-head button.on{background:#3d7a45;color:#fff}',
    '#cc-body{padding:10px;max-height:70vh;overflow:auto;user-select:text}',
    '#cc-panel.min #cc-body{display:none}',
    '#cc-panel.min #cc-head{border-radius:12px}',
    '.cc-note{background:#2a2420;border:1px solid #6b5333;color:#f2d7a6;padding:10px;border-radius:8px}',
    '.cc-bar{position:relative;height:18px;background:#333;border-radius:9px;overflow:hidden;margin:2px 0 8px}',
    '.cc-bar i{position:absolute;left:0;top:0;bottom:0;background:#f0f0f0;transition:width .4s}',
    '.cc-bar span{position:absolute;right:8px;top:0;font-weight:700;font-size:12px;line-height:18px;color:#888;mix-blend-mode:difference}',
    '.cc-row{display:flex;justify-content:space-between;align-items:center;margin:4px 0}',
    '.cc-badge{display:inline-block;padding:1px 8px;border-radius:10px;color:#111;font-weight:700;font-size:12px}',
    '.cc-card{background:#26282c;border-radius:8px;padding:8px;margin:6px 0}',
    '.cc-card ul{margin:4px 0 0 16px;padding:0}',
    '.cc-tip{background:#1f3326;border:1px solid #3d7a45;border-radius:8px;padding:8px;margin:6px 0}',
    '.cc-warn{color:#ffb4a2}',
    '.cc-muted{color:#9a9ca3;font-size:12px}',
    '.cc-hist{display:grid;grid-template-columns:28px 1fr 1fr;gap:2px 6px;font-size:12px;margin-top:6px}',
    '.cc-hist .m{white-space:nowrap}',
    '.cc-btn{background:#3d7a45;color:#fff;border:0;border-radius:6px;padding:5px 10px;cursor:pointer;margin-top:6px}',
    '#cc-arrows{position:fixed;pointer-events:none;z-index:2147482000}'
  ].join('\n');

  var state = {
    tracker: new Core.Tracker(), evals: {}, gen: 0, engine: new Engine(), engineError: null,
    lastPlacement: null, mode: null, review: null, reviewGen: 0, minimized: store.get('minimized', false),
    voice: store.get('voice', false), tips: store.get('tips', true), lastSpokenPly: -1, flipped: false, board: null
  };

  var panel, body, arrowsSvg, btnVoice, btnTips, btnMin;
  function el(tag, attrs, html) { var e = document.createElement(tag); for (var k in attrs || {}) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function buildUI() {
    var st = el('style'); st.textContent = CSS; document.head.appendChild(st);
    panel = el('div', { id: 'cc-panel' });
    var head = el('div', { id: 'cc-head' });
    head.innerHTML = '<b>♞ Chess Coach</b>';
    btnTips = el('button', { title: 'Tipps & Pfeile (nur gegen Computer/Analyse)' }, 'Tipps');
    btnVoice = el('button', { title: 'Sprachkommentar an/aus' }, '🔈');
    btnMin = el('button', { title: 'Minimieren' }, '–');
    head.appendChild(btnTips); head.appendChild(btnVoice); head.appendChild(btnMin);
    body = el('div', { id: 'cc-body' });
    panel.appendChild(head); panel.appendChild(body);
    document.body.appendChild(panel);
    var pos = store.get('pos', null);
    panel.style.left = (pos ? pos.x : Math.max(10, W.innerWidth - 340)) + 'px';
    panel.style.top = (pos ? pos.y : 80) + 'px';
    if (state.minimized) panel.classList.add('min');
    syncButtons();

    btnMin.onclick = function () { state.minimized = !state.minimized; panel.classList.toggle('min', state.minimized); store.set('minimized', state.minimized); syncButtons(); };
    btnVoice.onclick = function () { state.voice = !state.voice; store.set('voice', state.voice); if (!state.voice && W.speechSynthesis) speechSynthesis.cancel(); syncButtons(); };
    btnTips.onclick = function () { state.tips = !state.tips; store.set('tips', state.tips); syncButtons(); render(); };

    // drag
    var drag = null;
    head.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      drag = { dx: e.clientX - panel.offsetLeft, dy: e.clientY - panel.offsetTop }; e.preventDefault();
    });
    W.addEventListener('mousemove', function (e) {
      if (!drag) return;
      var x = Math.max(0, Math.min(W.innerWidth - 60, e.clientX - drag.dx));
      var y = Math.max(0, Math.min(W.innerHeight - 30, e.clientY - drag.dy));
      panel.style.left = x + 'px'; panel.style.top = y + 'px';
    });
    W.addEventListener('mouseup', function () { if (drag) { drag = null; store.set('pos', { x: panel.offsetLeft, y: panel.offsetTop }); } });

    arrowsSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrowsSvg.setAttribute('id', 'cc-arrows');
    document.body.appendChild(arrowsSvg);
  }
  function syncButtons() {
    btnVoice.textContent = state.voice ? '🔊' : '🔈';
    btnVoice.classList.toggle('on', state.voice);
    btnTips.classList.toggle('on', state.tips);
    btnMin.textContent = state.minimized ? '+' : '–';
  }

  function speak(text) {
    if (!state.voice || !W.speechSynthesis || !text) return;
    try {
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'de-DE'; u.rate = 1.05;
      var v = speechSynthesis.getVoices().filter(function (x) { return /^de/i.test(x.lang); })[0];
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }

  function clearArrows() { if (arrowsSvg) arrowsSvg.innerHTML = ''; }
  function drawArrow(uci, color) {
    clearArrows();
    if (!uci || !state.board) return;
    var r = state.board.getBoundingClientRect();
    if (!r.width) return;
    arrowsSvg.style.left = r.left + 'px'; arrowsSvg.style.top = r.top + 'px';
    arrowsSvg.setAttribute('width', r.width); arrowsSvg.setAttribute('height', r.height);
    var s = r.width / 8;
    function c(sq) {
      var f = 'abcdefgh'.indexOf(sq[0]), rk = +sq[1] - 1;
      var x = state.flipped ? 7 - f : f, y = state.flipped ? rk : 7 - rk;
      return [x * s + s / 2, y * s + s / 2];
    }
    var a = c(uci.slice(0, 2)), b = c(uci.slice(2, 4));
    var ang = Math.atan2(b[1] - a[1], b[0] - a[0]), head = s * 0.38;
    var bx = b[0] - Math.cos(ang) * head * 0.8, by = b[1] - Math.sin(ang) * head * 0.8;
    var p1 = [b[0] - Math.cos(ang - 0.5) * head, b[1] - Math.sin(ang - 0.5) * head];
    var p2 = [b[0] - Math.cos(ang + 0.5) * head, b[1] - Math.sin(ang + 0.5) * head];
    arrowsSvg.innerHTML =
      '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + bx + '" y2="' + by + '" stroke="' + color + '" stroke-width="' + (s * 0.16) + '" stroke-linecap="round" opacity=".85"/>' +
      '<polygon points="' + b[0] + ',' + b[1] + ' ' + p1[0] + ',' + p1[1] + ' ' + p2[0] + ',' + p2[1] + '" fill="' + color + '" opacity=".85"/>';
  }

  function uciToSan(fen, uci) {
    if (!uci) return null;
    var g = new ChessLib(fen);
    var m = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
    return m ? m.san : null;
  }

  function moveLabel(h) { return Math.floor(h.ply / 2) + 1 + (h.color === 'w' ? '. ' : '... ') + Core.toGermanSan(h.san); }

  function gameOverInfo(game) {
    if (game.in_checkmate()) return { score: { mate: 0 }, cp: game.turn() === 'w' ? -10000 : 10000 };
    if (game.game_over()) return { score: { cp: 0 }, cp: 0 };
    return null;
  }

  // evaluate one FEN (cached). Game-over positions without engine.
  async function evalFen(fen, opts, isStale) {
    if (state.evals[fen] && state.evals[fen].depth >= (opts.depth || 0) - 2) return state.evals[fen];
    var g = new ChessLib(fen), go = gameOverInfo(g);
    if (go) { var r0 = { bestmove: null, score: go.score, cp: go.cp, depth: 99, pv: [] }; state.evals[fen] = r0; return r0; }
    var r = await state.engine.analyze(fen, opts, isStale);
    if (!r) return null;
    r.cp = Core.scoreToCp(r.score);
    state.evals[fen] = r;
    return r;
  }

  function judge(h) {
    var b = state.evals[h.fenBefore], a = state.evals[h.fenAfter];
    if (!b || !a) return null;
    var cls = Core.classifyMove({ bestUci: b.bestmove, playedUci: h.uci, evalBefore: b.cp, evalAfter: a.cp, mover: h.color });
    var notes = Core.explainMove(h.fenBefore, h, h.ply);
    var better = (cls.key !== 'best' && cls.key !== 'good' && b.bestmove) ? uciToSan(h.fenBefore, b.bestmove) : null;
    var reply = (cls.key === 'mistake' || cls.key === 'blunder') && a.bestmove ? uciToSan(h.fenAfter, a.bestmove) : null;
    return { cls: cls, notes: notes, better: better, reply: reply };
  }

  // ---------- main loop ----------
  function tick() {
    var board = findBoard();
    state.board = board;
    var allowed = assistAllowed();
    var mode = allowed ? 'assist' : 'locked';
    var modeChanged = mode !== state.mode;
    state.mode = mode;
    if (!board) { if (modeChanged) render(); return; }
    state.flipped = isFlipped(board);
    var pieces = readPieces(board);
    var placement = Core.placementFromPieces(pieces);
    var changed = placement !== state.lastPlacement;
    if (changed) {
      state.lastPlacement = placement;
      var map = {}; pieces.forEach(function (p) { map[p.sq] = p.code; });
      var res = state.tracker.update(placement, {
        moveList: readMoveList(), lastMoveSquares: readHighlights(board), pieceAt: function (sq) { return map[sq]; }
      });
      if (res.type !== 'none') onPositionChanged(res);
    }
    // locked mode: watch for game over
    if (state.mode === 'locked') {
      var over = state.tracker.isGameOverOnBoard() || domGameOver();
      if (over && !state.review && state.tracker.history.length) startReview();
    }
    if (modeChanged) { if (state.mode === 'assist') analyzeCurrent(); else render(); }
  }

  function onPositionChanged(res) {
    state.gen++;
    if (state.review) {
      // any board change after a review started = new game/moves -> back to locked
      var snapLen = state.review.history.length;
      var h = state.tracker.history;
      var same = h.length === snapLen && h.every(function (x, i) { return x.uci === state.review.history[i].uci; });
      if (!same) { state.review = null; state.reviewGen++; }
    }
    if (state.mode === 'assist') analyzeCurrent(); else render();
  }

  async function analyzeCurrent() {
    var gen = ++state.gen;
    var stale = function () { return gen !== state.gen || state.mode !== 'assist'; };
    render();
    if (state.mode !== 'assist') return;
    var hist = state.tracker.history, last = hist[hist.length - 1];
    try {
      var fenNow = state.tracker.game.fen();
      if (last && !state.evals[last.fenBefore]) { await evalFen(last.fenBefore, { depth: LIVE_DEPTH, movetime: LIVE_MS }, stale); if (stale()) return; }
      await evalFen(fenNow, { depth: LIVE_DEPTH, movetime: LIVE_MS }, stale);
      state.engineError = null;
    } catch (e) {
      state.engineError = String(e && e.message || e);
    }
    if (stale()) return;
    render();
    if (last && last.ply !== state.lastSpokenPly) {
      state.lastSpokenPly = last.ply;
      var j = judge(last);
      if (j) speak(Core.sanToSpeech(last.san) + '. ' + j.cls.label + '.' + (j.notes[0] && /Achtung|Schachmatt/.test(j.notes[0]) ? ' ' + j.notes[0] : ''));
    }
  }

  async function startReview() {
    var snap = state.tracker.history.slice();
    var rgen = ++state.reviewGen;
    state.review = { history: snap, done: 0, total: snap.length, finished: false };
    render();
    var stale = function () { return rgen !== state.reviewGen; };
    try {
      var fens = [snap[0].fenBefore].concat(snap.map(function (h) { return h.fenAfter; }));
      for (var i = 0; i < fens.length; i++) {
        var r = await evalFen(fens[i], { depth: REVIEW_DEPTH, movetime: REVIEW_MS }, stale);
        if (stale() || !r) return;
        state.review.done = Math.min(i, snap.length);
        render();
      }
      state.review.finished = true;
      render();
      speak('Analyse fertig.');
    } catch (e) {
      if (!stale()) { state.engineError = String(e && e.message || e); render(); }
    }
  }

  // ---------- render ----------
  function render() {
    if (!body) return;
    if (btnTips) btnTips.style.display = state.mode === 'assist' ? '' : 'none';
    if (state.mode !== 'assist') clearArrows();
    if (!state.board) {
      body.innerHTML = '<div class="cc-muted">Kein Schachbrett gefunden. Öffne eine Partie auf chess.com.</div>' +
        (state.mode === 'locked' ? '<div class="cc-note" style="margin-top:8px">' + esc(Core.LOCKED_NOTE) + '</div>' : '');
      return;
    }
    if (state.mode === 'locked') return renderLocked();
    renderAssist();
  }

  function renderLocked() {
    clearArrows();
    if (!state.review) {
      // FAIR PLAY: nothing but the neutral note during a game vs humans.
      body.innerHTML = '<div class="cc-note">' + esc(Core.LOCKED_NOTE) + '</div>';
      return;
    }
    var rv = state.review, html = '<div class="cc-note">Partie beendet – Analyse nach der Partie.</div>';
    if (!rv.finished) {
      html += '<div class="cc-card">Analysiere… ' + rv.done + ' / ' + rv.total + ' Züge</div>';
      if (state.engineError) html += '<div class="cc-card cc-warn">Engine-Fehler: ' + esc(state.engineError) + '</div>';
      body.innerHTML = html; return;
    }
    html += renderReviewSummary(rv.history);
    body.innerHTML = html;
  }

  function renderReviewSummary(hist) {
    var counts = { w: {}, b: {} }, drops = { w: [], b: [] }, rows = '';
    hist.forEach(function (h) {
      var j = judge(h);
      if (!j) return;
      counts[h.color][j.cls.key] = (counts[h.color][j.cls.key] || 0) + 1;
      drops[h.color].push(j.cls.drop);
      if (j.cls.key === 'inaccuracy' || j.cls.key === 'mistake' || j.cls.key === 'blunder') {
        rows += '<div class="cc-card"><div class="cc-row"><b>' + esc(moveLabel(h)) + '</b>' + badge(j.cls) + '</div>' +
          (j.better ? '<div>Besser war: <b>' + esc(Core.toGermanSan(j.better)) + '</b></div>' : '') +
          (j.reply ? '<div class="cc-muted">Danach möglich: ' + esc(Core.toGermanSan(j.reply)) + '</div>' : '') +
          (j.notes.length ? '<ul>' + j.notes.slice(0, 3).map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
      }
    });
    function acc(arr) { if (!arr.length) return '–'; var avg = arr.reduce(function (a, b) { return a + b; }, 0) / arr.length; return Math.max(0, Math.round(100 - avg * 2.2)) + '%'; }
    function line(c) {
      var k = counts[c];
      return '<div class="cc-row"><b>' + Core.COLOR_NAME[c] + '</b><span>Genauigkeit ~' + acc(drops[c]) + '</span></div>' +
        '<div class="cc-muted">★ ' + (k.best || 0) + ' · ✓ ' + (k.good || 0) + ' · ?! ' + (k.inaccuracy || 0) + ' · ? ' + (k.mistake || 0) + ' · ?? ' + (k.blunder || 0) + '</div>';
    }
    var op = Core.openingName(hist.map(function (h) { return h.san; }));
    return '<div class="cc-card">' + (op ? '<div class="cc-muted">Eröffnung: ' + esc(op) + '</div>' : '') + line('w') + line('b') + '</div>' +
      (rows || '<div class="cc-card">Keine groben Fehler gefunden – stark gespielt!</div>');
  }

  function badge(c) { return '<span class="cc-badge" style="background:' + c.color + '">' + esc(c.sym + ' ' + c.label) + '</span>'; }

  function renderAssist() {
    var tr = state.tracker, game = tr.game, fen = game.fen(), hist = tr.history, last = hist[hist.length - 1];
    var ev = state.evals[fen];
    var html = '';
    var path = (function () { try { return new URL(currentUrl()).pathname; } catch (e) { return ''; } })();
    var vsComputer = /^\/(play|game)\/computer/i.test(path);
    var userColor = state.flipped ? 'b' : 'w';

    if (ev) {
      var pct = Core.evalBarPct(ev.score);
      html += '<div class="cc-row"><span class="cc-muted">Bewertung' + (ev.depth && ev.depth < 99 ? ' (Tiefe ' + ev.depth + ')' : '') + '</span><b>' + esc(Core.formatEval(ev.score)) + '</b></div>' +
        '<div class="cc-bar"><i style="width:' + pct.toFixed(1) + '%"></i><span>' + esc(Core.formatEval(ev.score)) + '</span></div>';
    } else if (state.engineError) {
      html += '<div class="cc-card cc-warn">Engine nicht verfügbar: ' + esc(state.engineError) + '. Kommentare ohne Bewertung.</div>';
    } else {
      html += '<div class="cc-muted">Engine rechnet…</div><div class="cc-bar"><i style="width:50%"></i></div>';
    }

    var op = Core.openingName(tr.sans());
    if (op) html += '<div class="cc-muted">Eröffnung: <b style="color:#ddd">' + esc(op) + '</b></div>';

    if (last) {
      var j = judge(last);
      var who = Core.COLOR_NAME[last.color] + (vsComputer ? (last.color === userColor ? ' (du)' : ' (Computer)') : '');
      html += '<div class="cc-card"><div class="cc-row"><b>' + esc(moveLabel(last)) + '</b>' + (j ? badge(j.cls) : '<span class="cc-muted">…</span>') + '</div>' +
        '<div class="cc-muted">' + esc(who) + '</div>';
      var notes = j ? j.notes : Core.explainMove(last.fenBefore, last, last.ply);
      if (notes.length) html += '<ul>' + notes.slice(0, 4).map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
      if (j && j.better) html += '<div>Besser war: <b>' + esc(Core.toGermanSan(j.better)) + '</b></div>';
      if (j && j.reply) html += '<div class="cc-warn">Jetzt droht: ' + esc(Core.toGermanSan(j.reply)) + '</div>';
      html += '</div>';
    } else {
      html += '<div class="cc-card">Bereit. Mach einen Zug – ich kommentiere live.</div>';
    }

    // tips (assist mode only)
    var turn = game.turn();
    var showTip = state.tips && !game.game_over() && (!vsComputer || turn === userColor);
    if (game.game_over()) {
      html += '<div class="cc-tip">Partie beendet. ' + (game.in_checkmate() ? (Core.COLOR_NAME[turn === 'w' ? 'b' : 'w'] + ' gewinnt.') : 'Remis.') + '</div>';
      if (hist.length) html += renderReviewIfReady(hist);
    } else if (showTip) {
      var tipHtml = '';
      if (ev && ev.bestmove) {
        var san = uciToSan(fen, ev.bestmove);
        if (san) tipHtml += '<div><b>Tipp:</b> spiele <b>' + esc(Core.toGermanSan(san)) + '</b></div>';
      }
      var hang = Core.findHanging(game, turn);
      if (hang.length) tipHtml += '<div class="cc-warn">Achtung: ' + esc(Core.NAME_NOM[hang[0].type]) + ' auf ' + hang[0].sq + ' ist angegriffen.</div>';
      var opp = turn === 'w' ? 'b' : 'w';
      var targets = Core.findHanging(game, opp).filter(function (h) { return h.value >= 3; });
      if (targets.length) tipHtml += '<div>Chance: ' + esc(Core.NAME_NOM[targets[0].type]) + ' des Gegners auf ' + targets[0].sq + ' ist schlagbar.</div>';
      if (game.in_check()) tipHtml += '<div class="cc-warn">Du stehst im Schach!</div>';
      if (tipHtml) html += '<div class="cc-tip">' + tipHtml + '</div>';
    } else if (vsComputer && state.tips) {
      html += '<div class="cc-muted">Computer ist am Zug…</div>';
    }
    if (showTip && ev && ev.bestmove) drawArrow(ev.bestmove, '#5fd068'); else clearArrows();

    // short history
    if (hist.length) {
      var rows = '', start = Math.max(0, hist.length - 12);
      if (start % 2) start--;
      for (var i = start; i < hist.length; i += 2) {
        var w = hist[i], b = hist[i + 1];
        rows += '<span class="cc-muted">' + (i / 2 + 1) + '.</span>' + histCell(w) + histCell(b);
      }
      html += '<div class="cc-hist">' + rows + '</div>';
    }
    html += '<div class="cc-muted" style="margin-top:8px">Hilfe aktiv (Computer/Analyse/Training). ' + (state.engine.name ? esc(state.engine.name) : '') + '</div>';
    body.innerHTML = html;
  }
  function histCell(h) {
    if (!h) return '<span></span>';
    var j = judge(h);
    return '<span class="m">' + esc(Core.toGermanSan(h.san)) + (j ? ' <span style="color:' + j.cls.color + '">' + esc(j.cls.sym) + '</span>' : '') + '</span>';
  }
  function renderReviewIfReady(hist) {
    var all = hist.every(function (h) { return state.evals[h.fenBefore] && state.evals[h.fenAfter]; });
    return all ? renderReviewSummary(hist) : '';
  }

  // ---------- start ----------
  function start() {
    buildUI();
    tick();
    setInterval(tick, 250);
    W.addEventListener('resize', function () { if (state.mode === 'assist') render(); });
    W.__ChessCoach = { state: state, tick: tick, render: render };
  }
  if (document.body) start(); else W.addEventListener('DOMContentLoaded', start);
})();
