// Rechenkern-Test mit der Simulation (ohne Browser). Aufruf: node tests/engine.js
const path = require('path');
const root = path.join(__dirname, '..', 'web');
const Core = require(path.join(root, 'aman-core.js'));
const Sim = require(path.join(root, 'aman-sim.js'));
const cfg = require(path.join(root, 'eddm.json'));
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const T0 = 1800000000;

function run(eng, sim, n, every, cb) {
  for (let i = 0; i < n; i++) {
    if (i % every === 0) eng.update(sim.traffic(), sim.sim.t, sim.sim.wind);
    sim.sim.dir = eng.state.dir;
    const before = {}; for (const a of sim.sim.aircraft) before[a.cs] = a;
    sim.step(2, eng.last);
    if (cb) cb(before);
  }
}

// 1) Normalbetrieb 26 und 08: Landeabstaende in der Simulation
for (const D of ['26', '08']) {
  const eng = Core.createEngine(cfg, { dir: D }), sim = Sim.createSim(cfg, { seed: 9, rate: 50, start: T0, dir: D });
  sim.prefill();
  const lands = [];
  run(eng, sim, 3000, 2, before => {
    const now = new Set(sim.sim.aircraft.map(a => a.cs));
    for (const cs of Object.keys(before)) if (!now.has(cs) && sim.sim.t > T0 + 1800) lands.push({ rwy: before[cs].rwy, t: sim.sim.t });
  });
  let mn = 1e9;
  for (const r of Object.values(cfg.runways).map(x => x.ids[D])) {
    const t = lands.filter(l => l.rwy === r).map(l => l.t).sort((a, b) => a - b);
    for (let k = 1; k < t.length; k++) mn = Math.min(mn, t[k] - t[k - 1]);
  }
  ok(lands.length > 50 && mn >= 80, 'Richtung ' + D + ': ' + lands.length + ' Landungen, kleinster Abstand ' + mn + ' s');
}

// 2) Runway Change 26 -> 08 in 25 min
{
  const eng = Core.createEngine(cfg), sim = Sim.createSim(cfg, { seed: 21, rate: 50, start: T0 });
  sim.prefill();
  run(eng, sim, 300, 1);
  const at = sim.sim.t + 25 * 60;
  eng.setDirChange('08', at);
  const L = eng.update(sim.traffic(), sim.sim.t, sim.sim.wind);
  ok(L.dirChange && L.dirChange.to === '08', 'geplanter Wechsel steht in last.dirChange (fuer die gruene Linie)');
  ok(L.list.filter(i => !i.passedIaf && i.sta > at + 120).every(i => i.dir === '08'), 'Anfluege nach dem Zeitpunkt sind auf 08 geplant');
  const P = Core.preparePaths(cfg, Core.makeProjection(cfg.wind.lat, cfg.wind.lon));
  const lands = [], at15 = {};
  let switched = null;
  run(eng, sim, 1800, 2, before => {
    if (!switched && eng.state.dir === '08') switched = sim.sim.t;
    for (const a of sim.sim.aircraft) if (a.phase === 'path' && a.rwy && !at15[a.cs]) { const p = (a.pathRef && a.pathRef.rwy === a.rwy) ? a.pathRef : P[a.iaf][a.rwy]; if (p.length - a.s <= 15) at15[a.cs] = { t: sim.sim.t, rwy: a.rwy }; }
    const now = new Set(sim.sim.aircraft.map(a => a.cs));
    for (const cs of Object.keys(before)) if (!now.has(cs)) lands.push({ rwy: before[cs].rwy, t: sim.sim.t });
  });
  ok(switched && Math.abs(switched - at) <= 10, 'Richtung wechselt automatisch zum Zeitpunkt');
  ok(!lands.some(l => /^08/.test(l.rwy) && l.t < at - 20), 'niemand landet vor dem Zeitpunkt auf 08');
  const lastOld = Math.max(...lands.filter(l => /^26/.test(l.rwy)).map(l => l.t));
  const firstNew15 = Math.min(...Object.values(at15).filter(x => /^08/.test(x.rwy)).map(x => x.t));
  ok(firstNew15 >= lastOld, 'letzte 26-Landung vor dem ersten 08-Flieger bei 15 NM (' + Math.round(firstNew15 - lastOld) + ' s Abstand)');
}

