// Browsertest fuer das EDDM AMAN.
// Aufruf: im Repo-Ordner 'python3 -m http.server 8090' starten, dann 'node tests/func.js [Ordner fuer Screenshots]'
const { chromium } = require('playwright');
const URL = process.env.AMAN_URL || 'http://localhost:8090/index.html';
const out = process.argv[2] || '/tmp';
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const labelsIn = (p, side) => p.$$eval('.col.' + side + ' .label', l => l.map(x => x.dataset.cs));

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL);
  await p.waitForTimeout(2000);
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
  await p.waitForTimeout(200);
  const items = await p.$$eval('#acmenu button', l => l.map(x => x.textContent));
  ok(await p.isVisible('#acmenu') && /CHANGE RWY/.test(items[0]) && items[1] === 'HOLD' && items[2] === 'RECOMPUTE', 'Menue: ' + items.join(' | '));
  await p.screenshot({ path: out + '/menu.png' });

  // 3) HOLD
  await p.click('#acmenu button[data-act=hold]'); await p.waitForTimeout(300);
  ok((await p.$$eval('#holdList li', l => l.map(x => x.textContent))).includes(csN), csN + ' im Hold');
  ok(!(await labelsIn(p, 'N')).includes(csN), csN + ' nicht mehr auf Nord');

  // 4) Aus dem Hold per Menue: RECOMPUTE plant ihn wieder nach ETA ein
  await p.click('#holdList li[data-cs="' + csN + '"]'); await p.waitForTimeout(200);
  ok(await p.$eval('#acmenu button[data-act=hold]', x => x.disabled), 'HOLD im Hold gesperrt');
  await p.click('#acmenu button[data-act=recompute]'); await p.waitForTimeout(300);
  const back = (await labelsIn(p, 'N')).includes(csN) || (await labelsIn(p, 'S')).includes(csN);
  ok(back && !(await p.$$eval('#holdList li', l => l.map(x => x.textContent))).includes(csN), csN + ' per RECOMPUTE zurueck in der Sequenz');

  // 5) CHANGE RWY
  const csS = (await labelsIn(p, 'S'))[4];
  await p.click('.col.S .label[data-cs="' + csS + '"]'); await p.waitForTimeout(200);
  await p.click('#acmenu button[data-act=rwy]'); await p.waitForTimeout(300);
  ok((await labelsIn(p, 'N')).includes(csS), csS + ' per CHANGE RWY auf Nord');
  // RECOMPUTE holt ihn auf die Standardbahn zurueck
  await p.click('.col.N .label[data-cs="' + csS + '"]'); await p.waitForTimeout(200);
  await p.click('#acmenu button[data-act=recompute]'); await p.waitForTimeout(300);
  ok((await labelsIn(p, 'S')).includes(csS), csS + ' per RECOMPUTE wieder auf Sued');

  // 6) Escape und Klick daneben schliessen das Menue
  await p.click('.col.S .label >> nth=2'); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  ok(!(await p.isVisible('#acmenu')), 'Escape schliesst Menue');
  await p.click('.col.S .label >> nth=2'); await p.waitForTimeout(150);
  const fb = await (await p.$('.rwybox')).boundingBox();
  await p.mouse.click(fb.x + fb.width / 2, fb.y + fb.height + 30); await p.waitForTimeout(100);
  ok(!(await p.isVisible('#acmenu')), 'Klick daneben schliesst Menue');

  // 7) Aus dem Hold auf eine Bahn ziehen
  const csH = (await labelsIn(p, 'S'))[5];
  await p.click('.col.S .label[data-cs="' + csH + '"]'); await p.waitForTimeout(150);
  await p.click('#acmenu button[data-act=hold]'); await p.waitForTimeout(300);
  const lb = await (await p.$('#holdList li')).boundingBox();
  const sb = await (await p.$('.col.S')).boundingBox();
  await p.mouse.move(lb.x + 20, lb.y + 8); await p.mouse.down();
  await p.mouse.move(lb.x + 40, lb.y + 30, { steps: 5 });
  await p.mouse.move(sb.x + sb.width / 2, sb.y + sb.height - 160, { steps: 10 });
  await p.mouse.up(); await p.waitForTimeout(400);
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
  for (const v of ['BETOS-FUE', 'BETOS-STA', 'BETOS']) {
    await p.click('#btnMenu'); await p.selectOption('#selView', v); await p.click('#btnClose');
    await p.waitForTimeout(300);
    counts[v] = (await p.$$('.col.C .label')).length;
    if (v === 'BETOS') {
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
  await p.waitForTimeout(300);
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
  await p.click('#btnRwy'); await p.waitForTimeout(200);
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
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
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
    await p.click('.col.S .label[data-cs="' + csU + '"]'); await p.waitForTimeout(150);
    await p.click('#acmenu button[data-act=hold]'); await p.waitForTimeout(300);
    ok((await p.$$eval('#holdList li', l => l.map(x => x.textContent))).includes(csU), 'UNDO-Test: ' + csU + ' im Hold');
    await p.click('#btnUndo'); await p.waitForTimeout(300);
    ok(!(await p.$$eval('#holdList li', l => l.map(x => x.textContent))).includes(csU) && (await labelsIn(p, 'S')).includes(csU), 'UNDO holt ' + csU + ' zurueck auf Sued');
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
  await w.goto(URL); await w.waitForTimeout(1500);
  ok(await w.evaluate(() => window.__xss === undefined) && (await w.$$eval('.label .cs', l => l.some(x => x.textContent.startsWith('<IMG')))), 'Callsign mit HTML wird als Text gezeigt, nicht ausgefuehrt');
  const warnTxt = await w.textContent('#dirWarn');
  ok((await w.textContent('#rwyVal')) === '26', 'AMAN bleibt auf 26, obwohl EuroScope 08 meldet');
  ok(await w.isVisible('#dirWarn') && /EuroScope 08, AMAN 26/.test(warnTxt), 'Warnung am Rand: ' + warnTxt);
  await w.screenshot({ path: out + '/mismatch.png' });
  await w.close();

  // 12) Telefon
  const q = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  q.on('pageerror', e => errs.push(e.message));
  await q.goto(URL); await q.waitForTimeout(1500);
  await (await q.$$('.col.S .label'))[2].tap(); await q.waitForTimeout(300);
  const mb = await (await q.$('#acmenu')).boundingBox();
  ok(await q.isVisible('#acmenu') && mb.x >= 0 && mb.x + mb.width <= 390, 'Telefon: Menue per Tap, im Bild');
  ok(await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Telefon: kein seitliches Scrollen');
  await q.screenshot({ path: out + '/phone.png' });
  ok(errs.length === 0, 'keine JS-Fehler am Telefon ' + errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' Fehler' : 'alles gruen');
  process.exit(fails ? 1 : 0);
})();
