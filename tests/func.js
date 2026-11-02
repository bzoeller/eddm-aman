const { chromium } = require('playwright');
// Aufruf: im Repo-Ordner 'python3 -m http.server 8090' starten, dann 'node tests/func.js'
const URL = process.env.AMAN_URL || 'http://localhost:8090/index.html';
const out = process.argv[2] || '/tmp';
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: 'dark' });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL);
  await p.waitForTimeout(2000);
  // Tempo 1x, damit sich waehrend des Tests wenig bewegt
  await p.click('#btnMenu'); await p.selectOption('#simSpeed', '1'); await p.click('#btnClose');

  // 1) Klick zeigt Details
  const labs = await p.$$('.col.N .label');
  const l3 = labs[3]; const cs3 = await l3.getAttribute('data-cs');
  await l3.click();
  await p.waitForTimeout(300);
  const dtxt = await p.textContent('#detail');
  ok(await p.isVisible('#detail') && dtxt.includes(cs3) && /ETA/.test(dtxt) && /STA/.test(dtxt), 'Detail fuer ' + cs3 + ': ' + dtxt.replace(/\s+/g, ' ').slice(0, 140));
  await p.screenshot({ path: out + '/detail.png' });

  // 2) INS HOLD
  await p.click('#detail button[data-act=hold]');
  await p.waitForTimeout(300);
  const hold = await p.$$eval('#holdList li', l => l.map(x => x.textContent));
  ok(hold.includes(cs3), 'im Hold: ' + hold);
  ok(!(await p.evaluate(cs => document.querySelector('.col.N .label[data-cs="' + cs + '"]'), cs3)), 'nicht mehr auf Nord');

  // 3) Aus Hold auf Sued ziehen, unten (frueh)
  const li = await p.$('#holdList li');
  const lb = await li.boundingBox();
  const sb = await (await p.$('.col.S')).boundingBox();
  await p.mouse.move(lb.x + 20, lb.y + 8); await p.mouse.down();
  await p.mouse.move(lb.x + 40, lb.y + 30, { steps: 5 });
  await p.mouse.move(sb.x + sb.width / 2, sb.y + sb.height - 120, { steps: 10 });
  await p.screenshot({ path: out + '/dragging.png' });
  await p.mouse.up();
  await p.waitForTimeout(400);
  const r3 = await p.evaluate(cs => { const st = document.querySelector('.col.S .label[data-cs="' + cs + '"]'); return { inS: !!st, hold: [...document.querySelectorAll('#holdList li')].map(x => x.textContent) }; }, cs3);
  ok(r3.inS && !r3.hold.includes(cs3), 'aus Hold auf Sued: ' + JSON.stringify(r3));

  // 4) Drag-Index-Bug: oberstes Label Nord ganz nach unten ziehen -> muss fast vorne landen
  const nl = await p.$$('.col.N .label');
  const top = nl[nl.length - 1]; const csTop = await top.getAttribute('data-cs');
  const tb = await top.boundingBox(); const nb = await (await p.$('.col.N')).boundingBox();
  const seqLenBefore = await p.evaluate(() => document.querySelectorAll('.col.N .label').length);
  await p.mouse.move(tb.x + 50, tb.y + 10); await p.mouse.down();
  await p.mouse.move(tb.x + 60, tb.y + 40, { steps: 5 });
  await p.mouse.move(tb.x + 50, nb.y + nb.height - 150, { steps: 10 });
  await p.mouse.up(); await p.waitForTimeout(400);
  const pos = await p.evaluate(cs => { const ls = [...document.querySelectorAll('.col.N .label')].sort((a, b) => parseFloat(b.style.top) - parseFloat(a.style.top)); return ls.findIndex(l => l.dataset.cs === cs); }, csTop);
  ok(pos >= 0 && pos <= 6, csTop + ' von oben nach unten gezogen, Position jetzt ' + pos + ' von ' + seqLenBefore);

  // 5) AUTOMATIK-Button fuer manuell platziert
  const lab = await p.$('.col.N .label[data-cs="' + csTop + '"]');
  await lab.click(); await p.waitForTimeout(200);
  const hasUnlock = await p.$('#detail button[data-act=unlock]');
  ok(!!hasUnlock, 'AUTOMATIK angeboten fuer manuell platzierten Flieger');
  if (hasUnlock) { await hasUnlock.click(); await p.waitForTimeout(200); }
  // 6) Escape schliesst
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  ok(!(await p.isVisible('#detail')), 'Escape schliesst Detail');

  // 7) Bahnwechsel per Button
  const l5 = (await p.$$('.col.N .label'))[5]; const cs5 = await l5.getAttribute('data-cs');
  await l5.click(); await p.waitForTimeout(200);
  await p.click('#detail button[data-act=swap]'); await p.waitForTimeout(300);
  ok(!!(await p.$('.col.S .label[data-cs="' + cs5 + '"]')), cs5 + ' per Button auf Sued');
  // Klick ausserhalb schliesst
  await p.mouse.click(700, 5); await p.waitForTimeout(100);
  ok(!(await p.isVisible('#detail')), 'Klick ausserhalb schliesst');

  // 8) CTR-Ansicht: nur Anzeige, Detail ohne Buttons
  await p.click('#btnMenu'); await p.selectOption('#selView', 'BETOS'); await p.click('#btnClose');
  await p.waitForTimeout(400);
  const cl = await p.$('.col.C .label');
  if (cl) {
    await cl.click(); await p.waitForTimeout(200);
    const t = await p.textContent('#detail');
    ok(/STA IAF/.test(t) && !(await p.$('#detail button[data-act=hold]')), 'CTR-Detail: ' + t.replace(/\s+/g, ' ').slice(0, 120));
    await p.screenshot({ path: out + '/ctr.png' });
  } else ok(false, 'keine CTR-Labels');
  ok(errs.length === 0, 'keine JS-Fehler ' + errs.join(' | '));

  // Telefon
  const q = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  q.on('pageerror', e => errs.push(e.message));
  await q.goto(URL); await q.waitForTimeout(1500);
  const ql = (await q.$$('.col.S .label'))[2];
  await ql.tap(); await q.waitForTimeout(300);
  const db = await (await q.$('#detail')).boundingBox();
  ok(await q.isVisible('#detail') && db.x >= 0 && db.x + db.width <= 390, 'Telefon: Detail per Tap, im Bild ' + JSON.stringify(db));
  await q.screenshot({ path: out + '/phone-detail.png' });
  ok(errs.length === 0, 'keine JS-Fehler am Telefon ' + errs.join(' | '));
  await b.close();
})();
