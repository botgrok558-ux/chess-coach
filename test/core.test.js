// Unit tests for the pure logic in chess-coach.user.js. Run: node test/core.test.js
const assert = require('assert');
const { Chess } = require('chess.js');
const { makeCore } = require('../chess-coach.user.js');
const C = makeCore(Chess);
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); } }

console.log('Fair-Play-Gate');
const allowed = [
  'https://www.chess.com/play/computer', 'https://www.chess.com/play/computer/discover',
  'https://www.chess.com/game/computer/123456', 'https://www.chess.com/analysis',
  'https://www.chess.com/analysis/game/live/987?tab=review', 'https://www.chess.com/practice',
  'https://www.chess.com/puzzles/rated', 'https://www.chess.com/lessons/the-pin', 'https://chess.com/play/computer/',
  'https://www.chess.com/PLAY/Computer'
];
const blocked = [
  'https://www.chess.com/play/online', 'https://www.chess.com/play/online/new', 'https://www.chess.com/game/live/123456',
  'https://www.chess.com/game/daily/123', 'https://www.chess.com/play', 'https://www.chess.com/', 'https://www.chess.com/home',
  'https://www.chess.com/play/computers', 'https://www.chess.com/analysisX', 'https://www.chess.com/game/live/1?x=/play/computer',
  'https://www.chess.com/game/live/1#/analysis', 'https://evil.com/play/computer', 'https://chess.com.evil.com/play/computer',
'https://www.chess.com/play/arena', 'https://www.chess.com/variants',
  'not a url', '', 'javascript:alert(1)//www.chess.com/play/computer'
];
allowed.forEach(u => t('erlaubt: ' + u, () => assert.strictEqual(C.isAssistAllowed(u), true)));
blocked.forEach(u => t('gesperrt: ' + u, () => assert.strictEqual(C.isAssistAllowed(u), false)));
t('Hinweistext exakt', () => assert.strictEqual(C.LOCKED_NOTE, 'Live gegen Menschen: Tipps aus (Fair Play). Analyse nach der Partie verfügbar.'));
t('Whitelist eingefroren', () => { try { C.ASSIST_PATHS.push('/play/online'); } catch (e) {} assert.strictEqual(C.isAssistAllowed('https://www.chess.com/play/online'), false); });

console.log('Zugbewertung');
const k = o => C.classifyMove(o).key;
t('gleicher Zug wie Engine = Bester Zug', () => assert.strictEqual(k({ bestUci: 'e2e4', playedUci: 'e2e4', evalBefore: 30, evalAfter: -50, mover: 'w' }), 'best'));
t('kaum Verlust = Bester Zug', () => assert.strictEqual(k({ bestUci: 'e2e4', playedUci: 'd2d4', evalBefore: 30, evalAfter: 25, mover: 'w' }), 'best'));
t('kleiner Verlust = Gut', () => assert.strictEqual(k({ bestUci: 'a', playedUci: 'b', evalBefore: 30, evalAfter: -30, mover: 'w' }), 'good'));
t('~100cp = Ungenauigkeit', () => assert.strictEqual(k({ bestUci: 'a', playedUci: 'b', evalBefore: 20, evalAfter: -100, mover: 'w' }), 'inaccuracy'));
t('~200cp = Fehler', () => assert.strictEqual(k({ bestUci: 'a', playedUci: 'b', evalBefore: 0, evalAfter: -230, mover: 'w' }), 'mistake'));
t('Figur weg = Patzer', () => assert.strictEqual(k({ bestUci: 'a', playedUci: 'b', evalBefore: 0, evalAfter: -350, mover: 'w' }), 'blunder'));
t('Schwarz: Perspektive gespiegelt', () => assert.strictEqual(k({ bestUci: 'a', playedUci: 'b', evalBefore: 0, evalAfter: 350, mover: 'b' }), 'blunder'));
t('Schwarz: Weiß-Eval sinkt = gut für Schwarz', () => assert.strictEqual(k({ bestUci: 'a', playedUci: 'b', evalBefore: 0, evalAfter: -300, mover: 'b' }), 'best'));
t('Gewinnstellung: +900 -> +700 kein Fehler', () => assert.ok(['best', 'good'].includes(k({ bestUci: 'a', playedUci: 'b', evalBefore: 900, evalAfter: 700, mover: 'w' }))));
t('Matt verpasst -> verlieren = Patzer', () => assert.strictEqual(k({ bestUci: 'a', playedUci: 'b', evalBefore: C.scoreToCp({ mate: 2 }), evalAfter: C.scoreToCp({ mate: -3 }), mover: 'w' }), 'blunder'));
t('Labels deutsch', () => assert.deepStrictEqual(Object.values(C.CLASSES).map(c => c.label), ['Bester Zug', 'Gut', 'Ungenauigkeit', 'Fehler', 'Patzer']));
t('formatEval', () => { assert.strictEqual(C.formatEval({ cp: 84 }), '+0.8'); assert.strictEqual(C.formatEval({ cp: -150 }), '-1.5'); assert.strictEqual(C.formatEval({ mate: 3 }), '+M3'); assert.strictEqual(C.formatEval({ mate: -2 }), '-M2'); });
t('evalBar 50% bei 0', () => assert.strictEqual(Math.round(C.evalBarPct({ cp: 0 })), 50));

