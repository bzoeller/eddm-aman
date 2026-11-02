/* EDDM AMAN Anzeige. Holt Daten vom EuroScope-Plugin (oder aus der Simulation), rechnet mit AmanCore und zeichnet den Schirm. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  // Fremddaten (Callsigns, Routen) nie roh als HTML einsetzen
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const sel = v => (window.CSS && CSS.escape ? CSS.escape(String(v)) : String(v).replace(/["\\]/g, '\\$&'));
  const flash = {};          // Callsign -> bis wann hervorheben (nach einem Eingriff)
  const undoStack = [];      // letzte Eingriffe zum Zuruecknehmen
  const STORE_KEY = 'eddm-aman-v1';
  const SVGNS = 'http://www.w3.org/2000/svg';
  const isPluginHost = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && location.port === '8471';

  let cfg, engine, simApi = null;
  let settings = {
    source: isPluginHost ? 'plugin' : 'sim', view: 'auto', theme: 'dark',
    simRate: 40, simSpeed: 5, simWind: '250/10'
  };
  let traffic = { aircraft: [] }, me = null, metar = null, aloft = null, lastData = 0, connErr = null, dataTime = null;
  let pollSeq = 0, pollTimer = null, aloftTimer = null;
  let curView = null, colEls = {}, drag = null, timer = null, lastTick = 0, online = null;
  const refreshMs = () => 1000 * cfg.defaults.refreshSec;

  // ---------- Speicher ----------
  function load() {
    try { const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); return s || null; } catch (e) { return null; }
  }
  function save() {
    try {
      const st = engine.state;
      localStorage.setItem(STORE_KEY, JSON.stringify({
        settings, engine: { dir: st.dir, staticMode: st.staticMode, spacing: st.spacing, rate: st.rate, finalGsMode: st.finalGsMode, timelineMin: st.timelineMin, closures: st.closures, dirChange: st.dirChange }
      }));
    } catch (e) { /* ohne Speicher geht es auch */ }
  }

  // ---------- Start ----------
  fetch('eddm.json').then(r => r.json()).then(c => {
    cfg = c;
    const saved = load();
    if (saved && saved.settings) Object.assign(settings, saved.settings);
    // Ansicht beim Oeffnen immer automatisch nach Login; eine Hand-Auswahl gilt nur bis zum Neuladen
    settings.view = 'auto';
    if (!isPluginHost && settings.source === 'plugin') settings.source = 'sim';
    engine = AmanCore.createEngine(cfg, saved && saved.engine ? Object.assign({}, saved.engine, { closures: (saved.engine.closures || []).filter(c => c.to > Date.now() / 1000), dirChange: saved.engine.dirChange && saved.engine.dirChange.at > Date.now() / 1000 ? saved.engine.dirChange : null }) : null);
    applyTheme();
    const sel = $('selView');
    for (const v of cfg.ctrViews || []) {
      const o = document.createElement('option'); o.value = v.id; o.textContent = v.label; sel.appendChild(o);
      // Schnellauswahl unten rechts: nur die Sektorbezeichnung
      const q = document.createElement('option'); q.value = v.id; q.textContent = v.sector; $('qView').appendChild(q);
    }
    if (settings.view !== 'auto' && !['APP', 'TWR'].includes(settings.view) && !ctrView(settings.view)) settings.view = 'auto';
    bindUi();
    syncQuick();
    startSource();
  }).catch(err => {
    $('status').textContent = 'Configuration error: ' + err.message;
  });

  /** Schnellauswahl unten rechts mit den Einstellungen abgleichen. */
  function syncQuick() {
    $('qView').value = settings.view;
    const dark = settings.theme === 'dark' || (settings.theme === 'system' && !(window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches));
    $('qTheme').value = dark ? 'dark' : 'light';
  }
  function applyTheme() {
    const r = document.documentElement;
    if (settings.theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', settings.theme || 'dark');
  }

  // ---------- Datenquellen ----------
  function startSource() {
    clearInterval(timer); clearTimeout(pollTimer); pollTimer = null;
    if (settings.source === 'sim') {
      const [d, s] = settings.simWind.split('/').map(Number);
      simApi = AmanSim.createSim(cfg, {
        rate: +settings.simRate, dir: engine.state.dir === '08' ? '08' : '26',
        wind: { surface: { dir: d, spd: s }, aloft: { dir: (d + 20) % 360, spd: Math.max(15, s * 2.5) } }
      });
      simApi.prefill();
      // kurz vorlaufen lassen, damit die Sequenz eingeschwungen ist
      for (let i = 0; i < 300; i++) { engine.update(simApi.traffic(), simApi.sim.t, simApi.sim.wind); simApi.step(2, engine.last); }
      me = { callsign: 'SIMULATION' };
      timer = setInterval(tickSim, 250);
    } else {
      simApi = null;
      clearTimeout(pollTimer); clearInterval(aloftTimer);
      pollPlugin();
      timer = setInterval(() => tick(true), 1000); // Uhr und Hinweis auf veraltete Daten laufen weiter
      fetchAloft();
      aloftTimer = setInterval(fetchAloft, 30 * 60 * 1000);
    }
    tick();
  }

  function tickSim() {
    const dt = 0.25 * (+settings.simSpeed);
    simApi.sim.dir = engine.state.dir;
    simApi.step(dt, engine.last);
    // Die Simulation laeuft fluessig weiter, das AMAN rechnet und zeichnet nur alle 5 Sekunden
    if (Date.now() - lastTick >= refreshMs()) tick();
  }

  /** Abfrage beim Plugin: alle 5 s, mit Timeout; eine aeltere Antwort ueberschreibt nie eine neuere. */
  function pollPlugin() {
    if (simApi || settings.source !== 'plugin') return;
    const my = ++pollSeq;
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 4000);
    fetch('/api/traffic', { cache: 'no-store', signal: ctl.signal }).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(d => {
      if (my !== pollSeq) return;
      if (!d || typeof d !== 'object') throw new Error('empty response');
      me = d.me && typeof d.me === 'object' ? d.me : null;
      metar = typeof d.metar === 'string' ? d.metar : null;
      online = Array.isArray(d.controllers) ? d.controllers.map(c => (c && c.callsign) || c).filter(c => typeof c === 'string') : null;
      const rw = Array.isArray(d.arrRwys) ? d.arrRwys.map(String) : [];
      traffic = { aircraft: Array.isArray(d.aircraft) ? d.aircraft : [], activeDir: rw.some(r => /^08/.test(r)) ? '08' : (rw.some(r => /^26/.test(r)) ? '26' : null) };
      const tOk = typeof d.time === 'number' && isFinite(d.time);
      dataTime = tOk ? d.time : Date.now() / 1000;
      // Beim ersten Laden einmalig die Betriebsrichtung aus EuroScope uebernehmen, danach nie wieder
      if (!pollPlugin.dirSynced && traffic.activeDir) {
        pollPlugin.dirSynced = true;
        if (engine.state.dir !== traffic.activeDir || engine.state.dirChange) {
          engine.state.dirChange = null;
          engine.setDirChange(traffic.activeDir, null);
          render.dir = null; // kein Blinken fuer diese Startuebernahme
          save();
        }
      }
      // veraltet zaehlt ab dem Zeitstempel der Daten: so faellt auch ein haengendes EuroScope auf
      lastData = tOk ? Math.min(Date.now(), d.time * 1000) : Date.now(); connErr = null;
      tick();
    }).catch(e => {
      if (my !== pollSeq) return;
      connErr = e && e.name === 'AbortError' ? 'Plugin not responding' : 'No connection to plugin (' + ((e && e.message) || 'error') + ')';
      tick();
    }).finally(() => {
      clearTimeout(to);
      if (my === pollSeq && !simApi) pollTimer = setTimeout(pollPlugin, refreshMs());
    });
  }
  const staleSec = () => (simApi ? 0 : lastData ? (Date.now() - lastData) / 1000 : Infinity);

  function fetchAloft() {
    const u = 'https://api.open-meteo.com/v1/dwd-icon?latitude=' + cfg.wind.lat + '&longitude=' + cfg.wind.lon +
      '&hourly=wind_speed_700hPa,wind_direction_700hPa&wind_speed_unit=kn&forecast_days=1&timezone=UTC';
    fetch(u).then(r => r.json()).then(d => {
      const h = new Date().toISOString().slice(0, 13) + ':00';
      const i = Math.max(0, d.hourly.time.indexOf(h));
      aloft = { dir: Math.round(d.hourly.wind_direction_700hPa[i]), spd: Math.round(d.hourly.wind_speed_700hPa[i]), src: 'DWD ICON' };
    }).catch(() => { aloft = null; });
  }

  function currentWinds() {
    if (simApi) return simApi.sim.wind;
    const sfc = AmanCore.parseMetarWind(metar);
    return { surface: sfc || aloft || { dir: 0, spd: 0 }, aloft: aloft || sfc || { dir: 0, spd: 0 } };
  }
  // Rechenzeit = Zeitpunkt der Daten (nicht die Uhr beim Klick), sonst springen ETAs bei jedem Eingriff
  function nowSec() { return simApi ? simApi.sim.t : (dataTime || Date.now() / 1000); }

  function tick(fromTimer) {
    if (drag) return; // waehrend Drag & Drop nicht neu zeichnen
    // Plugin-Modus: neu rechnen nur mit neuen Daten oder nach einem Eingriff, sonst nur Uhr und Hinweise
    if (fromTimer && !simApi && engine.last.now && dataTime === engine.last.dataTime) { renderLive(); return; }
    lastTick = Date.now();
    const tr = simApi ? simApi.traffic() : traffic;
    engine.update(tr, nowSec(), currentWinds());
    engine.last.dataTime = dataTime;
    render();
  }

  // ---------- Ansicht und Rolle ----------
  function role() {
    if (settings.view !== 'auto') return ['APP', 'TWR'].includes(settings.view) ? settings.view : 'CTR';
    if (simApi) return 'APP';
    return AmanCore.roleFor(cfg, me && me.callsign);
  }
  function viewKey() {
    if (settings.view !== 'auto') return settings.view;
    if (simApi) return 'APP';
    const r = role();
    if (r === 'CTR') {
      const d = dynView();
      if (d && d.parts.length) return 'DYN';
      return AmanCore.ctrSector(cfg, me && me.callsign, online) || (d ? 'DYN' : 'APP');
    }
    return r === 'OBS' ? 'TWR' : r;
  }
  /**
   * CTR-Ansicht nach Sektorvergabe: ein CTR-Lotse sieht jeden Strom, in dem er mindestens einen Flieger vor dem
   * IAF trackt (Daten aus EuroScope). So folgt die Ansicht automatisch jeder Sektorkombination (z. B. ALB arbeitet
   * RDG). Ein Strom bleibt nach dem letzten getrackten Flieger noch 10 min in der Ansicht.
   */
  const myStreams = {};    // Schluessel "IAF:Strom" -> zuletzt von mir getrackt (Datenzeit)
  const lastTracker = {};  // Schluessel -> { cs, t }: CTR-Lotse, der zuletzt den naechsten Flieger vor dem IAF trackte
  const isCtrCs = c => /^(EDMM|LOVV)_[A-Z0-9_]*CTR$/.test(c || '');
  /** Sektor -> Callsign des Lotsen, der ihn laut OWNER-Liste gerade hat (erster online in der Liste). */
  function sectorOwners() {
    if (!Array.isArray(online)) return {};
    const on = online.map(c => String(c).toUpperCase());
    const has = s => on.find(c => new RegExp('^(EDMM_' + s + '|' + s + ')\\d?_CTR$').test(c)) || null;
    const out = {};
    for (const [sec, list] of Object.entries(cfg.ctrOwners || {})) {
      if (sec.startsWith('_')) continue;
      for (const s of list) { const c = has(s); if (c) { out[sec] = c; break; } }
    }
    return out;
  }
  function dynView() {
    const cs = me && me.callsign ? String(me.callsign).toUpperCase() : null;
    if (!cs || simApi || !engine.last.list || !isCtrCs(cs)) return null;
    const now = engine.last.now;
    // 1) Tracking: wer den naechsten Flieger eines Stroms vor dem IAF trackt, arbeitet den Strom
    const nearest = {};
    for (const i of engine.last.list) {
      if (i.passedIaf) continue;
      const k = i.iaf + ':' + (i.stream || '');
      if (i.trackedBy === cs) myStreams[k] = now;
      if (isCtrCs(i.trackedBy) && i.etaIaf && (!nearest[k] || i.etaIaf < nearest[k].etaIaf)) nearest[k] = i;
    }
    for (const k of Object.keys(nearest)) lastTracker[k] = { cs: nearest[k].trackedBy, t: now };
    // 2) sonst die OWNER-Liste der Sektordatei fuer den Zubringer-Sektor
    const owners = sectorOwners(), mine = {};
    for (const iaf of Object.keys(cfg.iafs)) {
      const streams = cfg.iafs[iaf].streams ? Object.keys(cfg.iafs[iaf].streams) : [''];
      for (const st of streams) {
        const k = iaf + ':' + st, tr = lastTracker[k];
        const owner = tr && now - tr.t < 600 ? tr.cs : owners[(cfg.ctrFeeders || {})[st || iaf]];
        if (owner === cs || (myStreams[k] && now - myStreams[k] < 600)) mine[k] = true;
      }
    }
    const keys = Object.keys(mine);
    const m = /^(?:EDMM_|LOVV_)([A-Z0-9]+)_CTR$/.exec(cs), name = 'CTR ' + (m ? m[1] : cs);
    if (!keys.length) return { id: 'DYN', label: name + ' (no AMAN stream)', parts: [] };
    const parts = keys.sort().map(k => { const [iaf, stream] = k.split(':'); return { iaf, stream: stream || null }; });
    return { id: 'DYN', label: name + ' (' + parts.map(p => p.stream || p.iaf).join(' ') + ')', parts };
  }
  const ctrView = v => v === 'DYN' ? dynView() : ((cfg.ctrViews || []).find(x => x.id === v) || null);
  const isCtrView = v => !!ctrView(v);
  const showsItem = (view, i) => view.parts
    ? view.parts.some(pt => i.iaf === pt.iaf && (!pt.stream || i.stream === pt.stream))
    : i.iaf === view.iaf && (!view.streams || view.streams.indexOf(i.stream) >= 0);
  const canEdit = () => viewKey() === 'APP' && (simApi || role() === 'APP');

  // ---------- Zeichnen ----------
  function buildColumns(v) {
    const cols = $('cols');
    cols.innerHTML = '';
    colEls = {};
    if (isCtrView(v)) {
      cols.className = 'cols ctr-view';
      colEls.C = makeCol('C', ctrView(v).label);
      cols.appendChild(colEls.C.el);
      colEls.scale = makeScale(); cols.appendChild(colEls.scale.el);
    } else {
      cols.className = 'cols app-view';
      colEls.N = makeCol('N', ''); cols.appendChild(colEls.N.el);
      colEls.scale = makeScale(); cols.appendChild(colEls.scale.el);
      colEls.S = makeCol('S', ''); cols.appendChild(colEls.S.el);
    }
    curView = v;
  }

  function makeCol(side, name) {
    const el = document.createElement('div');
    el.className = 'col ' + side;
    el.dataset.side = side;
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'layer');
    svg.innerHTML = '<defs><pattern id="hatch' + side + '" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="24" stroke="var(--hatch)" stroke-width="1.4"/></pattern></defs><g class="cl"></g><g class="ln"></g>';
    el.appendChild(svg);
    const head = document.createElement('div');
    head.className = 'col-head';
    const nm = document.createElement('span'); nm.className = 'col-name'; nm.textContent = name;
    const tag = document.createElement('button'); tag.type = 'button'; tag.className = 'tag'; tag.textContent = 'static';
    tag.id = 'static' + side;
    tag.addEventListener('click', () => { if (canEdit()) { snapshot(engine.state.staticMode ? 'dynamic' : 'static'); engine.setStatic(!engine.state.staticMode); save(); tick(); } });
    if (side === 'N') { head.appendChild(nm); head.appendChild(tag); } else { head.appendChild(tag); head.appendChild(nm); }
    el.appendChild(head);
    let flowInput = null, flowEl = null;
    if (side !== 'C') {
      const flow = document.createElement('label');
      flow.className = 'flow';
      flow.setAttribute('for', 'flow' + side);
      flow.innerHTML = '<span>FLOW</span>';
      flowEl = flow;
      flowInput = document.createElement('input');
      flowInput.type = 'number'; flowInput.step = '0.5'; flowInput.min = '2.5'; flowInput.max = '20'; flowInput.id = 'flow' + side;
      flowInput.setAttribute('aria-label', 'Spacing ' + name + ' in NM');
      flowInput.addEventListener('change', () => {
        const v = Math.max(2.5, Math.min(20, parseFloat(flowInput.value) || cfg.defaults.spacingNm));
        engine.state.spacing[side] = v; save(); tick();
      });
      flow.appendChild(flowInput);
      el.appendChild(flow);
    }
    return { el, svg, tag, flowInput, flowEl, side, labels: {}, closeBtns: [] };
  }

  function makeScale() {
    const el = document.createElement('div');
    el.className = 'scale';
    const svg = document.createElementNS(SVGNS, 'svg');
    el.appendChild(svg);
    const clock = document.createElement('div'); clock.className = 'clock';
    el.appendChild(clock);
    return { el, svg, clock };
  }

  function geom(colEl) {
    const H = colEl.clientHeight, W = colEl.clientWidth;
    const mobile = window.matchMedia('(max-width: 760px)').matches;
    const clockH = mobile ? 34 : 46;
    // Jetzt-Linie (Landung) so hoch, dass ein Label auf Hoehe der Landung noch ueber die FLOW-Kaesten passt
    // und der Streifen bis zur Landung gerade bleibt
    const f = colEls.N && colEls.N.flowEl;
    const LH = mobile ? 22 : window.matchMedia('(max-width: 1200px)').matches ? 27 : 30;
    const reserve = f ? Math.max(clockH, f.offsetHeight + 6 + LH / 2 + 6) : clockH;
    const y0 = H - reserve, top = 40;
    const span = engine.state.timelineMin * 60;
    return { H, W, y0, top, span, y: t => y0 - (t - engine.last.now) / span * (y0 - top) };
  }

  const pad = n => String(n).padStart(2, '0');
  function hhmm(t, sep) { const d = new Date(t * 1000); return pad(d.getUTCHours()) + (sep == null ? ':' : sep) + pad(d.getUTCMinutes()); }

  function drawScale() {
    const sc = colEls.scale, g = geom(sc.el), now = engine.last.now;
    const W = g.W;
    let s = '';
    const firstMin = Math.ceil(now / 60) * 60;
    for (let t = firstMin; t <= now + g.span; t += 60) {
      const y = g.y(t); if (y < g.top - 2) break;
      const m = new Date(t * 1000).getUTCMinutes();
      const long = m % 5 === 0;
      const len = long ? 16 : 9;
      s += '<line x1="0" x2="' + len + '" y1="' + y + '" y2="' + y + '" stroke="var(--tick)" stroke-width="1.5"/>';
      s += '<line x1="' + (W - len) + '" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="var(--tick)" stroke-width="1.5"/>';
      if (long && y < g.y0 - 10) {
        const txt = m === 0 ? hhmm(t) : pad(m);
        s += '<text x="' + W / 2 + '" y="' + (y + (W < 60 ? 4 : 8)) + '" text-anchor="middle" fill="var(--tick)" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="' + (m === 0 ? (W < 60 ? 10 : 19) : (W < 60 ? 12 : 23)) + '">' + txt + '</text>';
      }
    }
    // geplanter Runway Change: gruen gestrichelte Linie, darueber klein die neue Richtung
    const chg = engine.last.dirChange;
    if (chg) {
      const y = g.y(chg.at);
      if (y >= g.top - 2 && y <= g.y0) {
        s += '<line class="rwyc" x1="0" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="var(--rwyc)" stroke-width="2.5" stroke-dasharray="7 5"/>';
        const fs = W < 60 ? 11 : 15, bw = W < 60 ? W - 4 : 70, by = y - fs - 8;
        s += '<rect x="' + (W - bw) / 2 + '" y="' + by + '" width="' + bw + '" height="' + (fs + 6) + '" fill="var(--bg)" stroke="var(--rwyc)" stroke-width="1.5"/>';
        s += '<text x="' + W / 2 + '" y="' + (by + fs + 1) + '" text-anchor="middle" fill="var(--rwyc)" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="' + fs + '">RWY ' + chg.to + '</text>';
      }
    }
    sc.svg.innerHTML = s;
    sc.clock.textContent = hhmm(now);
    sc.clock.style.top = g.y0 + 'px'; sc.clock.style.bottom = 'auto';
    sc.clock.classList.toggle('sim', !!simApi);
  }

  function drawClosures(c) {
    const g = geom(c.el), now = engine.last.now;
    const grp = c.svg.querySelector('.cl');
    let s = '';
    c.closeBtns.forEach(b => b.remove()); c.closeBtns = [];
    for (const cl of engine.state.closures) {
      if (cl.side !== c.side) continue;
      if (cl.to < now) continue;
      const yTop = Math.max(g.top, g.y(cl.to)), yBot = Math.min(g.y0, g.y(Math.max(cl.from, now)));
      if (yBot <= yTop) continue;
      s += '<rect x="0" y="' + yTop + '" width="' + g.W + '" height="' + (yBot - yTop) + '" fill="url(#hatch' + c.side + ')"/>';
      if (canEdit()) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'closure-x'; b.textContent = 'LIFT CLOSURE';
        b.title = (c.side === 'N' ? 'North ' : 'South ') + hhmm(cl.from) + '-' + hhmm(cl.to);
        b.style.top = (yTop + 34) + 'px';
        b.style[c.side === 'N' ? 'left' : 'right'] = '8px';
        b.addEventListener('click', () => {
          if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'CONFIRM LIFT?'; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ''; b.textContent = 'LIFT CLOSURE'; } }, 4000); return; }
          snapshot('lift closure'); engine.removeClosure(cl.id); save(); tick();
        });
        c.el.appendChild(b); c.closeBtns.push(b);
      }
    }
    const chg = engine.last.dirChange;
    if (chg) {
      const y = g.y(chg.at);
      if (y >= g.top - 2 && y <= g.y0) s += '<line class="rwyc" x1="0" x2="' + g.W + '" y1="' + y + '" y2="' + y + '" stroke="var(--rwyc)" stroke-width="2" stroke-dasharray="7 5"/>';
    }
    grp.innerHTML = s;
  }

  function labelSvg(w, h, pointsRight, color, manual) {
    const tip = h * 0.55;
    const pts = pointsRight
      ? [[1, 1], [w - tip, 1], [w - 1, h / 2], [w - tip, h - 1], [1, h - 1]]
      : [[tip, 1], [w - 1, 1], [w - 1, h - 1], [tip, h - 1], [1, h / 2]];
    // von Hand in der Sequenz platziert: Pfeilspitze gruen ausgefuellt
    const tri = pointsRight ? [[w - tip, 1], [w - 1, h / 2], [w - tip, h - 1]] : [[tip, 1], [1, h / 2], [tip, h - 1]];
    const fill = manual ? '<polygon class="mantip" points="' + tri.map(p => p.join(',')).join(' ') + '" fill="var(--miles)"/>' : '';
    return '<svg class="shape" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"><polygon points="' + pts.map(p => p.join(',')).join(' ') + '" fill="var(--label-bg)" stroke="' + color + '" stroke-width="3"/>' + fill + '</svg>';
  }

  function drawColumn(c, items, mode, view) {
    const g = geom(c.el);
    const mobile = window.matchMedia('(max-width: 760px)').matches;
    const mid = window.matchMedia('(max-width: 1200px)').matches;
    const LH = mobile ? 22 : mid ? 27 : 30, GAP = 3, LEAD = mobile ? 14 : 34;
    const labelW = Math.max(90, Math.min(mobile ? 170 : mid ? 280 : 340, g.W - LEAD - 6));
    const pointsRight = c.side === 'N' || c.side === 'C';
    const now = engine.last.now;
    const keep = {};
    let lines = '';
    let prevTop = g.y0 + LH; // Unterkante fuer das naechste Label
    let prevT = null;
    const editable = canEdit();

    // FLOW-Kasten unten freihalten, wenn die Labels ihn sonst ueberdecken wuerden
    const labLeft = pointsRight ? g.W - LEAD - labelW : LEAD, labRight = labLeft + labelW;
    if (c.flowEl) {
      const fx0 = c.flowEl.offsetLeft, fx1 = fx0 + c.flowEl.offsetWidth;
      if (fx1 > labLeft && fx0 < labRight) prevTop = Math.min(prevTop, c.flowEl.offsetTop - 6);
    }
    const sorted = items.slice().sort((a, b) => a._t - b._t);
    for (const it of sorted) {
      const ideal = g.y(it._t);
      if (ideal < g.top) break;
      let cy = Math.min(ideal, prevTop - LH / 2 - GAP);
      if (cy < g.top + LH / 2) break; // kein Platz mehr: Label liegt jenseits des Zeitstrahls und laeuft spaeter rein
      const gapMin = prevT == null ? 99 : (it._t - prevT) / 60;
      const bent = gapMin < cfg.defaults.bentLineBelowMin || Math.abs(cy - ideal) > 1;
      prevTop = cy - LH / 2; prevT = it._t;
      const color = 'var(--iaf-' + it.iaf + ')';

      // Verbindungslinie vom Zeitstrahl zur Labelspitze
      const xEdge = pointsRight ? g.W : 0;
      const xTip = pointsRight ? g.W - LEAD : LEAD;
      if (bent) {
        const xk = pointsRight ? g.W - 8 : 8;
        lines += '<polyline points="' + xEdge + ',' + ideal + ' ' + xk + ',' + ideal + ' ' + xTip + ',' + cy + '" fill="none" stroke="' + color + '" stroke-width="1.6"/>';
      } else {
        lines += '<line x1="' + xEdge + '" y1="' + ideal + '" x2="' + xTip + '" y2="' + cy + '" stroke="' + color + '" stroke-width="1.6"/>';
      }

      let el = c.labels[it.cs];
      if (!el) {
        el = document.createElement('div');
        el.className = 'label';
        el.dataset.cs = it.cs;
        el.tabIndex = 0;
        el.addEventListener('pointerdown', onPointerDown);
        el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenuAt(el.dataset.cs, el); } });
        c.el.appendChild(el);
        c.labels[it.cs] = el;
      }
      keep[it.cs] = true;
      el.classList.toggle('editable', editable);
      el.style.width = labelW + 'px';
      el.style.top = (cy - LH / 2) + 'px';
      // Pfeilspitze zeigt auf den Zeitstrahl; der blaue static-Block sitzt am anderen Ende
      const stPad = engine.state.staticMode ? (mobile ? 10 : 18) : 0;
      const tipPad = mobile ? 12 : 22, endPad = mobile ? 5 : 8;
      if (pointsRight) { el.style.left = ''; el.style.right = LEAD + 'px'; el.style.padding = '0 ' + tipPad + 'px 0 ' + (endPad + stPad) + 'px'; }
      else { el.style.right = ''; el.style.left = LEAD + 'px'; el.style.padding = '0 ' + (endPad + stPad) + 'px 0 ' + tipPad + 'px'; }
      const wtc = it.wtc && it.wtc !== 'M' ? it.wtc : '';
      let right;
      if (mode === 'ctr') {
        // ein Balken je Minute, die CTR verlieren soll (bis ctrMaxDelayMin); mehr Delay: "+" dahinter
        const more = (it.delayIaf || 0) > cfg.defaults.ctrMaxDelayMin * 60 + 30;
        right = '<span class="strokes">' + '<i></i>'.repeat(it.ctrStrokes || 0) + (more ? '<b>+</b>' : '') + '</span>';
      } else {
        right = '<span class="mi">' + Math.round(it.remainingNm) + '</span>';
      }
      const st = engine.state.staticMode ? '<span class="st" style="' + (pointsRight ? 'left' : 'right') + ':4px"></span>' : '';
      const man = it.locked ? 'manual' : '';
      // Schriftfarbe nach Strom: z. B. SOTOV T101 und REDBU Q112 in der Farbe der Box, sonst weiss
      const sdef = it.stream && cfg.iafs[it.iaf].streams ? cfg.iafs[it.iaf].streams[it.stream] : null;
      const txt = sdef && sdef.text === 'box' ? ' style="color:var(--txt-' + it.iaf + ')"' : '';
      const sig = [labelW, LH, pointsRight, it.iaf, it.cs, wtc, txt, mode === 'ctr' ? it.ctrStrokes + ':' + Math.round((it.delayIaf || 0) / 60) : Math.round(it.remainingNm), st, man].join('|');
      el.classList.toggle('flash', (flash[it.cs] || 0) > Date.now());
      if (el.dataset.sig !== sig) {
        el.dataset.sig = sig;
        el.innerHTML = labelSvg(labelW, LH, pointsRight, color, !!man) + st + '<span class="cs"' + txt + '>' + esc(it.cs) + '</span><span class="wtc"' + txt + '>' + wtc + '</span>' + right;
        el.title = man ? 'placed manually (RECOMPUTE releases)' : '';
        el.setAttribute('aria-label', it.cs + (wtc ? ' ' + wtc : '') + (it.stream ? ' via ' + it.stream : '') + ', ' + hhmm(it._t) + (mode === 'ctr' ? ', ' + (it.ctrStrokes || 0) + ' min to lose' : ', ' + Math.round(it.remainingNm) + ' NM'));
      }
    }
    for (const cs of Object.keys(c.labels)) if (!keep[cs]) { c.labels[cs].remove(); delete c.labels[cs]; }
    c.svg.querySelector('.ln').innerHTML = lines;
    // leere Ansicht von einem Ausfall unterscheiden
    let em = c.el.querySelector('.empty');
    if (!em) { em = document.createElement('div'); em.className = 'empty'; c.el.appendChild(em); }
    em.textContent = sorted.length ? '' : (mode === 'ctr' ? 'no arrivals' : '');
    em.hidden = !!sorted.length || mode !== 'ctr';
  }

  function render() {
    const v = viewKey();
    if (v !== curView) buildColumns(v);
    const st = engine.state, last = engine.last;
    const editable = canEdit();

    drawScale();
    if (isCtrView(v)) {
      const c = colEls.C;
      const view = ctrView(v);
      const items = last.list.filter(i => showsItem(view, i) && !i.passedIaf && !i.hold && i.staIaf != null).map(i => Object.assign(i, { _t: i.staIaf }));
      drawColumn(c, items, 'ctr', view);
      c.tag.classList.toggle('on', st.staticMode); c.tag.textContent = st.staticMode ? 'static' : 'dynamic'; c.tag.disabled = true;
      $('frameTitle').textContent = view.label;
      const nm = c.el.querySelector('.col-name'); if (nm && nm.textContent !== view.label) nm.textContent = view.label;
    } else {
      $('frameTitle').textContent = 'AMAN EDDM ' + v;
      for (const side of ['N', 'S']) {
        const c = colEls[side];
        drawClosures(c);
        const items = (last.bySide[side] || []).map(i => Object.assign(i, { _t: i.sta }));
        drawColumn(c, items, 'app');
        c.tag.classList.toggle('on', st.staticMode);
        c.tag.textContent = st.staticMode ? 'static' : 'dynamic';
        c.tag.disabled = !editable;
        if (document.activeElement !== c.flowInput) c.flowInput.value = st.spacing[side].toFixed(1);
        c.flowInput.disabled = !editable;
      }
    }
    $('rwyVal').textContent = last.dir || '26';
    // Betriebsrichtung gewechselt (sofort oder zum geplanten Zeitpunkt): neue Richtung blinkt 10 s
    if (render.dir && last.dir && render.dir !== last.dir) {
      const v = $('rwyVal');
      v.classList.remove('blink'); void v.offsetWidth; v.classList.add('blink');
      clearTimeout(render.blinkTimer);
      render.blinkTimer = setTimeout(() => v.classList.remove('blink'), 10000);
    }
    render.dir = last.dir;
    $('rwyNext').textContent = last.dirChange ? '\u2192' + last.dirChange.to + ' ' + hhmm(last.dirChange.at) : '';
    if (!$('rwyDlg').hidden) syncRwyDlg(false);
    // EuroScope dreht das AMAN nicht mit; passt die Richtung dort nicht, gibt es am Rand eine Meldung
    const es = last.esDir, wEl = $('dirWarn');
    const warn = es && es !== last.dir
      ? 'RWY MISMATCH: EuroScope ' + es + ', AMAN ' + last.dir + (last.dirChange && last.dirChange.to === es ? ' (change to ' + es + ' planned at ' + hhmm(last.dirChange.at) + ')' : '')
      : '';
    if (wEl.textContent !== warn) wEl.textContent = warn;
    wEl.hidden = !warn;
    $('btnRwy').disabled = !editable;
    $('len').value = st.timelineMin; $('lenVal').textContent = st.timelineMin;
    renderHold();
    if (menu && !engine.last.byCs[menu.cs]) closeMenu();
    renderStats('N'); renderStats('S');
    renderLive();
    syncUndo();
    renderStatus();
  }

  /** Nur Uhr und Daten-Hinweis aktualisieren (Plugin-Modus zwischen zwei Datenpaketen). */
  function renderLive() {
    const sec = staleSec(), b = $('stale');
    const stale = !simApi && sec > 15;
    b.hidden = !stale;
    if (stale) b.textContent = 'DATA STALE ' + (isFinite(sec) ? Math.round(sec) + ' s' : '') + (connErr ? ' \u2013 ' + connErr : '');
    $('scope').classList.toggle('is-stale', stale);
    renderStatus();
  }

  function renderHold() {
    const ul = $('holdList');
    const hold = engine.state.hold;
    const sig = hold.join(',') + '|' + canEdit();
    if (ul.dataset.sig === sig) return;
    ul.dataset.sig = sig;
    ul.innerHTML = '';
    const ed = canEdit();
    for (const cs of hold) {
      const li = document.createElement('li');
      li.textContent = cs;
      li.dataset.cs = cs;
      li.tabIndex = 0;
      li.classList.toggle('editable', ed);
      li.title = ed ? 'Drag onto North or South to sequence again' : '';
      li.addEventListener('pointerdown', onPointerDown);
      li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenuAt(cs, li); } });
      ul.appendChild(li);
    }
  }

  function renderStats(side) {
    const s = engine.stats(side);
    const f1 = n => n.toFixed(1);
    $('stats' + side).innerHTML =
      '<table aria-label="Statistics ' + (side === 'N' ? 'North' : 'South') + '"><tr><th>' + side + '</th><th>FLW</th><th>DEM</th><th>CNT</th></tr>' +
      '<tr><td></td><td>' + s.flw + '</td><td>' + s.dem + '</td><td>' + s.cnt + '</td></tr>' +
      '<tr><td class="k">' + side + '</td>' + s.win.map(w => '<td>' + w.min + '</td>').join('') + '</tr>' +
      '<tr><td class="k">LND</td>' + s.win.map(w => '<td>' + w.lnd + '</td>').join('') + '</tr>' +
      '<tr><td class="k">SEP</td>' + s.win.map(w => '<td>' + f1(w.sep) + '</td>').join('') + '</tr></table>';
  }

  function renderStatus() {
    const w = currentWinds();
    const wf = x => x ? pad3(x.dir) + '/' + pad(x.spd) : '---';
    const lines = [];
    if (simApi) lines.push('<b>Simulation</b> ' + settings.simRate + '/h, ' + settings.simSpeed + 'x');
    else lines.push(connErr ? '<b>' + esc(connErr) + '</b>' : '<b>' + esc((me && me.callsign) || 'not connected') + '</b> ' + role());
    lines.push('View ' + viewKey() + (canEdit() ? ', control enabled' : ', display only'));
    lines.push('Wind surface ' + wf(w.surface) + ', FL100 ' + wf(w.aloft));
    lines.push('Final-GS ' + (engine.state.finalGsMode === 'fixed' ? 'fixed 140 kt' : 'type and wind'));
    lines.push(engine.last.list.length + ' aircraft tracked');
    $('status').innerHTML = lines.join('<br>');
  }
  const pad3 = n => String(n).padStart(3, '0');

  // ---------- Drag & Drop ----------
  function onPointerDown(e) {
    if (e.button > 0) return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    drag = { el, cs: el.dataset.cs, fromHold: el.tagName === 'LI', canMove: canEdit(), sx: e.clientX, sy: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, active: false };
    el.setPointerCapture(e.pointerId);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('lostpointercapture', onPointerUp);
  }
  function onPointerMove(e) {
    if (!drag) return;
    if (!drag.canMove) return;
    if (!drag.active && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 12) return; // kleine Wackler sind ein Klick
    if (!drag.active) {
      drag.active = true;
      closeMenu();
      const r = drag.el.getBoundingClientRect();
      drag.el.classList.add('dragging');
      drag.el.style.position = 'fixed'; drag.el.style.right = ''; drag.el.style.width = r.width + 'px';
    }
    drag.el.style.left = (e.clientX - drag.dx) + 'px';
    drag.el.style.top = (e.clientY - drag.dy) + 'px';
    $('holdBox').classList.toggle('over', !drag.fromHold && inside($('holdBox'), e.clientX, e.clientY));
    for (const side of ['N', 'S']) if (colEls[side]) colEls[side].el.classList.toggle('over', inside(colEls[side].el, e.clientX, e.clientY));
    showInsert(e.clientX, e.clientY);
  }
  /** Einfuegemarke: zeigt beim Ziehen, zwischen welche Labels der Flieger kommt. */
  function showInsert(x, y) {
    const mk = $('insMark');
    for (const side of ['N', 'S']) {
      const c = colEls[side];
      if (!c || !inside(c.el, x, y)) continue;
      const ls = Object.keys(c.labels).filter(cs => cs !== drag.cs).map(cs => c.labels[cs].getBoundingClientRect()).sort((a, b) => a.top - b.top);
      let yy = null;
      for (let i = 0; i < ls.length; i++) {
        const mid = ls[i].top + ls[i].height / 2;
        if (y < mid) { yy = i === 0 ? ls[0].top - 3 : (ls[i - 1].bottom + ls[i].top) / 2; break; }
      }
      if (yy == null) yy = ls.length ? ls[ls.length - 1].bottom + 3 : y;
      const r = c.el.getBoundingClientRect();
      mk.style.left = r.left + 'px'; mk.style.width = r.width + 'px'; mk.style.top = yy + 'px';
      mk.hidden = false;
      return;
    }
    mk.hidden = true;
  }
  function onPointerUp(e) {
    const d = drag; drag = null;
    if (!d) return;
    d.el.removeEventListener('pointermove', onPointerMove);
    d.el.removeEventListener('pointerup', onPointerUp);
    d.el.removeEventListener('pointercancel', onPointerUp);
    d.el.removeEventListener('lostpointercapture', onPointerUp);
    $('holdBox').classList.remove('over');
    $('insMark').hidden = true;
    d.el.classList.remove('dragging');
    d.el.style.position = '';
    for (const side of ['N', 'S']) if (colEls[side]) colEls[side].el.classList.remove('over');
    if (!d.active) {
      if (e.type === 'pointerup' && d.canMove) openMenu(d.cs, e.clientX, e.clientY);
      tick(); return;
    }
    const x = e.clientX, y = e.clientY;
    if (inside($('holdBox'), x, y)) {
      if (!d.fromHold) { snapshot('HOLD ' + d.cs); mark(d.cs); engine.toHold(d.cs); }
    } else {
      for (const side of ['N', 'S']) {
        const c = colEls[side];
        if (!c || !inside(c.el, x, y)) continue;
        // Index = Anzahl der Labels, die unterhalb der Drop-Position liegen
        let idx = 0;
        for (const cs of engine.state.seq[side]) {
          if (cs === d.cs) continue;
          const l = c.labels[cs];
          if (!l) continue; // nicht gezeichnet = jenseits des Zeitstrahls, also spaeter als die Drop-Position
          const r = l.getBoundingClientRect();
          if (r.top + r.height / 2 > y) idx++;
        }
        snapshot('move ' + d.cs); mark(d.cs);
        engine.moveTo(d.cs, side, idx);
      }
    }
    // Label und Hold-Liste neu aufbauen lassen
    if (d.fromHold) { d.el.remove(); $('holdList').dataset.sig = ''; }
    for (const k of Object.keys(colEls)) { const c = colEls[k]; if (c.labels && c.labels[d.cs]) { c.labels[d.cs].remove(); delete c.labels[d.cs]; } }
    tick();
  }
  // ---------- Menue am Flieger: CHANGE RWY, HOLD, RECOMPUTE ----------
  let menu = null; // { cs, anchor }
  function openMenuAt(cs, anchor) {
    const r = anchor.getBoundingClientRect();
    openMenu(cs, r.left + r.width / 2, r.bottom, anchor);
  }
  function openMenu(cs, x, y, anchor) {
    if (!canEdit()) return;
    const it = engine.last.byCs[cs];
    if (!it) return;
    menu = { cs, anchor: anchor || document.querySelector('.label[data-cs="' + sel(cs) + '"], #holdList li[data-cs="' + sel(cs) + '"]') };
    const m = $('acmenu');
    const other = it.side === 'N' ? 'S' : 'N';
    const otherRwy = cfg.runways[other].ids[engine.last.dir || '26'];
    m.innerHTML = '<div class="mt">' + esc(it.cs) + ' ' + (it.hold ? 'HOLD' : esc(it.rwy)) + '</div>' +
      '<button type="button" role="menuitem" data-act="rwy">CHANGE RWY ' + otherRwy + '</button>' +
      '<button type="button" role="menuitem" data-act="hold"' + (it.hold ? ' disabled' : '') + '>HOLD</button>' +
      '<button type="button" role="menuitem" data-act="recompute">RECOMPUTE</button>';
    m.hidden = false;
    const bw = m.offsetWidth, bh = m.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    m.style.left = Math.max(8, Math.min(vw - bw - 8, x + 4)) + 'px';
    m.style.top = Math.max(8, Math.min(vh - bh - 8, y + 4)) + 'px';
    m.querySelector('button:not([disabled])').focus({ preventScroll: true });
  }
  function closeMenu() {
    if (!menu) return;
    const a = menu.anchor;
    menu = null;
    $('acmenu').hidden = true;
    if (a && a.isConnected) a.focus({ preventScroll: true });
  }
  /** Zustand vor einem Eingriff merken (fuer UNDO). */
  function snapshot(what) {
    const st = engine.state, ac = {};
    for (const cs of Object.keys(st.ac)) { const a = st.ac[cs]; ac[cs] = { rwySide: a.rwySide || null, locked: !!a.locked, hold: !!a.hold }; }
    undoStack.push({ what, seq: { N: st.seq.N.slice(), S: st.seq.S.slice() }, hold: st.hold.slice(), ac,
      closures: JSON.parse(JSON.stringify(st.closures)), dirChange: st.dirChange ? Object.assign({}, st.dirChange) : null, dir: st.dir, staticMode: st.staticMode });
    if (undoStack.length > 20) undoStack.shift();
    syncUndo();
  }
  function undo() {
    const u = undoStack.pop();
    if (!u || !canEdit()) { syncUndo(); return; }
    const st = engine.state;
    st.seq = u.seq; st.hold = u.hold; st.closures = u.closures; st.dirChange = u.dirChange; st.dir = u.dir;
    if (st.staticMode !== u.staticMode) engine.setStatic(u.staticMode);
    for (const cs of Object.keys(u.ac)) if (st.ac[cs]) Object.assign(st.ac[cs], u.ac[cs]);
    $('holdList').dataset.sig = '';
    save(); syncUndo(); tick();
  }
  function syncUndo() {
    const b = $('btnUndo'), u = undoStack[undoStack.length - 1];
    b.disabled = !u || !canEdit();
    b.title = u ? 'Undo: ' + u.what + ' (Ctrl+Z)' : 'Nothing to undo';
  }
  const mark = cs => { flash[cs] = Date.now() + 5000; };

  function menuAction(act) {
    if (!menu) return;
    const cs = menu.cs, it = engine.last.byCs[cs];
    closeMenu();
    if (!it || !canEdit()) return;
    snapshot((act === 'rwy' ? 'CHANGE RWY ' : act === 'hold' ? 'HOLD ' : 'RECOMPUTE ') + cs);
    mark(cs);
    if (act === 'rwy') engine.insertByEta(cs, it.side === 'N' ? 'S' : 'N');
    else if (act === 'hold') engine.toHold(cs);
    else if (act === 'recompute') engine.recomputeOne(cs);
    $('holdList').dataset.sig = '';
    for (const k of Object.keys(colEls)) { const c = colEls[k]; if (c.labels && c.labels[cs]) { c.labels[cs].remove(); delete c.labels[cs]; } }
    tick();
  }

  function inside(el, x, y) { const r = el.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }

  // ---------- Bedienung ----------
  function bindUi() {
    $('btnRwy').addEventListener('click', openRwyDlg);
    bindRwyDlg();
    $('len').addEventListener('input', e => { engine.state.timelineMin = +e.target.value; save(); tick(); });
    $('btnMenu').addEventListener('click', openSheet);
    $('btnClose').addEventListener('click', () => { $('sheet').hidden = true; });
    $('sheet').addEventListener('click', e => { if (e.target === $('sheet')) $('sheet').hidden = true; });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { $('sheet').hidden = true; closeMenu(); if (!$('rwyDlg').hidden) closeRwyDlg(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); undo(); }
    });
    $('btnUndo').addEventListener('click', undo);
    $('acmenu').addEventListener('click', e => { const b = e.target.closest('button[data-act]'); if (b && !b.disabled) menuAction(b.dataset.act); });
    $('acmenu').addEventListener('keydown', e => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const bs = [...$('acmenu').querySelectorAll('button:not([disabled])')];
      const i = bs.indexOf(document.activeElement);
      bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length].focus();
    });
    document.addEventListener('pointerdown', e => {
      if (!menu || e.target.closest('#acmenu')) return;
      closeMenu();
    });

    $('selSource').addEventListener('change', e => { settings.source = e.target.value; save(); startSource(); syncSheet(); });
    $('selTheme').addEventListener('change', e => { settings.theme = e.target.value; applyTheme(); syncQuick(); save(); });
    $('selView').addEventListener('change', e => { settings.view = e.target.value; syncQuick(); save(); tick(); });
    $('qView').addEventListener('change', e => { settings.view = e.target.value; $('selView').value = settings.view; save(); tick(); });
    $('qTheme').addEventListener('change', e => { settings.theme = e.target.value; $('selTheme').value = settings.theme; applyTheme(); save(); });
    $('selGs').addEventListener('change', e => { engine.state.finalGsMode = e.target.value; save(); tick(); });
    $('rateN').addEventListener('change', e => { engine.state.rate.N = clampRate(e.target.value); save(); tick(); });
    $('rateS').addEventListener('change', e => { engine.state.rate.S = clampRate(e.target.value); save(); tick(); });
    $('simRate').addEventListener('change', e => { settings.simRate = +e.target.value; if (simApi) simApi.sim.rate = settings.simRate; save(); });
    $('simSpeed').addEventListener('change', e => { settings.simSpeed = +e.target.value; save(); });
    $('simWind').addEventListener('change', e => {
      settings.simWind = e.target.value; save();
      if (simApi) { const [d, s] = settings.simWind.split('/').map(Number); simApi.sim.wind = { surface: { dir: d, spd: s }, aloft: { dir: (d + 20) % 360, spd: Math.max(15, s * 2.5) } }; }
    });
    $('btnSimReset').addEventListener('click', () => {
      engine = AmanCore.createEngine(cfg, Object.assign({}, engine.state, { ac: {}, seq: { N: [], S: [] }, hold: [], landed: [], cnt: { N: 0, S: 0 }, closures: [] }));
      startSource(); $('sheet').hidden = true;
    });
    window.addEventListener('resize', () => { curView = null; closeMenu(); tick(); });
  }
  const clampRate = v => Math.max(10, Math.min(60, Math.round(+v || 45)));

  function openSheet() { syncSheet(); $('sheet').hidden = false; }
  function syncSheet() {
    $('selSource').value = settings.source;
    $('selSource').querySelector('option[value="plugin"]').disabled = !isPluginHost;
    $('selView').value = settings.view;
    $('selTheme').value = settings.theme;
    $('selGs').value = engine.state.finalGsMode;
    $('rateN').value = engine.state.rate.N; $('rateS').value = engine.state.rate.S;
    $('simRate').value = String(settings.simRate); $('simSpeed').value = String(settings.simSpeed); $('simWind').value = settings.simWind;
    $('simSection').hidden = settings.source !== 'sim';
    const ed = canEdit();
    ['selGs', 'rateN', 'rateS'].forEach(id => { $(id).disabled = !ed; });
  }

  // ---------- Dialog: Runway Change und Bahnsperre ----------
  let chTarget = null, pending = null; // pending: Eingriff, der noch bestaetigt werden muss
  /** Zweistufig: erster Klick zeigt, was passiert, zweiter Klick fuehrt aus. */
  function confirmStep(btn, key, text, label) {
    if (pending && pending.key === key) { pending = null; btn.textContent = label; return true; }
    pending = { key };
    $('rwyErr').textContent = '';
    $('rwyInfo').textContent = text;
    btn.textContent = 'CONFIRM';
    return false;
  }
  function affected(side, from, to) {
    return engine.last.list.filter(i => (side === 'B' || i.side === side) && !i.hold && i.sta >= from && i.sta < to).length;
  }
  const roundUp = (t, min) => Math.ceil(t / (min * 60)) * min * 60;
  const toInput = t => { const d = new Date(t * 1000); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); };
  /** HH:MM (UTC) als naechster Zeitpunkt im Fenster [ref - 12 h, ref + 12 h). */
  function fromInput(v, ref) {
    const m = /^\s*(\d{1,2}):?(\d{2})\s*$/.exec(v || '');
    if (!m || +m[1] > 23 || +m[2] > 59) return null;
    let t = Math.floor(ref / 86400) * 86400 + (+m[1]) * 3600 + (+m[2]) * 60;
    while (t < ref - 43200) t += 86400;
    while (t >= ref + 43200) t -= 86400;
    return t;
  }
  function openRwyDlg() {
    if (!canEdit()) return;
    closeMenu();
    const now = nowSec(), cur = engine.last.dir || '26';
    const chg = engine.state.dirChange;
    chTarget = chg ? chg.to : (cur === '26' ? '08' : '26');
    $('chTime').value = toInput(chg ? chg.at : roundUp(now + 15 * 60, 5));
    $('clFrom').value = toInput(roundUp(now + 10 * 60, 5));
    $('clTo').value = toInput(roundUp(now + 30 * 60, 5));
    document.querySelector('input[name=chWhen][value=at]').checked = true;
    document.querySelector('input[name=clWhen][value=at]').checked = true;
    pending = null; $('btnAddClosure').textContent = 'SET CLOSURE'; $('btnChSet').textContent = 'SET RWY CHANGE';
    $('rwyErr').textContent = '';
    syncRwyDlg(true);
    $('rwyDlg').hidden = false;
    $('chDir').querySelector('[aria-pressed=true]').focus();
  }
  function closeRwyDlg() { $('rwyDlg').hidden = true; $('rwyInfo').textContent = ''; pending = null; $('btnRwy').focus(); }
  function syncRwyDlg(full) {
    const cur = engine.last.dir || '26', chg = engine.state.dirChange;
    for (const b of $('chDir').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.dir === chTarget));
    const pl = $('chPlanned');
    const sig = chg ? chg.id + '|' + chg.at : 'none';
    if (pl.dataset.sig !== sig) {
      pl.dataset.sig = sig;
      pl.innerHTML = '';
      if (chg) {
        const t = document.createElement('span'); t.textContent = 'Planned: RWY ' + cur + ' \u2192 ' + chg.to + ' at ' + hhmm(chg.at);
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn-small'; b.textContent = 'DELETE';
        b.addEventListener('click', () => { snapshot('delete RWY change'); engine.clearDirChange(); save(); tick(); syncRwyDlg(true); });
        pl.append(t, b);
      }
    }
    const ul = $('clList');
    const csig = engine.state.closures.map(c => c.id + ':' + c.to).join(',') + cur;
    if (!full && ul.dataset.sig === csig) return;
    ul.dataset.sig = csig;
    ul.innerHTML = '';
    for (const c of engine.state.closures) {
      if (c.to < nowSec()) continue;
      const li = document.createElement('li');
      const t = document.createElement('span');
      t.textContent = (c.side === 'N' ? 'North' : 'South') + '  ' + hhmm(c.from) + '-' + hhmm(c.to);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn-small'; b.textContent = 'LIFT';
      b.addEventListener('click', () => {
        if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'CONFIRM'; return; }
        snapshot('lift closure'); engine.removeClosure(c.id); save(); tick(); syncRwyDlg(true);
      });
      li.append(t, b);
      ul.appendChild(li);
    }
  }
  function bindRwyDlg() {
    const err = m => { $('rwyErr').textContent = m; };
    $('rwyClose').addEventListener('click', closeRwyDlg);
    $('rwyDlg').addEventListener('click', e => { if (e.target === $('rwyDlg')) closeRwyDlg(); });
    $('rwyDlg').addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRwyDlg(); return; }
      if (e.key !== 'Tab') return;
      // Fokus bleibt im Dialog
      const f = [...$('rwyDlg').querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])')].filter(x => x.offsetParent);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    });
    // jede Aenderung an den Eingaben verwirft eine offene Bestaetigung
    $('rwyDlg').addEventListener('input', () => { if (pending) { pending = null; $('rwyInfo').textContent = ''; $('btnAddClosure').textContent = 'SET CLOSURE'; $('btnChSet').textContent = 'SET RWY CHANGE'; } });
    $('chDir').addEventListener('click', () => { if (pending) { pending = null; $('rwyInfo').textContent = ''; $('btnChSet').textContent = 'SET RWY CHANGE'; } });
    $('chDir').addEventListener('click', e => { const b = e.target.closest('button[data-dir]'); if (b) { chTarget = b.dataset.dir; syncRwyDlg(false); } });
    $('chTime').addEventListener('input', () => { document.querySelector('input[name=chWhen][value=at]').checked = true; });
    $('clFrom').addEventListener('input', () => { document.querySelector('input[name=clWhen][value=at]').checked = true; });
    $('btnChSet').addEventListener('click', () => {
      if (!canEdit()) return;
      const now = nowSec(), cur = engine.last.dir || '26';
      const when = document.querySelector('input[name=chWhen]:checked').value;
      if (when === 'now') {
        if (chTarget === cur && !engine.state.dirChange) { err('RWY ' + cur + ' is already active.'); return; }
        if (!confirmStep($('btnChSet'), 'ch-now-' + chTarget, 'RWY ' + cur + ' \u2192 ' + chTarget + ' NOW. ' + engine.last.list.filter(i => !i.passedIaf).length + ' arrivals will be re-planned.', 'SET RWY CHANGE')) return;
        snapshot('RWY CHANGE ' + chTarget);
        engine.setDirChange(chTarget, null);
      } else {
        const at = fromInput($('chTime').value, now);
        if (at == null) { err('Enter the time as HH:MM (UTC), e.g. 14:20.'); return; }
        if (at <= now) { err(hhmm(at) + ' is in the past. Choose "now" for an immediate change.'); return; }
        if (chTarget === cur) { err('RWY ' + cur + ' is already active. Choose the other direction.'); return; }
        if (!confirmStep($('btnChSet'), 'ch-' + chTarget + '-' + at, 'RWY ' + cur + ' \u2192 ' + chTarget + ' at ' + hhmm(at) + '. ' + engine.last.list.filter(i => i.sta >= at).length + ' arrivals land after that.', 'SET RWY CHANGE')) return;
        snapshot('RWY CHANGE ' + chTarget + ' ' + hhmm(at));
        engine.setDirChange(chTarget, at);
      }
      err(''); $('rwyInfo').textContent = 'Set.'; save(); tick(); syncRwyDlg(true);
    });
    $('btnAddClosure').addEventListener('click', () => {
      if (!canEdit()) return;
      const now = nowSec();
      const from = document.querySelector('input[name=clWhen]:checked').value === 'now' ? now : fromInput($('clFrom').value, now);
      if (from == null) { err('Enter the start as HH:MM (UTC), e.g. 14:20.'); return; }
      if (from < now - 60) { err('Start ' + hhmm(from) + ' is in the past. Choose "now" to close immediately.'); return; }
      let to = fromInput($('clTo').value, from + 43200 - 60);
      if (to == null) { err('Enter the end as HH:MM (UTC), e.g. 14:50.'); return; }
      if (to <= from) { err('The end must be after the start.'); return; }
      const sv = $('clSide').value, cur = engine.last.dir || '26';
      const name = sv === 'B' ? 'Both runways' : (sv === 'N' ? 'North' : 'South');
      const txt = name + ' closed ' + hhmm(Math.max(from, now)) + '-' + hhmm(to) + '. ' + affected(sv, Math.max(from, now), to) + ' arrivals affected.';
      if (!confirmStep($('btnAddClosure'), 'cl-' + sv + '-' + from + '-' + to, txt, 'SET CLOSURE')) return;
      snapshot('closure ' + name);
      const sides = sv === 'B' ? ['N', 'S'] : [sv];
      sides.forEach(x => engine.addClosure(x, Math.max(from, now), to));
      err(''); $('rwyInfo').textContent = 'Set: ' + txt; save(); tick(); syncRwyDlg(true);
    });
  }
})();
