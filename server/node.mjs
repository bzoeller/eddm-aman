// Betrieb als eigenes Programm (z. B. Docker beim vACC). Start: node node.mjs
// Umgebung: PORT (Standard 8080), DATA (Datei fuer den Plan, Standard ./plan.json),
//           READONLY=1 (Notschalter: niemand darf aendern),
//           TRUST_PROXY=1 (Client-IP aus X-Forwarded-For, wenn ein Webserver mit HTTPS davor steht),
//           FEED_FILE (nur Tests: VATSIM-Daten aus einer Datei statt aus dem Netz)
import http from 'node:http';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { createRoom, CONFIG } from './core.mjs';

const PORT = +process.env.PORT || 8080;
const DATA = process.env.DATA || './plan.json';
let saved = null;
try { saved = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) { saved = null; }

const config = Object.assign({}, CONFIG, { readonly: process.env.READONLY === '1' }, process.env.FEED_FILE ? { feedCacheMs: 0 } : {});
const room = createRoom({
  load: async () => (saved ? JSON.parse(JSON.stringify(saved)) : null),
  store: async r => { saved = JSON.parse(JSON.stringify(r)); fs.writeFile(DATA, JSON.stringify(r), () => {}); },
  feed: async () => {
    if (process.env.FEED_FILE) return JSON.parse(fs.readFileSync(process.env.FEED_FILE, 'utf8'));
    const r = await fetch(CONFIG.feedUrl, { headers: { 'user-agent': 'eddm-aman-sync' } });
    if (!r.ok) throw new Error('feed ' + r.status);
    return r.json();
  },
  now: () => Date.now()
}, config);

const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('EDDM AMAN sync server\n'); });
const wss = new WebSocketServer({ noServer: true, maxPayload: CONFIG.maxMsgBytes });
const conns = new Map();   // ws -> { cs, ip, ... }
const ipOf = req => (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress) || '';

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws')) { socket.destroy(); return; }
  const ip = ipOf(req);
  if ([...conns.values()].filter(c => c.ip === ip).length >= CONFIG.maxConnPerIp) { socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n'); return; }
  wss.handleUpgrade(req, socket, head, ws => {
    conns.set(ws, { cs: null, ip });
    ws.on('close', () => conns.delete(ws));
    ws.on('message', async data => {
      const conn = conns.get(ws);
      if (!conn) return;
      const out = await room.handle(conn, data.toString(), [...conns.values()]);
      if (out.close) { ws.close(1008, 'too many messages'); return; }
      if (out.reply) ws.send(JSON.stringify(out.reply));
      if (out.broadcast) { const s = JSON.stringify(out.broadcast); for (const c of conns.keys()) if (c.readyState === 1 && !(out.except && c === ws)) c.send(s); }
    });
  });
});
server.listen(PORT, () => console.log('EDDM AMAN sync server on port ' + PORT + (config.readonly ? ' (read-only)' : '')));
