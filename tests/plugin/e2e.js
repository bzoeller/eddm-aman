// Ende-zu-Ende: Plugin-Code (Linux-Testlauf) + AMAN im Browser im Plugin-Modus.
// Wird von tests/plugin/run.sh gestartet; erwartet Plugin auf 127.0.0.1:8471 und die Steuerdatei.
const { chromium } = require('playwright');
const fs = require('fs');
const [ , , dataFile, harnessPid, out ] = process.argv;
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const cmd = t => fs.appendFileSync(dataFile + '.cmd', t + '\n');
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const api = await (await fetch('http://127.0.0.1:8471/api/traffic')).json();
  ok(api.version === 1 && api.aircraft.length > 20 && api.me.callsign === 'EDDM_N_APP', '/api/traffic liefert ' + api.aircraft.length + ' Flieger, ich bin ' + api.me.callsign);
  ok(api.aircraft.every(a => typeof a.lat === 'number' && a.cs && a.star), 'Datensaetze vollstaendig (Position, Callsign, STAR)');
  // rohe Anfrage, damit ".." wirklich beim Server ankommt (fetch wuerde den Pfad normalisieren)
  const raw = target => new Promise(res => {
    const sock = require('net').connect(8471, '127.0.0.1', () => sock.write('GET ' + target + ' HTTP/1.1\r\nHost: x\r\n\r\n'));
    let d = ''; sock.on('data', x => { d += x; }); sock.on('end', () => res(d.split(' ')[1])); sock.on('error', () => res('err'));
  });
  const codes = [await raw('/../aman-core.js'), await raw('/..%2faman-core.js'), await raw('/web/../../etc/passwd'), await raw('/C:/Windows/win.ini')];
  ok(codes.every(c => c === '403' || c === '404'), 'kein Zugriff ausserhalb des Web-Ordners (' + codes.join(', ') + ')');

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 960, height: 1080 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8471/');
  await wait(6500);
  const st = await p.evaluate(() => document.getElementById('status').innerText);
  ok(/EDDM_N_APP/.test(st) && /View APP/.test(st), 'Plugin-Modus, Rolle aus dem Callsign: ' + st.replace(/\n/g, ' | '));
  const nN = await p.$$eval('.col.N .label', l => l.length), nS = await p.$$eval('.col.S .label', l => l.length);
  ok(nN > 3 && nS > 3, 'Labels aus Plugindaten: Nord ' + nN + ', Sued ' + nS);
  ok(!(await p.isVisible('#dirWarn')) && !(await p.isVisible('#stale')), 'keine Warnung bei passender Richtung und frischen Daten');
  ok(await p.evaluate(() => !document.querySelector('.clock').classList.contains('sim')), 'kein SIM-Kennzeichen im Plugin-Modus');
  await p.screenshot({ path: out + '/plugin-mode.png' });

  // EuroScope dreht die Bahn: AMAN bleibt, Warnung am Rand
  cmd('ESRWY 08L 08R');
  await wait(7000);
  ok((await p.textContent('#rwyVal')) === '26' && /EuroScope 08, AMAN 26/.test(await p.textContent('#dirWarn')), 'EuroScope 08: AMAN bleibt 26, Warnung: ' + (await p.textContent('#dirWarn')));
  // Neu laden, waehrend EuroScope auf 08 steht: AMAN uebernimmt einmalig 08, danach dreht er nicht mehr mit
  await p.reload(); await wait(6500);
  ok((await p.textContent('#rwyVal')) === '08' && !(await p.isVisible('#dirWarn')), 'beim Laden einmalig 08 aus EuroScope uebernommen');
  cmd('ESRWY 26L 26R');
  await wait(7000);
  ok((await p.textContent('#rwyVal')) === '08' && /EuroScope 26, AMAN 08/.test(await p.textContent('#dirWarn')), 'danach dreht EuroScope nicht mehr mit: ' + (await p.textContent('#dirWarn')));
  // zurueck auf 26 fuer die folgenden Tests (wie ein Lotse im AMAN)
  await p.click('#btnRwy'); await p.click('#chDir button[data-dir="26"]'); await p.check('input[name=chWhen][value=now]');
  await p.click('#btnChSet'); await p.click('#btnChSet'); await p.keyboard.press('Escape'); await wait(1500);
  ok((await p.textContent('#rwyVal')) === '26', 'AMAN von Hand zurueck auf 26');

  // Ansicht nach Login: CTR-Login bekommt nach dem Neuladen automatisch seine Ansicht, auch nach Hand-Auswahl
  await p.click('#btnMenu'); await p.selectOption('#selView', 'TWR'); await p.click('#btnClose');
  cmd('ME EDMM_STA_CTR');
  await p.reload(); await wait(6500);
  // FUE ist im Testaufbau nicht eingeloggt: STA arbeitet beide BETOS-Stroeme (combined)
  ok(/combined/.test(await p.textContent('#frameTitle')), 'EDMM_STA_CTR ohne FUE online: Ansicht automatisch ' + (await p.textContent('#frameTitle')));
  // ALB arbeitet RDG mit: ALB trackt die LANDU-Fluege -> ALB bekommt automatisch die LANDU-Stroeme
  cmd('TRACK LANDU EDMM_ALB_CTR'); cmd('ME EDMM_ALB_CTR');
  await wait(7000);
  const t1 = await p.textContent('#frameTitle'), cols = await p.$$eval('.col.C .label', l => l.length);
  ok(/CTR ALB/.test(t1) && /LULAR|NIRGO|VESUB/.test(t1) && cols > 0, 'ALB trackt LANDU-Verkehr: Ansicht ' + t1 + ', ' + cols + ' Labels');
  const lab = await p.$$eval('.col.C .label', l => l.map(x => x.getAttribute('aria-label')));
  ok(lab.every(x => / via (LULAR|NIRGO|VESUB)/.test(x)), 'nur LANDU-Stroeme in der Ansicht');
  cmd('ME EDDM_N_APP');
  await wait(6500);
  ok(/AMAN EDDM APP/.test(await p.textContent('#frameTitle')), 'Login wechselt zu EDDM_N_APP: Ansicht folgt ' + (await p.textContent('#frameTitle')));

  // Lotse aendert die Bahn eines Sued-Fliegers auf 26R (gleiche Richtung) -> springt auf Nord
  const s1 = (await p.$$eval('.col.S .label', l => l.map(x => x.dataset.cs)))[2];
  const s2 = (await p.$$eval('.col.S .label', l => l.map(x => x.dataset.cs)))[4];
  cmd('RWY ' + s1 + ' 26R');
  cmd('RWY ' + s2 + ' 08L');
  await wait(7500);
  const inN = await p.$$eval('.col.N .label', l => l.map(x => x.dataset.cs));
  const inS = await p.$$eval('.col.S .label', l => l.map(x => x.dataset.cs));
  ok(inN.includes(s1), s1 + ': Lotse setzt 26L -> 26R, Flieger springt auf Nord');
  ok(inS.includes(s2) || !inN.includes(s2), s2 + ': EuroScope traegt 08L ein (Richtungswechsel), AMAN bleibt auf Sued');
  await p.screenshot({ path: out + '/plugin-rwychange.png' });

  // Plugin faellt aus -> DATA STALE
  process.kill(+harnessPid, 'SIGTERM');
  await wait(17000);
  ok(await p.isVisible('#stale') && /DATA STALE/.test(await p.textContent('#stale')), 'Plugin weg: ' + (await p.textContent('#stale')));
  const geo = await p.evaluate(() => { const r = document.getElementById('scope').getBoundingClientRect(); return { w: r.width, h: r.height }; });
  ok(geo.w > 500 && geo.h > 800, 'Schirm bleibt bei DATA STALE in voller Groesse (' + Math.round(geo.w) + 'x' + Math.round(geo.h) + ')');
  await p.screenshot({ path: out + '/plugin-stale.png' });
  ok(errs.length === 0, 'keine JS-Fehler ' + errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' Fehler' : 'alles gruen');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
