// Browsertest fuer das EDDM AMAN. Aufruf: npm test, oder 'node tests/func.js [Ordner fuer Screenshots]'.
// Startet selbst einen kleinen Webserver fuer web/ (Port AMAN_PORT, sonst frei gewaehlt).
// Mit AMAN_URL laeuft der Test gegen eine schon laufende Seite.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const out = process.argv[2] || os.tmpdir();
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const labelsIn = (p, side) => p.$$eval('.col.' + side + ' .label', l => l.map(x => x.dataset.cs));
// warten, bis etwas eintritt (statt fester Pausen); kommt es nicht, entscheidet der folgende Check
const shown = (p, sel) => p.waitForSelector(sel, { state: 'visible', timeout: 3000 }).catch(() => null);
const gone = (p, sel) => p.waitForSelector(sel, { state: 'hidden', timeout: 3000 }).catch(() => null);
const until = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 3000 }).catch(() => null);
const inHold = cs => [...document.querySelectorAll('#holdList li')].some(x => x.dataset.cs === cs);
const onSide = ([side, cs]) => !!document.querySelector('.col.' + side + ' .label[data-cs="' + cs + '"]');

function serve() {
  const root = path.join(__dirname, '..', 'web');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  const srv = http.createServer((req, res) => {
    const f = path.join(root, path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([/\\]\.\.)+/, ''));
    if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
    fs.readFile(f.endsWith(path.sep) ? f + 'index.html' : f, (e, d) => {
      if (e) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); res.end(d);
    });
  });
  return new Promise(r => srv.listen(+process.env.AMAN_PORT || 0, '127.0.0.1', () => r(srv)));
}

