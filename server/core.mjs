// Sync-Server des EDDM AMAN (V2): haelt den gemeinsamen Plan und verteilt Aenderungen an alle AMANs.
// Diese Datei ist unabhaengig vom Betrieb: worker.mjs (Cloudflare) und node.mjs (Docker, z. B. beim vACC)
// liefern nur Speicher, VATSIM-Abruf und Verbindungen dazu.
//
// Der Plan besteht aus einzelnen Schluesseln (seq.N, seq.S, hold, dir, static, spacing.N, cl:<id>, ac:<Callsign> ...).
// Eine Aenderung (patch) nennt die Revision, auf der sie beruht (base). Hat seitdem ein anderer Lotse einen der
// geaenderten Schluessel geaendert, wird sie als Konflikt abgelehnt und der Lotse sieht, wer schneller war.
// Aenderungen an verschiedenen Schluesseln (z. B. Nord und Sued) kommen sich nicht in die Quere.
//
// Schreiben darf nur, wer laut VATSIM-Datenfeed gerade mit einem EDDM-APP-Callsign online ist, und nur mit einer
// Verbindung je Callsign. Grenze dieser Pruefung: das Callsign meldet der AMAN selbst. Staerkerer Schutz: VATSIM-Login.

export const CONFIG = {
  writerPattern: '^EDDM_.*APP$',              // wie roles.APP in web/eddm.json (ein Test prueft das)
  feedUrl: 'https://data.vatsim.net/v3/vatsim-data.json',
  feedCacheMs: 30000,                         // VATSIM aktualisiert etwa alle 15 s
  maxAgeMs: 2 * 3600 * 1000,                  // ein Plan ohne Aenderung seit 2 h gilt als vorbei
  maxMsgBytes: 64 * 1024,
  maxKeys: 400,
  history: 20,                                // so viele Staende lassen sich wiederherstellen
  rate: { burst: 20, perSec: 2 },             // Nachrichten je Verbindung
  maxConnPerIp: 8,
  readonly: false                             // Notschalter: niemand darf aendern
};

const KEY_RE = /^(dir|static|hold|spacing\.[NS]|rate\.[NS]|seq\.[NS]|cl:[0-9.]{1,24}|ac:[A-Z0-9_-]{2,12})$/;

/** Geprueftes Callsign oder null. */
export function cleanCs(cs) {
  return typeof cs === 'string' && /^[A-Z0-9_-]{3,16}$/i.test(cs) ? cs.toUpperCase() : null;
}
const cleanText = (t, n) => (typeof t === 'string' ? t.replace(/[\u0000-\u001f]/g, ' ').slice(0, n) : null);
const cleanMarks = m => (Array.isArray(m) ? m.filter(c => typeof c === 'string' && /^[A-Z0-9_-]{2,12}$/.test(c)).slice(0, 10) : []);

/** Callsigns aller Lotsen im Feed (Grossbuchstaben). */
export function onlineControllers(feed) {
  const list = feed && Array.isArray(feed.controllers) ? feed.controllers : [];
  return list.filter(c => c && typeof c.callsign === 'string' && c.facility !== 0).map(c => c.callsign.toUpperCase());
}

/** Ratenbegrenzung je Verbindung (Token-Eimer, Zustand liegt in conn). */
export function rateOk(conn, now, rate = CONFIG.rate) {
  if (conn.tokens == null) { conn.tokens = rate.burst; conn.tAt = now; }
  conn.tokens = Math.min(rate.burst, conn.tokens + (now - conn.tAt) / 1000 * rate.perSec);
  conn.tAt = now;
  if (conn.tokens < 1) return false;
  conn.tokens -= 1;
  return true;
}

/**
 * Raum fuer einen Flughafen.
 * deps: { load(): Promise<room|null>, store(room): Promise, feed(): Promise<feed>, now(): ms,
 *         loadFeed?(): Promise<{at, list}|null>, storeFeed?(cache): Promise }
 * room = { rev, at, by, keys: { k: { v, rev, by } }, hist: [{ rev, at, by, note, values }], ids: [id] }
 */
