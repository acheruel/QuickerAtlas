/* « Climat futur à l'ouvrage » : fenêtre de QuickerAtlas (prototype v0.7.0, à élaguer : l'utilisateur choisira les
   indices à garder). Module chargé à la demande (openAux). Contrat : window.QA_MOD.climat.render(o, body, ctx).

   Question : comment le climat de la cellule de grille (~6 × 10 km) qui contient l'ouvrage change-t-il, entre la période
   de référence 1971-2000 et un horizon futur (2021-2050, 2041-2070 ou 2071-2100) selon un scénario d'émissions ?
   Information brute : médiane (p50) et plage p10–p90 des modèles, SANS note ni indice de risque.

   Sources (ECCC, Licence du gouvernement ouvert – Canada ; interrogées en direct, CORS ouvert : Access-Control-Allow-Origin: *) :
   A. GeoMet-Climate, WMS GetFeatureInfo (https://geo.weather.gc.ca/geomet-climate), scénarios CMIP6 réduits statistiquement
      CanDCS-U6 (26 modèles, méthode BCCAQv2, grille de 1/12° ≈ 6 × 10 km) ; 3 scénarios SSP1-2.6 / SSP2-4.5 / SSP5-8.5.
      Couches utilisées (moyennes sur 30 ans, annuelles et saisonnières DJF/MAM/JJA/SON) :
        référence  CanDCSU6-<SSP>_<VAR>-Pct<10|50|90>_1971-2000_P0Y[-<SAISON>]
        écart      CanDCSU6-<SSP>_<VAR>Anomaly-Pct<10|50|90>_<2021-2050|2041-2070|2071-2100>_P0Y[-<SAISON>]
      avec VAR = AirTemp (moyenne), AirTempMax, AirTempMin (°C), Precip (mm par an ou par saison). Les écarts sont des
      différences simples, y compris pour les précipitations (en mm, vérifié ; la légende de GeoMet parle de « % »).
      Valeur future = valeur de référence p50 + écart (p10, p50 ou p90) ; la plage p10–p90 est donc celle du CHANGEMENT.
   B. API OGC d'ECCC (https://api.weather.gc.ca/collections/climate:indices:{historical,projected}/coverage, f=json, bbox
      d'une cellule, datetime, subset=percentile(n),scenario(RCPx.y)) : indices annuels CanDCS-U5 (CMIP5, scénarios RCP2.6 /
      4.5 / 8.5, percentiles 5 / 50 / 95 des modèles, une valeur par an) : tx30 (jours > 30 °C), tn20 (nuits > 20 °C), cdd et
      hdd (degrés-jours de climatisation et de chauffage, base 18 °C), prep1 (jours > 1 mm). Aucun indice équivalent n'existe
      pour CMIP6 : ces lignes portent l'étiquette « CMIP5 ». La valeur d'une période = moyenne des valeurs annuelles
      (référence 1971-2000 : collection « historical » ; futur : collection « projected »).
   Indisponibles dans ces jeux (vérifié) : jours de gel, cycles gel-dégel, précipitations maximales sur 1 ou 5 jours.
   Pas de requête vers climatedata.ca (hôte d'API injoignable lors de la recherche). Les valeurs mensuelles de l'API OGC
   sont trop lentes (> 2 min) pour une page : écartées.

   Daltonisme : jamais la couleur seule (signe +/−, flèche ▲/▼, texte) ; palette Okabe-Ito.
   ES5, sans dépendance ; contrat avec la page : window.QA (esc, fetchT). Tests : tests/js/climat_smoke.mjs. */
