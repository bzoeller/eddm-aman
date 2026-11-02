/* EDDM AMAN Anzeige. Holt Daten vom EuroScope-Plugin (oder aus der Simulation), rechnet mit AmanCore und zeichnet den Schirm. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const STORE_KEY = 'eddm-aman-v1';
  const SVGNS = 'http://www.w3.org/2000/svg';
  const isPluginHost = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && location.port === '8471';

  let cfg, engine, simApi = null;
  let settings = {
    source: isPluginHost ? 'plugin' : 'sim', view: 'auto', theme: 'system',
    simRate: 60, simSpeed: 5, simWind: '250/10'
  };
  let traffic = { aircraft: [] }, me = null, metar = null, aloft = null, lastData = 0, connErr = null;
  let curView = null, colEls = {}, drag = null, timer = null;

  // ---------- Speicher ----------
  function load() {
    try { const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); return s || null; } catch (e) { return null; }
  }
  function save() {
    try {
      const st = engine.state;
      localStorage.setItem(STORE_KEY, JSON.stringify({
        settings, engine: { dir: st.dir, staticMode: st.staticMode, spacing: st.spacing, rate: st.rate, finalGsMode: st.finalGsMode, timelineMin: st.timelineMin, closures: st.closures }
      }));
    } catch (e) { /* ohne Speicher geht es auch */ }
  }

  // ---------- Start ----------
  fetch('eddm.json').then(r => r.json()).then(c => {
    cfg = c;
    const saved = load();
    if (saved && saved.settings) Object.assign(settings, saved.settings);
    if (!isPluginHost && settings.source === 'plugin') settings.source = 'sim';
    engine = AmanCore.createEngine(cfg, saved && saved.engine ? Object.assign({}, saved.engine, { closures: (saved.engine.closures || []).filter(c => c.to > Date.now() / 1000) }) : null);
    applyTheme();
    bindUi();
    startSource();
  }).catch(err => {
    $('status').textContent = 'Konfiguration eddm.json nicht gefunden: ' + err.message;
  });

  function applyTheme() {
    const r = document.documentElement;
    if (settings.theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', settings.theme);
  }

  // ---------- Datenquellen ----------
  function startSource() {
    clearInterval(timer);
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
      pollPlugin();
      timer = setInterval(pollPlugin, 1000);
      fetchAloft();
      setInterval(fetchAloft, 30 * 60 * 1000);
    }
    tick();
  }

  function tickSim() {
    const dt = 0.25 * (+settings.simSpeed);
    simApi.sim.dir = engine.state.dir === 'auto' ? '26' : engine.state.dir;
    simApi.step(dt, engine.last);
    tick();
  }

  function pollPlugin() {
    fetch('/api/traffic', { cache: 'no-store' }).then(r => r.json()).then(d => {
      me = d.me || null; metar = d.metar || null; lastData = Date.now(); connErr = null;
      const rw = d.arrRwys || [];
      traffic = { aircraft: d.aircraft || [], activeDir: rw.some(r => /^08/.test(r)) ? '08' : (rw.some(r => /^26/.test(r)) ? '26' : null) };
      tick();
    }).catch(e => { connErr = 'Keine Verbindung zum Plugin'; tick(); });
  }

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
  function nowSec() { return simApi ? simApi.sim.t : Date.now() / 1000; }

  function tick() {
    if (drag) return; // waehrend Drag & Drop nicht neu zeichnen
    const tr = simApi ? simApi.traffic() : traffic;
    engine.update(tr, nowSec(), currentWinds());
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
    if (r === 'CTR') return AmanCore.ctrSector(cfg, me && me.callsign) || 'APP';
    return r === 'OBS' ? 'TWR' : r;
  }
  const isCtrView = v => !!cfg.iafs[v];
  const canEdit = () => viewKey() === 'APP' && (simApi || role() === 'APP');

  // ---------- Zeichnen ----------
  function buildColumns(v) {
    const cols = $('cols');
    cols.innerHTML = '';
    colEls = {};
    if (isCtrView(v)) {
      cols.className = 'cols ctr-view';
      colEls.C = makeCol('C', 'CTR ' + cfg.iafs[v].sector + ' / ' + v);
      cols.appendChild(colEls.C.el);
      colEls.scale = makeScale(); cols.appendChild(colEls.scale.el);
    } else {
      cols.className = 'cols app-view';
      colEls.N = makeCol('N', 'NORD'); cols.appendChild(colEls.N.el);
      colEls.scale = makeScale(); cols.appendChild(colEls.scale.el);
      colEls.S = makeCol('S', 'SUED'); cols.appendChild(colEls.S.el);
    }
    curView = v;
  }

  function makeCol(side, name) {
    const el = document.createElement('div');
    el.className = 'col ' + side;
    el.dataset.side = side;
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'layer');
    svg.innerHTML = '<defs><pattern id="hatch' + side + '" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="14" stroke="var(--hatch)" stroke-width="1.2"/></pattern></defs><g class="cl"></g><g class="ln"></g>';
    el.appendChild(svg);
    const head = document.createElement('div');
    head.className = 'col-head';
    const nm = document.createElement('span'); nm.className = 'col-name'; nm.textContent = name;
    const tag = document.createElement('button'); tag.type = 'button'; tag.className = 'tag'; tag.textContent = 'static';
    tag.id = 'static' + side;
    tag.addEventListener('click', () => { if (canEdit()) { engine.setStatic(!engine.state.staticMode); save(); tick(); } });
    if (side === 'N') { head.appendChild(nm); head.appendChild(tag); } else { head.appendChild(tag); head.appendChild(nm); }
    el.appendChild(head);
    let flowInput = null;
    if (side !== 'C') {
      const flow = document.createElement('label');
      flow.className = 'flow';
      flow.setAttribute('for', 'flow' + side);
      flow.innerHTML = '<span>FLOW</span>';
      flowInput = document.createElement('input');
      flowInput.type = 'number'; flowInput.step = '0.5'; flowInput.min = '2.5'; flowInput.max = '20'; flowInput.id = 'flow' + side;
      flowInput.setAttribute('aria-label', 'Abstand ' + name + ' in NM');
      flowInput.addEventListener('change', () => {
        const v = Math.max(2.5, Math.min(20, parseFloat(flowInput.value) || cfg.defaults.spacingNm));
        engine.state.spacing[side] = v; save(); tick();
      });
      flow.appendChild(flowInput);
      el.appendChild(flow);
    }
    return { el, svg, tag, flowInput, side, labels: {}, closeBtns: [] };
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
    const clockH = window.matchMedia('(max-width: 760px)').matches ? 32 : 40;
    const y0 = H - clockH, top = 40;
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
      const len = long ? 9 : 5;
      s += '<line x1="0" x2="' + len + '" y1="' + y + '" y2="' + y + '" stroke="var(--tick)" stroke-width="1.5"/>';
      s += '<line x1="' + (W - len) + '" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="var(--tick)" stroke-width="1.5"/>';
      if (long && y < g.y0 - 10) {
        const txt = m === 0 ? hhmm(t) : pad(m);
        s += '<text x="' + W / 2 + '" y="' + (y + 5) + '" text-anchor="middle" fill="var(--tick)" font-family="B612, sans-serif" font-weight="700" font-size="' + (m === 0 ? (W < 60 ? 10 : 13) : (W < 60 ? 12 : 16)) + '">' + txt + '</text>';
      }
    }
    sc.svg.innerHTML = s;
    sc.clock.textContent = hhmm(now, ' ');
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
        b.type = 'button'; b.className = 'closure-x'; b.textContent = 'SPERRE AUFHEBEN';
        b.style.top = (yTop + 34) + 'px';
        b.style[c.side === 'N' ? 'left' : 'right'] = '8px';
        b.addEventListener('click', () => { engine.removeClosure(cl.id); save(); tick(); });
        c.el.appendChild(b); c.closeBtns.push(b);
      }
    }
    grp.innerHTML = s;
  }

  function labelSvg(w, h, pointsRight, color) {
    const tip = 11;
    const pts = pointsRight
      ? [[1, 1], [w - tip, 1], [w - 1, h / 2], [w - tip, h - 1], [1, h - 1]]
      : [[tip, 1], [w - 1, 1], [w - 1, h - 1], [tip, h - 1], [1, h / 2]];
    return '<svg class="shape" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"><polygon points="' + pts.map(p => p.join(',')).join(' ') + '" fill="var(--label-bg)" stroke="' + color + '" stroke-width="2.4"/></svg>';
  }

  function drawColumn(c, items, mode) {
    const g = geom(c.el);
    const mobile = window.matchMedia('(max-width: 760px)').matches;
    const LH = mobile ? 22 : 26, GAP = 2, LEAD = mobile ? 14 : 26;
    const labelW = Math.max(90, Math.min(mobile ? 170 : 300, g.W - LEAD - 6));
    const pointsRight = c.side === 'N' || c.side === 'C';
    const now = engine.last.now;
    const keep = {};
    let lines = '';
    let prevTop = g.y0 + LH; // Unterkante fuer das naechste Label
    let prevT = null;
    const editable = canEdit();

    const sorted = items.slice().sort((a, b) => a._t - b._t);
    for (const it of sorted) {
      const ideal = g.y(it._t);
      if (ideal < g.top) break;
      let cy = Math.min(ideal, prevTop - LH / 2 - GAP);
      cy = Math.max(cy, g.top + LH / 2);
      const gapMin = prevT == null ? 99 : (it._t - prevT) / 60;
      const bent = gapMin < cfg.defaults.bentLineBelowMin || Math.abs(cy - ideal) > 1;
      prevTop = cy - LH / 2; prevT = it._t;
      const color = 'var(--iaf-' + it.iaf + ')';

      // Verbindungslinie vom Zeitstrahl zur Labelspitze
      const xEdge = pointsRight ? g.W : 0;
      const xTip = pointsRight ? g.W - LEAD : LEAD;
      if (bent) {
        const xk = pointsRight ? g.W - 8 : 8;
        lines += '<polyline points="' + xEdge + ',' + ideal + ' ' + xk + ',' + ideal + ' ' + xTip + ',' + cy + '" fill="none" stroke="' + color + '" stroke-width="1.4"/>';
      } else {
        lines += '<line x1="' + xEdge + '" y1="' + ideal + '" x2="' + xTip + '" y2="' + cy + '" stroke="' + color + '" stroke-width="1.4"/>';
      }

      let el = c.labels[it.cs];
      if (!el) {
        el = document.createElement('div');
        el.className = 'label';
        el.dataset.cs = it.cs;
        el.tabIndex = 0;
        el.addEventListener('pointerdown', onPointerDown);
        el.addEventListener('dblclick', () => { if (canEdit()) { engine.unlock(el.dataset.cs); closeDetail(); tick(); } });
        el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(el.dataset.cs, el); } });
        c.el.appendChild(el);
        c.labels[it.cs] = el;
      }
      keep[it.cs] = true;
      el.classList.toggle('editable', editable);
      el.style.width = labelW + 'px';
      el.style.top = (cy - LH / 2) + 'px';
      if (pointsRight) { el.style.left = ''; el.style.right = LEAD + 'px'; el.style.padding = '0 ' + 14 + 'px 0 8px'; }
      else { el.style.right = ''; el.style.left = LEAD + 'px'; el.style.padding = '0 6px 0 14px'; }
      const wtc = it.wtc && it.wtc !== 'M' ? it.wtc : '';
      let right;
      if (mode === 'ctr') {
        right = '<span class="strokes">' + '<i></i>'.repeat(it.ctrStrokes || 0) + '</span>';
      } else {
        right = '<span class="mi">' + Math.round(it.remainingNm) + '</span>';
      }
      const st = engine.state.staticMode ? '<span class="st"></span>' : '';
      const man = it.locked ? '<span class="man" title="manuell platziert"></span>' : '';
      const sig = [labelW, LH, pointsRight, it.iaf, it.cs, wtc, mode === 'ctr' ? it.ctrStrokes : Math.round(it.remainingNm), st, man].join('|');
      if (el.dataset.sig !== sig) {
        el.dataset.sig = sig;
        el.innerHTML = labelSvg(labelW, LH, pointsRight, color) + man + '<span class="cs">' + it.cs + '</span><span class="wtc">' + wtc + '</span>' + right + st;
        el.setAttribute('aria-label', it.cs + (wtc ? ' ' + wtc : '') + ', ' + hhmm(it._t) + (mode === 'ctr' ? ', ' + (it.ctrStrokes || 0) + ' Minuten verlieren' : ', ' + Math.round(it.remainingNm) + ' NM'));
      }
    }
    for (const cs of Object.keys(c.labels)) if (!keep[cs]) { c.labels[cs].remove(); delete c.labels[cs]; }
    c.svg.querySelector('.ln').innerHTML = lines;
  }

  function render() {
    const v = viewKey();
    if (v !== curView) buildColumns(v);
    const st = engine.state, last = engine.last;
    const editable = canEdit();

    drawScale();
    if (isCtrView(v)) {
      const c = colEls.C;
      const items = last.list.filter(i => i.iaf === v && !i.passedIaf && !i.hold && i.staIaf != null).map(i => Object.assign(i, { _t: i.staIaf }));
      drawColumn(c, items, 'ctr');
      c.tag.classList.toggle('on', st.staticMode); c.tag.textContent = st.staticMode ? 'static' : 'dynamic'; c.tag.disabled = true;
    } else {
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
    $('rwyAuto').textContent = st.dir === 'auto' ? 'AUTO' : 'MANUELL';
    $('btnRwy').disabled = !editable;
    $('len').value = st.timelineMin; $('lenVal').textContent = st.timelineMin;
    $('btnRecompute').disabled = !editable;
    renderHold();
    renderDetail();
    renderStats('N'); renderStats('S');
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
      li.title = ed ? 'Auf Nord- oder Suedbahn ziehen, um den Flieger wieder einzuplanen' : '';
      li.addEventListener('pointerdown', onPointerDown);
      li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(cs, li); } });
      ul.appendChild(li);
    }
  }

  function renderStats(side) {
    const s = engine.stats(side);
    const f1 = n => n.toFixed(1);
    $('stats' + side).innerHTML =
      '<table aria-label="Statistik ' + (side === 'N' ? 'Nordbahn' : 'Suedbahn') + '"><tr><th>' + side + '</th><th>FLW</th><th>DEM</th><th>CNT</th></tr>' +
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
    else lines.push(connErr ? '<b>' + connErr + '</b>' : '<b>' + ((me && me.callsign) || 'nicht verbunden') + '</b> ' + role());
    lines.push('Ansicht ' + viewKey() + (canEdit() ? ', Eingriffe frei' : ', nur Anzeige'));
    lines.push('Wind Boden ' + wf(w.surface) + ', FL100 ' + wf(w.aloft));
    lines.push('Final-GS ' + (engine.state.finalGsMode === 'fixed' ? 'fix 140 kt' : 'Typ und Wind'));
    lines.push(engine.last.list.length + ' Flieger erfasst');
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
  }
  function onPointerMove(e) {
    if (!drag) return;
    if (!drag.canMove) return;
    if (!drag.active && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
    if (!drag.active) {
      drag.active = true;
      closeDetail();
      const r = drag.el.getBoundingClientRect();
      drag.el.classList.add('dragging');
      drag.el.style.position = 'fixed'; drag.el.style.right = ''; drag.el.style.width = r.width + 'px';
    }
    drag.el.style.left = (e.clientX - drag.dx) + 'px';
    drag.el.style.top = (e.clientY - drag.dy) + 'px';
    $('holdBox').classList.toggle('over', !drag.fromHold && inside($('holdBox'), e.clientX, e.clientY));
    for (const side of ['N', 'S']) if (colEls[side]) colEls[side].el.classList.toggle('over', inside(colEls[side].el, e.clientX, e.clientY));
  }
  function onPointerUp(e) {
    const d = drag; drag = null;
    if (!d) return;
    d.el.removeEventListener('pointermove', onPointerMove);
    d.el.removeEventListener('pointerup', onPointerUp);
    d.el.removeEventListener('pointercancel', onPointerUp);
    $('holdBox').classList.remove('over');
    d.el.classList.remove('dragging');
    d.el.style.position = '';
    for (const side of ['N', 'S']) if (colEls[side]) colEls[side].el.classList.remove('over');
    if (!d.active) {
      if (e.type === 'pointerup') openDetail(d.cs, d.el);
      tick(); return;
    }
    const x = e.clientX, y = e.clientY;
    if (inside($('holdBox'), x, y)) {
      if (!d.fromHold) engine.toHold(d.cs);
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
        engine.moveTo(d.cs, side, idx);
      }
    }
    // Label und Hold-Liste neu aufbauen lassen
    if (d.fromHold) { d.el.remove(); $('holdList').dataset.sig = ''; }
    for (const k of Object.keys(colEls)) { const c = colEls[k]; if (c.labels && c.labels[d.cs]) { c.labels[d.cs].remove(); delete c.labels[d.cs]; } }
    tick();
  }
  // ---------- Detail-Info ----------
  let detail = null; // { cs, anchor }
  function openDetail(cs, anchor) {
    if (detail && detail.cs === cs) { closeDetail(); return; }
    detail = { cs, anchor };
    $('detail').hidden = false;
    $('detail').dataset.sig = '';
    renderDetail();
    $('detail').focus({ preventScroll: true });
  }
  function closeDetail() {
    if (!detail) return;
    const a = detail.anchor;
    detail = null;
    $('detail').hidden = true;
    if (a && a.isConnected) a.focus({ preventScroll: true });
  }
  const mins = s => (s < 0 ? '-' : s > 0 ? '+' : '') + (Math.abs(s) / 60).toFixed(1) + ' min';
  function renderDetail() {
    if (!detail) return;
    const box = $('detail');
    const it = engine.last.byCs[detail.cs];
    if (!it) { closeDetail(); return; }
    const ctr = isCtrView(viewKey());
    const ed = canEdit();
    const rows = [];
    rows.push(['Typ', (it.type || '----') + ' / ' + (it.wtc || 'M')]);
    rows.push(['IAF', it.iaf + (it.passedIaf ? ' (passiert)' : '')]);
    rows.push(['Bahn', it.rwy + (it.manualRwy ? ' (manuell)' : '')]);
    if (ctr) {
      rows.push(['ETA IAF', it.etaIaf ? hhmm(it.etaIaf) : '--:--']);
      rows.push(['STA IAF', it.staIaf ? hhmm(it.staIaf) : '--:--']);
      rows.push(['Verlieren', mins(it.delayIaf || 0)]);
      rows.push(['davon CTR', (it.ctrStrokes || 0) + ' min']);
    } else {
      rows.push(['ETA', hhmm(it.eta)]);
      rows.push(['STA', it.hold ? 'im Hold' : hhmm(it.sta)]);
      rows.push(['Delay', it.hold ? '-' : mins(it.delay)]);
      if (!it.passedIaf && it.etaIaf) rows.push(['ETA IAF', hhmm(it.etaIaf) + (it.ctrStrokes ? ', CTR ' + it.ctrStrokes + ' min' : '')]);
      if (it.gapToPrev != null && !it.hold) rows.push(['Abstand vorn', (it.gapToPrev / 60).toFixed(1) + ' min']);
    }
    rows.push(['Restweg', Math.round(it.remainingNm) + ' NM']);
    if (it.locked) rows.push(['Platzierung', 'manuell']);
    const sig = JSON.stringify(rows) + ed + ctr;
    if (box.dataset.sig !== sig) {
      box.dataset.sig = sig;
      let h = '<div class="detail-head"><strong>' + it.cs + '</strong><button type="button" class="btn-small" data-act="close" aria-label="Schliessen">X</button></div><dl>';
      for (const [k, v] of rows) h += '<dt>' + k + '</dt><dd>' + v + '</dd>';
      h += '</dl>';
      if (ed && !ctr) {
        const other = it.side === 'N' ? 'S' : 'N';
        h += '<div class="detail-acts">';
        h += it.hold
          ? '<button type="button" class="btn-small" data-act="seq">EINPLANEN ' + (it.side === 'N' ? 'NORD' : 'SUED') + '</button>'
          : '<button type="button" class="btn-small" data-act="hold">INS HOLD</button>';
        h += '<button type="button" class="btn-small" data-act="swap">AUF ' + (other === 'N' ? 'NORD' : 'SUED') + '</button>';
        if (it.locked || it.manualRwy) h += '<button type="button" class="btn-small" data-act="unlock">AUTOMATIK</button>';
        h += '</div>';
      }
      box.innerHTML = h;
    }
    placeDetail();
  }
  function placeDetail() {
    const box = $('detail'), a = detail && detail.anchor;
    if (!a || !a.isConnected) {
      const l = document.querySelector('.label[data-cs="' + (detail && detail.cs) + '"], #holdList li[data-cs="' + (detail && detail.cs) + '"]');
      if (l) detail.anchor = l; else return;
    }
    const r = detail.anchor.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = r.left + r.width / 2 - bw / 2;
    left = Math.max(8, Math.min(vw - bw - 8, left));
    let top = r.bottom + 6;
    if (top + bh > vh - 8) top = Math.max(8, r.top - bh - 6);
    box.style.left = left + 'px'; box.style.top = top + 'px';
  }
  function detailAction(act) {
    if (!detail) return;
    const cs = detail.cs, it = engine.last.byCs[cs];
    if (act === 'close') { closeDetail(); return; }
    if (!it || !canEdit()) return;
    if (act === 'hold') engine.toHold(cs);
    else if (act === 'seq') engine.insertByEta(cs, it.side);
    else if (act === 'swap') engine.insertByEta(cs, it.side === 'N' ? 'S' : 'N');
    else if (act === 'unlock') engine.unlock(cs);
    $('holdList').dataset.sig = '';
    $('detail').dataset.sig = '';
    tick();
  }

  function inside(el, x, y) { const r = el.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }

  // ---------- Bedienung ----------
  function bindUi() {
    $('btnRwy').addEventListener('click', () => {
      const order = ['auto', '26', '08'];
      engine.state.dir = order[(order.indexOf(engine.state.dir) + 1) % order.length];
      for (const a of Object.values(engine.state.ac)) a.sMin = 0;
      save(); tick();
    });
    $('len').addEventListener('input', e => { engine.state.timelineMin = +e.target.value; save(); tick(); });
    $('btnRecompute').addEventListener('click', () => { engine.recompute(); tick(); });
    $('btnMenu').addEventListener('click', openSheet);
    $('btnClose').addEventListener('click', () => { $('sheet').hidden = true; });
    $('sheet').addEventListener('click', e => { if (e.target === $('sheet')) $('sheet').hidden = true; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('sheet').hidden = true; closeDetail(); } });
    $('detail').addEventListener('click', e => { const b = e.target.closest('button[data-act]'); if (b) detailAction(b.dataset.act); });
    document.addEventListener('pointerdown', e => {
      if (!detail || e.target.closest('#detail') || e.target.closest('.label') || e.target.closest('#holdList li')) return;
      closeDetail();
    });

    $('selSource').addEventListener('change', e => { settings.source = e.target.value; save(); startSource(); syncSheet(); });
    $('selView').addEventListener('change', e => { settings.view = e.target.value; save(); tick(); });
    $('selTheme').addEventListener('change', e => { settings.theme = e.target.value; applyTheme(); save(); });
    $('selGs').addEventListener('change', e => { engine.state.finalGsMode = e.target.value; save(); tick(); });
    $('rateN').addEventListener('change', e => { engine.state.rate.N = clampRate(e.target.value); save(); tick(); });
    $('rateS').addEventListener('change', e => { engine.state.rate.S = clampRate(e.target.value); save(); tick(); });
    $('btnAddClosure').addEventListener('click', () => {
      if (!canEdit()) return;
      const from = nowSec() + 60 * Math.max(0, +$('clFrom').value || 0);
      const to = nowSec() + 60 * Math.max(1, +$('clTo').value || 20);
      const sides = $('clSide').value === 'B' ? ['N', 'S'] : [$('clSide').value];
      sides.forEach(s => engine.addClosure(s, from, to));
      save(); tick(); syncSheet();
    });
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
    window.addEventListener('resize', () => { curView = null; closeDetail(); tick(); });
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
    ['selGs', 'rateN', 'rateS', 'clSide', 'clFrom', 'clTo', 'btnAddClosure'].forEach(id => { $(id).disabled = !ed; });
    const ul = $('clList'); ul.innerHTML = '';
    for (const c of engine.state.closures) {
      if (c.to < nowSec()) continue;
      const li = document.createElement('li');
      li.textContent = (c.side === 'N' ? 'Nord ' : 'Sued ') + hhmm(c.from) + ' bis ' + hhmm(c.to);
      if (ed) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn-small'; b.textContent = 'AUFHEBEN';
        b.addEventListener('click', () => { engine.removeClosure(c.id); save(); tick(); syncSheet(); });
        li.appendChild(b);
      }
      ul.appendChild(li);
    }
  }
})();
