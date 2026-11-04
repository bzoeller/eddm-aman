// Betrieb auf Cloudflare Workers: ein Durable Object haelt den Plan und die WebSocket-Verbindungen.
// Notschalter: Variable READONLY=1 (im Cloudflare-Dashboard unter Settings -> Variables) sperrt alle Aenderungen.
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
  constructor(ctx, env) {
    this.ctx = ctx;
    const config = Object.assign({}, CONFIG, { readonly: env && env.READONLY === '1' });
    this.room = createRoom({
      load: () => ctx.storage.get('room'),
      store: r => ctx.storage.put('room', r),
      loadFeed: () => ctx.storage.get('feed'),
      storeFeed: f => ctx.storage.put('feed', f),
      feed: async () => {
        const r = await fetch(CONFIG.feedUrl, { headers: { 'user-agent': 'eddm-aman-sync' } });
        if (!r.ok) throw new Error('feed ' + r.status);
        return r.json();
      },
      now: () => Date.now()
    }, config);
    // Pings beantwortet Cloudflare selbst, ohne das Objekt zu wecken
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }
  async fetch(request) {
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const same = this.ctx.getWebSockets().filter(w => (w.deserializeAttachment() || {}).ip === ip).length;
    if (same >= CONFIG.maxConnPerIp) return new Response('too many connections', { status: 429 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);   // Hibernation: Verbindungen ueberleben Pausen des Objekts
    pair[1].serializeAttachment({ cs: null, ip });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async webSocketMessage(ws, msg) {
    const conn = ws.deserializeAttachment() || { cs: null };
    const peers = this.ctx.getWebSockets().map(w => (w === ws ? conn : (w.deserializeAttachment() || {})));
    const out = await this.room.handle(conn, typeof msg === 'string' ? msg : '', peers);
    ws.serializeAttachment(conn);
    if (out.close) { try { ws.close(1008, 'too many messages'); } catch (e) { /* schon zu */ } return; }
    if (out.reply) ws.send(JSON.stringify(out.reply));
    if (out.broadcast) {
      const s = JSON.stringify(out.broadcast);
      for (const w of this.ctx.getWebSockets()) { if (out.except && w === ws) continue; try { w.send(s); } catch (e) { /* Verbindung weg */ } }
    }
  }
  async webSocketClose(ws) { try { ws.close(); } catch (e) { /* schon zu */ } }
}
