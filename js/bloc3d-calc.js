/* « Bloc 3D pour BridgeSketch 3D » (v0.7.2) : fonctions pures (sans DOM, sans réseau), testées par tests/js/bloc3d_calc.mjs.
   Contrat : window.QA_MOD.bloc3dCalc. Le paquet produit suit docs/bs3d-terrain-v1.md (`bs3d-terrain` v1) :
   grille locale métrique centrée sur le bloc (x vers l'est, y vers le nord, mètres au sol), ligne 0 au nord,
   grilles Float32 (NaN = pas de donnée), zones en mètres locaux, axe du pont.
   Mercator -> sol : mètres Mercator × cos(lat) = mètres au sol, d'où le facteur k = 1 / cos(lat) (mètres Mercator par mètre).
   ES5 (comme les autres modules de js/). */
(function(root){
  'use strict';
  var R = 6378137, MAX_CELLS = 1500000, MAX_SIDE = 1500;
  var B = { R: R, MAX_CELLS: MAX_CELLS, MAX_SIDE: MAX_SIDE, SOURCE: 'QuickerAtlas v0.7.4' };

  // ---------- Repère ----------
  B.merc = function(lat, lon){ return [lon * Math.PI / 180 * R, Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * R]; };
  B.unmerc = function(x, y){ return [(2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI, x / R * 180 / Math.PI]; };
  // Repère local centré sur (lat, lon) : { lat, lon, cx, cy (Mercator du centre), k (m Mercator par m au sol) }
  B.frame = function(lat, lon){ var m = B.merc(lat, lon); return { lat: lat, lon: lon, cx: m[0], cy: m[1], k: 1 / Math.cos(lat * Math.PI / 180) }; };
  B.toLocal = function(F, lat, lon){ var m = B.merc(lat, lon); return [(m[0] - F.cx) / F.k, (m[1] - F.cy) / F.k]; };
  B.toLatLon = function(F, x, y){ return B.unmerc(F.cx + x * F.k, F.cy + y * F.k); };
  // Cadre d'un rectangle de carte (sud, ouest, nord, est en degrés) : repère au centre (en Mercator) et dimensions au sol.
  B.blockFromBounds = function(s, w, n, e){
    var a = B.merc(s, w), b = B.merc(n, e), cm = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], c = B.unmerc(cm[0], cm[1]), F = B.frame(c[0], c[1]);
    F.cx = cm[0]; F.cy = cm[1];
    return { F: F, wM: Math.abs(b[0] - a[0]) / F.k, hM: Math.abs(b[1] - a[1]) / F.k };
  };
  // Pas de la grille : 1 m tant que cols × rows ≤ 1,5 M, sinon 2 m (puis 3, 4… au besoin)
  B.chooseCell = function(wM, hM){
    var cell = 1;
    while (Math.round(wM / cell) * Math.round(hM / cell) > MAX_CELLS && cell < 50) cell += 1;
    return cell;
  };
  // Grille du paquet pour un bloc wM × hM : centre de la cellule [0,0] = coin nord-ouest
  B.gridFor = function(wM, hM, cell){
    cell = cell || B.chooseCell(wM, hM);
    var cols = Math.max(2, Math.round(wM / cell)), rows = Math.max(2, Math.round(hM / cell));
    return { cols: cols, rows: rows, cell: cell, x0: -(cols - 1) * cell / 2, y0: (rows - 1) * cell / 2 };
  };

  // ---------- Rééchantillonnage Mercator -> grille locale ----------
  // src = { a: Float32Array, w, h, sx, sy, X0, Y0 } (pixel (0,0) = coin nord-ouest en Mercator ; sx, sy > 0 en m Mercator).
  // Bilinéaire si les 4 voisins sont valides, sinon pixel le plus proche s'il est valide, sinon NaN.
  B.resample = function(src, F, g){
    var out = new Float32Array(g.cols * g.rows), a = src.a, w = src.w, h = src.h, r, c;
    for (r = 0; r < g.rows; r++) {
      var my = F.cy + (g.y0 - r * g.cell) * F.k, fr = (src.Y0 - my) / src.sy - 0.5, r0 = Math.floor(fr), tr = fr - r0;
      for (c = 0; c < g.cols; c++) {
        var mx = F.cx + (g.x0 + c * g.cell) * F.k, fc = (mx - src.X0) / src.sx - 0.5, c0 = Math.floor(fc), tc = fc - c0, v = NaN;
        if (fc >= -0.5 && fr >= -0.5 && fc <= w - 0.5 && fr <= h - 0.5) {
          var ca = Math.max(0, Math.min(w - 1, c0)), cb = Math.max(0, Math.min(w - 1, c0 + 1)), ra = Math.max(0, Math.min(h - 1, r0)), rb = Math.max(0, Math.min(h - 1, r0 + 1));
          var v00 = a[ra * w + ca], v01 = a[ra * w + cb], v10 = a[rb * w + ca], v11 = a[rb * w + cb];
          if (isFinite(v00) && isFinite(v01) && isFinite(v10) && isFinite(v11)) {
            v = v00 * (1 - tc) * (1 - tr) + v01 * tc * (1 - tr) + v10 * (1 - tc) * tr + v11 * tc * tr;
          } else {
            var nc = Math.max(0, Math.min(w - 1, Math.round(fc))), nr = Math.max(0, Math.min(h - 1, Math.round(fr))), vn = a[nr * w + nc];
            if (isFinite(vn)) v = vn;
          }
        }
        out[r * g.cols + c] = v;
      }
    }
    return out;
  };
  B.finiteFraction = function(a){ var n = 0; for (var i = 0; i < a.length; i++) if (isFinite(a[i])) n++; return a.length ? n / a.length : 0; };

  // ---------- Base64 des Float32 (petit-boutiste) ----------
  var LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  B.bytesToB64 = function(bytes){
    var parts = [], CH = 0x6000;
    for (var p = 0; p < bytes.length; p += CH) parts.push(String.fromCharCode.apply(null, bytes.subarray(p, Math.min(bytes.length, p + CH))));
    return btoa(parts.join(''));
  };
  B.f32ToB64 = function(f){
    var bytes;
    if (LE) bytes = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
    else { bytes = new Uint8Array(f.length * 4); var dv = new DataView(bytes.buffer); for (var i = 0; i < f.length; i++) dv.setFloat32(i * 4, f[i], true); }
    return B.bytesToB64(bytes);
  };
  B.b64ToF32 = function(s){
    var bin = atob(s), n = bin.length >> 2, bytes = new Uint8Array(n * 4), i;
    for (i = 0; i < n * 4; i++) bytes[i] = bin.charCodeAt(i);
    if (LE) return new Float32Array(bytes.buffer);
    var out = new Float32Array(n), dv = new DataView(bytes.buffer);
    for (i = 0; i < n; i++) out[i] = dv.getFloat32(i * 4, true);
    return out;
  };

  // ---------- Paquet `bs3d-terrain` v1 ----------
  // o = { frame: {lat, lon}, grid, mnt, mns|null, image|null, zones[], bridge|null, attribution[], source?, created? }
  B.buildPacket = function(o){
    return {
      type: 'bs3d-terrain', version: 1, source: o.source || B.SOURCE, created: o.created || new Date().toISOString(),
      center: { lat: o.frame.lat, lon: o.frame.lon },
      grid: { cols: o.grid.cols, rows: o.grid.rows, cell: o.grid.cell, x0: o.grid.x0, y0: o.grid.y0 },
      mnt: o.mnt, mns: o.mns || null, image: o.image || null,
      zones: (o.zones || []).map(function(z){
        var q = { type: z.type, source: z.source || 'user' };
        if (z.type === 'road') {
          q.line = z.line.map(function(p){ return [p[0], p[1]]; }); q.width = z.width || 7;
          // v0.7.3 : attributs OSM conservés quand ils existent (voies, sens unique 1/-1, tronçon sur ouvrage)
          if (z.lanes > 0) q.lanes = Math.min(8, Math.round(z.lanes));
          if (z.oneway === 1 || z.oneway === -1) q.oneway = z.oneway;
          if (z.bridge) q.bridge = true;
        }
        else {
          q.polygon = z.polygon.map(function(p){ return [p[0], p[1]]; });
          // v0.7.4 : cote du plan d'eau lue dans le MNT (m, même référence que la grille)
          if ((z.type === 'water' || z.type === 'river') && typeof z.level === 'number' && isFinite(z.level)) q.level = z.level;
        }
        return q;
      }),
      bridge: o.bridge ? { axis: [[o.bridge.axis[0][0], o.bridge.axis[0][1]], [o.bridge.axis[1][0], o.bridge.axis[1][1]]], structure: o.bridge.structure || null } : null,
      attribution: (o.attribution || []).slice()
    };
  };
  function gridLen(v, n){
    if (v == null) return null;
    if (typeof v === 'string') { var pad = /=*$/.exec(v)[0].length; return Math.floor(v.length * 3 / 4) - pad; }
    if (v && typeof v.length === 'number' && v.BYTES_PER_ELEMENT === 4) return v.length * 4;
    return -1;
  }
  // Liste des écarts au contrat (vide = conforme)
  B.validatePacket = function(p){
    var e = [], isNum = function(x){ return typeof x === 'number' && isFinite(x); };
    if (!p || typeof p !== 'object') return ['paquet absent'];
    if (p.type !== 'bs3d-terrain') e.push('type');
    if (p.version !== 1) e.push('version');
    if (typeof p.source !== 'string') e.push('source');
    if (typeof p.created !== 'string' || isNaN(Date.parse(p.created))) e.push('created');
    if (!p.center || !isNum(p.center.lat) || !isNum(p.center.lon) || Math.abs(p.center.lat) > 90 || Math.abs(p.center.lon) > 180) e.push('center');
    var g = p.grid, n = 0;
    if (!g || !isNum(g.cell) || !(g.cell > 0) || !isNum(g.x0) || !isNum(g.y0) || g.cols !== Math.floor(g.cols) || g.rows !== Math.floor(g.rows) || !(g.cols >= 2) || !(g.rows >= 2)) e.push('grid');
    else {
      n = g.cols * g.rows;
      if (n > MAX_CELLS) e.push('grid : plus de 1 500 000 cellules');
    }
    if (n) {
      var lm = gridLen(p.mnt), ls = gridLen(p.mns);
      if (lm !== n * 4) e.push('mnt : longueur ' + lm + ' au lieu de ' + n * 4 + ' octets');
      if (p.mns !== null && p.mns !== undefined && ls !== n * 4) e.push('mns : longueur ' + ls + ' au lieu de ' + n * 4 + ' octets');
    }
    if (p.image !== null && p.image !== undefined && (typeof p.image.dataUrl !== 'string' || p.image.dataUrl.indexOf('data:image/') !== 0 || typeof p.image.attribution !== 'string')) e.push('image');
    if (!Array.isArray(p.zones)) e.push('zones');
    else p.zones.forEach(function(z, i){
      var okSrc = z && ['osm', 'auto', 'user'].indexOf(z.source) >= 0, pts = z && (z.type === 'road' ? z.line : z.polygon);
      var okPts = Array.isArray(pts) && pts.length >= (z.type === 'road' ? 2 : 3) && pts.every(function(q){ return Array.isArray(q) && q.length === 2 && isNum(q[0]) && isNum(q[1]); });
      if (!z || ['river', 'water', 'forest', 'grass', 'road'].indexOf(z.type) < 0 || !okSrc || !okPts || (z.type === 'road' && !(z.width > 0))) e.push('zones[' + i + ']');
    });
    if (p.bridge !== null && p.bridge !== undefined) {
      var ax = p.bridge.axis;
      if (!Array.isArray(ax) || ax.length !== 2 || !ax.every(function(q){ return Array.isArray(q) && q.length === 2 && isNum(q[0]) && isNum(q[1]); }) || (ax[0][0] === ax[1][0] && ax[0][1] === ax[1][1])) e.push('bridge.axis');
      var st = p.bridge.structure;
      if (st !== null && st !== undefined && (typeof st.id !== 'string' || typeof st.name !== 'string')) e.push('bridge.structure');
    }
    if (!Array.isArray(p.attribution) || !p.attribution.every(function(s){ return typeof s === 'string'; })) e.push('attribution');
    return e;
  };
  // Fichier .bs3dterrain : le même objet, grilles en base64, texte JSON
  B.packetToJson = function(p){
    var q = {}, k;
    for (k in p) q[k] = p[k];
    q.mnt = typeof p.mnt === 'string' ? p.mnt : B.f32ToB64(p.mnt);
    q.mns = p.mns == null ? null : (typeof p.mns === 'string' ? p.mns : B.f32ToB64(p.mns));
    return JSON.stringify(q);
  };
  // Message pour postMessage : copies des grilles (les originaux restent utilisables après le transfert) et liste des transférables
  B.packetForPost = function(p){
    var q = {}, k, transfer = [];
    for (k in p) q[k] = p[k];
    var cp = function(v){ if (v == null || typeof v === 'string') return v; var c = v.slice(); transfer.push(c.buffer); return c; };
    q.mnt = cp(p.mnt); q.mns = cp(p.mns);
    return { message: q, transfer: transfer };
  };

  // ---------- Géométrie plane ----------
  function area2(r){ var s = 0; for (var i = 0, n = r.length; i < n; i++) { var a = r[i], b = r[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; } return s; }
  B.polygonArea = function(r){ return Math.abs(area2(r)) / 2; };
  B.pointInPolygon = function(pt, r){
    var inside = false;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      var a = r[i], b = r[j];
      if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  };
  function segD2(p, a, b){
    var dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0, x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
    return x * x + y * y;
  }
  B.distToLine = function(p, line){ var m = Infinity; for (var i = 0; i + 1 < line.length; i++) m = Math.min(m, segD2(p, line[i], line[i + 1])); return Math.sqrt(m); };
  // Douglas-Peucker sur une ligne ouverte (extrémités gardées)
  B.simplifyLine = function(pts, tol){
    var n = pts.length;
    if (n < 3) return pts.slice();
    var keep = new Uint8Array(n), stack = [[0, n - 1]], t2 = tol * tol;
    keep[0] = keep[n - 1] = 1;
    while (stack.length) {
      var s = stack.pop(), i0 = s[0], i1 = s[1], best = -1, bd = t2;
      for (var i = i0 + 1; i < i1; i++) { var d = segD2(pts[i], pts[i0], pts[i1]); if (d > bd) { bd = d; best = i; } }
      if (best >= 0) { keep[best] = 1; stack.push([i0, best], [best, i1]); }
    }
    return pts.filter(function(p, i){ return keep[i]; });
  };
  // Contour fermé : coupé au point le plus éloigné du premier, deux moitiés simplifiées
  B.simplifyRing = function(r, tol){
    if (r.length <= 4) return r.slice();
    var far = 0, bd = -1, i;
    for (i = 1; i < r.length; i++) { var d = (r[i][0] - r[0][0]) * (r[i][0] - r[0][0]) + (r[i][1] - r[0][1]) * (r[i][1] - r[0][1]); if (d > bd) { bd = d; far = i; } }
    var h1 = B.simplifyLine(r.slice(0, far + 1), tol), h2 = B.simplifyLine(r.slice(far).concat([r[0]]), tol);
    return h1.concat(h2.slice(1, -1));
  };
  // Découpe d'un polygone par un rectangle { x0, y0, x1, y1 } (Sutherland-Hodgman)
  B.clipPolygon = function(poly, rc){
    var edges = [
      [function(p){ return p[0] >= rc.x0; }, function(a, b){ var t = (rc.x0 - a[0]) / (b[0] - a[0]); return [rc.x0, a[1] + t * (b[1] - a[1])]; }],
      [function(p){ return p[0] <= rc.x1; }, function(a, b){ var t = (rc.x1 - a[0]) / (b[0] - a[0]); return [rc.x1, a[1] + t * (b[1] - a[1])]; }],
      [function(p){ return p[1] >= rc.y0; }, function(a, b){ var t = (rc.y0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), rc.y0]; }],
      [function(p){ return p[1] <= rc.y1; }, function(a, b){ var t = (rc.y1 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), rc.y1]; }]
    ], out = poly;
    for (var e = 0; e < 4 && out.length; e++) {
      var inside = edges[e][0], cut = edges[e][1], inp = out; out = [];
      for (var i = 0; i < inp.length; i++) {
        var a = inp[(i + inp.length - 1) % inp.length], b = inp[i], ia = inside(a), ib = inside(b);
        if (ib) { if (!ia) out.push(cut(a, b)); out.push(b); } else if (ia) out.push(cut(a, b));
      }
    }
    return out;
  };
  // Découpe d'une ligne par un rectangle (Liang-Barsky par segment) : liste de morceaux
  B.clipLine = function(line, rc){
    var out = [], cur = null;
    for (var i = 0; i + 1 < line.length; i++) {
      var a = line[i], b = line[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], t0 = 0, t1 = 1;
      var P = [-dx, dx, -dy, dy], Q = [a[0] - rc.x0, rc.x1 - a[0], a[1] - rc.y0, rc.y1 - a[1]], ok = true;
      for (var k = 0; k < 4; k++) {
        if (P[k] === 0) { if (Q[k] < 0) { ok = false; break; } }
        else { var t = Q[k] / P[k]; if (P[k] < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; } else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; } }
      }
      if (!ok) { if (cur && cur.length > 1) out.push(cur); cur = null; continue; }
      var p0 = [a[0] + t0 * dx, a[1] + t0 * dy], p1 = [a[0] + t1 * dx, a[1] + t1 * dy];
      if (!cur) cur = [p0]; else if (t0 > 0) { if (cur.length > 1) out.push(cur); cur = [p0]; }
      cur.push(p1);
      if (t1 < 1) { out.push(cur); cur = null; }
    }
    if (cur && cur.length > 1) out.push(cur);
    return out;
  };
  // ---------- Relief ombré (aperçu 2D du MNT) ----------
  // Horn, soleil du nord-ouest. Sous-échantillonne à ≤ maxSide pixels. Renvoie { w, h, gray (Uint8ClampedArray), zmin, zmax }.
  B.hillshade = function(z, cols, rows, cell, maxSide){
    var s = Math.max(1, Math.ceil(Math.max(cols, rows) / (maxSide || 360))), w = Math.floor((cols - 1) / s) + 1, h = Math.floor((rows - 1) / s) + 1, c = cell * s;
    var g = new Uint8ClampedArray(w * h), zmin = Infinity, zmax = -Infinity, azm = (360 - 315 + 90) * Math.PI / 180, alt = 45 * Math.PI / 180, ZF = 2;
    var at = function(cc, rr){ cc = Math.max(0, Math.min(w - 1, cc)); rr = Math.max(0, Math.min(h - 1, rr)); return z[rr * s * cols + cc * s]; };
    for (var r = 0; r < h; r++) for (var q = 0; q < w; q++) {
      var v = at(q, r);
      if (!isFinite(v)) { g[r * w + q] = 235; continue; }
      if (v < zmin) zmin = v; if (v > zmax) zmax = v;
      var nb = [at(q - 1, r - 1), at(q, r - 1), at(q + 1, r - 1), at(q - 1, r), v, at(q + 1, r), at(q - 1, r + 1), at(q, r + 1), at(q + 1, r + 1)].map(function(x){ return isFinite(x) ? x : v; });
      var dzdx = ((nb[2] + 2 * nb[5] + nb[8]) - (nb[0] + 2 * nb[3] + nb[6])) / (8 * c), dzdy = ((nb[6] + 2 * nb[7] + nb[8]) - (nb[0] + 2 * nb[1] + nb[2])) / (8 * c);
      dzdx *= ZF; dzdy *= ZF;
      var slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)), asp = Math.atan2(dzdy, -dzdx);
      var hs = Math.cos(Math.PI / 2 - alt) * Math.cos(slope) + Math.sin(Math.PI / 2 - alt) * Math.sin(slope) * Math.cos(azm - asp);
      g[r * w + q] = Math.max(0, Math.min(255, Math.round(255 * hs)));
    }
    return { w: w, h: h, gray: g, zmin: zmin, zmax: zmax };
  };

  // ---------- Classification par la couleur de l'imagerie ----------
  var K = { OTHER: 0, WATER: 1, FOREST: 2, ROAD: 3 };
  B.CLASS = K;
  // f = { r, g, b (0–255, moyenne de la cellule), tex (écart-type de la luminance dans la cellule), chm (hauteur MNS − MNT en m,
  // ou null sans MNS), nan (part de MNT sans donnée, 0–1) }
  B.classifyCell = function(f){
    var r = f.r, g = f.g, b = f.b, mx = Math.max(r, g, b), mn = Math.min(r, g, b), lum = 0.299 * r + 0.587 * g + 0.114 * b, sat = mx ? (mx - mn) / mx : 0;
    var hasChm = f.chm != null && isFinite(f.chm), chm = hasChm ? f.chm : 0, tex = f.tex || 0, nan = f.nan || 0;
    var greenish = 2 * g - r - b > 10 && g >= r && g >= b - 2;
    // forêt : vert sombre ; avec le MNS, une canopée d'au moins 2,5 m ; sans lui, une texture marquée (le gazon est vert aussi, mais lisse et bas)
    if (greenish && lum < 135 && (hasChm ? chm >= 2.5 : tex >= 7)) return K.FOREST;
    if (hasChm && chm >= 4 && lum < 100 && sat > 0.08 && tex >= 5) return K.FOREST;          // conifères très sombres, peu verts
    // eau : lisse, au ras du sol ; bleutée, très sombre, ou sans retour LiDAR sur un fond sombre
    // (une rivière trouble est un gris-vert sombre, plus foncé que l'asphalte : lum < 72 ; sans MNS, le vert reste exclu)
    if (tex < 8 && chm < 1.5) {
      if (b >= r + 8 && b >= g - 3 && lum < 170) return K.WATER;
      if (lum < 72 && sat < 0.4 && (hasChm || !greenish)) return K.WATER;
      if (nan >= 0.6 && lum < 150 && sat < 0.5) return K.WATER;
    }
    // route : gris peu saturé, lisse, ni toit ni arbre
    if (mx - mn <= 22 + 0.05 * mx && b >= r - 12 && lum >= 72 && lum <= 200 && tex < 13 && chm < 1.2 && nan < 0.5) return K.ROAD;
    return K.OTHER;
  };

  // Érosion 4-voisins ; hors de la grille compte comme plein (une zone qui touche le bord du bloc ne rétrécit pas)
  function erode(m, w, h){
    var o = new Uint8Array(m.length);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var i = y * w + x; o[i] = m[i] && (x === 0 || m[i - 1]) && (x === w - 1 || m[i + 1]) && (y === 0 || m[i - w]) && (y === h - 1 || m[i + w]) ? 1 : 0; }
    return o;
  }
  function dilate(m, w, h){
    var o = new Uint8Array(m.length);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var i = y * w + x; o[i] = m[i] || (x > 0 && m[i - 1]) || (x < w - 1 && m[i + 1]) || (y > 0 && m[i - w]) || (y < h - 1 && m[i + w]) ? 1 : 0; }
    return o;
  }
  // Composantes 4-connexes d'un masque : { lab (Int32Array, 0 = fond), n, comps: [{ id, first, n }] }
  function label(m, w, h){
    var lab = new Int32Array(m.length), stack = new Int32Array(m.length), comps = [], id = 0;
    for (var i0 = 0; i0 < m.length; i0++) {
      if (!m[i0] || lab[i0]) continue;
      id++; var top = 0, cnt = 0; lab[i0] = id; stack[top++] = i0;
      while (top) {
        var p = stack[--top], x = p % w; cnt++;
        if (x > 0 && m[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[top++] = p - 1; }
        if (x < w - 1 && m[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[top++] = p + 1; }
        if (p >= w && m[p - w] && !lab[p - w]) { lab[p - w] = id; stack[top++] = p - w; }
        if (p + w < m.length && m[p + w] && !lab[p + w]) { lab[p + w] = id; stack[top++] = p + w; }
      }
      comps.push({ id: id, first: i0, n: cnt });
    }
    return { lab: lab, n: id, comps: comps };
  }
  // Contour extérieur d'une composante, en coins de cellules : liste de sommets (x, y) entiers, sens horaire à l'écran
  B.traceOuter = function(lab, id, w, h, start){
    var sc = start % w, sr = Math.floor(start / w), x = sc, y = sr, d = 3, pts = [], DX = [1, 0, -1, 0], DY = [0, 1, 0, -1], guard = 4 * (w + 1) * (h + 1) + 8;
    var ins = function(cx, cy){ return cx >= 0 && cy >= 0 && cx < w && cy < h && lab[cy * w + cx] === id; };
    do {
      var L, Rr;
      if (d === 0) { L = ins(x, y - 1); Rr = ins(x, y); }
      else if (d === 1) { L = ins(x, y); Rr = ins(x - 1, y); }
      else if (d === 2) { L = ins(x - 1, y); Rr = ins(x - 1, y - 1); }
      else { L = ins(x - 1, y - 1); Rr = ins(x, y - 1); }
      var nd = !Rr ? (d + 1) % 4 : (L ? (d + 3) % 4 : d);
      if (nd !== d) pts.push([x, y]);
      d = nd; x += DX[d]; y += DY[d];
    } while (!(x === sc && y === sr) && --guard > 0);
    return pts;
  };

  // ---------- Squelette (Zhang-Suen) et lignes centrales ----------
  function thin(m, w, h){
    var a = new Uint8Array(m), changed = true, it = 0;
    var P = function(i){ return [a[i - w], a[i - w + 1], a[i + 1], a[i + w + 1], a[i + w], a[i + w - 1], a[i - 1], a[i - w - 1]]; };
    while (changed && it++ < 200) {
      changed = false;
      for (var step = 0; step < 2; step++) {
        var del = [];
        for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
          var i = y * w + x;
          if (!a[i]) continue;
          var p = P(i), B_ = p[0] + p[1] + p[2] + p[3] + p[4] + p[5] + p[6] + p[7];
          if (B_ < 2 || B_ > 6) continue;
          var A = 0; for (var k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) A++;
          if (A !== 1) continue;
          if (step === 0 ? (p[0] * p[2] * p[4] === 0 && p[2] * p[4] * p[6] === 0) : (p[0] * p[2] * p[6] === 0 && p[0] * p[4] * p[6] === 0)) del.push(i);
        }
        if (del.length) changed = true;
        for (var q = 0; q < del.length; q++) a[del[q]] = 0;
      }
    }
    return a;
  }
  // ---------- Détection (v0.7.4 : LiDAR d'abord, sans OpenStreetMap) ----------
  // Principe : peu de zones, mais justes, plutôt que beaucoup de petites à supprimer.
  //   eau    = surface plane du MNT (le MNEHR aplanit les plans d'eau), plus basse que ses rives, ou couleur d'eau de l'imagerie ;
  //            la cote du plan d'eau (médiane du MNT) part avec la zone ;
  //   forêt  = canopée d'au moins 3 m (MNS − MNT), verte ou rugueuse (un toit est lisse) ;
  //   herbe  = vert, au ras du sol ;
  //   routes = lignes centrales du masque CanVec de RNCan (B.roadsFromMask), une requête d'image d'environ 1 s.
  // o = { grid (du paquet), img: { px (RGBA), w, h } | null, mnt, mns | null, roads: { px (RGBA), w, h } | null, dc? }
  // L'image et le masque couvrent l'emprise de la grille (bords des cellules). Renvoie { zones, dc, stats, G }.
  B.LIMITS = { water: 300, forest: 1500, grass: 4000, maxForest: 10, maxGrass: 4, roadMin: 25 };
  function median(a){ if (!a.length) return NaN; a.sort(function(p, q){ return p - q; }); return a[a.length >> 1]; }
  function repeat(f, m, w, h, n){ for (var i = 0; i < n; i++) m = f(m, w, h); return m; }
  B.detect = function(o){
    var g = o.grid, W = g.cols * g.cell, H = g.rows * g.cell, xmin = g.x0 - g.cell / 2, ymax = g.y0 + g.cell / 2, ymin = ymax - H;
    var dc = o.dc || (Math.max(W, H) > 1000 ? 3 : 2), cols = Math.ceil(W / dc), rows = Math.ceil(H / dc), N = cols * rows, LIM = B.LIMITS;
    var G = { xmin: xmin, ymax: ymax, dc: dc, cols: cols, rows: rows };
    var stats = { dc: dc, cols: cols, rows: rows, water: 0, river: 0, forest: 0, grass: 0, road: 0 };
    var i, x, y, im = o.img, mnt = o.mnt, mns = o.mns;
    // couleur moyenne et texture par cellule de détection
    var nn = new Float32Array(N), sr = new Float32Array(N), sg = new Float32Array(N), sb = new Float32Array(N), sl = new Float32Array(N), sl2 = new Float32Array(N);
    if (im) for (y = 0; y < im.h; y++) {
      var cy = Math.min(rows - 1, Math.floor(y * H / im.h / dc));
      for (x = 0; x < im.w; x++) {
        var p = (y * im.w + x) * 4, ci = cy * cols + Math.min(cols - 1, Math.floor(x * W / im.w / dc)), R_ = im.px[p], G_ = im.px[p + 1], B_ = im.px[p + 2], l = 0.299 * R_ + 0.587 * G_ + 0.114 * B_;
        nn[ci]++; sr[ci] += R_; sg[ci] += G_; sb[ci] += B_; sl[ci] += l; sl2[ci] += l * l;
      }
    }
    // LiDAR par cellule de détection : altitude moyenne, hauteur de canopée (moyenne, écart-type), part de cellules planes, part sans donnée
    var zS = new Float32Array(N), zN = new Float32Array(N), cS = new Float32Array(N), cS2 = new Float32Array(N), cN = new Float32Array(N), fN = new Float32Array(N), gN = new Float32Array(N), nanN = new Float32Array(N);
    var gc = g.cols, gr = g.rows, flatTol = 0.03 * g.cell;
    for (y = 0; y < gr; y++) {
      var dy = Math.min(rows - 1, Math.floor(y * g.cell / dc));
      for (x = 0; x < gc; x++) {
        var gi = y * gc + x, di = dy * cols + Math.min(cols - 1, Math.floor(x * g.cell / dc)), z = mnt[gi];
        gN[di]++;
        if (!(z === z)) { nanN[di]++; continue; }
        zS[di] += z; zN[di]++;
        if (mns) { var sv = mns[gi]; if (sv === sv) { var c = sv - z; cS[di] += c; cS2[di] += c * c; cN[di]++; } }
        if (x > 0 && y > 0 && x < gc - 1 && y < gr - 1) {         // plane : moins de 3 cm d'écart sur le voisinage 3 × 3
          var lo = z, hi = z, v;
          for (var j = -1; j <= 1; j++) for (var k = -1; k <= 1; k++) { v = mnt[gi + j * gc + k]; if (v < lo) lo = v; else if (v > hi) hi = v; else if (!(v === v)) hi = Infinity; }
          if (hi - lo < flatTol) fN[di]++;
        }
      }
    }
    var mW = new Uint8Array(N), mF = new Uint8Array(N), mG = new Uint8Array(N), colW = new Uint8Array(N), zc = new Float32Array(N);
    for (i = 0; i < N; i++) {
      zc[i] = zN[i] ? zS[i] / zN[i] : NaN;
      var hasC = cN[i] > 0, chm = hasC ? cS[i] / cN[i] : null, chmSd = hasC ? Math.sqrt(Math.max(0, cS2[i] / cN[i] - chm * chm)) : 0;
      var flat = gN[i] ? fN[i] / gN[i] : 0, nan = gN[i] ? nanN[i] / gN[i] : 0, f = null, lum = 0, green = false, kc = K.OTHER;
      if (im && nn[i] >= 1) {
        var m = sl[i] / nn[i];
        f = { r: sr[i] / nn[i], g: sg[i] / nn[i], b: sb[i] / nn[i], tex: Math.sqrt(Math.max(0, sl2[i] / nn[i] - m * m)), chm: chm, nan: nan };
        lum = m; green = 2 * f.g - f.r - f.b > 10 && f.g >= f.r && f.g >= f.b - 2; kc = B.classifyCell(f);
      }
      if (hasC) {
        if (chm >= 3 && (!f || (green && lum < 150) || chmSd >= 1.2 || (lum < 100 && chmSd >= 0.6))) mF[i] = 1;
      } else if (kc === K.FOREST) mF[i] = 1;
      if (mF[i]) continue;
      var low = !hasC || chm < 1;
      if (low && kc === K.WATER) { mW[i] = 1; colW[i] = 1; }
      else if (flat >= 0.75 && !(f && (lum > 170 || (green && lum > 95)))) mW[i] = 1;
      else if (nan >= 0.6 && (!f || lum < 150)) { mW[i] = 1; colW[i] = 1; }
      else if (f && green && lum >= 55 && (!hasC || chm < 0.8)) mG[i] = 1;
    }
    var zones = [], toL = function(q){ return [xmin + q[0] * dc, ymax - q[1] * dc]; };
    var ringOf = function(lb, c, fine){
      var ring = B.traceOuter(lb.lab, c.id, cols, rows, c.first).map(toL);
      if (ring.length < 4) return null;
      ring = B.simplifyRing(ring, Math.max(dc * 1.2, Math.sqrt(c.n * dc * dc) / (fine || 45)));
      return ring.length >= 3 ? ring : null;
    };
    // --- eau : fermeture (rochers, écume, ombres), ouverture (taches isolées), puis contrôle physique de chaque composante
    var wm = repeat(erode, repeat(dilate, mW, cols, rows, 2), cols, rows, 3);
    wm = dilate(wm, cols, rows);
    var wl = label(wm, cols, rows), members = {};
    for (i = 0; i < N; i++) if (wl.lab[i]) (members[wl.lab[i]] || (members[wl.lab[i]] = [])).push(i);
    var wOut = new Uint8Array(N), found = [];
    wl.comps.forEach(function(c){
      if (c.n * dc * dc < LIM.water) return;
      var idx = members[c.id], zs = [], nCol = 0, q, t;
      for (t = 0; t < idx.length; t++) { q = idx[t]; if (zc[q] === zc[q]) zs.push(zc[q]); if (colW[q]) nCol++; }
      zs.sort(function(a, b){ return a - b; });
      var level = zs.length ? zs[zs.length >> 1] : NaN, spread = zs.length ? zs[Math.floor(zs.length * 0.9)] - zs[Math.floor(zs.length * 0.1)] : 0, colour = nCol / idx.length;
      // le plan d'eau s'étend aux cellules voisines à la même cote (sous un tablier, sous des branches, eau ridée) : 6 pas au plus
      var own = new Uint8Array(N), front = idx.slice(), tol = Math.max(0.08, Math.min(0.4, spread));
      for (t = 0; t < idx.length; t++) own[idx[t]] = 1;
      for (var it = 0; it < 6 && front.length && level === level; it++) {
        var next = [];
        for (t = 0; t < front.length; t++) {
          q = front[t]; var qx = q % cols, cand = [qx > 0 ? q - 1 : -1, qx < cols - 1 ? q + 1 : -1, q - cols, q + cols];
          for (var e = 0; e < 4; e++) { var u = cand[e]; if (u >= 0 && u < N && !own[u] && Math.abs(zc[u] - level) < tol) { own[u] = 1; next.push(u); } }
        }
        front = next;
      }
      // rives : cellules qui bordent le plan d'eau étendu (2 pas)
      var bank = [], total = 0, x0 = cols, x1 = 0, y0 = rows, y1 = 0;
      for (q = 0; q < N; q++) {
        if (own[q]) { total++; var ox = q % cols, oy = (q - ox) / cols; if (ox < x0) x0 = ox; if (ox > x1) x1 = ox; if (oy < y0) y0 = oy; if (oy > y1) y1 = oy; continue; }
        var bx = q % cols;
        if (zc[q] === zc[q] && ((bx > 1 && own[q - 2]) || (bx < cols - 2 && own[q + 2]) || (q >= 2 * cols && own[q - 2 * cols]) || (q + 2 * cols < N && own[q + 2 * cols]))) bank.push(zc[q]);
      }
      bank.sort(function(a, b){ return a - b; });
      var rise = bank.length ? bank[Math.floor(bank.length * 0.8)] - level : NaN;
      // une eau est de niveau (étale : moins de 8 cm d'écart sur toute sa surface) ou plus basse que ses rives ;
      // la couleur seule suffit si elle est franche (petit cours d'eau que le LiDAR n'a pas aplani)
      var ok = (colour >= 0.6 && spread <= 1.5) || (spread <= 0.08 && total * dc * dc >= 2 * LIM.water && !(rise < -0.1)) || (spread <= 1.5 && rise >= 0.25 && spread <= rise);
      // petit plan d'eau (moins de 3 000 m²) : il faut en plus la couleur de l'eau ou une rive franche (une pelouse bien plane n'en a pas)
      if (ok && total * dc * dc < 3000 && colour < 0.3 && !(rise >= 0.4)) ok = false;
      if (!ok) return;
      for (q = 0; q < N; q++) if (own[q]) wOut[q] = 1;
      found.push({ level: level });
    });
    // plans d'eau retenus : contours refaits sur le masque étendu (deux morceaux séparés par un tablier n'en font plus qu'un)
    wOut = erode(dilate(wOut, cols, rows), cols, rows);
    var wf = label(wOut, cols, rows), wz = {}, wb = {};
    for (i = 0; i < N; i++) {
      var wid = wf.lab[i]; if (!wid) continue;
      var bb = wb[wid] || (wb[wid] = { x0: cols, x1: 0, y0: rows, y1: 0 }), wx = i % cols, wy = (i - wx) / cols;
      if (wx < bb.x0) bb.x0 = wx; if (wx > bb.x1) bb.x1 = wx; if (wy < bb.y0) bb.y0 = wy; if (wy > bb.y1) bb.y1 = wy;
      if (zc[i] === zc[i]) (wz[wid] || (wz[wid] = [])).push(zc[i]);
    }
    wf.comps.forEach(function(c){
      if (c.n * dc * dc < LIM.water) return;
      var poly = ringOf(wf, c), bb = wb[c.id];
      if (!poly || B.polygonArea(poly) < LIM.water) return;
      var sides = (bb.x0 <= 1 ? 1 : 0) + (bb.x1 >= cols - 2 ? 1 : 0) + (bb.y0 <= 1 ? 1 : 0) + (bb.y1 >= rows - 2 ? 1 : 0), bw = bb.x1 - bb.x0 + 1, bh = bb.y1 - bb.y0 + 1;
      var type = sides >= 2 || (sides === 1 && Math.max(bw, bh) >= 2.5 * Math.min(bw, bh)) ? 'river' : 'water';
      var zn = { type: type, source: 'auto', polygon: poly }, level = median(wz[c.id] || []);
      if (level === level) zn.level = Math.round(level * 100) / 100;
      zones.push(zn); stats[type]++;
    });
    // --- forêt et herbe : les plus grandes surfaces seulement
    var areaZones = function(mask, type, minArea, maxN, close, open){
      var mm = repeat(erode, repeat(dilate, mask, cols, rows, close), cols, rows, close + open);
      mm = repeat(dilate, mm, cols, rows, open);
      var lb = label(mm, cols, rows);
      lb.comps.filter(function(c){ return c.n * dc * dc >= minArea; }).sort(function(a, b){ return b.n - a.n; }).slice(0, maxN).forEach(function(c){
        var poly = ringOf(lb, c, type === 'grass' ? 22 : 45);
        if (poly && B.polygonArea(poly) >= minArea) { zones.push({ type: type, source: 'auto', polygon: poly }); stats[type]++; }
      });
    };
    areaZones(mF, 'forest', LIM.forest, LIM.maxForest, 2, 1);
    for (i = 0; i < N; i++) if (wOut[i]) { mF[i] = 0; mG[i] = 0; }
    areaZones(mG, 'grass', LIM.grass, LIM.maxGrass, 1, 3);
    // --- routes
    if (o.roads) B.roadsFromMask(o.roads, { x0: xmin, y0: ymin, x1: xmin + W, y1: ymax }).forEach(function(r){ zones.push(r); stats.road++; });
    return { zones: zones, dc: dc, stats: stats, G: G };
  };

  // ---------- Routes : masque d'image (WMS CanVec) -> lignes centrales ----------
  // mask = { px (RGBA, opaque = route), w, h } couvrant le rectangle rc = { x0, y0, x1, y1 } (m locaux, y vers le nord).
  // Squelette, découpe aux carrefours, raccord des tronçons qui se prolongent (moins de 35° d'écart) : peu de routes, longues.
  // Renvoie des zones { type: 'road', source: 'auto', line, width }.
  B.roadsFromMask = function(mask, rc, opt){
    opt = opt || {};
    var w = mask.w, h = mask.h, n = w * h, m = new Uint8Array(n), i, k, px = mask.px, sx = (rc.x1 - rc.x0) / w, sy = (rc.y1 - rc.y0) / h, mpp = (sx + sy) / 2;
    for (i = 0; i < n; i++) m[i] = px[i * 4 + 3] > 96 ? 1 : 0;
    for (i = 0; i < w; i++) { m[i] = 0; m[n - w + i] = 0; }
    for (i = 0; i < h; i++) { m[i * w] = 0; m[i * w + w - 1] = 0; }
    var sk = thin(m, w, h);
    // nombre de branches autour d'un pixel = passages 0 -> 1 en tournant autour de lui (un coin d'escalier du squelette n'est pas un carrefour)
    var RING = [-w, -w + 1, 1, w + 1, w, w - 1, -1, -w - 1];
    var deg = function(p, src){ var c = 0; for (var q = 0; q < 8; q++) if (!(src || sk)[p + RING[q]] && (src || sk)[p + RING[(q + 1) % 8]]) c++; return c; };
    // carrefours : pixels du squelette à 3 voisins ou plus ; retirés, il reste des tronçons simples
    var junc = new Uint8Array(n), seg = new Uint8Array(n);
    for (i = w + 1; i < n - w - 1; i++) if (sk[i]) { if (deg(i) >= 3) junc[i] = 1; else seg[i] = 1; }
    // le voisinage immédiat d'un carrefour est retiré aussi : sinon deux branches restent liées en diagonale
    for (i = w + 1; i < n - w - 1; i++) if (junc[i]) for (k = 0; k < 8; k++) seg[i + RING[k]] = 0;
    var seen = new Uint8Array(n), raw = [];
    var ORD = [-w, -1, 1, w, -w - 1, -w + 1, w - 1, w + 1];           // voisins directs d'abord
    var nb = function(p){ var out = []; for (var q = 0; q < 8; q++) { var t = p + ORD[q]; if (seg[t] && !seen[t]) out.push(t); } return out; };
    var walk = function(start){
      var path = [start], p = start, nx;
      seen[start] = 1;
      while ((nx = nb(p)).length) { p = nx[0]; seen[p] = 1; path.push(p); }
      return path;
    };
    for (i = w + 1; i < n - w - 1; i++) {
      if (!seg[i] || seen[i]) continue;
      if (deg(i, seg) > 1) continue;                                   // on part d'une extrémité
      raw.push(walk(i));
    }
    for (i = w + 1; i < n - w - 1; i++) if (seg[i] && !seen[i]) raw.push(walk(i));           // boucles fermées
    var XY = function(p){ var x = p % w; return [rc.x0 + (x + 0.5) * sx, rc.y1 - ((p - x) / w + 0.5) * sy]; };
    var segs = raw.filter(function(path){ return path.length >= 3; }).map(function(path){
      // épaisseur du trait (px) : pixels du masque dans une fenêtre 7 × 7 autour de chaque pixel du tronçon, divisés par 7
      var ws = path.map(function(p){ var c = 0; for (var j = -3; j <= 3; j++) for (var q = -3; q <= 3; q++) { var t = p + j * w + q; if (t >= 0 && t < n && m[t]) c++; } return c / 7; }).sort(function(a, b){ return a - b; });
      return { line: path.map(XY), thick: ws[ws.length >> 1] };
    });
    // raccord : à chaque extrémité, le tronçon voisin (à moins de 4 px) le mieux aligné
    var reach = 6.5 * mpp, dirAt = function(line, end){
      var a = end ? line[line.length - 1] : line[0], b = end ? line[Math.max(0, line.length - 6)] : line[Math.min(line.length - 1, 5)], L = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
      return [(a[0] - b[0]) / L, (a[1] - b[1]) / L];          // vers l'extérieur du tronçon
    };
    var merged = true, guard = 0;
    while (merged && guard++ < 500) {
      merged = false;
      var best = null;
      for (var a = 0; a < segs.length; a++) for (var ea = 0; ea < 2; ea++) {
        var A = segs[a].line, pa = ea ? A[A.length - 1] : A[0], da = dirAt(A, ea);
        for (var b = a + 1; b < segs.length; b++) for (var eb = 0; eb < 2; eb++) {
          var Bl = segs[b].line, pb = eb ? Bl[Bl.length - 1] : Bl[0];
          if (Math.abs(pa[0] - pb[0]) > reach || Math.abs(pa[1] - pb[1]) > reach) continue;
          var db = dirAt(Bl, eb), dot = -(da[0] * db[0] + da[1] * db[1]);        // 1 = prolongement parfait
          if (dot > 0.82 && Math.abs(segs[a].thick - segs[b].thick) < 1.6 && (!best || dot > best.dot)) best = { a: a, ea: ea, b: b, eb: eb, dot: dot };
        }
      }
      if (best) {
        var la = segs[best.a].line, lb2 = segs[best.b].line;
        if (!best.ea) la = la.slice().reverse();
        if (best.eb) lb2 = lb2.slice().reverse();
        var na = la.length, nb2 = lb2.length;
        segs[best.a] = { line: la.concat(lb2), thick: (segs[best.a].thick * na + segs[best.b].thick * nb2) / (na + nb2) };
        segs.splice(best.b, 1); merged = true;
      }
    }
    var minLen = opt.minLen || B.LIMITS.roadMin, out = [];
    segs.forEach(function(s){
      var line = B.simplifyLine(s.line, Math.max(1.2, mpp * 1.3)), len = 0;
      for (var t = 0; t + 1 < line.length; t++) len += Math.hypot(line[t + 1][0] - line[t][0], line[t + 1][1] - line[t][1]);
      if (line.length < 2 || len < minLen) return;
      // épaisseur du trait CanVec (px, indépendante de l'échelle) : autoroute, route principale, rue ou chemin
      out.push({ type: 'road', source: 'auto', line: line, width: s.thick >= 2.1 ? 11 : s.thick >= 1.3 ? 8 : 6.5, len: len });
    });
    out.sort(function(p, q){ return q.len - p.len; });
    return out.map(function(r){ return { type: r.type, source: r.source, line: r.line, width: r.width }; });
  };
  // Étendue du tablier le long d'un axe proposé : là où la surface (MNS) dépasse le sol (MNT) d'au moins 1,5 m, autour du point p.
  // Renvoie [a, b] (m locaux) ou null si aucun tablier n'est visible (pont bas, MNS absent).
  B.deckExtent = function(p, dir, grid, mnt, mns, maxHalf){
    if (!mns) return null;
    var at = function(t){
      var x = p[0] + dir[0] * t, y = p[1] + dir[1] * t, c = Math.round((x - grid.x0) / grid.cell), r = Math.round((grid.y0 - y) / grid.cell);
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return null;
      var d = mns[r * grid.cols + c] - mnt[r * grid.cols + c];
      return d === d ? d : 0;
    };
    var up = function(t){ var d = at(t); return d != null && d >= 1.5; }, t0 = null, t;
    for (t = 0; t <= 25 && t0 == null; t++) { if (up(t)) t0 = t; else if (up(-t)) t0 = -t; }       // le point du MTMD est parfois à côté du tablier
    if (t0 == null) return null;
    var run = function(sgn){ var e = t0, gap = 0; for (var s = t0; Math.abs(s) <= maxHalf && gap <= 3; s += sgn) { if (up(s)) { e = s; gap = 0; } else gap++; } return e; };
    var a = run(-1), b = run(1);
    if (b - a < 6) return null;
    return [[p[0] + dir[0] * a, p[1] + dir[1] * a], [p[0] + dir[0] * b, p[1] + dir[1] * b]];
  };

  // v0.7.4 : pont existant retiré du relief. Dans le couloir du tablier (axe, largeur + 2 m de chaque côté), le sol est
  // interpolé d'une rive du couloir à l'autre, perpendiculairement à l'axe : la rivière ou la route franchie continue sous
  // l'ouvrage. Le MNT n'est corrigé que là où il dépasse ce sol de plus de 30 cm (tablier ou culée restés dans le MNT) ; le MNS
  // du couloir prend la valeur du sol (plus de tablier). Renvoie { mnt, mns, cells } (copies ; cells = cellules du MNT corrigées).
  B.removeBridge = function(grid, mnt, mns, axis, width){
    var a = axis[0], b = axis[1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), out = { mnt: new Float32Array(mnt), mns: mns ? new Float32Array(mns) : null, cells: 0 };
    if (!(L > 1)) return out;
    var ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = -uy, ny = ux, hw = Math.max(2, (width || 12) / 2) + 2, cell = grid.cell, cols = grid.cols, rows = grid.rows;
    var at = function(x, y){
      var c = Math.round((x - grid.x0) / cell), r = Math.round((grid.y0 - y) / cell);
      return c < 0 || r < 0 || c >= cols || r >= rows ? NaN : mnt[r * cols + c];
    };
    // sol de chaque côté du couloir, à l'abscisse t : moyenne de 4 points entre 1 et 4 m au-delà du bord
    var side = function(t, sgn){
      var s = 0, n = 0;
      for (var k = 1; k <= 4; k++) { var u = sgn * (hw + k), v = at(a[0] + ux * t + nx * u, a[1] + uy * t + ny * u); if (v === v) { s += v; n++; } }
      return n ? s / n : NaN;
    };
    var xs = [a[0] + nx * hw, a[0] - nx * hw, b[0] + nx * hw, b[0] - nx * hw], ys = [a[1] + ny * hw, a[1] - ny * hw, b[1] + ny * hw, b[1] - ny * hw];
    var c0 = Math.max(0, Math.floor((Math.min.apply(null, xs) - grid.x0) / cell) - 1), c1 = Math.min(cols - 1, Math.ceil((Math.max.apply(null, xs) - grid.x0) / cell) + 1);
    var r0 = Math.max(0, Math.floor((grid.y0 - Math.max.apply(null, ys)) / cell) - 1), r1 = Math.min(rows - 1, Math.ceil((grid.y0 - Math.min.apply(null, ys)) / cell) + 1), memo = {};
    for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) {
      var x = grid.x0 + c * cell - a[0], y = grid.y0 - r * cell - a[1], t = x * ux + y * uy, u = x * nx + y * ny;
      if (t < 0 || t > L || Math.abs(u) > hw) continue;
      var key = Math.floor(t / cell), sd = memo[key] || (memo[key] = [side((key + 0.5) * cell, -1), side((key + 0.5) * cell, 1)]), zl = sd[0], zr = sd[1];
      var z = zl === zl && zr === zr ? zl + (zr - zl) * (u + hw) / (2 * hw) : zl === zl ? zl : zr, i = r * cols + c;
      if (!(z === z)) continue;
      if (!(mnt[i] === mnt[i]) || mnt[i] - z > 0.3) { out.mnt[i] = z; out.cells++; }
      if (out.mns) out.mns[i] = out.mnt[i];
    }
    return out;
  };
  // Axe de pont proposé autour d'un point local `p` (position de la structure) : la route la plus proche (à moins de `maxD` m)
  // donne la direction, sinon axe est-ouest de `len` m. Orienté de l'ouest vers l'est (ou du sud vers le nord si l'axe est
  // presque vertical). Renvoie { axis, from: 'route' | 'defaut', dir, at } ; `at` = point de la route le plus proche de p.
  B.suggestAxis = function(p, roads, len, maxD){
    maxD = maxD || 80;
    var best = null, ux = 1, uy = 0;
    (roads || []).forEach(function(line){ var d = B.distToLine(p, line); if (d <= maxD && (!best || d < best.d)) best = { d: d, line: line }; });
    if (best) {
      var line = best.line, bi = 0, bd = Infinity;
      for (var i = 0; i + 1 < line.length; i++) { var d = segD2(p, line[i], line[i + 1]); if (d < bd) { bd = d; bi = i; } }
      var s0 = line[bi], s1 = line[bi + 1], L = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) || 1;
      ux = (s1[0] - s0[0]) / L; uy = (s1[1] - s0[1]) / L;
      var tp = Math.max(0, Math.min(L, (p[0] - s0[0]) * ux + (p[1] - s0[1]) * uy));
      p = [s0[0] + ux * tp, s0[1] + uy * tp];               // l'axe passe par le point de la route le plus proche de la structure
    }
    if (Math.abs(ux) >= Math.abs(uy) ? ux < 0 : uy < 0) { ux = -ux; uy = -uy; }
    return { axis: [[p[0] - ux * len / 2, p[1] - uy * len / 2], [p[0] + ux * len / 2, p[1] + uy * len / 2]], from: best ? 'route' : 'defaut', dir: [ux, uy], at: p };
  };

  root.QA_MOD = root.QA_MOD || {};
  root.QA_MOD.bloc3dCalc = B;
  if (typeof module !== 'undefined' && module.exports) module.exports = B;
})(typeof window !== 'undefined' ? window : globalThis);