export function createRoom(deps, config = CONFIG) {
  const writerRe = new RegExp(config.writerPattern);
  let feedCache = null, chain = Promise.resolve();

  async function online() {
    const t = deps.now();
    if (!feedCache && deps.loadFeed) feedCache = await deps.loadFeed();
    if (!feedCache || t - feedCache.at > config.feedCacheMs) {
      feedCache = { at: t, list: onlineControllers(await deps.feed()).filter(cs => writerRe.test(cs)) };
      if (deps.storeFeed) await deps.storeFeed(feedCache);
    }
    return feedCache.list;
  }
  async function room() {
    const r = await deps.load();
    const empty = { rev: r ? r.rev : 0, at: 0, by: null, keys: {}, hist: r ? r.hist || [] : [], ids: [] };
    if (!r || deps.now() - r.at > config.maxAgeMs) return empty;
    return r;
  }
  const values = r => { const o = {}; for (const k of Object.keys(r.keys)) o[k] = r.keys[k].v; return o; };
  const stateMsg = r => ({ t: 'state', rev: r.rev, keys: values(r), by: r.by, at: r.at });

  /** Doppelte Verbindungen eines schreibenden Callsigns (z. B. jemand gibt sich als der echte APP aus). */
  function doubled(cs, peers) {
    return !!cs && writerRe.test(cs) && peers.filter(p => p.cs === cs).length > 1;
  }
  const dupText = cs => cs + ' is connected twice: changes blocked. Close the second AMAN window (or someone is using your callsign).';

  async function applySet(r, set, by, note, marks, id, auto) {
    const rev = r.rev + 1;
    for (const k of Object.keys(set)) {
      if (set[k] === null) delete r.keys[k];
      else r.keys[k] = { v: set[k], rev, by };
    }
    r.rev = rev; r.at = deps.now(); r.by = by;
    if (id) r.ids = (r.ids || []).concat(id).slice(-50);
    if (!auto) r.hist = (r.hist || []).concat({ rev, at: r.at, by, note: note || null, values: values(r) }).slice(-config.history);
    await deps.store(r);
    return { t: 'patch', rev, id: id || null, by, set, note: note || null, marks: marks || [], auto: !!auto };
  }

  /** Darf conn gerade schreiben? Liefert null oder { code, reason }. */
  async function writeCheck(conn, peers) {
    if (config.readonly) return { code: 'readonly', reason: 'shared plan is read-only at the moment (maintenance)' };
    if (!conn.cs || !writerRe.test(conn.cs)) return { code: 'role', reason: 'only EDDM APP can change the plan' };
    if (doubled(conn.cs, peers)) return { code: 'double', reason: dupText(conn.cs) };
    let list;
    try { list = await online(); } catch (e) { return { code: 'offline', reason: 'VATSIM data not reachable, retrying' }; }
    if (list.indexOf(conn.cs) < 0) return { code: 'offline', reason: conn.cs + ' is not online on VATSIM yet, retrying (the network list can lag up to a minute after login)' };
    return null;
  }

  async function process(conn, raw, peers) {
    if (!rateOk(conn, deps.now(), config.rate)) return { close: true };
    if (typeof raw !== 'string' || raw.length > config.maxMsgBytes) return { reply: { t: 'denied', code: 'size', reason: 'message too large' } };
    let m; try { m = JSON.parse(raw); } catch (e) { return {}; }
    if (!m || typeof m !== 'object') return {};
    if (m.t === 'ping') return { reply: { t: 'pong' } };
    if (m.t === 'hello') {
      conn.cs = cleanCs(m.cs);
      const out = { reply: stateMsg(await room()) };
      if (doubled(conn.cs, peers)) out.broadcast = { t: 'alert', text: dupText(conn.cs) };
      return out;
    }
    if (m.t === 'history') {
      const r = await room();
      return { reply: { t: 'history', items: (r.hist || []).map(h => ({ rev: h.rev, at: h.at, by: h.by, note: h.note })).reverse() } };
    }
    const id = typeof m.id === 'string' ? m.id.slice(0, 40) : null;
    if (m.t === 'patch') {
      const r = await room();
      if (id && (r.ids || []).indexOf(id) >= 0) return { reply: { t: 'ack', id, rev: r.rev } };   // schon angekommen (Neuverbindung)
      const set = m.set;
      if (!set || typeof set !== 'object' || Array.isArray(set)) return { reply: { t: 'denied', id, code: 'invalid', reason: 'invalid change' } };
      const keys = Object.keys(set);
      if (!keys.length || keys.length > config.maxKeys || !keys.every(k => KEY_RE.test(k))) return { reply: { t: 'denied', id, code: 'invalid', reason: 'invalid change' } };
      const bad = await writeCheck(conn, peers);
      if (bad) {
        const out = { reply: Object.assign({ t: 'denied', id }, bad) };
        if (bad.code === 'double') out.broadcast = { t: 'alert', text: bad.reason };
        return out;
      }
      // Konflikt: ein anderer hat einen dieser Schluessel nach dem Stand base geaendert
      const base = typeof m.base === 'number' ? m.base : -1;
      const clash = keys.filter(k => r.keys[k] && r.keys[k].rev > base && r.keys[k].by !== conn.cs);
      if (clash.length) {
        return { reply: { t: 'conflict', id, by: r.keys[clash[0]].by, keys: clash, auto: !!m.auto, state: stateMsg(r) } };
      }
      return { broadcast: await applySet(r, set, conn.cs, cleanText(m.note, 60), cleanMarks(m.marks), id, !!m.auto) };
    }
    if (m.t === 'restore') {
      const bad = await writeCheck(conn, peers);
      if (bad) return { reply: Object.assign({ t: 'denied', id }, bad) };
      const r = await room();
      const h = (r.hist || []).find(x => x.rev === m.rev);
      if (!h) return { reply: { t: 'denied', id, code: 'invalid', reason: 'this state is no longer available' } };
      const cur = values(r), set = {};
      for (const k of Object.keys(h.values)) if (JSON.stringify(cur[k]) !== JSON.stringify(h.values[k])) set[k] = h.values[k];
      for (const k of Object.keys(cur)) if (!(k in h.values)) set[k] = null;
      if (!Object.keys(set).length) return { reply: { t: 'ack', id, rev: r.rev } };
      return { broadcast: await applySet(r, set, conn.cs, 'restored state ' + h.rev + ' (' + (h.by || '') + ')', [], id, false) };
    }
    return {};
  }

  /**
   * Eine Nachricht eines Clients verarbeiten, streng nacheinander (keine zwei Aenderungen auf derselben Revision).
   * conn = { cs, ... } (wird hier gesetzt), peers = alle Verbindungen des Raums (je { cs }).
   * Liefert { reply?, broadcast?, close? } (Objekte, die der Betrieb als JSON verschickt).
   */
  function handle(conn, raw, peers = [conn]) {
    const run = chain.then(() => process(conn, raw, peers));
    chain = run.catch(() => {});
    return run;
  }
  return { handle };
}