// 3) Lotse aendert in EuroScope 08R -> 08L: AMAN plant sofort auf 08L, Rechnung ueber den Nord-Downwind
{
  let checked = 0;
  for (const seed of [4, 23, 42]) {
    const eng = Core.createEngine(cfg, { dir: '08' }), sim = Sim.createSim(cfg, { seed, rate: 40, start: T0, dir: '08' });
    sim.prefill();
    run(eng, sim, 400, 1);
    const c = eng.last.list.find(i => i.side === 'S' && i.passedIaf && i.remainingNm > 40 && i.remainingNm < 60);
    if (!c) continue;
    sim.setRunway(c.cs, '08L');
    let first = null, onDw = null, landed = null, rwy = null;
    for (let i = 0; i < 1500 && !landed; i++) {
      if (i % 2 === 0) { const it = eng.update(sim.traffic(), sim.sim.t, sim.sim.wind).byCs[c.cs]; if (it) { if (!first) first = it; if (eng.state.ac[c.cs].xOn && !onDw) onDw = Object.assign({}, it); } }
      const a = sim.sim.aircraft.find(x => x.cs === c.cs); if (a) rwy = a.rwy;
      sim.step(2, eng.last);
      if (!sim.sim.aircraft.find(x => x.cs === c.cs)) landed = sim.sim.t;
    }
    checked++;
    ok(first && first.rwy === '08L' && first.side === 'N', c.cs + ': nach der Aenderung sofort auf 08L geplant');
    ok(rwy === '08L' && onDw && Math.abs(onDw.reqSta - landed) <= 60, c.cs + ': auf dem Nord-Downwind geplante Zeit auf ' + Math.round(Math.abs(onDw.reqSta - landed)) + ' s genau');
  }
  ok(checked >= 2, 'genug Faelle fuer den Bahnwechsel geprueft (' + checked + ')');
}

// 4) Erste Bahn aus EuroScope loest nichts aus, und die Standardplanung ist Sued/Sued, Nord/Nord
{
  const eng = Core.createEngine(cfg, { dir: '26' });
  const p = Core.makeProjection(cfg.wind.lat, cfg.wind.lon);
  const at = (iaf, d) => { const I = p.xy(cfg.iafs[iaf].lat, cfg.iafs[iaf].lon); return p.ll(I.x, I.y + d); };
  const L = eng.update({ aircraft: [
    Object.assign({ cs: 'T1', type: 'A320', wtc: 'M', alt: 20000, gs: 400, iaf: 'BETOS', arrRwy: '26R' }, at('BETOS', -60)),
    Object.assign({ cs: 'T2', type: 'A320', wtc: 'M', alt: 20000, gs: 400, iaf: 'ROKIL', arrRwy: '26R' }, at('ROKIL', 60))
  ] }, T0, {});
  ok(L.byCs.T1.side === 'S' && L.byCs.T2.side === 'N', 'Standard: BETOS auf Sued, ROKIL auf Nord, auch wenn EuroScope anfangs 26R eintraegt');
}

// 5) Final erst ab 7000 ft: hoch ueber der Anfluglinie zaehlt nicht als Final
{
  const eng = Core.createEngine(cfg, { dir: '26' });
  const P = eng.paths.ROKIL['26R'];
  const q = Core.pointAt(P, P.length - 8), ll = eng.proj.ll(q.x, q.y);
  const mk = alt => ({ cs: 'H' + alt, type: 'A320', wtc: 'M', alt, gs: 250, hdg: 0, iaf: 'ROKIL', passedIaf: true, lat: ll.lat, lon: ll.lon });
  const L = eng.update({ aircraft: [mk(9000), mk(4000)] }, T0, {});
  ok(L.byCs.H4000.remainingNm < 10 && L.byCs.H9000.remainingNm > 14, 'auf 8 NM Final: 4000 ft = ' + L.byCs.H4000.remainingNm.toFixed(0) + ' NM, 9000 ft nicht auf dem Final = ' + L.byCs.H9000.remainingNm.toFixed(0) + ' NM');
}

// 6) Per Heading Richtung Final gefuehrt, ohne den IAF zu ueberfliegen (Fall DLH1745, RWY 08):
//    frueh erkennen und direkt rechnen; ein Flieger, der normal auf BETOS zufliegt, bleibt unveraendert
{
  const run = (x0, y0, trk) => {
    const e = Core.createEngine(cfg, { dir: '08' }), P = e.proj;
    const mk = (cs, x, y, t, alt, gs, star) => Object.assign({ cs, type: 'A320', wtc: 'M', alt, gs, trk: t, hdg: t, star, route: star.slice(0, 5), arrRwy: '08R' }, P.ll(x, y));
    const etas = []; let L;
    for (let k = 0; k <= 24; k++) {
      const r = trk * Math.PI / 180, d = 250 * 5 * k / 3600;
      L = e.update({ aircraft: [mk('TEST', x0 + Math.sin(r) * d, y0 + Math.cos(r) * d, trk, 9000, 250, 'SOTOV1A'), mk('OCN5ZP', 12, -5.2, 265, 14500, 270, 'NAPSA1A')] }, T0 + 5 * k, {});
      etas.push(L.byCs.TEST.eta);
    }
    return { it: L.byCs.TEST, o: L.byCs.OCN5ZP, spread: Math.max(...etas) - Math.min(...etas) };
  };
  const v = run(-12, -24, 352), n = run(-16, -32, 356);
  ok(v.it.passedIaf && v.it.sta < v.o.sta, 'Heading direkt Final 9 NM vor BETOS: erkannt und vor OCN5ZP geplant (' + v.it.remainingNm.toFixed(0) + ' NM)');
  ok(v.spread < 30, 'Landezeit dabei stabil (Schwankung ' + Math.round(v.spread) + ' s ueber 2 min)');
  // nach 2 min Flug noch rund 7 NM bis BETOS plus Transition (AIP-skaliert gut 50 NM)
  ok(!n.it.passedIaf && n.it.remainingNm > 55, 'normal Richtung BETOS: weiter ueber die Transition (' + n.it.remainingNm.toFixed(0) + ' NM)');
}