console.log('Notation & Sprache');
t('deutsche SAN', () => { assert.strictEqual(C.toGermanSan('Nf3'), 'Sf3'); assert.strictEqual(C.toGermanSan('Bxf7+'), 'Lxf7+'); assert.strictEqual(C.toGermanSan('e8=Q#'), 'e8=D#'); assert.strictEqual(C.toGermanSan('Rad1'), 'Tad1'); assert.strictEqual(C.toGermanSan('O-O'), 'O-O'); });
t('Sprache', () => { assert.strictEqual(C.sanToSpeech('Nxe5+'), 'Springer schlägt e5, Schach'); assert.strictEqual(C.sanToSpeech('O-O'), 'kurze Rochade'); assert.strictEqual(C.sanToSpeech('Qh7#'), 'Dame h7, Matt'); });
t('Zugliste parsen', () => {
  assert.strictEqual(C.parseMoveText(' f3 ', 'N'), 'Nf3');
  assert.strictEqual(C.parseMoveText('e4'), 'e4');
  assert.strictEqual(C.parseMoveText('Sf3'), 'Nf3');
  assert.strictEqual(C.parseMoveText('xe5+', 'B'), 'Bxe5+');
  assert.strictEqual(C.parseMoveText('O-O'), 'O-O');
  assert.strictEqual(C.parseMoveText('e8=Q'), 'e8=Q');
  assert.strictEqual(C.parseMoveText('1:23'), null);
});

console.log('DOM-Parsing & Tracker');
t('Figuren-Klasse', () => { assert.deepStrictEqual(C.parsePieceClass('piece wp square-52'), { code: 'wp', sq: 'e2' }); assert.deepStrictEqual(C.parsePieceClass('piece square-18 br'), { code: 'br', sq: 'a8' }); assert.strictEqual(C.parsePieceClass('highlight square-52'), null); });
function piecesOf(game) { const out = []; game.board().forEach((row, i) => row.forEach((p, f) => { if (p) out.push({ code: p.color + p.type, sq: 'abcdefgh'[f] + (8 - i) }); })); return out; }
t('Placement == FEN', () => { const g = new Chess(); g.move('e4'); assert.strictEqual(C.placementFromPieces(piecesOf(g)), g.fen().split(' ')[0]); });
t('Tracker erkennt Einzelzüge', () => {
  const tr = new C.Tracker(), g = new Chess();
  ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'O-O'].forEach(m => { g.move(m); const r = tr.update(C.placementFromPieces(piecesOf(g))); assert.strictEqual(r.type, 'move'); });
  assert.deepStrictEqual(tr.sans(), ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'O-O']);
  assert.strictEqual(tr.game.fen(), g.fen());
});
t('Tracker: zwei Züge auf einmal (Premove)', () => {
  const tr = new C.Tracker(), g = new Chess(); g.move('d4'); g.move('d5');
  const r = tr.update(C.placementFromPieces(piecesOf(g))); assert.strictEqual(r.type, 'move'); assert.strictEqual(r.count, 2);
});
t('Tracker: Zugrücknahme', () => {
  const tr = new C.Tracker(), g = new Chess();
  ['e4', 'e5', 'Nf3'].forEach(m => { g.move(m); tr.update(C.placementFromPieces(piecesOf(g))); });
  g.undo(); g.undo(); assert.strictEqual(tr.update(C.placementFromPieces(piecesOf(g))).type, 'undo'); assert.deepStrictEqual(tr.sans(), ['e4']);
});
t('Tracker: Einstieg mitten in der Partie über Zugliste', () => {
  const g = new Chess(); const ms = ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6']; ms.forEach(m => g.move(m));
  const tr = new C.Tracker(); const r = tr.update(C.placementFromPieces(piecesOf(g)), { moveList: ms });
  assert.strictEqual(r.source, 'movelist'); assert.strictEqual(tr.game.fen(), g.fen()); assert.strictEqual(C.openingName(tr.sans()), 'Sizilianisch, Najdorf');
});
t('Tracker: Fallback FEN + Seite am Zug über Markierung', () => {
  const g = new Chess('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'); g.move('Bc4');
  const map = {}; piecesOf(g).forEach(p => map[p.sq] = p.code);
  const tr = new C.Tracker(); const r = tr.update(C.placementFromPieces(piecesOf(g)), { lastMoveSquares: ['f1', 'c4'], pieceAt: s => map[s] });
  assert.strictEqual(r.source, 'fen'); assert.strictEqual(tr.game.turn(), 'b');
});

