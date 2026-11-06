/* « Climat futur à l'ouvrage » : fenêtre de QuickerAtlas (prototype v0.7.0, officielle en v0.7.1). Module chargé à la
   demande (openAux). Contrat : window.QA_MOD.climat.render(o, body, ctx).

   Question : comment le climat de la cellule de grille (~6 × 10 km) qui contient l'ouvrage change-t-il, entre une période
   de référence (1971-2000, ou 2021-2050 au choix depuis v0.7.1) et un horizon futur (2021-2050, 2041-2070 ou 2071-2100)
   selon un scénario d'émissions ? Information brute : médiane (p50) et plage p10–p90 des modèles, SANS note de risque.

   Source (ECCC, Licence du gouvernement ouvert – Canada ; interrogée en direct, CORS ouvert : Access-Control-Allow-Origin: *) :
   GeoMet-Climate, WMS GetFeatureInfo (https://geo.weather.gc.ca/geomet-climate), scénarios CMIP6 réduits statistiquement
   CanDCS-U6 (26 modèles, méthode BCCAQv2, grille de 1/12° ≈ 6 × 10 km) ; 3 scénarios SSP1-2.6 / SSP2-4.5 / SSP5-8.5.
   Couches (moyennes sur 30 ans, annuelles et saisonnières DJF/MAM/JJA/SON) :
     référence  CanDCSU6-<SSP>_<VAR>-Pct<10|50|90>_1971-2000_P0Y[-<SAISON>]
     écart      CanDCSU6-<SSP>_<VAR>Anomaly-Pct<10|50|90>_<2021-2050|2041-2070|2071-2100>_P0Y[-<SAISON>]
   avec VAR = AirTemp (moyenne), AirTempMax, AirTempMin (°C), Precip (mm par an ou par saison). Les écarts sont des
   différences simples, y compris pour les précipitations (en mm, vérifié ; la légende de GeoMet parle de « % »).
   - Référence 1971-2000 : valeur future = référence p50 + écart (p10, p50 ou p90) ; plage p10–p90 = celle du CHANGEMENT.
   - Référence 2021-2050 (v0.7.1) : valeur de référence = 1971-2000 p50 + écart 2021-2050 ; écart affiché = différence des
     médianes des deux horizons, sans plage (la plage d'une différence ne se déduit pas des percentiles publiés).
   v0.7.1 (demande) : indices CMIP5 de l'API OGC (jours > 30 °C, nuits tropicales, degrés-jours, jours de pluie) retirés :
   trop lents (5 à 60 s). Volet « autres saisons » retiré. Icône par indice, fenêtre plus étroite, sans défilement.
   Indisponibles dans ce jeu (vérifié) : jours de gel, cycles gel-dégel, précipitations maximales sur 1 ou 5 jours.

   Daltonisme : jamais la couleur seule (signe +/−, flèche ▲/▼, texte) ; palette Okabe-Ito. Les icônes sont décoratives.
   ES5, sans dépendance ; contrat avec la page : window.QA (esc, fetchT). Tests : tests/js/climat_smoke.mjs. */