(async () => {
  const srv = process.env.AMAN_URL ? null : await serve();
  const URL = process.env.AMAN_URL || 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  // fester Zufall: jeder Lauf hat denselben Simulationsverkehr (sonst fehlt z. B. mal ein Strom)
  await p.addInitScript(seed => {
    let a = seed >>> 0;
    Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }, +process.env.AMAN_SEED || 11);
  await p.goto(URL);
  await shown(p, '.col.N .label');
  await p.click('#btnMenu'); await p.selectOption('#simSpeed', '1'); await p.click('#btnClose');

  // 1) Anzeige nur alle 5 s: Uhr und Labels bleiben zwischen zwei Updates stehen
  const snap = () => p.evaluate(() => [...document.querySelectorAll('.label')].map(l => l.dataset.cs + l.style.top).join());
  await p.waitForTimeout(5200);
  const s0 = await snap(); await p.waitForTimeout(1500); const s1 = await snap();
  await p.waitForTimeout(4500); const s2 = await snap();
  ok(s0 === s1, 'zwischen zwei Updates keine Aenderung');
  ok(s1 !== s2, 'nach spaetestens 5 s neue Anzeige');

  // 2) Klick oeffnet das Menue mit CHANGE RWY, HOLD, RECOMPUTE
  const csN = (await labelsIn(p, 'N'))[3];
  await p.click('.col.N .label[data-cs="' + csN + '"]');
  await shown(p, '#acmenu');
  const items = await p.$$eval('#acmenu button', l => l.map(x => x.textContent));
  ok(await p.isVisible('#acmenu') && /CHANGE RWY/.test(items[0]) && items[1] === 'HOLD' && items[2] === 'RECOMPUTE', 'Menue: ' + items.join(' | '));
  await p.screenshot({ path: out + '/menu.png' });

  // 3) HOLD
  await p.click('#acmenu button[data-act=hold]'); await until(p, inHold, csN);
  ok((await p.$$eval('#holdList li', l => l.map(x => x.dataset.cs))).includes(csN), csN + ' im Hold');
  // das Hold-Feld nimmt nur aus der Sequenz (kein Holding, keine EAT)
  ok((await p.$eval('#holdList li[data-cs="' + csN + '"]', li => li.textContent)) === csN, 'Hold-Feld zeigt nur das Callsign');
  ok(!(await labelsIn(p, 'N')).includes(csN), csN + ' nicht mehr auf Nord');

  // 4) Aus dem Hold per Menue: RECOMPUTE plant ihn wieder nach ETA ein
  await p.click('#holdList li[data-cs="' + csN + '"]'); await shown(p, '#acmenu');
  ok(await p.$eval('#acmenu button[data-act=hold]', x => x.disabled), 'HOLD im Hold gesperrt');
  await p.click('#acmenu button[data-act=recompute]'); await until(p, cs => !document.querySelector('#holdList li[data-cs="' + cs + '"]'), csN);
  const back = (await labelsIn(p, 'N')).includes(csN) || (await labelsIn(p, 'S')).includes(csN);
  ok(back && !(await p.$$eval('#holdList li', l => l.map(x => x.dataset.cs))).includes(csN), csN + ' per RECOMPUTE zurueck in der Sequenz');

  // 5) CHANGE RWY
  const csS = (await labelsIn(p, 'S'))[4];
  await p.click('.col.S .label[data-cs="' + csS + '"]'); await shown(p, '#acmenu');
  await p.click('#acmenu button[data-act=rwy]'); await until(p, onSide, ['N', csS]);
  ok((await labelsIn(p, 'N')).includes(csS), csS + ' per CHANGE RWY auf Nord');
  // RECOMPUTE holt ihn auf die Standardbahn zurueck
  await p.click('.col.N .label[data-cs="' + csS + '"]'); await shown(p, '#acmenu');
  await p.click('#acmenu button[data-act=recompute]'); await until(p, onSide, ['S', csS]);
  ok((await labelsIn(p, 'S')).includes(csS), csS + ' per RECOMPUTE wieder auf Sued');

  // 6) Escape und Klick daneben schliessen das Menue
  await p.click('.col.S .label >> nth=2'); await shown(p, '#acmenu');
  await p.keyboard.press('Escape'); await gone(p, '#acmenu');
  ok(!(await p.isVisible('#acmenu')), 'Escape schliesst Menue');
  await p.click('.col.S .label >> nth=2'); await shown(p, '#acmenu');
  const fb = await (await p.$('.rwybox')).boundingBox();
  await p.mouse.click(fb.x + fb.width / 2, fb.y + fb.height + 30); await gone(p, '#acmenu');
  ok(!(await p.isVisible('#acmenu')), 'Klick daneben schliesst Menue');

  // 7) Aus dem Hold auf eine Bahn ziehen
  const csH = (await labelsIn(p, 'S'))[5];
  await p.click('.col.S .label[data-cs="' + csH + '"]'); await shown(p, '#acmenu');
  await p.click('#acmenu button[data-act=hold]'); await until(p, inHold, csH);
  const lb = await (await p.$('#holdList li')).boundingBox();
  const sb = await (await p.$('.col.S')).boundingBox();
  await p.mouse.move(lb.x + 20, lb.y + 8); await p.mouse.down();
  await p.mouse.move(lb.x + 40, lb.y + 30, { steps: 5 });
  await p.mouse.move(sb.x + sb.width / 2, sb.y + sb.height - 160, { steps: 10 });
  await p.mouse.up(); await until(p, onSide, ['S', csH]);
  ok((await labelsIn(p, 'S')).includes(csH), csH + ' aus dem Hold auf Sued gezogen');

  // 8) Ziehen nach vorn landet vorn (nicht hinter Fliegern jenseits des Zeitstrahls)
  const nl = await p.$$('.col.N .label');
  const top = nl[nl.length - 1]; const csTop = await top.getAttribute('data-cs');
  const tb = await top.boundingBox(); const nb = await (await p.$('.col.N')).boundingBox();
  await p.mouse.move(tb.x + 50, tb.y + 10); await p.mouse.down();
  await p.mouse.move(tb.x + 60, tb.y + 40, { steps: 5 });
  await p.mouse.move(tb.x + 50, nb.y + nb.height - 170, { steps: 10 });
  await p.mouse.up(); await p.waitForTimeout(400);
  const pos = await p.evaluate(cs => [...document.querySelectorAll('.col.N .label')].sort((a, b) => parseFloat(b.style.top) - parseFloat(a.style.top)).findIndex(l => l.dataset.cs === cs), csTop);
  ok(pos >= 0 && pos <= 6, csTop + ' nach vorn gezogen, Position ' + pos);
  ok(await p.$eval('.col.N .label[data-cs="' + csTop + '"]', l => !!l.querySelector('.mantip')), csTop + ': von Hand platziert, gruene Pfeilspitze');

  // 9) CTR-Ansichten fuer BETOS: FUE (West), STA (Sued), combined (beide)
  const counts = {};
  for (const v of ['BETOS', 'BETOS-FUE', 'BETOS-STA']) {
    await p.click('#btnMenu'); await p.selectOption('#selView', v); await p.click('#btnClose');
    await p.waitForFunction(two => { const l = [...document.querySelectorAll('.col.C .label .cs')]; return l.length && (!two || new Set(l.map(x => getComputedStyle(x).color)).size === 2); }, v === 'BETOS', { timeout: 120000 }).catch(() => null);
    counts[v] = (await p.$$('.col.C .label')).length;
    if (v === 'BETOS') {
      const advs = await p.$$eval('.col.C .label .adv', l => l.map(x => x.textContent));
      ok(advs.length > 0 && advs.every(x => /^(M\.\d\d|\d{3}kt)?( ?\+\d+min)?$|^HOLD$/.test(x)), 'CTR-Labels mit Anweisung: ' + advs.slice(0, 4).join(' | '));
      // jeder Lotse kann die Anweisung im MENU ausblenden
      await p.click('#btnMenu'); await p.selectOption('#selAdvice', 'off'); await p.click('#btnClose');
      ok(await p.waitForFunction(() => !document.querySelector('.col.C .label .adv'), null, { timeout: 3000 }).then(() => true).catch(() => false), 'Anweisung im MENU ausgeblendet');
      await p.click('#btnMenu'); await p.selectOption('#selAdvice', 'on'); await p.click('#btnClose');
      // DISUN T103: weisse Schrift, SOTOV T101: gelbe Schrift in gelber Box
      const cols = await p.$$eval('.col.C .label .cs', l => [...new Set(l.map(x => getComputedStyle(x).color))]);
      ok(cols.length === 2, 'combined zeigt beide Stroeme (zwei Schriftfarben): ' + cols.join(' / '));
      await p.screenshot({ path: out + '/ctr-combined.png' });
    }
    ok(!(await p.$('.col.C .label.editable')), v + ': nur Anzeige');
  }
  ok(counts['BETOS-FUE'] > 0 && counts['BETOS-STA'] > 0 && counts.BETOS >= Math.max(counts['BETOS-FUE'], counts['BETOS-STA']), 'Labels FUE ' + counts['BETOS-FUE'] + ', STA ' + counts['BETOS-STA'] + ', combined ' + counts.BETOS);
  // Wien LOVV_B: NAPSA mit AMADI Q113 (weiss) und REDBU Q112 (rot)
  await p.click('#btnMenu'); await p.selectOption('#selView', 'NAPSA'); await p.click('#btnClose');
  // der Zufallsverkehr braucht evtl. ein paar Takte, bis beide Stroeme in der Ansicht sind
  await p.waitForFunction(() => new Set([...document.querySelectorAll('.col.C .label .cs')].map(x => getComputedStyle(x).color)).size === 2, null, { timeout: 120000 }).catch(() => null);
  const napsa = await p.$$eval('.col.C .label .cs', l => [...new Set(l.map(x => getComputedStyle(x).color))]);
  ok(napsa.length === 2, 'LOVV_B zeigt AMADI und REDBU (zwei Schriftfarben): ' + napsa.join(' / '));

  // helle Version
  await p.click('#btnMenu'); await p.selectOption('#selView', 'APP'); await p.selectOption('#selTheme', 'light'); await p.click('#btnClose');
  await p.waitForTimeout(300);
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg !== 'rgb(0, 0, 0)', 'helle Version aktiv: ' + bg);
  await p.screenshot({ path: out + '/light.png' });
  ok(errs.length === 0, 'keine JS-Fehler ' + errs.join(' | '));

  // 10) Runway Change und Bahnsperre ueber den RWY-Kasten
  await p.click('#btnMenu'); await p.selectOption('#selTheme', 'dark'); await p.selectOption('#simSpeed', '10'); await p.click('#btnClose');
  await p.click('#btnRwy'); await shown(p, '#rwyDlg');
  ok(await p.isVisible('#rwyDlg'), 'Klick auf RWY oeffnet den Dialog');
  const simNow = await p.evaluate(() => document.querySelector('.clock').textContent);
  const hm = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const fmt = m => String(Math.floor((m + 1440) % 1440 / 60)).padStart(2, '0') + ':' + String((m + 1440) % 60).padStart(2, '0');
  // Vergangenheit wird abgelehnt
  await p.fill('#chTime', fmt(hm(simNow) - 5)); await p.click('#btnChSet'); await p.waitForTimeout(100);
  ok(/in the past/.test(await p.textContent('#rwyErr')), 'Zeit in der Vergangenheit abgelehnt: ' + (await p.textContent('#rwyErr')));
  // Wechsel auf 08 in 3 Minuten (Simzeit)
  const atStr = fmt(hm(simNow) + 3);
  await p.click('#chDir button[data-dir="08"]');
  await p.fill('#chTime', atStr); await p.click('#btnChSet'); await p.waitForTimeout(100);
  ok(/08 at/.test(await p.textContent('#rwyInfo')) && (await p.textContent('#btnChSet')) === 'CONFIRM', 'Runway Change erst nach Bestaetigung: ' + (await p.textContent('#rwyInfo')));
  await p.click('#btnChSet'); await p.waitForTimeout(200);
  ok((await p.textContent('#chPlanned')).includes('08 at ' + atStr), 'geplant angezeigt: ' + (await p.textContent('#chPlanned')));
  // Bahnsperre Sued von +20 bis +35 min
  await p.selectOption('#clSide', 'S');
  await p.fill('#clFrom', fmt(hm(simNow) + 20)); await p.fill('#clTo', fmt(hm(simNow) + 35));
  await p.click('#btnAddClosure'); await p.waitForTimeout(100);
  ok(/arrivals affected/.test(await p.textContent('#rwyInfo')), 'Sperre zeigt vor dem Setzen, was passiert: ' + (await p.textContent('#rwyInfo')));
  await p.click('#btnAddClosure'); await p.waitForTimeout(200);
  ok((await p.textContent('#clList')).includes('South  ' + fmt(hm(simNow) + 20) + '-' + fmt(hm(simNow) + 35)), 'Sperre mit Uhrzeit: ' + (await p.textContent('#clList')));
  await p.keyboard.press('Escape'); await gone(p, '#rwyDlg');
  ok(!(await p.isVisible('#rwyDlg')), 'Escape schliesst den Dialog');
  ok(!!(await p.$('.scale line.rwyc')) && /RWY 08/.test(await p.$eval('.scale svg', x => x.textContent)), 'gruen gestrichelte Linie mit RWY 08 am Zeitstrahl');
  ok((await p.textContent('#rwyNext')).includes('08 ' + atStr), 'RWY-Kasten zeigt den geplanten Wechsel: ' + (await p.textContent('#rwyNext')));
  ok(!!(await p.$('.col.S .cl rect')), 'Sperre Sued schraffiert');
  const rw = await p.evaluate(() => [...document.querySelectorAll('.col.N .label')].length);
  await p.screenshot({ path: out + '/rwychange.png' });
  // automatischer Wechsel
  let switched = false;
  for (let i = 0; i < 12 && !switched; i++) { await p.waitForTimeout(3000); switched = (await p.textContent('#rwyVal')) === '08'; }
  ok(switched, 'Richtung wechselt zum Zeitpunkt automatisch auf 08');
  ok(await p.$eval('#rwyVal', x => x.classList.contains('blink')), 'neue Richtung blinkt im RWY-Kasten');
  ok(!(await p.$('.scale line.rwyc')) && (await p.textContent('#rwyNext')) === '', 'Linie nach dem Wechsel weg');
  ok(!(await p.isVisible('#dirWarn')), 'Simulation: keine Warnung, Richtungen stimmen');
  ok(errs.length === 0, 'keine JS-Fehler ' + errs.join(' | '));

  // UNDO nimmt den letzten Eingriff zurueck
  {
    const csU = (await labelsIn(p, 'S'))[3];
    await p.click('.col.S .label[data-cs="' + csU + '"]'); await shown(p, '#acmenu');
    await p.click('#acmenu button[data-act=hold]'); await until(p, inHold, csU);
    ok((await p.$$eval('#holdList li', l => l.map(x => x.dataset.cs))).includes(csU), 'UNDO-Test: ' + csU + ' im Hold');
    await p.click('#btnUndo'); await until(p, onSide, ['S', csU]);
    ok(!(await p.$$eval('#holdList li', l => l.map(x => x.dataset.cs))).includes(csU) && (await labelsIn(p, 'S')).includes(csU), 'UNDO holt ' + csU + ' zurueck auf Sued');
  }

  // 11) EuroScope dreht das AMAN nicht: Simulation meldet 08, AMAN bleibt 26 und zeigt eine Warnung
  const w = await b.newPage({ viewport: { width: 1400, height: 900 } });
  w.on('pageerror', e => errs.push(e.message));
  await w.addInitScript(() => {
    let real;
    Object.defineProperty(window, 'AmanSim', {
      configurable: true,
      get() { return real; },
      set(v) { real = { createSim: (c, o) => { const x = v.createSim(c, o); const t = x.traffic; x.traffic = () => { const d = Object.assign(t(), { activeDir: '08' }); const k = d.aircraft.findIndex(a => a.passedIaf); if (k >= 0) d.aircraft[k] = Object.assign({}, d.aircraft[k], { cs: '<img src=x onerror=window.__xss=1>' }); return d; }; return x; } }; }
    });
  });
  await w.goto(URL); await shown(w, '.label');
  ok(await w.evaluate(() => window.__xss === undefined) && (await w.$$eval('.label .cs', l => l.some(x => x.textContent.startsWith('<IMG')))), 'Callsign mit HTML wird als Text gezeigt, nicht ausgefuehrt');
  const warnTxt = await w.textContent('#dirWarn');
  ok((await w.textContent('#rwyVal')) === '26', 'AMAN bleibt auf 26, obwohl EuroScope 08 meldet');
  ok(await w.isVisible('#dirWarn') && /EuroScope 08, AMAN 26/.test(warnTxt), 'Warnung am Rand: ' + warnTxt);
  await w.screenshot({ path: out + '/mismatch.png' });
  await w.close();

  // 12) Telefon
  const q = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  q.on('pageerror', e => errs.push(e.message));
  await q.goto(URL); await shown(q, '.col.S .label');
  await (await q.$$('.col.S .label'))[2].tap(); await shown(q, '#acmenu');
  const mb = await (await q.$('#acmenu')).boundingBox();
  ok(await q.isVisible('#acmenu') && mb.x >= 0 && mb.x + mb.width <= 390, 'Telefon: Menue per Tap, im Bild');
  ok(await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Telefon: kein seitliches Scrollen');
  await q.screenshot({ path: out + '/phone.png' });
  ok(errs.length === 0, 'keine JS-Fehler am Telefon ' + errs.join(' | '));
  await b.close();
  if (srv) srv.close();
  console.log(fails ? fails + ' Fehler' : 'alles gruen');
  process.exit(fails ? 1 : 0);
})();
