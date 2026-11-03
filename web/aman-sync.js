/*
 * Abgleich zwischen den AMANs der Lotsen (V2). Verbindet sich per WebSocket mit dem Sync-Server,
 * schickt nach jedem Eingriff von APP den Plan und uebernimmt Plaene der anderen.
 * Protokoll (JSON):
 *   Client -> Server: { t: 'hello', cs, app }      wer ich bin (Callsign aus EuroScope)
 *                     { t: 'plan', id, doc }       neuer Plan (nur APP, der Server prueft im VATSIM-Feed)
 *   Server -> Client: { t: 'state', rev, doc, by, id }   aktueller Plan (doc null: noch keiner)
 *                     { t: 'denied', id, reason }        Plan nicht angenommen
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AmanSync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function connect(opts) {
    const WS = opts.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    let ws = null, closed = false, retry = 1000, retryTimer = null, pingTimer = null, myId = 0;
    const status = { state: 'connecting', rev: 0, by: null, error: null, at: 0 };
    const report = () => { if (opts.onStatus) opts.onStatus(Object.assign({}, status)); };
    const send = m => { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; } return false; };

    function open() {
      if (closed || !WS) return;
      status.state = 'connecting'; report();
      try { ws = new WS(opts.url); } catch (e) { status.state = 'offline'; status.error = String(e.message || e); report(); return later(); }
      ws.onopen = () => {
        retry = 1000; status.state = 'online'; status.error = null; report();
        send({ t: 'hello', cs: opts.callsign() || null });
        clearInterval(pingTimer); pingTimer = setInterval(() => send({ t: 'ping' }), 25000);
      };
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (!m || typeof m !== 'object') return;
        if (m.t === 'state') {
          status.rev = m.rev || 0; status.by = m.by || null; status.at = Date.now(); status.error = null; report();
          // eigener Plan kommt als Bestaetigung zurueck: nicht noch einmal uebernehmen
          if (m.id && m.id === 'c' + myId && m.by === opts.callsign()) return;
          opts.onPlan(m.doc || null, m.by || null, m.rev || 0);
        } else if (m.t === 'denied') {
          status.error = String(m.reason || 'not accepted').slice(0, 200); report();
        }
      };
      ws.onclose = () => { clearInterval(pingTimer); if (!closed) { status.state = 'offline'; report(); later(); } };
      ws.onerror = () => { /* onclose folgt */ };
    }
    function later() {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(open, retry);
      retry = Math.min(30000, retry * 2);
    }
    open();
    return {
      /** Plan an alle schicken. false, wenn gerade keine Verbindung besteht. */
      publish(doc) { myId++; return send({ t: 'plan', id: 'c' + myId, doc }); },
      /** Login hat sich geaendert (z. B. von CTR auf APP). */
      hello() { send({ t: 'hello', cs: opts.callsign() || null }); },
      close() { closed = true; clearTimeout(retryTimer); clearInterval(pingTimer); if (ws) ws.close(); },
      status: () => Object.assign({}, status)
    };
  }
  return { connect };
});
