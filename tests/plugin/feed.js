// Liefert dem Plugin-Testlauf Verkehr aus der AMAN-Simulation, wie EuroScope ihn liefern wuerde.
// Aufruf: node tests/plugin/feed.js <verkehrsdatei> [tempo]
// Steuerdatei <verkehrsdatei>.cmd: Zeilen "RWY <cs> <bahn>" (Lotse aendert Bahn), "ESRWY <bahnen...>" (aktive Bahnen in EuroScope)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..', 'web');
const Core = require(path.join(root, 'aman-core.js')), Sim = require(path.join(root, 'aman-sim.js'));
const cfg = require(path.join(root, 'eddm.json'));
const file = process.argv[2], speed = +(process.argv[3] || 1);
const eng = Core.createEngine(cfg), sim = Sim.createSim(cfg, { seed: 12, rate: 50, start: Math.floor(Date.now() / 1000) });
sim.prefill();
for (let i = 0; i < 300; i++) { eng.update(sim.traffic(), sim.sim.t, sim.sim.wind); sim.step(2, eng.last); }
let esRwys = ['26L', '26R'], me = 'EDDM_N_APP';
const track = {};   // IAF -> Callsign, das die Flieger vor dem IAF trackt
let ctrl = null;    // eingeloggte Lotsen (null = Standard im Test-Nachbau)
const star = { ROKIL: 'ROKIL1A', LANDU: 'LANDU1A', BETOS: 'BETOS1A', NAPSA: 'NAPSA1A' };
setInterval(() => {
  // Steuerbefehle wie von einem Lotsen in EuroScope
  try {
    const cmds = fs.readFileSync(file + '.cmd', 'utf8').split('\n'); fs.unlinkSync(file + '.cmd');
    for (const c of cmds) { const w = c.trim().split(/\s+/); if (w[0] === 'RWY') sim.setRunway(w[1], w[2]); if (w[0] === 'ESRWY') esRwys = w.slice(1); if (w[0] === 'ME') me = w[1]; if (w[0] === 'TRACK') track[w[1]] = w[2]; if (w[0] === 'CTRL') ctrl = w.slice(1); }
  } catch (e) { /* keine Befehle */ }
  for (let k = 0; k < speed; k++) { sim.step(1, eng.last); }
  eng.update(sim.traffic(), sim.sim.t, sim.sim.wind);
  const lines = ['#RWY ' + esRwys.join(' '), '#ME ' + me];
  if (ctrl) lines.push('#CTRL ' + ctrl.join(' '));
  // TopSky-Holding nachbilden: Flieger im Holding der Simulation und (fest) der erste hinter dem IAF nach Callsign
  // bekommen Strip-Annotation 6 "h/<IAF>/h"
  const tr = sim.traffic().aircraft;
  const fixed = tr.filter(a => a.passedIaf).map(a => a.cs).sort()[0];
  const fastCs = tr.filter(a => !a.passedIaf).map(a => a.cs).sort()[0];
  for (const a of tr) {
    const hold = a.inHold || a.cs === fixed ? 'h/' + a.iaf + '/h' : '';
    // zugewiesene Geschwindigkeit nachbilden: der erste noch vor dem IAF nach Callsign hat 280 kt "oder mehr"
    const spd = a.cs === fastCs ? ['280', '', '/s+/'] : ['', '', ''];
    lines.push([a.cs, a.type, a.wtc, a.lat.toFixed(5), a.lon.toFixed(5), a.alt, a.gs, Math.round(a.hdg || 0), a.route + ' ' + a.iaf, star[a.iaf], a.arrRwy || '', 'EDDM', (!a.passedIaf && track[a.iaf]) || '', '', hold].concat(spd).join('\t'));
  }
  fs.writeFileSync(file + '.tmp', lines.join('\n')); fs.renameSync(file + '.tmp', file);
}, 1000);
