/*
 * Simulationsmodus: erzeugt Anflugverkehr fuer EDDM ohne EuroScope.
 * Die Flieger nehmen das Delay aus dem AMAN auf (vor dem IAF per Speed, danach wie per Vektoren).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./aman-core.js'));
  else root.AmanSim = factory(root.AmanCore);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';

  const AIRLINES = ['DLH', 'DLH', 'DLH', 'CLH', 'EWG', 'AUA', 'SWR', 'BAW', 'AFR', 'KLM', 'TAP', 'IBE', 'SAS', 'CFG', 'TUI', 'RYR', 'EZY', 'UAE', 'QTR', 'THY', 'LOT', 'CSA', 'ITY', 'AEE', 'UAL', 'DAL', 'SIA', 'ETD', 'CCA', 'BCS'];
  const TYPES = [
    ['A320', 'M', 18], ['A20N', 'M', 14], ['A319', 'M', 8], ['A321', 'M', 10], ['B738', 'M', 10], ['CRJ9', 'M', 6], ['E190', 'M', 6],
    ['BCS3', 'M', 4], ['DH8D', 'M', 3], ['AT76', 'M', 2], ['A333', 'H', 3], ['A359', 'H', 4], ['B77W', 'H', 3], ['B789', 'H', 3],
    ['B748', 'H', 2], ['A388', 'J', 1], ['C25B', 'L', 1]
  ];
  // Einflugrichtungen je IAF (Peilung vom IAF aus); BETOS hat zwei Stroeme: West (FUE) und Sued (STA)
  // je Eintrag: Peilung vom IAF und Route (wie im Flugplan); BETOS und NAPSA haben je zwei Stroeme
  const INBOUND = {
    ROKIL: [[300, 'ROKIL']],
    LANDU: [[23, 'LULAR T105 LANDU'], [38, 'NIRGO T108 LANDU'], [30, 'VESUB T106 LANDU']],
    BETOS: [[218, 'DISUN T103 BETOS'], [218, 'DISUN T103 BETOS'], [185, 'SOTOV T101 BETOS']],
    NAPSA: [[98, 'AMADI Q113 NAPSA'], [121, 'REDBU Q112 NAPSA']]
  };
  const WEIGHT = { ROKIL: 0.3, LANDU: 0.2, BETOS: 0.3, NAPSA: 0.2 };

  function createSim(cfg, opts) {
    opts = opts || {};
    let rnd = opts.seed != null ? mulberry(opts.seed) : Math.random;
    const proj = Core.makeProjection(cfg.wind.lat, cfg.wind.lon);
    const paths = Core.preparePaths(cfg, proj);
    const dwPaths = Core.downwindPaths(cfg, paths);
    // APP-Holdings je IAF (Fix, Inbound-Kurs, Kurvenrichtung)
    const holdAt = {};
    for (const h of cfg.holdings || []) if (h.unit === 'APP' && cfg.iafs[h.iaf]) holdAt[h.iaf] = { F: proj.xy(cfg.iafs[h.fix] ? cfg.iafs[h.fix].lat : h.lat, cfg.iafs[h.fix] ? cfg.iafs[h.fix].lon : h.lon), inb: h.inbound, turn: h.turn === 'L' ? -1 : 1 };
    const sim = {
      t: opts.start || Math.floor(Date.now() / 1000),
      rate: opts.rate || 40,
      dir: opts.dir || '26',
      wind: opts.wind || { surface: { dir: 250, spd: 10 }, aloft: { dir: 270, spd: 35 } },
      aircraft: [],
      nextSpawn: 0,
      used: {}
    };

    function pick(weights) {
      let r = rnd() * weights.reduce((a, w) => a + w[1], 0);
      for (const w of weights) { r -= w[1]; if (r <= 0) return w[0]; }
      return weights[0][0];
    }
    function callsign() {
      for (let i = 0; i < 50; i++) {
        const cs = AIRLINES[Math.floor(rnd() * AIRLINES.length)] + (Math.floor(rnd() * 900) + 100) + (rnd() < 0.3 ? String.fromCharCode(65 + Math.floor(rnd() * 26)) : '');
        if (!sim.used[cs]) { sim.used[cs] = 1; return cs; }
      }
      return 'SIM' + Math.floor(rnd() * 99999);
    }

    function spawn(distFromIaf) {
      const iaf = pick(Object.keys(WEIGHT).map(k => [k, WEIGHT[k]]));
      const t = TYPES[Math.floor(pickIndex(TYPES.map(x => x[2])))];
      const dirs = INBOUND[iaf];
      const inb = dirs[Math.floor(rnd() * dirs.length)];
      const brg = (inb[0] + (rnd() - 0.5) * 8) * Math.PI / 180;
      const d = distFromIaf != null ? distFromIaf : 150 + rnd() * 30;
      const I = proj.xy(cfg.iafs[iaf].lat, cfg.iafs[iaf].lon);
      const ac = {
        cs: callsign(), type: t[0], wtc: t[1], iaf, route: inb[1],
        x: I.x + Math.sin(brg) * d, y: I.y + Math.cos(brg) * d,
        alt: 0, gs: 0, phase: 'enroute', s: 0, d0: Math.max(d, 60),
        cut: rnd() < 0.35, // APP dreht diesen Flieger frueh auf das Final, wenn er kein Delay hat
        esRwy: cfg.runways[cfg.iafs[iaf].side].ids[sim.dir] // Landebahn im Flugplan wie in EuroScope
      };
      ac.alt = altFor(ac, d);
      sim.aircraft.push(ac);
      return ac;
    }
    function pickIndex(w) {
      let r = rnd() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; }
      return 0;
    }
    function altFor(ac, dIaf) { return Math.min(37000, 10000 + Math.max(0, dIaf - 20) * 260); }

    /** Fuellt den Luftraum zu Beginn, damit die Timeline nicht leer startet. */
    function prefill() {
      const n = Math.round(sim.rate * 0.9);
      for (let i = 0; i < n; i++) spawn(10 + rnd() * 170);
      // ein paar Flieger sind schon hinter dem IAF unterwegs
      const m = Math.round(sim.rate * 0.25);
      for (let i = 0; i < m; i++) {
        const ac = spawn(0);
        const path = paths[ac.iaf][cfg.runways[cfg.iafs[ac.iaf].side].ids[sim.dir]];
        ac.phase = 'path'; ac.s = (i + 0.5) / m * (path.length - 2);
        const q = Core.pointAt(path, ac.s); ac.x = q.x; ac.y = q.y;
      }
    }

    /** Einen Simulationsschritt rechnen. last = engine.last fuer Delay und Bahnzuteilung. */
    function step(dt, last) {
      sim.t += dt;
      sim.nextSpawn -= dt;
      while (sim.nextSpawn <= 0) {
        spawn();
        sim.nextSpawn += 3600 / sim.rate * (0.5 + rnd());
      }
      const byCs = (last && last.byCs) || {};
      for (const ac of sim.aircraft) {
        const info = byCs[ac.cs];
        if (ac.phase === 'enroute') {
          const I = proj.xy(cfg.iafs[ac.iaf].lat, cfg.iafs[ac.iaf].lon);
          const dx = I.x - ac.x, dy = I.y - ac.y, d = Math.hypot(dx, dy);
          let gs = ac.alt > 25000 ? 460 : ac.alt > 10500 ? 380 : 290;
          // CTR nimmt bis zu 5 min per Speed auf
          if (info && info.delayIaf > 20 && info.etaIaf) {
            const tNom = info.etaIaf - sim.t;
            const want = tNom + Math.min(info.delayIaf, cfg.defaults.ctrMaxDelayMin * 60);
            gs = Math.max(gs * 0.72, gs * tNom / Math.max(want, 1));
          }
          ac.gs = gs;
          const move = gs * dt / 3600;
          if (move >= d || d < 1) {
            ac.x = I.x; ac.y = I.y; ac.phase = 'path'; ac.s = 0;
          } else {
            ac.x += dx / d * move; ac.y += dy / d * move;
            ac.hdg = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
          }
          ac.alt = altFor(ac, Math.max(0, d - move));
        } else if (ac.phase === 'path') {
          // ohne AMAN-Info (z. B. kurz vor dem Aufsetzen schon als gelandet gezaehlt) bleibt die Bahn
          const rwy = (info && info.rwy) || ac.rwy || cfg.runways[cfg.iafs[ac.iaf].side].ids[sim.dir];
          // andere Bahn als ueber den IAF vorgesehen: per Vektoren auf deren Downwind
          const native = cfg.iafs[ac.iaf].side;
          const onOther = info && info.side && info.side !== native;
          if (onOther && (!ac.pathRef || ac.pathRef.rwy !== rwy) && dwPaths[rwy]) {
            const D = dwPaths[rwy];
            // Eintritt auf dem neuen Downwind etwas voraus: naechster Punkt plus 3 NM
            let best = null;
            for (let sx = D.sDw; sx < D.sAb; sx += 0.5) { const q = Core.pointAt(D.path, sx); const dd = Math.hypot(q.x - ac.x, q.y - ac.y); if (!best || dd < best.d) best = { s: sx, d: dd }; }
            // kreuzt der Weg dorthin die verlaengerte Anfluglinie ab 8 NM, dreht APP den Flieger direkt aufs Final
            // (dieselbe Regel wie im AMAN)
            {
              const P2 = D.path, fi = P2.pts.findIndex(q => q.name === 'FAP15');
              const thr = P2.pts[P2.pts.length - 1], fap = P2.pts[fi], Lf = Math.hypot(fap.x - thr.x, fap.y - thr.y) || 1;
              const ox = (fap.x - thr.x) / Lf, oy = (fap.y - thr.y) / Lf;
              const J = Core.pointAt(P2, Math.min(D.sAb, best.s + 3));
              const vx = J.x - ac.x, vy = J.y - ac.y;
              const ex = ox * 30, ey = oy * 30, den = vx * ey - vy * ex;
              if (fi > 0 && Math.abs(den) > 1e-6) {
                const wx = thr.x - ac.x, wy = thr.y - ac.y;
                const u = (wx * ey - wy * ex) / den, f = (wx * vy - wy * vx) / den;
                if (u > 0 && u < 1 && f * 30 >= 8 && f <= 1) {
                  const r = Math.min(15, f * 30);
                  ac.phase = 'direct'; ac.path = P2; ac.sT = P2.length - r; ac.rwy = rwy;
                  continue;
                }
              }
            }
            ac.phase = 'direct'; ac.path = D.path; ac.sT = Math.min(D.sAb, best.s + 3); ac.rwy = rwy;
            continue;
          }
          const path = ac.pathRef && ac.pathRef.rwy === rwy ? ac.pathRef : paths[ac.iaf][rwy];
          if (ac.rwy && ac.rwy !== rwy) ac.s = Math.min(ac.s, path.length - 1);
          ac.rwy = rwy;
          const r = path.length - ac.s;
          const vapp = cfg.vapp.types[ac.type] || cfg.vapp.wtc[ac.wtc];
          const P = cfg.profile;
          const ias = r > P.finalNm ? P.downwind : r > P.finalSlowNm ? P.final + (P.fap - P.final) * (r - P.finalSlowNm) / (P.finalNm - P.finalSlowNm) : vapp + (P.final - vapp) * r / P.finalSlowNm;
          const alt = Math.min(10000, cfg.elevationFt + r * 318);
          const trkNow = Core.pointAt(path, ac.s).trk;
          const w = r > P.finalNm ? sim.wind.aloft : sim.wind.surface;
          let gs = Math.max(80, Core.tasFromIas(ias, alt) - Core.headwind(trkNow, w));
          const gsTrue = gs;
          // APP verlaengert per Vektoren: Fortschritt entlang des Pfades wird langsamer
          if (info && info.delay > 5 && r > P.finalNm) {
            // Delay muss vor dem 15-NM-Final weg sein: nur die Zeit bis dorthin wird gestreckt
            const tBeforeFinal = Math.max(1, (r - P.finalNm) * path.k / gs * 3600);
            const f = tBeforeFinal / (tBeforeFinal + info.delay);
            // nahe am IAF darf der Flieger auch kreisen (Holding), auf dem Downwind nur strecken
            const floor = ac.s < 3 ? 0 : 0.25;
            const absorbable = tBeforeFinal * (1 / 0.25 - 1) * 0.8;
            if (ac.s < 3 && info.delay > absorbable && holdAt[ac.iaf]) {
              // zu viel Delay fuer den Downwind: Warteschleife am IAF (APP-Holding)
              ac.phase = 'hold'; ac.hp = 0; ac.hold = holdAt[ac.iaf];
              continue;
            }
            gs = gs * Math.max(floor, Math.min(1, f));
          }
          ac.gs = gsTrue;
          // Abkuerzung: ohne Delay vom Downwind direkt auf ein 12-NM-Final
          if (ac.cut && !ac.didCut && r > P.finalNm + 6 && ac.s > 3 && (!info || info.delay < 20)) {
            const sT = path.length - (P.finalNm - 3);
            const T = Core.pointAt(path, sT), here = Core.pointAt(path, ac.s);
            const dDirect = Math.hypot(T.x - here.x, T.y - here.y);
            // nur abkuerzen, wenn danach noch genug Abstand zum Vordermann bleibt (gut 2 min)
            const saved = ((sT - ac.s) * path.k - dDirect) / Math.max(150, gs) * 3600;
            let room = true;
            if (info) {
              const seq = (last && last.bySide && last.bySide[info.side]) || [];
              // nach der Abkuerzung gut 2 min Abstand zu jedem anderen Flieger auf der Bahn (geplante Zeiten)
              const tNew = info.eta - saved;
              room = info.delay < 20 && !seq.some(o => o && o !== info && Math.abs(Math.max(o.sta, o.reqSta || o.sta) - tNew) < 130);
            }
            if (sT - ac.s > dDirect + 4 && room) {
              ac.didCut = true; ac.phase = 'direct'; ac.sT = sT; ac.path = path;
              continue;
            }
          }
          ac.s += gs * dt / 3600 / (r > P.finalNm ? path.k : 1);
          const q = Core.pointAt(path, ac.s);
          ac.x = q.x; ac.y = q.y; ac.hdg = q.trk; ac.alt = alt;
          if (ac.s >= path.length) ac.phase = 'landed';
        }
      }
      // Warteschleife: Racetrack mit Inbound-Kurs und Kurvenrichtung aus eddm.json, 1-Minuten-Schenkel
      for (const ac of sim.aircraft) {
        if (ac.phase !== 'hold') continue;
        const H = ac.hold, info = byCs[ac.cs];
        const gs = 210, L = gs / 60, R = 1.6, per = 2 * L + 2 * Math.PI * R;
        ac.hp += gs * dt / 3600;
        // raus, wenn das Delay auf dem Downwind aufgenommen werden kann, und nur am Fix
        if (ac.hp >= per) {
          ac.hp -= per;
          if (!info || info.delay <= Math.max(60, info.tIafToThr * 0.6)) { ac.phase = 'path'; ac.s = 0; ac.x = H.F.x; ac.y = H.F.y; ac.hold = null; continue; }
        }
        const q = racetrack(H, ac.hp, L, R);
        ac.x = q.x; ac.y = q.y; ac.hdg = q.hdg; ac.gs = gs;
      }
      for (const ac of sim.aircraft) {
        if (ac.phase !== 'direct') continue;
        const T = Core.pointAt(ac.path, ac.sT);
        const dx = T.x - ac.x, dy = T.y - ac.y, d = Math.hypot(dx, dy);
        const trk = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
        const w = sim.wind.aloft;
        const gs = Math.max(120, Core.tasFromIas(cfg.profile.downwind, ac.alt) - Core.headwind(trk, w));
        const move = gs * dt / 3600;
        ac.gs = gs; ac.hdg = trk;
        if (move >= d) { ac.x = T.x; ac.y = T.y; ac.s = ac.sT; ac.phase = 'path'; ac.pathRef = ac.path; }
        else { ac.x += dx / d * move; ac.y += dy / d * move; }
        ac.alt = Math.max(cfg.elevationFt + 3000, ac.alt - 1200 * dt / 60);
      }
      sim.aircraft = sim.aircraft.filter(a => a.phase !== 'landed');
    }

    /** Verkehrsbild im gleichen Format wie vom EuroScope-Plugin. */
    function traffic() {
      return {
        source: 'sim',
        // keine activeDir: in der Simulation gibt es kein EuroScope, das eine Richtung melden koennte
        aircraft: sim.aircraft.map(a => {
          const p = proj.ll(a.x, a.y);
          return { cs: a.cs, type: a.type, wtc: a.wtc, lat: p.lat, lon: p.lon, alt: Math.round(a.alt), gs: Math.round(a.gs), hdg: a.hdg, iaf: a.iaf, route: a.route, arrRwy: a.esRwy || undefined, passedIaf: a.phase === 'path' || a.phase === 'direct' || a.phase === 'hold', inHold: a.phase === 'hold' || undefined };
        })
      };
    }

    /** Wie ein Lotse in EuroScope: Landebahn im Flugplan eines Fliegers aendern. */
    function setRunway(cs, rwy) { const a = sim.aircraft.find(x => x.cs === cs); if (a) a.esRwy = rwy; return !!a; }

    return { sim, step, traffic, prefill, spawn, setRunway };
  }

  /** Punkt auf dem Racetrack: Start am Fix, Kurve weg, Outbound, Kurve zurueck, Inbound bis zum Fix. */
  function racetrack(H, p, L, R) {
    const rad = d => d * Math.PI / 180;
    const inb = H.inb, out = (inb + 180) % 360, side = (inb + 90 * H.turn + 360) % 360;
    const u = (d, n) => ({ x: Math.sin(rad(d)) * n, y: Math.cos(rad(d)) * n });
    const C1 = { x: H.F.x + u(side, R).x, y: H.F.y + u(side, R).y };           // Mittelpunkt erste Kurve
    const arc = Math.PI * R;
    if (p < arc) {                       // Kurve 1: vom Fix auf den Outbound-Kurs
      const a = p / R, ang = (side + 180 + H.turn * a * 180 / Math.PI + 360) % 360;
      return { x: C1.x + u(ang, R).x, y: C1.y + u(ang, R).y, hdg: (inb + H.turn * a * 180 / Math.PI + 360) % 360 };
    }
    const E1 = { x: H.F.x + u(side, 2 * R).x, y: H.F.y + u(side, 2 * R).y };    // Ende Kurve 1
    if (p < arc + L) { const d = p - arc; return { x: E1.x + u(out, d).x, y: E1.y + u(out, d).y, hdg: out }; }
    const E2 = { x: E1.x + u(out, L).x, y: E1.y + u(out, L).y };
    const C2 = { x: E2.x - u(side, R).x, y: E2.y - u(side, R).y };
    if (p < 2 * arc + L) {
      const a = (p - arc - L) / R, ang = (side + H.turn * a * 180 / Math.PI + 360) % 360;
      return { x: C2.x + u(ang, R).x, y: C2.y + u(ang, R).y, hdg: (out + H.turn * a * 180 / Math.PI + 360) % 360 };
    }
    const S = { x: H.F.x - u(inb, L).x, y: H.F.y - u(inb, L).y }, d = p - 2 * arc - L;
    return { x: S.x + u(inb, d).x, y: S.y + u(inb, d).y, hdg: inb };
  }

  function mulberry(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  return { createSim };
});
