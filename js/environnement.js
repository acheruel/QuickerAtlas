/* « Environnement » : fenêtre de QuickerAtlas (v0.6.7), issue du prototype « Zones sensibles » de la v0.6.6.
   Module chargé à la demande (openAux). Contrat : window.QA_MOD.environnement.render(o, body, ctx).
   Question : quelles zones sensibles répertoriées touchent ou entourent cet ouvrage, dans un rayon de 1, 2 ou 5 km ?
   Sources (Données Québec, CC BY 4.0), interrogées en direct depuis le navigateur (CORS ouvert) :
   - MELCCFP, Biodiversite : registre des aires protégées (couche 23), habitats floristiques, occurrences d'espèces en
     situation précaire du CDPNQ (couches non sensibles 1 et 3 ; masquées 2 et 4 : forme seulement, sans nom),
     milieux humides détaillés et potentiels, espèces exotiques envahissantes (Sentinelle) ;
   - MELCCFP, Themes_publics 22 : zones inondables (BDZI).
   Exception : les habitats fauniques du MRNF (le serveur refuse les requêtes de navigateur) sont précalculés par l'ETL
   pour tout le Québec (data/couche-environnement.js, etl/environnement.py) ; si ce fichier manque, la fenêtre se
   rabat sur les habitats fauniques inscrits au registre des aires protégées (sans espèces) et le dit.
   Daltonisme : chaque thème a une lettre, une couleur (palette Okabe-Ito) et un motif ; jamais la couleur seule.
   v0.6.7 (intégration) : rayons 1, 2 et 5 km (requêtes à 2 km, puis à 5 km seulement si on le choisit) ; fond
   OpenStreetMap par défaut (atténué pour que les motifs ressortent), gris clair ou satellite au choix ; zoom à la
   molette continu comme la carte principale ; lien vers chaque jeu de données et chaque service ; lisibilité : grands
   polygones en remplissage léger, petits dessinés au-dessus des grands, occurrences masquées cachées par défaut,
   survol d'un thème (légende ou tableau) qui le met en avant et estompe les autres. */
