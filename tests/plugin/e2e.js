// Ende-zu-Ende: Plugin-Code (Linux-Testlauf) + AMAN im Browser im Plugin-Modus.
// Wird von tests/plugin/run.sh gestartet; erwartet Plugin auf 127.0.0.1:8471 und die Steuerdatei.
const { chromium } = require('playwright');
const fs = require('fs');
const [ , , dataFile, harnessPid, out ] = process.argv;
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const cmd = t => fs.appendFileSync(dataFile + '.cmd', t + '\n');
const wait = ms => new Promise(r => setTimeout(r, ms));
// warten, bis eine Bedingung gilt (Daten laufen Feed -> Plugin -> Seite, jeweils im 1-5-s-Takt; CI-Rechner sind langsam)
const until = async (fn, ms = 25000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(500)) { try { if (await fn()) return true; } catch (e) { /* weiter warten */ } }
  return false;
};
const txt = sel => p.textContent(sel);
let p;
(async () => {
  const api = await (await fetch('http://127.0.0.1:8471/api/traffic')).json();
  ok(api.version === 1 && api.aircraft.length > 20 && api.me.callsign === 'EDDM_N_APP', '/api/traffic liefert ' + api.aircraft.length + ' Flieger, ich bin ' + api.me.callsign);
  ok(api.aircraft.every(a => typeof a.lat === 'number' && a.cs && a.star), 'Datensaetze vollstaendig (Position, Callsign, STAR)');
  const hf = api.aircraft.find(a => a.holding);
  ok(hf && /^(ROKIL|LANDU|BETOS|NAPSA)$/.test(hf.holding), 'TopSky-Holding (Strip-Annotation h/FIX/h) wird gelesen: ' + (hf ? hf.cs + ' haelt bei ' + hf.holding : 'keiner'));
  // rohe Anfrage, damit ".." wirklich beim Server ankommt (fetch wuerde den Pfad normalisieren)
  const raw = target => new Promise(res => {
    const sock = require('net').connect(8471, '127.0.0.1', () => sock.write('GET ' + target + ' HTTP/1.1\r\nHost: x\r\n\r\n'));
    let d = ''; sock.on('data', x => { d += x; }); sock.on('end', () => res(d.split(' ')[1])); sock.on('error', () => res('err'));
  });
  const codes = [await raw('/../aman-core.js'), await raw('/..%2faman-core.js'), await raw('/web/../../etc/passwd'), await raw('/C:/Windows/win.ini')];
  ok(codes.every(c => c === '403' || c === '404'), 'kein Zugriff ausserhalb des Web-Ordners (' + codes.join(', ') + ')');

  const b = await chromium.launch();
  p = await b.newPage({ viewport: { width: 960, height: 1080 } });
  // nie mit dem echten Sync-Server verbinden: der Test meldet sich als EDDM_N_APP
  await p.route('**/eddm.json', async r => { const j = await (await r.fetch()).json(); j.sync.url = null; j.sync.feed = false; r.fulfill({ json: j }); });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8471/');
  await until(async () => /View APP/.test(await p.evaluate(() => document.getElementById('status').innerText)) && (await p.$$('.col.S .label')).length > 3);
  const st = await p.evaluate(() => document.getElementById('status').innerText);
  ok(/EDDM_N_APP/.test(st) && /View APP/.test(st), 'Plugin-Modus, Rolle aus dem Callsign: ' + st.replace(/\n/g, ' | '));
  const nN = await p.$$eval('.col.N .label', l => l.length), nS = await p.$$eval('.col.S .label', l => l.length);
  ok(nN > 3 && nS > 3, 'Labels aus Plugindaten: Nord ' + nN + ', Sued ' + nS);
  if (hf) ok(await until(async () => /^EAT \d\d$/.test(await p.$eval('.label[data-cs="' + hf.cs + '"] .mi', x => x.textContent))), hf.cs + ' im Holding: Label zeigt EAT statt Meilen');
  ok(!(await p.isVisible('#dirWarn')) && !(await p.isVisible('#stale')), 'keine Warnung bei passender Richtung und frischen Daten');
  ok(await p.evaluate(() => !document.querySelector('.clock').classList.contains('sim')), 'kein SIM-Kennzeichen im Plugin-Modus');
  await p.screenshot({ path: out + '/plugin-mode.png' });

  // EuroScope dreht die Bahn: AMAN bleibt, Warnung am Rand
  cmd('ESRWY 08L 08R');
  await until(async () => /EuroScope 08/.test(await txt('#dirWarn')));
  ok((await p.textContent('#rwyVal')) === '26' && /EuroScope 08, AMAN 26/.test(await p.textContent('#dirWarn')), 'EuroScope 08: AMAN bleibt 26, Warnung: ' + (await p.textContent('#dirWarn')));
  // Neu laden, waehrend EuroScope auf 08 steht: AMAN uebernimmt einmalig 08, danach dreht er nicht mehr mit
  await p.reload(); await until(async () => (await txt('#rwyVal')) === '08');
  ok((await p.textContent('#rwyVal')) === '08' && !(await p.isVisible('#dirWarn')), 'beim Laden einmalig 08 aus EuroScope uebernommen');
  cmd('ESRWY 26L 26R');
  await until(async () => /EuroScope 26/.test(await txt('#dirWarn')));
  ok((await p.textContent('#rwyVal')) === '08' && /EuroScope 26, AMAN 08/.test(await p.textContent('#dirWarn')), 'danach dreht EuroScope nicht mehr mit: ' + (await p.textContent('#dirWarn')));
  // zurueck auf 26 fuer die folgenden Tests (wie ein Lotse im AMAN)
  await p.click('#btnRwy'); await p.click('#chDir button[data-dir="26"]'); await p.check('input[name=chWhen][value=now]');
  await p.click('#btnChSet'); await p.click('#btnChSet'); await p.keyboard.press('Escape'); await wait(1500);
  ok((await p.textContent('#rwyVal')) === '26', 'AMAN von Hand zurueck auf 26');

  // Ansicht nach Login: CTR-Login bekommt nach dem Neuladen automatisch seine Ansicht, auch nach Hand-Auswahl
  await p.click('#btnMenu'); await p.selectOption('#selView', 'TWR'); await p.click('#btnClose');
  cmd('ME EDMM_STA_CTR');
  await wait(1500);   // die naechste Datei des Feeds traegt den neuen Login
  await p.reload(); await until(async () => /CTR STA/.test(await txt('#frameTitle')) && /SOTOV/.test(await txt('#frameTitle')));
  // FUE und ZUG sind nicht eingeloggt: STA arbeitet laut OWNER-Liste auch FUE, also DISUN und SOTOV
  ok(/CTR STA/.test(await p.textContent('#frameTitle')) && /DISUN/.test(await p.textContent('#frameTitle')) && /SOTOV/.test(await p.textContent('#frameTitle')), 'EDMM_STA_CTR ohne FUE/ZUG online: ' + (await p.textContent('#frameTitle')));
  // nur ALB online (RDG und EGG nicht): ALB bekommt laut OWNER-Liste die LANDU-Stroeme, ohne dass schon etwas getrackt ist
  cmd('CTRL EDMM_ALB_CTR EDDM_N_APP'); cmd('ME EDMM_ALB_CTR');
  await until(async () => /CTR ALB/.test(await txt('#frameTitle')) && /LULAR/.test(await txt('#frameTitle')));
  ok(/CTR ALB/.test(await p.textContent('#frameTitle')) && /LULAR/.test(await p.textContent('#frameTitle')) && !/SOTOV|DISUN/.test(await p.textContent('#frameTitle')), 'nur ALB online: ' + (await p.textContent('#frameTitle')));
  // EGG kommt dazu: RDG-Strom geht an EGG, ALB hat keinen Zubringer mehr
  cmd('CTRL EDMM_ALB_CTR EDMM_EGG_CTR EDDM_N_APP');
  await until(async () => /no AMAN stream/.test(await txt('#frameTitle')));
  ok(/CTR ALB \(no AMAN stream\)/.test(await p.textContent('#frameTitle')) && (await p.textContent('.col.C .empty')) === 'no arrivals', 'EGG online: LANDU-Stroeme nicht mehr bei ALB (' + (await p.textContent('#frameTitle')) + ')');
  cmd('CTRL EDDM_N_APP EDMM_STA_CTR');
  // ALB arbeitet RDG mit: ALB trackt die LANDU-Fluege -> ALB bekommt automatisch die LANDU-Stroeme
  cmd('TRACK LANDU EDMM_ALB_CTR'); cmd('ME EDMM_ALB_CTR');
  await until(async () => /LULAR|NIRGO|VESUB/.test(await txt('#frameTitle')) && (await p.$$('.col.C .label')).length > 0);
  const t1 = await p.textContent('#frameTitle'), cols = await p.$$eval('.col.C .label', l => l.length);
  ok(/CTR ALB/.test(t1) && /LULAR|NIRGO|VESUB/.test(t1) && cols > 0, 'ALB trackt LANDU-Verkehr: Ansicht ' + t1 + ', ' + cols + ' Labels');
  const lab = await p.$$eval('.col.C .label', l => l.map(x => x.getAttribute('aria-label')));
  ok(lab.every(x => / via (LULAR|NIRGO|VESUB)/.test(x)), 'nur LANDU-Stroeme in der Ansicht');
  cmd('ME EDDM_N_APP');
  await until(async () => /AMAN EDDM APP/.test(await txt('#frameTitle')));
  ok(/AMAN EDDM APP/.test(await p.textContent('#frameTitle')), 'Login wechselt zu EDDM_N_APP: Ansicht folgt ' + (await p.textContent('#frameTitle')));

  // Lotse aendert die Bahn eines Sued-Fliegers auf 26R (gleiche Richtung) -> springt auf Nord
  const s1 = (await p.$$eval('.col.S .label', l => l.map(x => x.dataset.cs)))[2];
  const s2 = (await p.$$eval('.col.S .label', l => l.map(x => x.dataset.cs)))[4];
  cmd('RWY ' + s1 + ' 26R');
  cmd('RWY ' + s2 + ' 08L');
  await until(async () => (await p.$$eval('.col.N .label', l => l.map(x => x.dataset.cs))).includes(s1));
  await wait(6000);   // s2 darf auch nach einem weiteren Takt nicht springen
  const inN = await p.$$eval('.col.N .label', l => l.map(x => x.dataset.cs));
  const inS = await p.$$eval('.col.S .label', l => l.map(x => x.dataset.cs));
  ok(inN.includes(s1), s1 + ': Lotse setzt 26L -> 26R, Flieger springt auf Nord');
  ok(inS.includes(s2) || !inN.includes(s2), s2 + ': EuroScope traegt 08L ein (Richtungswechsel), AMAN bleibt auf Sued');
  await p.screenshot({ path: out + '/plugin-rwychange.png' });

  // V2: Abgleich zwischen Lotsen. Eigene Fenster mit eingetragenem Sync-Server:
  // APP (EDDM_N_APP, laut Feed online) plant, TWR sieht denselben Plan ohne eigenes Zutun.
  {
    // nachgebildeter VATSIM-Feed fuer die Seiten: ein Flieger weit draussen (ausserhalb jeder EuroScope-Reichweite)
    const feedFix = { general: { update_timestamp: new Date().toISOString() }, controllers: [], pilots: [
      { callsign: 'FEED123', latitude: 48.35, longitude: 8.9, altitude: 35000, groundspeed: 460, heading: 90,
        flight_plan: { arrival: 'EDDM', aircraft: 'A320/M-SDE2', aircraft_short: 'A320', route: 'DCT ROKIL2A' } }] };
    const withSync = async (pg, asCs, keep) => {
      await pg.route('**/vatsim-data.json', r => r.fulfill({ json: Object.assign({}, feedFix, { general: { update_timestamp: new Date().toISOString() } }) }));
      if (keep) await pg.route('**/api/traffic', async r => { const j = await (await r.fetch()).json(); j.me = { callsign: asCs, facility: '4' }; j.aircraft = j.aircraft.slice(0, keep); r.fulfill({ json: j }); });
      await pg.route('**/eddm.json', async r => { const j = await (await r.fetch()).json(); j.sync.url = process.env.AMAN_SYNC_URL; r.fulfill({ json: j }); });
      if (asCs && !keep) await pg.route('**/api/traffic', async r => { const j = await (await r.fetch()).json(); j.me = { callsign: asCs, facility: '4' }; r.fulfill({ json: j }); });
      pg.on('pageerror', e => errs.push(e.message));
      await pg.goto('http://127.0.0.1:8471/');
    };
    const page = () => b.newPage({ viewport: { width: 960, height: 1080 } });
    const pa = await page(), pt = await page();
    await withSync(pa, null); await withSync(pt, 'EDDM_TWR');
    const st = pg => pg.evaluate(() => document.getElementById('status').innerText);
    const lastLine = s => s.split(String.fromCharCode(10)).pop();
    const order = (pg, side) => pg.evaluate(sd => [...document.querySelectorAll('.col.' + sd + ' .label')].sort((x, y) => parseFloat(y.style.top) - parseFloat(x.style.top)).map(l => l.dataset.cs).join(' '), side);
    ok(await until(async () => /SYNC online/.test(await st(pa)) && /SYNC online/.test(await st(pt)) && (await pa.$$('.col.S .label')).length > 3), 'beide Fenster mit dem Sync-Server verbunden');
    ok(await until(async () => (await order(pa, 'N')) === (await order(pt, 'N')) && (await order(pa, 'S')) === (await order(pt, 'S'))), 'TWR zeigt dieselbe Reihenfolge wie APP (beide Bahnen)');
    const csH = (await pa.$$eval('.col.S .label', l => l.map(x => x.dataset.cs)))[2];
    await pa.click('.col.S .label[data-cs="' + csH + '"]'); await pa.click('#acmenu button[data-act=hold]');
    const inHold = pg => pg.$$eval('#holdList li', l => l.map(x => x.dataset.cs));
    ok(await until(async () => (await inHold(pt)).includes(csH), 10000), 'APP setzt ' + csH + ' auf HOLD: TWR sieht es sofort im Hold-Feld');
    ok(await until(async () => (await pt.isVisible('#syncNote')) && (await pt.textContent('#syncNote')) === 'EDDM_N_APP: HOLD ' + csH), 'Hinweis bei TWR: ' + (await pt.textContent('#syncNote')));
    ok(/last change EDDM_N_APP/.test(await st(pt)) && /auto order EDDM_N_APP/.test(await st(pt)), 'Status bei TWR: ' + lastLine(await st(pt)));
    await pa.click('#btnUndo');
    ok(await until(async () => !(await inHold(pt)).includes(csH), 10000), 'UNDO bei APP: ' + csH + ' auch bei TWR wieder aus dem Hold');
    // nach dem Neuladen holt sich ein Fenster den aktuellen Plan vom Server
    await pa.click('.col.S .label[data-cs="' + csH + '"]'); await pa.click('#acmenu button[data-act=hold]');
    await until(async () => (await inHold(pt)).includes(csH), 10000);
    await pt.reload();
    ok(await until(async () => (await inHold(pt)).includes(csH), 10000), 'TWR nach dem Neuladen: Plan vom Server uebernommen');
    // Verlauf im MENU
    await pa.click('#btnMenu'); await pa.click('#btnHistory');
    ok(await until(async () => /EDDM_N_APP: HOLD/.test(await pa.textContent('#histList')) && (await pa.$$('#histList button')).length > 0), 'Verlauf im MENU mit RESTORE');
    await pa.click('#btnClose');
    // nicht im VATSIM-Feed: Eingaben warten, deutliche Meldung
    const px = await page();
    await withSync(px, 'EDDM_S_APP');
    await until(async () => /SYNC online/.test(await st(px)) && (await px.$$('.col.N .label')).length > 3);
    await px.click('.col.N .label >> nth=3'); await px.click('#acmenu button[data-act=hold]');
    ok(await until(async () => /not online on VATSIM/.test(await px.textContent('#syncWarn')) && await px.isVisible('#syncWarn')), 'APP nicht im VATSIM-Feed: Meldung am Rand: ' + (await px.textContent('#syncWarn')));
    await px.close();
    // zweites Fenster mit demselben APP-Callsign: Warnung
    const pd = await page();
    await withSync(pd, null);
    ok(await until(async () => /connected twice/.test(await pa.textContent('#syncWarn'))), 'gleiches APP-Callsign zweimal verbunden: Warnung');
    await pd.close();
    // Verkehr ausserhalb der eigenen Reichweite: TWR sieht in EuroScope nur 5 Flieger, bekommt den Rest von APP
    // (laut Feed als Lotse online) und den weit entfernten FEED123 aus dem VATSIM-Feed
    const api = await (await fetch('http://127.0.0.1:8471/api/traffic')).json();
    fs.writeFileSync(process.env.AMAN_FEED_FILE, JSON.stringify({ controllers: [{ callsign: 'EDDM_N_APP', facility: 5 }],
      pilots: api.aircraft.map(a => ({ callsign: a.cs })) }));
    const pr = await page();
    await withSync(pr, 'EDDM_TWR', 5);
    const counts = async () => { const m = /(\d+) aircraft tracked \((\d+) from other controllers, (\d+) from VATSIM\)/.exec(await st(pr)); return m ? m.slice(1).map(Number) : [0, 0, 0]; };
    ok(await until(async () => { const c = await counts(); return c[1] >= 10 && c[2] === 1; }, 40000), 'TWR mit kurzer Reichweite: Flieger von APP und aus dem VATSIM-Feed (' + (await counts()).join(' / ') + ')');
    // Zeitstrahl auf 90 min, bei dichtem Testverkehr liegt der weit entfernte Flieger mit Delay sonst dahinter
    await pr.$eval('#len', el => { el.value = 90; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    ok(await until(async () => !!(await pr.$('.label[data-cs="FEED123"]')), 15000), 'FEED123 aus dem VATSIM-Feed steht als Label am Zeitstrahl');
    await pr.close();
    // Top-down: CTR ohne APP online bekommt die APP-Ansicht und darf planen, mit APP online wieder nur seine Ansicht
    const topPage = async ctl => {
      const pg = await page();
      await pg.route('**/vatsim-data.json', r => r.fulfill({ json: feedFix }));
      await pg.route('**/eddm.json', async r => { const j = await (await r.fetch()).json(); j.sync.url = process.env.AMAN_SYNC_URL; r.fulfill({ json: j }); });
      await pg.route('**/api/traffic', async r => { const j = await (await r.fetch()).json(); j.me = { callsign: 'EDMM_ALB_CTR', facility: '6' }; j.controllers = ctl; r.fulfill({ json: j }); });
      pg.on('pageerror', e => errs.push(e.message));
      await pg.goto('http://127.0.0.1:8471/');
      return pg;
    };
    const ptd = await topPage(['EDMM_ALB_CTR', 'EDDM_TWR']);
    ok(await until(async () => /control enabled \(top-down/.test(await st(ptd)) && /AMAN EDDM APP/.test(await ptd.textContent('#frameTitle'))), 'kein APP online: CTR sieht die APP-Ansicht und darf planen (top-down)');
    await ptd.close();
    const pwa = await topPage(['EDMM_ALB_CTR', 'EDDM_N_APP']);
    ok(await until(async () => /display only/.test(await st(pwa)) && /CTR ALB/.test(await pwa.textContent('#frameTitle'))), 'APP online: CTR sieht wieder seine Sektoransicht, nur Anzeige');
    await pwa.close();
    await pt.screenshot({ path: out + '/plugin-sync-twr.png' });
    await pa.close(); await pt.close();
  }

  // Plugin faellt aus -> DATA STALE
  process.kill(+harnessPid, 'SIGTERM');
  await until(() => p.isVisible('#stale'), 40000);
  ok(await p.isVisible('#stale') && /DATA STALE/.test(await p.textContent('#stale')), 'Plugin weg: ' + (await p.textContent('#stale')));
  const geo = await p.evaluate(() => { const r = document.getElementById('scope').getBoundingClientRect(); return { w: r.width, h: r.height }; });
  ok(geo.w > 500 && geo.h > 800, 'Schirm bleibt bei DATA STALE in voller Groesse (' + Math.round(geo.w) + 'x' + Math.round(geo.h) + ')');
  await p.screenshot({ path: out + '/plugin-stale.png' });
  ok(errs.length === 0, 'keine JS-Fehler ' + errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' Fehler' : 'alles gruen');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
