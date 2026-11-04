/*
 * Verkehr aus mehreren Quellen zusammenfuehren (V2): Flieger, die das eigene EuroScope noch nicht sieht
 * (ausserhalb der eingestellten Reichweite), kommen von anderen Lotsen (z. B. CTR mit grosser Reichweite)
 * oder aus dem VATSIM-Datenfeed.
 * Rangfolge je Callsign: eigene EuroScope-Daten, dann die frischesten Daten anderer Lotsen, dann der VATSIM-Feed.
 * Aeltere Positionen werden mit Kurs und Geschwindigkeit auf die aktuelle Zeit hochgerechnet.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AmanTraffic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FEED_URL = 'https://data.vatsim.net/v3/vatsim-data.json';
  const MAX_AGE = { upload: 40, feed: 90 };   // aeltere Daten werden nicht mehr verwendet (s)
  const fin = v => typeof v === 'number' && isFinite(v);

  function distNm(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180, dlat = (lat2 - lat1) * r, dlon = (lon2 - lon1) * r;
    const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dlon / 2) ** 2;
    return 3440.065 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  /** Position um sec Sekunden entlang des Kurses weiterrechnen. */
  function extrapolate(ac, sec) {
    const trk = fin(ac.trk) ? ac.trk : ac.hdg;
    if (!(sec > 0) || !fin(trk) || !(ac.gs > 30)) return ac;
    const d = ac.gs * Math.min(sec, 120) / 3600 / 60;   // Grad Breite
    const r = trk * Math.PI / 180;
    return Object.assign({}, ac, { lat: ac.lat + d * Math.cos(r), lon: ac.lon + d * Math.sin(r) / Math.cos(ac.lat * Math.PI / 180) });
  }

  /**
   * Anfluege nach dest aus dem VATSIM-Datenfeed (v3) im Umkreis maxNm um (lat, lon).
   * Liefert { at (s, Stand des Feeds), aircraft: [...] } im Format des Plugins (ohne Bahn und Tracking).
   */
  function feedArrivals(feed, dest, lat, lon, maxNm) {
    const at = feed && feed.general && Date.parse(feed.general.update_timestamp) / 1000;
    const out = [];
    for (const p of (feed && Array.isArray(feed.pilots)) ? feed.pilots : []) {
      const fp = p && p.flight_plan;
      if (!fp || String(fp.arrival || '').toUpperCase() !== dest || !fin(p.latitude) || !fin(p.longitude)) continue;
      if (distNm(lat, lon, p.latitude, p.longitude) > maxNm) continue;
      if (!(p.groundspeed >= 50) && !(p.altitude >= 2500)) continue;   // am Boden
      const wtc = /^[^/]*\/([LMHJ])/i.exec(fp.aircraft || '');
      out.push({
        cs: String(p.callsign || '').toUpperCase(), lat: p.latitude, lon: p.longitude, alt: p.altitude, gs: p.groundspeed,
        hdg: p.heading, trk: p.heading, type: String(fp.aircraft_short || '').toUpperCase().slice(0, 4),
        wtc: wtc ? wtc[1].toUpperCase() : 'M', route: String(fp.route || '').toUpperCase().slice(-200), src: 'feed'
      });
    }
    return { at: fin(at) ? at : Date.now() / 1000, aircraft: out };
  }

  /** Eigene Flieger fuer die anderen Lotsen verkleinern (Nachricht bleibt klein). */
  function forUpload(list, max) {
    const r4 = v => Math.round(v * 1e4) / 1e4;
    return (list || []).slice(0, max || 150).filter(a => a && typeof a.cs === 'string' && fin(a.lat) && fin(a.lon)).map(a => {
      const o = { cs: a.cs, lat: r4(a.lat), lon: r4(a.lon), alt: Math.round(a.alt || 0), gs: Math.round(a.gs || 0) };
      for (const k of ['hdg', 'trk']) if (fin(a[k])) o[k] = Math.round(a[k]);
      for (const k of ['type', 'wtc', 'star', 'iaf', 'arrRwy', 'trackedBy', 'stream']) if (typeof a[k] === 'string' && a[k]) o[k] = a[k].slice(0, 16);
      if (typeof a.route === 'string' && a.route) o.route = a.route.slice(-200);
      if (a.passedIaf) o.passedIaf = true;
      return o;
    });
  }

  /**
   * local: eigene Flieger (EuroScope), uploads: [{ by, at, aircraft }], feed: { at, aircraft } oder null, now in s.
   * Liefert { aircraft, counts: { local, upload, feed } }.
   */
  function merge(local, uploads, feed, now) {
    const seen = {}, out = [], counts = { local: 0, upload: 0, feed: 0 };
    for (const a of local || []) { if (a && a.cs && !seen[a.cs]) { seen[a.cs] = true; out.push(a); counts.local++; } }
    const remote = {};
    for (const u of uploads || []) {
      const age = now - u.at;
      if (!(age <= MAX_AGE.upload)) continue;
      for (const a of u.aircraft || []) if (a && a.cs && !seen[a.cs] && (!remote[a.cs] || remote[a.cs].at < u.at)) remote[a.cs] = { at: u.at, a, src: 'upload' };
    }
    if (feed && now - feed.at <= MAX_AGE.feed) {
      for (const a of feed.aircraft || []) if (a && a.cs && !seen[a.cs] && !remote[a.cs]) remote[a.cs] = { at: feed.at, a, src: 'feed' };
    }
    for (const cs of Object.keys(remote)) {
      const r = remote[cs];
      out.push(Object.assign(extrapolate(r.a, now - r.at), { src: r.src }));
      counts[r.src]++;
    }
    return { aircraft: out, counts };
  }

  return { FEED_URL, feedArrivals, forUpload, merge, extrapolate, distNm };
});
