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
  const INBOUND = { ROKIL: 300, LANDU: 25, BETOS: 225, NAPSA: 95 };
  const WEIGHT = { ROKIL: 0.3, LANDU: 0.2, BETOS: 0.3, NAPSA: 0.2 };

  function createSim(cfg, opts) {
    opts = opts || {};
    let rnd = opts.seed != null ? mulberry(opts.seed) : Math.random;
    const proj = Core.makeProjection(cfg.wind.lat, cfg.wind.lon);
    const paths = Core.preparePaths(cfg, proj);
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
      const brg = (INBOUND[iaf] + (rnd() - 0.5) * 30) * Math.PI / 180;
      const d = distFromIaf != null ? distFromIaf : 150 + rnd() * 30;
      const I = proj.xy(cfg.iafs[iaf].lat, cfg.iafs[iaf].lon);
      const ac = {
        cs: callsign(), type: t[0], wtc: t[1], iaf,
        x: I.x + Math.sin(brg) * d, y: I.y + Math.cos(brg) * d,
        alt: 0, gs: 0, phase: 'enroute', s: 0, d0: Math.max(d, 60)
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
          const rwy = (info && info.rwy) || cfg.runways[cfg.iafs[ac.iaf].side].ids[sim.dir];
          const path = paths[ac.iaf][rwy];
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
          if (info && info.delay > 15 && r > P.finalNm) {
            // Delay muss vor dem 15-NM-Final weg sein: nur die Zeit bis dorthin wird gestreckt
            const tBeforeFinal = Math.max(1, (r - P.finalNm) * path.k / gs * 3600);
            const f = tBeforeFinal / (tBeforeFinal + info.delay);
            // nahe am IAF darf der Flieger auch kreisen (Holding), auf dem Downwind nur strecken
            const floor = ac.s < 3 ? 0 : 0.25;
            const absorbable = tBeforeFinal * (1 / 0.25 - 1) * 0.8;
            if (ac.s < 3 && info.delay > absorbable) gs = 0; // im Holding am IAF
            else gs = gs * Math.max(floor, Math.min(1, f));
          }
          ac.gs = gsTrue;
          ac.s += gs * dt / 3600 / (r > P.finalNm ? path.k : 1);
          const q = Core.pointAt(path, ac.s);
          ac.x = q.x; ac.y = q.y; ac.hdg = q.trk; ac.alt = alt;
          if (ac.s >= path.length) ac.phase = 'landed';
        }
      }
      sim.aircraft = sim.aircraft.filter(a => a.phase !== 'landed');
    }

    /** Verkehrsbild im gleichen Format wie vom EuroScope-Plugin. */
    function traffic() {
      return {
        source: 'sim',
        activeDir: sim.dir,
        aircraft: sim.aircraft.map(a => {
          const p = proj.ll(a.x, a.y);
          return { cs: a.cs, type: a.type, wtc: a.wtc, lat: p.lat, lon: p.lon, alt: Math.round(a.alt), gs: Math.round(a.gs), hdg: a.hdg, iaf: a.iaf, passedIaf: a.phase === 'path' };
        })
      };
    }

    return { sim, step, traffic, prefill, spawn };
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
