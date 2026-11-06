/* « Vue 3D du site » : fenêtre de QuickerAtlas (prototype v0.7), module chargé à la demande (openAux).
   Contrat : window.QA_MOD.vue3d.render(o, body, ctx). ES5.
   Question : à quoi ressemble le terrain autour de l'ouvrage (vallée, berges, remblais d'approche) ? Un bloc de
   1 km × 1 km (distances au sol), qu'on fait pivoter, zoomer et déplacer, avec l'imagerie satellite drapée dessus.
   Sources (toutes ouvertes, sans clé, CORS autorisé, lues directement par le navigateur) :
   - Relief : MNEHR / HRDEM 1 m de RNCan, Data Cube (WCS 1.1.1, GeoTIFF flottants 32 bits), identifiants « dtm » (sol nu)
     et « dsm » (surface : arbres, bâtiments, tablier). Même service et même lecteur TIFF que js/lidar.js (copiés ici, lidar.js
     n'est pas modifié). La grille est demandée à ~400 × 400 points (GridOffsets) : ≈ 2,5 m au sol, ≈ 0,6 Mo par couche.
     Licence du gouvernement ouvert – Canada. Hors couverture LiDAR (nord, certaines régions) : le service renvoie du vide ;
     la fenêtre le dit et ne dessine rien (pas de repli grossier : le CDEM n'est pas exposé par ce Data Cube).
   - Imagerie : Esri World Imagery (export du MapServer, 1024 × 1024, « Access-Control-Allow-Origin: * » donc texture WebGL
     possible). Imagerie © Esri, Maxar, Earthstar Geographics. Choix « Relief seul » : gris clair ombré, sans image.
   - Rendu : Three.js r147 (MIT), version exacte, chargée de cdn.jsdelivr.net avec OrbitControls (build UMD) à la première ouverture.
   Choix : emprise carrée dans Web Mercator corrigée de 1/cos(latitude) pour que le bloc fasse bien 1 km au sol ; maillage
   250 × 250 ; nord vers −Z ; exagération verticale 1× à 3× ; rendu à la demande (pas de boucle continue) ; tout est libéré
   (géométries, textures, moteur, requestAnimationFrame) à la fermeture.
   Daltonisme : le repère de l'ouvrage est une flèche jaune sur mât marine (forme + contraste), pas une couleur seule. */
