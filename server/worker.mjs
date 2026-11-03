// Betrieb auf Cloudflare Workers: ein Durable Object haelt den Plan und die WebSocket-Verbindungen.
import { createRoom, CONFIG } from './core.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      return env.ROOM.get(env.ROOM.idFromName('EDDM')).fetch(request);
    }
    return new Response('EDDM AMAN sync server\n', { headers: { 'content-type': 'text/plain' } });
  }
};

export class Room {
  constructor(ctx) {
    this.ctx = ctx;
    this.room = createRoom({
      load: () => ctx.storage.get('plan'),
      store: p => ctx.storage.put('plan', p),
      feed: async () => {
        const r = await fetch(CONFIG.feedUrl, { headers: { 'user-agent': 'eddm-aman-sync' } });
        if (!r.ok) throw new Error('feed ' + r.status);
        return r.json();
      },
      now: () => Date.now()
    });
  }
  async fetch() {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);   // Hibernation: Verbindungen ueberleben Pausen des Objekts
    pair[1].serializeAttachment({ cs: null });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async webSocketMessage(ws, msg) {
    const conn = ws.deserializeAttachment() || { cs: null };
    const out = await this.room.handle(conn, typeof msg === 'string' ? msg : '');
    ws.serializeAttachment(conn);
    if (out.reply) ws.send(JSON.stringify(out.reply));
    if (out.broadcast) {
      const s = JSON.stringify(out.broadcast);
      for (const w of this.ctx.getWebSockets()) { try { w.send(s); } catch (e) { /* Verbindung weg */ } }
    }
  }
  async webSocketClose(ws) { try { ws.close(); } catch (e) { /* schon zu */ } }
}
