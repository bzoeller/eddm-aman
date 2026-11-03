/*
 * EDDM AMAN Kernlogik
 * Laeuft im Browser (window.AmanCore) und in Node (require) fuer die Tests.
 * Keine Abhaengigkeiten. Alle Zeiten in Sekunden (Epoch), Distanzen in NM, Speeds in kt.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AmanCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SIDES = ['N', 'S'];
  const STEP_NM = 0.5;

  // ---------- Geometrie ----------
  function makeProjection(lat0, lon0) {
    const k = Math.cos(lat0 * Math.PI / 180);
    return {
      xy: (lat, lon) => ({ x: (lon - lon0) * 60 * k, y: (lat - lat0) * 60 }),
      ll: (x, y) => ({ lat: lat0 + y / 60, lon: lon0 + x / (60 * k) })
    };
  }
  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const trackDeg = (a, b) => (Math.atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI + 360) % 360;
  /** Kleinster Winkel zwischen zwei Kursen (0..180). */
  const angDiff = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
  /** Hoehe auf dem Standardprofil r NM vor der Schwelle (3-Grad-Gleitweg, hoechstens 10000 ft). */
  const altAt = (cfg, r) => Math.min(10000, cfg.elevationFt + r * 318);

  /** Gegenwindkomponente (positiv = Gegenwind) fuer Kurs trk und Wind aus dir mit spd. */
  function headwind(trk, wind) {
    if (!wind || !wind.spd) return 0;
    return wind.spd * Math.cos((wind.dir - trk) * Math.PI / 180);
  }
  const tasFromIas = (ias, altFt) => ias * (1 + 0.02 * Math.max(0, altFt) / 1000);

  /** Bodenwind aus METAR lesen, z. B. "EDDM 012320Z 25012G22KT ..." */
  function parseMetarWind(metar) {
    if (!metar) return null;
    const m = /\b(\d{3}|VRB)(\d{2,3})(?:G\d{2,3})?KT\b/.exec(metar);
    if (!m) return null;
    return { dir: m[1] === 'VRB' ? 0 : +m[1], spd: m[1] === 'VRB' ? 0 : +m[2] };
  }

  // ---------- Pfade ----------
  /** Bereitet die Standardpfade vor: Punkte in NM, Segmentlaengen, Abstand zur Schwelle. */
  function preparePaths(cfg, proj) {
    const out = {};
    for (const iaf of Object.keys(cfg.paths)) {
      out[iaf] = {};
      for (const rwy of Object.keys(cfg.paths[iaf])) {
        const pts = cfg.paths[iaf][rwy].path.map(p => Object.assign({ name: p.name }, proj.xy(p.lat, p.lon)));
        const cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
        const length = cum[cum.length - 1];
        const F = cfg.profile.finalNm;
        // Strecke vor dem Final auf die AIP-Durchschnittsentfernung skalieren
        const aip = cfg.paths[iaf][rwy].aipTrackMiles;
        const k = aip && length > F ? Math.max(0.2, (aip - F) / (length - F)) : 1;
        out[iaf][rwy] = { iaf, rwy, pts, cum, length, k, cache: {} };
      }
    }
    return out;
  }

  /** Punkt und Kurs bei Laufstrecke s (NM ab IAF). */
  function pointAt(path, s) {
    s = Math.max(0, Math.min(path.length, s));
    let i = 1;
    while (i < path.cum.length - 1 && path.cum[i] < s) i++;
    const a = path.pts[i - 1], b = path.pts[i];
    const seg = path.cum[i] - path.cum[i - 1] || 1;
    const f = (s - path.cum[i - 1]) / seg;
    return { x: a.x + f * (b.x - a.x), y: a.y + f * (b.y - a.y), trk: trackDeg(a, b) };
  }

  /** Projektion einer Position auf den Pfad, nur vorwaerts ab minS (und optional nur bis maxS). */
  function project(path, p, minS, maxS) {
    let best = null;
    if (maxS == null) maxS = path.length;
    for (let i = 1; i < path.pts.length; i++) {
      if (path.cum[i] < minS) continue;
      if (path.cum[i - 1] >= maxS) break;
      const a = path.pts[i - 1], b = path.pts[i];
      const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1;
      let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2;
      t = Math.max(0, Math.min(1, t));
      let s = path.cum[i - 1] + t * (path.cum[i] - path.cum[i - 1]);
      if (s < minS) s = minS;
      if (s > maxS) s = maxS;
      const q = pointAt(path, s);
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (!best || d < best.cross) best = { s, cross: d };
    }
    return best || { s: minS, cross: 0 };
  }

  /** Schnitt des Strahls p + u*(vx,vy) mit dem Segment a + t*(ex,ey): { u, t } oder null (parallel). */
  function raySeg(p, vx, vy, a, ex, ey) {
    const den = vx * ey - vy * ex;
    if (Math.abs(den) < 1e-6) return null;
    const wx = a.x - p.x, wy = a.y - p.y;
    return { u: (wx * ey - wy * ex) / den, t: (wx * vy - wy * vx) / den };
  }

  /**
   * Alle Schnittpunkte des Kursstrahls mit dem Pfad zwischen minS und maxS (ab 0.3 NM, bis maxD voraus),
   * nach Entfernung sortiert: [{ s (Pfadposition), d (Direktentfernung) }].
   */
  function rayHits(path, p, trk, minS, maxD, maxS) {
    if (maxS == null) maxS = path.length;
    const ux = Math.sin(trk * Math.PI / 180), uy = Math.cos(trk * Math.PI / 180), out = [];
    for (let i = 1; i < path.pts.length; i++) {
      if (path.cum[i] <= minS) continue;
      if (path.cum[i - 1] >= maxS) break;
      const a = path.pts[i - 1], b = path.pts[i];
      const h = raySeg(p, ux, uy, a, b.x - a.x, b.y - a.y);
      if (!h || h.u < 0.3 || h.u > maxD || h.t < 0 || h.t > 1) continue;
      const sHit = path.cum[i - 1] + h.t * (path.cum[i] - path.cum[i - 1]);
      if (sHit > minS && sHit <= maxS) out.push({ s: sHit, d: h.u });
    }
    return out.sort((x, y) => x.d - y.d);
  }
  /** Naechster Schnittpunkt oder null. */
  function rayHit(path, p, trk, minS, maxD, maxS) { return rayHits(path, p, trk, minS, maxD, maxS)[0] || null; }

  // ---------- Anfluglinie ----------
  const FINAL_EXT_NM = 30;   // verlaengerte Anfluglinie, auf der ein Heading direkt aufs Final erkannt wird
  /** Geometrie der Anfluglinie eines Pfades: Schwelle, Einheitsvektor nach aussen, Inbound-Kurs. */
  function finalGeo(path) {
    const fi = path.pts.findIndex(q => q.name === 'FAP15');
    if (fi < 0) return null;
    const thr = path.pts[path.pts.length - 1], fap = path.pts[fi];
    const L = dist(thr, fap) || 1;
    return { thr, ox: (fap.x - thr.x) / L, oy: (fap.y - thr.y) / L, inbound: trackDeg(fap, thr) };
  }
  /** Schnitt des Wegs p + u*(vx,vy) mit der verlaengerten Anfluglinie: { u, r (NM vor der Schwelle) } oder null. */
  function finalCross(G, p, vx, vy) {
    const h = raySeg(p, vx, vy, G.thr, G.ox * FINAL_EXT_NM, G.oy * FINAL_EXT_NM);
    return h && { u: h.u, r: h.t * FINAL_EXT_NM };
  }

  /**
   * Downwind-Pfad je Bahn: Standardpfad eines IAF, der normal auf diese Bahn fuehrt (Nord: ROKIL/LANDU,
   * Sued: BETOS/NAPSA), ab Beginn des Downwinds (Segmente gegen die Landerichtung bis ABEAM).
   * Wird ein Flieger auf den Downwind der anderen Bahn gefuehrt, rechnet das AMAN ab dort mit diesem Profil.
   */
  function downwindPaths(cfg, paths) {
    const out = {};
    for (const side of ['N', 'S']) {
      for (const dir of Object.keys(cfg.runways[side].ids)) {
        const rwy = cfg.runways[side].ids[dir];
        const recip = (cfg.runways[side].heading[dir] + 180) % 360;
        let best = null;
        for (const iaf of Object.keys(cfg.iafs)) {
          if (cfg.iafs[iaf].side !== side || !paths[iaf] || !paths[iaf][rwy]) continue;
          const P = paths[iaf][rwy];
          let iA = P.pts.findIndex(q => q.name === 'ABEAM');
          if (iA < 1) iA = Math.max(1, P.pts.length - 3);
          let i = iA;
          while (i > 1) {
            const d = angDiff(trackDeg(P.pts[i - 2], P.pts[i - 1]), recip);
            if (d > 35) break;
            i--;
          }
          const sDw = P.cum[i - 1];
          const dwLen = P.cum[iA] - sDw;
          if (!best || dwLen > best.dwLen) best = { rwy, iaf, path: P, sDw, sAb: P.cum[iA], dwLen };
        }
        if (best) out[rwy] = best;
      }
    }
    return out;
  }

  // ---------- Speedprofil ----------
  function profileIas(cfg, r, vapp) {
    const P = cfg.profile;
    if (r > P.finalNm) return P.downwind;
    if (r > P.finalSlowNm) return P.final + (P.fap - P.final) * (r - P.finalSlowNm) / (P.finalNm - P.finalSlowNm);
    return vapp + (P.final - vapp) * (r / P.finalSlowNm);
  }

  function vappFor(cfg, ac) {
    return cfg.vapp.types[ac.type] || cfg.vapp.wtc[ac.wtc] || cfg.vapp.wtc.M;
  }

  /**
   * Flugzeit-Tabelle entlang des Pfades: ttg[k] = Restzeit (s) von s = k*STEP bis zur Schwelle.
   * Cache je Wind und Vapp.
   */
  function timeTable(cfg, path, vapp, winds) {
    const key = vapp + '|' + JSON.stringify(winds);
    if (path.cache[key]) return path.cache[key];
    const n = Math.ceil(path.length / STEP_NM);
    const ttg = new Array(n + 1).fill(0);
    for (let k = n - 1; k >= 0; k--) {
      const s0 = k * STEP_NM, s1 = Math.min(path.length, s0 + STEP_NM);
      const mid = pointAt(path, (s0 + s1) / 2);
      const r = path.length - (s0 + s1) / 2;
      const alt = altAt(cfg, r);
      const ias = profileIas(cfg, r, vapp);
      const wind = r > cfg.profile.finalNm ? (winds.aloft || winds.surface) : (winds.surface || winds.aloft);
      const gs = Math.max(80, tasFromIas(ias, alt) - headwind(mid.trk, wind));
      const scale = r > cfg.profile.finalNm ? path.k : 1;
      ttg[k] = ttg[k + 1] + (s1 - s0) * scale / gs * 3600;
    }
    if (Object.keys(path.cache).length > 40) path.cache = {};
    path.cache[key] = ttg;
    return ttg;
  }
  /** Restentfernung bis zur Schwelle, vor dem Final auf AIP-Werte skaliert. */
  function effRemaining(cfg, path, s) {
    const r = path.length - s, F = cfg.profile.finalNm;
    return r <= F ? r : F + (r - F) * path.k;
  }
  function ttgAt(ttg, s) {
    const k = s / STEP_NM, i = Math.floor(k), f = k - i;
    if (i >= ttg.length - 1) return 0;
    return ttg[i] + (ttg[i + 1] - ttg[i]) * f;
  }

  /** Strom aus der Flugplanroute: erster Strom, dessen Fix oder Airway in der Route vorkommt. */
  function streamByRoute(streams, route) {
    if (!route) return null;
    const tok = String(route).toUpperCase().split(/[\s.\/]+/);
    for (const k of Object.keys(streams)) {
      const r = streams[k].route || [];
      if (r.some(x => tok.indexOf(x) >= 0)) return k;
    }
    return null;
  }

  /**
   * Strom nach Peilung vom IAF zum Flieger: Bereich [from, to) in Grad, oder der Einflugpunkt (fix),
   * dessen Peilung vom IAF am naechsten liegt (hoechstens 45 Grad daneben). Sonst unbekannt.
   */
  function streamFor(streams, brg) {
    const withFix = Object.keys(streams).filter(k => streams[k]._brg != null);
    if (withFix.length) {
      let best = null, bd = 46;
      for (const k of withFix) { const d = angDiff(brg, streams[k]._brg); if (d < bd) { bd = d; best = k; } }
      return best;
    }
    const keys = Object.keys(streams).filter(k => streams[k].from != null && streams[k].to != null);
    for (const k of keys) {
      const z = streams[k];
      const inside = z.from <= z.to ? brg >= z.from && brg < z.to : brg >= z.from || brg < z.to;
      if (inside) return k;
    }
    return keys[0] || null;
  }

  // ---------- Engine ----------
  function defaultState(cfg) {
    const d = cfg.defaults;
    return {
      dir: '26',                   // Betriebsrichtung, nur im AMAN einstellbar ('26' | '08')
      staticMode: false,
      spacing: { N: d.spacingNm, S: d.spacingNm },
      rate: { N: d.ratePerRwy, S: d.ratePerRwy },
      finalGsMode: d.finalGsMode,
      timelineMin: d.timelineMin,
      closures: [],                // {id, side, from, to}
      dirChange: null,             // geplanter Runway Change {id, to, at}
      ac: {},                      // pro Callsign: rwySide, hold, locked, captured, sMin, frozenSta, iaf
      seq: { N: [], S: [] },
      hold: [],
      landed: [],                  // {cs, side, t}
      cnt: { N: 0, S: 0 }          // Landungen je Bahn seit dem Start
    };
  }

  /** Gespeicherten Zustand pruefen: nur bekannte Felder mit gueltigen Werten uebernehmen. */
  function sanitizeState(cfg, s) {
    if (!s || typeof s !== 'object') return {};
    const d = cfg.defaults, out = {};
    const fin = v => typeof v === 'number' && isFinite(v);
    const perSide = (o, def, lo, hi) => {
      const v = x => (fin(x) && x >= lo && x <= hi ? x : def);
      return o && typeof o === 'object' ? { N: v(o.N), S: v(o.S) } : { N: def, S: def };
    };
    if (s.dir === '26' || s.dir === '08') out.dir = s.dir;
    if (typeof s.staticMode === 'boolean') out.staticMode = s.staticMode;
    if (s.spacing != null) out.spacing = perSide(s.spacing, d.spacingNm, 2.5, 20);
    if (s.rate != null) out.rate = perSide(s.rate, d.ratePerRwy, 10, 60);
    if (s.finalGsMode === 'typwind' || s.finalGsMode === 'fixed') out.finalGsMode = s.finalGsMode;
    if (fin(s.timelineMin) && s.timelineMin >= 20 && s.timelineMin <= 90) out.timelineMin = s.timelineMin;
    if (Array.isArray(s.closures)) out.closures = s.closures.filter(c => c && (c.side === 'N' || c.side === 'S') && fin(c.from) && fin(c.to) && c.to > c.from);
    const ch = s.dirChange;
    if (ch && (ch.to === '26' || ch.to === '08') && fin(ch.at)) out.dirChange = { id: ch.id || ch.at, to: ch.to, at: ch.at };
    return out;
  }

  /** Pflichtwerte der Config pruefen: Standardwerte stehen nur in eddm.json, nicht im Code. */
  const REQUIRED = {
    defaults: ['spacingNm', 'ratePerRwy', 'timelineMin', 'captureNm', 'hysteresisSec', 'ctrMaxDelayMin', 'fixedFinalGs', 'bentLineBelowMin',
      'lostAfterSec', 'shortcutMinNm', 'refreshSec', 'rwyChangeBufferSec', 'vectorAreaNm', 'vectorMaxAltFt', 'vectorMissNm', 'finalInterceptMinNm'],
    profile: ['belowFL100', 'downwind', 'fap', 'final', 'finalSlowNm', 'finalNm', 'finalMaxAltFt']
  };
  function validateConfig(cfg) {
    const bad = [];
    for (const grp of Object.keys(REQUIRED)) for (const k of REQUIRED[grp])
      if (!cfg[grp] || typeof cfg[grp][k] !== 'number' || !isFinite(cfg[grp][k])) bad.push(grp + '.' + k);
    for (const k of ['runways', 'iafs', 'paths', 'wind', 'vapp', 'wake']) if (!cfg[k]) bad.push(k);
    if (bad.length) throw new Error('eddm.json: missing or invalid ' + bad.join(', '));
  }

  function createEngine(cfg, savedState) {
    validateConfig(cfg);
    const proj = makeProjection(cfg.wind.lat, cfg.wind.lon);
    const paths = preparePaths(cfg, proj);
    const dwPaths = downwindPaths(cfg, paths);
    const st = Object.assign(defaultState(cfg), sanitizeState(cfg, savedState));
    let last = { list: [], bySide: { N: [], S: [] }, byCs: {}, now: 0 };

    const iafXY = {};
    for (const k of Object.keys(cfg.iafs)) iafXY[k] = proj.xy(cfg.iafs[k].lat, cfg.iafs[k].lon);
    // Peilung IAF -> Einflugpunkt je Strom (fuer Fluege ohne Route)
    for (const k of Object.keys(cfg.iafs)) {
      const st0 = cfg.iafs[k].streams || {};
      for (const n of Object.keys(st0)) if (st0[n].fix) st0[n]._brg = trackDeg(iafXY[k], proj.xy(st0[n].fix.lat, st0[n].fix.lon));
    }

    function rwyId(side, dir) { return cfg.runways[side].ids[dir]; }
    function dirOfRwy(r) { for (const sd of SIDES) for (const k of Object.keys(cfg.runways[sd].ids)) if (cfg.runways[sd].ids[k] === r) return k; return null; }
    function sideOfRwy(r) { return SIDES.find(sd => Object.values(cfg.runways[sd].ids).indexOf(r) >= 0) || null; }
    function closedAt(side, t) {
      return st.closures.find(c => c.side === side && t >= c.from && t < c.to) || null;
    }

    function nearestIaf(p) {
      let best = null, bd = 1e9;
      for (const k of Object.keys(iafXY)) { const d = dist(p, iafXY[k]); if (d < bd) { bd = d; best = k; } }
      return best;
    }

    function wakeNm(lead, foll) {
      const m = cfg.wake[lead.wtc] || cfg.wake.M;
      return m[foll.wtc] != null ? m[foll.wtc] : 0;
    }

    function finalGs(ac, side, dir, winds) {
      if (st.finalGsMode === 'fixed') return cfg.defaults.fixedFinalGs;
      const hdg = cfg.runways[side].heading[dir];
      return Math.max(80, vappFor(cfg, ac) - headwind(hdg, winds.surface));
    }

    /** Mindestabstand in Sekunden zwischen Vordermann und Hintermann auf einer Bahn. */
    function sepSeconds(lead, foll, side, dir, winds) {
      const nm = Math.max(st.spacing[side], wakeNm(lead, foll));
      const t = nm / finalGs(foll, side, dir, winds) * 3600;
      return Math.max(t, 3600 / Math.max(1, st.rate[side]));
    }

    function vectoredEta(ac, a, path, p, ttg, toIafDirect) {
      const D = cfg.defaults;
      if (a.trk == null || ac.inHold || toIafDirect < 3) return null;
      if (Math.hypot(p.x, p.y) > D.vectorAreaNm) return null;            // nur im Anflugbereich
      if (ac.alt != null && ac.alt > D.vectorMaxAltFt) return null;
      // Fliegt der Kurs am IAF vorbei? (seitlicher Abstand am naechsten Punkt, oder IAF liegt hinter dem Flieger)
      const brg = trackDeg(p, path.pts[0]);
      const diff = angDiff(a.trk, brg);
      const miss = diff >= 90 ? toIafDirect : toIafDirect * Math.sin(diff * Math.PI / 180);
      if (miss < D.vectorMissNm) return null;
      const gs = ac.gs > 60 ? ac.gs : 220;
      const tVia = toIafDirect / gs * 3600 + ttg[0];
      let best = null;
      for (const h of rayHits(path, p, a.trk, 2, 40)) {
        const t = h.d / gs * 3600 + ttgAt(ttg, h.s);
        if (!best || t < best.t) best = { t, rem: h.d + effRemaining(cfg, path, h.s), s: h.s };
      }
      const fin = finalIntercept(ac, a, path, ttg, p);
      if (fin && (!best || fin.t < best.t)) best = fin;
      if (!best || best.t > tVia - 60) return null;                              // spart weniger als 1 min: weiter via IAF
      return best;
    }

    /** Flugzeit vom Punkt r NM vor der Schwelle (auf der Anfluglinie) bis zur Schwelle. */
    function finalTime(path, ttg, r) {
      const F = cfg.profile.finalNm;
      if (r <= F) return ttgAt(ttg, Math.max(0, path.length - r));
      return ttgAt(ttg, path.length - F) + (r - F) / tasFromIas(cfg.profile.fap, altAt(cfg, r)) * 3600;
    }
    /** Fliegt der Flieger auf der (verlaengerten) Anfluglinie in Landerichtung? Liefert r (NM bis Schwelle) oder null. */
    function onFinalOf(path, p, ac, a) {
      const G = finalGeo(path);
      if (!G || !finalAllowed(ac)) return null;
      const along = (p.x - G.thr.x) * G.ox + (p.y - G.thr.y) * G.oy;
      const lat = Math.abs((p.x - G.thr.x) * G.oy - (p.y - G.thr.y) * G.ox);
      if (along < 0.5 || along > 30 || lat > 1.5) return null;
      if (a.trk != null && angDiff(a.trk, G.inbound) > 35) return null;
      return along;
    }

    /**
     * Kurs schneidet die Anfluglinie der Bahn (Final ab FAP15 und deren Verlaengerung bis 30 NM):
     * direkt aufs Final per Heading. Liefert { t, rem } oder null.
     */
    function finalIntercept(ac, a, path, ttg, p) {
      if (a.trk == null || ac.inHold) return null;
      const G = finalGeo(path);
      if (!G) return null;
      if (angDiff(a.trk, G.inbound) > 100) return null;     // fliegt nicht in Landerichtung ein
      const x = finalCross(G, p, Math.sin(a.trk * Math.PI / 180), Math.cos(a.trk * Math.PI / 180));
      // eingefangen wird das Final erst ab etwa 8 NM; naeher an der Schwelle ist es ein Queren (z. B. zum anderen Downwind)
      if (!x || x.u < 0.3 || x.u > 40 || x.r < cfg.defaults.finalInterceptMinNm || x.r > FINAL_EXT_NM) return null;
      const u = x.u, r = x.r, F = cfg.profile.finalNm, gs = ac.gs > 60 ? ac.gs : 220;
      const tFin = finalTime(path, ttg, r);
      return { t: u / gs * 3600 + tFin, rem: u + r, s: path.length - Math.min(r, F) };
    }

    /** Ist der Flieger tief genug, um auf dem Final zu sein (Standard 7000 ft oder darunter)? */
    function finalAllowed(ac) { return ac.alt == null || ac.alt <= cfg.profile.finalMaxAltFt; }

    /**
     * ETA fuer ein Flugzeug auf einem bestimmten Pfad.
     * Liefert eta (Touchdown), etaIaf, remainingNm, passedIaf, sNew.
     */
    /** Gemeinsame Felder eines ETA-Ergebnisses hinter dem IAF; weitere Felder kommen aus extra. */
    function etaResult(path, ttg, now, t, rem, extra) {
      return Object.assign({ eta: now + t, etaIaf: null, remainingNm: rem, passedIaf: true, sNew: 0, tIafToThr: ttg[0],
        tFinal: ttgAt(ttg, Math.max(0, path.length - cfg.profile.finalNm)) }, extra);
    }

    function computeEta(ac, a, path, now, winds) {
      const p = proj.xy(ac.lat, ac.lon);
      const vapp = vappFor(cfg, ac);
      const ttg = timeTable(cfg, path, vapp, winds);
      const toIafDirect = dist(p, path.pts[0]);
      let passed = !!a.passedIaf || ac.passedIaf === true;
      let pr = null;
      // Heuristik nur, wenn EuroScope keine Routeninfo liefert
      if (!passed && ac.passedIaf == null) {
        pr = project(path, p, 0);
        if (toIafDirect < 2.5 || (pr.s > 2 && pr.cross < 6)) passed = true;
      }
      if (passed) {
        // Final erst ab 7000 ft oder darunter: hoeher wird nur bis zum Beginn des Finals projiziert
        pr = project(path, p, a.sMin || 0, finalAllowed(ac) ? null : path.length - cfg.profile.finalNm);
        const along = effRemaining(cfg, path, pr.s);
        // Querabweichung (Vektoren, Delay) zaehlt als zusaetzliche Strecke zurueck auf den Pfad
        const extra = pr.cross > 1 ? pr.cross : 0;
        const gs = ac.gs > 60 ? ac.gs : 200;
        let t = ttgAt(ttg, pr.s) + extra / gs * 3600, rem = along + extra;
        // auf der Anfluglinie (auch vor FAP15, z. B. nach Heading direkt aufs verlaengerte Final)
        const rF = onFinalOf(path, p, ac, a);
        if (rF != null) { const tF = finalTime(path, ttg, rF); if (tF < t + 30 || rF > cfg.profile.finalNm) { t = tF; rem = rF; } }
        // Abkuerzung: Kurs schneidet den Pfad weiter vorn (z. B. frueh auf den Base oder direkt aufs Final)
        const trk = a.trk;
        // nicht im Holding und nicht direkt am IAF (dort zeigt der Kurs oft zufaellig auf den Pfad)
        if (trk != null && !ac.inHold) {
          // direkt am IAF zeigt der Kurs beim Eindrehen oft zufaellig auf den Pfad: dort nur, wenn es >= 1 min spart
          const minGain = pr.s > 3 || a.vectored ? 0 : 60;
          for (const hit of rayHits(path, p, trk, pr.s + 1, 30)) {
            if (hit.s - pr.s <= hit.d + cfg.defaults.shortcutMinNm) continue;
            const tHit = hit.d / gs * 3600 + ttgAt(ttg, hit.s);
            if (tHit < t - minGain) { t = tHit; rem = hit.d + effRemaining(cfg, path, hit.s); }
          }
          const fin = finalIntercept(ac, a, path, ttg, p);
          if (fin && fin.t < t - Math.max(30, minGain)) { t = fin.t; rem = fin.rem; }
        }
        return etaResult(path, ttg, now, t, rem, { sNew: pr.s });
      }
      // Per Heading gefuehrt, ohne den IAF zu ueberfliegen (z. B. direkt Richtung Final): Zeigt der Kurs im
      // Anflugbereich deutlich am IAF vorbei auf einen spaeteren Teil des Pfades, gilt der Flieger als von APP
      // gefuehrt. Gerechnet wird direkt bis zum Schnittpunkt, ab dort Standardprofil.
      const vec = vectoredEta(ac, a, path, p, ttg, toIafDirect);
      if (vec) {
        return etaResult(path, ttg, now, vec.t, vec.rem, { vectored: true });
      }
      const dIaf = ac.distToIaf != null ? Math.max(ac.distToIaf, toIafDirect) : toIafDirect;
      let gs;
      if (ac.alt >= 10000 && ac.gs > 120) gs = ac.gs;
      else {
        const trk = trackDeg(p, path.pts[0]);
        gs = Math.max(150, tasFromIas(cfg.profile.belowFL100, Math.max(ac.alt || 8000, 4000)) - headwind(trk, winds.aloft));
      }
      const tIaf = dIaf / gs * 3600;
      return etaResult(path, ttg, now, tIaf + ttg[0], dIaf + effRemaining(cfg, path, 0), { etaIaf: now + tIaf, passedIaf: false });
    }

    /**
     * ETA fuer einen Flieger hinter dem IAF, der auf die andere Bahn geht und per Vektoren auf deren
     * Downwind gefuehrt wird. Auf dem neuen Downwind: Standardprofil ab dort. Davor: direkt (nach Kurs,
     * sonst kuerzester Weg) zum Eintrittspunkt auf dem neuen Downwind, dann Standardprofil.
     */
    function computeEtaX(ac, a, rwy, now, winds) {
      const D = dwPaths[rwy];
      if (!D) return null;
      const P = D.path, p = proj.xy(ac.lat, ac.lon);
      const ttg = timeTable(cfg, P, vappFor(cfg, ac), winds);
      const gs = ac.gs > 60 ? ac.gs : 200;
      // schon auf dem Final der neuen Bahn: nur noch die Entfernung zur Schwelle
      const rF = onFinalOf(P, p, ac, a);
      if (rF != null) {
        a.xOn = true;
        return etaResult(P, ttg, now, finalTime(P, ttg, rF), rF, { sNew: a.sMin || 0, viaDownwind: D.iaf });
      }
      const minS = Math.max(D.sDw, a.xMin || 0);
      // Eintritt nur auf dem Downwind (bis ABEAM), nicht auf Base oder Final
      const prDw = project(P, p, minS, D.sAb);
      if (!a.xOn && prDw.cross < 1.5) a.xOn = true;
      const pr = a.xOn ? project(P, p, minS, finalAllowed(ac) ? null : P.length - cfg.profile.finalNm) : prDw;
      let t, rem, sJoin = pr.s;
      if (a.xOn) {
        // auf dem neuen Downwind (oder schon dort gewesen): Standardprofil ab der aktuellen Position,
        // Querablage (z. B. verlaengerter Downwind) zaehlt als Zusatzweg
        a.xMin = Math.max(a.xMin || 0, pr.s - 0.5);
        const extra = pr.cross > 1 ? pr.cross : 0;
        t = ttgAt(ttg, pr.s) + extra / gs * 3600;
        rem = effRemaining(cfg, P, pr.s) + extra;
      } else {
        let d = pr.cross;
        if (a.trk != null) {
          const hit = rayHit(P, p, a.trk, minS, 40, D.sAb);
          if (hit) { d = hit.d; sJoin = hit.s; }
        }
        t = d / gs * 3600 + ttgAt(ttg, sJoin);
        rem = d + effRemaining(cfg, P, sJoin);
      }
      // direkt auf das (verlaengerte) Final dieser Bahn statt ueber den Downwind
      const fin = finalIntercept(ac, a, P, ttg, p);
      if (fin && fin.t < t - 30) { t = fin.t; rem = fin.rem; }
      return etaResult(P, ttg, now, t, rem, { sNew: a.sMin || 0, viaDownwind: D.iaf });
    }

    /** Flieger aus Sequenz und Hold-Liste nehmen. */
    function unseq(cs) {
      st.hold = st.hold.filter(c => c !== cs);
      for (const s of SIDES) st.seq[s] = st.seq[s].filter(c => c !== cs);
    }
    /** Landung zaehlen (Statistik und Landeabstaende). */
    function countLanding(cs, side, t) {
      st.landed.push({ cs, side, t });
      st.cnt[side]++;
    }

    const fin = v => typeof v === 'number' && isFinite(v);
    /** Datensatz pruefen und bereinigen (ein NaN wuerde die ganze Sequenz verderben). Kaputte Saetze: null. */
    function normalize(raw) {
      if (!raw || typeof raw.cs !== 'string' || !raw.cs.trim() || !fin(raw.lat) || !fin(raw.lon)) return null;
      if (Math.abs(raw.lat) > 90 || Math.abs(raw.lon) > 180) return null;
      return Object.assign({}, raw, {
        cs: raw.cs.trim().toUpperCase().slice(0, 12),
        alt: fin(raw.alt) ? raw.alt : null, gs: fin(raw.gs) ? raw.gs : 0,
        trk: fin(raw.trk) ? raw.trk : null, hdg: fin(raw.hdg) ? raw.hdg : null,
        type: typeof raw.type === 'string' ? raw.type.slice(0, 4).toUpperCase() : '',
        wtc: ['L', 'M', 'H', 'J'].indexOf(raw.wtc) >= 0 ? raw.wtc : 'M'
      });
    }

    /** IAF und Einflugstrom eines Fliegers bestimmen. */
    function assignIafStream(ac, a, p) {
      // IAF: vom Plugin, sonst aus dem STAR-Namen (z. B. BETOS1A) oder der Route, sonst der naechste
      let iafIn = ac.iaf && cfg.iafs[ac.iaf] ? ac.iaf : null;
      if (!iafIn && typeof ac.star === 'string') iafIn = Object.keys(cfg.iafs).find(k => ac.star.toUpperCase().indexOf(k) === 0) || null;
      if (!iafIn && typeof ac.route === 'string') { const tk = ac.route.toUpperCase().split(/[\s.\/]+/); iafIn = Object.keys(cfg.iafs).find(k => tk.indexOf(k) >= 0) || null; }
      const iaf = iafIn || a.iaf || nearestIaf(p);
      a.iaf = iaf;
      // Einflugstrom (z. B. DISUN T103 BETOS oder SOTOV T101 BETOS): zuerst aus der Flugplanroute,
      // sonst aus der Peilung vom IAF (festgehalten, sobald der Flieger naeher als 40 NM ist)
      const strm = cfg.iafs[iaf].streams;
      if (!strm) a.stream = null;
      else if (ac.stream && strm[ac.stream]) a.stream = ac.stream;
      else {
        const byRoute = streamByRoute(strm, ac.route);
        if (byRoute) a.stream = byRoute;
        else if (!a.stream || !strm[a.stream] || (!a.streamByRoute && dist(p, iafXY[iaf]) > 40)) a.stream = streamFor(strm, trackDeg(iafXY[iaf], p));
        if (byRoute) a.streamByRoute = true;
      }
      return iaf;
    }

    /**
     * Bahn, Betriebsrichtung und ETA eines Fliegers: Bahn aus EuroScope, geplanter Runway Change,
     * Bahnsperre, Wechsel auf den Downwind der anderen Bahn. Liefert { side, dir, r }.
     */
    function assignRunway(ac, a, iaf, now, winds, dir, ch, esMixed) {
      // Bahn aus EuroScope: aendert der Lotse die Landebahn im Flugplan (z. B. 08R -> 08L),
      // springt der Flieger auf die neue Bahn und wird dort nach ETA eingeplant.
      // Nur Aenderungen zaehlen, nicht die Bahn, die EuroScope beim ersten Sehen eintraegt.
      const esR = ac.arrRwy ? String(ac.arrRwy).toUpperCase() : null;
      if (esR) {
        // Nur ein Seitenwechsel in gleicher Richtung zaehlt (08R -> 08L). Traegt EuroScope nach dem
        // Drehen der Bahn automatisch eine neue Richtung ein (26L -> 08L), passiert nichts.
        const firstSeen = !a.esRwy && esMixed && dirOfRwy(esR) === dir;
        if (firstSeen || (a.esRwy && esR !== a.esRwy && dirOfRwy(esR) && dirOfRwy(esR) === dirOfRwy(a.esRwy))) {
          const sES = sideOfRwy(esR);
          a.esByCtl = true;
          if (sES && sES !== (a.rwySide || cfg.iafs[iaf].side)) {
            a.rwySide = sES !== cfg.iafs[iaf].side ? sES : null;
            a.locked = false; a.hold = false;
            unseq(ac.cs);
          }
        }
        a.esRwy = esR;
      }

      // Betriebsrichtung je Flieger: hinter dem IAF bleibt sie, wie sie war. Davor gilt bei einem
      // geplanten Runway Change die neue Richtung fuer alle, die nach dem Zeitpunkt landen
      // (ETA plus zuletzt geplantes Delay, mit 60 s Hysterese gegen Hin- und Herspringen).
      let side = a.rwySide || cfg.iafs[iaf].side;
      let acDir = dir;
      if (a.passedIaf && a.dir) acDir = a.dir;
      else if (ch) {
        const rOld = computeEta(ac, a, paths[iaf][rwyId(side, dir)], now, winds);
        const tLand = rOld.eta + (a.lastDelay || 0);
        if (a.chId !== ch.id) { a.chId = ch.id; a.chNew = tLand >= ch.at; }
        else if (a.chNew && tLand < ch.at - 60) a.chNew = false;
        else if (!a.chNew && tLand > ch.at + 60) a.chNew = true;
        acDir = a.chNew ? ch.to : dir;
        // im Update, in dem er den IAF passiert, gilt die bisher geplante Richtung weiter
        if (rOld.passedIaf && a.dir) acDir = a.dir;
      }
      let r = computeEta(ac, a, paths[iaf][rwyId(side, acDir)], now, winds);
      // Bahn zur ETA gesperrt: auf die andere, wenn die frei ist (nicht bei manueller Bahn)
      if (!a.rwySide && closedAt(side, r.eta)) {
        const other = side === 'N' ? 'S' : 'N';
        const r2 = computeEta(ac, a, paths[iaf][rwyId(other, acDir)], now, winds);
        if (!closedAt(other, r2.eta)) { side = other; r = r2; }
      }
      // Hinter dem IAF auf der anderen Bahn: Rechnung ueber deren Downwind
      if (r.passedIaf && side !== cfg.iafs[iaf].side) {
        const rx = computeEtaX(ac, a, rwyId(side, acDir), now, winds);
        if (rx) r = rx;
      } else { a.xOn = false; a.xMin = 0; }
      return { side, dir: acDir, r };
    }

    /** Sequenz je Bahn pflegen: Neue nach ETA einsortieren, echtes Ueberholen tauschen, Runway Change ordnen. */
    function maintainSeq(items, byCs, tgtDir) {
      for (const side of SIDES) {
        const prev = st.seq[side].filter(cs => byCs[cs] && byCs[cs].side === side && !byCs[cs].hold);
        const inSeq = {}; prev.forEach(cs => { inSeq[cs] = true; });
        const newcomers = items.filter(i => i.side === side && !i.hold && !inSeq[i.cs]).sort((a, b) => a.eta - b.eta);
        let seq = prev.slice();
        for (const n of newcomers) {
          // nach ETA einsortieren, aber nie vor Flieger, die eingefroren, gesperrt oder hinter dem IAF sind
          let k = seq.length;
          while (k > 0) {
            const o = byCs[seq[k - 1]];
            const fixed = st.staticMode || o.locked || o.passedIaf;
            if (o.eta > n.eta && !fixed) k--; else break;
          }
          seq.splice(k, 0, n.cs);
        }
        // benachbarte Paare tauschen, wenn die ETA mehr als die Hysterese ueberholt
        // Ueberholen hinter dem IAF (Abkuerzung) gilt auch im static-Modus: wer real vorn ist, ist vorn.
        const H = cfg.defaults.hysteresisSec;
        let changed = true, guard = 0;
        while (changed && guard++ < 200) {
          changed = false;
          for (let j = 0; j < seq.length - 1; j++) {
            const a = byCs[seq[j]], b = byCs[seq[j + 1]];
            if (a.locked || b.locked) continue;
            const ok = st.staticMode ? (a.passedIaf && b.passedIaf) : (b.passedIaf || !a.passedIaf);
            if (ok && b.eta < a.eta - H) { seq[j] = b.cs; seq[j + 1] = a.cs; changed = true; }
          }
        }
        // Runway Change: auf jeder Bahn zuerst alle Anfluege der alten Richtung, dann die neue
        if (seq.some(cs => byCs[cs].dir !== tgtDir) && seq.some(cs => byCs[cs].dir === tgtDir)) {
          seq = seq.filter(cs => byCs[cs].dir !== tgtDir).concat(seq.filter(cs => byCs[cs].dir === tgtDir));
        }
        st.seq[side] = seq;
      }
    }

    /**
     * STA berechnen. Bei einem Runway Change zuerst alle Anfluege der alten Richtung (beide Bahnen),
     * dann die neue: der erste Flieger der neuen Richtung ist erst bei 15 NM, wenn die letzte
     * Landung der alten Richtung erfolgt ist.
     */
    function schedule(byCs, ch, tgtDir, winds) {
      const prevBy = { N: null, S: null };
      let lastOld = null;
      for (const phase of [0, 1]) {
        if (phase === 1) {
          for (const side of SIDES) for (const cs of st.seq[side]) {
            const i = byCs[cs];
            if (i.dir !== tgtDir) lastOld = Math.max(lastOld == null ? -Infinity : lastOld, i.sta, i.reqSta);
          }
        }
        for (const side of SIDES) for (const cs of st.seq[side]) {
          const it = byCs[cs], a = st.ac[cs];
          if ((phase === 0) !== (it.dir !== tgtDir)) continue;
          const prevItem = prevBy[side];
          // reqSta = geplante Landezeit mit Staffelung (daraus das Delay, das noch aufzunehmen ist)
          let req = it.eta;
          if (st.staticMode && a.frozenSta && !it.passedIaf) req = Math.max(req, a.frozenSta);
          if (prevItem) req = Math.max(req, prevItem.reqSta + sepSeconds(prevItem, it, side, it.dir, winds));
          // Runway Change: neue Richtung erst ab dem Zeitpunkt und erst bei 15 NM, wenn die alte Richtung leer ist
          if (ch && it.dir === ch.to) req = Math.max(req, ch.at);
          if (phase === 1 && lastOld != null) req = Math.max(req, lastOld + (it.tFinal || 0) + cfg.defaults.rwyChangeBufferSec);
          let guard = 0, c;
          while ((c = closedAt(side, req)) && guard++ < 20) req = c.to;
          // Der Streifen steht immer auf der geplanten Zeit mit voller Staffelung (FLOW, Wirbelschleppe,
          // Landerate). Werden Zeit und Meilen kuerzer (Abkuerzung, schneller), wird die ETA kuerzer und
          // der Streifen rueckt nach, soweit der Vordermann es zulaesst. So passen Schirm, APP-Planung
          // und die Delay-Balken der CTR zusammen.
          it.sta = it.reqSta = req;
          it.delay = req - it.eta;
          a.lastDelay = it.delay;
          if (it.etaIaf != null) {
            it.staIaf = req - it.tIafToThr;
            it.delayIaf = Math.max(0, it.staIaf - it.etaIaf);
            it.ctrStrokes = Math.round(Math.min(it.delayIaf, cfg.defaults.ctrMaxDelayMin * 60) / 60);
          } else { it.staIaf = null; it.delayIaf = 0; it.ctrStrokes = 0; }
          if (!st.staticMode) a.frozenSta = null;
          prevBy[side] = it;
        }
      }
    }

    /**
     * Haupt-Update. traffic = { aircraft: [...], activeDir?: '26'|'08', metar? }
     * winds = { surface:{dir,spd}, aloft:{dir,spd} }
     */
    function update(traffic, now, winds) {
      winds = winds || {};
      // geplanter Runway Change: Zeitpunkt erreicht -> Richtung wechselt automatisch
      if (st.dirChange && now >= st.dirChange.at) { st.dir = st.dirChange.to; st.dirChange = null; }
      // Die Richtung kommt nur aus dem AMAN. EuroScope (activeDir) wird nur verglichen, siehe esDir.
      if (st.dir !== '26' && st.dir !== '08') st.dir = '26';
      const dir = st.dir;
      const ch = st.dirChange && st.dirChange.to !== dir ? st.dirChange : null;
      const list = Array.isArray(traffic && traffic.aircraft) ? traffic.aircraft : [];
      // Vergibt EuroScope gerade beide Bahnen der aktiven Richtung, sind die Bahnen im Tag von Lotsen gesetzt:
      // dann gilt die Bahn eines Fliegers schon beim ersten Sehen (z. B. nach dem Neuladen des AMAN)
      const esSides = {};
      for (const x of list) {
        const r0 = x && x.arrRwy ? String(x.arrRwy).toUpperCase() : null;
        if (r0 && dirOfRwy(r0) === dir) esSides[sideOfRwy(r0)] = true;
      }
      const esMixed = !!(esSides.N && esSides.S);
      const seen = {}, items = [];

      for (const raw of list) {
        const ac = normalize(raw);
        if (!ac || seen[ac.cs]) continue;
        seen[ac.cs] = true;
        const a = st.ac[ac.cs] || (st.ac[ac.cs] = {});
        a.lastSeen = now;
        const p = proj.xy(ac.lat, ac.lon);
        // Kurs ueber Grund: aus den Daten, sonst aus der Bewegung seit dem letzten Update
        if (ac.trk != null) a.trk = ac.trk;
        else if (ac.hdg != null) a.trk = ac.hdg;
        else if (a.prevP) {
          const mv = dist(a.prevP, p);
          if (mv > 0.15) { a.trk = trackDeg(a.prevP, p); a.prevP = p; }
        } else a.prevP = p;

        const iaf = assignIafStream(ac, a, p);
        const { side, dir: acDir, r } = assignRunway(ac, a, iaf, now, winds, dir, ch, esMixed);
        if (r.vectored) a.vectored = true;
        a.side = side;
        a.dir = acDir;
        if (r.passedIaf && r.viaDownwind) a.passedIaf = true;
        else if (r.passedIaf) { a.passedIaf = true; a.sMin = Math.max(a.sMin || 0, r.sNew - 0.5); }

        // Durchstart: als gelandet gezaehlt, aber wieder in der Luft und steigend -> neu einplanen
        if (a.landed && ac.alt != null && ac.alt > cfg.elevationFt + 800 && ac.gs > 120) {
          a.landed = false; a.locked = false; a.sMin = 0; a.xMin = 0; a.xOn = false;
          const k = st.landed.findIndex(l => l.cs === ac.cs);
          if (k >= 0) { st.cnt[st.landed[k].side] = Math.max(0, st.cnt[st.landed[k].side] - 1); st.landed.splice(k, 1); }
        }
        // Landung erkannt
        const onGround = ac.alt != null && ac.alt < cfg.elevationFt + 60 && ac.gs < 70;
        if ((r.passedIaf && r.remainingNm < 0.4 && (ac.alt == null || ac.alt < cfg.elevationFt + 400)) || (onGround && a.captured)) {
          if (!a.landed && a.captured) { a.landed = true; countLanding(ac.cs, side, now); }
          continue;
        }
        if (a.landed) continue;

        a.lastRem = r.remainingNm; a.lastPassed = r.passedIaf;
        if (!a.captured && r.remainingNm <= cfg.defaults.captureNm) a.captured = true;
        if (!a.captured) continue;

        if (!isFinite(r.eta)) continue; // letzte Sicherung gegen kaputte Werte
        items.push({
          cs: ac.cs, type: ac.type || '', wtc: ac.wtc || 'M', iaf, stream: a.stream, side,
          dir: acDir, rwy: rwyId(side, acDir), tFinal: r.tFinal, eta: r.eta, etaIaf: r.etaIaf, tIafToThr: r.tIafToThr,
          remainingNm: r.remainingNm, passedIaf: r.passedIaf, hold: !!a.hold,
          locked: !!a.locked,
          trackedBy: typeof ac.trackedBy === 'string' && ac.trackedBy ? ac.trackedBy.toUpperCase() : null
        });
      }

      // verschwundene Flieger entfernen
      for (const cs of Object.keys(st.ac)) {
        const a = st.ac[cs];
        if (seen[cs]) continue;
        // kurz vor der Schwelle verschwunden (z. B. Tower hat abgemeldet): erst nach 15 s ohne Daten
        // als gelandet zaehlen, ein einzelner leerer Datentakt loescht keinen Flieger
        if (!a.landed && a.captured && a.lastPassed && a.lastRem < 3 && now - (a.lastSeen || 0) >= 15) {
          a.landed = true;
          countLanding(cs, a.side, a.lastSeen);
        }
        if (now - (a.lastSeen || 0) > cfg.defaults.lostAfterSec) delete st.ac[cs];
      }
      st.landed = st.landed.filter(l => now - l.t < 3600);

      const byCs = {};
      items.forEach(i => { byCs[i.cs] = i; });

      // Hold-Liste
      st.hold = st.hold.filter(cs => byCs[cs] && st.ac[cs] && st.ac[cs].hold);
      for (const i of items) if (i.hold && st.hold.indexOf(i.cs) < 0) st.hold.push(i.cs);

      const tgtDir = ch ? ch.to : dir;
      maintainSeq(items, byCs, tgtDir);
      schedule(byCs, ch, tgtDir, winds);
      for (const i of items) if (i.hold) { i.sta = i.eta; i.delay = 0; }

      const bySide = { N: st.seq.N.map(cs => byCs[cs]), S: st.seq.S.map(cs => byCs[cs]) };
      last = { list: items, bySide, byCs, now, dir, winds, dirChange: ch, esDir: traffic.activeDir || null };
      return last;
    }

    // ---------- Statistik ----------
    function stats(side) {
      const now = last.now;
      const seq = last.bySide[side] || [];
      const flw = seq.filter(i => i.sta - now <= 3600).length;
      const dem = seq.filter(i => i.eta - now <= 3600).length;
      const lands = st.landed.filter(l => l.side === side).sort((a, b) => a.t - b.t);
      const cnt = st.cnt[side];
      const win = [60, 30, 10].map(m => {
        const L = lands.filter(l => now - l.t <= m * 60);
        let sep = 0;
        if (L.length > 1) {
          let sum = 0;
          for (let k = 1; k < L.length; k++) sum += (L[k].t - L[k - 1].t) * cfg.defaults.fixedFinalGs / 3600;
          sep = sum / (L.length - 1);
        }
        return { min: m, lnd: L.length, sep };
      });
      return { flw, dem, cnt, win };
    }

    // ---------- Eingriffe (nur APP) ----------
    function moveTo(cs, side, index) {
      const a = st.ac[cs]; if (!a) return;
      a.hold = false;
      unseq(cs);
      const defSide = cfg.iafs[a.iaf] ? cfg.iafs[a.iaf].side : side;
      a.rwySide = side !== defSide ? side : (a.rwySide && a.rwySide !== side ? null : a.rwySide);
      a.side = side;
      a.locked = true;
      const seq = st.seq[side];
      seq.splice(Math.max(0, Math.min(seq.length, index)), 0, cs);
    }
    /** Flieger auf eine Bahn setzen und nach ETA einsortieren (manuelle Bahn, aber ohne feste Position). */
    function insertByEta(cs, side) {
      const a = st.ac[cs]; if (!a) return;
      const it = last.byCs[cs];
      const seq = st.seq[side].filter(c => c !== cs);
      let idx = seq.length;
      if (it) {
        // vor dem ersten Flieger einsortieren, der spaeter kommt und nicht fest ist
        idx = 0;
        while (idx < seq.length) {
          const o = last.byCs[seq[idx]];
          if (o && o.eta > it.eta && !o.locked && !o.passedIaf) break;
          idx++;
        }
      }
      moveTo(cs, side, idx);
      a.locked = false;
    }
    function toHold(cs) {
      const a = st.ac[cs]; if (!a) return;
      a.hold = true; a.locked = false;
      unseq(cs);
      st.hold.push(cs);
    }
    /** Einen Flieger neu planen: Hold, manuelle Bahn und Position aufheben, nach ETA neu einsortieren. */
    function recomputeOne(cs) {
      const a = st.ac[cs]; if (!a) return;
      a.hold = false; a.locked = false; a.frozenSta = null;
      // hat der Lotse in EuroScope eine Bahn gesetzt, gilt die, sonst der Standard nach IAF
      const sES = a.esByCtl && a.esRwy ? sideOfRwy(a.esRwy) : null;
      a.rwySide = sES && a.iaf && cfg.iafs[a.iaf] && sES !== cfg.iafs[a.iaf].side ? sES : null;
      unseq(cs);
    }
    function recompute() {
      for (const cs of st.hold) if (st.ac[cs]) st.ac[cs].hold = false;
      st.hold = [];
    }
    function setStatic(on) {
      st.staticMode = !!on;
      if (on) for (const i of last.list) if (st.ac[i.cs] && i.sta) st.ac[i.cs].frozenSta = i.sta;
    }
    /** Runway Change planen (at in s) oder sofort (at <= jetzt). */
    function setDirChange(to, at) {
      if (at == null || at <= last.now) { st.dir = to; st.dirChange = null; return; }
      st.dirChange = { id: Date.now() + Math.random(), to, at };
    }
    function clearDirChange() { st.dirChange = null; }
    function addClosure(side, from, to) {
      if (to <= from) return;
      st.closures.push({ id: Date.now() + Math.random(), side, from, to });
    }
    function removeClosure(id) { st.closures = st.closures.filter(c => c.id !== id); }

    // ---------- Gemeinsamer Plan (UNDO und Abgleich zwischen Lotsen) ----------
    /**
     * Alle Eingriffe der Lotsen als kleines Dokument: Reihenfolge, Hold, Bahn und Sperre je Flieger,
     * Bahnsperren, Runway Change, Richtung, static/dynamic, FLOW und Landerate. Die ETAs gehoeren nicht dazu,
     * die rechnet jeder AMAN selbst aus seinen Daten.
     */
    function exportPlan() {
      const ac = {};
      for (const cs of Object.keys(st.ac)) {
        const a = st.ac[cs];
        if (a.rwySide || a.locked || a.hold) ac[cs] = { rwySide: a.rwySide || null, locked: !!a.locked, hold: !!a.hold };
      }
      return JSON.parse(JSON.stringify({
        v: 1, dir: st.dir, dirChange: st.dirChange, closures: st.closures, staticMode: st.staticMode,
        spacing: st.spacing, rate: st.rate, seq: st.seq, hold: st.hold, ac
      }));
    }
    /** Plan uebernehmen (geprueft wie gespeicherter Zustand). Liefert false bei unbrauchbarem Dokument. */
    function applyPlan(doc) {
      if (!doc || typeof doc !== 'object' || doc.v !== 1) return false;
      const ok = sanitizeState(cfg, doc);
      const css = l => (Array.isArray(l) ? l : []).filter(c => typeof c === 'string' && /^[A-Z0-9_-]{2,12}$/.test(c));
      st.dir = ok.dir || st.dir;
      st.dirChange = doc.dirChange ? (ok.dirChange || null) : null;
      st.closures = ok.closures || [];
      if (ok.spacing) st.spacing = ok.spacing;
      if (ok.rate) st.rate = ok.rate;
      st.seq = { N: css(doc.seq && doc.seq.N), S: css(doc.seq && doc.seq.S) };
      st.hold = css(doc.hold);
      const flags = doc.ac && typeof doc.ac === 'object' ? doc.ac : {};
      for (const cs of Object.keys(st.ac)) if (!flags[cs]) Object.assign(st.ac[cs], { rwySide: null, locked: false, hold: false });
      for (const cs of css(Object.keys(flags))) {
        const f = flags[cs] || {};
        // noch nicht gesehene Flieger: Eintrag anlegen, die Daten kommen mit dem naechsten Update
        const a = st.ac[cs] || (st.ac[cs] = { lastSeen: last.now || 0 });
        a.rwySide = f.rwySide === 'N' || f.rwySide === 'S' ? f.rwySide : null;
        a.locked = !!f.locked; a.hold = !!f.hold;
      }
      if (st.staticMode !== !!doc.staticMode) setStatic(!!doc.staticMode);
      return true;
    }
    return {
      cfg, state: st, update, stats, moveTo, insertByEta, toHold, recompute, recomputeOne, setStatic,
      addClosure, removeClosure, setDirChange, clearDirChange, exportPlan, applyPlan, paths, dwPaths, proj,
      get last() { return last; }
    };
  }

  /** Rolle aus dem Callsign ableiten. */
  function roleFor(cfg, callsign) {
    if (!callsign) return 'OBS';
    for (const r of ['APP', 'TWR', 'CTR']) if (new RegExp(cfg.roles[r]).test(callsign)) return r;
    return 'OBS';
  }
  /**
   * CTR-Ansicht aus dem Callsign, z. B. EDMM_NDG_CTR -> ROKIL, EDMM_FUE_CTR -> BETOS-FUE.
   * online = Liste der eingeloggten Callsigns (falls das Plugin sie liefert): Ist bei FUE/STA
   * der Nachbarsektor nicht besetzt, gibt es die combined-Ansicht mit beiden Stroemen.
   */
  function ctrSector(cfg, callsign, online) {
    const views = cfg.ctrViews || [];
    const direct = views.find(v => v.callsign && new RegExp(v.callsign).test(callsign || ''));
    if (direct) return direct.id;
    const m = /^EDMM_([A-Z0-9]+?)\d?_CTR$/.exec(callsign || '');
    if (!m) return null;
    const own = views.find(v => v.sector === m[1]);
    if (!own) return null;
    if (Array.isArray(online)) {
      const comb = views.find(v => v.combine && v.combine.indexOf(m[1]) >= 0);
      if (comb) {
        const others = comb.combine.filter(x => x !== m[1]);
        const staffed = others.some(x => online.some(c => new RegExp('^EDMM_' + x + '\\d?_CTR$').test(c)));
        if (!staffed) return comb.id;
      }
    }
    return own.id;
  }

  return {
    createEngine, sanitizeState, downwindPaths, streamByRoute, roleFor, ctrSector, parseMetarWind, makeProjection, preparePaths, pointAt,
    // gemeinsam mit der Simulation
    headwind, tasFromIas, trackDeg, angDiff, altAt, profileIas, vappFor, rayHit, rayHits, finalGeo, finalCross
  };
});