console.log('Kommentare');
function explain(fen, san, ply) { const g = new Chess(fen); const m = g.move(san); return C.explainMove(fen, m, ply || 0); }
const START = new Chess().fen();
t('Zentrum', () => assert.ok(explain(START, 'e4').some(n => /Zentrum/.test(n))));
t('Entwicklung', () => { const g = new Chess(); g.move('e4'); g.move('e5'); assert.ok(explain(g.fen(), 'Nf3', 2).some(n => /Leichtfigur/.test(n))); });
t('frühe Dame', () => { const g = new Chess(); g.move('e4'); g.move('e5'); assert.ok(explain(g.fen(), 'Qh5', 2).some(n => /Dame kommt früh/.test(n))); });
t('Rochade', () => assert.ok(explain('r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', 'O-O', 6).some(n => /Rochade/.test(n))));
t('Schlagen + Schach', () => { const n = explain('rnbqkbnr/pppp1ppp/8/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 0 3', 'Bxf7+', 4); assert.ok(n.some(x => /schlägt den Bauern auf f7/.test(x))); assert.ok(n.some(x => /Schach!/.test(x))); });
t('hängende Figur erkannt', () => { const g = new Chess(); ['e4', 'e5', 'Nf3'].forEach(m => g.move(m)); const n = explain(g.fen(), 'Qg5', 3); assert.ok(n.some(x => /Dame auf g5/.test(x)), JSON.stringify(n)); });
t('Matt', () => { const g = new Chess(); ['f3', 'e5', 'g4'].forEach(m => g.move(m)); assert.ok(explain(g.fen(), 'Qh4#', 3).some(n => /Schachmatt/.test(n))); });
t('König zieht ohne Rochade', () => { const g = new Chess(); ['e4', 'e5'].forEach(m => g.move(m)); assert.ok(explain(g.fen(), 'Ke2', 2).some(n => /Rochaderecht/.test(n))); });
t('findHanging: ungedeckter Springer', () => { const g = new Chess('4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1'); const h = C.findHanging(g, 'b'); assert.strictEqual(h[0].sq, 'd5'); });
t('findHanging: gedeckt & gleichwertig = nicht hängend', () => { const g = new Chess('4k3/4p3/3p4/8/8/8/8/3QK3 w - - 0 1'); assert.strictEqual(C.findHanging(g, 'b').length, 0); });
t('Eröffnungsnamen', () => { assert.strictEqual(C.openingName(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']), 'Spanische Partie'); assert.strictEqual(C.openingName(['d4', 'd5', 'c4', 'e6', 'Nc3']), 'Abgelehntes Damengambit'); assert.strictEqual(C.openingName([]), null); });

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
