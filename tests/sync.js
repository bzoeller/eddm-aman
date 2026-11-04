// Test des Sync-Servers (V2): Regeln im Kern und mehrere AMAN-Clients ueber den Node-Server.
// Aufruf: node tests/sync.js   (braucht server/node_modules: npm --prefix server install)
const path = require('path'), fs = require('fs'), os = require('os'), { spawn } = require('child_process');
const AmanSync = require('../web/aman-sync.js');
const cfg = require('../web/eddm.json');
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 5000) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(30)) if (fn()) return true; return false; };

(async () => {
  const { createRoom, CONFIG } = await import('../server/core.mjs');
  ok(CONFIG.writerPattern === cfg.roles.APP, 'Server und AMAN nutzen dieselbe Regel fuer APP (' + CONFIG.writerPattern + ')');
  ok(CONFIG.topDownPattern === cfg.sync.topDown, 'Server und AMAN nutzen dieselbe Regel fuer Top-down-CTR (' + CONFIG.topDownPattern + ')');

  // ---------- 1) Regeln im Kern ----------
  let t = 1e12, stored = null;
  const feed = { controllers: [{ callsign: 'EDDM_N_APP', facility: 5 }, { callsign: 'EDDM_S_APP', facility: 5 }, { callsign: 'EDMM_STA_CTR', facility: 6 }] };
  const mk = config => createRoom({ load: async () => (stored ? JSON.parse(JSON.stringify(stored)) : null), store: async r => { stored = JSON.parse(JSON.stringify(r)); }, feed: async () => feed, now: () => t }, Object.assign({}, CONFIG, config || {}));
  const room = mk();
  const n = { cs: null }, s = { cs: null }, c = { cs: null }, x = { cs: null };
  const all = [n, s, c, x];
  const H = (conn, m) => room.handle(conn, JSON.stringify(m), all);
  let r = await H(n, { t: 'hello', cs: 'eddm_n_app' });
  ok(r.reply.t === 'state' && r.reply.rev === 0 && n.cs === 'EDDM_N_APP', 'hello: leerer Plan, Callsign uebernommen');
  await H(s, { t: 'hello', cs: 'EDDM_S_APP' }); await H(c, { t: 'hello', cs: 'EDMM_STA_CTR' }); await H(x, { t: 'hello', cs: 'EDDM_X_APP' });
  r = await H(c, { t: 'patch', id: 'a', base: 0, set: { hold: ['DLH1'] } });
  ok(r.reply && r.reply.code === 'role', 'CTR darf nicht aendern');
  r = await H(x, { t: 'patch', id: 'b', base: 0, set: { hold: ['DLH1'] } });
  ok(r.reply && r.reply.code === 'offline', 'APP, der nicht im VATSIM-Feed steht: abgelehnt (wird spaeter erneut versucht)');
  r = await H(n, { t: 'patch', id: 'c', base: 0, set: { 'seq.N': ['DLH1', 'DLH2'], 'ac:DLH2': { locked: true } }, note: 'move DLH2' });
  ok(r.broadcast && r.broadcast.rev === 1 && r.broadcast.by === 'EDDM_N_APP' && r.broadcast.note === 'move DLH2', 'N-APP: angenommen und verteilt (rev 1)');
  // gleichzeitig: S-APP aendert auf dem alten Stand die Suedbahn -> kein Konflikt, beide bleiben
  r = await H(s, { t: 'patch', id: 'd', base: 0, set: { 'seq.S': ['EZY1'] } });
  ok(r.broadcast && r.broadcast.rev === 2, 'S-APP gleichzeitig an der Suedbahn: angenommen, Nord bleibt erhalten');
  // gleichzeitig am selben Teil: Konflikt, mit Namen des Schnelleren
  r = await H(s, { t: 'patch', id: 'e', base: 0, set: { 'seq.N': ['DLH2', 'DLH1'] } });
  ok(r.reply && r.reply.t === 'conflict' && r.reply.by === 'EDDM_N_APP' && r.reply.state.keys['seq.N'][0] === 'DLH1', 'S-APP auf altem Stand an der Nordbahn: Konflikt, Nord-Aenderung bleibt');
  r = await H(n, { t: 'patch', id: 'c', base: 0, set: { 'seq.N': ['DLH1', 'DLH2'] } });
  ok(r.reply && r.reply.t === 'ack' && stored.rev === 2, 'dieselbe Aenderung nach Neuverbindung erneut gesendet: nicht doppelt angewendet');
  r = await H(n, { t: 'patch', id: 'f', base: 2, set: { 'evil key': 1 } });
  ok(r.reply && r.reply.code === 'invalid', 'unbekannte Schluessel abgelehnt');
  r = await room.handle(n, 'x'.repeat(CONFIG.maxMsgBytes + 10), all);
  ok(r.reply && r.reply.code === 'size', 'zu grosse Nachricht abgelehnt');
  // Doppelte Verbindung mit demselben APP-Callsign (z. B. jemand gibt sich als N-APP aus)
  const fake = { cs: null };
  r = await room.handle(fake, JSON.stringify({ t: 'hello', cs: 'EDDM_N_APP' }), all.concat(fake));
  ok(r.broadcast && /connected twice/.test(r.broadcast.text), 'zweite Verbindung als EDDM_N_APP: Warnung an alle');
  r = await room.handle(fake, JSON.stringify({ t: 'patch', id: 'g', base: 2, set: { dir: { dir: '08' } } }), all.concat(fake));
  ok(r.reply && r.reply.code === 'double' && !stored.keys.dir, 'solange doppelt verbunden: keine Aenderung moeglich');
  // Verlauf und Wiederherstellen
  r = await H(n, { t: 'patch', id: 'h', base: 2, set: { hold: ['AFR1'] }, note: 'HOLD AFR1' });
  r = await H(n, { t: 'history' });
  ok(r.reply.items[0].note === 'HOLD AFR1' && r.reply.items.length === 3, 'Verlauf: letzte Aenderungen mit Namen und Text');
  r = await H(n, { t: 'restore', id: 'i', rev: 2 });
  ok(r.broadcast && r.broadcast.set.hold === null && /restored state 2/.test(r.broadcast.note), 'Wiederherstellen auf Stand 2: HOLD AFR1 wieder weg');
  // Verkehr teilen: nur eingeloggte Lotsen, nur Flieger, die laut Feed verbunden sind, nicht an den Absender
  feed.pilots = [{ callsign: 'DLH1' }, { callsign: 'EZY2' }];
  const ctr = { cs: null }, twr = { cs: null };
  await room.handle(ctr, JSON.stringify({ t: 'hello', cs: 'EDMM_STA_CTR' }), [ctr]); await room.handle(twr, JSON.stringify({ t: 'hello', cs: 'EDDM_TWR' }), [twr]);
  t += 31000;   // VATSIM-Daten neu holen
  r = await room.handle(ctr, JSON.stringify({ t: 'traffic', aircraft: [{ cs: 'DLH1', lat: 49, lon: 12 }, { cs: 'GHOST1', lat: 49, lon: 12 }, { cs: 'EZY2', lat: 'x', lon: 1 }] }), [ctr]);
  ok(r.broadcast && r.broadcast.t === 'traffic' && r.broadcast.by === 'EDMM_STA_CTR' && r.broadcast.aircraft.length === 1 && r.broadcast.aircraft[0].cs === 'DLH1' && r.except === ctr,
    'CTR teilt Verkehr: nur echte VATSIM-Flieger, erfundene (GHOST1) und kaputte Datensaetze verworfen, nicht zurueck an den Absender');
  r = await room.handle(twr, JSON.stringify({ t: 'traffic', aircraft: [{ cs: 'DLH1', lat: 49, lon: 12 }] }), [twr]);
  ok(r.reply && r.reply.code === 'traffic' && !r.broadcast, 'Lotse, der nicht im VATSIM-Feed steht, kann keinen Verkehr verteilen');
  // Top-down: CTR plant nur, wenn laut Feed kein APP online ist
  {
    let st2 = null; const f2 = { controllers: [{ callsign: 'EDMM_ALB_CTR', facility: 6 }, { callsign: 'EDDM_N_APP', facility: 5 }], pilots: [] };
    const room2 = createRoom({ load: async () => st2, store: async x => { st2 = JSON.parse(JSON.stringify(x)); }, feed: async () => f2, now: () => t }, Object.assign({}, CONFIG, { feedCacheMs: 0 }));
    const alb = { cs: null }, lovv = { cs: null };
    await room2.handle(alb, JSON.stringify({ t: 'hello', cs: 'EDMM_ALB_CTR' }), [alb]);
    let q = await room2.handle(alb, JSON.stringify({ t: 'patch', id: 'td1', base: 0, set: { hold: ['X1'] } }), [alb]);
    ok(q.reply && q.reply.code === 'role' && /EDDM_N_APP is online/.test(q.reply.reason), 'APP online: CTR darf nicht planen');
    f2.controllers = [{ callsign: 'EDMM_ALB_CTR', facility: 6 }, { callsign: 'LOVV_B_CTR', facility: 6 }];
    t += 1000;   // VATSIM-Daten neu lesen
    q = await room2.handle(alb, JSON.stringify({ t: 'patch', id: 'td2', base: 0, set: { hold: ['X1'] } }), [alb]);
    ok(q.broadcast && q.broadcast.by === 'EDMM_ALB_CTR', 'kein APP online: EDMM-CTR plant top-down');
    await room2.handle(lovv, JSON.stringify({ t: 'hello', cs: 'LOVV_B_CTR' }), [lovv]);
    q = await room2.handle(lovv, JSON.stringify({ t: 'patch', id: 'td3', base: 1, set: { hold: [] } }), [lovv]);
    ok(q.reply && q.reply.code === 'role', 'Wien (LOVV_B) plant auch ohne APP nicht');
  }
  // Notschalter
  const ro = mk({ readonly: true });
  r = await ro.handle(n, JSON.stringify({ t: 'patch', id: 'j', base: 99, set: { hold: [] } }), all);
  ok(r.reply && r.reply.code === 'readonly', 'Notschalter READONLY: keine Aenderungen');
  // Ratenbegrenzung
  const spam = { cs: null }; let closed = false;
  for (let i = 0; i < 40 && !closed; i++) closed = !!(await room.handle(spam, '{"t":"ping"}', [spam])).close;
  ok(closed, 'Ratenbegrenzung: Verbindung mit zu vielen Nachrichten wird getrennt');
  t += 2 * 3600 * 1000 + 1;
  r = await H(c, { t: 'hello', cs: 'EDMM_STA_CTR' });
  ok(Object.keys(r.reply.keys).length === 0, 'Plan ohne Aenderung seit 2 h gilt als vorbei');

  // ---------- 2) Node-Server mit mehreren Clients ----------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aman-sync-'));
  const feedFile = path.join(dir, 'feed.json');
  fs.writeFileSync(feedFile, JSON.stringify({ controllers: [{ callsign: 'EDDM_N_APP', facility: 5 }, { callsign: 'EDDM_S_APP', facility: 5 }] }));
  const port = +process.env.AMAN_SYNC_PORT || 8473;
  const start = () => spawn(process.execPath, [path.join(__dirname, '..', 'server', 'node.mjs')],
    { env: Object.assign({}, process.env, { PORT: String(port), DATA: path.join(dir, 'plan.json'), FEED_FILE: feedFile }), stdio: 'ignore' });
  let srv = start();
  const clients = [];
  try {
    await wait(800);
    const url = 'ws://127.0.0.1:' + port + '/ws';
    const client = cs => {
      const o = { views: [], notes: [], st: {} };
      o.c = AmanSync.connect({ url, callsign: () => cs, retryMs: 500, onView: k => o.views.push(k), onNote: x => o.notes.push(x), onStatus: z => { o.st = z; } });
      clients.push(o.c);
      return o;
    };
    const N = client('EDDM_N_APP'), S = client('EDDM_S_APP'), T = client('EDDM_TWR');
    ok(await until(() => N.views.length && S.views.length && T.views.length), 'drei AMANs verbunden');
    const last = o => o.views[o.views.length - 1] || {};
    // N und S gleichzeitig, verschiedene Bahnen, dazu zwei schnelle Eingaben von N hintereinander
    N.c.change({ hold: ['DLH1'] }, 'HOLD DLH1', ['DLH1']);
    N.c.change({ 'seq.N': ['DLH2', 'DLH3'] }, 'move DLH3', ['DLH3']);
    S.c.change({ 'seq.S': ['EZY1', 'EZY2'] }, 'move EZY2', ['EZY2']);
    const same = () => [N, S, T].every(o => JSON.stringify(o.c.view()) === JSON.stringify(N.c.serverKeys()) && o.c.status().pending === 0);
    ok(await until(same), 'zwei Schreiber gleichzeitig und zwei schnelle Eingaben: alle drei zeigen denselben Plan');
    const v = T.c.view();
    ok(v.hold[0] === 'DLH1' && v['seq.N'][1] === 'DLH3' && v['seq.S'][1] === 'EZY2', 'keine Eingabe ging verloren');
    ok(T.notes.some(x => x.by === 'EDDM_S_APP' && x.note === 'move EZY2' && x.marks[0] === 'EZY2'), 'TWR bekommt den Hinweis "EDDM_S_APP: move EZY2" mit markiertem Flieger');
    ok(!N.notes.some(x => x.by === 'EDDM_N_APP'), 'eigene Eingaben erscheinen nicht als Hinweis');
    S.c.close();
    // Offline gemachte Eingaben gehen nach dem Neustart des Servers raus
    srv.kill(); await wait(300);
    N.c.change({ 'ac:DLH9': { hold: true } }, 'HOLD DLH9');
    ok(N.c.status().pending === 1, 'Server weg: Eingabe bleibt in der Warteschlange');
    srv = start();
    ok(await until(() => N.c.status().pending === 0 && T.c.view() && T.c.view()['ac:DLH9'], 15000), 'nach dem Neustart: Eingabe nachgesendet, TWR sieht sie');
    // APP noch nicht im VATSIM-Feed: Warteschlange, automatisch nachgesendet, sobald er drin steht
    const F = client('EDDM_F_APP');
    await until(() => F.views.length);
    F.c.change({ 'rate.N': 30 }, 'rate North');
    ok(await until(() => /not online on VATSIM/.test(F.st.waiting || '')), 'neu eingeloggt, noch nicht im Feed: Meldung, Eingabe wartet');
    fs.writeFileSync(feedFile, JSON.stringify({ controllers: [{ callsign: 'EDDM_N_APP', facility: 5 }, { callsign: 'EDDM_F_APP', facility: 5 }] }));
    ok(await until(() => T.c.view()['rate.N'] === 30, 5000), 'sobald er im Feed steht: Eingabe automatisch verteilt');
    // Konflikt im echten Ablauf: F und N aendern im selben Moment dieselbe Bahn
    const before = N.c.serverKeys()['seq.N'];
    F.c.change({ 'seq.N': ['F1'] }, 'move F1'); N.c.change({ 'seq.N': ['N1'] }, 'move N1');
    ok(await until(() => [N, F, T].every(o => JSON.stringify(o.c.view()) === JSON.stringify(T.c.serverKeys()) && o.c.status().pending === 0)), 'gleichzeitig an derselben Bahn: am Ende zeigen alle denselben Plan');
    const loser = [N, F].find(o => /arrived first/.test(o.st.error || ''));
    ok(!!loser && JSON.stringify(before) !== JSON.stringify(T.c.view()['seq.N']), 'der Langsamere bekommt "Change by ... arrived first" angezeigt');
  } finally { clients.forEach(c => c.close()); srv.kill(); }

  console.log(fails ? fails + ' Fehler' : 'alles gruen');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
