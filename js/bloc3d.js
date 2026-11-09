/* « Bloc 3D pour BridgeSketch 3D » (v0.7.2) : l'utilisateur délimite un rectangle sur la carte, QuickerAtlas extrait le MNT
   (et le MNS) du MNEHR 1 m de RNCan, l'imagerie Esri et les tracés OpenStreetMap, détecte des zones (eau, forêt, route)
   par la couleur de l'imagerie, laisse corriger ces zones et placer l'axe du pont, puis envoie le tout à BridgeSketch 3D
   (postMessage ou fichier .bs3dterrain). Contrat du paquet : docs/bs3d-terrain-v1.md.
   Module chargé à la demande (js/lidar.js et js/bloc3d-calc.js d'abord). Contrat : window.QA_MOD.bloc3d.open(map, o, opt).
   Les calculs purs sont dans js/bloc3d-calc.js (testés par tests/js/bloc3d_calc.mjs). ES5. */
(function(){
  'use strict';
  window.QA_MOD = window.QA_MOD || {};
  var QA = window.QA, C = window.QA_MOD.bloc3dCalc, GEO = window.QA_MOD.lidar._geo, esc = QA.esc, fetchT = QA.fetchT, L = window.L;
  var $ = function(s){ return document.querySelector(s); };
  var BS3D_URL = 'https://acheruel.github.io/BridgeSketch-3D/', OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  // Types de zones : palette sûre pour le daltonisme (Okabe-Ito) doublée d'un libellé et d'un style de trait (plein / tirets / pointillé)
  var TYPES = {
    river: { name: 'Cours d’eau', color: '#0072B2', dash: null, fill: 0.34, poly: true },
    water: { name: 'Plan d’eau', color: '#56B4E9', dash: '7 4', fill: 0.34, poly: true },
    forest: { name: 'Forêt', color: '#009E73', dash: '2 5', fill: 0.3, poly: true },
    grass: { name: 'Herbe', color: '#F0E442', dash: '8 3 2 3', fill: 0.25, poly: true }, // v0.7.3 : masque manuel, aussi éditable dans BS3D
    road: { name: 'Route', color: '#E69F00', dash: null, fill: 0, poly: false }
  };
  var SRC = { osm: 'OSM', auto: 'auto', user: 'manuel' };
  var S = { map: null, o: null, bs3d: false, mode: 'select', rect: null, rectL: null, handles: [], drawing: false, run: 0, data: null, zones: [], axis: null, axisSrc: null,
    sel: null, zl: {}, vh: [], tool: null, svg: null, panel: null, nextId: 1, steps: [], status: null, sending: null };

  // ---------- Outils ----------
  function bs3dUrl(){
    var u = null;
    try { u = localStorage.getItem('qa-bs3d-url'); } catch (e) { /* stockage indisponible */ }
    return (u || BS3D_URL).replace(/#.*$/, '');
  }
  function fmt(n){ return QA.nf.format(Math.round(n)); }
  function structName(o){ return o.nom || ('Structure ' + o.num + (o.route ? ' (' + o.route + ')' : '')); }
  function F(){ return S.data ? S.data.F : S.blk.F; }
  function ll(p){ var q = C.toLatLon(F(), p[0], p[1]); return [q[0], q[1]]; }
  function loc(latlng){ return C.toLocal(F(), latlng.lat, latlng.lng); }
  function clampLoc(p){
    var hw = S.blk.wM / 2, hh = S.blk.hM / 2;
    return [Math.max(-hw, Math.min(hw, p[0])), Math.max(-hh, Math.min(hh, p[1]))];
  }
  function wait(ms){ return new Promise(function(res){ setTimeout(res, ms); }); }
  function sizeText(){
    if (!S.blk) return 'Aucun rectangle : cliquez « Dessiner un rectangle », puis glissez sur la carte.';
    var g = S.grid, n = g.cols * g.rows;
    return fmt(S.blk.wM) + ' × ' + fmt(S.blk.hM) + ' m · pas ' + g.cell + ' m · ' + fmt(n) + ' cellules (' + QA.nf1.format(n * 4 / 1048576) + ' Mo par grille)';
  }
  function setBlock(r){
    S.rect = r; S.blk = C.blockFromBounds(r.s, r.w, r.n, r.e); S.grid = C.gridFor(S.blk.wM, S.blk.hM);
  }

  // ---------- Panneau et bandeau ----------
  function build(map){
    S.map = map;
    if (!map.getPane('b3dPane')) map.createPane('b3dPane').style.zIndex = 405;
    S.svg = L.svg({ pane: 'b3dPane' });
    var wrap = $('#view-carte');
    var p = document.createElement('aside');
    p.id = 'b3d-panel'; p.className = 'b3d'; p.setAttribute('aria-label', 'Export vers Bridge Sketch 3D'); p.hidden = true;
    wrap.appendChild(p);
    L.DomEvent.disableClickPropagation(p); L.DomEvent.disableScrollPropagation(p);
    p.addEventListener('click', onPanelClick);
    p.addEventListener('change', onPanelChange);
    p.addEventListener('keydown', function(e){ if (e.key === 'Enter' && e.target.id === 'b3d-num') { e.preventDefault(); goNum(); } });
    S.panel = p;
    document.addEventListener('keydown', function(e){
      if (e.key !== 'Escape' || p.hidden) return;
      if (S.drawing) endDrawRect(true); else if (S.tool) cancelTool(); else if (S.sel) select(null);
    });
  }
  function banner(on){
    var b = $('#b3d-banner');
    if (!on) { if (b) b.remove(); return; }
    if (b) return;
    b = document.createElement('div'); b.id = 'b3d-banner'; b.className = 'b3d-banner'; b.setAttribute('role', 'status');
    b.innerHTML = '<div><b>Mode BridgeSketch 3D.</b> Trouvez votre ouvrage (recherche ou n° de structure ci-contre), <b>délimitez un bloc</b> sur la carte, vérifiez les zones détectées et l’axe du pont, puis cliquez <b>« Envoyer vers BridgeSketch 3D »</b> : le terrain arrive directement dans la fenêtre BridgeSketch 3D qui vous a ouvert cette page.</div>' +
      '<button type="button" aria-label="Masquer ce message" title="Masquer">×</button>';
    b.querySelector('button').addEventListener('click', function(){ b.remove(); });
    $('#view-carte').appendChild(b);
  }
  function render(){
    var p = S.panel, h = '<div class="b3d-head"><div><b>Export vers Bridge Sketch 3D</b><small>Préparer le site · définir le pont et corriger les zones dans BS3D</small></div>' +
      '<button type="button" class="b3d-x" data-act="close" aria-label="Fermer" title="Fermer">×</button></div><div class="b3d-body">';
    if (S.mode === 'select') h += selectHtml();
    else if (S.mode === 'busy') h += busyHtml();
    else h += editHtml();
    p.innerHTML = h + '</div>' + (S.mode === 'edit' ? footHtml() : '') + (S.status ? '<div class="b3d-status ' + S.status.kind + '" role="status">' + S.status.html + '</div>' : '');
    if (S.mode === 'edit') drawThumb();
    p.hidden = false;
    if (S.map) S.map.getContainer().classList.toggle('b3d-busy', S.drawing || !!S.tool);
  }
  function selectHtml(){
    var o = S.o;
    return '<p class="b3d-lead">Choisissez l’endroit, délimitez un rectangle (côté ≤ 1,5 km), puis extrayez le relief. Le fond <b>Satellite</b> aide à repérer l’ouvrage.</p>' +
      '<div class="b3d-f"><label for="b3d-num">Structure du MTMD (n°)</label><div class="b3d-row"><input id="b3d-num" type="text" inputmode="text" autocomplete="off" placeholder="ex. 13891" value="' + esc(o ? o.num : '') + '"><button type="button" data-act="go">Aller</button></div></div>' +
      (o ? '<p class="b3d-struct"><b>N° ' + esc(o.num) + '</b> · ' + esc(structName(o)) + (o.obstacle ? ' <small>au-dessus de ' + esc(o.obstacle) + '</small>' : '') + '</p>' : '<p class="b3d-struct muted">Aucune structure choisie : vous pourrez placer l’axe du pont vous-même.</p>') +
      '<div class="b3d-row b3d-wrap"><button type="button" data-act="draw" aria-pressed="' + S.drawing + '">' + (S.drawing ? 'Glissez sur la carte…' : 'Dessiner un rectangle') + '</button></div>' +
      '<div class="b3d-f"><span class="b3d-lbl">Ou un carré centré ' + (o ? 'sur la structure' : 'sur la carte') + '</span><div class="b3d-row b3d-wrap">' +
      [300, 600, 1000, 1500].map(function(s){ return '<button type="button" data-act="sq" data-s="' + s + '">' + (s >= 1000 ? QA.nf1.format(s / 1000) + ' km' : s + ' m') + '</button>'; }).join('') + '</div></div>' +
      '<p class="b3d-read" id="b3d-read" aria-live="polite">' + esc(sizeText()) + '</p>' +
      '<label class="b3d-chk"><input type="checkbox" id="b3d-mns" checked><span>Inclure le MNS (surface : arbres, bâtiments, tabliers)</span></label>' +
      '<button type="button" class="b3d-pri" data-act="extract"' + (S.rect ? '' : ' disabled') + '>Extraire le bloc</button>' +
      '<p class="b3d-note">Une extraction télécharge de 5 à 25 Mo (RNCan, Esri, OpenStreetMap) et prend de 10 à 60 secondes (OpenStreetMap est parfois lent : on peut continuer sans lui).</p>';
  }
  function busyHtml(){
    return '<p class="b3d-lead">Extraction du bloc ' + esc(sizeText()) + '</p><ul class="b3d-steps">' + S.steps.map(function(s){
      return '<li class="' + s.state + '"><span class="b3d-ic" aria-hidden="true">' + ({ run: '<i class="b3d-spin"></i>', ok: '✓', warn: '!', err: '✗', wait: '·' }[s.state]) + '</span><span>' + esc(s.label) + (s.note ? '<small>' + esc(s.note) + '</small>' : '') + '</span></li>';
    }).join('') + '</ul><div class="b3d-row b3d-wrap"><button type="button" data-act="cancel">Annuler</button>' +
      (S.steps.some(function(s){ return s.id === 'osm' && s.state === 'run'; }) ? '<button type="button" data-act="skiposm" title="OpenStreetMap répond lentement : continuer avec l’imagerie et le LiDAR seulement">Continuer sans OpenStreetMap</button>' : '') + '</div>';
  }
  function zoneRow(z){
    var T = TYPES[z.type], n = z.polygon ? z.polygon.length : z.line.length, len = z.line ? lineLen(z.line) : 0;
    var sw = z.type === 'road'
      ? '<svg viewBox="0 0 22 14" width="22" height="14" aria-hidden="true"><path d="M1 11 11 3 21 9" stroke="' + T.color + '" stroke-width="4" fill="none" stroke-linecap="round"/></svg>'
      : '<svg viewBox="0 0 22 14" width="22" height="14" aria-hidden="true"><rect x="2" y="2" width="18" height="10" rx="2" fill="' + T.color + '" fill-opacity="' + (T.fill + 0.2) + '" stroke="' + T.color + '" stroke-width="2"' + (T.dash ? ' stroke-dasharray="' + T.dash + '"' : '') + '/></svg>';
    var typ = z.polygon ? '<select data-act="type" aria-label="Type de la zone">' + ['river', 'water', 'forest', 'grass'].map(function(k){ return '<option value="' + k + '"' + (k === z.type ? ' selected' : '') + '>' + TYPES[k].name + '</option>'; }).join('') + '</select>'
      : '<span class="b3d-zn">Route</span><label class="b3d-w">larg. <input type="number" min="3" max="25" step="0.5" value="' + z.width + '" data-act="width" aria-label="Largeur de la route en mètres"> m</label>';
    return '<li class="b3d-z' + (S.sel === z.id ? ' sel' : '') + '" data-id="' + z.id + '"><span class="b3d-sw">' + sw + '</span><span class="b3d-zm">' + typ +
      '<small>' + SRC[z.source] + ' · ' + (z.polygon ? fmt(C.polygonArea(z.polygon)) + ' m²' : fmt(len) + ' m') + ' · ' + n + ' pts</small></span>' +
      '<button type="button" data-act="sel" aria-pressed="' + (S.sel === z.id) + '" title="Modifier les sommets sur la carte">Modifier</button>' +
      '<button type="button" class="b3d-del" data-act="del" aria-label="Supprimer la zone" title="Supprimer la zone">Supprimer</button></li>';
  }
  function lineLen(l){ var s = 0; for (var i = 0; i + 1 < l.length; i++) s += Math.hypot(l[i + 1][0] - l[i][0], l[i + 1][1] - l[i][1]); return s; }
  function axisText(){
    if (!S.axis) return 'Axe non placé.';
    var a = S.axis, dx = a[1][0] - a[0][0], dy = a[1][1] - a[0][1], az = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    return 'Longueur ' + QA.nf1.format(Math.hypot(dx, dy)) + ' m · azimut ' + fmt(az) + '°' + (S.axisSrc ? ' · ' + S.axisSrc : '');
  }
  function editHtml(){
    var d = S.data, tool = S.tool;
    var h = '<div class="b3d-thumbwrap"><canvas id="b3d-thumb" width="10" height="10" aria-label="Relief ombré du MNT"></canvas><div class="b3d-ts"><b>' + esc(sizeText()) + '</b><br>' +
      'MNT : ' + fmt(d.fin * 100) + ' % de cellules valides' + (isFinite(d.zmin) ? ', altitude ' + QA.nf1.format(d.zmin) + ' à ' + QA.nf1.format(d.zmax) + ' m' : '') + '<br>' +
      (d.mns ? 'MNS : ' + fmt(d.finS * 100) + ' %' : 'MNS : absent') + ' · Imagerie : ' + (d.jpeg ? 'oui' : 'absente') + ' · OSM : ' + (d.osmOk ? 'oui' : 'absent') + '</div></div>';
    if (d.warns.length) h += '<ul class="b3d-warns">' + d.warns.map(function(w){ return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>';
    if (tool && tool.kind === 'draw') {
      h += '<div class="b3d-tool"><b>Tracé : ' + TYPES[tool.type].name + '</b><p>Cliquez les sommets sur la carte (' + tool.pts.length + ' placé' + (tool.pts.length > 1 ? 's' : '') + ', ' + (TYPES[tool.type].poly ? '3' : '2') + ' au moins). Double-clic ou « Terminer » pour finir, Échap pour annuler.</p>' +
        '<div class="b3d-row"><button type="button" class="b3d-pri" data-act="finish"' + (tool.pts.length >= (TYPES[tool.type].poly ? 3 : 2) ? '' : ' disabled') + '>Terminer</button><button type="button" data-act="canceltool">Annuler</button></div></div>';
    } else if (tool && tool.kind === 'axis') {
      h += '<div class="b3d-tool"><b>Axe du pont</b><p>' + (tool.pts.length ? 'Cliquez la <b>fin</b> du pont (culée est de préférence).' : 'Cliquez le <b>début</b> du pont (culée ouest de préférence).') + ' Échap pour annuler.</p>' +
        '<div class="b3d-row"><button type="button" data-act="canceltool">Annuler</button></div></div>';
    } else {
      h += '<div class="b3d-sec"><div class="b3d-h">Zones (' + S.zones.length + ')</div>' +
        // v0.7.3 : zones regroupées par famille (repliables, compteur) ; la famille de la zone choisie reste ouverte
        (S.zones.length ? Object.keys(TYPES).map(function(k){
          var zs = S.zones.filter(function(z){ return z.type === k; });
          return zs.length ? '<details class="b3d-fam"' + (zs.some(function(z){ return z.id === S.sel; }) ? ' open' : '') + '><summary>' + TYPES[k].name + ' (' + zs.length + ')</summary><ul class="b3d-zl">' + zs.map(zoneRow).join('') + '</ul></details>' : '';
        }).join('') :'<p class="muted">Aucune zone détectée. Ajoutez-en avec les boutons ci-dessous.</p>') +
        '<div class="b3d-row b3d-wrap"><span class="b3d-lbl">Ajouter</span>' + ['river', 'water', 'forest', 'grass', 'road'].map(function(k){ return '<button type="button" data-act="add" data-t="' + k + '">' + TYPES[k].name + '</button>'; }).join('') + '</div>' +
        '<p class="b3d-note">Correction facultative ici : les zones restent modifiables dans BS3D. Sélectionnez « Modifier » (ou cliquez une zone) pour déplacer ses sommets ; clic sur un petit point intermédiaire = nouveau sommet ; double-clic sur un sommet = le retirer.</p></div>' +
        '<div class="b3d-sec"><div class="b3d-h">Axe du pont</div><p class="b3d-ax" id="b3d-ax">' + esc(axisText()) + '</p>' +
        '<div class="b3d-row b3d-wrap"><button type="button" data-act="axis">' + (S.axis ? 'Replacer l’axe (2 clics)' : 'Placer l’axe (2 clics)') + '</button>' + (S.axis ? '<button type="button" data-act="axisdel">Retirer l’axe</button>' : '') + '</div></div>';
    }
    return h;
  }
  // Pied du panneau (toujours visible, hors du défilement) : envoi, fichier, nouveau bloc
  function footHtml(){
    return '<div class="b3d-foot"><div class="b3d-row b3d-wrap"><button type="button" class="b3d-pri" data-act="send"' + (S.sending ? ' disabled' : '') + '>Envoyer vers BridgeSketch 3D</button>' +
      '<button type="button" data-act="download">Télécharger .bs3dterrain</button><button type="button" data-act="again">Nouveau bloc</button></div>' +
      '<p class="b3d-note">' + (S.bs3d ? 'Mode BridgeSketch 3D : l’envoi se fait vers la fenêtre qui a ouvert cette page.' : 'L’envoi ouvre BridgeSketch 3D dans un nouvel onglet ; le fichier .bs3dterrain s’ouvre depuis « IMPORT MNT/MNS » › Ouvrir un fichier.') + '</p></div>';
  }
  function status(kind, html){ S.status = html ? { kind: kind, html: html } : null; var el = S.panel && S.panel.querySelector('.b3d-status'); if (el && html) { el.className = 'b3d-status ' + kind; el.innerHTML = html; } else render(); }
  function drawThumb(){
    var cv = $('#b3d-thumb'), d = S.data;
    if (!cv || !d) return;
    var hs = d.hs, ctx = cv.getContext('2d');
    cv.width = hs.w; cv.height = hs.h;
    var im = ctx.createImageData(hs.w, hs.h);
    for (var i = 0; i < hs.w * hs.h; i++) { im.data[i * 4] = hs.gray[i]; im.data[i * 4 + 1] = hs.gray[i]; im.data[i * 4 + 2] = hs.gray[i]; im.data[i * 4 + 3] = 255; }
    ctx.putImageData(im, 0, 0);
    cv.style.aspectRatio = hs.w + ' / ' + hs.h;
  }

  // ---------- Rectangle ----------
  function rectFrom(a, p){
    var am = C.merc(a.lat, a.lng), pm = C.merc(p.lat, p.lng), kk = 1 / Math.cos((a.lat + p.lat) / 2 * Math.PI / 180), lim = C.MAX_SIDE * kk;
    var dx = Math.max(-lim, Math.min(lim, pm[0] - am[0])), dy = Math.max(-lim, Math.min(lim, pm[1] - am[1])), q = C.unmerc(am[0] + dx, am[1] + dy), A = C.unmerc(am[0], am[1]);
    return { s: Math.min(A[0], q[0]), n: Math.max(A[0], q[0]), w: Math.min(A[1], q[1]), e: Math.max(A[1], q[1]) };
  }
  function squareAround(lat, lon, side){
    var m = C.merc(lat, lon), k = 1 / Math.cos(lat * Math.PI / 180), h = side / 2 * k, a = C.unmerc(m[0] - h, m[1] - h), b = C.unmerc(m[0] + h, m[1] + h);
    return { s: a[0], w: a[1], n: b[0], e: b[1] };
  }
  function corners(r){ return [[r.s, r.w], [r.n, r.w], [r.n, r.e], [r.s, r.e]]; }
  function showRect(r, editable){
    setBlock(r);
    var map = S.map, b = [[r.s, r.w], [r.n, r.e]];
    if (!S.rectL) {
      S.rectL = L.rectangle(b, { pane: 'b3dPane', renderer: S.svg, color: '#102d41', weight: 2.5, dashArray: '8 5', fillColor: '#102d41', fillOpacity: 0.05, interactive: false }).addTo(map);
      S.rectL.bindTooltip('', { permanent: true, direction: 'top', className: 'b3d-tip', offset: [0, -2] });
    } else S.rectL.setBounds(b);
    S.rectL.setTooltipContent(fmt(S.blk.wM) + ' × ' + fmt(S.blk.hM) + ' m');
    handles(editable ? r : null);
    var el = $('#b3d-read'); if (el) el.textContent = sizeText();
    var bt = S.panel.querySelector('[data-act=extract]'); if (bt) bt.disabled = false;
  }
  function handles(r){
    S.handles.forEach(function(m){ S.map.removeLayer(m); });
    S.handles = [];
    if (!r) return;
    var icon = function(c){ return L.divIcon({ className: 'b3d-hw', html: '<span class="' + c + '"></span>', iconSize: [18, 18], iconAnchor: [9, 9] }); };
    var cs = corners(r);
    cs.forEach(function(c, i){
      var m = L.marker(c, { draggable: true, icon: icon('b3d-hc'), keyboard: false, title: 'Glisser pour redimensionner', zIndexOffset: 800 }).addTo(S.map);
      m.on('drag', function(){
        var o = cs[(i + 2) % 4], nr = rectFrom({ lat: o[0], lng: o[1] }, m.getLatLng());
        setBlock(nr); S.rectL.setBounds([[nr.s, nr.w], [nr.n, nr.e]]); S.rectL.setTooltipContent(fmt(S.blk.wM) + ' × ' + fmt(S.blk.hM) + ' m');
        var rd = $('#b3d-read'); if (rd) rd.textContent = sizeText();
        corners(nr).forEach(function(cc, j){ if (j !== i) S.handles[j].setLatLng(cc); });
        S.handles[4].setLatLng([(nr.s + nr.n) / 2, (nr.w + nr.e) / 2]);
      });
      m.on('dragend', function(){ showRect(S.rect, true); });
      S.handles.push(m);
    });
    var mv = L.marker([(r.s + r.n) / 2, (r.w + r.e) / 2], { draggable: true, icon: icon('b3d-hm'), keyboard: false, title: 'Glisser pour déplacer le bloc', zIndexOffset: 800 }).addTo(S.map), start = null;
    mv.on('dragstart', function(){ var c = mv.getLatLng(); start = { m: C.merc(c.lat, c.lng), r: S.rect }; });
    mv.on('drag', function(){
      var c = mv.getLatLng(), cm = C.merc(c.lat, c.lng), dx = cm[0] - start.m[0], dy = cm[1] - start.m[1], r0 = start.r;
      var a = C.merc(r0.s, r0.w), b = C.merc(r0.n, r0.e), A = C.unmerc(a[0] + dx, a[1] + dy), Bq = C.unmerc(b[0] + dx, b[1] + dy);
      var nr = { s: A[0], w: A[1], n: Bq[0], e: Bq[1] };
      setBlock(nr); S.rectL.setBounds([[nr.s, nr.w], [nr.n, nr.e]]);
      corners(nr).forEach(function(cc, j){ S.handles[j].setLatLng(cc); });
    });
    mv.on('dragend', function(){ showRect(S.rect, true); });
    S.handles.push(mv);
  }
  function startDrawRect(){
    var map = S.map, c = map.getContainer(), a = null;
    S.drawing = true; render();
    map.dragging.disable();
    var pos = function(e){ return map.mouseEventToLatLng(e); };
    var down = function(e){
      if (e.button != null && e.button > 0) return;
      a = pos(e); e.preventDefault(); e.stopPropagation();
      try { c.setPointerCapture(e.pointerId); } catch (x) { /* capture indisponible */ }
    };
    var move = function(e){ if (a) showRect(rectFrom(a, pos(e)), false); };
    var up = function(e){
      if (!a) return;
      var r = rectFrom(a, pos(e)); a = null;
      if (C.merc(r.n, r.e)[0] - C.merc(r.s, r.w)[0] < 20 || C.merc(r.n, r.e)[1] - C.merc(r.s, r.w)[1] < 20) {     // simple clic : annulé
        if (S.rectL) { S.map.removeLayer(S.rectL); S.rectL = null; }
        S.rect = null; S.blk = null; endDrawRect(true); return;
      }
      showRect(r, true); endDrawRect(false);
    };
    S.drawFns = { down: down, move: move, up: up };
    c.addEventListener('pointerdown', down, true); c.addEventListener('pointermove', move, true); c.addEventListener('pointerup', up, true);
  }
  function endDrawRect(cancel){
    if (!S.drawing) return;
    var c = S.map.getContainer(), f = S.drawFns;
    c.removeEventListener('pointerdown', f.down, true); c.removeEventListener('pointermove', f.move, true); c.removeEventListener('pointerup', f.up, true);
    S.drawing = false; S.map.dragging.enable();
    if (cancel && !S.rectL) S.rect = null;
    render();
    if (S.rect && S.mode === 'select') { var rd = $('#b3d-read'); if (rd) rd.textContent = sizeText(); }
  }

  // ---------- Extraction ----------
  // Overpass : serveur public souvent saturé ou lent (AGENTS.md ; 28 s pour une requête minuscule le 2026-11-06). Le serveur principal
  // a 40 s et trois essais ; deux miroirs prennent le relais (12 s chacun, 1 s d'écart). « Continuer sans OpenStreetMap » abrège l'attente.
  function osmFetch(rc, F_){
    var s = C.unmerc(F_.cx - rc.hx, F_.cy - rc.hy), n = C.unmerc(F_.cx + rc.hx, F_.cy + rc.hy), q = C.overpassQuery(s[0], s[1], n[0], n[1]);
    var one = function(url, ms){ return fetchT(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, ms, 'json'); };
    var p = one(OVERPASS[0], 40000);
    [3000, 6000].forEach(function(d){ p = p.catch(function(){ return wait(d).then(function(){ return one(OVERPASS[0], 40000); }); }); });     // « at capacity » (502) : reprises espacées, comme le demande Overpass
    OVERPASS.slice(1).forEach(function(u){ p = p.catch(function(){ return wait(1000).then(function(){ return one(u, 12000); }); }); });
    var skip = new Promise(function(res, rej){ S.skipOsm = function(){ rej(new Error('abandonné par l’utilisateur')); }; });
    return Promise.race([p, skip]);
  }
  function step(id, state, note){
    var dt = S.t0 && state !== 'run' ? ' · ' + Math.round((performance.now() - S.t0) / 100) / 10 + ' s' : '';
    for (var i = 0; i < S.steps.length; i++) if (S.steps[i].id === id) { S.steps[i].state = state; if (note != null) S.steps[i].note = note + dt; }
    if (S.mode === 'busy') render();
  }
  function extract(){
    var run = ++S.run, blk = S.blk, F_ = blk.F, grid = S.grid, k = F_.k, wantMns = !!($('#b3d-mns') && $('#b3d-mns').checked), warns = [];
    var hx = grid.cols * grid.cell / 2 * k, hy = grid.rows * grid.cell / 2 * k, bbImg = [F_.cx - hx, F_.cy - hy, F_.cx + hx, F_.cy + hy], mg = 4 * k;
    var bbDem = [bbImg[0] - mg, bbImg[1] - mg, bbImg[2] + mg, bbImg[3] + mg], stepM = grid.cell * k;
    var W = grid.cols * grid.cell, H = grid.rows * grid.cell, sc = Math.min(2048 / Math.max(W, H), 2), nw = Math.max(64, Math.round(W * sc)), nh = Math.max(64, Math.round(H * sc));
    S.steps = [
      { id: 'dtm', label: 'MNT LiDAR 1 m (RNCan)', state: 'run' },
      { id: 'dsm', label: 'MNS LiDAR (surface)', state: wantMns ? 'wait' : 'ok', note: wantMns ? '' : 'non demandé' },
      { id: 'img', label: 'Imagerie satellite (Esri)', state: 'run' },
      { id: 'osm', label: 'Eau, forêts et routes (OpenStreetMap)', state: 'run' },
      { id: 'calc', label: 'Rééchantillonnage et détection des zones', state: 'wait' }
    ];
    S.mode = 'busy'; S.status = null; clearZoneLayers(); render();
    var t0 = S.t0 = performance.now();
    var tDem = GEO.wcsBox('dtm', bbDem, stepM, 90000).then(function(t){
      if (t.ok < 0.2) throw new Error('Pas de couverture LiDAR (MNEHR) à cet endroit.');
      step('dtm', 'ok', t.w + ' × ' + t.h + ' pixels'); return t;
    });
    var tMns = !wantMns ? Promise.resolve(null) : tDem.then(function(){ step('dsm', 'run'); return wait(1200); }).then(function(){ return GEO.wcsBox('dsm', bbDem, stepM, 90000); }).then(function(t){
      step('dsm', 'ok', t.w + ' × ' + t.h + ' pixels'); return t;
    }, function(e){ step('dsm', 'warn', 'indisponible (' + errText(e) + ')'); warns.push('MNS indisponible : la détection des arbres et des toits se fait sur la couleur seule.'); return null; });
    var tImg = GEO.imgBox(bbImg, nw, nh, 40000).then(function(im){ step('img', 'ok', im.w + ' × ' + im.h + ' pixels'); return im; },
      function(e){ step('img', 'warn', 'indisponible (' + errText(e) + ')'); warns.push('Imagerie indisponible : aucune zone détectée automatiquement, ni image dans le paquet.'); return null; });
    var tOsm = osmFetch({ hx: hx + mg, hy: hy + mg }, F_).then(function(j){ step('osm', 'ok', ((j && j.elements) || []).length + ' éléments'); return j; },
      function(e){ step('osm', 'warn', 'indisponible (' + errText(e) + ')'); warns.push('OpenStreetMap indisponible (Overpass surchargé ?) : zones détectées par la couleur de l’imagerie seulement. Relancez plus tard pour les tracés OSM.'); return null; });
    Promise.all([tDem, tMns, tImg, tOsm]).then(function(r){
      if (run !== S.run) return;
      step('calc', 'run'); return wait(30).then(function(){ return finish(run, r[0], r[1], r[2], r[3], warns, t0); });
    }).catch(function(e){
      if (run !== S.run) return;
      if (window.console) console.error(e);
      S.mode = 'select'; S.status = null; render();
      status('err', 'Échec de l’extraction : ' + esc(errText(e)) + '. Réessayez ou choisissez un bloc plus petit.');
    });
  }
  function errText(e){ return e && e.name === 'AbortError' ? 'délai dépassé' : (e && e.message) || 'réseau'; }
  function finish(run, dem, dsm, im, osmJson, warns, t0){
    if (run !== S.run) return;
    var blk = S.blk, F_ = blk.F, grid = S.grid, hw = grid.cols * grid.cell / 2, hh = grid.rows * grid.cell / 2, rc = { x0: -hw, y0: -hh, x1: hw, y1: hh };
    var mnt = C.resample(dem, F_, grid), mns = dsm ? C.resample(dsm, F_, grid) : null, fin = C.finiteFraction(mnt);
    if (fin < 0.2) throw new Error('le MNT ne couvre pas ce bloc');
    var osm = osmJson ? C.osmToZones(osmJson, F_, rc) : { zones: [], bridges: [] };
    var det = C.detect({ grid: grid, img: im ? { px: im.px, w: im.w, h: im.h } : null, mnt: mnt, mns: mns, osm: osm });
    var zones = osm.zones.concat(det.zones).map(function(z){
      var q = { id: S.nextId++, type: z.type, source: z.source };
      if (z.type === 'road') { q.line = z.line; q.width = Math.round((z.width || 7) * 2) / 2; q.lanes = z.lanes; q.oneway = z.oneway; q.bridge = z.bridge; } else q.polygon = z.polygon; // v0.7.3 : attributs OSM conservés
      return q;
    });
    var zmin = Infinity, zmax = -Infinity;
    for (var i = 0; i < mnt.length; i++) { var v = mnt[i]; if (v < zmin) zmin = v; if (v > zmax) zmax = v; }
    var jpeg = im && im.buf ? 'data:image/jpeg;base64,' + C.bytesToB64(new Uint8Array(im.buf)) : null;
    var attribution = ['MNEHR 1 m © RNCan (OGL-Canada)'];
    if (osmJson) attribution.push('OpenStreetMap contributors (ODbL)');
    if (jpeg) attribution.push('Esri World Imagery');
    var roads = osm.zones.filter(function(z){ return z.type === 'road'; }).map(function(z){ return z.line; });
    S.data = { im: im ? { px: im.px, w: im.w, h: im.h } : null, osmJson: osmJson, F: F_, grid: grid, mnt: mnt, mns: mns, jpeg: jpeg, osmOk: !!osmJson, osm: osm, fin: fin, finS: mns ? C.finiteFraction(mns) : 0, zmin: zmin, zmax: zmax, hs: C.hillshade(mnt, grid.cols, grid.rows, grid.cell, 340),
      attribution: attribution, warns: warns, det: det.stats, seconds: (performance.now() - t0) / 1000, imgSize: im ? [im.w, im.h] : null };
    S.zones = zones; S.sel = null; S.tool = null;
    // axe proposé : structure choisie, sinon à placer à la main
    S.axis = null; S.axisSrc = null;
    if (S.o && S.o.lat != null) {
      var p = C.toLocal(F_, S.o.lat, S.o.lon);
      if (Math.abs(p[0]) <= hw && Math.abs(p[1]) <= hh) {
        var len = Math.max(20, Math.min(300, S.o.ltb || S.o.long || 60)), sg = C.suggestAxis(p, osm.bridges, roads, len, 80);
        S.axis = sg.axis; S.axisSrc = { 'osm-pont': 'proposé d’après le pont OSM', 'osm-route': 'proposé d’après la route OSM', defaut: 'axe est-ouest par défaut : à ajuster' }[sg.from];
      } else warns.push('La structure choisie est hors du bloc : placez l’axe du pont vous-même.');
    }
    S.mode = 'edit'; S.status = null;
    drawZones(); drawAxis(); drawStructure();
    S.map.fitBounds([[S.rect.s, S.rect.w], [S.rect.n, S.rect.e]], { padding: [30, 30], animate: false });
    handles(null);
    render();
  }

  // ---------- Zones sur la carte ----------
  function zoneStyle(z){
    var T = TYPES[z.type], sel = S.sel === z.id;
    if (z.type === 'road') return { pane: 'b3dPane', renderer: S.svg, color: T.color, weight: sel ? 7 : 5, opacity: 0.95, lineCap: 'round', dashArray: null };
    return { pane: 'b3dPane', renderer: S.svg, color: sel ? '#102d41' : T.color, weight: sel ? 3 : 2, fillColor: T.color, fillOpacity: T.fill, dashArray: T.dash };
  }
  function clearZoneLayers(){
    Object.keys(S.zl).forEach(function(k){ S.map.removeLayer(S.zl[k]); });
    S.zl = {};
    clearVtx();
    if (S.axisL) { S.axisL.forEach(function(x){ S.map.removeLayer(x); }); S.axisL = null; }
    if (S.structL) { S.map.removeLayer(S.structL); S.structL = null; }
  }
  function zoneLatLngs(z){ return (z.polygon || z.line).map(ll); }
  function drawZones(){
    Object.keys(S.zl).forEach(function(k){ S.map.removeLayer(S.zl[k]); });
    S.zl = {};
    S.zones.forEach(function(z){
      var l = z.polygon ? L.polygon(zoneLatLngs(z), zoneStyle(z)) : L.polyline(zoneLatLngs(z), zoneStyle(z));
      l.bindTooltip(TYPES[z.type].name + ' (' + SRC[z.source] + ')', { sticky: true, className: 'b3d-tip' });
      l.on('click', function(e){ if (S.tool) return; L.DomEvent.stopPropagation(e); select(z.id); });
      l.addTo(S.map); S.zl[z.id] = l;
    });
  }
  function zoneById(id){ for (var i = 0; i < S.zones.length; i++) if (S.zones[i].id === id) return S.zones[i]; return null; }
  function refreshZone(z){ var l = S.zl[z.id]; if (l) { l.setLatLngs(zoneLatLngs(z)); l.setStyle(zoneStyle(z)); } }
  function select(id){
    var old = S.sel; S.sel = id;
    [old, id].forEach(function(i){ var z = i != null && zoneById(i); if (z) refreshZone(z); });
    clearVtx();
    if (id != null) { showVtx(zoneById(id)); if (S.zl[id]) S.zl[id].bringToFront(); }
    if (S.mode === 'edit') { render(); var row = S.panel.querySelector('.b3d-z.sel'); if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' }); }
  }
  function clearVtx(){ S.vh.forEach(function(m){ S.map.removeLayer(m); }); S.vh = []; }
  function showVtx(z){
    if (!z) return;
    var pts = z.polygon || z.line, closed = !!z.polygon, n = pts.length;
    var vIcon = L.divIcon({ className: 'b3d-hw', html: '<span class="b3d-hv"></span>', iconSize: [16, 16], iconAnchor: [8, 8] });
    var mIcon = L.divIcon({ className: 'b3d-hw', html: '<span class="b3d-hmid"></span>', iconSize: [12, 12], iconAnchor: [6, 6] });
    pts.forEach(function(p, i){
      var m = L.marker(ll(p), { draggable: true, icon: vIcon, keyboard: false, title: 'Glisser pour déplacer ; double-clic pour retirer', zIndexOffset: 700 }).addTo(S.map);
      m.on('drag', function(){ pts[i] = clampLoc(loc(m.getLatLng())); refreshZone(z); });
      m.on('dragend', function(){ z.source = 'user'; select(z.id); });
      m.on('dblclick', function(e){
        L.DomEvent.stop(e);
        if (pts.length <= (closed ? 3 : 2)) return;
        pts.splice(i, 1); z.source = 'user'; refreshZone(z); select(z.id);
      });
      S.vh.push(m);
    });
    for (var i = 0; i < (closed ? n : n - 1); i++) {
      (function(i){
        var a = pts[i], b = pts[(i + 1) % n], m = L.marker(ll([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]), { icon: mIcon, keyboard: false, title: 'Cliquer pour ajouter un sommet', zIndexOffset: 600 }).addTo(S.map);
        m.on('click', function(e){ L.DomEvent.stop(e); pts.splice(i + 1, 0, clampLoc(loc(m.getLatLng()))); z.source = 'user'; refreshZone(z); select(z.id); });
        S.vh.push(m);
      })(i);
    }
  }
  function deleteZone(id){
    var l = S.zl[id]; if (l) S.map.removeLayer(l);
    delete S.zl[id];
    S.zones = S.zones.filter(function(z){ return z.id !== id; });
    if (S.sel === id) { S.sel = null; clearVtx(); }
    render();
  }

  // ---------- Axe du pont et structure ----------
  function drawStructure(){
    if (S.structL) { S.map.removeLayer(S.structL); S.structL = null; }
    if (!S.o || S.o.lat == null) return;
    S.structL = L.circleMarker([S.o.lat, S.o.lon], { pane: 'b3dPane', renderer: S.svg, radius: 7, color: '#102d41', weight: 3, fillColor: '#fff', fillOpacity: 0.9, interactive: false }).addTo(S.map);
  }
  function drawAxis(){
    if (S.axisL) { S.axisL.forEach(function(x){ S.map.removeLayer(x); }); S.axisL = null; }
    if (!S.axis) return;
    var pts = S.axis, line = L.polyline(pts.map(ll), { pane: 'b3dPane', renderer: S.svg, color: '#D55E00', weight: 4, dashArray: '10 6', interactive: false }).addTo(S.map), out = [line];
    ['A', 'B'].forEach(function(t, i){
      var m = L.marker(ll(pts[i]), { draggable: true, keyboard: false, zIndexOffset: 900, title: (i ? 'Fin' : 'Début') + ' de l’axe : glisser pour ajuster',
        icon: L.divIcon({ className: 'b3d-hw', html: '<span class="b3d-ax-pt">' + t + '</span>', iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(S.map);
      m.on('drag', function(){ pts[i] = clampLoc(loc(m.getLatLng())); line.setLatLngs(pts.map(ll)); var el = $('#b3d-ax'); if (el) el.textContent = axisText(); });
      m.on('dragend', function(){ S.axisSrc = 'ajusté à la main'; var el = $('#b3d-ax'); if (el) el.textContent = axisText(); });
      out.push(m);
    });
    S.axisL = out;
  }

  // ---------- Outils de tracé (nouvelle zone, axe) ----------
  function startTool(kind, type){
    cancelTool(true);
    select(null);
    S.tool = { kind: kind, type: type, pts: [], prev: null };
    S.map.doubleClickZoom.disable();
    S.map.on('click', onToolClick); S.map.on('dblclick', onToolDbl);
    S.map.getContainer().style.cursor = 'crosshair';
    if (kind === 'axis') { S.axisBackup = [S.axis, S.axisSrc]; if (S.axisL) { S.axisL.forEach(function(x){ S.map.removeLayer(x); }); S.axisL = null; } }
    render();
  }
  function toolPreview(){
    var t = S.tool; if (!t) return;
    if (t.prev) t.prev.forEach(function(x){ S.map.removeLayer(x); });
    var col = t.kind === 'axis' ? '#D55E00' : TYPES[t.type].color, ls = t.pts.map(ll);
    t.prev = [L.polyline(t.type && TYPES[t.type].poly && ls.length > 2 ? ls.concat([ls[0]]) : ls, { pane: 'b3dPane', renderer: S.svg, color: col, weight: 3, dashArray: '5 5', interactive: false }).addTo(S.map)];
    ls.forEach(function(p){ t.prev.push(L.circleMarker(p, { pane: 'b3dPane', renderer: S.svg, radius: 4, color: '#fff', weight: 1.5, fillColor: col, fillOpacity: 1, interactive: false }).addTo(S.map)); });
  }
  function onToolClick(e){
    var t = S.tool; if (!t) return;
    var p = clampLoc(loc(e.latlng));
    t.pts.push(p);
    if (t.kind === 'axis' && t.pts.length === 2) { S.axis = t.pts.slice(); S.axisSrc = 'placé à la main'; endTool(); drawAxis(); render(); return; }
    toolPreview(); render();
  }
  function onToolDbl(){
    var t = S.tool; if (!t || t.kind !== 'draw') return;
    if (t.pts.length > 1) t.pts.pop();                  // le 2e clic du double-clic a déjà ajouté un sommet de trop
    finishTool();
  }
  function finishTool(){
    var t = S.tool; if (!t || t.kind !== 'draw') return;
    var T = TYPES[t.type];
    if (t.pts.length < (T.poly ? 3 : 2)) return;
    var z = { id: S.nextId++, type: t.type, source: 'user' };
    if (T.poly) z.polygon = t.pts.slice(); else { z.line = t.pts.slice(); z.width = 7; }
    S.zones.push(z);
    endTool(); drawZones(); select(z.id);
  }
  function endTool(){
    var t = S.tool;
    if (t && t.prev) t.prev.forEach(function(x){ S.map.removeLayer(x); });
    S.tool = null; S.axisBackup = null;
    S.map.off('click', onToolClick); S.map.off('dblclick', onToolDbl);
    S.map.doubleClickZoom.enable(); S.map.getContainer().style.cursor = '';
  }
  function cancelTool(silent){
    if (!S.tool) return;
    var bk = S.axisBackup;
    endTool();
    if (bk) { S.axis = bk[0]; S.axisSrc = bk[1]; drawAxis(); }
    if (!silent) render();
  }

  // ---------- Paquet et envoi ----------
  function packet(){
    var d = S.data;
    if (!d.imageObj && d.jpeg) d.imageObj = { dataUrl: d.jpeg, attribution: 'Esri World Imagery' };
    return C.buildPacket({
      frame: { lat: d.F.lat, lon: d.F.lon }, grid: d.grid, mnt: d.mnt, mns: d.mns, image: d.imageObj || null,
      zones: S.zones.map(function(z){ return { type: z.type, source: z.source, polygon: z.polygon, line: z.line, width: z.width, lanes: z.lanes, oneway: z.oneway, bridge: z.bridge }; }),
      bridge: S.axis ? { axis: S.axis, structure: S.o ? { id: String(S.o.num), name: structName(S.o) } : null } : null,
      attribution: d.attribution
    });
  }
  function fileName(){ return 'bloc-' + (S.o ? String(S.o.num).replace(/[^\w-]/g, '') : 'carte') + '-' + new Date().toISOString().slice(0, 10) + '.bs3dterrain'; }
  function download(){
    var p = packet(), errs = C.validatePacket(p);
    if (errs.length) { status('err', 'Paquet non conforme : ' + esc(errs.join(', '))); return; }
    var blob = new Blob([C.packetToJson(p)], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = fileName(); document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    status('ok', 'Fichier « ' + esc(fileName()) + ' » téléchargé (' + QA.nf1.format(blob.size / 1048576) + ' Mo). Dans BridgeSketch 3D : « IMPORT MNT/MNS » › Ouvrir un fichier.');
  }
  // v0.7.3 : accusé de réception de BridgeSketch 3D (0.6.9+) : « reçu et validé », « appliqué », « fermé » ou « erreur ».
  // Seuls les messages de la fenêtre destinataire et portant l'identifiant du transfert sont pris en compte.
  function listenAck(target, id, sent){
    if (S.ack) S.ack.stop();
    var timer, step = function(n){ return '<span class="b3d-ack">' + ['Envoyé', 'Reçu et validé', 'Appliqué'].map(function(t, i){ return '<span class="' + (i < n ? 'on' : '') + '">' + (i < n ? '✓ ' : '○ ') + t + '</span>'; }).join(' → ') + '</span>'; };
    var stop = function(){ clearTimeout(timer); window.removeEventListener('message', onAck); S.ack = null; };
    var onAck = function(ev){
      var d = ev.data;
      if (ev.source !== target || !d || d.type !== 'bs3d-terrain-ack' || d.id !== id) return;
      if (d.state === 'received') { clearTimeout(timer); status('ok', step(2) + '<br>BridgeSketch 3D a validé le paquet (' + (+d.zones || 0) + ' zone' + (d.zones > 1 ? 's' : '') + '). Définissez le pont dans sa boîte, puis « Créer le pont sur ce site ».'); }
      else if (d.state === 'applied') { stop(); status('ok', step(3) + '<br>Le site et le pont sont en place dans BridgeSketch 3D.'); }
      else if (d.state === 'closed') { stop(); status('busy', step(2) + '<br>La boîte de BridgeSketch 3D a été fermée sans appliquer le site. Renvoyez le bloc pour reprendre.'); }
      else if (d.state === 'error') { stop(); status('err', '✗ Refusé par BridgeSketch 3D : ' + esc(String(d.message || 'paquet invalide'))); }
    };
    window.addEventListener('message', onAck);
    timer = setTimeout(function(){ window.removeEventListener('message', onAck); S.ack = null; status('busy', step(1) + '<br>' + sent + ' Aucun accusé de réception en 15 s : version de BridgeSketch 3D sans accusé, ou onglet en arrière-plan. Vérifiez la fenêtre BridgeSketch 3D.'); }, 15000);
    S.ack = { stop: stop };
    return step(1);
  }
  function post(target, origin){
    var p = packet(), errs = C.validatePacket(p);
    if (errs.length) { status('err', 'Paquet non conforme : ' + esc(errs.join(', '))); return false; }
    var m = C.packetForPost(p), id = 'qa-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    m.message.transferId = id;
    var mo = (p.mnt.length + (p.mns ? p.mns.length : 0)) * 4 / 1048576,
      sent = 'Terrain envoyé (' + QA.nf1.format(mo) + ' Mo de grilles' + (p.image ? ' + image' : '') + ', ' + p.zones.length + ' zone' + (p.zones.length > 1 ? 's' : '') + (p.bridge ? ', axe du pont' : ', sans axe de pont') + ').';
    var head = listenAck(target, id, sent);
    target.postMessage(m.message, origin, m.transfer);
    status('ok', head + '<br>' + sent + ' En attente de l’accusé de réception de BridgeSketch 3D…');
    return true;
  }
  function send(){
    if (S.sending) return;
    // chemin 1 : BridgeSketch 3D nous a ouverts (?bs3d=1) -> window.opener.postMessage(paquet, '*')
    if (S.bs3d && window.opener && !window.opener.closed) { post(window.opener, '*'); return; }
    // chemin 2 : QuickerAtlas seul -> ouverture de BridgeSketch 3D (#terrain-import), attente de { type: 'bs3d-ready' }, puis envoi.
    // window.open reste dans le geste de l'utilisateur : il vient avant tout calcul.
    var url = bs3dUrl(), origin = '*';
    try { origin = new URL(url, location.href).origin; } catch (e) { /* adresse invalide : '*' */ }
    var w = window.open(url + '#terrain-import');
    if (!w) { status('err', 'Le navigateur a bloqué l’ouverture de BridgeSketch 3D. Autorisez les fenêtres surgissantes pour ce site, ou téléchargez le fichier .bs3dterrain.'); return; }
    var done = false, timer;
    var stop = function(){ done = true; clearTimeout(timer); window.removeEventListener('message', onMsg); S.sending = null; };
    var onMsg = function(ev){
      if (done || ev.source !== w || !ev.data || ev.data.type !== 'bs3d-ready') return;
      if (!(ev.origin === origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(ev.origin))) return;
      stop();
      post(w, origin === '*' ? ev.origin : origin);
      render();
    };
    window.addEventListener('message', onMsg);
    timer = setTimeout(function(){
      if (done) return;
      stop(); render();
      status('err', 'BridgeSketch 3D n’a pas répondu en 60 s (page lente, bloquée ou ancienne version sans import de terrain). Téléchargez le fichier .bs3dterrain et ouvrez-le dans BridgeSketch 3D (« IMPORT MNT/MNS » › Ouvrir un fichier).');
    }, 60000);
    S.sending = { stop: stop };
    status('busy', 'Ouverture de BridgeSketch 3D… en attente de sa réponse (60 s au plus).');
    render();
  }

  // ---------- Événements du panneau ----------
  function goNum(){
    var v = ($('#b3d-num').value || '').trim().toUpperCase(), o = v && QA.byNum(v);
    if (!o || o.lat == null) { status('err', 'Structure « ' + esc(v) + ' » introuvable (ou sans position).'); return; }
    S.o = o; S.status = null;
    showRect(squareAround(o.lat, o.lon, 600), true);
    S.map.fitBounds([[S.rect.s, S.rect.w], [S.rect.n, S.rect.e]], { padding: [40, 40] });
    render();
  }
  function onPanelClick(e){
    var b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
    var act = b.getAttribute('data-act'), row = b.closest('[data-id]'), id = row ? parseInt(row.getAttribute('data-id'), 10) : null;
    if (act === 'close') close();
    else if (act === 'go') goNum();
    else if (act === 'draw') { if (S.drawing) endDrawRect(true); else startDrawRect(); }
    else if (act === 'sq') {
      var c = S.o && S.o.lat != null ? { lat: S.o.lat, lng: S.o.lon } : S.map.getCenter();
      showRect(squareAround(c.lat, c.lng, parseInt(b.getAttribute('data-s'), 10)), true);
      S.map.fitBounds([[S.rect.s, S.rect.w], [S.rect.n, S.rect.e]], { padding: [40, 40] });
    }
    else if (act === 'extract') { if (S.rect) { endDrawRect(false); extract(); } }
    else if (act === 'skiposm') { if (S.skipOsm) S.skipOsm(); }
    else if (act === 'cancel') { S.run++; S.mode = 'select'; render(); handles(S.rect); }
    else if (act === 'sel') select(S.sel === id ? null : id);
    else if (act === 'del') deleteZone(id);
    else if (act === 'add') startTool('draw', b.getAttribute('data-t'));
    else if (act === 'finish') finishTool();
    else if (act === 'canceltool') cancelTool();
    else if (act === 'axis') startTool('axis', null);
    else if (act === 'axisdel') { S.axis = null; S.axisSrc = null; drawAxis(); render(); }
    else if (act === 'send') send();
    else if (act === 'download') download();
    else if (act === 'again') newBlock();
  }
  function onPanelChange(e){
    var t = e.target, act = t.getAttribute && t.getAttribute('data-act'), row = t.closest && t.closest('[data-id]');
    if (!act || !row) return;
    var z = zoneById(parseInt(row.getAttribute('data-id'), 10)); if (!z) return;
    if (act === 'type') { z.type = t.value; z.source = 'user'; refreshZone(z); if (S.zl[z.id]) S.zl[z.id].setTooltipContent(TYPES[z.type].name + ' (' + SRC[z.source] + ')'); render(); }
    else if (act === 'width') { var w = parseFloat(String(t.value).replace(',', '.')); z.width = isFinite(w) ? Math.max(3, Math.min(25, w)) : 7; z.source = 'user'; render(); }
  }
  function newBlock(){
    cancelTool(true); clearZoneLayers(); S.data = null; S.zones = []; S.axis = null; S.sel = null; S.mode = 'select'; S.status = null;
    render(); if (S.rect) showRect(S.rect, true);
  }
  function close(){
    S.run++; endDrawRect(true); cancelTool(true); clearZoneLayers(); handles(null);
    if (S.sending) S.sending.stop();
    if (S.rectL) { S.map.removeLayer(S.rectL); S.rectL = null; }
    S.rect = null; S.blk = null; S.data = null; S.zones = []; S.axis = null; S.sel = null; S.mode = 'select'; S.status = null;
    S.panel.hidden = true; S.map.getContainer().classList.remove('b3d-busy');
    if (S.prevFond && QA.fond) { QA.fond.set(S.prevFond); S.prevFond = null; }
  }

  // ---------- Ouverture ----------
  // o : structure (objet de l'atlas) ou null ; opt.bs3d : ouvert par BridgeSketch 3D (?bs3d=1)
  function open(map, o, opt){
    opt = opt || {};
    if (!S.panel) build(map);
    if (S.mode !== 'select' || S.data) { var pf = S.prevFond; S.prevFond = null; close(); S.prevFond = pf; }
    S.o = o || null; S.bs3d = !!opt.bs3d; S.status = null; S.mode = 'select';
    if (QA.fond && !S.prevFond) { S.prevFond = QA.fond.get(); QA.fond.set('Satellite'); }      // le tracé se fait sur l'imagerie satellite ; fond d'avant rétabli à la fermeture
    banner(S.bs3d);
    render();
    if (S.o && S.o.lat != null) {
      showRect(squareAround(S.o.lat, S.o.lon, 600), true);
      map.fitBounds([[S.rect.s, S.rect.w], [S.rect.n, S.rect.e]], { padding: [40, 40], animate: false });
      render();
    } else if (S.bs3d) startDrawRect();
  }
  window.QA_MOD.bloc3d = { open: open, close: close,
    // essais (console, script de contrôle) : état, paquet et fichier courants, rectangle et extraction programmatiques
    _t: { state: function(){ return S; }, packet: function(){ return packet(); }, json: function(){ return C.packetToJson(packet()); },
      setRect: function(s, w, n, e){ showRect({ s: s, w: w, n: n, e: e }, true); render(); showRect(S.rect, true); }, extract: extract, send: send, download: download } };
})();