(function(){
  'use strict';
  window.QA_MOD = window.QA_MOD || {};

  /* ================= Outils (purs, testables) ================= */
  var NF0 = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 0 });
  var NF1 = new Intl.NumberFormat('fr-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  function nfa(v){ return (v >= 100 ? NF0 : NF1).format(v); }
  function esc(s){
    var q = window.QA;
    if (q && q.esc) return q.esc(s == null ? '' : s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function qs(o){ return Object.keys(o).map(function(k){ return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&'); }
  var ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  var BIO = 'https://geo.environnement.gouv.qc.ca/donnees/rest/services/Biodiversite/';
  var TP = 'https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer/';
  var DQ = 'https://www.donneesquebec.ca/recherche/dataset/';
  var HAFA = 'https://servicesvecto3.mern.gouv.qc.ca/geoserver/Habitats_Fauniques_Pub/ows?service=WFS&request=GetCapabilities';
  var RAYONS = [1000, 2000, 5000], R_DEF = 1000;
  function rayonRequete(R){ return R <= 2000 ? 2000 : 5000; }
  function rTxt(R){ return R < 1000 ? R + ' m' : (R / 1000) + ' km'; }

  // Géométrie : anneaux [lon, lat] (règle pair-impair, comme Leaflet) ; distance en mètres, 0 dans le polygone
  function kxy(lat){ return [111320 * Math.cos(lat * Math.PI / 180), 110540]; }
  function polyDist(lat0, lon0, rings){
    var k = kxy(lat0), inside = false, best = 1e12;
    rings.forEach(function(r){
      var c = false, j = r.length - 1, i, ax, ay, bx, by, dx, dy, L2, t, px, py, d;
      for (i = 0; i < r.length; i++) {
        var xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
        if ((yi > lat0) !== (yj > lat0) && lon0 < (xj - xi) * (lat0 - yi) / (yj - yi) + xi) c = !c;
        j = i;
      }
      if (c) inside = !inside;
      for (i = 1; i < r.length; i++) {
        ax = (r[i - 1][0] - lon0) * k[0]; ay = (r[i - 1][1] - lat0) * k[1]; bx = (r[i][0] - lon0) * k[0]; by = (r[i][1] - lat0) * k[1];
        dx = bx - ax; dy = by - ay; L2 = dx * dx + dy * dy;
        t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
        px = ax + t * dx; py = ay + t * dy; d = Math.sqrt(px * px + py * py);
        if (d < best) best = d;
      }
    });
    return inside ? 0 : best;
  }
  // Aire approchée (m²) : lacet de chaque anneau, trous compris en valeur absolue (ordre de grandeur suffisant)
  function aireM2(rings){
    if (!rings || !rings.length) return 0;
    var k = kxy(rings[0][0][1]), s = 0;
    rings.forEach(function(r){ var a = 0; for (var i = 1; i < r.length; i++) a += r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1]; s = Math.max(s, Math.abs(a) / 2); });
    return s * k[0] * k[1];
  }
  function centre(rings){
    var big = rings[0], a = -1;
    rings.forEach(function(r){
      var xs = r.map(function(p){ return p[0]; }), ys = r.map(function(p){ return p[1]; });
      var s = (Math.max.apply(0, xs) - Math.min.apply(0, xs)) * (Math.max.apply(0, ys) - Math.min.apply(0, ys));
      if (s > a) { a = s; big = r; }
    });
    var x = 0, y = 0; big.forEach(function(p){ x += p[0]; y += p[1]; });
    return [y / big.length, x / big.length];
  }
  function distM(la1, lo1, la2, lo2){ var k = kxy((la1 + la2) / 2); return Math.sqrt(Math.pow((la2 - la1) * k[1], 2) + Math.pow((lo2 - lo1) * k[0], 2)); }
  function fmtD(d){ return d < 1 ? 0 : d < 1000 ? Math.round(d / 5) * 5 : Math.round(d / 10) * 10; }
  function txtD(d){ if (d == null) return '—'; if (d < 1) return 'dans le polygone'; return d < 1000 ? 'à ' + NF0.format(fmtD(d)) + ' m' : 'à ' + NF1.format(d / 1000) + ' km'; }
  function ymd(ms){ if (ms == null) return ''; var d = new Date(ms); return isNaN(d) ? '' : d.toISOString().slice(0, 10); }
  function inR(items, R){ return items.filter(function(o){ return o.d <= R; }).sort(function(a, b){ return a.d - b.d; }); }

  // Habitats fauniques précalculés (etl/environnement.py) : anneau [lat0, lon0, dlat1, dlon1, …] entiers → [[lon, lat]…]
  // fermé ; un anneau d'un seul sommet = point publié sans contour (« Habitat du poisson (Sans publication) »)
  function decodeRing(a, k){
    var out = [], la = 0, lo = 0;
    for (var i = 0; i + 1 < a.length; i += 2) { la += a[i]; lo += a[i + 1]; out.push([lo / k, la / k]); }
    if (out.length > 2) out.push(out[0]);
    return out;
  }
  function habitatsNear(C, lat, lon, R){
    var k = C.echelle || 1e5, dLat = R / 110540 * k, dLon = R / (111320 * Math.cos(lat * Math.PI / 180)) * k, la = lat * k, lo = lon * k, out = [];
    C.habitats.forEach(function(h){
      var b = h[8];
      if (b[0] - dLat > la || b[2] + dLat < la || b[1] - dLon > lo || b[3] + dLon < lo) return;
      var rings = h[9].map(function(a){ return decodeRing(a, k); });
      var pt = rings.length === 1 && rings[0].length === 1 ? rings[0][0] : null;
      var d = pt ? distM(lat, lon, pt[1], pt[0]) : polyDist(lat, lon, rings);
      if (d > R) return;
      out.push({ th: 'H', nom: h[2], type: C.categories[h[0]], especes: h[1] != null ? C.especes[h[1]] : null, info: !!h[3], sup: h[4], annee: h[5],
        vig: h[6], no: h[7], rings: pt ? null : rings, pt: pt ? [pt[1], pt[0]] : null, c: pt ? [pt[1], pt[0]] : centre(rings), d: d, sansContour: !!pt });
    });
    return out;
  }

  /* ================= Thèmes ================= */
  var TH = {
    P: { nom: 'Aires protégées et territoires de conservation', court: 'Aires protégées', coul: '#0072b2', bg: '#dcecf7', mot: 'slash' },
    H: { nom: 'Habitats fauniques', court: 'Habitats fauniques', coul: '#e69f00', bg: '#fff6e0', mot: 'cross' },
    F: { nom: 'Habitats floristiques (espèces menacées ou vulnérables)', court: 'Habitats floristiques', coul: '#cc79a7', bg: '#f8e6ef', mot: 'vert' },
    S: { nom: 'Espèces en situation précaire (CDPNQ)', court: 'Espèces précaires', coul: '#d55e00', bg: '#fdeee0', mot: 'dots' },
    M: { nom: 'Milieux humides', court: 'Milieux humides', coul: '#2a8fc4', bg: '#e3f3fb', mot: 'horiz' },
    Z: { nom: 'Zones inondables', court: 'Zones inondables', coul: '#009e73', bg: '#dff4ec', mot: 'back' },
    E: { nom: 'Espèces exotiques envahissantes', court: 'Exotiques envahissantes', coul: '#000000', bg: '#ffffff', mot: 'tri' },
    X: { nom: 'Occurrences masquées (forme généralisée)', court: 'Occurrences masquées', coul: '#6b7780', bg: '#eef1f3', mot: 'grey' }
  };
  var ORDRE = ['P', 'H', 'F', 'S', 'M', 'Z', 'E'];
  function patMarkup(id, c, bg, kind){
    var rect = function(w){ return '<rect width="' + w + '" height="' + w + '" fill="' + bg + '" fill-opacity=".45"/>'; };
    switch (kind) {
      case 'slash': return '<pattern id="' + id + '" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' + rect(7) + '<line x1="0" y1="0" x2="0" y2="7" stroke="' + c + '" stroke-width="2.4"/></pattern>';
      case 'back': return '<pattern id="' + id + '" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">' + rect(7) + '<line x1="0" y1="0" x2="0" y2="7" stroke="' + c + '" stroke-width="2.4"/></pattern>';
      case 'cross': return '<pattern id="' + id + '" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' + rect(8) + '<line x1="0" y1="0" x2="0" y2="8" stroke="' + c + '" stroke-width="1.9"/><line x1="0" y1="0" x2="8" y2="0" stroke="' + c + '" stroke-width="1.9"/></pattern>';
      case 'vert': return '<pattern id="' + id + '" width="6" height="6" patternUnits="userSpaceOnUse">' + rect(6) + '<line x1="1.5" y1="0" x2="1.5" y2="6" stroke="' + c + '" stroke-width="2.4"/></pattern>';
      case 'horiz': return '<pattern id="' + id + '" width="6" height="6" patternUnits="userSpaceOnUse">' + rect(6) + '<line x1="0" y1="1.5" x2="6" y2="1.5" stroke="' + c + '" stroke-width="2.2"/></pattern>';
      case 'dots': return '<pattern id="' + id + '" width="7" height="7" patternUnits="userSpaceOnUse">' + rect(7) + '<circle cx="3.5" cy="3.5" r="2" fill="' + c + '"/></pattern>';
      case 'grey': return '<pattern id="' + id + '" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' + rect(9) + '<line x1="0" y1="0" x2="0" y2="9" stroke="' + c + '" stroke-width="1.2" stroke-dasharray="3 2"/></pattern>';
    }
    return '';
  }
  // Variantes « plus faibles » (habitat informationnel, milieu humide potentiel, faible courant) : motif plus clair
  var VARIANTES = { M2: { c: '#7fbfe0', bg: '#f2f9fd', mot: 'horiz' }, H2: { c: '#f0c456', bg: '#fffbee', mot: 'cross' }, Z2: { c: '#5fc2a4', bg: '#f1faf6', mot: 'back' } };
  // Motifs : une seule définition SVG dans la page (les polygones de chaque volet y renvoient par url(#…))
  function injectDefs(){
    if (document.getElementById('env-defs')) return;
    var h = '';
    Object.keys(TH).forEach(function(k){ if (TH[k].mot !== 'tri') h += patMarkup('env-p-' + k, TH[k].coul, TH[k].bg, TH[k].mot); });
    Object.keys(VARIANTES).forEach(function(k){ var v = VARIANTES[k]; h += patMarkup('env-p-' + k, v.c, v.bg, v.mot); });
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    svg.style.position = 'absolute';          // pas display:none : Chrome n'afficherait plus les motifs
    svg.innerHTML = '<defs id="env-defs">' + h + '</defs>';
    document.body.appendChild(svg);
  }
  function swatch(k, pat, dash){
    var t = TH[k];
    if (t.mot === 'tri') return '<svg width="26" height="16" viewBox="0 0 26 16" aria-hidden="true"><path d="M13 1.5L20 14.5H6Z" fill="#000" stroke="#fff" stroke-width="1"/></svg>';
    return '<svg width="26" height="16" viewBox="0 0 26 16" aria-hidden="true"><rect x="1" y="1" width="24" height="14" rx="2" fill="url(#env-p-' + (pat || k) + ')" stroke="' + t.coul + '" stroke-width="1.6"' + (dash ? ' stroke-dasharray="4 3"' : '') + '/></svg>';
  }
  function lettre(k){ return '<span class="ev-ltr" style="border-color:' + TH[k].coul + '">' + k + '</span>'; }
  function lettreTxt(x){ return '<b>' + x.th + ' · ' + esc(TH[x.th].court) + '</b><br>'; }      // infobulle : thème d'abord

  /* ================= Sources (liens vers le jeu de données et le service) ================= */
  var SRC = {
    P: { titre: 'Registre des aires protégées et des AMCE', slug: 'aires-protegees-au-quebec', serv: BIO + 'Aires_protegees/MapServer/23' },
    H: { titre: 'Habitats fauniques (légaux et informationnels)', slug: 'habitats-fauniques', serv: HAFA, pre: true },
    H2: { titre: 'Registre des aires protégées (habitats fauniques inscrits)', slug: 'aires-protegees-au-quebec', serv: BIO + 'Aires_protegees/MapServer/23' },
    F: { titre: 'Habitats floristiques', slug: 'habitats-floristiques', serv: BIO + 'Habitats_floristiques/MapServer/0' },
    S: { titre: 'Occurrences d’espèces en situation précaire (CDPNQ)', slug: 'occurrences-especes-en-situation-precaire', serv: BIO + 'EMVS_publique/MapServer' },
    X: { titre: 'Occurrences d’espèces en situation précaire, couches masquées (CDPNQ)', slug: 'occurrences-especes-en-situation-precaire', serv: BIO + 'EMVS_publique/MapServer' },
    MD: { titre: 'Milieux humides, cartographie détaillée (MELCCFP et Canards Illimités)', slug: 'milieux-humides-du-quebec', serv: BIO + 'MH_detailles/MapServer/0' },
    MP: { titre: 'Milieux humides potentiels', slug: 'milieux-humides-potentiels', serv: BIO + 'MH_potentiels/MapServer/0' },
    Z: { titre: 'Zones inondables (BDZI)', slug: 'base-de-donnees-des-zones-inondables', serv: TP + '22' },
    E: { titre: 'Sentinelle, espèces exotiques envahissantes', slug: 'especes-exotiques-envahissantes', serv: BIO + 'EEE/MapServer/0' }
  };
  function srcHtml(k, A){
    var s = SRC[k], j = (A.jeux || {})[s.slug] || {};
    return '<a href="' + esc(DQ + s.slug) + '" target="_blank" rel="noopener">' + esc(s.titre) + '</a> · CC BY 4.0' + (j.maj ? ' · mis à jour le ' + esc(j.maj) : '') +
      ' · <a href="' + esc(s.serv) + '" target="_blank" rel="noopener">service ' + (k === 'H' ? 'du MRNF' : 'du MELCCFP') + '</a>' +
      (s.pre && A.hGen ? ' <span class="ev-s">(précalculé le ' + esc(A.hGen) + ')</span>' : '');
  }

  /* ================= Acquisition ================= */
  var MH_CLASSE = { EP: 'Eau peu profonde', ME: 'Marécage', MS: 'Marais', PH: 'Prairie humide', TB: 'Tourbière boisée', BG: 'Tourbière ouverte ombrotrophe (bog)', FN: 'Tourbière ouverte minérotrophe (fen)' };
  var MH_PRESSION = { AUC: 'aucune pression identifiée', AUT: 'autre', AGR: 'agricole', CF: 'coupe forestière', CR: 'creusage', DRA: 'drainage', ESP: 'espèces envahissantes', IND: 'industrielle ou commerciale', REC: 'récréative', REM: 'remblayage', RES: 'résidentielle', RTE: 'réseau de transport d’énergie', TRA: 'réseau de transport routier' };
  var ETAPES = ['Aires protégées (MELCCFP)', 'Habitats floristiques légaux (MELCCFP)', 'Espèces en situation précaire, non sensibles (CDPNQ)', 'Occurrences masquées, forme généralisée (CDPNQ)',
    'Milieux humides détaillés (MELCCFP, CIC)', 'Milieux humides potentiels (MELCCFP)', 'Zones inondables (MELCCFP)', 'Espèces exotiques envahissantes (Sentinelle)', 'Habitats fauniques (MRNF, précalculés)'];
  var CACHE = {};          // « n°|rayon » → promesse de l'analyse (réouverture instantanée)

  function analyse(o, Rq, tick){
    var A = { T: {}, Rq: Rq, bytes: 0, nreq: 0, t0: Date.now() };
    // simplification demandée au serveur (maxAllowableOffset, degrés) : ≈ 5 m à 2 km, ≈ 12 m à 5 km ; 20 à 40 m pour
    // les polygones très longs (occurrences du CDPNQ, zones inondables du Saint-Laurent)
    var off = Rq <= 2000 ? 0.00005 : 0.00012, offG = Rq <= 2000 ? 0.0002 : 0.0004;
    function J(url){
      return window.QA.fetchT(url, {}, 30000, 'text').then(function(t){
        A.bytes += t.length; A.nreq++;
        var j = JSON.parse(t);
        if (j && j.error) throw new Error(j.error.message || 'erreur du service');
        return j;
      });
    }
    function query(layer, fields, extra){
      var q = { f: 'json', geometry: o.lon + ',' + o.lat, geometryType: 'esriGeometryPoint', inSR: 4326, outSR: 4326, distance: Rq, units: 'esriSRUnit_Meter',
        spatialRel: 'esriSpatialRelIntersects', outFields: fields, returnGeometry: 'true', resultRecordCount: 2000 };
      for (var k in extra) q[k] = extra[k];
      return J(layer + '/query?' + qs(q));
    }
    function mk(th, f, x){
      var g = f.geometry, rings = g && g.rings;
      if (!rings || !rings.length) return null;
      x.th = th; x.rings = rings; x.d = polyDist(o.lat, o.lon, rings); x.c = centre(rings);
      return x;
    }
    function fin(k, i, items, extra, trop){ A.T[k] = { ok: true, items: items, trop: !!trop }; tick(i, true, extra !== undefined ? extra : items.length + ' objet(s)'); }
    function bad(k, i, e){ A.T[k] = { ok: false, items: [], err: String(e && e.message || e) }; tick(i, false, 'indisponible'); }
    var bio = Promise.resolve();
    function enBio(fn){ bio = bio.then(fn); return bio; }          // même hôte : une requête à la fois (poli)

    // 0 · Aires protégées : DESIG_GR classe l'objet (habitat faunique → repli de H ; habitat floristique → couche F)
    enBio(function(){ return query(BIO + 'Aires_protegees/MapServer/23', 'DESIG_GR,DESIGNOM,TOPONYME,RESPONSABL,UICN,HA_LEGAL,DA_CREATIO,note', { maxAllowableOffset: off }).then(function(j){
      var P = [], H = [];
      j.features.forEach(function(f){
        var a = f.attributes, g = a.DESIG_GR || '';
        if (/floristique/i.test(g)) return;
        var x = mk(/^Habitat faunique/.test(g) ? 'H' : 'P', f, { nom: a.TOPONYME || a.DESIGNOM, type: a.DESIGNOM, groupe: g, sup: a.HA_LEGAL, uicn: a.UICN, cree: a.DA_CREATIO, resp: a.RESPONSABL, note: a.note });
        if (x) (x.th === 'H' ? H : P).push(x);
      });
      A.apHab = H; fin('P', 0, P, undefined, j.exceededTransferLimit);
    }, function(e){ bad('P', 0, e); }); });
    // 1 · Habitats floristiques légaux
    enBio(function(){ return query(BIO + 'Habitats_floristiques/MapServer/0', 'TOPONYME,HA_LEGAL,DA_CREATIO,REGISTRE', { maxAllowableOffset: off }).then(function(j){
      fin('F', 1, j.features.map(function(f){ var a = f.attributes; return mk('F', f, { nom: a.TOPONYME, type: 'Habitat floristique légal', sup: a.HA_LEGAL, cree: a.DA_CREATIO, registre: a.REGISTRE }); }).filter(Boolean));
    }, function(e){ bad('F', 1, e); }); });
    // 2 · CDPNQ non sensible : flore (couche 1) et faune (couche 3)
    enBio(function(){
      var champs = 'SCOMNAME,SNAME,LOIEMV,GROUPE,LASTOBS,EOTYPE,PRECISIONDESC,EORANKDESC';
      return Promise.all([query(BIO + 'EMVS_publique/MapServer/1', champs, { maxAllowableOffset: offG }), query(BIO + 'EMVS_publique/MapServer/3', champs, { maxAllowableOffset: offG })]).then(function(r){
        var items = [];
        r.forEach(function(j, i){ j.features.forEach(function(f){ var a = f.attributes; var x = mk('S', f, { nom: a.SCOMNAME, latin: a.SNAME, type: i ? 'Faune' : 'Flore', statutLoi: a.LOIEMV, obs: a.LASTOBS, prec: a.PRECISIONDESC, eo: a.EOTYPE }); if (x) items.push(x); }); });
        fin('S', 2, items, items.length + ' occurrence(s)', r[0].exceededTransferLimit || r[1].exceededTransferLimit);
      }, function(e){ bad('S', 2, e); });
    });
    // 3 · CDPNQ masqué : forme généralisée seulement, sans nom
    enBio(function(){
      return Promise.all([query(BIO + 'EMVS_publique/MapServer/2', 'GROUPE', { maxAllowableOffset: offG }), query(BIO + 'EMVS_publique/MapServer/4', 'GROUPE', { maxAllowableOffset: offG })]).then(function(r){
        var items = [];
        r.forEach(function(j, i){ j.features.forEach(function(f){ var x = mk('X', f, { nom: 'Occurrence masquée', type: i ? 'Faune' : 'Flore' }); if (x) items.push(x); }); });
        fin('X', 3, items, items.length + ' forme(s)');
      }, function(e){ bad('X', 3, e); });
    });
    // 4 · Milieux humides détaillés ; 5 · potentiels
    enBio(function(){ return query(BIO + 'MH_detailles/MapServer/0', 'CLASSE,MH_HA,PRESSION_1,ANNEE_DOCUM,PROJET', { maxAllowableOffset: off * 2 }).then(function(j){
      fin('MD', 4, j.features.map(function(f){ var a = f.attributes, cl = MH_CLASSE[a.CLASSE] || a.CLASSE || 'Milieu humide'; return mk('M', f, { nom: cl, type: 'Cartographie détaillée', sup: a.MH_HA, classe: cl, detail: true, pression: MH_PRESSION[a.PRESSION_1] || a.PRESSION_1, annee: a.ANNEE_DOCUM }); }).filter(Boolean), undefined, j.exceededTransferLimit);
    }, function(e){ bad('MD', 4, e); }); });
    enBio(function(){ return query(BIO + 'MH_potentiels/MapServer/0', 'CLASSE,TYPE,SUPERFICIE,CONFIANCE,PHYSIONOMIE', { maxAllowableOffset: off * 2 }).then(function(j){
      fin('MP', 5, j.features.map(function(f){ var a = f.attributes; return mk('M', f, { nom: a.CLASSE || 'Milieu humide potentiel', type: 'Potentiel (modèle)', sup: a.SUPERFICIE, classe: a.CLASSE || 'Milieu humide', detail: false, confiance: a.CONFIANCE, phys: a.PHYSIONOMIE }); }).filter(Boolean), undefined, j.exceededTransferLimit);
    }, function(e){ bad('MP', 5, e); }); });
    // 7 · Espèces exotiques envahissantes (points)
    enBio(function(){ return query(BIO + 'EEE/MapServer/0', 'Numero_observation,Date_observation,Categorie,Nom_espece_français,Nom_espece_latin,Nombre_individus,Superficie_m2', {}).then(function(j){
      var items = j.features.filter(function(f){ return f.geometry && f.geometry.x != null; }).map(function(f){
        var a = f.attributes, g = f.geometry;
        return { th: 'E', nom: a['Nom_espece_français'], latin: a.Nom_espece_latin, type: a.Categorie, date: ymd(a.Date_observation), nb: a.Nombre_individus, m2: a.Superficie_m2, pt: [g.y, g.x], c: [g.y, g.x], d: distM(o.lat, o.lon, g.y, g.x) };
      });
      fin('E', 7, items, undefined, j.exceededTransferLimit);
    }, function(e){ bad('E', 7, e); }); });
    // 6 · Zones inondables (autre hôte : en parallèle)
    var pZi = query(TP + '22', 'Description,No_rapport,Nm_rapport', { maxAllowableOffset: offG }).then(function(j){
      fin('Z', 6, j.features.map(function(f){ var a = f.attributes; return mk('Z', f, { nom: a.Description || 'Zone inondable', type: 'Zone inondable', rapport: a.No_rapport, rapportNom: a.Nm_rapport, grand: /grand/i.test(a.Description || '') }); }).filter(Boolean));
    }, function(e){ bad('Z', 6, e); });
    // 8 · Habitats fauniques précalculés pour tout le Québec (en parallèle) ; sinon repli sur le registre
    var pH = window.QA.loadScript('data/couche-environnement.js').then(function(){
      var C = (window.PQ_COUCHES || {}).environnement;
      if (!C || !C.habitats) throw new Error('couche absente');
      A.jeux = C.jeux || {}; A.hGen = C.generated; A.hTol = C.tolerance_m;
      var items = habitatsNear(C, o.lat, o.lon, Rq);
      A.hSource = 'etl';
      fin('H', 8, items, items.length + ' habitat(s)');
    }, function(){ A.hSource = 'registre'; });
    return Promise.all([bio, pZi, pH]).then(function(){
      if (A.hSource === 'registre') {
        A.T.H = { ok: !!(A.T.P && A.T.P.ok), items: A.apHab || [], viaRegistre: true, err: A.T.P && !A.T.P.ok ? A.T.P.err : null };
        tick(8, true, 'fichier absent : repli sur le registre (' + A.T.H.items.length + ')');
      }
      A.secs = (Date.now() - A.t0) / 1000;
      return A;
    });
  }

  /* ================= Résumés par thème (ligne du tableau) ================= */
  function pluriel(n, s, p){ return NF0.format(n) + ' ' + (n > 1 ? (p || s + 's') : s); }
  function liste(arr, fnTxt, max){
    max = max || 3;
    var li = function(x){ return '<li>' + fnTxt(x) + ' <span class="ev-s">· ' + txtD(x.d) + '</span></li>'; };
    return '<ul>' + arr.slice(0, max).map(li).join('') + '</ul>' + (arr.length > max ? '<details><summary>+ ' + (arr.length - max) + ' autre(s)</summary><ul>' + arr.slice(max).map(li).join('') + '</ul></details>' : '');
  }
  function haTxt(v){ return v == null || v === '' || +v === 0 ? '—' : nfa(+v) + ' ha'; }
  function groupBy(arr, f){ var m = {}; arr.forEach(function(x){ var k = f(x); (m[k] = m[k] || []).push(x); }); return m; }
  var RES = {
    P: function(Ls){ var n = Ls[0];
      return { objet: liste(Ls, function(x){ return '<b>' + esc(x.nom) + '</b> · ' + esc(x.type || ''); }), sup: haTxt(n.sup),
        statut: 'Aire protégée inscrite au registre' + (n.uicn ? ' (UICN ' + esc(n.uicn) + ')' : '') + (n.cree ? ', créée le ' + esc(n.cree) : '') + (n.note ? '. ' + esc(n.note) : ''), src: 'P' }; },
    H: function(Ls, T){ var n = Ls[0];
      if (T.viaRegistre) return { objet: liste(Ls, function(x){ return '<b>' + esc(x.nom) + '</b> · ' + esc(x.type || ''); }), sup: haTxt(n.sup), statut: 'Habitat faunique inscrit au registre des aires protégées (espèces non précisées ici)', src: 'H2' };
      return { objet: liste(Ls, function(x){ return '<b>' + esc(x.type) + '</b>' + (x.nom ? ' · ' + esc(x.nom) : '') + (x.especes ? ' <span class="ev-s">(' + esc(String(x.especes).toLowerCase()) + ')</span>' : '') + (x.sansContour ? ' <span class="ev-s">· contour non publié, point indicatif</span>' : ''); }), sup: haTxt(n.sup),
        statut: (Ls.every(function(x){ return x.info; }) ? 'Habitat informationnel (sans protection légale propre)' : (Ls.some(function(x){ return x.info; }) ? 'Habitat légal, ou informationnel pour certains' : 'Habitat faunique légal (Loi sur la conservation et la mise en valeur de la faune)')) + (n.annee ? '. Inventaire ' + esc(n.annee) : ''), src: 'H' }; },
    F: function(Ls){ var n = Ls[0];
      return { objet: liste(Ls, function(x){ return '<b>' + esc(x.nom) + '</b>'; }), sup: haTxt(n.sup), statut: 'Habitat légal protégé : toute activité qui le modifie exige une autorisation préalable (Loi sur les espèces menacées ou vulnérables, art. 17)' + (n.cree ? '. Créé le ' + esc(n.cree) : ''), src: 'F' }; },
    S: function(Ls){
      var g = groupBy(Ls, function(x){ return x.nom; }), noms = Object.keys(g).map(function(k){ return { nom: k, d: Math.min.apply(0, g[k].map(function(x){ return x.d; })), items: g[k] }; }).sort(function(a, b){ return a.d - b.d; });
      var flo = Ls.filter(function(x){ return x.type === 'Flore'; }).length, fau = Ls.length - flo, statuts = {};
      Ls.forEach(function(x){ statuts[x.statutLoi] = (statuts[x.statutLoi] || 0) + 1; });
      var txt = function(e){ var x = e.items[0]; return '<b>' + esc(e.nom) + '</b>' + (e.items.length > 1 ? ' ×' + e.items.length : '') + ' · ' + esc(x.type.toLowerCase()) + ', ' + esc((x.statutLoi || '').toLowerCase()) + (x.obs ? ', vue en ' + esc(String(x.obs).slice(0, 4)) : '') + (x.prec ? ' <span class="ev-s">(précision ' + (String(x.prec).split(' ')[0] === 'M' ? '< 1,5 km' : '< 150 m') + ')</span>' : ''); };
      return { objet: '<p>' + pluriel(Ls.length, 'occurrence') + ' (' + flo + ' flore, ' + fau + ' faune), ' + pluriel(noms.length, 'espèce') + '</p>' + liste(noms, txt), sup: '—',
        statut: Object.keys(statuts).map(function(k){ return NF0.format(statuts[k]) + ' ' + esc(String(k).toLowerCase()); }).join(', ') + ' (Loi sur les espèces menacées ou vulnérables : désignées ou susceptibles de l’être)', src: 'S' }; },
    X: function(Ls){ return { objet: '<p>' + pluriel(Ls.length, 'forme généralisée', 'formes généralisées') + ' : le CDPNQ détient des données sensibles ici. Noms et positions précises masqués par la source.</p>', sup: '—', statut: 'Sans objet (information masquée)', src: 'X' }; },
    M: function(Ls){
      var g = groupBy(Ls, function(x){ return (x.detail ? 'détaillé' : 'potentiel') + '|' + x.classe; });
      var det = Ls.filter(function(x){ return x.detail; }), pot = Ls.filter(function(x){ return !x.detail; });
      var sum = function(a){ return a.reduce(function(s, x){ return s + (+x.sup || 0); }, 0); };
      var lignes = Object.keys(g).sort(function(a, b){ return a.charAt(0) === b.charAt(0) ? sum(g[b]) - sum(g[a]) : (a.charAt(0) === 'd' ? -1 : 1); }).map(function(k){
        var a = g[k], p = k.split('|'); return { d: Math.min.apply(0, a.map(function(x){ return x.d; })), html: '<b>' + esc(p[1]) + '</b> ×' + a.length + ' · ' + esc(p[0]) + ' · ' + haTxt(sum(a)) };
      });
      return { objet: '<p>' + (det.length ? pluriel(det.length, 'polygone') + ' détaillé(s)' : '') + (det.length && pot.length ? ' et ' : '') + (pot.length ? pluriel(pot.length, 'polygone') + ' potentiel(s)' : '') + '</p>' + liste(lignes, function(x){ return x.html; }),
        sup: haTxt(sum(Ls)) + '<br><span class="ev-s">total, polygones entiers</span>', statut: 'Milieu humide cartographié : une intervention peut exiger une autorisation du MELCCFP (régime des milieux humides et hydriques de la Loi sur la qualité de l’environnement). « Potentiel » = modèle à valider sur le terrain ; ce n’est pas un statut légal.', src: det.length ? 'MD' : 'MP', src2: det.length && pot.length ? 'MP' : null }; },
    Z: function(Ls){
      return { objet: liste(Ls, function(x){ return '<b>' + esc(x.nom) + '</b> · rapport ' + esc(x.rapport || '—') + (x.rapportNom ? ' <span class="ev-s">(' + esc(x.rapportNom) + ')</span>' : ''); }), sup: '—',
        statut: 'Zone cartographiée au sens de la Politique de protection des rives, du littoral et des plaines inondables (grand courant 0-20 ans, faible courant 20-100 ans)', src: 'Z' }; },
    E: function(Ls){
      var g = groupBy(Ls, function(x){ return x.nom; }), noms = Object.keys(g).map(function(k){ return { nom: k, a: g[k], d: Math.min.apply(0, g[k].map(function(x){ return x.d; })) }; }).sort(function(a, b){ return b.a.length - a.a.length; });
      var f = function(e){ var dd = e.a.map(function(x){ return x.date; }).filter(Boolean).sort(); return '<b>' + esc(e.nom) + '</b> ×' + e.a.length + (dd.length ? ' <span class="ev-s">(observée de ' + esc(dd[0].slice(0, 4)) + ' à ' + esc(dd[dd.length - 1].slice(0, 4)) + ')</span>' : '') + ' <span class="ev-s">· la plus proche</span>'; };
      return { objet: '<p>' + pluriel(Ls.length, 'observation') + ', ' + pluriel(noms.length, 'espèce') + '</p>' + liste(noms, f), sup: '—', statut: 'Observation déclarée à Sentinelle (non vérifiée par un expert) ; pas de statut légal propre. Utile pour le nettoyage des engins de chantier.', src: 'E' }; }
  };
  var ABSENT_TXT = { P: 'aucune aire protégée', H: 'aucun habitat faunique répertorié', F: 'aucun habitat floristique légal', S: 'aucune occurrence publiée', M: 'aucun milieu humide cartographié', Z: 'aucune zone inondable cartographiée', E: 'aucune observation déclarée' };
  function themeItems(A, k){ return k === 'M' ? (A.T.MD && A.T.MD.items || []).concat(A.T.MP && A.T.MP.items || []) : (A.T[k] ? A.T[k].items : []); }
  function themeState(A, k){
    if (k === 'M') { var a = A.T.MD && A.T.MD.ok, b = A.T.MP && A.T.MP.ok; return a && b ? 'ok' : a || b ? 'part' : 'err'; }
    return A.T[k] && A.T[k].ok ? 'ok' : 'err';
  }
  function themeTrop(A, k){ return k === 'M' ? !!((A.T.MD && A.T.MD.trop) || (A.T.MP && A.T.MP.trop)) : !!(A.T[k] && A.T[k].trop); }

  /* ================= Interface ================= */
  function injectCss(){
    if (document.getElementById('qa-env-css')) return;
    var st = document.createElement('style'); st.id = 'qa-env-css';
    st.textContent =
      '.ev-wait{display:flex;flex-direction:column;align-items:center;gap:10px;padding:46px 10px;color:var(--muted);font-size:.9rem}' +
      '.ev-wait ol{margin:0;padding:0;list-style:none;font-size:.82rem;line-height:1.7}' +
      '.ev-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,.8fr);gap:18px;align-items:start}' +
      '.ev-mapw{position:relative}' +
      '.ev-map{height:min(560px,62vh);border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff}' +
      '.ev-busy{position:absolute;left:50%;top:12px;transform:translateX(-50%);z-index:1000;display:flex;align-items:center;gap:8px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:6px 12px;font-size:.8rem;box-shadow:0 2px 8px #15354a22}' +
      '.ev-busy[hidden]{display:none}' +
      '.ev-fonds{display:flex;gap:2px;padding:2px;background:#fff;border:2px solid #0000002e;border-radius:8px;background-clip:padding-box}' +
      '.ev-fonds button{border:0;background:none;padding:4px 9px;font-size:.75rem;font-weight:600;border-radius:5px;color:var(--ink)}' +
      '.ev-fonds button[aria-pressed=true]{background:var(--mint);color:#00534f;box-shadow:inset 0 0 0 1px var(--teal)}' +
      '.ev-right{display:flex;flex-direction:column;gap:9px;min-width:0}' +
      '.ev-bar{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;font-size:.8rem}' +
      '.ev-seg{display:flex;gap:4px}' +
      '.ev-seg button{font-size:.8rem;border:1px solid var(--line);background:#fff;border-radius:999px;padding:3px 12px;color:var(--ink);font-weight:600}' +
      '.ev-seg button[aria-pressed=true]{background:var(--navy);border-color:var(--navy);color:#fff}' +
      '.ev-chips{display:flex;flex-wrap:wrap;gap:6px}' +
      '.ev-chip{display:flex;gap:6px;align-items:center;border:1px solid var(--line);border-radius:8px;padding:4px 9px;font-size:.78rem;background:#fff}' +
      '.ev-chip b{font-size:.98rem;font-variant-numeric:tabular-nums;color:var(--navy)}' +
      '.ev-chip.on{border-color:#e9c46a;background:#fff6e0}.ev-chip.off{color:var(--muted)}.ev-chip.unk{border-style:dashed}' +
      '.ev-ltr{display:inline-grid;place-items:center;flex:none;width:18px;height:18px;border-radius:50%;border:2px solid;background:#fff;font:800 9.5px/1 "Segoe UI",Arial,sans-serif;color:#102d41}' +
      '.ev-leg{display:flex;flex-direction:column;gap:2px;font-size:.78rem}' +
      '.ev-leg label{display:flex;gap:8px;align-items:center;cursor:pointer;padding:3px 5px;border-radius:6px}' +
      '.ev-leg label:hover,.ev-leg label:focus-within{background:#eef5f7}' +
      '.ev-leg input{width:15px;min-height:15px;margin:0}' +
      '.ev-leg svg{flex:none}' +
      '.ev-leg .nb{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:700;color:var(--navy)}.ev-leg .nb.z{color:var(--muted);font-weight:400}' +
      '.ev-legh{display:flex;justify-content:space-between;align-items:baseline;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:650;margin-top:2px}' +
      '.ev-legh button{border:0;background:none;padding:0 2px;font-size:.75rem;color:var(--teal);font-weight:600;text-transform:none;letter-spacing:0}' +
      '.ev-meta{font-size:.75rem;color:var(--muted);margin:6px 0 0;line-height:1.45}' +
      '.ev-ban{border-radius:8px;padding:8px 12px;font-size:.8rem;line-height:1.5;border:1px solid}' +
      '.ev-ban+.ev-ban{margin-top:6px}' +
      '.ev-ban.warn{background:#fff6e5;border-color:#efcf8f;color:#7a4b00}.ev-ban.ok{background:#f1f8fd;border-color:#8cc3e6;color:#0b3a57}.ev-ban.bad{background:#fdeee0;border-color:#e8a46b;color:#7a2f00}' +
      '.ev-scroll{overflow-x:auto;margin-top:12px;border:1px solid var(--line);border-radius:8px}' +
      'table.ev{border-collapse:collapse;width:100%;min-width:860px;font-size:.78rem;line-height:1.42}' +
      'table.ev th,table.ev td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}' +
      'table.ev th{background:#f6f9fb;font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}' +
      'table.ev td.th{white-space:nowrap}table.ev td.th .ev-ltr{margin-right:6px;vertical-align:middle}table.ev td.th b{vertical-align:middle}' +
      'table.ev td.d{white-space:nowrap;font-variant-numeric:tabular-nums}' +
      'table.ev tr.absent td{color:var(--muted);background:#fafbfc}' +
      'table.ev tbody tr:hover td{background:#f1f7f9}' +
      'table.ev p{margin:0}table.ev ul{margin:3px 0 0;padding-left:16px}table.ev li{margin:1px 0}' +
      'table.ev details summary{cursor:pointer;color:var(--teal);font-weight:600}' +
      'table.ev td.src{font-size:.72rem;color:var(--muted);min-width:190px}table.ev td.src a{color:#005a80}' +
      '.ev-s{font-size:.72rem;color:var(--muted)}' +
      '.ev-pill{display:inline-block;font-size:.72rem;font-weight:700;border-radius:999px;padding:1px 8px;border:1px solid currentColor;white-space:nowrap}' +
      '.ev-pill.bad{color:#9a3c00;background:#fdeee0}.ev-pill.no{color:var(--muted);background:#f3f6f8}.ev-pill.warn{color:#7a4b00;background:#fff6e0}' +
      '.ev-src{font-size:.75rem;color:var(--muted);margin:10px 0 0;line-height:1.5}.ev-src a{color:#005a80}' +
      '.ev-mk{width:20px;height:20px;display:grid;place-items:center;background:#102d41;border:2px solid #fff;box-shadow:0 0 0 1px #102d41}' +
      '.ev-badge{display:grid;place-items:center;width:18px;height:18px;border-radius:50%;background:#fff;border:2px solid;font:800 10px/1 "Segoe UI",Arial,sans-serif;color:#102d41;box-shadow:0 0 0 1px #fff}' +
      '.ev-badge.pt{border-style:dashed}' +
      '.ev-eee{width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:13px solid #000;filter:drop-shadow(0 0 1px #fff) drop-shadow(0 0 1px #fff)}' +
      '.ev-map .leaflet-popup-content{font-size:.8rem;line-height:1.45;margin:10px 12px}' +
      '@media(max-width:1000px){.ev-grid{grid-template-columns:minmax(0,1fr)}.ev-map{height:min(380px,55vh)}}';
    document.head.appendChild(st);
  }
  function fonds(){
    var esri = function(s, mx, att){ return L.tileLayer(ESRI + s + '/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: mx, maxZoom: 19, attribution: att }); };
    var F = {};
    // OpenStreetMap (http(s) seulement : en-tête Referer exigé) atténué : les motifs des thèmes ressortent mieux
    if (/^https?:$/.test(location.protocol)) F.OpenStreetMap = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 19, opacity: 0.72,
      attribution: 'Fond © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">contributeurs OpenStreetMap</a>' });
    F['Gris clair'] = L.layerGroup([esri('Canvas/World_Light_Gray_Base', 16, 'Fond © Esri, HERE, Garmin'), esri('Canvas/World_Light_Gray_Reference', 16, '')]);
    F.Satellite = L.layerGroup([esri('World_Imagery', 19, 'Imagerie © Esri, Maxar, Earthstar Geographics'), esri('Reference/World_Boundaries_and_Places', 19, '')]);
    return F;
  }
  function popup(x){
    var h = '<b>' + esc(x.nom || x.type || '') + '</b>';
    var kv = function(k, v){ return v == null || v === '' ? '' : '<br>' + k + ' : ' + esc(v); };
    h += kv('Type', x.type) + kv('Superficie', x.sup != null && +x.sup > 0 && x.th !== 'E' ? nfa(+x.sup) + ' ha' : '') + kv('Distance', txtD(x.d));
    if (x.th === 'P') h += kv('Responsable', x.resp) + kv('UICN', x.uicn) + kv('Création', x.cree);
    if (x.th === 'H') h += kv('Espèces', x.especes) + kv('Statut', x.info ? 'Habitat informationnel' : 'Habitat légal') + kv('Inventaire', x.annee) + kv('N° d’habitat', x.no) + (x.sansContour ? '<br><i>Contour non publié par le MRNF : point indicatif.</i>' : '');
    if (x.th === 'S') h += kv('Nom latin', x.latin) + kv('Statut', x.statutLoi) + kv('Dernière observation', x.obs) + kv('Type d’occurrence', x.eo) + kv('Précision', x.prec);
    if (x.th === 'M') h += kv('Confiance', x.confiance) + kv('Physionomie', x.phys) + kv('Pression', x.pression) + kv('Année des photos', x.annee);
    if (x.th === 'Z') h += kv('Rapport', x.rapport) + kv('Titre', x.rapportNom);
    if (x.th === 'E') h += kv('Nom latin', x.latin) + kv('Date', x.date) + kv('Individus', x.nb) + kv('Surface (m²)', x.m2);
    return h;
  }
  // Style d'un polygone : motif du thème ; variante pâle et pointillée pour les statuts plus faibles. Remplissage léger
  // (contour renforcé) pour un polygone qui contient l'ouvrage ou qui couvre une bonne part du cercle : il ne masque plus
  // ce qui est dessous (constat du prototype : une occurrence étendue recouvrait tout le parc du Mont-Orford)
  function styleOf(x, R){
    var t = TH[x.th], pat = x.th, dash = null, w = 2;
    if (x.th === 'M') { if (!x.detail) { pat = 'M2'; dash = '4 3'; } w = 1.4; }
    if (x.th === 'H' && x.info) { pat = 'H2'; dash = '5 4'; }
    if (x.th === 'Z' && !x.grand) { pat = 'Z2'; dash = '5 4'; }
    if (x.th === 'X') { dash = '2 3'; w = 1.2; }
    if (x.th === 'S') { w = 1.6; if (/^M/.test(x.prec || '')) return { pane: 'env-poly', color: t.coul, weight: 1.3, dashArray: '2 5', fillColor: t.coul, fillOpacity: 0.05, opacity: 0.9 }; }
    var grand = x.d < 1 || x.aire > Math.PI * R * R * 0.4;
    return { pane: 'env-poly', color: t.coul, weight: grand ? w + 0.8 : w, dashArray: dash, fillColor: 'url(#env-p-' + pat + ')', fillOpacity: grand ? 0.3 : 0.85, opacity: 0.95 };
  }

  var cur = { map: null };
  function render(o, body, ctx){
    injectCss(); injectDefs();
    if (cur.map) { try { cur.map.remove(); } catch (e) { /* déjà retirée */ } cur.map = null; }
    var S = { R: R_DEF, A: null, vis: {}, built: false, map: null, layers: {}, circle: null, fitted: false, busy: false };
    ORDRE.forEach(function(k){ S.vis[k] = true; });
    S.vis.X = false;                       // formes généralisées du CDPNQ : cachées par défaut (lisibilité), cochables
    function q(s){ return body.querySelector('[data-ev="' + s + '"]'); }

    function charger(Rq, first){
      var key = o.num + '|' + Rq, ticks = [];
      function tick(i, ok, extra){
        ticks[i] = (ok ? '✓ ' : '✗ ') + ETAPES[i] + (extra ? ' · ' + extra : '');
        var el = first && body.querySelector('[data-ev-s="' + i + '"]');
        if (el && ctx.alive()) el.textContent = ticks[i];
      }
      if (first) {
        body.innerHTML = '<div class="ev-wait"><span class="ld-spin"></span><ol>' + ETAPES.map(function(s, i){ return '<li data-ev-s="' + i + '">○ ' + esc(s) + '</li>'; }).join('') + '</ol></div>';
      } else setBusy('Recherche dans un rayon de ' + rTxt(Rq) + '…');
      var p = CACHE[key] || (CACHE[key] = analyse(o, Rq, tick));
      p.then(function(A){
        if (!ctx.alive()) return;
        S.A = A; setBusy(null);
        if (!S.built) construire();
        dessiner(!first);
      }, function(err){
        delete CACHE[key];
        if (!ctx.alive()) return;
        setBusy(null);
        if (S.built) { S.R = S.A ? Math.min(S.R, S.A.Rq) : R_DEF; segUI(); return; }
        body.innerHTML = '<div class="ev-ban bad"><b>Chargement impossible.</b> ' + esc(err && err.message || err) + '</div><button type="button" class="ld-retry" data-ev="retry">Réessayer</button>';
        q('retry').addEventListener('click', function(){ charger(Rq, true); });
      });
    }
    function setBusy(t){ S.busy = !!t; var b = q('busy'); if (b) { b.hidden = !t; if (t) b.lastChild.textContent = t; } segUI(); }
    function segUI(){
      Array.prototype.forEach.call(body.querySelectorAll('[data-r]'), function(b){ b.setAttribute('aria-pressed', String(+b.getAttribute('data-r') === S.R)); b.disabled = S.busy; });
    }

    function construire(){
      S.built = true;
      body.innerHTML =
        '<div class="ev-grid"><div class="ev-mapw"><div class="ev-map" data-ev="map"></div><div class="ev-busy" data-ev="busy" hidden><span class="ld-spin"></span><span></span></div>' +
        '<p class="ev-meta">Cercle pointillé : rayon choisi ; carré marine : l’ouvrage ; lettre dans un rond : un objet (rond pointillé : point sans contour publié). Zone pointillée sans motif : occurrence précise à 1,5 km près (incertitude, pas une position). Grands polygones en remplissage léger. Cliquer un objet : ses attributs.</p></div>' +
        '<div class="ev-right"><div class="ev-bar"><b>Rayon</b><span class="ev-seg" role="group" aria-label="Rayon de recherche">' +
        RAYONS.map(function(r){ return '<button type="button" data-r="' + r + '" aria-pressed="false">' + rTxt(r) + '</button>'; }).join('') + '</span></div>' +
        '<div class="ev-chips" data-ev="chips"></div><div data-ev="ban"></div>' +
        '<div class="ev-legh"><span>Thèmes sur la carte</span><span><button type="button" data-tous="1">tout afficher</button> · <button type="button" data-tous="0">tout masquer</button></span></div>' +
        '<div class="ev-leg" data-ev="leg"></div></div></div>' +
        '<div class="ev-scroll"><table class="ev" data-ev="tab"></table></div><p class="ev-src" data-ev="foot"></p>';
      Array.prototype.forEach.call(body.querySelectorAll('[data-r]'), function(b){
        b.addEventListener('click', function(){
          var r = +b.getAttribute('data-r');
          if (r === S.R || S.busy) return;
          S.R = r; segUI();
          if (r > S.A.Rq) charger(rayonRequete(r), false); else dessiner(true);
        });
      });
      body.querySelector('.ev-legh').addEventListener('click', function(e){
        var b = e.target.closest('[data-tous]'); if (!b) return;
        var on = b.getAttribute('data-tous') === '1';
        Object.keys(S.vis).forEach(function(k){ S.vis[k] = on; });
        dessiner(false);
      });
      // Survol d'un thème (légende ou ligne du tableau) : ses objets restent nets, les autres s'estompent
      function surligne(k){
        if (k === S.hi) return;
        S.hi = k;
        S.polys.forEach(function(p){ var on = !k || p.k === k; p.pl.setStyle({ opacity: on ? p.sty.opacity : 0.12, fillOpacity: on ? p.sty.fillOpacity : 0.04 }); });
        Object.keys(TH).forEach(function(t){ var el = S.map && S.map.getPane('env-b-' + t); if (el) el.style.opacity = !k || t === k ? '' : '0.15'; });
        var e = S.map && S.map.getPane('env-E'); if (e) e.style.opacity = !k || k === 'E' ? '' : '0.15';
      }
      ['leg', 'tab'].forEach(function(z){
        var el = q(z);
        el.addEventListener('mouseover', function(e){ var t = e.target.closest('[data-th]'); surligne(t ? t.getAttribute('data-th') : null); });
        el.addEventListener('mouseleave', function(){ surligne(null); });
        el.addEventListener('focusin', function(e){ var t = e.target.closest('[data-th]'); surligne(t ? t.getAttribute('data-th') : null); });
        el.addEventListener('focusout', function(){ surligne(null); });
      });
      // case de la légende : on redessine (l'ordre global des polygones, du plus grand au plus petit, est ainsi gardé)
      q('leg').addEventListener('change', function(e){
        var k = e.target.getAttribute('data-k'); if (!k) return;
        S.vis[k] = e.target.checked;
        dessiner(false);
        var cb = q('leg').querySelector('[data-k="' + k + '"]'); if (cb) cb.focus();
      });
      carte();
    }

    function carte(){
      var smooth = !!(L.Map && L.Map.SmoothWheel);            // zoom continu de la carte principale (même gestionnaire)
      var m = S.map = cur.map = L.map(q('map'), { zoomSnap: smooth ? 0 : 0.5, zoomDelta: 0.5, scrollWheelZoom: !smooth, smoothWheel: smooth, minZoom: 7, maxZoom: 19 });
      m.attributionControl.setPrefix(false);
      m.setView([o.lat, o.lon], 14);                             // une vue d'abord : requise avant d'ajouter le cercle
      var F = fonds(), nom = F.OpenStreetMap ? 'OpenStreetMap' : 'Gris clair';
      F[nom].addTo(m);
      var Fc = L.Control.extend({ options: { position: 'topright' }, onAdd: function(){
        var d = L.DomUtil.create('div', 'ev-fonds');
        d.setAttribute('role', 'group'); d.setAttribute('aria-label', 'Fond de carte');
        d.innerHTML = Object.keys(F).map(function(n){ return '<button type="button" data-f="' + esc(n) + '" aria-pressed="' + (n === nom) + '">' + esc(n === 'OpenStreetMap' ? 'OSM' : n) + '</button>'; }).join('');
        L.DomEvent.disableClickPropagation(d);
        d.addEventListener('click', function(e){
          var b = e.target.closest('[data-f]'); if (!b || b.getAttribute('data-f') === nom) return;
          m.removeLayer(F[nom]); nom = b.getAttribute('data-f'); F[nom].addTo(m);
          Array.prototype.forEach.call(d.querySelectorAll('[data-f]'), function(x){ x.setAttribute('aria-pressed', String(x === b)); });
        });
        return d;
      } });
      new Fc().addTo(m);
      // un seul volet pour tous les polygones, triés du plus grand au plus petit (les petits restent visibles, quel que soit
      // leur thème) ; points des espèces envahissantes au-dessus ; un volet de repères (lettres) par thème
      m.createPane('env-poly').style.zIndex = 410;
      m.createPane('env-E').style.zIndex = 435;
      S.poly = L.layerGroup().addTo(m); S.eee = L.layerGroup().addTo(m); S.badges = {}; S.polys = [];
      Object.keys(TH).forEach(function(k){
        var bp = m.createPane('env-b-' + k); bp.style.zIndex = 450; bp.style.pointerEvents = 'none';
        S.badges[k] = L.layerGroup();
      });
      S.circle = L.circle([o.lat, o.lon], { radius: S.R, color: '#102d41', weight: 1.8, dashArray: '6 6', fill: false, interactive: false }).addTo(m);
      L.marker([o.lat, o.lon], { icon: L.divIcon({ className: '', html: '<div class="ev-mk"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }), zIndexOffset: 1000, keyboard: false })
        .bindTooltip('Ouvrage N° ' + esc(o.num) + (o.route ? ' · ' + esc(o.route) : '')).addTo(m);
      setTimeout(function(){ if (ctx.alive() && cur.map === m) m.invalidateSize(); }, 80);
      ctx.onClose(function(){ if (cur.map === m) { m.remove(); cur.map = null; } });
    }

    function dessiner(refit){
      var A = S.A, R = S.R, m = S.map, aDessiner = [];
      S.circle.setRadius(R);
      S.poly.clearLayers(); S.eee.clearLayers(); S.polys = []; S.hi = null;
      Object.keys(S.badges).forEach(function(k){ S.badges[k].clearLayers(); });
      var chips = '', rows = '', leg = '', nPres = 0, nErr = 0, nTrop = 0;
      ORDRE.concat(['X']).forEach(function(k){
        var st = themeState(A, k), items = inR(themeItems(A, k), R), n = items.length, sousH = k === 'H' && A.T.H && A.T.H.viaRegistre;
        if (k === 'X' && !(A.T.X && A.T.X.ok)) return;
        if (st !== 'err' && themeTrop(A, k)) nTrop++;
        // pastille (X : pas de pastille, ligne à part)
        if (k !== 'X') {
          if (st === 'err') { nErr++; chips += '<span class="ev-chip unk" title="Service indisponible : non vérifié">' + lettre(k) + '<span>' + esc(TH[k].court) + '</span><b>?</b></span>'; }
          else { if (n) nPres++; chips += '<span class="ev-chip ' + (n ? 'on' : 'off') + '">' + lettre(k) + '<span>' + esc(TH[k].court) + '</span><b>' + n + '</b></span>'; }
        }
        // légende cochable
        leg += '<label data-th="' + k + '"><input type="checkbox" data-k="' + k + '"' + (S.vis[k] ? ' checked' : '') + (n ? '' : ' disabled') + '>' + swatch(k, null, k === 'X') + lettre(k) +
          '<span>' + esc(TH[k].court) + '</span><span class="nb' + (n ? '' : ' z') + '">' + (st === 'err' ? '?' : n) + '</span></label>';
        // carte : polygones mis de côté (tri global plus bas), points (espèces envahissantes, habitats sans contour publié)
        // dans leur volet, repères (lettres) pour les objets les plus proches
        if (S.vis[k] && n) {
          items.forEach(function(x){
            if (x.pt) {
              var ico = x.th === 'E' ? '<div class="ev-eee"></div>' : '<div class="ev-badge pt" style="border-color:' + TH[x.th].coul + '">' + x.th + '</div>';
              L.marker(x.pt, { icon: L.divIcon({ className: '', html: ico, iconSize: x.th === 'E' ? [14, 13] : [18, 18], iconAnchor: x.th === 'E' ? [7, 7] : [9, 9] }), pane: 'env-E', keyboard: false })
                .bindTooltip(esc(x.th === 'E' ? x.nom : x.type) + (x.date ? ' · ' + esc(x.date.slice(0, 4)) : '') + (x.sansContour ? ' · ' + txtD(x.d) + ' (point indicatif, contour non publié)' : ''))
                .bindPopup(popup(x)).addTo(S.eee);
            } else if (x.rings) {
              if (x.aire == null) x.aire = aireM2(x.rings);
              aDessiner.push(x);
            }
          });
          items.filter(function(x){ return x.rings && !(x.th === 'S' && /^M/.test(x.prec || '')); }).slice(0, k === 'M' ? 3 : 6).forEach(function(x){
            L.marker(x.c, { icon: L.divIcon({ className: '', html: '<div class="ev-badge" style="border-color:' + TH[x.th].coul + '">' + x.th + '</div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
              pane: 'env-b-' + x.th, interactive: false, keyboard: false }).addTo(S.badges[k]);
          });
          S.badges[k].addTo(m);
        } else m.removeLayer(S.badges[k]);
        // tableau
        var head = '<td class="th">' + lettre(k) + '<b>' + esc(k === 'X' ? 'Masquées' : TH[k].court) + '</b></td>', trop = themeTrop(A, k) ? ' <span class="ev-s">(liste tronquée par le service)</span>' : '';
        if (st === 'err') {
          rows += '<tr data-th="' + k + '">' + head + '<td><span class="ev-pill warn">? non vérifié</span></td><td class="d">—</td><td colspan="3">Service sans réponse' + (A.T[k] && A.T[k].err ? ' : ' + esc(A.T[k].err) : '') + '. Réessayer plus tard : ne pas lire ceci comme « absent ».</td><td class="src">' + srcHtml(k === 'M' ? 'MP' : k, A) + '</td></tr>';
        } else if (!n) {
          rows += '<tr class="absent" data-th="' + k + '">' + head + '<td><span class="ev-pill no">○ absent</span></td><td class="d">—</td><td colspan="3">' + (k === 'X' ? 'aucune forme généralisée' : ABSENT_TXT[k]) + ' dans ' + rTxt(R) +
            (st === 'part' ? ' (une des deux sources n’a pas répondu)' : '') + (k === 'M' ? '. Cartographie détaillée au sud seulement ; le modèle « potentiel » couvre tout le Québec.' : '') + '</td><td class="src">' + srcHtml(k === 'M' ? 'MP' : (sousH ? 'H2' : k), A) + '</td></tr>';
        } else {
          var r = RES[k](items, A.T[k] || {});
          rows += '<tr data-th="' + k + '">' + head + '<td><span class="ev-pill ' + (k === 'X' ? 'warn' : 'bad') + '">● présent · ' + n + '</span>' + trop + '</td><td class="d">' + txtD(items[0].d) + '</td><td>' + r.objet + '</td><td class="d">' + r.sup + '</td><td>' + r.statut + '</td><td class="src">' +
            srcHtml(r.src, A) + (r.src2 ? '<br>' + srcHtml(r.src2, A) : '') + '</td></tr>';
        }
      });
      // tous thèmes confondus, du plus grand polygone au plus petit : les petits restent visibles et cliquables
      aDessiner.sort(function(a, b){ return b.aire - a.aire; }).forEach(function(x){
        var sty = styleOf(x, R), pl = L.polygon(x.rings.map(function(r){ return r.map(function(p){ return [p[1], p[0]]; }); }), sty)
          .bindTooltip(lettreTxt(x) + esc(x.nom || x.type || '') + ' · ' + txtD(x.d), { sticky: true }).bindPopup(popup(x));
        pl.on('mouseover', function(){ pl.setStyle({ weight: sty.weight + 2.2 }); }).on('mouseout', function(){ pl.setStyle({ weight: sty.weight }); });
        pl.addTo(S.poly);
        S.polys.push({ k: x.th, pl: pl, sty: sty });
      });
      q('leg').innerHTML = leg;
      q('chips').innerHTML = chips;
      q('tab').innerHTML = '<thead><tr><th>Thème</th><th>Présence</th><th>Distance</th><th>Objet (nom, type)</th><th>Superficie</th><th>Statut légal (résumé)</th><th>Source · licence · date</th></tr></thead><tbody>' + rows + '</tbody>';
      var ban = '';
      if (nErr) ban += '<div class="ev-ban warn"><b>' + nErr + ' thème(s) non vérifié(s).</b> Un service du gouvernement n’a pas répondu : la ligne porte « ? », pas « absent ».</div>';
      else if (!nPres) ban += '<div class="ev-ban ok"><b>Rien de répertorié</b> dans ' + rTxt(R) + ' pour ces sept thèmes. Essayer un rayon plus grand ; cela ne remplace pas une demande au CDPNQ.</div>';
      if (nTrop) ban += '<div class="ev-ban warn"><b>Liste tronquée.</b> Un service a renvoyé son maximum d’objets (2 000) : réduire le rayon pour tout voir.</div>';
      if (A.hSource === 'registre') ban += '<div class="ev-ban warn"><b>Habitats fauniques : version du registre.</b> Le fichier précalculé des habitats du MRNF (data/couche-environnement.js) n’a pas pu être lu : on ne voit que les habitats inscrits au registre des aires protégées, sans espèces.</div>';
      if (A.T.S && A.T.S.ok && A.T.S.items.some(function(x){ return x.d <= R; })) ban += '<div class="ev-ban warn"><b>Espèces en situation précaire.</b> Les espèces sensibles à la diffusion sont masquées par le CDPNQ ; l’absence d’occurrence ne prouve pas l’absence d’espèce. Les précisions « < 1,5 km » sont des zones d’incertitude, pas des positions.</div>';
      q('ban').innerHTML = ban;
      q('foot').innerHTML = 'Mesure : ' + A.nreq + ' requêtes, ' + NF0.format(Math.round(A.bytes / 1024)) + ' Ko, ' + NF1.format(A.secs || 0) + ' s (recherche à ' + rTxt(A.Rq) + ', données en direct du MELCCFP' +
        (A.hSource === 'etl' ? ' ; habitats fauniques du MRNF précalculés le ' + esc(A.hGen || '') + ', contours simplifiés à ' + esc(A.hTol || '') + ' m' : '') + '). Distances à ± 20 m (géométries simplifiées). ' +
        'Absent = rien de répertorié dans ces jeux de données, pas absence sur le terrain. Statuts légaux résumés, sans valeur d’avis : ne remplace ni une demande au CDPNQ ni une autorisation ministérielle. ' +
        'Sources (Données Québec, CC BY 4.0) : ' + ['P', 'H', 'F', 'S', 'MD', 'MP', 'Z', 'E'].map(function(k){ return '<a href="' + esc(DQ + SRC[k].slug) + '" target="_blank" rel="noopener">' + esc(SRC[k].titre) + '</a>'; }).join(' · ') +
        ' · <a href="https://www.donneesquebec.ca/licence/" target="_blank" rel="noopener">licence</a>. © Gouvernement du Québec (MELCCFP, MRNF), CDPNQ et ses collaborateurs.';
      segUI();
      if (refit || !S.fitted) { m.fitBounds(S.circle.getBounds().pad(0.06), { animate: false }); S.fitted = true; }
    }

    charger(rayonRequete(S.R), true);
  }

  window.QA_MOD.environnement = {
    render: render,
    _t: { polyDist: polyDist, aireM2: aireM2, decodeRing: decodeRing, habitatsNear: habitatsNear, inR: inR, txtD: txtD, fmtD: fmtD, rayonRequete: rayonRequete, RES: RES }
  };
})();