// 7) Heading auf die verlaengerte Anfluglinie (vor FAP15), Fall EZY42SB, RWY 08: Lotse hat 08L im Tag,
//    andere Flieger haben 08R (gemischt) -> 08L schon beim ersten Sehen, Restweg direkt statt ueber BETOS
{
  const e = Core.createEngine(cfg, { dir: '08' }), P = e.proj;
  const mk = (cs, x, y, trk, alt, gs, star, rwy) => Object.assign({ cs, type: 'A320', wtc: 'M', alt, gs, trk, hdg: trk, star, route: star.slice(0, 5), arrRwy: rwy }, P.ll(x, y));
  let L;
  for (let k = 0; k <= 6; k++) {
    const r = 20 * Math.PI / 180, d = 220 * 5 * k / 3600;
    L = e.update({ aircraft: [mk('EZY42SB', -22.6 + Math.sin(r) * d, -11.7 + Math.cos(r) * d, 20, 7000, 220, 'BETOS1A', '08L'), mk('AFR5068', 2, -20, 340, 15000, 280, 'NAPSA1A', '08R')] }, T0 + 5 * k, {});
  }
  const it = L.byCs.EZY42SB;
  ok(it.rwy === '08L' && it.remainingNm < 32, 'Heading auf verlaengerte Anfluglinie 08L: ' + it.rwy + ', ' + it.remainingNm.toFixed(0) + ' NM (vorher 61 ueber BETOS)');
}

// 8) CTR-Anweisung: zuerst Speed (oben Mach, unten IAS), Rest als Umweg, ab 8 min Holding
{
  const now = 1e9, adv = (d, T, gs, alt) => Core.delayAdvice({ delayIaf: d, etaIaf: now + T, gs, alt }, now);
  ok(adv(20, 1200, 470, 35000) === '', 'unter 30 s Delay: keine Anweisung');
  ok(/^M\.7\d$/.test(adv(60, 1200, 470, 35000)), '1 min auf 20 min in FL350: nur Mach (' + adv(60, 1200, 470, 35000) + ')');
  ok(/^250kt \+\dmin$/.test(adv(120, 720, 380, 20000)), '2 min auf 12 min in FL200: 250 kt und Umweg (' + adv(120, 720, 380, 20000) + ')');
  ok(adv(600, 1500, 470, 35000) === 'HOLD', '10 min Delay: Holding');
}

// 9) Holding am Flugweg erkannt (EuroScope bietet keine Holding-Liste): Flieger bleibt in der Sequenz,
//    EAT = Zeit, zu der er den Fix verlassen muss, um seine geplante Zeit zu treffen
{
  const e = Core.createEngine(cfg, { dir: '26' }), P = e.proj, F = P.xy(cfg.iafs.ROKIL.lat, cfg.iafs.ROKIL.lon);
  const other = t => Object.assign({ cs: 'LEAD1', type: 'A320', wtc: 'M', alt: 8000, gs: 220, trk: 126, hdg: 126, iaf: 'ROKIL', passedIaf: true }, P.ll(F.x + 3, F.y - 2));
  let L, first = null;
  // Racetrack: 1-min-Schenkel, Kurven mit 3 Grad/s, 220 kt
  let x = F.x - 4, y = F.y + 1, trk = 126, t = 0;
  for (let k = 0; k < 120; k++) {
    const seg = Math.floor(t / 60) % 4, turning = seg === 1 || seg === 3;
    if (turning) trk = (trk + 15) % 360;
    x += Math.sin(trk * Math.PI / 180) * 220 * 5 / 3600; y += Math.cos(trk * Math.PI / 180) * 220 * 5 / 3600;
    L = e.update({ aircraft: [Object.assign({ cs: 'HLD1', type: 'A320', wtc: 'M', alt: 9000, gs: 220, trk, hdg: trk, iaf: 'ROKIL' }, P.ll(x, y)), other(t)] }, T0 + t, {});
    if (!first && L.byCs.HLD1.holding) first = t;
    t += 5;
  }
  const h = L.byCs.HLD1;
  ok(first != null && first <= 300 && h.holding === 'ROKIL', 'Kreisen bei ROKIL als Holding erkannt nach ' + first + ' s');
  ok(L.bySide.N.some(i => i.cs === 'HLD1') && h.eat && Math.abs(h.eat - (T0 + t - 5 + Math.max(0, h.delay))) < 1, 'im Holding weiter in der Sequenz, EAT = jetzt + Delay');
  ok(!L.byCs.LEAD1.holding, 'geradeaus fliegender Flieger nicht als Holding erkannt');
}