(function(){
  'use strict';
  window.QA_MOD = window.QA_MOD || {};

  // ------------------------------------------------------------------ constantes
  var GM = 'https://geo.weather.gc.ca/geomet-climate';
  var OGC = 'https://api.weather.gc.ca/collections/';
  var CELL = 1 / 12;                                   // résolution des grilles (degrés)
  var LON0 = -140.95833333, LAT0 = 41.04166667;        // centre de la cellule d'origine (grille CanDCS-U6)
  var REF = '1971-2000';
  var SSPS = [
    { k: 'SSP126', nom: 'SSP1-2.6', rcp: 'RCP2.6', desc: 'émissions faibles' },
    { k: 'SSP245', nom: 'SSP2-4.5', rcp: 'RCP4.5', desc: 'émissions intermédiaires' },
    { k: 'SSP585', nom: 'SSP5-8.5', rcp: 'RCP8.5', desc: 'émissions élevées' }
  ];
  var HORS = [
    { k: '2021-2050', a: 2021, b: 2050 },
    { k: '2041-2070', a: 2041, b: 2070 },
    { k: '2071-2100', a: 2071, b: 2100 }
  ];
  var VARS = ['AirTemp', 'AirTempMax', 'AirTempMin', 'Precip'];
  var SAISONS = { '': 'annuel', '-DJF': 'hiver (déc.–févr.)', '-MAM': 'printemps (mars–mai)', '-JJA': 'été (juin–août)', '-SON': 'automne (sept.–nov.)' };
  var PERS = ['', '-DJF', '-MAM', '-JJA', '-SON'];
  var IDX_PROPS = ['tx30', 'tn20', 'cdd', 'hdd', 'prep1'];
  var PCT_U6 = [10, 50, 90];
  var PCT_IDX = [5, 50, 95];
  var SRC_DS = 'https://open.canada.ca/data/en/dataset/f73d6939-912a-4add-a291-c233fc5d1946';
  var SRC_IDX = 'https://eccc-msc.github.io/open-data/msc-data/climate_indices/readme_climateindices_en/';
  var SRC_DOC = 'https://eccc-msc.github.io/open-data/msc-data/climate_cmip6/readme_cmip6_en/';
  var LICENCE = 'https://ouvert.canada.ca/fr/licence-du-gouvernement-ouvert-canada';
  var PORTAIL = 'https://climatedata.ca/';
  var GEOMET_PAGE = 'https://eccc-msc.github.io/open-data/msc-data/climate_cmip6/readme_cmip6_en/';
  var T_WMS = 30000, T_OGC = 60000;
  var MAXPAR = 4, ECART_WMS = 300, ECART_OGC = 1000;   // requêtes simultanées ; délai minimal entre départs vers un même hôte (ms)
  var MINUS = '−';

  // lignes du tableau : g = thème ; v/per = couche CanDCS-U6 ; idx = indice CMIP5 ; sec = rangée repliée (« autres saisons »)
  var GROUPES = ['Températures', 'Gel et dégel', 'Chaleur', 'Précipitations', 'Autres saisons'];
  var DEFS = [
    { id: 't', g: 0, lab: 'Température moyenne', v: 'AirTemp', per: '', unit: '°C', dec: 1 },
    { id: 'tx', g: 0, lab: 'Température maximale moyenne', v: 'AirTempMax', per: '', unit: '°C', dec: 1 },
    { id: 'tn', g: 0, lab: 'Température minimale moyenne', v: 'AirTempMin', per: '', unit: '°C', dec: 1 },
    { id: 'tn-djf', g: 1, lab: 'Minimale moyenne, hiver', v: 'AirTempMin', per: '-DJF', unit: '°C', dec: 1 },
    { id: 'tx-djf', g: 1, lab: 'Maximale moyenne, hiver', v: 'AirTempMax', per: '-DJF', unit: '°C', dec: 1 },
    { id: 'tn-mam', g: 1, lab: 'Minimale moyenne, printemps', v: 'AirTempMin', per: '-MAM', unit: '°C', dec: 1 },
    { id: 'tn-son', g: 1, lab: 'Minimale moyenne, automne', v: 'AirTempMin', per: '-SON', unit: '°C', dec: 1 },
    { id: 'hdd', g: 1, lab: 'Degrés-jours de chauffage (sous 18 °C)', idx: 'hdd', unit: '°C·jour/an', dec: 0 },
    { id: 'tx-jja', g: 2, lab: 'Maximale moyenne, été', v: 'AirTempMax', per: '-JJA', unit: '°C', dec: 1 },
    { id: 'tn-jja', g: 2, lab: 'Minimale moyenne, été', v: 'AirTempMin', per: '-JJA', unit: '°C', dec: 1 },
    { id: 'tx30', g: 2, lab: 'Jours à plus de 30 °C', idx: 'tx30', unit: 'jours/an', dec: 0 },
    { id: 'tn20', g: 2, lab: 'Nuits tropicales (minimale > 20 °C)', idx: 'tn20', unit: 'nuits/an', dec: 0 },
    { id: 'cdd', g: 2, lab: 'Degrés-jours de climatisation (sur 18 °C)', idx: 'cdd', unit: '°C·jour/an', dec: 0 },
    { id: 'p', g: 3, lab: 'Précipitations totales', v: 'Precip', per: '', unit: 'mm/an', dec: 0, pct: true },
    { id: 'p-djf', g: 3, lab: 'Précipitations, hiver', v: 'Precip', per: '-DJF', unit: 'mm', dec: 0, pct: true },
    { id: 'p-mam', g: 3, lab: 'Précipitations, printemps', v: 'Precip', per: '-MAM', unit: 'mm', dec: 0, pct: true },
    { id: 'p-jja', g: 3, lab: 'Précipitations, été', v: 'Precip', per: '-JJA', unit: 'mm', dec: 0, pct: true },
    { id: 'p-son', g: 3, lab: 'Précipitations, automne', v: 'Precip', per: '-SON', unit: 'mm', dec: 0, pct: true },
    { id: 'prep1', g: 3, lab: 'Jours de précipitations (plus de 1 mm)', idx: 'prep1', unit: 'jours/an', dec: 0 },
    { id: 't-djf', g: 4, lab: 'Moyenne, hiver', v: 'AirTemp', per: '-DJF', unit: '°C', dec: 1 },
    { id: 't-mam', g: 4, lab: 'Moyenne, printemps', v: 'AirTemp', per: '-MAM', unit: '°C', dec: 1 },
    { id: 't-jja', g: 4, lab: 'Moyenne, été', v: 'AirTemp', per: '-JJA', unit: '°C', dec: 1 },
    { id: 't-son', g: 4, lab: 'Moyenne, automne', v: 'AirTemp', per: '-SON', unit: '°C', dec: 1 },
    { id: 'tx-mam', g: 4, lab: 'Maximale moyenne, printemps', v: 'AirTempMax', per: '-MAM', unit: '°C', dec: 1 },
    { id: 'tx-son', g: 4, lab: 'Maximale moyenne, automne', v: 'AirTempMax', per: '-SON', unit: '°C', dec: 1 }
  ];

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
    return s.replace(/^-/, MINUS).replace(/ /g, ' ');
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
  function layerBase(ssp, v, pct, per){ return 'CanDCSU6-' + ssp + '_' + v + '-Pct' + pct + '_' + REF + '_P0Y' + (per || ''); }
  function layerAno(ssp, v, pct, hor, per){ return 'CanDCSU6-' + ssp + '_' + v + 'Anomaly-Pct' + pct + '_' + hor + '_P0Y' + (per || ''); }
  /* couches d'une variable (3 percentiles × 5 périodes = 15) : base ou écart */
  function layersVar(ssp, v, hor){
    var out = [];
    PCT_U6.forEach(function(p){ PERS.forEach(function(per){ out.push(hor ? layerAno(ssp, v, p, hor, per) : layerBase(ssp, v, p, per)); }); });
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
  /* URL de l'API OGC « coverage » pour une cellule (bbox serrée autour du centre) */
  function urlIdx(proj, c, pct, rcp, dt){
    var b = [c.lon - 0.02, c.lat - 0.02, c.lon + 0.02, c.lat + 0.02].map(function(x){ return x.toFixed(4); }).join(',');
    return OGC + 'climate:indices:' + (proj ? 'projected' : 'historical') + '/coverage?f=json&bbox=' + b +
      '&properties=' + IDX_PROPS.join(',') + '&datetime=' + dt + '&subset=percentile(' + pct + ')' + (proj ? ',scenario(' + rcp + ')' : '');
  }
  /* analyse d'une réponse « coverage » (CoverageJSON) → { years: [n…], props: { nom: [valeurs…] }, x, y } ; valeurs absentes → null */
  function parseCoverage(j){
    var out = { years: [], props: {}, x: null, y: null };
    if (!j || !j.domain || !j.ranges) return out;
    var ax = j.domain.axes || {};
    (ax.t && ax.t.values || []).forEach(function(t){ out.years.push(parseInt(String(t).slice(0, 4), 10)); });
    if (ax.x) out.x = ax.x.start; if (ax.y) out.y = ax.y.start;
    Object.keys(j.ranges).forEach(function(k){
      out.props[k] = (j.ranges[k].values || []).map(function(v){ return (v == null || !isFinite(v)) ? null : +v; });
    });
    return out;
  }
  /* moyenne de la série `arr` (années `years`) sur [a, b], valeurs absentes ignorées ; null s'il en manque plus de 20 % */
  function moyenne(years, arr, a, b){
    if (!years || !arr) return null;
    var s = 0, n = 0, tot = b - a + 1;
    for (var i = 0; i < years.length; i++) if (years[i] >= a && years[i] <= b && arr[i] != null) { s += arr[i]; n++; }
    return n >= tot * 0.8 && n > 0 ? s / n : null;
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
     D = { base: {couche: v}, ano: {couche: v}, idxH: {5|50|95: coverage analysé}, idxF: {…} } (éléments manquants : null)
     Chaque ligne : { def, base: {v, lo, hi}, fut: {v, lo, hi}, ec: {v, lo, hi, pct}, etat } ; etat : 'ok' | 'att' (données pas encore là) | 'nd' (sans valeur) */
  function buildRows(D, ssp, hor){
    var H = null, i;
    for (i = 0; i < HORS.length; i++) if (HORS[i].k === hor) H = HORS[i];
    var rows = [];
    DEFS.forEach(function(d){
      var r = { def: d, base: { v: null, lo: null, hi: null }, fut: { v: null, lo: null, hi: null }, ec: { v: null, lo: null, hi: null, pct: null }, etat: 'att' };
      if (d.v) {
        var bs = D.base, an = D.ano;
        if (bs && an) {
          var g = function(m, name){ var x = m[name]; return x == null ? null : x; };
          var b50 = g(bs, layerBase(ssp, d.v, 50, d.per)), b10 = g(bs, layerBase(ssp, d.v, 10, d.per)), b90 = g(bs, layerBase(ssp, d.v, 90, d.per));
          var a50 = g(an, layerAno(ssp, d.v, 50, hor, d.per)), a10 = g(an, layerAno(ssp, d.v, 10, hor, d.per)), a90 = g(an, layerAno(ssp, d.v, 90, hor, d.per));
          r.base = ordre({ v: b50, lo: b10, hi: b90 });
          r.fut = ordre({ v: plus(b50, a50), lo: plus(b50, a10), hi: plus(b50, a90) });
          r.ec = ordre({ v: a50, lo: a10, hi: a90, pct: null });
          if (d.pct && b50 != null && b50 > 0 && a50 != null) r.ec.pct = 100 * a50 / b50;
          r.etat = b50 == null || a50 == null ? 'nd' : 'ok';
        }
      } else if (d.idx) {
        var h = D.idxH, f = D.idxF;
        if (h && f && h[50] && f[50]) {
          var one = function(S, pct, a, b){ return S[pct] ? moyenne(S[pct].years, S[pct].props[d.idx], a, b) : null; };
          r.base = ordre({ v: one(h, 50, 1971, 2000), lo: one(h, 5, 1971, 2000), hi: one(h, 95, 1971, 2000) });
          r.fut = ordre({ v: one(f, 50, H.a, H.b), lo: one(f, 5, H.a, H.b), hi: one(f, 95, H.a, H.b) });
          r.ec = { v: (r.base.v == null || r.fut.v == null) ? null : r.fut.v - r.base.v, lo: null, hi: null, pct: null };
          r.etat = r.ec.v == null ? 'nd' : 'ok';
        }
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
      '.cl-root{display:flex;flex-direction:column;gap:10px;font-size:.82rem;color:var(--ink);min-width:0}' +
      '.cl-top{margin:0;line-height:1.45}' +
      '.cl-top small{color:var(--muted)}' +
      '.cl-ctl{display:flex;flex-wrap:wrap;gap:8px 14px}' +
      '.cl-ctl fieldset{border:1px solid var(--line);border-radius:8px;padding:4px 8px 8px;margin:0;min-width:0}' +
      '.cl-ctl legend{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:650;padding:0 4px}' +
      '.cl-seg{display:flex;flex-wrap:wrap;gap:4px}' +
      '.cl-b{font:inherit;border:1px solid #cbd8e1;background:#fff;color:var(--ink);border-radius:6px;padding:5px 10px;cursor:pointer;line-height:1.25;text-align:left;min-height:34px}' +
      '.cl-b small{display:block;color:var(--muted);font-size:.7rem;font-weight:400}' +
      '.cl-b:hover,.cl-b:focus-visible{border-color:var(--teal);outline:none;background:#f1fbf7}' +
      '.cl-b[aria-pressed="true"]{border:2px solid var(--teal);background:var(--mint);font-weight:700;padding:4px 9px}' +
      '.cl-b[aria-pressed="true"]:before{content:"\\2713\\00a0"}' +
      '.cl-st{min-height:1.4em;color:var(--muted);font-size:.78rem;display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
      '.cl-st .cl-err{color:#7a4b00;background:#fff6e5;border:1px solid #efcf8f;border-radius:8px;padding:6px 10px;line-height:1.4}' +
      '.cl-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px;-webkit-overflow-scrolling:touch}' +
      '.cl-t{border-collapse:collapse;width:100%;min-width:520px;font-variant-numeric:tabular-nums}' +
      '.cl-t th,.cl-t td{padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top;text-align:right}' +
      '.cl-t th:first-child,.cl-t td:first-child{text-align:left}' +
      '.cl-t thead th{background:#f6f9fb;font-size:.72rem;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);font-weight:650;vertical-align:bottom}' +
      '.cl-t tr.cl-g th{background:#eef3f6;color:var(--ink);font-size:.74rem;letter-spacing:.06em;text-transform:uppercase;text-align:left;font-weight:700}' +
      '.cl-t tr:last-child td{border-bottom:0}' +
      '.cl-lab{font-weight:600}' +
      '.cl-u{display:block;color:var(--muted);font-size:.72rem;font-weight:400}' +
      '.cl-tag{display:inline-block;font-size:.66rem;font-weight:700;border:1px solid #9fb2bf;border-radius:4px;padding:0 4px;margin-left:5px;color:var(--muted);vertical-align:1px;letter-spacing:.03em}' +
      '.cl-v{font-weight:600;white-space:nowrap}' +
      '.cl-r{display:block;color:var(--muted);font-size:.72rem;font-weight:400;white-space:nowrap}' +
      '.cl-up{color:#a84600;font-weight:700;white-space:nowrap}' +
      '.cl-dn{color:#005f94;font-weight:700;white-space:nowrap}' +
      '.cl-eq{color:var(--ink);font-weight:700;white-space:nowrap}' +
      '.cl-bar{display:block;height:4px;border-radius:2px;margin-top:3px;background:#9fb2bf}' +
      '.cl-bar.f{background:#34576b}' +
      '.cl-bars{display:block;min-width:56px}' +
      '.cl-tog{font:inherit;border:0;background:none;color:var(--teal);text-decoration:underline;cursor:pointer;padding:6px 0;text-align:left;min-height:32px}' +
      '.cl-note{font-size:.78rem;line-height:1.5;background:#f6f9fb;border-left:3px solid var(--teal);padding:7px 11px;border-radius:0 8px 8px 0;margin:0}' +
      '.cl-foot{font-size:.74rem;line-height:1.5;color:var(--muted);margin:0}' +
      '.cl-foot a{color:var(--teal)}' +
      '.cl-proto{font-size:.72rem;color:var(--muted);margin:0;text-align:right}' +
      '@media (max-width:520px){.cl-t th,.cl-t td{padding:4px 6px}.cl-b{padding:4px 8px}}';
    document.head.appendChild(s);
  }

  // ------------------------------------------------------------------ rendu du tableau (chaîne HTML)
  function celVal(x, d){
    if (x.v == null) return '<td>—</td>';
    var rng = (x.lo != null && x.hi != null) ? '<span class="cl-r" title="Plage des modèles">' + fmt(x.lo, d.dec) + ' – ' + fmt(x.hi, d.dec) + '</span>' : '';
    return '<td><span class="cl-v">' + fmt(x.v, d.dec) + '</span>' + rng + '</td>';
  }
  function celEcart(r){
    var d = r.def, e = r.ec;
    if (e.v == null) return '<td>—</td>';
    var cls = e.v > 0 ? 'cl-up' : (e.v < 0 ? 'cl-dn' : 'cl-eq');
    var fl = fleche(e.v, d.dec), main = '<span class="' + cls + '">' + fl + ' ' + fmtSigne(e.v, d.dec) + '</span>';
    var sub = [];
    if (e.pct != null) sub.push(fmtSigne(e.pct, 1) + ' %');
    if (e.lo != null && e.hi != null) sub.push(fmtSigne(e.lo, d.dec) + ' – ' + fmtSigne(e.hi, d.dec));
    return '<td>' + main + (sub.length ? '<span class="cl-r" title="Plage des modèles (p10–p90)">' + sub.join(' · ') + '</span>' : '') + '</td>';
  }
  function barres(r){
    // barres de comparaison (gris = référence, foncé = futur) seulement pour les grandeurs à zéro absolu (pas les °C) ; le texte porte déjà les valeurs
    var b = r.base.v, f = r.fut.v;
    if (r.def.unit === '°C' || b == null || f == null || b <= 0 || f <= 0) return '';
    var m = Math.max(b, f);
    return '<span class="cl-bars" aria-hidden="true"><span class="cl-bar" style="width:' + Math.round(100 * b / m) + '%"></span><span class="cl-bar f" style="width:' + Math.round(100 * f / m) + '%"></span></span>';
  }
  function tableHtml(rows, S){
    var h = ['<table class="cl-t"><caption class="sr-only" style="position:absolute;left:-9999px">Indices climatiques à l’ouvrage : référence ', REF, ' et ', esc(S.hor), '</caption>',
      '<thead><tr><th scope="col">Indice</th><th scope="col">', REF, '</th><th scope="col">', S.hor.replace('-', '–'), '</th><th scope="col">Écart</th></tr></thead>'];
    var g, any;
    for (g = 0; g < GROUPES.length; g++) {
      if (g === 4 && !S.saisons) continue;
      any = false;
      var part = [];
      rows.forEach(function(r){
        if (r.def.g !== g) return;
        any = true;
        var d = r.def, tag = d.idx ? '<span class="cl-tag" title="Indice CMIP5 (CanDCS-U5), scénario ' + esc(S.rcp) + ' : voir la note">CMIP5</span>' : '';
        var cells;
        var panne = S.panne && S.panne[d.idx ? 'idx' : 'u6'];
        if (r.etat === 'att') cells = '<td colspan="3" style="text-align:center;color:var(--muted)">' + (panne ? 'service indisponible' : 'chargement…') + '</td>';
        else if (r.etat === 'nd') cells = '<td colspan="3" style="text-align:center;color:var(--muted)">sans valeur pour cette cellule</td>';
        else cells = celVal(r.base, d) + '<td>' + celVal(r.fut, d).replace(/^<td>|<\/td>$/g, '') + barres(r) + '</td>' + celEcart(r);
        part.push('<tr><td><span class="cl-lab">' + esc(d.lab) + '</span>' + tag + '<span class="cl-u">' + esc(d.unit) + (d.per ? '' : '') + '</span></td>' + cells + '</tr>');
      });
      if (any) h.push('<tbody><tr class="cl-g"><th colspan="4" scope="colgroup">' + esc(GROUPES[g]) + '</th></tr>' + part.join('') + '</tbody>');
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
    var S = { ssp: 'SSP245', hor: '2041-2070', rcp: 'RCP4.5', saisons: false };
    var closed = false;
    var D = { base: null, ano: null, idxH: null, idxF: null };
    var J = {};                // jobs de cette fenêtre : clé → { st: 0 en cours | 1 ok | 2 échec }
    var QU = [], running = 0, nextAt = {};
    ctx.onClose(function(){ closed = true; QU.length = 0; });
    var base = [o.route, o.obstacle].filter(Boolean).join(' → ') || o.nom || '';
    if (ctx.setSub) ctx.setSub(base + ' · climat futur');

    var root = document.createElement('div'); root.className = 'cl-root';
    root.innerHTML =
      '<p class="cl-top">Cellule de grille d’environ 6 × 10 km centrée à ' + esc(coordTxt(cell.lat, cell.lon)) + ' (' + esc(fmt(dist, 1)) + ' km du point de l’ouvrage). ' +
      '<small>Valeurs de modèles régionalisés, pas une mesure au pont. Information brute, sans note de risque.</small></p>' +
      '<div class="cl-ctl">' +
      '<fieldset><legend>Scénario d’émissions</legend><div class="cl-seg" data-grp="ssp">' + SSPS.map(function(s){
        return '<button type="button" class="cl-b" data-ssp="' + s.k + '" aria-pressed="false">' + esc(s.nom) + '<small>' + esc(s.desc) + '</small></button>'; }).join('') + '</div></fieldset>' +
      '<fieldset><legend>Horizon</legend><div class="cl-seg" data-grp="hor">' + HORS.map(function(h){
        return '<button type="button" class="cl-b" data-hor="' + h.k + '" aria-pressed="false">' + esc(h.k.replace('-', '–')) + '</button>'; }).join('') + '</div></fieldset>' +
      '</div>' +
      '<div class="cl-st" role="status" aria-live="polite"></div>' +
      '<div class="cl-wrap"></div>' +
      '<button type="button" class="cl-tog" data-saisons></button>' +
      '<p class="cl-note"></p>' +
      '<p class="cl-foot"></p>' +
      '<p class="cl-proto">Prototype v0.7 : choisir les indices à garder.</p>';
    body.innerHTML = ''; body.appendChild(root);
    var elSt = root.querySelector('.cl-st'), elWrap = root.querySelector('.cl-wrap'), elTog = root.querySelector('[data-saisons]');

    function sspObj(){ for (var i = 0; i < SSPS.length; i++) if (SSPS[i].k === S.ssp) return SSPS[i]; return SSPS[1]; }

    // ----- file de requêtes : au plus MAXPAR en parallèle, départs espacés par hôte
    function enqueue(host, fn){ QU.push({ host: host, fn: fn }); pump(); }
    function pump(){
      while (!closed && running < MAXPAR && QU.length) {
        var t = QU.shift(), now = Date.now(), esp = t.host === 'ogc' ? ECART_OGC : ECART_WMS;
        var at = Math.max(now, nextAt[t.host] || 0);
        nextAt[t.host] = at + esp;
        running++;
        (function(t, at, now){
          setTimeout(function(){
            if (closed) { running--; return; }
            t.fn().then(function(){}, function(){}).then(function(){ running--; pump(); });
          }, at - now);
        })(t, at, now);
      }
    }
    function fetchTxt(url, ms, as){
      if (QA && QA.fetchT) return QA.fetchT(url, {}, ms, as);
      return fetch(url).then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r[as === 'text' ? 'text' : 'json'](); });
    }

    // ----- tâches de chargement (une par variable pour les couches WMS ; une par percentile pour les indices)
    function job(key, host, ms, run, done){
      if (J[key] && J[key].st !== 2) return;
      J[key] = { st: 0 };
      enqueue(host, function(){
        if (closed) return Promise.resolve();
        return run().then(function(v){
          J[key] = { st: 1 };
          done(v);
        }, function(e){ J[key] = { st: 2, err: e }; }).then(function(){ if (!closed && ctx.alive()) draw(); });
      });
    }
    function mergeInto(target, add){ Object.keys(add).forEach(function(k){ target[k] = add[k]; }); }
    function loadU6(ssp, hor){
      var kind = hor ? 'ano' : 'base';
      VARS.forEach(function(v){
        var key = kind + '|' + ssp + '|' + (hor || '') + '|' + v;
        var mem = CACHE[cell.lat + '|' + cell.lon + '|' + key];
        if (mem) { holdU6(kind, ssp, hor, mem); J[key] = { st: 1 }; return; }
        job(key, 'wms', T_WMS, function(){
          return fetchTxt(urlGfi(layersVar(ssp, v, hor), lat, lon), T_WMS, 'text').then(function(t){
            var p = parseGfi(t);
            if (!Object.keys(p.vals).length) throw new Error('réponse vide');
            if (p.x != null) S.cx = p.x, S.cy = p.y;
            return p.vals;
          });
        }, function(vals){ CACHE[cell.lat + '|' + cell.lon + '|' + key] = vals; holdU6(kind, ssp, hor, vals); });
      });
    }
    var U6 = { base: {}, ano: {} };           // valeurs reçues, par « ssp|hor »
    function holdU6(kind, ssp, hor, vals){
      var k = ssp + '|' + (hor || '');
      U6[kind][k] = U6[kind][k] || {};
      mergeInto(U6[kind][k], vals);
    }
    var IDX = { H: {}, F: {} };               // analyses « coverage », par percentile (F : par RCP)
    function loadIdx(rcp){
      PCT_IDX.forEach(function(p){
        var kH = 'idxH|' + p, kF = 'idxF|' + rcp + '|' + p;
        var mH = CACHE[cell.lat + '|' + cell.lon + '|' + kH], mF = CACHE[cell.lat + '|' + cell.lon + '|' + kF];
        if (mH) { IDX.H[p] = mH; J[kH] = { st: 1 }; }
        else job(kH, 'ogc', T_OGC, function(){ return fetchTxt(urlIdx(false, cell, p, null, '1971/2000'), T_OGC, 'json').then(chk); },
          function(v){ CACHE[cell.lat + '|' + cell.lon + '|' + kH] = v; IDX.H[p] = v; });
        if (mF) { IDX.F[rcp + '|' + p] = mF; J[kF] = { st: 1 }; }
        else job(kF, 'ogc', T_OGC, function(){ return fetchTxt(urlIdx(true, cell, p, rcp, '2006/2100'), T_OGC, 'json').then(chk); },
          function(v){ CACHE[cell.lat + '|' + cell.lon + '|' + kF] = v; IDX.F[rcp + '|' + p] = v; });
      });
    }
    function chk(j){
      var a = parseCoverage(j);
      if (!a.years.length) throw new Error('réponse vide');
      return a;
    }
    function jobsEnCours(){ var n = 0; Object.keys(J).forEach(function(k){ if (J[k].st === 0) n++; }); return n; }
    function jobsEchec(){ var a = []; Object.keys(J).forEach(function(k){ if (J[k].st === 2) a.push(k); }); return a; }

    function demarrer(){
      var s = sspObj();
      S.rcp = s.rcp;
      loadU6(S.ssp, null);
      loadU6(S.ssp, S.hor);
      loadIdx(s.rcp);
      draw();
    }

    // ----- dessin
    function data(){
      var bk = S.ssp + '|', ak = S.ssp + '|' + S.hor;
      var bOk = VARS.every(function(v){ return J['base|' + S.ssp + '||' + v] && J['base|' + S.ssp + '||' + v].st === 1; });
      var aOk = VARS.every(function(v){ return J['ano|' + S.ssp + '|' + S.hor + '|' + v] && J['ano|' + S.ssp + '|' + S.hor + '|' + v].st === 1; });
      var hOk = PCT_IDX.every(function(p){ return J['idxH|' + p] && J['idxH|' + p].st === 1; });
      var fOk = PCT_IDX.every(function(p){ return J['idxF|' + S.rcp + '|' + p] && J['idxF|' + S.rcp + '|' + p].st === 1; });
      var F = {}; PCT_IDX.forEach(function(p){ F[p] = IDX.F[S.rcp + '|' + p] || null; });
      return { base: bOk ? U6.base[bk] : null, ano: aOk ? U6.ano[ak] : null, idxH: hOk ? IDX.H : null, idxF: fOk ? F : null };
    }
    function draw(){
      if (closed || !ctx.alive()) return;
      var s = sspObj();
      Array.prototype.forEach.call(root.querySelectorAll('[data-ssp]'), function(b){ b.setAttribute('aria-pressed', b.getAttribute('data-ssp') === S.ssp ? 'true' : 'false'); });
      Array.prototype.forEach.call(root.querySelectorAll('[data-hor]'), function(b){ b.setAttribute('aria-pressed', b.getAttribute('data-hor') === S.hor ? 'true' : 'false'); });
      var D2 = data(), rows = buildRows(D2, S.ssp, S.hor), ech0 = jobsEchec();
      S.panne = { u6: ech0.some(function(k){ return k.indexOf('idx') !== 0; }), idx: ech0.some(function(k){ return k.indexOf('idx') === 0; }) };
      elWrap.innerHTML = tableHtml(rows, S);
      elTog.textContent = S.saisons ? 'Masquer les autres saisons' : 'Afficher les autres saisons (températures moyennes, maximales de mi-saison)';
      elTog.setAttribute('aria-expanded', S.saisons ? 'true' : 'false');
      // état
      var enc = jobsEnCours(), ech = jobsEchec(), msg = '';
      if (enc) msg = '<span class="ld-spin" aria-hidden="true"></span><span>Chargement auprès d’ECCC (' + enc + ' requête' + (enc > 1 ? 's' : '') + ')…</span>';
      if (ech.length) {
        var u6 = ech.some(function(k){ return k.indexOf('idx') !== 0; }), ix = ech.some(function(k){ return k.indexOf('idx') === 0; });
        msg += '<span class="cl-err">' + (u6 ? 'Service GeoMet-Climate d’ECCC indisponible ou trop lent (températures et précipitations). ' : '') +
          (ix ? 'API d’ECCC indisponible ou trop lente (jours > 30 °C, nuits tropicales, degrés-jours, jours de pluie). ' : '') +
          '<button type="button" class="cl-b" data-retry>Réessayer</button> <a href="' + GEOMET_PAGE + '" target="_blank" rel="noopener">Documentation du service</a></span>';
      }
      elSt.innerHTML = msg;
      // aucune valeur du tout : hors grille
      var vus = rows.filter(function(r){ return r.def.v && r.etat !== 'att'; });
      if (vus.length && vus.every(function(r){ return r.etat === 'nd'; })) {
        elSt.innerHTML = '<span class="cl-err">Aucune valeur pour cette cellule : l’ouvrage est hors de la grille (en mer ou hors du Canada).</span>';
      }
      root.querySelector('.cl-note').innerHTML =
        '<b>Lecture.</b> Colonne ' + REF + ' : valeur simulée de la période de référence. Colonne ' + esc(S.hor.replace('-', '–')) + ' : même valeur au futur, ' + esc(s.nom) + '. ' +
        'Sous chaque valeur, plage p10–p90 des 26 modèles (pour les écarts et les valeurs futures, plage du <i>changement</i>). ' +
        'Lignes « CMIP5 » : modèles de la génération précédente (scénario ' + esc(s.rcp) + ', comparable à ' + esc(s.nom) + ' sans être identique), moyenne de valeurs annuelles, plage p5–p95. ' +
        '<br><b>Non disponibles :</b> jours de gel, cycles gel-dégel, précipitations maximales sur 1 ou 5 jours (absents de ces jeux de données ouverts).';
      root.querySelector('.cl-foot').innerHTML =
        'Sources : Environnement et Changement climatique Canada (ECCC), scénarios climatiques réduits statistiquement CanDCS-U6 (CMIP6, 26 modèles, BCCAQv2, grille ≈ 10 km), ' +
        '<a href="' + SRC_DS + '" target="_blank" rel="noopener">jeu de données</a> et <a href="' + SRC_DOC + '" target="_blank" rel="noopener">documentation</a> ; ' +
        'indices climatiques CanDCS-U5 (CMIP5), <a href="' + SRC_IDX + '" target="_blank" rel="noopener">documentation</a>. ' +
        'Licence : <a href="' + LICENCE + '" target="_blank" rel="noopener">Licence du gouvernement ouvert – Canada</a>. ' +
        'Autres indices et outils : <a href="' + PORTAIL + '" target="_blank" rel="noopener">climatedata.ca</a>. ' +
        'Ce sont des valeurs de modèles régionalisés pour une cellule d’environ 10 km, pas une mesure au pont ; information brute, sans note de risque.';
    }

    // ----- interactions
    root.addEventListener('click', function(ev){
      var b = ev.target.closest ? ev.target.closest('button') : null;
      if (!b || !root.contains(b)) return;
      if (b.hasAttribute('data-ssp')) { S.ssp = b.getAttribute('data-ssp'); demarrer(); }
      else if (b.hasAttribute('data-hor')) { S.hor = b.getAttribute('data-hor'); demarrer(); }
      else if (b.hasAttribute('data-saisons')) { S.saisons = !S.saisons; draw(); }
      else if (b.hasAttribute('data-retry')) { jobsEchec().forEach(function(k){ delete J[k]; }); demarrer(); }
    });
    demarrer();
  }

  var CACHE = {};                 // valeurs déjà reçues (survit à la fermeture de la fenêtre), par cellule et par requête

  window.QA_MOD.climat = {
    render: render,
    _t: {
      fmt: fmt, fmtSigne: fmtSigne, fleche: fleche, cellCentre: cellCentre, distKm: distKm, coordTxt: coordTxt,
      layerBase: layerBase, layerAno: layerAno, layersVar: layersVar, urlGfi: urlGfi, parseGfi: parseGfi,
      urlIdx: urlIdx, parseCoverage: parseCoverage, moyenne: moyenne, buildRows: buildRows, tableHtml: tableHtml,
      DEFS: DEFS, SSPS: SSPS, HORS: HORS, VARS: VARS, PERS: PERS, GROUPES: GROUPES
    }
  };
})();
