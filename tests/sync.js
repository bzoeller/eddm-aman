// Test des Sync-Servers (V2): Regeln im Kern und zwei AMAN-Clients ueber den Node-Server.
// Aufruf: node tests/sync.js   (braucht server/node_modules: cd server && npm install)
const path = require('path'), fs = require('fs'), os = require('os'), { spawn } = require('child_process');
const AmanSync = require('../web/aman-sync.js');
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 5000) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(50)) if (fn()) return true; return false; };

(async () => {
  const { createRoom, CONFIG } = await import('../server/core.mjs');

  // 1) Regeln im Kern
  let t = 1e12, stored = null;
  const feed = { controllers: [{ callsign: 'EDDM_N_APP', facility: 5 }, { callsign: 'EDMM_STA_CTR', facility: 6 }] };
  const room = createRoom({ load: async () => stored, store: async p => { stored = p; }, feed: async () => feed, now: () => t });
  const doc = { v: 1, dir: '26', seq: { N: ['DLH1'], S: [] }, hold: [], ac: {} };
  const c1 = { cs: null }, c2 = { cs: null }, c3 = { cs: null };
  let r = await room.handle(c1, JSON.stringify({ t: 'hello', cs: 'eddm_n_app' }));
  ok(r.reply.t === 'state' && r.reply.doc === null && c1.cs === 'EDDM_N_APP', 'hello: noch kein Plan, Callsign uebernommen');
  await room.handle(c2, JSON.stringify({ t: 'hello', cs: 'EDMM_STA_CTR' }));
  r = await room.handle(c2, JSON.stringify({ t: 'plan', id: 'c1', doc }));
  ok(r.reply && r.reply.t === 'denied' && !stored, 'CTR darf den Plan nicht aendern');
  await room.handle(c3, JSON.stringify({ t: 'hello', cs: 'EDDM_S_APP' }));
  r = await room.handle(c3, JSON.stringify({ t: 'plan', id: 'c1', doc }));
  ok(r.reply && /not online/.test(r.reply.reason), 'APP-Callsign, das nicht im VATSIM-Feed steht: abgelehnt');
  r = await room.handle(c1, JSON.stringify({ t: 'plan', id: 'c7', doc }));
  ok(r.broadcast && r.broadcast.rev === 1 && r.broadcast.by === 'EDDM_N_APP' && r.broadcast.id === 'c7', 'APP online: angenommen und an alle verteilt (rev 1)');
  r = await room.handle(c1, JSON.stringify({ t: 'plan', id: 'c8', doc: { v: 2 } }));
  ok(r.reply && r.reply.t === 'denied', 'ungueltiges Dokument abgelehnt');
  r = await room.handle(c1, 'x'.repeat(CONFIG.maxDocBytes + 2000));
  ok(r.reply && /too large/.test(r.reply.reason), 'zu grosse Nachricht abgelehnt');
  t += 2 * 3600 * 1000 + 1;
  r = await room.handle(c2, JSON.stringify({ t: 'hello', cs: 'EDMM_STA_CTR' }));
  ok(r.reply.doc === null, 'Plan ohne Aenderung seit 2 h gilt als vorbei');

  // 2) Node-Server mit zwei Clients
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aman-sync-'));
  fs.writeFileSync(path.join(dir, 'feed.json'), JSON.stringify(feed));
  const port = +process.env.AMAN_SYNC_PORT || 8473;
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'node.mjs')],
    { env: Object.assign({}, process.env, { PORT: String(port), DATA: path.join(dir, 'plan.json'), FEED_FILE: path.join(dir, 'feed.json') }), stdio: 'ignore' });
  try {
    await wait(800);
    const url = 'ws://127.0.0.1:' + port + '/ws';
    const got = { app: [], ctr: [] }, st = {};
    const app = AmanSync.connect({ url, callsign: () => 'EDDM_N_APP', onPlan: (d, by) => got.app.push({ d, by }), onStatus: s => { st.app = s; } });
    const ctr = AmanSync.connect({ url, callsign: () => 'EDMM_STA_CTR', onPlan: (d, by) => got.ctr.push({ d, by }), onStatus: s => { st.ctr = s; } });
    ok(await until(() => got.app.length && got.ctr.length), 'beide verbunden und haben den (leeren) Plan bekommen');
    app.publish(doc);
    ok(await until(() => got.ctr.length > 1), 'CTR bekommt den Plan von APP');
    const last = got.ctr[got.ctr.length - 1];
    ok(last.by === 'EDDM_N_APP' && last.d.seq.N[0] === 'DLH1', 'Inhalt und Absender stimmen');
    await wait(300);
    ok(got.app.length === 1, 'APP uebernimmt seinen eigenen Plan nicht noch einmal');
    ctr.publish(doc);
    ok(await until(() => st.ctr && /only EDDM APP/.test(st.ctr.error || '')), 'CTR bekommt eine Ablehnung angezeigt');
    // Neuer Client nach Neustart des Servers: Plan bleibt erhalten
    app.close(); ctr.close();
    srv.kill(); await wait(300);
    const srv2 = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'node.mjs')],
      { env: Object.assign({}, process.env, { PORT: String(port), DATA: path.join(dir, 'plan.json'), FEED_FILE: path.join(dir, 'feed.json') }), stdio: 'ignore' });
    await wait(800);
    const later = [];
    const twr = AmanSync.connect({ url, callsign: () => 'EDDM_TWR', onPlan: (d, by) => later.push({ d, by }) });
    ok(await until(() => later.length) && later[0].d && later[0].by === 'EDDM_N_APP', 'nach Neustart des Servers ist der Plan noch da');
    twr.close(); srv2.kill();
  } finally { srv.kill(); }

  console.log(fails ? fails + ' Fehler' : 'alles gruen');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