// 10) Direct aus EuroScope: Lotse gibt "direct DM425" auf dem Downwind -> Rechnung direkt dorthin, dann Standardprofil
{
  const e = Core.createEngine(cfg, { dir: '26' });
  const P = e.paths.ROKIL['26R'], i0 = P.pts.findIndex(q => q.name === 'DM422'), iD = P.pts.findIndex(q => q.name === 'DM425');
  const q = Core.pointAt(P, P.cum[i0] + 0.5), ll = e.proj.ll(q.x, q.y);
  const trkTo = (Math.atan2(P.pts[iD].x - q.x, P.pts[iD].y - q.y) * 180 / Math.PI + 360) % 360;
  const mk = (cs, direct, trk) => Object.assign({ cs, type: 'A320', wtc: 'M', alt: 9000, gs: 250, trk, hdg: trk, iaf: 'ROKIL', passedIaf: true, direct }, ll);
  const L = e.update({ aircraft: [mk('NODCT', '', q.trk), mk('DCT1', 'DM425', trkTo), mk('DCTOLD', 'DM421', q.trk)] }, T0, {});
  const d = Math.hypot(P.pts[iD].x - q.x, P.pts[iD].y - q.y);
  ok(L.byCs.DCT1.eta < L.byCs.NODCT.eta - 20 && L.byCs.DCT1.direct === 'DM425', 'direct DM425: frueher geplant (' + Math.round(L.byCs.NODCT.eta - L.byCs.DCT1.eta) + ' s)');
  ok(L.byCs.DCT1.remainingNm < L.byCs.NODCT.remainingNm && L.byCs.DCT1.remainingNm > d, 'Restweg direkt bis DM425 plus Standardpfad (' + L.byCs.DCT1.remainingNm.toFixed(0) + ' statt ' + L.byCs.NODCT.remainingNm.toFixed(0) + ' NM)');
  ok(!L.byCs.DCTOLD.direct, 'Direct auf einen schon ueberflogenen Punkt wird ignoriert');
}

// 11) Downwind leicht ueberschossen und zurueckgedreht: schraeger Kurs zeigt kurz aufs Final (gegen die Landerichtung)
//     -> die Meilen duerfen nicht springen; ein echter frueher Base-Turn (90 Grad, anhaltend) zaehlt weiter als Abkuerzung
{
  const e = Core.createEngine(cfg, { dir: '26' }), P = e.paths.ROKIL['26R'], iA = P.pts.findIndex(q => q.name === 'ABEAM');
  const q = Core.pointAt(P, P.cum[1] + (P.cum[iA] - P.cum[1]) * 0.6), ll = e.proj.ll(q.x, q.y);
  const step = (k, dt) => e.update({ aircraft: [Object.assign({ cs: 'OVS', type: 'A320', wtc: 'M', alt: 6000, gs: 220, trk: (q.trk + dt + 360) % 360, hdg: (q.trk + dt + 360) % 360, iaf: 'ROKIL', passedIaf: true }, ll)] }, T0 + 5 * k, {}).byCs.OVS.remainingNm;
  const m = [step(0, 0), step(1, 40), step(2, 60), step(3, 0)].map(Math.round);
  ok(Math.max(...m) - Math.min(...m) <= 1, 'Ueberschiessen mit 40/60 Grad Korrektur: Meilen bleiben (' + m.join(' ') + ')');
  const b1 = step(4, 90), b2 = step(5, 90);
  ok(b2 < m[0] - 10 && Math.round(b1) === m[0], 'frueher Base-Turn: erst nach dem zweiten Update als Abkuerzung (' + Math.round(b1) + ' -> ' + Math.round(b2) + ' NM)');
}

console.log(fails ? fails + ' Fehler' : 'alles gruen');
process.exit(fails ? 1 : 0);
