# ♞ Chess Coach Live (Deutsch)

Userscript (Tampermonkey/Violentmonkey) für **Chess.com**: kommentiert jeden Zug live auf Deutsch –
Zugbewertung (Bester Zug / Gut / Ungenauigkeit / Fehler / Patzer), Bewertungsbalken, Eröffnungsname,
Erklärungen (hängende Figuren, verpasste Schlagzüge, Schach, Zentrum, Entwicklung, Königssicherheit) und Tipps.
Optional mit deutscher Sprachausgabe.

**Installation:** https://botgrok558-ux.github.io/chess-coach/
**Direkt-Link:** https://raw.githubusercontent.com/botgrok558-ux/chess-coach/main/chess-coach.user.js

## Fair Play (fest eingebaut, kein Schalter)
Tipps, Pfeile und Engine-Bewertung nur auf diesen Pfaden:
`/play/computer`, `/game/computer`, `/analysis`, `/practice`, `/puzzles`, `/lessons`.
Überall sonst (z. B. `/play/online`, `/game/live`, `/game/daily`) zeigt das Panel nur
„Live gegen Menschen: Tipps aus (Fair Play). Analyse nach der Partie verfügbar.“ – die Engine rechnet dort während der Partie gar nicht.
Erst nach erkanntem Spielende (Matt/Patt/Remis auf dem Brett oder Game-Over-Fenster bzw. Ergebnis in der Zugliste) startet die Analyse der gespielten Züge.

## Technik
- Liest die Stellung aus dem DOM (`wc-chess-board .piece.wp.square-52`), Orientierung über `.flipped`, Zugliste als Fallback.
- Erkennt Züge per Abgleich mit allen legalen Zügen (chess.js 0.10.3), auch Doppelzüge (Premove) und Zurücknahmen.
- Stockfish 10 (asm.js, `stockfish.js@10.0.2` von jsDelivr, Fallback unpkg) als Blob-Web-Worker, Tiefe 14 / max. 1,5 s pro Stellung.

## Tests
```
npm install
npm test           # Logik: Fair-Play-Gate, Zugbewertung, Notation, Tracker, Kommentare
npm run test:e2e   # Headless Chrome mit test/board.html (nachgebautes chess.com-DOM) + echter Stockfish
```

## Grenzen
- Chess.com kann sein HTML jederzeit ändern – dann muss das Script angepasst werden.
- Nur Desktop-Browser mit Tampermonkey/Violentmonkey; nicht die Chess.com-App.
- Varianten (Chess960 usw.) werden nicht unterstützt.
- Die Erklärungen sind einfache Heuristiken, keine vollständige Engine-Begründung.
