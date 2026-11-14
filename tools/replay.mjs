// Sitzungs-Log des AMAN nachspielen (MENU -> DOWNLOAD SESSION LOG) und auswerten.
//
//   node tools/replay.mjs <aman-log-....jsonl.gz> --at 17:58            Sequenz beider Bahnen um 17:58 (UTC)
//   node tools/replay.mjs <log> --cs KLM350,DLH3JA [--from 17:40] [--to 18:05] [--every 30]
//                                                                       Verlauf einzelner Flieger (alle 30 s)
//   node tools/replay.mjs <log> --info                                  Ueberblick (Zeitraum, Login, Flieger)
//
// Gerechnet wird mit dem aktuellen Rechenkern (web/aman-core.js): so laesst sich auch pruefen, ob eine
// Korrektur einen aufgezeichneten Fall loest.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const Core = require(path.join(web, 'aman-core.js'));
const cfg = JSON.parse(fs.readFileSync(path.join(web, 'eddm.json'), 'utf8'));

const args = process.argv.slice(2);
const withValue = ['--at', '--cs', '--from', '--to', '--every'];
const file = args.find((a, i) => !a.startsWith('--') && !withValue.includes(args[i - 1]));
const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : null; };
if (!file || !fs.existsSync(file)) { console.error('Aufruf: node tools/replay.mjs <log.jsonl.gz> --at HH:MM | --cs CS1,CS2 | --info'); process.exit(1); }

let raw = fs.readFileSync(file);
if (raw[0] === 0x1f && raw[1] === 0x8b) raw = zlib.gunzipSync(raw);
const lines = raw.toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const entries = lines.filter(e => typeof e.t === 'number' && Array.isArray(e.aircraft));
if (!entries.length) { console.error('Keine Eintraege im Log.'); process.exit(1); }

const hhmm = t => new Date(t * 1000).toISOString().slice(11, 16);
const hhmmss = t => new Date(t * 1000).toISOString().slice(11, 19);
// HH:MM (UTC) auf den Tag des Logs beziehen
const day0 = Math.floor(entries[0].t / 86400) * 86400;
const toT = s => { const m = /^(\d\d):?(\d\d)$/.exec(s || ''); if (!m) return null; let t = day0 + +m[1] * 3600 + +m[2] * 60; if (t < entries[0].t - 43200) t += 86400; return t; };

if (opt('info')) {
  const cs = new Set(); entries.forEach(e => e.aircraft.forEach(a => cs.add(a.cs)));
  console.log('Log ' + hhmmss(entries[0].t) + ' bis ' + hhmmss(entries[entries.length - 1].t) + ' UTC, ' + entries.length + ' Datentakte');
  console.log('Login: ' + [...new Set(entries.map(e => e.me))].join(', ') + ', Plugin ' + [...new Set(entries.map(e => e.ver))].join(', '));
  console.log(cs.size + ' Flieger: ' + [...cs].sort().join(' '));
  process.exit(0);
}

const engine = Core.createEngine(cfg, entries.find(e => e.plan) ? entries.find(e => e.plan).plan : null);
const atT = toT(opt('at')), csList = typeof opt('cs') === 'string' ? opt('cs').toUpperCase().split(',') : null;
const from = toT(opt('from')) || entries[0].t, to = toT(opt('to')) || entries[entries.length - 1].t;
const every = +(opt('every') || 30);
let lastRow = {}, printed = false;

const fmtItem = (i, side, k) => {
  const fl = i.alt != null ? (i.alt >= 10000 ? 'FL' + String(Math.round(i.alt / 100)).padStart(3, '0') : Math.round(i.alt / 100) * 100 + 'ft') : '-';
  return (side + (k + 1)).padEnd(4) + i.cs.padEnd(9) + (i.wtc || '').padEnd(2) + (i.iaf || '').padEnd(6) + (i.passedIaf ? 'nach ' : 'vor  ') +
    String(Math.round(i.remainingNm)).padStart(4) + 'NM  ETA ' + hhmmss(i.eta) + '  STA ' + hhmmss(i.reqSta) +
    '  GS ' + String(Math.round(i.gs || 0)).padStart(3) + '  ' + fl.padEnd(7) + (i.src ? ' [' + i.src + ']' : '') +
    (i.locked ? ' manuell' : '') + (i.holding ? ' holding ' + i.holding : '') + (i.direct ? ' direct ' + i.direct : '');
};

for (const e of entries) {
  if (e.plan) engine.applyPlan(e.plan);
  const L = engine.update({ aircraft: e.aircraft, activeDir: e.activeDir }, e.t, e.winds || {});
  if (atT != null && !printed && e.t >= atT) {
    console.log('Sequenz um ' + hhmmss(e.t) + ' UTC, Richtung ' + L.dir + (L.dirChange ? ', Wechsel auf ' + L.dirChange.to + ' um ' + hhmm(L.dirChange.at) : '') + (engine.state.staticMode ? ', static' : ''));
    for (const side of ['N', 'S']) {
      console.log('--- ' + (side === 'N' ? 'Nord' : 'Sued'));
      L.bySide[side].forEach((i, k) => console.log(fmtItem(i, side, k)));
    }
    if (engine.state.hold.length) console.log('--- Hold-Feld: ' + engine.state.hold.join(' '));
    printed = true;
    if (!csList) break;
  }
  if (csList && e.t >= from && e.t <= to) {
    for (const cs of csList) {
      const i = L.byCs[cs];
      if (!i) continue;
      if (lastRow[cs] && e.t - lastRow[cs] < every) continue;
      lastRow[cs] = e.t;
      const k = L.bySide[i.side].findIndex(x => x.cs === cs);
      console.log(hhmmss(e.t) + '  ' + fmtItem(i, i.side, k));
    }
  }
}
if (atT != null && !printed) console.log('Zeit ' + opt('at') + ' liegt nicht im Log (' + hhmm(entries[0].t) + ' bis ' + hhmm(entries[entries.length - 1].t) + ').');
