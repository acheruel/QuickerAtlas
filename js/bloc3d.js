/* « Export 3D » vers BridgeSketch 3D (v0.7.2 ; refait en v0.7.4) : onglet à part, à droite de « Ponts remarquables », avec sa
   propre carte satellite. On choisit un bloc, QuickerAtlas extrait le MNT et le MNS (MNEHR 1 m de RNCan), l'imagerie Esri et le
   masque des routes CanVec (RNCan), détecte peu de zones mais justes (eau et forêt par le LiDAR, herbe par la couleur, routes
   CanVec), puis envoie le tout à BridgeSketch 3D (postMessage ou fichier .bs3dterrain). Contrat : docs/bs3d-terrain-v1.md.
   v0.7.4 : plus d'OpenStreetMap (Overpass : 30 à 60 s et beaucoup de petites zones à supprimer) ; sélection multiple (clic,
   Maj + clic, cadre), déplacement à la souris, Suppr, Ctrl + Z.
   Module chargé à la demande (js/lidar.js et js/bloc3d-calc.js d'abord). Contrat : window.QA_MOD.bloc3d.show(host, o, opt).
   Les calculs purs sont dans js/bloc3d-calc.js (testés par tests/js/bloc3d_calc.mjs). ES5. */
(function(){
  'use strict';
  window.QA_MOD = window.QA_MOD || {};
  var QA = window.QA, C = window.QA_MOD.bloc3dCalc, GEO = window.QA_MOD.lidar._geo, esc = QA.esc, fetchT = QA.fetchT, L = window.L;
  var BS3D_URL = 'https://acheruel.github.io/BridgeSketch-3D/', CANVEC = 'https://maps.geogratis.gc.ca/wms/canvec_en';
  // Types de zones : palette sûre pour le daltonisme (Okabe-Ito) doublée d'un libellé et d'un style de trait (plein / tirets / pointillé)
  var TYPES = {
    river: { name: 'Cours d’eau', many: 'Cours d’eau', color: '#0072B2', dash: null, fill: 0.34, poly: true },
    water: { name: 'Plan d’eau', many: 'Plans d’eau', color: '#56B4E9', dash: '7 4', fill: 0.34, poly: true },
    forest: { name: 'Forêt', many: 'Forêts', color: '#009E73', dash: '2 5', fill: 0.3, poly: true },
    grass: { name: 'Herbe', many: 'Herbe', color: '#F0E442', dash: '8 3 2 3', fill: 0.25, poly: true },
    road: { name: 'Route', many: 'Routes', color: '#E69F00', dash: null, fill: 0, poly: false }
  };
  var ORDER = ['river', 'water', 'forest', 'grass', 'road'];
  var S = { host: null, map: null, side: null, bar: null, o: null, bs3d: false, mode: 'select', rect: null, blk: null, grid: null, rectL: null, handles: [], drawing: false, run: 0,
    data: null, zones: [], axis: null, axisSrc: null, sel: [], zl: {}, vh: [], tool: null, svg: null, nextId: 1, steps: [], status: null, sending: null, undo: [], box: false, dots: null, side0: 600, strip: true };
  var $ = function(s){ return S.host.querySelector(s); };

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
  function half(){ var g = S.data ? S.data.grid : S.grid; return [g.cols * g.cell / 2, g.rows * g.cell / 2]; }
  function clampLoc(p){ var h = half(); return [Math.max(-h[0], Math.min(h[0], p[0])), Math.max(-h[1], Math.min(h[1], p[1]))]; }
  function wait(ms){ return new Promise(function(res){ setTimeout(res, ms); }); }
  function plural(n, one, many){ return n + ' ' + (n > 1 ? many : one); }
  function sizeText(){
    if (!S.blk) return 'Aucun bloc : choisissez une structure, une taille, ou dessinez un rectangle.';
    var g = S.grid;
    return fmt(S.blk.wM) + ' × ' + fmt(S.blk.hM) + ' m · pas de ' + g.cell + ' m';
  }
  function setBlock(r){ S.rect = r; S.blk = C.blockFromBounds(r.s, r.w, r.n, r.e); S.grid = C.gridFor(S.blk.wM, S.blk.hM); }
  function pts(z){ return z.polygon || z.line; }
  function zoneById(id){ for (var i = 0; i < S.zones.length; i++) if (S.zones[i].id === id) return S.zones[i]; return null; }
  function isSel(id){ return S.sel.indexOf(id) >= 0; }
  function selZones(){ return S.zones.filter(function(z){ return isSel(z.id); }); }
  function lineLen(l){ var s = 0; for (var i = 0; i + 1 < l.length; i++) s += Math.hypot(l[i + 1][0] - l[i][0], l[i + 1][1] - l[i][1]); return s; }
  function typing(e){ var t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable); }

  // ---------- Construction de la vue (carte + volet) ----------
  function build(host, opt){
    S.host = host;
    host.innerHTML = '<div class="x3d-map" id="x3d-map" role="application" aria-label="Carte satellite de l’export 3D"></div>' +
      '<div class="x3d-bar" id="x3d-bar" role="toolbar" aria-label="Outils des zones" hidden></div>' +
      '<aside class="x3d-side" id="x3d-side" aria-label="Export vers BridgeSketch 3D"></aside>';
    S.side = $('#x3d-side'); S.bar = $('#x3d-bar');
    var map = S.map = L.map($('#x3d-map'), { boxZoom: false, zoomSnap: 0.5, maxZoom: 20, attributionControl: true }).setView(opt.center || [46.8, -71.2], opt.zoom || 7);
    L.tileLayer(QA.ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 18, maxZoom: 20, attribution: 'Imagerie © Esri, Maxar, Earthstar Geographics' }).addTo(map);
    L.tileLayer(QA.ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 18, maxZoom: 20, opacity: 0.9 }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    map.createPane('x3dPane').style.zIndex = 405;
    S.svg = L.svg({ pane: 'x3dPane' });
    S.dots = L.layerGroup().addTo(map);
    map.on('moveend', drawDots);
    map.on('click', function(){ if (!S.tool && S.mode === 'edit' && !S.justDragged) select([]); });
    S.side.addEventListener('click', onClick);
    S.bar.addEventListener('click', onClick);
    S.side.addEventListener('change', onChange);
    S.side.addEventListener('keydown', function(e){ if (e.key === 'Enter' && e.target.id === 'x3d-num') { e.preventDefault(); goNum(); } });
    L.DomEvent.disableClickPropagation(S.bar);
    document.addEventListener('keydown', onKey);
    wireMarquee();
  }
  // Structures du MTMD visibles (zoom ≥ 12) : un clic choisit l'ouvrage et place un bloc autour de lui
  function drawDots(){
    S.dots.clearLayers();
    if (S.mode !== 'select' || S.map.getZoom() < 12 || !QA.all) return;
    var b = S.map.getBounds().pad(0.05), n = 0, all = QA.all();
    for (var i = 0; i < all.length && n < 400; i++) {
      var o = all[i];
      if (o.lat == null || o.src || !b.contains([o.lat, o.lon])) continue;
      n++;
      (function(o){
        var cur = S.o && S.o.num === o.num;
        L.circleMarker([o.lat, o.lon], { radius: cur ? 8 : 6, color: '#102d41', weight: cur ? 3 : 2, fillColor: cur ? '#fde047' : '#fff', fillOpacity: 0.95 })
          .bindTooltip('N° ' + o.num + (o.nom ? ' · ' + o.nom : ''), { className: 'b3d-tip' })
          .on('click', function(e){ L.DomEvent.stopPropagation(e); if (S.drawing) return; setStructure(o, false); }).addTo(S.dots);
      })(o);
    }
  }
  function setStructure(o, fly){
    S.o = o; S.status = null;
    showRect(squareAround(o.lat, o.lon, S.side0), true);
    if (fly) S.map.fitBounds([[S.rect.s, S.rect.w], [S.rect.n, S.rect.e]], { padding: [60, 60], animate: false });
    render(); drawDots();
  }

  // ---------- Volet ----------
  function stepsHtml(){
    var n = S.mode === 'edit' ? 2 : 1;
    return '<ol class="x3d-steps">' + ['Bloc', 'Zones et axe', 'Envoi'].map(function(t, i){
      return '<li class="' + (i + 1 < n ? 'done' : i + 1 === n ? 'on' : '') + '"' + (i + 1 === n ? ' aria-current="step"' : '') + '><span>' + (i + 1 < n ? '✓' : i + 1) + '</span>' + t + '</li>';
    }).join('') + '</ol>';
  }
  function render(){
    if (!S.side) return;
    var h = '<div class="x3d-head"><b>Export vers BridgeSketch 3D</b><small>Terrain LiDAR, image satellite et zones du site, prêts pour le pont</small></div>' + stepsHtml() + '<div class="x3d-body">';
    if (S.bs3d && S.mode === 'select') h += '<p class="x3d-info"><b>Ouvert par BridgeSketch 3D.</b> Le terrain partira directement dans la fenêtre qui a ouvert cette page.</p>';
    if (S.mode === 'select') h += selectHtml();
    else if (S.mode === 'busy') h += busyHtml();
    else h += editHtml();
    h += '</div>' + (S.mode === 'edit' ? footHtml() : '') + (S.status ? '<div class="x3d-status ' + S.status.kind + '" role="status">' + S.status.html + '</div>' : '');
    S.side.innerHTML = h;
    if (S.mode === 'edit') drawThumb();
    renderBar();
    S.map.getContainer().classList.toggle('x3d-cross', S.drawing || !!S.tool || (S.box && S.mode === 'edit'));
  }
  function renderBar(){
    if (S.mode !== 'edit' || S.tool) { S.bar.hidden = true; return; }
    var n = S.sel.length;
    S.bar.hidden = false;
    S.bar.innerHTML =
      '<button type="button" data-act="box" aria-pressed="' + S.box + '" title="Glisser sur la carte pour encadrer plusieurs zones (ou Maj + glisser, sans ce bouton)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="1"/></svg>Cadre de sélection</button>' +
      '<button type="button" data-act="all" title="Tout sélectionner (Ctrl + A)">Tout</button>' +
      '<span class="x3d-sep" aria-hidden="true"></span>' +
      '<button type="button" class="x3d-danger" data-act="delsel"' + (n ? '' : ' disabled') + ' title="Supprimer la sélection (touche Suppr)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>Supprimer' + (n ? ' (' + n + ')' : '') + '</button>' +
      '<button type="button" data-act="undo"' + (S.undo.length ? '' : ' disabled') + ' title="Annuler la dernière modification (Ctrl + Z)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 5 3 10l5 5M3 10h11a6 6 0 0 1 0 12h-3"/></svg>Annuler</button>';
  }
  function selectHtml(){
    var o = S.o;
    return '<div class="x3d-f"><label for="x3d-num">Structure du MTMD</label><div class="x3d-row"><input id="x3d-num" type="text" autocomplete="off" placeholder="n°, ex. 13891" value="' + esc(o ? o.num : '') + '"><button type="button" data-act="go">Aller</button></div>' +
      '<small class="x3d-note">Ou cliquez un ouvrage (rond blanc) sur la carte, dès qu’on est assez près.</small></div>' +
      (o ? '<p class="x3d-struct"><b>N° ' + esc(o.num) + '</b> · ' + esc(structName(o)) + (o.obstacle ? ' <small>au-dessus de ' + esc(o.obstacle) + '</small>' : '') + '</p>' : '') +
      '<div class="x3d-f"><span class="x3d-lbl">Taille du bloc, centré ' + (o ? 'sur l’ouvrage' : 'sur la carte') + '</span><div class="x3d-seg">' +
      [300, 600, 1000, 1500].map(function(s){ var on = S.blk && Math.abs(S.blk.wM - s) < 2 && Math.abs(S.blk.hM - s) < 2; return '<button type="button" data-act="sq" data-s="' + s + '" aria-pressed="' + on + '">' + (s >= 1000 ? QA.nf1.format(s / 1000) + ' km' : s + ' m') + '</button>'; }).join('') + '</div>' +
      '<button type="button" class="x3d-link" data-act="draw" aria-pressed="' + S.drawing + '">' + (S.drawing ? 'Glissez sur la carte… (Échap pour annuler)' : 'ou dessiner un rectangle sur la carte') + '</button></div>' +
      '<p class="x3d-read" id="x3d-read" aria-live="polite">' + esc(sizeText()) + '</p>' +
      '<button type="button" class="x3d-pri x3d-big" data-act="extract"' + (S.rect ? '' : ' disabled') + '>Extraire le bloc</button>' +
      '<p class="x3d-note">Environ 5 secondes. Le bloc se déplace par sa croix centrale et se redimensionne par ses coins (côté ≤ 1,5 km).</p>';
  }
  function busyHtml(){
    return '<p class="x3d-lead">Extraction du bloc de ' + esc(sizeText()) + '</p><ul class="x3d-prog">' + S.steps.map(function(s){
      return '<li class="' + s.state + '"><span class="x3d-ic" aria-hidden="true">' + ({ run: '<i class="x3d-spin"></i>', ok: '✓', warn: '!', err: '✗', wait: '·' }[s.state]) + '</span><span>' + esc(s.label) + (s.note ? '<small>' + esc(s.note) + '</small>' : '') + '</span></li>';
    }).join('') + '</ul><div class="x3d-row"><button type="button" data-act="cancel">Annuler</button></div>';
  }
  function swatch(k){
    var T = TYPES[k];
    return k === 'road'
      ? '<svg viewBox="0 0 22 14" width="22" height="14" aria-hidden="true"><path d="M1 11 11 3 21 9" stroke="' + T.color + '" stroke-width="4" fill="none" stroke-linecap="round"/></svg>'
      : '<svg viewBox="0 0 22 14" width="22" height="14" aria-hidden="true"><rect x="2" y="2" width="18" height="10" rx="2" fill="' + T.color + '" fill-opacity="' + (T.fill + 0.2) + '" stroke="' + T.color + '" stroke-width="2"' + (T.dash ? ' stroke-dasharray="' + T.dash + '"' : '') + '/></svg>';
  }
  function axisText(){
    if (!S.axis) return 'Axe non placé : BridgeSketch 3D posera le pont au centre du bloc.';
    var a = S.axis, dx = a[1][0] - a[0][0], dy = a[1][1] - a[0][1], az = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    return 'Longueur ' + QA.nf1.format(Math.hypot(dx, dy)) + ' m · azimut ' + fmt(az) + '°' + (S.axisSrc ? ' · ' + S.axisSrc : '');
  }
  function selectionHtml(){
    var zs = selZones(), n = zs.length;
    if (!n) return '<p class="x3d-hint"><b>Cliquez</b> une zone pour la choisir, <b>Maj + clic</b> pour en ajouter. <b>Maj + glisser</b> (ou « Cadre de sélection ») en encadre plusieurs. Une zone choisie se <b>glisse</b> à la souris ; <b>Suppr</b> la supprime ; <b>Ctrl + Z</b> annule.</p>';
    var polys = zs.filter(function(z){ return z.polygon; }), roads = zs.filter(function(z){ return z.line; }), waters = zs.filter(function(z){ return z.type === 'water' || z.type === 'river'; });
    var h = '<div class="x3d-selbox"><b>' + (n === 1 ? TYPES[zs[0].type].name : plural(n, 'zone', 'zones') + ' choisies') + '</b>';
    if (n === 1) h += '<small>' + (zs[0].polygon ? fmt(C.polygonArea(zs[0].polygon)) + ' m²' : fmt(lineLen(zs[0].line)) + ' m') + ' · ' + pts(zs[0]).length + ' sommets · ' + (zs[0].source === 'user' ? 'modifiée à la main' : 'détectée') + '</small>';
    if (polys.length === n) {
      var same = polys.every(function(z){ return z.type === polys[0].type; });
      h += '<label>Type<select data-act="type">' + (same ? '' : '<option value="" selected>(plusieurs)</option>') + ['river', 'water', 'forest', 'grass'].map(function(k){ return '<option value="' + k + '"' + (same && k === polys[0].type ? ' selected' : '') + '>' + TYPES[k].name + '</option>'; }).join('') + '</select></label>';
    }
    if (roads.length === n) h += '<label>Largeur (m)<input type="number" min="3" max="25" step="0.5" value="' + (roads.every(function(z){ return z.width === roads[0].width; }) ? roads[0].width : '') + '" data-act="width"></label>';
    if (n === 1 && waters.length === 1) h += '<label>Cote de l’eau (m)<input type="number" step="0.05" value="' + (waters[0].level != null ? waters[0].level : '') + '" placeholder="estimée par BS3D" data-act="level"></label>';
    h += '<div class="x3d-row"><button type="button" class="x3d-danger" data-act="delsel">Supprimer' + (n > 1 ? ' les ' + n : '') + '</button><button type="button" data-act="none">Désélectionner</button></div>';
    if (n === 1) h += '<small class="x3d-note">Sommets : glisser pour déplacer, clic sur un petit point pour en ajouter un, double-clic pour en retirer un.</small>';
    return h + '</div>';
  }
  function editHtml(){
    var d = S.data, tool = S.tool, h;
    if (tool && tool.kind === 'draw') {
      return '<div class="x3d-tool"><b>Tracé : ' + TYPES[tool.type].name + '</b><p>Cliquez les sommets sur la carte (' + plural(tool.pts.length, 'placé', 'placés') + ', ' + (TYPES[tool.type].poly ? '3' : '2') + ' au moins). Double-clic ou « Terminer » pour finir, Échap pour annuler.</p>' +
        '<div class="x3d-row"><button type="button" class="x3d-pri" data-act="finish"' + (tool.pts.length >= (TYPES[tool.type].poly ? 3 : 2) ? '' : ' disabled') + '>Terminer</button><button type="button" data-act="canceltool">Annuler</button></div></div>';
    }
    if (tool && tool.kind === 'axis') {
      return '<div class="x3d-tool"><b>Axe du pont</b><p>' + (tool.pts.length ? 'Cliquez la <b>fin</b> du pont.' : 'Cliquez le <b>début</b> du pont.') + ' Échap pour annuler.</p>' +
        '<div class="x3d-row"><button type="button" data-act="canceltool">Annuler</button></div></div>';
    }
    h = '<div class="x3d-thumbwrap"><canvas id="x3d-thumb" width="10" height="10" aria-label="Relief ombré du MNT"></canvas><div class="x3d-ts"><b>' + esc(sizeText()) + '</b><br>' +
      (isFinite(d.zmin) ? 'Altitude ' + QA.nf1.format(d.zmin) + ' à ' + QA.nf1.format(d.zmax) + ' m' : '') + '<br>' +
      'MNT ' + fmt(d.fin * 100) + ' % · ' + (d.mns ? 'MNS' : 'sans MNS') + ' · ' + (d.jpeg ? 'image' : 'sans image') + ' · ' + QA.nf1.format(d.seconds) + ' s</div></div>';
    if (d.warns.length) h += '<ul class="x3d-warns">' + d.warns.map(function(w){ return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>';
    h += '<div class="x3d-sec"><div class="x3d-h">Zones détectées (' + S.zones.length + ')</div><ul class="x3d-fam">' + ORDER.map(function(k){
      var zs = S.zones.filter(function(z){ return z.type === k; }), n = zs.length, on = n && zs.every(function(z){ return isSel(z.id); });
      return '<li class="' + (n ? '' : 'none') + '">' + swatch(k) + '<button type="button" class="x3d-famname" data-act="fam" data-t="' + k + '"' + (n ? '' : ' disabled') + ' aria-pressed="' + !!on + '" title="Sélectionner toutes les zones de ce type">' + TYPES[k].many + '</button><b>' + n + '</b>' +
        '<button type="button" data-act="add" data-t="' + k + '" title="Tracer une zone « ' + TYPES[k].name + ' » sur la carte">+ Tracer</button>' +
        '<button type="button" class="x3d-danger" data-act="delfam" data-t="' + k + '"' + (n ? '' : ' disabled') + ' title="Supprimer toutes les zones de ce type" aria-label="Supprimer : ' + TYPES[k].many + '">Vider</button></li>';
    }).join('') + '</ul>' + selectionHtml() + '</div>' +
      '<div class="x3d-sec"><div class="x3d-h">Axe du pont</div><p class="x3d-ax" id="x3d-ax">' + esc(axisText()) + '</p>' +
      '<div class="x3d-row"><button type="button" data-act="axis">' + (S.axis ? 'Replacer (2 clics)' : 'Placer (2 clics)') + '</button>' + (S.axis ? '<button type="button" data-act="axisdel">Retirer</button>' : '') + '</div>' +
      (S.axis ? '<label class="x3d-chk"><input type="checkbox" data-act="strip"' + (S.strip ? ' checked' : '') + '><span>Retirer le pont existant du relief <small>(sol continu sous l’ouvrage, sur ' + QA.nf1.format(deckWidth() + 4) + ' m de large)</small></span></label>' +
        '<small class="x3d-note">Les bouts A et B se glissent sur la carte : placez-les sur les deux culées.</small>' : '') + '</div>';
    return h;
  }
  function footHtml(){
    return '<div class="x3d-foot"><button type="button" class="x3d-pri x3d-big" data-act="send"' + (S.sending ? ' disabled' : '') + '>Envoyer vers BridgeSketch 3D</button>' +
      '<div class="x3d-row"><button type="button" data-act="download">Télécharger le fichier</button><button type="button" data-act="again">Nouveau bloc</button></div></div>';
  }
  function status(kind, html){ S.status = html ? { kind: kind, html: html } : null; render(); }
  function drawThumb(){
    var cv = $('#x3d-thumb'), d = S.data;
    if (!cv || !d) return;
    var hs = d.hs, ctx = cv.getContext('2d');
    cv.width = hs.w; cv.height = hs.h;
    var im = ctx.createImageData(hs.w, hs.h);
    for (var i = 0; i < hs.w * hs.h; i++) { im.data[i * 4] = hs.gray[i]; im.data[i * 4 + 1] = hs.gray[i]; im.data[i * 4 + 2] = hs.gray[i]; im.data[i * 4 + 3] = 255; }
    ctx.putImageData(im, 0, 0);
    cv.style.aspectRatio = hs.w + ' / ' + hs.h;
  }

  // ---------- Rectangle du bloc ----------
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
  function readout(){
    var el = $('#x3d-read'); if (el) el.textContent = sizeText();
    if (S.rectL) S.rectL.setTooltipContent(fmt(S.blk.wM) + ' × ' + fmt(S.blk.hM) + ' m');
  }
  function showRect(r, editable){
    setBlock(r);
    var b = [[r.s, r.w], [r.n, r.e]];
    if (!S.rectL) {
      S.rectL = L.rectangle(b, { pane: 'x3dPane', renderer: S.svg, color: '#fff', weight: 2.5, dashArray: '8 5', fillColor: '#fff', fillOpacity: 0.06, interactive: false }).addTo(S.map);
      S.rectL.bindTooltip('', { permanent: true, direction: 'top', className: 'b3d-tip', offset: [0, -2] });
    } else S.rectL.setBounds(b);
    handles(editable ? r : null);
    readout();
    var bt = $('[data-act=extract]'); if (bt) bt.disabled = false;
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
        setBlock(nr); S.rectL.setBounds([[nr.s, nr.w], [nr.n, nr.e]]); readout();
        corners(nr).forEach(function(cc, j){ if (j !== i) S.handles[j].setLatLng(cc); });
        S.handles[4].setLatLng([(nr.s + nr.n) / 2, (nr.w + nr.e) / 2]);
      });
      m.on('dragend', function(){ showRect(S.rect, true); render(); });
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
      if ((e.button != null && e.button > 0) || e.target.closest('.leaflet-control,.x3d-bar')) return;
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
  }

  // ---------- Extraction ----------
  // Masque des routes : une image PNG transparente du WMS CanVec de RNCan (couche road_segment_50k), environ 1 m par pixel
  function roadMask(bb, nw, nh, ms){
    if (!window.createImageBitmap) return Promise.reject(new Error('createImageBitmap absent'));
    var url = CANVEC + '?service=WMS&version=1.3.0&request=GetMap&layers=road_segment_50k&styles=&crs=EPSG:3857&bbox=' + bb.map(function(v){ return v.toFixed(1); }).join(',') +
      '&width=' + nw + '&height=' + nh + '&format=image/png&transparent=true';
    return fetchT(url, null, ms, 'blob').then(function(b){ return createImageBitmap(b); }).then(function(bm){
      var cv = document.createElement('canvas'); cv.width = bm.width; cv.height = bm.height;
      var g = cv.getContext('2d'); g.drawImage(bm, 0, 0);
      return { px: g.getImageData(0, 0, bm.width, bm.height).data, w: bm.width, h: bm.height };
    });
  }
  function step(id, state, note){
    var dt = S.t0 && state !== 'run' ? ' · ' + Math.round((performance.now() - S.t0) / 100) / 10 + ' s' : '';
    for (var i = 0; i < S.steps.length; i++) if (S.steps[i].id === id) { S.steps[i].state = state; if (note != null) S.steps[i].note = note + dt; }
    if (S.mode === 'busy') render();
  }
  function errText(e){ return e && e.name === 'AbortError' ? 'délai dépassé' : (e && e.message) || 'réseau'; }
  function extract(){
    var run = ++S.run, blk = S.blk, F_ = blk.F, grid = S.grid, k = F_.k, warns = [];
    var hx = grid.cols * grid.cell / 2 * k, hy = grid.rows * grid.cell / 2 * k, bbImg = [F_.cx - hx, F_.cy - hy, F_.cx + hx, F_.cy + hy], mg = 4 * k;
    var bbDem = [bbImg[0] - mg, bbImg[1] - mg, bbImg[2] + mg, bbImg[3] + mg], stepM = grid.cell * k;
    var W = grid.cols * grid.cell, H = grid.rows * grid.cell, sc = Math.min(2048 / Math.max(W, H), 2), nw = Math.max(64, Math.round(W * sc)), nh = Math.max(64, Math.round(H * sc));
    S.steps = [
      { id: 'dtm', label: 'Sol : MNT LiDAR 1 m (RNCan)', state: 'run' },
      { id: 'dsm', label: 'Surface : MNS LiDAR (arbres, tabliers)', state: 'wait' },
      { id: 'img', label: 'Image satellite (Esri)', state: 'run' },
      { id: 'road', label: 'Routes (CanVec, RNCan)', state: 'run' },
      { id: 'calc', label: 'Détection des zones', state: 'wait' }
    ];
    S.mode = 'busy'; S.status = null; clearZoneLayers(); handles(null); S.dots.clearLayers(); render();
    var t0 = S.t0 = performance.now();
    var tDem = GEO.wcsBox('dtm', bbDem, stepM, 90000).then(function(t){
      if (t.ok < 0.2) throw new Error('Pas de couverture LiDAR (MNEHR) à cet endroit.');
      step('dtm', 'ok', t.w + ' × ' + t.h + ' pixels'); return t;
    });
    var tMns = tDem.then(function(){ step('dsm', 'run'); return wait(1000); }).then(function(){ return GEO.wcsBox('dsm', bbDem, stepM, 90000); }).then(function(t){
      step('dsm', 'ok', t.w + ' × ' + t.h + ' pixels'); return t;
    }, function(e){ step('dsm', 'warn', 'indisponible (' + errText(e) + ')'); warns.push('MNS indisponible : forêts détectées par la couleur seule, moins sûrement.'); return null; });
    var tImg = GEO.imgBox(bbImg, nw, nh, 40000).then(function(im){ step('img', 'ok', im.w + ' × ' + im.h + ' pixels'); return im; },
      function(e){ step('img', 'warn', 'indisponible (' + errText(e) + ')'); warns.push('Image satellite indisponible : pas d’herbe détectée, ni d’image dans le paquet.'); return null; });
    var tRoad = roadMask(bbImg, Math.min(1500, Math.round(W)), Math.min(1500, Math.round(H)), 15000).then(function(m){ step('road', 'ok'); return m; },
      function(e){ step('road', 'warn', 'indisponibles (' + errText(e) + ')'); warns.push('Routes CanVec indisponibles : tracez les routes utiles à la main (« + Tracer »).'); return null; });
    Promise.all([tDem, tMns, tImg, tRoad]).then(function(r){
      if (run !== S.run) return;
      step('calc', 'run'); return wait(30).then(function(){ return finish(run, r[0], r[1], r[2], r[3], warns, t0); });
    }).catch(function(e){
      if (run !== S.run) return;
      if (window.console) console.error(e);
      S.mode = 'select'; handles(S.rect);
      status('err', 'Échec de l’extraction : ' + esc(errText(e)) + '. Réessayez ou choisissez un bloc plus petit.');
    });
  }
  function finish(run, dem, dsm, im, mask, warns, t0){
    if (run !== S.run) return;
    var F_ = S.blk.F, grid = S.grid, hw = grid.cols * grid.cell / 2, hh = grid.rows * grid.cell / 2;
    var mnt = C.resample(dem, F_, grid), mns = dsm ? C.resample(dsm, F_, grid) : null, fin = C.finiteFraction(mnt);
    if (fin < 0.2) throw new Error('le MNT ne couvre pas ce bloc');
    var det = C.detect({ grid: grid, img: im ? { px: im.px, w: im.w, h: im.h } : null, mnt: mnt, mns: mns, roads: mask });
    var zones = det.zones.map(function(z){
      var q = { id: S.nextId++, type: z.type, source: z.source };
      if (z.type === 'road') { q.line = z.line; q.width = z.width; } else { q.polygon = z.polygon; if (z.level != null) q.level = z.level; }
      return q;
    });
    var zmin = Infinity, zmax = -Infinity;
    for (var i = 0; i < mnt.length; i++) { var v = mnt[i]; if (v < zmin) zmin = v; if (v > zmax) zmax = v; }
    var jpeg = im && im.buf ? 'data:image/jpeg;base64,' + C.bytesToB64(new Uint8Array(im.buf)) : null;
    var attribution = ['MNEHR 1 m © RNCan (OGL-Canada)'];
    if (mask) attribution.push('CanVec © RNCan (OGL-Canada)');
    if (jpeg) attribution.push('Esri World Imagery');
    S.data = { F: F_, grid: grid, mnt: mnt, mns: mns, jpeg: jpeg, fin: fin, zmin: zmin, zmax: zmax, hs: C.hillshade(mnt, grid.cols, grid.rows, grid.cell, 340),
      attribution: attribution, warns: warns, det: det.stats, seconds: (performance.now() - t0) / 1000 };
    S.zones = zones; S.sel = []; S.tool = null; S.undo = [];
    // axe proposé : la route la plus proche de la structure donne la direction ; le tablier visible dans le MNS donne les deux bouts
    S.axis = null; S.axisSrc = null;
    if (S.o && S.o.lat != null) {
      var p = C.toLocal(F_, S.o.lat, S.o.lon);
      if (Math.abs(p[0]) <= hw && Math.abs(p[1]) <= hh) {
        var len = Math.max(15, Math.min(400, S.o.long || 60)), roads = zones.filter(function(z){ return z.line; }).map(function(z){ return z.line; });
        var sg = C.suggestAxis(p, roads, len, 80), deck = sg.from === 'route' ? C.deckExtent(sg.at, sg.dir, grid, mnt, mns, Math.max(60, len)) : null;
        // le tablier lu dans le MNS n'est retenu que s'il est cohérent avec la longueur connue de l'ouvrage (entre la moitié et le double)
        var dl = deck ? Math.hypot(deck[1][0] - deck[0][0], deck[1][1] - deck[0][1]) : 0;
        if (deck && dl >= len * 0.5 && dl <= len * 2) { S.axis = deck; S.axisSrc = 'proposé d’après la route et le tablier (LiDAR)'; }
        else { S.axis = sg.axis; S.axisSrc = sg.from === 'route' ? 'proposé d’après la route' : 'est-ouest par défaut : à ajuster'; }
        S.axis = [clampLoc(S.axis[0]), clampLoc(S.axis[1])];
      } else warns.push('La structure choisie est hors du bloc : placez l’axe du pont vous-même.');
    }
    S.mode = 'edit'; S.status = null;
    S.rectL.closeTooltip();
    drawZones(); drawAxis(); drawStructure();
    S.map.fitBounds([[S.rect.s, S.rect.w], [S.rect.n, S.rect.e]], { padding: [30, 30], animate: false });
    render();
  }

  // ---------- Zones sur la carte ----------
  function zoneStyle(z){
    var T = TYPES[z.type], sel = isSel(z.id);
    if (z.type === 'road') return { pane: 'x3dPane', renderer: S.svg, color: sel ? '#fff' : T.color, weight: sel ? 6 : 4, opacity: 0.95, lineCap: 'round', dashArray: sel ? '1 9' : null, className: 'x3d-z' + (sel ? ' sel' : '') };
    return { pane: 'x3dPane', renderer: S.svg, color: sel ? '#fff' : T.color, weight: sel ? 3.5 : 2, fillColor: T.color, fillOpacity: sel ? T.fill + 0.2 : T.fill, dashArray: sel ? null : T.dash, className: 'x3d-z' + (sel ? ' sel' : '') };
  }
  function clearZoneLayers(){
    Object.keys(S.zl).forEach(function(k){ S.map.removeLayer(S.zl[k]); });
    S.zl = {};
    clearVtx();
    if (S.axisL) { S.axisL.forEach(function(x){ S.map.removeLayer(x); }); S.axisL = null; }
    if (S.structL) { S.map.removeLayer(S.structL); S.structL = null; }
  }
  function zoneLatLngs(z){ return pts(z).map(ll); }
  function drawZones(){
    Object.keys(S.zl).forEach(function(k){ S.map.removeLayer(S.zl[k]); });
    S.zl = {};
    // les surfaces d'abord (les plus grandes dessous), les routes au-dessus : tout reste cliquable
    var order = S.zones.slice().sort(function(a, b){ return (a.line ? 1 : 0) - (b.line ? 1 : 0) || (a.polygon && b.polygon ? C.polygonArea(b.polygon) - C.polygonArea(a.polygon) : 0); });
    order.forEach(function(z){
      var l = z.polygon ? L.polygon(zoneLatLngs(z), zoneStyle(z)) : L.polyline(zoneLatLngs(z), zoneStyle(z));
      l.bindTooltip(function(){ return TYPES[z.type].name + (z.level != null ? ' · cote ' + QA.nf2.format(z.level) + ' m' : '') + (z.line ? ' · ' + z.width + ' m' : ''); }, { sticky: true, className: 'b3d-tip' });
      l.on('mousedown', function(e){ zoneDown(z, e); });
      l.on('click', function(e){ L.DomEvent.stopPropagation(e); });
      l.addTo(S.map); S.zl[z.id] = l;
    });
    showVtx();
  }
  function refreshZone(z){ var l = S.zl[z.id]; if (l) { l.setLatLngs(zoneLatLngs(z)); l.setStyle(zoneStyle(z)); } }
  function select(ids){
    var old = S.sel; S.sel = ids.filter(function(id){ return zoneById(id); });
    old.concat(S.sel).forEach(function(id){ var z = zoneById(id); if (z) refreshZone(z); });
    S.sel.forEach(function(id){ if (S.zl[id] && zoneById(id).line) S.zl[id].bringToFront(); });
    showVtx();
    if (S.mode === 'edit') render();
  }
  function clearVtx(){ S.vh.forEach(function(m){ S.map.removeLayer(m); }); S.vh = []; }
  // Poignées de sommets : pour une seule zone choisie
  function showVtx(){
    clearVtx();
    if (S.sel.length !== 1 || S.tool) return;
    var z = zoneById(S.sel[0]); if (!z) return;
    var p = pts(z), closed = !!z.polygon, n = p.length;
    var vIcon = L.divIcon({ className: 'b3d-hw', html: '<span class="b3d-hv"></span>', iconSize: [16, 16], iconAnchor: [8, 8] });
    var mIcon = L.divIcon({ className: 'b3d-hw', html: '<span class="b3d-hmid"></span>', iconSize: [12, 12], iconAnchor: [6, 6] });
    p.forEach(function(q, i){
      var m = L.marker(ll(q), { draggable: true, icon: vIcon, keyboard: false, title: 'Glisser pour déplacer ; double-clic pour retirer', zIndexOffset: 700 }).addTo(S.map);
      m.on('dragstart', pushUndo);
      m.on('drag', function(){ p[i] = clampLoc(loc(m.getLatLng())); refreshZone(z); });
      m.on('dragend', function(){ z.source = 'user'; showVtx(); render(); });
      m.on('dblclick', function(e){
        L.DomEvent.stop(e);
        if (p.length <= (closed ? 3 : 2)) return;
        pushUndo(); p.splice(i, 1); z.source = 'user'; refreshZone(z); showVtx(); render();
      });
      S.vh.push(m);
    });
    if (n > 60) return;                                         // grande zone détectée : les points d'ajout encombreraient la carte
    for (var i = 0; i < (closed ? n : n - 1); i++) {
      (function(i){
        var a = p[i], b = p[(i + 1) % n], m = L.marker(ll([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]), { icon: mIcon, keyboard: false, title: 'Cliquer pour ajouter un sommet', zIndexOffset: 600 }).addTo(S.map);
        m.on('click', function(e){ L.DomEvent.stop(e); pushUndo(); p.splice(i + 1, 0, clampLoc(loc(m.getLatLng()))); z.source = 'user'; refreshZone(z); showVtx(); render(); });
        S.vh.push(m);
      })(i);
    }
  }
  // --- Annulation : instantanés des zones et de l'axe (40 au plus)
  function pushUndo(){
    S.undo.push(JSON.stringify({ zones: S.zones, axis: S.axis, axisSrc: S.axisSrc, sel: S.sel }));
    if (S.undo.length > 40) S.undo.shift();
  }
  function undo(){
    var s = S.undo.pop(); if (!s) return;
    s = JSON.parse(s);
    S.zones = s.zones; S.axis = s.axis; S.axisSrc = s.axisSrc; S.sel = s.sel;
    drawZones(); drawAxis(); render();
  }
  function deleteZones(ids){
    if (!ids.length) return;
    pushUndo();
    S.zones = S.zones.filter(function(z){ return ids.indexOf(z.id) < 0; });
    S.sel = S.sel.filter(function(id){ return ids.indexOf(id) < 0; });
    drawZones(); render();
    S.status = { kind: 'ok', html: plural(ids.length, 'zone supprimée', 'zones supprimées') + '. <button type="button" class="x3d-link" data-act="undo">Annuler</button>' };
    render();
  }
  // --- Clic et déplacement à la souris : un appui sur une zone la choisit (Maj / Ctrl : ajoute ou retire) ; si la souris bouge,
  //     toute la sélection suit, bornée au bloc.
  function zoneDown(z, e){
    if (S.tool || S.mode !== 'edit') return;
    var ev = e.originalEvent;
    if (ev.button > 0) return;
    if (ev.shiftKey || S.box) return;                          // Maj ou mode cadre : le cadre de sélection prend la main
    L.DomEvent.stop(e);
    var add = ev.ctrlKey || ev.metaKey, was = isSel(z.id);
    if (!was) select(add ? S.sel.concat([z.id]) : [z.id]);
    var start = loc(e.latlng), zs = selZones(), base = zs.map(function(q){ return pts(q).map(function(p){ return [p[0], p[1]]; }); }), moved = false, h = half();
    var lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    base.forEach(function(b){ b.forEach(function(p){ lo[0] = Math.min(lo[0], p[0]); lo[1] = Math.min(lo[1], p[1]); hi[0] = Math.max(hi[0], p[0]); hi[1] = Math.max(hi[1], p[1]); }); });
    var sx = ev.clientX, sy = ev.clientY;
    S.map.dragging.disable(); clearVtx();
    var move = function(m){
      if (!moved && Math.hypot(m.clientX - sx, m.clientY - sy) < 4) return;
      if (!moved) { moved = true; pushUndo(); S.map.getContainer().classList.add('x3d-moving'); }
      var q = loc(S.map.mouseEventToLatLng(m)), dx = q[0] - start[0], dy = q[1] - start[1];
      dx = Math.max(-h[0] - lo[0], Math.min(h[0] - hi[0], dx)); dy = Math.max(-h[1] - lo[1], Math.min(h[1] - hi[1], dy));
      zs.forEach(function(zq, i){ var p = pts(zq); for (var j = 0; j < p.length; j++) { p[j][0] = base[i][j][0] + dx; p[j][1] = base[i][j][1] + dy; } refreshZone(zq); });
    };
    var up = function(){
      document.removeEventListener('mousemove', move, true); document.removeEventListener('mouseup', up, true);
      S.map.dragging.enable(); S.map.getContainer().classList.remove('x3d-moving');
      if (moved) { zs.forEach(function(zq){ zq.source = 'user'; }); S.justDragged = true; setTimeout(function(){ S.justDragged = false; }, 50); showVtx(); render(); }
      else if (was && add) select(S.sel.filter(function(id){ return id !== z.id; }));
      else if (was && S.sel.length > 1) select([z.id]);
      else showVtx();
    };
    document.addEventListener('mousemove', move, true); document.addEventListener('mouseup', up, true);
  }
  // --- Cadre de sélection : Maj + glisser, ou glisser quand « Cadre de sélection » est actif
  function wireMarquee(){
    var c = S.map.getContainer(), a = null, box = null;
    c.addEventListener('mousedown', function(e){
      if (S.mode !== 'edit' || S.tool || e.button > 0 || !(e.shiftKey || S.box)) return;
      if (e.target.closest('.leaflet-marker-icon,.leaflet-control,.x3d-bar')) return;
      var r = c.getBoundingClientRect();
      a = { x: e.clientX - r.left, y: e.clientY - r.top, add: e.shiftKey && S.sel.length > 0 || e.ctrlKey };
      e.preventDefault(); e.stopPropagation();
      S.map.dragging.disable();
      box = document.createElement('div'); box.className = 'x3d-marquee'; c.appendChild(box);
      var move = function(m){
        var x = m.clientX - r.left, y = m.clientY - r.top;
        box.style.left = Math.min(a.x, x) + 'px'; box.style.top = Math.min(a.y, y) + 'px'; box.style.width = Math.abs(x - a.x) + 'px'; box.style.height = Math.abs(y - a.y) + 'px';
      };
      var up = function(m){
        document.removeEventListener('mousemove', move, true); document.removeEventListener('mouseup', up, true);
        S.map.dragging.enable(); box.remove();
        var x = m.clientX - r.left, y = m.clientY - r.top;
        S.justDragged = true; setTimeout(function(){ S.justDragged = false; }, 50);
        if (Math.abs(x - a.x) < 5 && Math.abs(y - a.y) < 5) { a = null; return; }
        var p1 = loc(S.map.containerPointToLatLng([Math.min(a.x, x), Math.max(a.y, y)])), p2 = loc(S.map.containerPointToLatLng([Math.max(a.x, x), Math.min(a.y, y)]));
        var rc = { x0: p1[0], y0: p1[1], x1: p2[0], y1: p2[1] };
        // une zone est prise si le cadre touche son tracé (un sommet dedans, ou une arête qui le traverse)
        var hit = S.zones.filter(function(z){
          if (z.line) return C.clipLine(z.line, rc).length > 0;
          return C.clipLine(z.polygon.concat([z.polygon[0]]), rc).length > 0;
        }).map(function(z){ return z.id; });
        select(a.add ? S.sel.concat(hit.filter(function(id){ return !isSel(id); })) : hit);
        a = null;
      };
      document.addEventListener('mousemove', move, true); document.addEventListener('mouseup', up, true);
    }, true);
  }

  // ---------- Axe du pont et structure ----------
  function drawStructure(){
    if (S.structL) { S.map.removeLayer(S.structL); S.structL = null; }
    if (!S.o || S.o.lat == null) return;
    S.structL = L.circleMarker([S.o.lat, S.o.lon], { pane: 'x3dPane', renderer: S.svg, radius: 6, color: '#102d41', weight: 3, fillColor: '#fff', fillOpacity: 0.9, interactive: false }).addTo(S.map);
  }
  function drawAxis(){
    if (S.axisL) { S.axisL.forEach(function(x){ S.map.removeLayer(x); }); S.axisL = null; }
    if (!S.axis) return;
    var p = S.axis, line = L.polyline(p.map(ll), { pane: 'x3dPane', renderer: S.svg, color: '#D55E00', weight: 4, dashArray: '10 6', interactive: false }).addTo(S.map), out = [line];
    ['A', 'B'].forEach(function(t, i){
      var m = L.marker(ll(p[i]), { draggable: true, keyboard: false, zIndexOffset: 900, title: (i ? 'Fin' : 'Début') + ' de l’axe : glisser pour ajuster',
        icon: L.divIcon({ className: 'b3d-hw', html: '<span class="b3d-ax-pt">' + t + '</span>', iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(S.map);
      m.on('dragstart', pushUndo);
      m.on('drag', function(){ p[i] = clampLoc(loc(m.getLatLng())); line.setLatLngs(p.map(ll)); var el = $('#x3d-ax'); if (el) el.textContent = axisText(); });
      m.on('dragend', function(){ S.axisSrc = 'ajusté à la main'; render(); });
      out.push(m);
    });
    S.axisL = out;
  }

  // ---------- Outils de tracé (nouvelle zone, axe) ----------
  function startTool(kind, type){
    cancelTool(true);
    select([]);
    S.tool = { kind: kind, type: type, pts: [], prev: null };
    S.map.doubleClickZoom.disable();
    S.map.on('click', onToolClick); S.map.on('dblclick', onToolDbl);
    if (kind === 'axis') { S.axisBackup = [S.axis, S.axisSrc]; if (S.axisL) { S.axisL.forEach(function(x){ S.map.removeLayer(x); }); S.axisL = null; } }
    render();
  }
  function toolPreview(){
    var t = S.tool; if (!t) return;
    if (t.prev) t.prev.forEach(function(x){ S.map.removeLayer(x); });
    var col = t.kind === 'axis' ? '#D55E00' : TYPES[t.type].color, ls = t.pts.map(ll);
    t.prev = [L.polyline(t.type && TYPES[t.type].poly && ls.length > 2 ? ls.concat([ls[0]]) : ls, { pane: 'x3dPane', renderer: S.svg, color: col, weight: 3, dashArray: '5 5', interactive: false }).addTo(S.map)];
    ls.forEach(function(p){ t.prev.push(L.circleMarker(p, { pane: 'x3dPane', renderer: S.svg, radius: 4, color: '#fff', weight: 1.5, fillColor: col, fillOpacity: 1, interactive: false }).addTo(S.map)); });
  }
  function onToolClick(e){
    var t = S.tool; if (!t) return;
    t.pts.push(clampLoc(loc(e.latlng)));
    if (t.kind === 'axis' && t.pts.length === 2) { var bk = S.axisBackup; S.axis = bk[0]; S.axisSrc = bk[1]; pushUndo(); S.axis = t.pts.slice(); S.axisSrc = 'placé à la main'; endTool(); drawAxis(); render(); return; }
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
    pushUndo();
    var z = { id: S.nextId++, type: t.type, source: 'user' };
    if (T.poly) z.polygon = t.pts.slice(); else { z.line = t.pts.slice(); z.width = 7; }
    S.zones.push(z);
    endTool(); drawZones(); select([z.id]);
  }
  function endTool(){
    var t = S.tool;
    if (t && t.prev) t.prev.forEach(function(x){ S.map.removeLayer(x); });
    S.tool = null; S.axisBackup = null;
    S.map.off('click', onToolClick); S.map.off('dblclick', onToolDbl);
    S.map.doubleClickZoom.enable();
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
    // v0.7.4 : le pont existant est retiré du relief envoyé (terrain continu sous l'ouvrage), sauf si la case est décochée
    var g = S.axis && S.strip ? C.removeBridge(d.grid, d.mnt, d.mns, S.axis, deckWidth()) : { mnt: d.mnt, mns: d.mns };
    return C.buildPacket({
      frame: { lat: d.F.lat, lon: d.F.lon }, grid: d.grid, mnt: g.mnt, mns: g.mns, image: d.imageObj || null,
      zones: S.zones.map(function(z){ return { type: z.type, source: z.source, polygon: z.polygon, line: z.line, width: z.width, level: z.level }; }),
      bridge: S.axis ? { axis: S.axis, structure: S.o ? { id: String(S.o.num), name: structName(S.o) } : null } : null,
      attribution: d.attribution
    });
  }
  function deckWidth(){ var w = S.o && parseFloat(S.o.larg); return isFinite(w) && w >= 2 ? Math.min(60, w) : 12; }
  function fileName(){ return 'bloc-' + (S.o ? String(S.o.num).replace(/[^\w-]/g, '') : 'carte') + '-' + new Date().toISOString().slice(0, 10) + '.bs3dterrain'; }
  function download(){
    var p = packet(), errs = C.validatePacket(p);
    if (errs.length) { status('err', 'Paquet non conforme : ' + esc(errs.join(', '))); return; }
    var blob = new Blob([C.packetToJson(p)], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = fileName(); document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    status('ok', 'Fichier « ' + esc(fileName()) + ' » téléchargé (' + QA.nf1.format(blob.size / 1048576) + ' Mo). Dans BridgeSketch 3D : Fichier › Import terrain › Ouvrir un fichier.');
  }
  // Accusé de réception de BridgeSketch 3D (0.6.9+) : « reçu et validé », « appliqué », « fermé » ou « erreur ».
  // Seuls les messages de la fenêtre destinataire et portant l'identifiant du transfert sont pris en compte.
  function listenAck(target, id, sent){
    if (S.ack) S.ack.stop();
    var timer, stp = function(n){ return '<span class="b3d-ack">' + ['Envoyé', 'Reçu et validé', 'Appliqué'].map(function(t, i){ return '<span class="' + (i < n ? 'on' : '') + '">' + (i < n ? '✓ ' : '○ ') + t + '</span>'; }).join(' → ') + '</span>'; };
    var stop = function(){ clearTimeout(timer); window.removeEventListener('message', onAck); S.ack = null; };
    var onAck = function(ev){
      var d = ev.data;
      if (ev.source !== target || !d || d.type !== 'bs3d-terrain-ack' || d.id !== id) return;
      if (d.state === 'received') { clearTimeout(timer); status('ok', stp(2) + '<br>BridgeSketch 3D a validé le paquet (' + plural(+d.zones || 0, 'zone', 'zones') + '). Placez le pont dans sa fenêtre.'); }
      else if (d.state === 'applied') { stop(); status('ok', stp(3) + '<br>Le site et le pont sont en place dans BridgeSketch 3D.'); }
      else if (d.state === 'closed') { stop(); status('busy', stp(2) + '<br>La fenêtre d’import de BridgeSketch 3D a été fermée sans appliquer le site. Renvoyez le bloc pour reprendre.'); }
      else if (d.state === 'error') { stop(); status('err', '✗ Refusé par BridgeSketch 3D : ' + esc(String(d.message || 'paquet invalide'))); }
    };
    window.addEventListener('message', onAck);
    timer = setTimeout(function(){ window.removeEventListener('message', onAck); S.ack = null; status('busy', stp(1) + '<br>' + sent + ' Pas d’accusé de réception en 15 s : vérifiez la fenêtre BridgeSketch 3D (onglet en arrière-plan ?).'); }, 15000);
    S.ack = { stop: stop };
    return stp(1);
  }
  function post(target, origin){
    var p = packet(), errs = C.validatePacket(p);
    if (errs.length) { status('err', 'Paquet non conforme : ' + esc(errs.join(', '))); return false; }
    var m = C.packetForPost(p), id = 'qa-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    m.message.transferId = id;
    var mo = (p.mnt.length + (p.mns ? p.mns.length : 0)) * 4 / 1048576,
      sent = 'Terrain envoyé (' + QA.nf1.format(mo) + ' Mo de grilles' + (p.image ? ' + image' : '') + ', ' + plural(p.zones.length, 'zone', 'zones') + (p.bridge ? ', axe du pont' : ', sans axe') + ').';
    var head = listenAck(target, id, sent);
    target.postMessage(m.message, origin, m.transfer);
    status('ok', head + '<br>' + sent + ' En attente de BridgeSketch 3D…');
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
    if (!w) { status('err', 'Le navigateur a bloqué l’ouverture de BridgeSketch 3D. Autorisez les fenêtres surgissantes pour ce site, ou téléchargez le fichier.'); return; }
    var done = false, timer;
    var stop = function(){ done = true; clearTimeout(timer); window.removeEventListener('message', onMsg); S.sending = null; };
    var onMsg = function(ev){
      if (done || ev.source !== w || !ev.data || ev.data.type !== 'bs3d-ready') return;
      if (!(ev.origin === origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(ev.origin))) return;
      stop();
      post(w, origin === '*' ? ev.origin : origin);
    };
    window.addEventListener('message', onMsg);
    timer = setTimeout(function(){
      if (done) return;
      stop();
      status('err', 'BridgeSketch 3D n’a pas répondu en 60 s. Téléchargez le fichier et ouvrez-le dans BridgeSketch 3D (Fichier › Import terrain › Ouvrir un fichier).');
    }, 60000);
    S.sending = { stop: stop };
    status('busy', 'Ouverture de BridgeSketch 3D… en attente de sa réponse (60 s au plus).');
  }

  // ---------- Événements ----------
  function goNum(){
    var v = ($('#x3d-num').value || '').trim().toUpperCase(), o = v && QA.byNum(v);
    if (!o || o.lat == null) { status('err', 'Structure « ' + esc(v) + ' » introuvable (ou sans position).'); return; }
    setStructure(o, true);
  }
  function onClick(e){
    var b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT' || b.disabled) return;
    var act = b.getAttribute('data-act'), t = b.getAttribute('data-t');
    if (act === 'go') goNum();
    else if (act === 'draw') { if (S.drawing) endDrawRect(true); else startDrawRect(); }
    else if (act === 'sq') {
      S.side0 = parseInt(b.getAttribute('data-s'), 10);
      var c = S.o && S.o.lat != null ? { lat: S.o.lat, lng: S.o.lon } : S.rect ? { lat: (S.rect.s + S.rect.n) / 2, lng: (S.rect.w + S.rect.e) / 2 } : S.map.getCenter();
      showRect(squareAround(c.lat, c.lng, S.side0), true);
      S.map.fitBounds([[S.rect.s, S.rect.w], [S.rect.n, S.rect.e]], { padding: [60, 60] });
      render();
    }
    else if (act === 'extract') { if (S.rect) { endDrawRect(false); extract(); } }
    else if (act === 'cancel') { S.run++; S.mode = 'select'; render(); handles(S.rect); drawDots(); }
    else if (act === 'fam') { var ids = S.zones.filter(function(z){ return z.type === t; }).map(function(z){ return z.id; }); select(b.getAttribute('aria-pressed') === 'true' ? [] : ids); }
    else if (act === 'delfam') deleteZones(S.zones.filter(function(z){ return z.type === t; }).map(function(z){ return z.id; }));
    else if (act === 'delsel') deleteZones(S.sel.slice());
    else if (act === 'none') select([]);
    else if (act === 'all') select(S.zones.map(function(z){ return z.id; }));
    else if (act === 'box') { S.box = !S.box; render(); }
    else if (act === 'undo') { S.status = null; undo(); }
    else if (act === 'add') startTool('draw', t);
    else if (act === 'finish') finishTool();
    else if (act === 'canceltool') cancelTool();
    else if (act === 'axis') startTool('axis', null);
    else if (act === 'axisdel') { pushUndo(); S.axis = null; S.axisSrc = null; drawAxis(); render(); }
    else if (act === 'send') send();
    else if (act === 'download') download();
    else if (act === 'again') newBlock();
  }
  function onChange(e){
    var t = e.target, act = t.getAttribute && t.getAttribute('data-act'), zs = selZones();
    if (act === 'strip') { S.strip = t.checked; return; }
    if (!act || !zs.length) return;
    if (act === 'type' && t.value) { pushUndo(); zs.forEach(function(z){ if (z.polygon) { z.type = t.value; z.source = 'user'; if (z.type !== 'water' && z.type !== 'river') delete z.level; refreshZone(z); } }); render(); }
    else if (act === 'width') { var w = parseFloat(String(t.value).replace(',', '.')); if (!isFinite(w)) return; pushUndo(); zs.forEach(function(z){ if (z.line) { z.width = Math.max(3, Math.min(25, w)); z.source = 'user'; } }); render(); }
    else if (act === 'level') { var v = parseFloat(String(t.value).replace(',', '.')); pushUndo(); if (isFinite(v)) zs[0].level = v; else delete zs[0].level; zs[0].source = 'user'; render(); }
  }
  function onKey(e){
    if (!S.host || S.host.hidden) return;
    if (e.key === 'Escape') { if (S.drawing) endDrawRect(true); else if (S.tool) cancelTool(); else if (S.sel.length) select([]); else if (S.box) { S.box = false; render(); } return; }
    if (S.mode !== 'edit' || typing(e)) return;
    if (S.tool) { if (e.key === 'Enter') finishTool(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel.length) { e.preventDefault(); deleteZones(S.sel.slice()); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); S.status = null; undo(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); select(S.zones.map(function(z){ return z.id; })); }
  }
  function newBlock(){
    cancelTool(true); clearZoneLayers(); S.data = null; S.zones = []; S.axis = null; S.sel = []; S.undo = []; S.mode = 'select'; S.status = null; S.box = false;
    render(); if (S.rect) { showRect(S.rect, true); S.rectL.openTooltip(); } drawDots();
  }

  // ---------- Ouverture ----------
  // host : élément de la vue (#view-export3d) ; o : structure de l'atlas, null (aucune) ou undefined (garder l'état) ;
  // opt = { bs3d : ouvert par BridgeSketch 3D (?bs3d=1), center, zoom : vue de la carte principale }
  function show(host, o, opt){
    opt = opt || {};
    if (!S.map) build(host, opt);
    S.bs3d = !!opt.bs3d;
    S.map.invalidateSize();
    if (o && o.lat != null && (!S.o || S.o.num !== o.num || S.mode === 'select')) {
      if (S.mode !== 'select') newBlock();
      setStructure(o, true);
    } else {
      if (S.mode === 'select' && !S.rect && opt.center && !S.shown) S.map.setView(opt.center, Math.max(opt.zoom || 7, 7), { animate: false });
      render(); drawDots();
    }
    S.shown = true;
  }
  window.QA_MOD.bloc3d = { show: show,
    // essais (console, script de contrôle) : état, paquet et fichier courants, rectangle et extraction programmatiques
    _t: { state: function(){ return S; }, packet: function(){ return packet(); }, json: function(){ return C.packetToJson(packet()); },
      setRect: function(s, w, n, e){ showRect({ s: s, w: w, n: n, e: e }, true); render(); }, extract: extract, send: send, download: download, select: select, del: deleteZones, undo: undo } };
})();