(function(){
  'use strict';
  window.QA_MOD = window.QA_MOD || {};

  /* ================= Outils purs (testables sans navigateur ni WebGL) ================= */
  var R_TERRE = 6378137, DEMI = 500, N_DATA = 400, N_MAILLE = 250, N_IMG = 1024;
  var THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js';
  var ORBIT_URL = 'https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/controls/OrbitControls.js';
  var EXAGS = [1, 1.5, 2, 3];

  function merc(lat, lon){ return [lon * Math.PI / 180 * R_TERRE, Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * R_TERRE]; }
  function unmerc(x, y){ return [(2 * Math.atan(Math.exp(y / R_TERRE)) - Math.PI / 2) * 180 / Math.PI, x / R_TERRE * 180 / Math.PI]; }
  // Emprise [xmin, ymin, xmax, ymax] en EPSG:3857 d'un carré de côté 2 × demi (mètres AU SOL) centré sur le point :
  // Web Mercator allonge les distances de 1/cos(lat), d'où la demi-largeur corrigée.
  function bboxAutour(lat, lon, demi){
    var c = merc(lat, lon), h = (demi == null ? DEMI : demi) / Math.cos(lat * Math.PI / 180);
    return [c[0] - h, c[1] - h, c[0] + h, c[1] + h];
  }
  function fx(v){ return v.toFixed(1); }
  // Requête WCS 1.1.1 : grille imposée de n × n cellules (GridOrigin = coin nord-ouest, pas en mètres Mercator)
  function urlWcs(base, kind, bb, n){
    var pas = (bb[2] - bb[0]) / n;
    return base + '?service=WCS&version=1.1.1&request=GetCoverage&identifier=' + kind + '&boundingbox=' + bb.map(fx).join(',') +
      ',urn:ogc:def:crs:EPSG::3857&format=image/geotiff&GridBaseCRS=urn:ogc:def:crs:EPSG::3857&GridCS=urn:ogc:def:cs:OGC:0.0:Grid2dSquareCS' +
      '&GridType=urn:ogc:def:method:WCS:1.1:2dGridIn2dCrs&GridOrigin=' + fx(bb[0]) + ',' + fx(bb[3]) + '&GridOffsets=' + pas.toFixed(4) + ',-' + pas.toFixed(4);
  }
  function urlEsri(esri, bb, n){
    return esri + 'World_Imagery/MapServer/export?bbox=' + bb.map(fx).join(',') + '&bboxSR=3857&imageSR=3857&size=' + n + ',' + n + '&format=jpg&f=image';
  }
  // GeoTIFF du WCS : flottants 32 bits, tuilés ou en bandes, non compressés (copie de ldTiff de js/lidar.js)
  function lireTiff(buf){
    var dv = new DataView(buf), le = dv.getUint16(0) === 0x4949, u16 = function(o){ return dv.getUint16(o, le); }, u32 = function(o){ return dv.getUint32(o, le); };
    if (u16(2) !== 42) throw new Error('Réponse du serveur illisible (pas un GeoTIFF)');
    var ifd = u32(4), n = u16(ifd), T = {}, size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8 };
    for (var i = 0; i < n; i++) {
      var e = ifd + 2 + i * 12, tag = u16(e), type = u16(e + 2), cnt = u32(e + 4), sz = (size[type] || 1) * cnt, off = sz <= 4 ? e + 8 : u32(e + 8), vals = [];
      for (var j = 0; j < cnt && type !== 2; j++) {
        var p = off + j * size[type];
        vals.push(type === 3 ? u16(p) : type === 4 || type === 16 ? u32(p) : type === 12 ? dv.getFloat64(p, le) : type === 11 ? dv.getFloat32(p, le) : dv.getUint8(p));
      }
      T[tag] = vals;
    }
    if (!T[256] || !T[257] || !T[33550] || !T[33922]) throw new Error('GeoTIFF incomplet');
    var w = T[256][0], h = T[257][0], tw = T[322] ? T[322][0] : w, th = T[323] ? T[323][0] : (T[278] ? T[278][0] : h);
    var offs = T[324] || T[273], nx = Math.ceil(w / tw), a = new Float32Array(w * h), nOk = 0, k;
    for (k = 0; k < a.length; k++) a[k] = NaN;
    offs.forEach(function(o, k2){
      var ty = Math.floor(k2 / nx), tx = k2 % nx;
      for (var r = 0; r < th; r++) for (var c = 0; c < tw; c++) {
        var y = ty * th + r, x = tx * tw + c; if (y >= h || x >= w) continue;
        var v = dv.getFloat32(o + (r * tw + c) * 4, le);
        if (v > -1000 && v < 9000) { a[y * w + x] = v; nOk++; }
      }
    });
    return { a: a, w: w, h: h, sx: T[33550][0], sy: T[33550][1], X0: T[33922][3], Y0: T[33922][4], ok: nOk / (w * h) };
  }
  // Interpolation bilinéaire ; NaN hors emprise ou si un des 4 pixels voisins est sans donnée
  function echant(D, x, y){
    var c = (x - D.X0) / D.sx - 0.5, r = (D.Y0 - y) / D.sy - 0.5;
    if (!(c >= -0.5 && r >= -0.5 && c <= D.w - 0.5 && r <= D.h - 0.5)) return NaN;
    c = Math.max(0, Math.min(D.w - 1, c)); r = Math.max(0, Math.min(D.h - 1, r));
    var c0 = Math.min(Math.max(D.w - 2, 0), Math.floor(c)), r0 = Math.min(Math.max(D.h - 2, 0), Math.floor(r)), fc = c - c0, fr = r - r0;
    var c1 = Math.min(D.w - 1, c0 + 1), r1 = Math.min(D.h - 1, r0 + 1), A = D.a;
    return A[r0 * D.w + c0] * (1 - fc) * (1 - fr) + A[r0 * D.w + c1] * fc * (1 - fr) + A[r1 * D.w + c0] * (1 - fc) * fr + A[r1 * D.w + c1] * fc * fr;
  }
  // Altitudes (m) aux (n + 1)² sommets du maillage couvrant bb ; rangée 0 = nord, colonne 0 = ouest. NaN = sans donnée.
  function grilleAltitudes(D, bb, n){
    var m = n + 1, z = new Float32Array(m * m), ok = 0;
    for (var iy = 0; iy < m; iy++) for (var ix = 0; ix < m; ix++) {
      var v = echant(D, bb[0] + ix / n * (bb[2] - bb[0]), bb[3] - iy / n * (bb[3] - bb[1]));
      z[iy * m + ix] = v;
      if (isFinite(v)) ok++;
    }
    return { z: z, n: n, ok: ok / (m * m) };
  }
  // Bouche les trous (NaN) par la moyenne des voisins valides, de proche en proche ; reste sans donnée = valeur de repli.
  // Renvoie le nombre de sommets comblés. Modifie z en place.
  function combler(z, n, repli){
    var m = n + 1, rempli = 0, passe, i, ix, iy;
    for (passe = 0; passe < 400; passe++) {
      var neufs = [], vals = [];
      for (iy = 0; iy < m; iy++) for (ix = 0; ix < m; ix++) {
        i = iy * m + ix;
        if (isFinite(z[i])) continue;
        var s = 0, c = 0, v;
        if (ix > 0 && isFinite(v = z[i - 1])) { s += v; c++; }
        if (ix < n && isFinite(v = z[i + 1])) { s += v; c++; }
        if (iy > 0 && isFinite(v = z[i - m])) { s += v; c++; }
        if (iy < n && isFinite(v = z[i + m])) { s += v; c++; }
        if (c) { neufs.push(i); vals.push(s / c); }
      }
      if (!neufs.length) break;
      for (i = 0; i < neufs.length; i++) z[neufs[i]] = vals[i];
      rempli += neufs.length;
    }
    for (i = 0; i < z.length; i++) if (!isFinite(z[i])) { z[i] = repli; rempli++; }
    return rempli;
  }
  function minMax(z){
    var mn = Infinity, mx = -Infinity;
    for (var i = 0; i < z.length; i++) { var v = z[i]; if (isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; } }
    return mn === Infinity ? null : { min: mn, max: mx };
  }
  // Hauteurs du maillage : (altitude − référence) × exagération ; sans donnée → 0 (au niveau de la référence)
  function hauteurs(z, zref, exag, out){
    out = out || new Float32Array(z.length);
    for (var i = 0; i < z.length; i++) out[i] = isFinite(z[i]) ? (z[i] - zref) * exag : 0;
    return out;
  }
  // Positions (x, y, z) du maillage en mètres au sol : x vers l'est, z vers le SUD (nord = −Z), y = hauteur
  function positionsMaille(y, n, L, out){
    var m = n + 1;
    out = out || new Float32Array(m * m * 3);
    for (var iy = 0; iy < m; iy++) for (var ix = 0; ix < m; ix++) {
      var i = iy * m + ix;
      out[i * 3] = (ix / n - 0.5) * L; out[i * 3 + 1] = y[i]; out[i * 3 + 2] = (iy / n - 0.5) * L;
    }
    return out;
  }
  // « Jupe » du bloc : 4 parois du terrain jusqu'à la base (y = base), (n + 1) × 2 sommets par paroi (haut puis bas)
  function jupe(y, n, L, base, out){
    var m = n + 1, w = 0, a, k, x, z, h;
    out = out || new Float32Array(4 * m * 2 * 3);
    function pousse(px, py, pz){ out[w++] = px; out[w++] = py; out[w++] = pz; }
    for (a = 0; a < 4; a++) for (k = 0; k <= n; k++) {
      var t = (k / n - 0.5) * L, i;
      if (a === 0) { i = k; x = t; z = -L / 2; }                       // bord nord
      else if (a === 1) { i = n * m + k; x = t; z = L / 2; }           // bord sud
      else if (a === 2) { i = k * m; x = -L / 2; z = t; }              // bord ouest
      else { i = k * m + n; x = L / 2; z = t; }                        // bord est
      h = y[i];
      pousse(x, h, z); pousse(x, base, z);
    }
    return out;
  }
  function jupeIndex(n){
    var idx = [], m = n + 1, a, k;
    for (a = 0; a < 4; a++) for (k = 0; k < n; k++) {
      var b = a * m * 2 + k * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    return idx;
  }
  // Bilan du jeu de données : 'vide' (hors LiDAR), 'partiel' ou 'complet'
  function couverture(okMnt){ return okMnt < 0.05 ? 'vide' : okMnt < 0.97 ? 'partiel' : 'complet'; }
  // Angle (degrés, horaire depuis le haut de l'écran) de la flèche du nord pour un azimut de caméra θ (rad, depuis +Z vers +X)
  function angleNord(azimut){ return azimut * 180 / Math.PI; }

  /* ================= Fenêtre ================= */
  var CSS_OK = false;
  function injecterCss(){
    if (CSS_OK) return; CSS_OK = true;
    var s = document.createElement('style');
    s.textContent =
      '.v3{max-width:780px;margin:0 auto;padding:10px 14px 14px;color:#17374b}' +
      '.v3-bar{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin-bottom:8px;font-size:13px}' +
      '.v3-bar b{font-weight:600}.v3-seg{display:inline-flex;border:1px solid #9fb3c0;border-radius:8px;overflow:hidden}' +
      '.v3-seg button,.v3-btn{font:inherit;font-size:13px;padding:5px 10px;border:0;background:#fff;color:#17374b;cursor:pointer;min-height:32px}' +
      '.v3-seg button+button{border-left:1px solid #9fb3c0}.v3-seg button[aria-pressed=true]{background:#17374b;color:#fff;font-weight:600}' +
      '.v3-btn{border:1px solid #9fb3c0;border-radius:8px}.v3-btn:hover,.v3-seg button:hover{background:#e4edf2}.v3-seg button[aria-pressed=true]:hover{background:#17374b}' +
      '.v3-view{position:relative;background:#cfd8dc;border-radius:8px;overflow:hidden;touch-action:none}' +
      '.v3-view canvas{display:block;width:100%;height:100%;outline:0}' +
      '.v3-nord{position:absolute;top:10px;right:10px;width:44px;height:44px;pointer-events:none;background:#ffffffcc;border-radius:50%;box-shadow:0 0 0 1px #17374b55}' +
      '.v3-nord svg{width:100%;height:100%;transition:none}' +
      '.v3-ech{position:absolute;left:10px;bottom:10px;background:#ffffffd9;border-radius:6px;padding:3px 8px;font-size:12px;pointer-events:none}' +
      '.v3-load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#0b1e2b55;color:#fff;font-size:14px;text-align:center;padding:16px}' +
      '.v3-aide{font-size:12px;color:#456;margin:6px 0 0}.v3-pied{font-size:11.5px;color:#456;line-height:1.45;margin:8px 0 0}' +
      '.v3-ban{border:1px solid #c9a227;background:#fff8dc;border-radius:8px;padding:9px 12px;font-size:13px;margin:0 0 8px}' +
      '.v3-ban.bad{border-color:#a50026;background:#fdecee}.v3-proto{display:inline-block;font-size:11px;border:1px solid #9fb3c0;border-radius:99px;padding:1px 8px;margin-left:6px;color:#456}';
    document.head.appendChild(s);
  }

  function render(o, body, ctx){
    var Q = window.QA, esc = Q.esc, nf1 = Q.nf1, nf = Q.nf, fetchT = Q.fetchT, ESRI = Q.ESRI, WCS = Q.LD_WCS;
    injecterCss();
    var S = { exag: 2, fond: 'sat', mnt: 'dtm', dead: false, raf: 0, need: false, A: null, tex: null, T0: Date.now() };
    var bb = bboxAutour(o.lat, o.lon, DEMI), L = 2 * DEMI;
    ctx.onClose(function(){ S.dead = true; liberer(); });

    function attente(t){ body.innerHTML = '<div class="ld-wait"><span class="ld-spin"></span>' + esc(t) + '</div>'; }
    function attend(ms){ return new Promise(function(res){ setTimeout(res, ms); }); }
    // le serveur répond parfois par une erreur sans en-tête CORS : deux nouvelles tentatives espacées (comme js/lidar.js)
    function tiff(kind){
      var get = function(){ return fetchT(urlWcs(WCS, kind, bb, N_DATA), null, 30000, 'arrayBuffer'); };
      return get().catch(function(){ return attend(1500).then(get); }).catch(function(){ return attend(4000).then(get); }).then(lireTiff);
    }
    function imagerie(){
      return fetchT(urlEsri(ESRI, bb, N_IMG), null, 40000, 'arrayBuffer').then(function(buf){
        return new Promise(function(res, rej){
          var u = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' })), im = new Image();
          im.onload = function(){ URL.revokeObjectURL(u); res(im); };
          im.onerror = function(){ URL.revokeObjectURL(u); rej(new Error('image illisible')); };
          im.src = u;
        });
      });
    }

    function charger(){
      attente('Chargement du relief LiDAR (MNEHR 1 m), de l’image satellite et du moteur 3D…');
      S.octets = 0;
      var pThree = Q.loadScript(THREE_URL).then(function(){ return Q.loadScript(ORBIT_URL); });
      var pDtm = tiff('dtm'), pDsm = tiff('dsm').catch(function(){ return null; }), pImg = imagerie().catch(function(){ return null; });
      Promise.all([pDtm, pThree]).then(function(r){
        if (S.dead || !ctx.alive()) return;
        var dtm = r[0];
        if (couverture(dtm.ok) === 'vide') { aucun(); return; }
        return Promise.all([pDsm, pImg]).then(function(r2){
          if (S.dead || !ctx.alive()) return;
          construire(dtm, r2[0], r2[1]);
        });
      }).catch(function(err){
        if (S.dead || !ctx.alive()) return;
        body.innerHTML = '<div class="v3"><div class="v3-ban bad"><b>Chargement impossible.</b> ' + esc(err && err.message || String(err)) +
          '</div><button type="button" class="v3-btn" data-v3="retry">Réessayer</button></div>';
        body.querySelector('[data-v3=retry]').addEventListener('click', charger);
      });
    }
    function aucun(){
      body.innerHTML = '<div class="v3"><div class="v3-ban"><b>Pas de LiDAR ici.</b> Le relief au mètre de Ressources naturelles Canada (MNEHR) ne couvre pas ce secteur : ' +
        'la vue 3D n’est pas disponible pour cet ouvrage. La couverture s’étend peu à peu (surtout le sud du Québec).</div>' +
        '<p class="v3-pied">Relief : MNEHR 1 m © Ressources naturelles Canada (Licence du gouvernement ouvert – Canada). <span class="v3-proto">Prototype v0.7</span></p></div>';
      ctx.setSub('Hors couverture LiDAR');
    }

    var gl = null;   // tout ce qui doit être libéré
    function liberer(){
      if (S.raf) cancelAnimationFrame(S.raf);
      S.raf = 0;
      if (S.ro) { try { S.ro.disconnect(); } catch (e) { /* ancien navigateur */ } S.ro = null; }
      if (S.onResize) window.removeEventListener('resize', S.onResize);
      if (gl) {
        try {
          gl.controls.dispose();
          gl.scene.traverse(function(obj){
            if (obj.geometry) obj.geometry.dispose();
            var mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
            mats.forEach(function(mt){ if (mt.map) mt.map.dispose(); mt.dispose(); });
          });
          if (S.tex) S.tex.dispose();
          gl.renderer.dispose();
          if (gl.renderer.forceContextLoss) gl.renderer.forceContextLoss();
        } catch (e) { /* déjà libéré */ }
        gl = null;
      }
    }

    function construire(dtm, dsm, img){
      var THREE = window.THREE;
      // altitudes aux sommets (sol nu, et surface si disponible), trous comblés
      var gM = grilleAltitudes(dtm, bb, N_MAILLE), gS = dsm ? grilleAltitudes(dsm, bb, N_MAILLE) : null;
      var mmM = minMax(gM.z) || { min: 0, max: 0 };
      var comblesM = combler(gM.z, N_MAILLE, mmM.min), comblesS = gS ? combler(gS.z, N_MAILLE, mmM.min) : 0;
      // la surface ne passe jamais sous le sol (artefacts de rééchantillonnage)
      if (gS) for (var q = 0; q < gS.z.length; q++) if (gS.z[q] < gM.z[q]) gS.z[q] = gM.z[q];
      S.A = { dtm: gM.z, dsm: gS ? gS.z : null, okM: gM.ok, comblesM: comblesM, comblesS: comblesS };
      var mnS = gS ? minMax(gS.z) : null;
      S.zref = minMax(gM.z).min; S.zmax = Math.max(minMax(gM.z).max, mnS ? mnS.max : -Infinity);

      var sc = couverture(dtm.ok), ban = '';
      if (sc === 'partiel') ban = '<div class="v3-ban">LiDAR partiel : ' + nf.format(Math.round(dtm.ok * 100)) + ' % du bloc est couvert ; le reste est interpolé (relief approximatif).</div>';
      body.innerHTML =
        '<div class="v3">' + ban +
        '<div class="v3-bar"><span class="v3-seg" role="group" aria-label="Type de relief"><button type="button" data-relief="dtm" aria-pressed="true">Sol nu (MNT)</button>' +
          '<button type="button" data-relief="dsm"' + (gS ? '' : ' disabled title="Surface indisponible"') + ' aria-pressed="false">Surface (MNS)</button></span>' +
        '<span class="v3-seg" role="group" aria-label="Fond"><button type="button" data-fond="sat" aria-pressed="true"' + (img ? '' : ' disabled title="Image indisponible"') + '>Satellite</button>' +
          '<button type="button" data-fond="gris" aria-pressed="false">Relief seul</button></span>' +
        '<span><b>Exagération</b> <span class="v3-seg" role="group" aria-label="Exagération verticale">' +
          EXAGS.map(function(e){ return '<button type="button" data-ex="' + e + '" aria-pressed="false">' + String(e).replace('.', ',') + '×</button>'; }).join('') + '</span></span>' +
        '<button type="button" class="v3-btn" data-v3="recentrer">Recentrer</button></div>' +
        '<div class="v3-view" data-v3="vue"><div class="v3-nord" aria-hidden="true"><svg viewBox="0 0 44 44" data-v3="nord"><polygon points="22,5 29,25 22,21 15,25" fill="#a50026" stroke="#17374b" stroke-width="1.5"/>' +
          '<polygon points="22,39 29,25 22,21 15,25" fill="#fff" stroke="#17374b" stroke-width="1.5"/><text x="22" y="16" text-anchor="middle" font-size="10" font-weight="700" fill="#17374b" stroke="#fff" stroke-width="2.5" paint-order="stroke">N</text></svg></div>' +
        '<div class="v3-ech">Bloc de 1 km × 1 km</div></div>' +
        '<p class="v3-aide">Glisser pour tourner · molette (ou pincer) pour zoomer · clic droit (ou deux doigts) pour déplacer.</p>' +
        '<p class="v3-pied" data-v3="pied"></p></div>';
      var vue = body.querySelector('[data-v3=vue]');
      vue.style.height = Math.max(300, Math.min(520, Math.round(vue.clientWidth * 0.68))) + 'px';

      var renderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      } catch (e) {
        body.insertAdjacentHTML('afterbegin', '<div class="v3"><div class="v3-ban bad"><b>WebGL indisponible.</b> Ce navigateur ne peut pas afficher la 3D.</div></div>');
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.setClearColor(0xcfd8dc, 1);
      vue.insertBefore(renderer.domElement, vue.firstChild);
      renderer.domElement.setAttribute('aria-label', 'Vue 3D du terrain autour de l’ouvrage');
      var scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(45, 1, 2, 12000);
      scene.add(new THREE.AmbientLight(0xffffff, 0.5));
      scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x8a8f78, 0.15));
      var sun = new THREE.DirectionalLight(0xffffff, 0.45); sun.position.set(-600, 900, 500); scene.add(sun);

      // terrain
      var geo = new THREE.PlaneGeometry(L, L, N_MAILLE, N_MAILLE), tmpY = new Float32Array(gM.z.length);
      var mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      var mesh = new THREE.Mesh(geo, mat); scene.add(mesh);
      if (img) {
        S.tex = new THREE.Texture(img); S.tex.encoding = THREE.sRGBEncoding; S.tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        S.tex.needsUpdate = true;
      }
      // jupe et cadre du bloc
      var jg = new THREE.BufferGeometry(), jpos = new Float32Array(4 * (N_MAILLE + 1) * 2 * 3);
      jg.setAttribute('position', new THREE.BufferAttribute(jpos, 3)); jg.setIndex(jupeIndex(N_MAILLE));
      scene.add(new THREE.Mesh(jg, new THREE.MeshBasicMaterial({ color: 0x6b6358, side: THREE.DoubleSide })));
      // repère de l'ouvrage : mât marine + flèche jaune pointant vers le sol
      var mk = new THREE.Group();
      var mast = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 90, 8), new THREE.MeshBasicMaterial({ color: 0x102d41 })); mast.position.y = 45 + 24; mk.add(mast);
      var cone = new THREE.Mesh(new THREE.ConeGeometry(11, 26, 16), new THREE.MeshBasicMaterial({ color: 0xfde047 })); cone.rotation.x = Math.PI; cone.position.y = 13; mk.add(cone);
      var ring = new THREE.Mesh(new THREE.RingGeometry(14, 17, 32), new THREE.MeshBasicMaterial({ color: 0x102d41, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.8; mk.add(ring);
      scene.add(mk);
      // barre d'échelle de 1 km sur le bord sud, au niveau de la base, avec étiquette
      var BASE = -12;
      var barre = new THREE.Mesh(new THREE.BoxGeometry(L, 3, 3), new THREE.MeshBasicMaterial({ color: 0xfde047 })); barre.position.set(0, BASE - 2, L / 2 + 14); scene.add(barre);
      [-L / 2, L / 2].forEach(function(x){ var t = new THREE.Mesh(new THREE.BoxGeometry(3, 18, 3), new THREE.MeshBasicMaterial({ color: 0xfde047 })); t.position.set(x, BASE + 4, L / 2 + 14); scene.add(t); });
      var cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
      var g2 = cv.getContext('2d'); g2.font = 'bold 40px sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.lineWidth = 8; g2.strokeStyle = '#17374b'; g2.strokeText('1 km', 128, 34); g2.fillStyle = '#fde047'; g2.fillText('1 km', 128, 34);
      var ctex = new THREE.CanvasTexture(cv), sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex, depthTest: false }));
      sprite.scale.set(160, 40, 1); sprite.position.set(0, BASE + 30, L / 2 + 14); sprite.renderOrder = 10; scene.add(sprite);

      var controls = new THREE.OrbitControls(cam, renderer.domElement);
      controls.enableDamping = false; controls.maxPolarAngle = Math.PI * 0.485; controls.minDistance = 60; controls.maxDistance = 7000; controls.screenSpacePanning = false;
      gl = { renderer: renderer, scene: scene, cam: cam, controls: controls };

      function demande(){ if (S.dead || S.raf) return; S.raf = requestAnimationFrame(function(){ S.raf = 0; if (S.dead) return; dessine(); }); }
      function dessine(){
        var az = controls.getAzimuthalAngle(), nord = body.querySelector('[data-v3=nord]');
        if (nord) nord.style.transform = 'rotate(' + angleNord(az).toFixed(1) + 'deg)';
        renderer.render(scene, cam);
      }
      controls.addEventListener('change', demande);

      function majRelief(){
        var z = S.mnt === 'dsm' && S.A.dsm ? S.A.dsm : S.A.dtm;
        hauteurs(z, S.zref, S.exag, tmpY);
        var pos = geo.attributes.position; positionsMaille(tmpY, N_MAILLE, L, pos.array); pos.needsUpdate = true;
        geo.computeVertexNormals(); geo.computeBoundingSphere();
        jupe(tmpY, N_MAILLE, L, BASE * 1, jg.attributes.position.array); jg.attributes.position.needsUpdate = true; jg.computeBoundingSphere();
        var c = (N_MAILLE / 2) * (N_MAILLE + 1) + N_MAILLE / 2, h = tmpY[c];
        mk.position.set(0, h, 0);
        demande();
      }
      function majFond(){
        if (S.fond === 'sat' && S.tex) { mat.map = S.tex; mat.color.setHex(0xffffff); } else { mat.map = null; mat.color.setHex(0xc4c1b6); }
        mat.needsUpdate = true; demande();
      }
      function boutons(){
        Array.prototype.forEach.call(body.querySelectorAll('[data-relief]'), function(b){ b.setAttribute('aria-pressed', String(b.getAttribute('data-relief') === S.mnt)); });
        Array.prototype.forEach.call(body.querySelectorAll('[data-fond]'), function(b){ b.setAttribute('aria-pressed', String(b.getAttribute('data-fond') === S.fond)); });
        Array.prototype.forEach.call(body.querySelectorAll('[data-ex]'), function(b){ b.setAttribute('aria-pressed', String(+b.getAttribute('data-ex') === S.exag)); });
      }
      function pied(){
        var z = S.mnt === 'dsm' ? S.A.dsm : S.A.dtm, mm = minMax(z), mmD = minMax(S.A.dtm), t = (Date.now() - S.T0) / 1000;
        body.querySelector('[data-v3=pied]').innerHTML =
          'Altitudes affichées : ' + nf1.format(mm.min) + ' à ' + nf1.format(mm.max) + ' m (dénivelé ' + nf1.format(mm.max - mm.min) + ' m ; sol nu : ' + nf1.format(mmD.min) + ' à ' + nf1.format(mmD.max) + ' m), exagération verticale ' + String(S.exag).replace('.', ',') + '×. ' +
          'Maillage ' + N_MAILLE + ' × ' + N_MAILLE + ' (≈ ' + nf1.format(L / N_MAILLE) + ' m), données chargées en ' + nf1.format(t) + ' s. Le repère jaune marque la position de l’ouvrage (N° ' + esc(o.num) + ') ; en mode MNS, le tablier et les arbres sont dans le relief. ' +
          'Hauteurs au sol approximatives : le centre du bloc peut tomber sur le tablier ou sous lui.<br>' +
          'Relief : MNEHR 1 m © Ressources naturelles Canada (Licence du gouvernement ouvert – Canada) · ' + (S.tex ? 'Imagerie © Esri, Maxar, Earthstar Geographics' : 'imagerie satellite indisponible') +
          ' · rendu Three.js r147 (MIT). <span class="v3-proto">Prototype v0.7</span>';
      }
      // vue initiale : depuis le sud, 40° au-dessus de l'horizon ; recul et cible suivent le dénivelé (vallées encaissées)
      function vueInitiale(){
        var z = S.mnt === 'dsm' && S.A.dsm ? S.A.dsm : S.A.dtm, mm = minMax(z), rel = (mm.max - mm.min) * S.exag, dist = Math.max(1500, 1300 + 1.6 * rel);
        cam.position.set(0, dist * Math.sin(40 * Math.PI / 180) + rel * 0.4, dist * Math.cos(40 * Math.PI / 180));
        controls.target.set(0, rel * 0.35, 0); controls.update();
      }
      function recentrer(){ vueInitiale(); demande(); }

      body.querySelector('.v3').addEventListener('click', function(e){
        var b = e.target.closest ? e.target.closest('button') : null; if (!b || b.disabled) return;
        if (b.hasAttribute('data-relief')) { S.mnt = b.getAttribute('data-relief'); majRelief(); }
        else if (b.hasAttribute('data-fond')) { S.fond = b.getAttribute('data-fond'); majFond(); }
        else if (b.hasAttribute('data-ex')) { S.exag = +b.getAttribute('data-ex'); majRelief(); }
        else if (b.getAttribute('data-v3') === 'recentrer') { recentrer(); return; }
        else return;
        boutons(); pied();
      });
      function taille(){
        if (S.dead || !gl) return;
        var w = vue.clientWidth || 600, h = Math.max(300, Math.min(520, Math.round(w * (w < 500 ? 0.9 : 0.68))));
        vue.style.height = h + 'px';
        renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); demande();
      }
      if (window.ResizeObserver) { S.ro = new ResizeObserver(taille); S.ro.observe(vue); } else { S.onResize = taille; window.addEventListener('resize', taille); }
      majRelief(); majFond(); boutons(); pied(); vueInitiale(); taille();
      ctx.setSub('Bloc 1 km × 1 km · LiDAR ' + nf1.format(L / N_DATA) + ' m' + (sc2(dtm) ? ' (partiel)' : ''));
      S.hook = { renderer: renderer, scene: scene, cam: cam, controls: controls, S: S };
    }
    function sc2(dtm){ return couverture(dtm.ok) === 'partiel'; }

    charger();
  }

  window.QA_MOD.vue3d = {
    render: render,
    _t: { merc: merc, unmerc: unmerc, bboxAutour: bboxAutour, urlWcs: urlWcs, urlEsri: urlEsri, lireTiff: lireTiff, echant: echant,
      grilleAltitudes: grilleAltitudes, combler: combler, minMax: minMax, hauteurs: hauteurs, positionsMaille: positionsMaille,
      jupe: jupe, jupeIndex: jupeIndex, couverture: couverture, angleNord: angleNord, EXAGS: EXAGS, DEMI: DEMI, N_DATA: N_DATA, N_MAILLE: N_MAILLE }
  };
})();
