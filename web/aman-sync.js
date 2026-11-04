/*
 * Abgleich zwischen den AMANs der Lotsen (V2). Verbindet sich per WebSocket mit dem Sync-Server.
 *
 * Der gemeinsame Plan besteht aus Schluesseln (seq.N, seq.S, hold, dir, static, cl:<id>, ac:<Callsign> ...,
 * siehe AmanCore.planToKeys). Der Client haelt den Stand des Servers (mirror) und die eigenen Aenderungen,
 * die der Server noch nicht bestaetigt hat (pending). Angezeigt wird mirror plus pending.
 * - Offline oder noch nicht im VATSIM-Feed: Aenderungen bleiben in der Warteschlange und gehen spaeter raus.
 * - Konflikt (ein anderer war schneller am selben Schluessel): eigene Aenderung verworfen, deutlich gemeldet.
 *
 * Protokoll (JSON):
 *   Client -> Server: { t: 'hello', cs }  { t: 'patch', id, base, set, note, marks, auto }  { t: 'history' }
 *                     { t: 'traffic', aircraft }   (eigener Verkehr fuer die anderen, nur eingeloggte Lotsen)
 *                     { t: 'restore', id, rev }  { t: 'ping' }
 *   Server -> Client: { t: 'state', rev, keys, by, at }  { t: 'patch', rev, id, by, set, note, marks, auto }
 *                     { t: 'ack', id, rev }  { t: 'conflict', id, by, keys, auto, state }
 *                     { t: 'denied', id, code, reason }  { t: 'history', items }  { t: 'alert', text }  { t: 'pong' }
 *                     { t: 'traffic', by, at, aircraft }   (Verkehr eines anderen Lotsen)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AmanSync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function randomId() {
    const c = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : null;
    const b = new Uint8Array(12);
    if (c) c.getRandomValues(b); else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
    return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  }

  /**
   * opts: { url, callsign(): string, onView(keys, info), onStatus(status), onNote({ by, note, marks }),
   *         onHistory(items), WebSocket?, retryMs? }
   */
  function connect(opts) {
    const WS = opts.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    const RETRY_PENDING = opts.retryMs || 30000;
    let alertTimer = null, ws = null, closed = false, retry = 1000, retryTimer = null, pingTimer = null, pongTimer = null, pendingTimer = null;
    let mirror = null;            // { rev, keys } wie auf dem Server, null = noch nicht bekannt
    let pending = [];             // [{ id, base, set, note, marks, auto, sent }]
    const status = { state: 'connecting', rev: 0, by: null, error: null, alert: null, pending: 0, waiting: null };
    const report = () => { status.pending = pending.filter(p => !p.auto).length; if (opts.onStatus) opts.onStatus(Object.assign({}, status)); };
    const send = m => { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; } return false; };

    function view() {
      const k = Object.assign({}, mirror ? mirror.keys : {});
      for (const p of pending) for (const key of Object.keys(p.set)) { if (p.set[key] === null) delete k[key]; else k[key] = p.set[key]; }
      return k;
    }
    const emit = info => { if (mirror) opts.onView(view(), info || {}); };

    function flush() {
      if (!mirror) return;
      for (const p of pending) { send({ t: 'patch', id: p.id, base: p.base, set: p.set, note: p.note, marks: p.marks, auto: p.auto }); p.sent = true; }
    }
    function dropPending(id) { pending = pending.filter(p => p.id !== id); }

    function open() {
      if (closed || !WS) return;
      status.state = 'connecting'; report();
      try { ws = new WS(opts.url); } catch (e) { status.state = 'offline'; status.error = String(e.message || e); report(); return later(); }
      ws.onopen = () => {
        retry = 1000; status.state = 'online'; status.error = null; report();
        send({ t: 'hello', cs: opts.callsign() || null });
        clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          send({ t: 'ping' });
          // halboffene Verbindung: kommt nichts zurueck, neu verbinden
          clearTimeout(pongTimer); pongTimer = setTimeout(() => { if (ws) ws.close(); }, 10000);
        }, 20000);
      };
      ws.onmessage = ev => {
        clearTimeout(pongTimer);
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (!m || typeof m !== 'object') return;
        if (m.t === 'state') {
          mirror = { rev: m.rev || 0, keys: m.keys && typeof m.keys === 'object' ? m.keys : {} };
          status.rev = mirror.rev; status.by = m.by || null; report();
          emit({ full: true, by: m.by || null });
          flush();   // Warteschlange (z. B. offline gemachte Aenderungen) nachsenden
        } else if (m.t === 'patch') {
          if (!mirror) return;
          if (m.rev !== mirror.rev + 1) { send({ t: 'hello', cs: opts.callsign() || null }); return; }   // Luecke: neu laden
          for (const key of Object.keys(m.set || {})) { if (m.set[key] === null) delete mirror.keys[key]; else mirror.keys[key] = m.set[key]; }
          mirror.rev = m.rev; status.rev = m.rev; status.by = m.by || null;
          const mine = pending.some(p => p.id === m.id);
          if (mine) { dropPending(m.id); status.error = null; status.waiting = null; }
          report();
          emit({ by: m.by, mine });
          if (!mine && !m.auto && opts.onNote && (m.note || (m.marks && m.marks.length))) opts.onNote({ by: m.by, note: m.note, marks: m.marks || [] });
        } else if (m.t === 'ack') {
          dropPending(m.id); report(); emit({ mine: true });
        } else if (m.t === 'conflict') {
          dropPending(m.id);
          if (m.state) mirror = { rev: m.state.rev, keys: m.state.keys || {} };
          if (!m.auto) status.error = 'Change by ' + (m.by || 'another controller') + ' arrived first: your change was not applied, please redo it';
          report(); emit({ conflict: true, by: m.by });
        } else if (m.t === 'traffic') {
          // Verkehr eines anderen Lotsen (Flieger ausserhalb der eigenen Reichweite)
          if (opts.onTraffic && Array.isArray(m.aircraft)) opts.onTraffic({ by: m.by || null, at: m.at, aircraft: m.aircraft });
        } else if (m.t === 'denied' && m.code === 'traffic') {
          status.trafficNote = String(m.reason || '').slice(0, 200); report();   // nur Hinweis, Plan-Warteschlange bleibt
        } else if (m.t === 'denied') {
          if (m.code === 'offline') {
            // noch nicht im VATSIM-Feed: Warteschlange behalten und spaeter erneut senden
            status.waiting = m.reason || 'waiting'; report();
            clearTimeout(pendingTimer); pendingTimer = setTimeout(flush, RETRY_PENDING);
          } else {
            // ungueltig: nur diese Aenderung verwerfen; keine Berechtigung: alle eigenen, sie wuerden nie angenommen
            pending = m.code === 'invalid' || m.code === 'size' ? pending.filter(p => p.id !== m.id) : [];
            status.error = String(m.reason || 'not accepted').slice(0, 200); report(); emit({ denied: true });
          }
        } else if (m.t === 'alert') {
          // Warnung (z. B. Callsign doppelt verbunden) bleibt 60 s sichtbar, der Server wiederholt sie bei Bedarf
          status.alert = String(m.text || '').slice(0, 200); report();
          clearTimeout(alertTimer); alertTimer = setTimeout(() => { status.alert = null; report(); }, 60000);
        } else if (m.t === 'history') {
          if (opts.onHistory) opts.onHistory(Array.isArray(m.items) ? m.items : []);
        }
      };
      ws.onclose = () => { clearInterval(pingTimer); clearTimeout(pongTimer); if (!closed) { status.state = 'offline'; report(); later(); } };
      ws.onerror = () => { /* onclose folgt */ };
    }
    function later() {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(open, retry);
      retry = Math.min(30000, retry * 2);
    }
    open();
    return {
      /** Eigene Aenderung (nur geaenderte Schluessel). auto: automatische Reihenfolge, ohne Meldung bei Konflikt. */
      change(set, note, marks, auto) {
        if (!set || !Object.keys(set).length) return;
        if (auto) pending = pending.filter(p => !(p.auto && Object.keys(p.set).join() === Object.keys(set).join()));
        const p = { id: randomId(), base: mirror ? mirror.rev : 0, set, note: note || null, marks: marks || [], auto: !!auto, sent: false };
        pending.push(p);
        report();
        if (mirror && send({ t: 'patch', id: p.id, base: p.base, set: p.set, note: p.note, marks: p.marks, auto: p.auto })) p.sent = true;
      },
      /** Aktuell angezeigter Plan (Server plus eigene unbestaetigte Aenderungen), null vor der ersten Verbindung. */
      view: () => (mirror ? view() : null),
      /** Serverseitiger Stand (ohne eigene Warteschlange). */
      serverKeys: () => (mirror ? Object.assign({}, mirror.keys) : null),
      history() { send({ t: 'history' }); },
      /** Eigenen Verkehr (EuroScope) an die anderen Lotsen schicken. */
      traffic(aircraft) { if (mirror) { status.trafficNote = null; send({ t: 'traffic', aircraft }); } },
      restore(rev) { send({ t: 'restore', id: randomId(), rev }); },
      /** Login hat sich geaendert (z. B. von CTR auf APP). */
      hello() { status.alert = null; send({ t: 'hello', cs: opts.callsign() || null }); },
      clearError() { status.error = null; report(); },
      close() { closed = true; clearTimeout(retryTimer); clearTimeout(pendingTimer); clearInterval(pingTimer); clearTimeout(pongTimer); if (ws) ws.close(); },
      status: () => Object.assign({}, status)
    };
  }
  return { connect, randomId };
});
