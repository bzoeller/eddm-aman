// Sync-Server des EDDM AMAN (V2): haelt den gemeinsamen Plan und verteilt ihn an alle AMANs.
// Diese Datei ist unabhaengig vom Betrieb: worker.mjs (Cloudflare) und node.mjs (Docker, z. B. beim vACC)
// liefern nur Speicher, VATSIM-Abruf und Verbindungen dazu.
//
// Schreiben darf nur, wer laut VATSIM-Datenfeed gerade mit einem EDDM-APP-Callsign online ist.
// Grenze dieser Pruefung: das Callsign meldet der AMAN selbst, der Server kann nicht beweisen, dass die
// Verbindung wirklich von diesem Lotsen kommt. Fuer staerkeren Schutz spaeter: VATSIM-Login (OAuth).

export const CONFIG = {
  writerRegex: /^EDDM_(?:[A-Z0-9]+_)?APP$/,   // wer aendern darf (wie roles.APP in eddm.json)
  feedUrl: 'https://data.vatsim.net/v3/vatsim-data.json',
  feedCacheMs: 30000,                         // VATSIM aktualisiert etwa alle 15 s
  maxAgeMs: 2 * 3600 * 1000,                  // ein Plan ohne Aenderung seit 2 h gilt als vorbei
  maxDocBytes: 64 * 1024
};

/** Geprueftes Callsign oder null. */
export function cleanCs(cs) {
  return typeof cs === 'string' && /^[A-Z0-9_-]{3,16}$/.test(cs.toUpperCase()) ? cs.toUpperCase() : null;
}

/** Ist das Callsign laut Feed als Lotse online? feed = geparstes vatsim-data.json */
export function isOnlineController(feed, cs) {
  const list = feed && Array.isArray(feed.controllers) ? feed.controllers : [];
  return list.some(c => c && typeof c.callsign === 'string' && c.callsign.toUpperCase() === cs && c.facility !== 0);
}

/**
 * Raum fuer einen Flughafen.
 * deps: { load(): Promise<plan|null>, store(plan): Promise, feed(): Promise<feed>, now(): ms }
 * Ein plan ist { rev, doc, by, at }.
 */
export function createRoom(deps, config = CONFIG) {
  let feedCache = null, feedAt = 0;
  async function feed() {
    const t = deps.now();
    if (!feedCache || t - feedAt > config.feedCacheMs) { feedCache = await deps.feed(); feedAt = t; }
    return feedCache;
  }
  async function current() {
    const p = await deps.load();
    if (!p || deps.now() - p.at > config.maxAgeMs) return { rev: p ? p.rev : 0, doc: null, by: null, at: 0 };
    return p;
  }
  const stateMsg = (p, id) => ({ t: 'state', rev: p.rev, doc: p.doc, by: p.by, id: id || null });

  /**
   * Eine Nachricht eines Clients verarbeiten. conn = { cs } (wird hier gesetzt).
   * Liefert { reply?, broadcast? } (Objekte, die der Betrieb als JSON verschickt).
   */
  async function handle(conn, raw) {
    if (typeof raw !== 'string' || raw.length > config.maxDocBytes + 1024) return { reply: { t: 'denied', reason: 'message too large' } };
    let m; try { m = JSON.parse(raw); } catch (e) { return {}; }
    if (!m || typeof m !== 'object') return {};
    if (m.t === 'ping') return { reply: { t: 'pong' } };
    if (m.t === 'hello') { conn.cs = cleanCs(m.cs); return { reply: stateMsg(await current()) }; }
    if (m.t !== 'plan') return {};
    const id = typeof m.id === 'string' ? m.id.slice(0, 32) : null;
    const deny = reason => ({ reply: { t: 'denied', id, reason } });
    if (!conn.cs || !config.writerRegex.test(conn.cs)) return deny('only EDDM APP can change the plan');
    if (!m.doc || typeof m.doc !== 'object' || m.doc.v !== 1) return deny('invalid plan');
    let f;
    try { f = await feed(); } catch (e) { return deny('VATSIM data not reachable, try again'); }
    if (!isOnlineController(f, conn.cs)) return deny(conn.cs + ' is not online on VATSIM (the network list can lag up to a minute after login)');
    const prev = await current();
    const p = { rev: prev.rev + 1, doc: m.doc, by: conn.cs, at: deps.now() };
    await deps.store(p);
    return { broadcast: stateMsg(p, id) };
  }
  return { handle, current };
}
