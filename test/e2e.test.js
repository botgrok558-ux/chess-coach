// Headless Chrome test: loads test/board.html (chess.com-like DOM) with the real userscript
// and the real Stockfish from jsDelivr. Run: node test/e2e.test.js
const puppeteer = require('puppeteer-core');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : 'application/javascript' }); fs.createReadStream(f).pipe(res);
});
let pass = 0, fail = 0;
function check(name, cond, extra) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? '\n    ' + extra : '')); } }
(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 760 });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto(`http://localhost:${port}/test/board.html`);
  await page.waitForSelector('#cc-panel');
  const text = () => page.$eval('#cc-body', e => e.innerText);
  const waitText = (re, ms = 30000) => page.waitForFunction(r => new RegExp(r).test(document.querySelector('#cc-body').innerText), { timeout: ms }, re.source);

  console.log('Modus: gegen Computer (/play/computer)');
  await page.evaluate(() => setUrl('https://www.chess.com/play/computer'));
  await waitText(/Tipp: spiele/, 60000);
  check('Engine liefert Tipp in Startstellung', /Tipp: spiele/.test(await text()));
  check('Bewertungsbalken sichtbar', await page.$('.cc-bar') !== null);
  check('Pfeil gezeichnet', await page.$eval('#cc-arrows', e => e.innerHTML.includes('polygon')));
  const engineName = await page.evaluate(() => window.__ChessCoach.state.engine.name);
  check('Stockfish geladen (' + engineName + ')', /Stockfish/.test(engineName));
  const waitEval = n => page.waitForFunction(n => { const s = window.__ChessCoach.state; return s.tracker.history.length === n && s.evals[s.tracker.game.fen()]; }, { timeout: 30000 }, n);
  let ply = 0;
  for (const m of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']) { await page.evaluate(s => play(s), m); await waitEval(++ply); }
  let t = await text();
  check('Eröffnung erkannt: Italienische Partie', /Italienische Partie/.test(t), t);
  check('Zug klassifiziert (3. Lc4)', /3\. Lc4/.test(t) && /(Bester Zug|Gut|Ungenauigkeit|Fehler|Patzer)/.test(t), t);
  await page.evaluate(() => play('Nd4')); // Blackburne-Schilling: dubious
  await waitEval(++ply);
  await page.evaluate(() => play('Nxe5')); // engine considers this a mistake/blunder (Qg5!)
  await page.waitForFunction(() => /4\. Sxe5/.test(document.querySelector('#cc-body').innerText) && /(Bester Zug|Gut|Ungenauigkeit|Fehler|Patzer)/.test(document.querySelector('#cc-body').innerText), { timeout: 30000 });
  t = await text();
  console.log('    Panel:\n      ' + t.split('\n').slice(0, 14).join('\n      '));
  check('Sxe5 als Fehler/Patzer/Ungenauigkeit erkannt', /(Fehler|Patzer|Ungenauigkeit)/.test(t), t);
  check('Erklärung "Besser war" vorhanden', /Besser war/.test(t), t);
  await page.screenshot({ path: path.join(root, 'test', 'screenshot-computer.png') });

  console.log('Modus: Live gegen Menschen (/game/live)');
  await page.evaluate(() => { resetGame(); setUrl('https://www.chess.com/game/live/123456'); });
  await waitText(/Live gegen Menschen/);
  for (const m of ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6']) { await page.evaluate(s => play(s), m); await new Promise(r => setTimeout(r, 400)); }
  t = await text();
  check('Nur der neutrale Hinweis', t.trim() === 'Live gegen Menschen: Tipps aus (Fair Play). Analyse nach der Partie verfügbar.', JSON.stringify(t));
  check('Kein Bewertungsbalken', await page.$('.cc-bar') === null);
  check('Kein Pfeil', await page.$eval('#cc-arrows', e => e.innerHTML === ''));
  await page.evaluate(() => play('Qxf7#'));
  await waitText(/Partie beendet/, 10000);
  await waitText(/Genauigkeit/, 90000);
  t = await text();
  check('Nach Spielende: Analyse mit Zusammenfassung', /Genauigkeit/.test(t), t);
  check('Patzer 3... Sf6 erkannt (Matt übersehen)', /3\.\.\. Sf6/.test(t) && /Patzer/.test(t), t);
  await page.screenshot({ path: path.join(root, 'test', 'screenshot-review.png') });

  console.log('Modus: /play/online + Game-Over-Fenster');
  await page.evaluate(() => { resetGame(); setUrl('https://www.chess.com/play/online'); });
  await waitText(/^Live gegen Menschen/);
  const evalCountStart = await page.evaluate(() => Object.keys(window.__ChessCoach.state.evals).length);
  for (const m of ['d4', 'd5', 'c4', 'e6']) { await page.evaluate(s => play(s), m); await new Promise(r => setTimeout(r, 400)); }
  const evalCountLive = await page.evaluate(() => Object.keys(window.__ChessCoach.state.evals).length);
  check('Engine rechnet während Live-Partie NICHT', evalCountLive === evalCountStart, evalCountStart + ' -> ' + evalCountLive);
  check('Weiterhin nur Hinweis', (await text()).trim().startsWith('Live gegen Menschen'));
  await page.evaluate(() => showGameOver());
  await waitText(/Genauigkeit/, 90000);
  t = await text();
  check('Game-Over-Fenster startet Analyse', /Genauigkeit/.test(t) && /Abgelehntes Damengambit|Damengambit/.test(t), t);
  await page.evaluate(() => { resetGame(); });
  await waitText(/^Live gegen Menschen/, 5000);
  check('Neue Partie: wieder gesperrt', (await text()).trim() === 'Live gegen Menschen: Tipps aus (Fair Play). Analyse nach der Partie verfügbar.');

  console.log('Panel-Bedienung');
  await page.click('#cc-head button[title="Minimieren"]');
  check('Minimieren', await page.$eval('#cc-panel', e => e.classList.contains('min')));
  await page.click('#cc-head button[title="Minimieren"]');
  const before = await page.$eval('#cc-panel', e => [e.offsetLeft, e.offsetTop]);
  await page.mouse.move(before[0] + 40, before[1] + 15); await page.mouse.down(); await page.mouse.move(before[0] - 160, before[1] + 115, { steps: 5 }); await page.mouse.up();
  const after = await page.$eval('#cc-panel', e => [e.offsetLeft, e.offsetTop]);
  check('Ziehen verschiebt Panel', after[0] === before[0] - 200 && after[1] === before[1] + 100, before + ' -> ' + after);

  await browser.close(); server.close();
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
