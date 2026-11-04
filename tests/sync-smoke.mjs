// Live-Test des veroeffentlichten Sync-Servers (laeuft nach jedem Veroeffentlichen in GitHub Actions).
// Aufruf: node tests/sync-smoke.mjs wss://<server>/ws
// Prueft: Verbindung, Plan abrufbar, Ping, und dass der Server den VATSIM-Feed erreicht
// (ein erfundenes APP-Callsign muss mit "not online on VATSIM" abgelehnt werden, nicht mit "not reachable").
const url = process.argv[2];
if (!url) { console.error('Aufruf: node tests/sync-smoke.mjs wss://.../ws'); process.exit(1); }
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const got = [];
const ws = new WebSocket(url);
const wait = ms => new Promise(r => setTimeout(r, ms));
ws.onmessage = e => got.push(JSON.parse(e.data));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('keine Verbindung zu ' + url)); });
ws.send(JSON.stringify({ t: 'hello', cs: 'EDDM_ZZ_APP' }));
ws.send(JSON.stringify({ t: 'ping' }));
ws.send(JSON.stringify({ t: 'patch', id: 'smoke-' + Date.now(), base: 0, set: { hold: [] } }));
for (let i = 0; i < 40 && got.length < 3; i++) await wait(250);
const st = got.find(m => m.t === 'state'), pong = got.find(m => m.t === 'pong'), den = got.find(m => m.t === 'denied');
ok(!!st, 'Server antwortet mit dem Plan (Stand ' + (st ? st.rev : '-') + ')');
ok(!!pong, 'Ping beantwortet');
ok(den && den.code === 'offline' && /not online on VATSIM/.test(den.reason), 'VATSIM-Feed erreichbar: ' + (den ? den.reason : 'keine Antwort'));
ws.close();
console.log(fails ? fails + ' Fehler' : 'alles gruen');
process.exit(fails ? 1 : 0);