(function(){
  'use strict';
  window.QA_MOD = window.QA_MOD || {};

  // ------------------------------------------------------------------ constantes
  var GM = 'https://geo.weather.gc.ca/geomet-climate';
  var CELL = 1 / 12;                                   // résolution des grilles (degrés)
  var LON0 = -140.95833333, LAT0 = 41.04166667;        // centre de la cellule d'origine (grille CanDCS-U6)
  var BASE = '1971-2000';                              // seule période « historique » publiée : les autres sont des écarts
  var SSPS = [
    { k: 'SSP126', nom: 'SSP1-2.6', desc: 'émissions faibles' },
    { k: 'SSP245', nom: 'SSP2-4.5', desc: 'émissions intermédiaires' },
    { k: 'SSP585', nom: 'SSP5-8.5', desc: 'émissions élevées' }
  ];
  var HORS = [{ k: '2021-2050' }, { k: '2041-2070' }, { k: '2071-2100' }];
  var REFS = ['1971-2000', '2021-2050'];               // v0.7.1 : période de référence au choix
  var VARS = ['AirTemp', 'AirTempMax', 'AirTempMin', 'Precip'];
  var PERS = ['', '-DJF', '-MAM', '-JJA', '-SON'];
  var PCT_U6 = [10, 50, 90];
  var SRC_DS = 'https://open.canada.ca/data/en/dataset/f73d6939-912a-4add-a291-c233fc5d1946';
  var SRC_DOC = 'https://eccc-msc.github.io/open-data/msc-data/climate_cmip6/readme_cmip6_en/';
  var LICENCE = 'https://ouvert.canada.ca/fr/licence-du-gouvernement-ouvert-canada';
  var PORTAIL = 'https://climatedata.ca/';
  var T_WMS = 30000;
  var MAXPAR = 4, ECART_WMS = 300;                     // requêtes simultanées ; délai minimal entre deux départs (ms)
  var MINUS = '−';

  // Icônes (décoratives, 20 × 20) : une par indice
  var I = {
    thermo: function(niv, c){ return '<rect x="7.5" y="2" width="5" height="11.5" rx="2.5" fill="#fff" stroke="#17374b" stroke-width="1.3"/><rect x="9" y="' + niv + '" width="2" height="' + (13 - niv) + '" rx="1" fill="' + c + '"/><circle cx="10" cy="15" r="3.4" fill="' + c + '" stroke="#17374b" stroke-width="1.3"/>'; },
    soleil: '<g stroke="#e8a317" stroke-width="1.6" stroke-linecap="round"><path d="M10 1.8v2.2M10 16v2.2M1.8 10H4M16 10h2.2M4.2 4.2l1.6 1.6M14.2 14.2l1.6 1.6M4.2 15.8l1.6-1.6M14.2 5.8l1.6-1.6"/></g><circle cx="10" cy="10" r="4.2" fill="#fde047" stroke="#c98a0b" stroke-width="1.2"/>',
    lune: '<path d="M13.6 14.6A6.4 6.4 0 0 1 8.2 3.4a6.4 6.4 0 1 0 5.4 11.2z" fill="#c7d2fe" stroke="#3f4a8a" stroke-width="1.2" stroke-linejoin="round"/><path d="M14.5 4.2l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z" fill="#3f4a8a"/>',
    flocon: '<g stroke="#2b7bb9" stroke-width="1.5" stroke-linecap="round"><path d="M10 2v16M3 6l14 8M3 14l14-8"/><path d="M8 3.5l2 1.8 2-1.8M8 16.5l2-1.8 2 1.8M3.5 8.6l2.6-.5-.9-2.5M16.5 11.4l-2.6.5.9 2.5M3.5 11.4l2.6.5-.9 2.5M16.5 8.6l-2.6-.5.9-2.5"/></g>',
    bonhomme: '<circle cx="10" cy="13.3" r="4.6" fill="#fff" stroke="#17374b" stroke-width="1.2"/><circle cx="10" cy="6.4" r="3.2" fill="#fff" stroke="#17374b" stroke-width="1.2"/><path d="M10 6.6l2.6.7-2.6.5z" fill="#ef6c00"/><circle cx="8.9" cy="5.6" r=".55" fill="#17374b"/><circle cx="11" cy="5.6" r=".55" fill="#17374b"/><path d="M7.2 3.6h5.6M8 3.6V1.6h4v2" stroke="#17374b" stroke-width="1.1" fill="#17374b"/>',
    pousse: '<path d="M10 18v-7" stroke="#2e7d32" stroke-width="1.6" stroke-linecap="round"/><path d="M10 11C10 7 7 5 3 5c0 4 3 6 7 6z" fill="#a5d6a7" stroke="#2e7d32" stroke-width="1.2" stroke-linejoin="round"/><path d="M10 9.5c0-3.2 2.5-5 6.5-5 0 3.4-2.5 5-6.5 5z" fill="#c5e1a5" stroke="#2e7d32" stroke-width="1.2" stroke-linejoin="round"/><path d="M5.5 18h9" stroke="#8d6e63" stroke-width="1.6" stroke-linecap="round"/>',
    feuille: '<path d="M10 2.2l1.6 3.3 2.4-1.2-.6 3.6 3.4-.5-1.9 2.9 2.3 1-3.8 1.9.6 1.9-3.3-.7.2 3.9h-1.8l.2-3.9-3.3.7.6-1.9-3.8-1.9 2.3-1-1.9-2.9 3.4.5-.6-3.6 2.4 1.2z" fill="#f4a261" stroke="#b5482a" stroke-width="1.1" stroke-linejoin="round"/>',
    goutte: function(c){ return '<path d="M10 2.2C10 2.2 4.4 9 4.4 12.4a5.6 5.6 0 0 0 11.2 0C15.6 9 10 2.2 10 2.2z" fill="' + c + '" stroke="#1f5f8b" stroke-width="1.3" stroke-linejoin="round"/><path d="M7.4 12.6a2.6 2.6 0 0 0 2 2.4" stroke="#fff" stroke-width="1.3" stroke-linecap="round" fill="none"/>'; },
    nuage: function(bas){ return '<path d="M5.6 12.4a3.3 3.3 0 0 1 .3-6.6A4.4 4.4 0 0 1 14.4 6.6a2.9 2.9 0 0 1 .3 5.8z" fill="#e3edf3" stroke="#17374b" stroke-width="1.2" stroke-linejoin="round"/>' + bas; }
  };
  function svg(inner){ return '<svg class="cl-ic" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">' + inner + '</svg>'; }
  var PLUIE = '<path d="M7 14.2l-1 2.6M10.5 14.2l-1 2.6M14 14.2l-1 2.6" stroke="#2b7bb9" stroke-width="1.5" stroke-linecap="round"/>';
  var NEIGE = '<g fill="#2b7bb9"><circle cx="6.6" cy="15.6" r="1"/><circle cx="10" cy="17" r="1"/><circle cx="13.4" cy="15.6" r="1"/></g>';
  var ICONES = {
    t: svg(I.thermo(6.5, '#e76f51')), tx: svg(I.thermo(3.8, '#d62828')), tn: svg(I.thermo(10, '#4a90c2')),
    'tn-djf': svg(I.flocon), 'tx-djf': svg(I.bonhomme), 'tn-mam': svg(I.pousse), 'tn-son': svg(I.feuille),
    'tx-jja': svg(I.soleil), 'tn-jja': svg(I.lune),
    p: svg(I.goutte('#8ecae6')), 'p-djf': svg(I.nuage(NEIGE)), 'p-mam': svg(I.nuage(PLUIE).replace('#e3edf3', '#e8f5e9')),
    'p-jja': svg(I.nuage(PLUIE) + '<circle cx="15.4" cy="4.4" r="2.6" fill="#fde047" stroke="#c98a0b" stroke-width="1"/>'),
    'p-son': svg(I.nuage(PLUIE).replace('#e3edf3', '#fbe3d0'))
  };

  // lignes du tableau : g = thème ; v/per = couche CanDCS-U6
  var GROUPES = ['Températures', 'Gel et dégel', 'Chaleur', 'Précipitations'];
  var DEFS = [
    { id: 't', g: 0, lab: 'Moyenne annuelle', v: 'AirTemp', per: '', unit: '°C', dec: 1 },
    { id: 'tx', g: 0, lab: 'Maximale moyenne', v: 'AirTempMax', per: '', unit: '°C', dec: 1 },
    { id: 'tn', g: 0, lab: 'Minimale moyenne', v: 'AirTempMin', per: '', unit: '°C', dec: 1 },
    { id: 'tn-djf', g: 1, lab: 'Minimale, hiver', v: 'AirTempMin', per: '-DJF', unit: '°C', dec: 1 },
    { id: 'tx-djf', g: 1, lab: 'Maximale, hiver', v: 'AirTempMax', per: '-DJF', unit: '°C', dec: 1 },
    { id: 'tn-mam', g: 1, lab: 'Minimale, printemps', v: 'AirTempMin', per: '-MAM', unit: '°C', dec: 1 },
    { id: 'tn-son', g: 1, lab: 'Minimale, automne', v: 'AirTempMin', per: '-SON', unit: '°C', dec: 1 },
    { id: 'tx-jja', g: 2, lab: 'Maximale, été', v: 'AirTempMax', per: '-JJA', unit: '°C', dec: 1 },
    { id: 'tn-jja', g: 2, lab: 'Minimale, été (nuits)', v: 'AirTempMin', per: '-JJA', unit: '°C', dec: 1 },
    { id: 'p', g: 3, lab: 'Total annuel', v: 'Precip', per: '', unit: 'mm', dec: 0, pct: true },
    { id: 'p-djf', g: 3, lab: 'Hiver (déc.–févr.)', v: 'Precip', per: '-DJF', unit: 'mm', dec: 0, pct: true },
    { id: 'p-mam', g: 3, lab: 'Printemps (mars–mai)', v: 'Precip', per: '-MAM', unit: 'mm', dec: 0, pct: true },
    { id: 'p-jja', g: 3, lab: 'Été (juin–août)', v: 'Precip', per: '-JJA', unit: 'mm', dec: 0, pct: true },
    { id: 'p-son', g: 3, lab: 'Automne (sept.–nov.)', v: 'Precip', per: '-SON', unit: 'mm', dec: 0, pct: true }
  ];
  // périodes utiles par variable (moins de couches demandées depuis le retrait des « autres saisons »)
  var PERS_V = {};
  VARS.forEach(function(v){ PERS_V[v] = PERS.filter(function(p){ return DEFS.some(function(d){ return d.v === v && d.per === p; }); }); });

  // ------------------------------------------------------------------ fonctions pures (testées : tests/js/climat_smoke.mjs)
  function esc(s){
    var q = window.QA;
    if (q && q.esc) return q.esc(s == null ? '' : s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  var NFS = {};
  function nfd(dec){
    if (!NFS[dec]) NFS[dec] = new Intl.NumberFormat('fr-CA', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return NFS[dec];
  }
  /* nombre en français (virgule), moins typographique ; « — » si absent */
  function fmt(v, dec){
    if (v == null || !isFinite(v)) return '—';
    var s = nfd(dec).format(Math.abs(v) < Math.pow(10, -dec) / 2 ? 0 : v);
    return s.replace(/^-/, MINUS).replace(/ /g, ' ');      // espace fine insécable (milliers)
  }
  /* écart avec signe explicite : « +3,1 » / « −2,0 » / « 0,0 » */
  function fmtSigne(v, dec){
    if (v == null || !isFinite(v)) return '—';
    var t = fmt(v, dec);
    if (v > 0 && t.charAt(0) !== MINUS && !/^0([,.]0*)?$/.test(t)) return '+' + t;
    return t;
  }
  /* flèche qui double le signe (jamais la couleur seule) */
  function fleche(v, dec){
    if (v == null || !isFinite(v)) return '';
    var t = fmt(v, dec);
    if (/^[−-]?0([,.]0*)?$/.test(t)) return '=';
    return v > 0 ? '▲' : '▼';
  }
  /* centre de la cellule de grille (1/12°) qui contient le point */
  function cellCentre(lat, lon){
    return {
      lat: LAT0 + Math.round((lat - LAT0) / CELL) * CELL,
      lon: LON0 + Math.round((lon - LON0) / CELL) * CELL
    };
  }
  function distKm(la1, lo1, la2, lo2){
    var r = Math.PI / 180, dla = (la2 - la1) * r, dlo = (lo2 - lo1) * r;
    var a = Math.sin(dla / 2) * Math.sin(dla / 2) + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dlo / 2) * Math.sin(dlo / 2);
    return 12742 * Math.asin(Math.sqrt(a));
  }
  function coordTxt(lat, lon){
    return fmt(Math.abs(lat), 3) + ' ° ' + (lat >= 0 ? 'N' : 'S') + ', ' + fmt(Math.abs(lon), 3) + ' ° ' + (lon >= 0 ? 'E' : 'O');
  }
  function layerBase(ssp, v, pct, per){ return 'CanDCSU6-' + ssp + '_' + v + '-Pct' + pct + '_' + BASE + '_P0Y' + (per || ''); }
  function layerAno(ssp, v, pct, hor, per){ return 'CanDCSU6-' + ssp + '_' + v + 'Anomaly-Pct' + pct + '_' + hor + '_P0Y' + (per || ''); }
  /* couches d'une variable (3 percentiles × périodes utiles) : base (hor nul) ou écart */
  function layersVar(ssp, v, hor){
    var out = [];
    PCT_U6.forEach(function(p){ (PERS_V[v] || PERS).forEach(function(per){ out.push(hor ? layerAno(ssp, v, p, hor, per) : layerBase(ssp, v, p, per)); }); });
    return out;
  }
  /* URL WMS GetFeatureInfo (texte brut, une section « Layer '…' » par couche) ; WMS 1.3.0 EPSG:4326 : bbox = lat,lon */
  function urlGfi(layers, lat, lon){
    var d = 0.05, l = layers.join(',');
    return GM + '?service=WMS&version=1.3.0&request=GetFeatureInfo&layers=' + l + '&query_layers=' + l +
      '&crs=EPSG:4326&bbox=' + [lat - d, lon - d, lat + d, lon + d].map(function(x){ return x.toFixed(4); }).join(',') +
      '&width=101&height=101&i=50&j=50&info_format=text/plain&styles=';
  }
  /* analyse d'une réponse GetFeatureInfo text/plain → { vals: { couche: nombre|null }, x, y } (x, y : centre de la cellule) */
  function parseGfi(txt){
    var res = { vals: {}, x: null, y: null };
    if (typeof txt !== 'string') return res;
    var parts = txt.split("Layer '");
    for (var i = 1; i < parts.length; i++) {
      var p = parts[i], q = p.indexOf("'");
      if (q < 0) continue;
      var name = p.slice(0, q), m = /value_0\s*=\s*'([^']*)'/.exec(p), v = null;
      if (m) { v = parseFloat(m[1]); if (!isFinite(v) || Math.abs(v) > 1e6) v = null; }
      res.vals[name] = v;
      if (res.x == null) {
        var mx = /\bx\s*=\s*'([^']*)'/.exec(p), my = /\by\s*=\s*'([^']*)'/.exec(p);
        if (mx && my && isFinite(parseFloat(mx[1]))) { res.x = parseFloat(mx[1]); res.y = parseFloat(my[1]); }
      }
    }
    return res;
  }
  function plus(a, b){ return (a == null || b == null) ? null : a + b; }
  function ordre(v){
    // garde lo ≤ v ≤ hi même si les percentiles se croisent
    if (v.v == null) return v;
    var lo = v.lo, hi = v.hi;
    if (lo != null && hi != null && lo > hi) { v.lo = hi; v.hi = lo; }
    return v;
  }
  /* assemble les lignes du tableau.
     D = { base: {couche: v}, ano: {couche: v} } (null : pas encore reçu) ; ref = '1971-2000' (défaut) ou '2021-2050'.
     Chaque ligne : { def, base: {v, lo, hi}, fut: {v, lo, hi}, ec: {v, lo, hi, pct}, etat } ; etat : 'ok' | 'att' | 'nd' */
  function buildRows(D, ssp, hor, ref){
    ref = ref || BASE;
    var rows = [];
    DEFS.forEach(function(d){
      var r = { def: d, base: { v: null, lo: null, hi: null }, fut: { v: null, lo: null, hi: null }, ec: { v: null, lo: null, hi: null, pct: null }, etat: 'att' };
      var bs = D && D.base, an = D && D.ano;
      if (bs && an) {
        var g = function(m, name){ var x = m[name]; return x == null ? null : x; };
        var b50 = g(bs, layerBase(ssp, d.v, 50, d.per)), b10 = g(bs, layerBase(ssp, d.v, 10, d.per)), b90 = g(bs, layerBase(ssp, d.v, 90, d.per));
        var a50 = g(an, layerAno(ssp, d.v, 50, hor, d.per)), a10 = g(an, layerAno(ssp, d.v, 10, hor, d.per)), a90 = g(an, layerAno(ssp, d.v, 90, hor, d.per));
        r.fut = ordre({ v: plus(b50, a50), lo: plus(b50, a10), hi: plus(b50, a90) });
        if (ref === BASE) {
          r.base = ordre({ v: b50, lo: b10, hi: b90 });
          r.ec = ordre({ v: a50, lo: a10, hi: a90, pct: null });
        } else {
          var r50 = g(an, layerAno(ssp, d.v, 50, ref, d.per)), r10 = g(an, layerAno(ssp, d.v, 10, ref, d.per)), r90 = g(an, layerAno(ssp, d.v, 90, ref, d.per));
          r.base = ordre({ v: plus(b50, r50), lo: plus(b50, r10), hi: plus(b50, r90) });
          r.ec = { v: (a50 == null || r50 == null) ? null : a50 - r50, lo: null, hi: null, pct: null };
        }
        if (d.pct && r.base.v != null && r.base.v > 0 && r.ec.v != null) r.ec.pct = 100 * r.ec.v / r.base.v;
        r.etat = r.base.v == null || r.fut.v == null || r.ec.v == null ? 'nd' : 'ok';
      }
      rows.push(r);
    });
    return rows;
  }

  // ------------------------------------------------------------------ styles (injectés une seule fois)
  function css(){
    if (document.getElementById('cl-css')) return;
    var s = document.createElement('style'); s.id = 'cl-css';
    // Okabe-Ito : vermillon #D55E00 (hausse), bleu #0072B2 (baisse) ; toujours accompagnés d'une flèche et d'un signe
    s.textContent =
      '.cl-root{display:flex;flex-direction:column;gap:8px;font-size:.8rem;color:var(--ink);min-width:0}' +
      '.cl-top{margin:0;line-height:1.4;font-size:.76rem;color:var(--muted)}' +
      '.cl-ctl{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}' +
      '.cl-grp{display:flex;align-items:center;gap:6px}' +
      '.cl-grp>span{font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:650}' +
      '.cl-seg{display:inline-flex;border:1px solid #cbd8e1;border-radius:7px;overflow:hidden}' +
      '.cl-b{font:inherit;font-size:.76rem;border:0;background:#fff;color:var(--ink);padding:4px 8px;cursor:pointer;line-height:1.2;min-height:30px;white-space:nowrap}' +
      '.cl-seg .cl-b+.cl-b{border-left:1px solid #cbd8e1}' +
      '.cl-b:hover,.cl-b:focus-visible{background:#f1fbf7;outline:none}' +
      '.cl-b[aria-pressed="true"]{background:var(--navy,#102d41);color:#fff;font-weight:700}' +
      '.cl-b:disabled{color:#a9b6bf;background:#f6f8fa;cursor:not-allowed}' +
      '.cl-st{min-height:1.2em;color:var(--muted);font-size:.76rem;display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
      '.cl-st:empty{display:none}' +
      '.cl-st .cl-err{color:#7a4b00;background:#fff6e5;border:1px solid #efcf8f;border-radius:8px;padding:5px 9px;line-height:1.4}' +
      '.cl-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px;-webkit-overflow-scrolling:touch}' +
      '.cl-t{border-collapse:collapse;width:100%;min-width:480px;font-variant-numeric:tabular-nums}' +
      '.cl-t th,.cl-t td{padding:3px 8px;border-bottom:1px solid var(--line);vertical-align:middle;text-align:right;white-space:nowrap}' +
      '.cl-t th:first-child,.cl-t td:first-child{text-align:left}' +
      '.cl-t thead th{background:#f6f9fb;font-size:.68rem;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);font-weight:650}' +
      '.cl-t tr.cl-g th{background:#eef3f6;color:var(--ink);font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;text-align:left;font-weight:700;padding:2px 8px}' +
      '.cl-t tbody tr:last-child td{border-bottom:0}' +
      '.cl-lab{display:inline-flex;align-items:center;gap:7px;font-weight:600}' +
      '.cl-ic{flex:none}' +
      '.cl-u{color:var(--muted);font-size:.7rem;font-weight:400;margin-left:2px}' +
      '.cl-v{font-weight:600}' +
      '.cl-r{color:var(--muted);font-size:.68rem;font-weight:400;margin-left:4px}' +
      '.cl-up{color:#a84600;font-weight:700}' +
      '.cl-dn{color:#005f94;font-weight:700}' +
      '.cl-eq{color:var(--ink);font-weight:700}' +
      '.cl-foot{font-size:.7rem;line-height:1.45;color:var(--muted);margin:0}' +
      '.cl-foot a{color:var(--teal)}' +
      '@media (max-width:520px){.cl-t{min-width:0}.cl-t th,.cl-t td{padding:3px 4px}.cl-grp{flex-wrap:wrap}.cl-r,.cl-u{display:none}.cl-lab{gap:4px;white-space:normal}.cl-t td:first-child{white-space:normal}}';   // v0.7.1 : 4 colonnes sans défilement latéral
    document.head.appendChild(s);
  }

  // ------------------------------------------------------------------ rendu du tableau (chaîne HTML)
  function rngTitle(x, d){ return (x.lo != null && x.hi != null) ? ' title="Plage des modèles (p10–p90) : ' + fmt(x.lo, d.dec) + ' à ' + fmt(x.hi, d.dec) + ' ' + esc(d.unit) + '"' : ''; }
  function celVal(x, d){
    if (x.v == null) return '<td>—</td>';
    return '<td' + rngTitle(x, d) + '><span class="cl-v">' + fmt(x.v, d.dec) + '</span></td>';
  }
  function celEcart(r){
    var d = r.def, e = r.ec;
    if (e.v == null) return '<td>—</td>';
    var cls = e.v > 0 ? 'cl-up' : (e.v < 0 ? 'cl-dn' : 'cl-eq');
    var sub = [];
    if (e.pct != null) sub.push(fmtSigne(e.pct, 0) + ' %');
    if (e.lo != null && e.hi != null) sub.push(fmtSigne(e.lo, d.dec) + ' à ' + fmtSigne(e.hi, d.dec));
    return '<td><span class="' + cls + '">' + fleche(e.v, d.dec) + ' ' + fmtSigne(e.v, d.dec) + '</span>' +
      (sub.length ? '<span class="cl-r"' + (e.lo != null ? ' title="Plage des modèles (p10–p90) du changement"' : '') + '>(' + sub.join(' · ') + ')</span>' : '') + '</td>';
  }
  function tableHtml(rows, S){
    var ref = S.ref || BASE;
    var h = ['<table class="cl-t"><caption style="position:absolute;left:-9999px">Indices climatiques à l’ouvrage : référence ', esc(ref), ' et ', esc(S.hor), '</caption>',
      '<thead><tr><th scope="col">Indice</th><th scope="col">', ref.replace('-', '–'), '</th><th scope="col">', S.hor.replace('-', '–'), '</th><th scope="col">Écart</th></tr></thead>'];
    for (var g = 0; g < GROUPES.length; g++) {
      var part = [];
      rows.forEach(function(r){
        if (r.def.g !== g) return;
        var d = r.def, cells;
        if (r.etat === 'att') cells = '<td colspan="3" style="text-align:center;color:var(--muted)">' + (S.panne ? 'service indisponible' : 'chargement…') + '</td>';
        else if (r.etat === 'nd') cells = '<td colspan="3" style="text-align:center;color:var(--muted)">sans valeur pour cette cellule</td>';
        else cells = celVal(r.base, d) + celVal(r.fut, d) + celEcart(r);
        part.push('<tr><td><span class="cl-lab">' + (ICONES[d.id] || '') + esc(d.lab) + '<span class="cl-u">' + esc(d.unit) + '</span></span></td>' + cells + '</tr>');
      });
      if (part.length) h.push('<tbody><tr class="cl-g"><th colspan="4" scope="colgroup">' + esc(GROUPES[g]) + '</th></tr>' + part.join('') + '</tbody>');
    }
    h.push('</table>');
    return h.join('');
  }

  // ------------------------------------------------------------------ fenêtre
  function render(o, body, ctx){
    css();
    var QA = window.QA;
    var lat = +o.lat, lon = +o.lon;
    if (!isFinite(lat) || !isFinite(lon)) { body.innerHTML = '<div class="ld-wait">Cet ouvrage n’a pas de coordonnées : pas de valeurs climatiques.</div>'; return; }
    var cell = cellCentre(lat, lon);
    var dist = distKm(lat, lon, cell.lat, cell.lon);
    var S = { ssp: 'SSP245', hor: '2041-2070', ref: BASE };
    var closed = false;
    var J = {};                // jobs de cette fenêtre : clé → { st: 0 en cours | 1 ok | 2 échec }
    var QU = [], running = 0, nextAt = 0;
    ctx.onClose(function(){ closed = true; QU.length = 0; });
    var base = [o.route, o.obstacle].filter(Boolean).join(' → ') || o.nom || '';
    if (ctx.setSub) ctx.setSub(base);

    function seg(nom, attr, items){
      return '<div class="cl-grp" role="group" aria-label="' + esc(nom) + '"><span>' + esc(nom) + '</span><div class="cl-seg">' + items.map(function(it){
        return '<button type="button" class="cl-b" ' + attr + '="' + it.k + '" aria-pressed="false"' + (it.t ? ' title="' + esc(it.t) + '"' : '') + '>' + esc(it.l) + '</button>'; }).join('') + '</div></div>';
    }
    var root = document.createElement('div'); root.className = 'cl-root';
    root.innerHTML =
      '<p class="cl-top">Cellule d’environ 6 × 10 km centrée à ' + esc(coordTxt(cell.lat, cell.lon)) + ' (' + esc(fmt(dist, 1)) + ' km de l’ouvrage). ' +
      'Valeurs de modèles régionalisés (médiane de 26 modèles), pas une mesure au pont ; information brute, sans note de risque.</p>' +
      '<div class="cl-ctl">' +
      seg('Référence', 'data-ref', REFS.map(function(k){ return { k: k, l: k.replace('-', '–') }; })) +
      seg('Horizon', 'data-hor', HORS.map(function(h){ return { k: h.k, l: h.k.replace('-', '–') }; })) +
      seg('Scénario', 'data-ssp', SSPS.map(function(s){ return { k: s.k, l: s.nom, t: s.desc }; })) +
      '</div>' +
      '<div class="cl-st" role="status" aria-live="polite"></div>' +
      '<div class="cl-wrap"></div>' +
      '<p class="cl-foot"></p>';
    body.innerHTML = ''; body.appendChild(root);
    var elSt = root.querySelector('.cl-st'), elWrap = root.querySelector('.cl-wrap');

    function sspObj(){ for (var i = 0; i < SSPS.length; i++) if (SSPS[i].k === S.ssp) return SSPS[i]; return SSPS[1]; }

    // ----- file de requêtes : au plus MAXPAR en parallèle, départs espacés
    function pump(){
      while (!closed && running < MAXPAR && QU.length) {
        var fn = QU.shift(), now = Date.now(), at = Math.max(now, nextAt);
        nextAt = at + ECART_WMS;
        running++;
        (function(fn, wait){
          setTimeout(function(){
            if (closed) { running--; return; }
            fn().then(function(){}, function(){}).then(function(){ running--; pump(); });
          }, wait);
        })(fn, at - now);
      }
    }
    function fetchTxt(url, ms){
      if (QA && QA.fetchT) return QA.fetchT(url, {}, ms, 'text');
      return fetch(url).then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
    }
    // ----- une tâche par variable et par période (base 1971-2000 ou écart d'un horizon)
    var U6 = {};                // valeurs reçues, par « ssp|hor » (hor vide = base)
    function loadU6(ssp, hor){
      VARS.forEach(function(v){
        var key = ssp + '|' + (hor || '') + '|' + v, ck = cell.lat + '|' + cell.lon + '|' + key;
        if (CACHE[ck]) { hold(ssp, hor, CACHE[ck]); J[key] = { st: 1 }; return; }
        if (J[key] && J[key].st !== 2) return;
        J[key] = { st: 0 };
        QU.push(function(){
          if (closed) return Promise.resolve();
          return fetchTxt(urlGfi(layersVar(ssp, v, hor), lat, lon), T_WMS).then(function(t){
            var p = parseGfi(t);
            if (!Object.keys(p.vals).length) throw new Error('réponse vide');
            CACHE[ck] = p.vals; hold(ssp, hor, p.vals); J[key] = { st: 1 };
          }, function(e){ J[key] = { st: 2, err: e }; }).then(function(){ if (!closed && ctx.alive()) draw(); });
        });
      });
      pump();
    }
    function hold(ssp, hor, vals){
      var k = ssp + '|' + (hor || '');
      U6[k] = U6[k] || {};
      Object.keys(vals).forEach(function(n){ U6[k][n] = vals[n]; });
    }
    function pret(ssp, hor){ return VARS.every(function(v){ var j = J[ssp + '|' + (hor || '') + '|' + v]; return j && j.st === 1; }); }
    function nb(st){ var n = 0; Object.keys(J).forEach(function(k){ if (J[k].st === st) n++; }); return n; }

    function demarrer(){
      if (S.ref !== BASE && S.hor === S.ref) S.hor = HORS[1].k;      // l'horizon doit suivre la référence
      loadU6(S.ssp, null);
      loadU6(S.ssp, S.hor);
      if (S.ref !== BASE) loadU6(S.ssp, S.ref);
      draw();
    }

    // ----- dessin
    function draw(){
      if (closed || !ctx.alive()) return;
      var s = sspObj();
      Array.prototype.forEach.call(root.querySelectorAll('[data-ssp]'), function(b){ b.setAttribute('aria-pressed', String(b.getAttribute('data-ssp') === S.ssp)); });
      Array.prototype.forEach.call(root.querySelectorAll('[data-ref]'), function(b){ b.setAttribute('aria-pressed', String(b.getAttribute('data-ref') === S.ref)); });
      Array.prototype.forEach.call(root.querySelectorAll('[data-hor]'), function(b){
        var k = b.getAttribute('data-hor'), off = S.ref !== BASE && k <= S.ref;      // horizon postérieur à la référence
        b.disabled = off; b.title = off ? 'Choisir un horizon postérieur à la référence' : '';
        b.setAttribute('aria-pressed', String(k === S.hor));
      });
      var ok = pret(S.ssp, null) && pret(S.ssp, S.hor) && (S.ref === BASE || pret(S.ssp, S.ref));
      var ano = {};
      if (ok) [S.hor, S.ref].forEach(function(h){ var m = U6[S.ssp + '|' + h]; if (m) Object.keys(m).forEach(function(n){ ano[n] = m[n]; }); });
      var rows = buildRows(ok ? { base: U6[S.ssp + '|'], ano: ano } : null, S.ssp, S.hor, S.ref), ech = nb(2), enc = nb(0);
      S.panne = ech > 0;
      elWrap.innerHTML = tableHtml(rows, S);
      var msg = '';
      if (enc) msg = '<span class="ld-spin" aria-hidden="true"></span><span>Chargement auprès d’ECCC…</span>';
      if (ech) msg += '<span class="cl-err">Service GeoMet-Climate d’ECCC indisponible ou trop lent. <button type="button" class="cl-b" data-retry>Réessayer</button></span>';
      var vus = rows.filter(function(r){ return r.etat !== 'att'; });
      if (vus.length && vus.every(function(r){ return r.etat === 'nd'; })) msg = '<span class="cl-err">Aucune valeur pour cette cellule : l’ouvrage est hors de la grille (en mer ou hors du Canada).</span>';
      elSt.innerHTML = msg;
      root.querySelector('.cl-foot').innerHTML =
        '<b>Lecture.</b> ' + (S.ref === BASE ? 'Écart : changement médian, ' : 'Écart : différence des médianes des deux périodes, ') +
        esc(s.nom) + ' (' + esc(s.desc) + ')' + (S.ref === BASE ? ' ; entre parenthèses, plage p10–p90 des modèles' : '') + ' ; survol d’une valeur : plage des modèles. ' +
        'Non disponibles : jours de gel, cycles gel-dégel, pluies maximales sur 1 ou 5 jours.<br>' +
        'Source : ECCC, scénarios CMIP6 réduits CanDCS-U6 (26 modèles, BCCAQv2, grille ≈ 10 km), ' +
        '<a href="' + SRC_DS + '" target="_blank" rel="noopener">jeu de données</a>, <a href="' + SRC_DOC + '" target="_blank" rel="noopener">documentation</a> ; ' +
        '<a href="' + LICENCE + '" target="_blank" rel="noopener">Licence du gouvernement ouvert – Canada</a>. Autres indices : <a href="' + PORTAIL + '" target="_blank" rel="noopener">climatedata.ca</a>.';
    }

    // ----- interactions
    root.addEventListener('click', function(ev){
      var b = ev.target.closest ? ev.target.closest('button') : null;
      if (!b || !root.contains(b) || b.disabled) return;
      if (b.hasAttribute('data-ssp')) S.ssp = b.getAttribute('data-ssp');
      else if (b.hasAttribute('data-hor')) S.hor = b.getAttribute('data-hor');
      else if (b.hasAttribute('data-ref')) S.ref = b.getAttribute('data-ref');
      else if (b.hasAttribute('data-retry')) Object.keys(J).forEach(function(k){ if (J[k].st === 2) delete J[k]; });
      else return;
      demarrer();
    });
    demarrer();
  }

  var CACHE = {};                 // valeurs déjà reçues (survit à la fermeture de la fenêtre), par cellule et par requête

  window.QA_MOD.climat = {
    render: render,
    _t: {
      fmt: fmt, fmtSigne: fmtSigne, fleche: fleche, cellCentre: cellCentre, distKm: distKm, coordTxt: coordTxt,
      layerBase: layerBase, layerAno: layerAno, layersVar: layersVar, urlGfi: urlGfi, parseGfi: parseGfi,
      buildRows: buildRows, tableHtml: tableHtml, ICONES: ICONES,
      DEFS: DEFS, SSPS: SSPS, HORS: HORS, REFS: REFS, VARS: VARS, PERS: PERS, PERS_V: PERS_V, GROUPES: GROUPES
    }
  };
})();
