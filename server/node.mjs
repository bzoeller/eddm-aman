// Betrieb als eigenes Programm (z. B. Docker beim vACC). Start: node node.mjs
// Umgebung: PORT (Standard 8080), DATA (Datei fuer den Plan, Standard ./plan.json),
//           FEED_FILE (nur Tests: VATSIM-Daten aus einer Datei statt aus dem Netz)
import http from 'node:http';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { createRoom, CONFIG } from './core.mjs';

const PORT = +process.env.PORT || 8080;
const DATA = process.env.DATA || './plan.json';
let plan = null;
try { plan = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) { plan = null; }

const room = createRoom({
  load: async () => plan,
  store: async p => { plan = p; fs.writeFile(DATA, JSON.stringify(p), () => {}); },
  feed: async () => {
    if (process.env.FEED_FILE) return JSON.parse(fs.readFileSync(process.env.FEED_FILE, 'utf8'));
    const r = await fetch(CONFIG.feedUrl, { headers: { 'user-agent': 'eddm-aman-sync' } });
    if (!r.ok) throw new Error('feed ' + r.status);
    return r.json();
  },
  now: () => Date.now()
}, process.env.FEED_FILE ? Object.assign({}, CONFIG, { feedCacheMs: 0 }) : CONFIG);

const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('EDDM AMAN sync server\n'); });
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: CONFIG.maxDocBytes + 1024 });
wss.on('connection', ws => {
  const conn = { cs: null };
  ws.on('message', async data => {
    const out = await room.handle(conn, data.toString());
    if (out.reply) ws.send(JSON.stringify(out.reply));
    if (out.broadcast) { const s = JSON.stringify(out.broadcast); for (const c of wss.clients) if (c.readyState === 1) c.send(s); }
  });
});
server.listen(PORT, () => console.log('EDDM AMAN sync server on port ' + PORT));
