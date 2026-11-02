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

  /** Projektion einer Position auf den Pfad, nur vorwaerts ab minS. */
  function project(path, p, minS) {
    let best = null;
    for (let i = 1; i < path.pts.length; i++) {
      if (path.cum[i] < minS) continue;
      const a = path.pts[i - 1], b = path.pts[i];
      const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1;
      let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2;
      t = Math.max(0, Math.min(1, t));
      let s = path.cum[i - 1] + t * (path.cum[i] - path.cum[i - 1]);
      if (s < minS) s = minS;
      const q = pointAt(path, s);
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (!best || d < best.cross) best = { s, cross: d };
    }
    return best || { s: minS, cross: 0 };
  }

  /**
   * Erster Schnittpunkt eines Strahls (Position, Kurs) mit dem Pfad hinter minS.
   * Liefert { s, d } (Pfadposition und Direktentfernung) oder null.
   */
  function rayHit(path, p, trk, minS, maxD) {
    const ux = Math.sin(trk * Math.PI / 180), uy = Math.cos(trk * Math.PI / 180);
    let best = null;
    for (let i = 1; i < path.pts.length; i++) {
      if (path.cum[i] <= minS) continue;
      const a = path.pts[i - 1], b = path.pts[i];
      const ex = b.x - a.x, ey = b.y - a.y;
      const den = ux * ey - uy * ex;
      if (Math.abs(den) < 1e-6) continue; // parallel
      const wx = a.x - p.x, wy = a.y - p.y;
      const u = (wx * ey - wy * ex) / den;   // Entfernung entlang des Strahls
      const t = (wx * uy - wy * ux) / den;   // Anteil auf dem Segment
      if (u < 0.3 || u > maxD || t < 0 || t > 1) continue;
      const sHit = path.cum[i - 1] + t * (path.cum[i] - path.cum[i - 1]);
      if (sHit <= minS) continue;
      if (!best || u < best.d) best = { s: sHit, d: u };
    }
    return best;
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
      const alt = Math.min(10000, cfg.elevationFt + r * 318);
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
      for (const k of withFix) { const d = Math.abs(((brg - streams[k]._brg) % 360 + 540) % 360 - 180); if (d < bd) { bd = d; best = k; } }
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
      dir: 'auto',                 // 'auto' | '26' | '08'
      staticMode: false,
      spacing: { N: d.spacingNm, S: d.spacingNm },
      rate: { N: d.ratePerRwy, S: d.ratePerRwy },
      finalGsMode: d.finalGsMode,
      timelineMin: d.timelineMin,
      closures: [],                // {id, side, from, to}
      ac: {},                      // pro Callsign: rwySide, hold, locked, captured, sMin, frozenSta, iaf
      seq: { N: [], S: [] },
      hold: [],
      landed: []                   // {cs, side, t}
    };
  }

  function createEngine(cfg, savedState) {
    const proj = makeProjection(cfg.wind.lat, cfg.wind.lon);
    const paths = preparePaths(cfg, proj);
    const st = Object.assign(defaultState(cfg), savedState || {});
    let last = { list: [], bySide: { N: [], S: [] }, byCs: {}, now: 0 };

    const iafXY = {};
    for (const k of Object.keys(cfg.iafs)) iafXY[k] = proj.xy(cfg.iafs[k].lat, cfg.iafs[k].lon);
    // Peilung IAF -> Einflugpunkt je Strom (fuer Fluege ohne Route)
    for (const k of Object.keys(cfg.iafs)) {
      const st0 = cfg.iafs[k].streams || {};
      for (const n of Object.keys(st0)) if (st0[n].fix) st0[n]._brg = trackDeg(iafXY[k], proj.xy(st0[n].fix.lat, st0[n].fix.lon));
    }

    function rwyId(side, dir) { return cfg.runways[side].ids[dir]; }
    function closedAt(side, t) {
      return st.closures.find(c => c.side === side && t >= c.from && t < c.to) || null;
    }
    function sideClosedLong(side, t) {
      // Bahn gilt fuer die Zuteilung als zu, wenn sie zur ETA gesperrt ist
      return !!closedAt(side, t);
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

    /** Mindestabstand (Radar oder Wirbelschleppe) in Sekunden, ohne FLOW und Landerate. */
    function minSepSeconds(lead, foll, side, dir, winds) {
      const nm = Math.max(cfg.defaults.minRadarSepNm || 2.5, wakeNm(lead, foll));
      return nm / finalGs(foll, side, dir, winds) * 3600;
    }

    /**
     * ETA fuer ein Flugzeug auf einem bestimmten Pfad.
     * Liefert eta (Touchdown), etaIaf, remainingNm, passedIaf, sNew.
     */
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
        pr = project(path, p, a.sMin || 0);
        const along = effRemaining(cfg, path, pr.s);
        // Querabweichung (Vektoren, Delay) zaehlt als zusaetzliche Strecke zurueck auf den Pfad
        const extra = pr.cross > 1 ? pr.cross : 0;
        const gs = ac.gs > 60 ? ac.gs : 200;
        let t = ttgAt(ttg, pr.s) + extra / gs * 3600, rem = along + extra, cut = false;
        // Abkuerzung: Kurs schneidet den Pfad weiter vorn (z. B. frueh auf den Base oder direkt aufs Final)
        const trk = a.trk;
        if (trk != null) {
          const hit = rayHit(path, p, trk, pr.s + 1, 30);
          if (hit && hit.s - pr.s > hit.d + cfg.defaults.shortcutMinNm) {
            const tHit = hit.d / gs * 3600 + ttgAt(ttg, hit.s);
            if (tHit < t) { t = tHit; rem = hit.d + effRemaining(cfg, path, hit.s); cut = true; }
          }
        }
        return { eta: now + t, etaIaf: null, remainingNm: rem, passedIaf: true, sNew: pr.s, tIafToThr: ttg[0], shortcut: cut };
      }
      const dIaf = ac.distToIaf != null ? Math.max(ac.distToIaf, toIafDirect) : toIafDirect;
      let gs;
      if (ac.alt >= 10000 && ac.gs > 120) gs = ac.gs;
      else {
        const trk = trackDeg(p, path.pts[0]);
        gs = Math.max(150, tasFromIas(cfg.profile.belowFL100, Math.max(ac.alt || 8000, 4000)) - headwind(trk, winds.aloft));
      }
      const tIaf = dIaf / gs * 3600;
      return { eta: now + tIaf + ttg[0], etaIaf: now + tIaf, remainingNm: dIaf + effRemaining(cfg, path, 0), passedIaf: false, sNew: 0, tIafToThr: ttg[0] };
    }

    /**
     * Haupt-Update. traffic = { aircraft: [...], activeDir?: '26'|'08', metar? }
     * winds = { surface:{dir,spd}, aloft:{dir,spd} }
     */
    function update(traffic, now, winds) {
      winds = winds || {};
      const dir = st.dir === 'auto' ? (traffic.activeDir || '26') : st.dir;
      const seen = {};
      const items = [];

      for (const ac of traffic.aircraft || []) {
        if (!ac || !ac.cs) continue;
        seen[ac.cs] = true;
        let a = st.ac[ac.cs];
        if (!a) a = st.ac[ac.cs] = { firstSeen: now };
        a.lastSeen = now;
        const p = proj.xy(ac.lat, ac.lon);
        // Kurs ueber Grund: aus den Daten, sonst aus der Bewegung seit dem letzten Update
        if (ac.trk != null) a.trk = ac.trk;
        else if (ac.hdg != null) a.trk = ac.hdg;
        else if (a.prevP) {
          const mv = dist(a.prevP, p);
          if (mv > 0.15) { a.trk = trackDeg(a.prevP, p); a.prevP = p; }
        } else a.prevP = p;
        const iaf = (ac.iaf && cfg.iafs[ac.iaf]) ? ac.iaf : (a.iaf || nearestIaf(p));
        a.iaf = iaf;
        a.viaIaf = !!(ac.iaf && cfg.iafs[ac.iaf]);
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

        // Bahnzuteilung: manuell > Standard nach IAF > Ausweichen bei Sperre
        let side = a.rwySide || cfg.iafs[iaf].side;
        let path = paths[iaf][rwyId(side, dir)];
        let r = computeEta(ac, a, path, now, winds);
        if (!a.rwySide && sideClosedLong(side, r.eta)) {
          const other = side === 'N' ? 'S' : 'N';
          const p2 = paths[iaf][rwyId(other, dir)];
          const r2 = computeEta(ac, a, p2, now, winds);
          if (!sideClosedLong(other, r2.eta)) { side = other; path = p2; r = r2; }
        }
        a.side = side;
        if (r.passedIaf) { a.passedIaf = true; a.sMin = Math.max(a.sMin || 0, r.sNew - 0.5); }

        // Landung erkannt
        const onGround = ac.alt != null && ac.alt < cfg.elevationFt + 60 && ac.gs < 70;
        if ((r.passedIaf && r.remainingNm < 0.4) || (onGround && a.captured)) {
          if (!a.landed && a.captured) {
            a.landed = true;
            st.landed.push({ cs: ac.cs, side, t: now });
            st.cnt = st.cnt || { N: 0, S: 0 };
            st.cnt[side]++;
          }
          continue;
        }
        if (a.landed) continue;

        a.lastRem = r.remainingNm; a.lastPassed = r.passedIaf;
        if (!a.captured && r.remainingNm <= cfg.defaults.captureNm) a.captured = true;
        if (!a.captured) continue;

        items.push({
          cs: ac.cs, type: ac.type || '', wtc: ac.wtc || 'M', iaf, stream: a.stream, viaIaf: a.viaIaf, side,
          rwy: rwyId(side, dir), eta: r.eta, etaIaf: r.etaIaf, tIafToThr: r.tIafToThr,
          remainingNm: r.remainingNm, passedIaf: r.passedIaf, hold: !!a.hold,
          locked: !!a.locked, manualRwy: !!a.rwySide, shortcut: !!r.shortcut
        });
      }

      // verschwundene Flieger entfernen
      for (const cs of Object.keys(st.ac)) {
        const a = st.ac[cs];
        if (seen[cs]) continue;
        // kurz vor der Schwelle verschwunden (z. B. Tower hat abgemeldet): als gelandet zaehlen
        if (!a.landed && a.captured && a.lastPassed && a.lastRem < 3) {
          a.landed = true;
          st.landed.push({ cs, side: a.side, t: a.lastSeen });
          st.cnt = st.cnt || { N: 0, S: 0 };
          st.cnt[a.side]++;
        }
        if (now - (a.lastSeen || 0) > cfg.defaults.lostAfterSec) delete st.ac[cs];
      }
      st.landed = st.landed.filter(l => now - l.t < 3600);

      const byCs = {};
      items.forEach(i => { byCs[i.cs] = i; });

      // Hold-Liste
      st.hold = st.hold.filter(cs => byCs[cs] && st.ac[cs] && st.ac[cs].hold);
      for (const i of items) if (i.hold && st.hold.indexOf(i.cs) < 0) st.hold.push(i.cs);

      // Sequenz je Bahn pflegen
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
        {
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
        }
        st.seq[side] = seq;

        // STA berechnen
        let prevItem = null;
        seq.forEach((cs, idx) => {
          const it = byCs[cs], a = st.ac[cs];
          // reqSta = geplante Landezeit mit Staffelung (daraus das Delay, das noch aufzunehmen ist)
          let req = it.eta;
          if (st.staticMode && a.frozenSta && !it.passedIaf) req = Math.max(req, a.frozenSta);
          if (prevItem) req = Math.max(req, prevItem.reqSta + sepSeconds(prevItem, it, side, dir, winds));
          let guard2 = 0, c;
          while ((c = closedAt(side, req)) && guard2++ < 20) req = c.to;
          // Hinter dem IAF steht der Streifen auf der aktuellen Vorhersage: werden Zeit und Meilen
          // auf Downwind oder Final kuerzer (Abkuerzung, schneller), rueckt er sofort nach.
          // Vor dem IAF steht er auf der geplanten Zeit.
          // Nicht naeher als die Mindeststaffelung (Radar oder Wirbelschleppe) an den Vordermann.
          let sta = req;
          if (it.passedIaf) {
            sta = it.eta;
            if (prevItem) sta = Math.max(sta, prevItem.sta + minSepSeconds(prevItem, it, side, dir, winds));
          }
          it.sta = sta;
          it.reqSta = req;
          it.delay = req - it.eta;
          it.seqIndex = idx;
          it.gapToPrev = prevItem ? sta - prevItem.sta : null;
          if (it.etaIaf != null) {
            const staIaf = sta - it.tIafToThr;
            it.staIaf = staIaf;
            it.delayIaf = Math.max(0, staIaf - it.etaIaf);
            const ctr = Math.min(it.delayIaf, cfg.defaults.ctrMaxDelayMin * 60);
            it.ctrStrokes = Math.round(ctr / 60);
          } else { it.staIaf = null; it.delayIaf = 0; it.ctrStrokes = 0; }
          if (!st.staticMode) a.frozenSta = null;
          prevItem = it;
        });
      }
      for (const i of items) if (i.hold) { i.sta = i.eta; i.delay = 0; }

      const bySide = { N: st.seq.N.map(cs => byCs[cs]), S: st.seq.S.map(cs => byCs[cs]) };
      last = { list: items, bySide, byCs, now, dir, winds };
      return last;
    }

    // ---------- Statistik ----------
    function stats(side) {
      const now = last.now;
      const seq = last.bySide[side] || [];
      const flw = seq.filter(i => i.sta - now <= 3600).length;
      const dem = seq.filter(i => i.eta - now <= 3600).length;
      const lands = st.landed.filter(l => l.side === side).sort((a, b) => a.t - b.t);
      const cnt = (st.cnt && st.cnt[side]) || 0;
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
      st.hold = st.hold.filter(c => c !== cs);
      for (const s of SIDES) st.seq[s] = st.seq[s].filter(c => c !== cs);
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
      for (const s of SIDES) st.seq[s] = st.seq[s].filter(c => c !== cs);
      if (st.hold.indexOf(cs) < 0) st.hold.push(cs);
    }
    /** Einen Flieger neu planen: Hold, manuelle Bahn und Position aufheben, nach ETA neu einsortieren. */
    function recomputeOne(cs) {
      const a = st.ac[cs]; if (!a) return;
      a.hold = false; a.locked = false; a.rwySide = null; a.frozenSta = null;
      st.hold = st.hold.filter(c => c !== cs);
      for (const s of SIDES) st.seq[s] = st.seq[s].filter(c => c !== cs);
    }
    function recompute() {
      for (const cs of st.hold) if (st.ac[cs]) st.ac[cs].hold = false;
      st.hold = [];
    }
    function unlock(cs) { const a = st.ac[cs]; if (a) { a.locked = false; a.rwySide = null; } }
    function setStatic(on) {
      st.staticMode = !!on;
      if (on) for (const i of last.list) if (st.ac[i.cs] && i.sta) st.ac[i.cs].frozenSta = i.sta;
    }
    function addClosure(side, from, to) {
      if (to <= from) return;
      st.closures.push({ id: Date.now() + Math.random(), side, from, to });
    }
    function removeClosure(id) { st.closures = st.closures.filter(c => c.id !== id); }
    return {
      cfg, state: st, update, stats, moveTo, insertByEta, toHold, recompute, recomputeOne, unlock, setStatic,
      addClosure, removeClosure, paths, proj, timeTable: (path, vapp, winds) => timeTable(cfg, path, vapp, winds),
      get last() { return last; },
      set: (k, v) => { st[k] = v; },
      exportState: () => JSON.parse(JSON.stringify(Object.assign({}, st, { ac: st.ac })))
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
    const m = /^EDMM_([A-Z0-9]+?)\d?_CTR$/.exec(callsign || '') || /^EDMM_([A-Z0-9]+)_CTR$/.exec(callsign || '');
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

  return { createEngine, rayHit, streamByRoute, roleFor, ctrSector, parseMetarWind, makeProjection, headwind, tasFromIas, preparePaths, pointAt };
});
