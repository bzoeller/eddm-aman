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

  // 9) CTR-Ansichten fuer BETOS: FUE (West), STA (Sued), combined (beide)
  const counts = {};
  for (const v of ['BETOS-FUE', 'BETOS-STA', 'BETOS']) {
    await p.click('#btnMenu'); await p.selectOption('#selView', v); await p.click('#btnClose');
    await p.waitForTimeout(300);
    counts[v] = (await p.$$('.col.C .label')).length;
    if (v === 'BETOS') {
      const subs = await p.$$eval('.col.C .label .sub', l => [...new Set(l.map(x => x.textContent))]);
      ok(subs.includes('FUE') && subs.includes('STA'), 'combined zeigt beide Stroeme: ' + subs.join(', '));
      await p.screenshot({ path: out + '/ctr-combined.png' });
    }
    ok(!(await p.$('.col.C .label.editable')), v + ': nur Anzeige');
  }
  ok(counts['BETOS-FUE'] > 0 && counts['BETOS-STA'] > 0 && counts.BETOS >= Math.max(counts['BETOS-FUE'], counts['BETOS-STA']), 'Labels FUE ' + counts['BETOS-FUE'] + ', STA ' + counts['BETOS-STA'] + ', combined ' + counts.BETOS);
  ok(errs.length === 0, 'keine JS-Fehler ' + errs.join(' | '));

  // 10) Telefon
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
