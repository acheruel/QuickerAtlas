/* « Bloc 3D pour BridgeSketch 3D » (v0.7.2) : fonctions pures (sans DOM, sans réseau), testées par tests/js/bloc3d_calc.mjs.
   Contrat : window.QA_MOD.bloc3dCalc. Le paquet produit suit docs/bs3d-terrain-v1.md (`bs3d-terrain` v1) :
   grille locale métrique centrée sur le bloc (x vers l'est, y vers le nord, mètres au sol), ligne 0 au nord,
   grilles Float32 (NaN = pas de donnée), zones en mètres locaux, axe du pont.
   Mercator -> sol : mètres Mercator × cos(lat) = mètres au sol, d'où le facteur k = 1 / cos(lat) (mètres Mercator par mètre).
   ES5 (comme les autres modules de js/). */
(function(root){
  'use strict';
  var R = 6378137, MAX_CELLS = 1500000, MAX_SIDE = 1500;
  var B = { R: R, MAX_CELLS: MAX_CELLS, MAX_SIDE: MAX_SIDE, SOURCE: 'QuickerAtlas v0.7.2' };

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
        if (z.type === 'road') { q.line = z.line.map(function(p){ return [p[0], p[1]]; }); q.width = z.width || 7; }
        else q.polygon = z.polygon.map(function(p){ return [p[0], p[1]]; });
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
      if (!z || ['river', 'water', 'forest', 'road'].indexOf(z.type) < 0 || !okSrc || !okPts || (z.type === 'road' && !(z.width > 0))) e.push('zones[' + i + ']');
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
  // Polygone autour d'une ligne (demi-largeur hw) : décalages gauche / droite aux sommets (onglets limités)
  B.bufferLine = function(line, hw){
    var n = line.length, L = [], Rr = [], i;
    for (i = 0; i < n; i++) {
      var a = line[Math.max(0, i - 1)], b = line[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
      var p = line[i], nx = -dy / d, ny = dx / d, m = 1;
      if (i > 0 && i < n - 1) {
        var u1x = p[0] - line[i - 1][0], u1y = p[1] - line[i - 1][1], u2x = line[i + 1][0] - p[0], u2y = line[i + 1][1] - p[1], l1 = Math.hypot(u1x, u1y) || 1, l2 = Math.hypot(u2x, u2y) || 1;
        var c = (u1x * u2x + u1y * u2y) / (l1 * l2);
        m = Math.min(2, 1 / Math.max(0.5, Math.sqrt((1 + c) / 2)));
      }
      L.push([p[0] + nx * hw * m, p[1] + ny * hw * m]); Rr.push([p[0] - nx * hw * m, p[1] - ny * hw * m]);
    }
    return L.concat(Rr.reverse());
  };
  // Assemble des segments (listes de points) en anneaux fermés en joignant les extrémités identiques
  B.stitchRings = function(segs){
    var key = function(p){ return p[0].toFixed(7) + ',' + p[1].toFixed(7); }, rest = segs.filter(function(s){ return s.length > 1; }).map(function(s){ return s.slice(); }), rings = [];
    while (rest.length) {
      var cur = rest.pop(), grew = true;
      while (grew && key(cur[0]) !== key(cur[cur.length - 1])) {
        grew = false;
        for (var i = 0; i < rest.length; i++) {
          var s = rest[i], e = key(cur[cur.length - 1]);
          if (key(s[0]) === e) { cur = cur.concat(s.slice(1)); rest.splice(i, 1); grew = true; break; }
          if (key(s[s.length - 1]) === e) { cur = cur.concat(s.slice(0, -1).reverse()); rest.splice(i, 1); grew = true; break; }
          var b = key(cur[0]);
          if (key(s[s.length - 1]) === b) { cur = s.concat(cur.slice(1)); rest.splice(i, 1); grew = true; break; }
          if (key(s[0]) === b) { cur = s.slice().reverse().concat(cur.slice(1)); rest.splice(i, 1); grew = true; break; }
        }
      }
      if (cur.length >= 4 && key(cur[0]) === key(cur[cur.length - 1])) rings.push(cur.slice(0, -1));
    }
    return rings;
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

  // Majorité 3 × 3 (une cellule change de classe si au moins 5 voisines sur 9 en ont une autre)
  function modeFilter(cls, w, h){
    var out = new Uint8Array(cls.length), cnt = [0, 0, 0, 0];
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      cnt[0] = cnt[1] = cnt[2] = cnt[3] = 0;
      for (var j = Math.max(0, y - 1); j <= Math.min(h - 1, y + 1); j++) for (var i = Math.max(0, x - 1); i <= Math.min(w - 1, x + 1); i++) cnt[cls[j * w + i]]++;
      var best = cls[y * w + x];
      for (var k = 0; k < 4; k++) if (cnt[k] >= 5) best = k;
      out[y * w + x] = best;
    }
    return out;
  }
  function erode(m, w, h){
    var o = new Uint8Array(m.length);
    for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) { var i = y * w + x; o[i] = m[i] && m[i - 1] && m[i + 1] && m[i - w] && m[i + w] ? 1 : 0; }
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
  // Transformée en distance (chanfrein 1 / √2), en cellules
  function distTransform(m, w, h){
    var d = new Float32Array(m.length), INF = 1e9, i, x, y, S = Math.SQRT2;
    for (i = 0; i < m.length; i++) d[i] = m[i] ? INF : 0;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x; if (!d[i]) continue;
      var v = d[i];
      v = Math.min(v, x > 0 ? d[i - 1] + 1 : 1, y > 0 ? d[i - w] + 1 : 1, x > 0 && y > 0 ? d[i - w - 1] + S : 1, x < w - 1 && y > 0 ? d[i - w + 1] + S : 1);
      d[i] = v;
    }
    for (y = h - 1; y >= 0; y--) for (x = w - 1; x >= 0; x--) {
      i = y * w + x; if (!d[i]) continue;
      var u = d[i];
      u = Math.min(u, x < w - 1 ? d[i + 1] + 1 : 1, y < h - 1 ? d[i + w] + 1 : 1, x < w - 1 && y < h - 1 ? d[i + w + 1] + S : 1, x > 0 && y < h - 1 ? d[i + w - 1] + S : 1);
      d[i] = u;
    }
    return d;
  }
  var N8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  // Plus long chemin d'un squelette (double parcours en largeur) parmi les pixels `alive` connexes à `seed` ; { path (indices), len (cellules) }
  function longestPath(sk, alive, w, h, seed){
    var bfs = function(src){
      var par = new Map(), dist = new Map(), q = [src], qi = 0, far = src;
      par.set(src, -1); dist.set(src, 0);
      while (qi < q.length) {
        var p = q[qi++], x = p % w, y = (p - x) / w;
        for (var k = 0; k < 8; k++) {
          var nx = x + N8[k][0], ny = y + N8[k][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          var n = ny * w + nx;
          if (!sk[n] || !alive[n] || par.has(n)) continue;
          par.set(n, p); dist.set(n, dist.get(p) + (k === 0 || k === 2 || k === 5 || k === 7 ? Math.SQRT2 : 1)); q.push(n);
          if (dist.get(n) > dist.get(far)) far = n;
        }
      }
      return { far: far, par: par, dist: dist.get(far), seen: q };
    };
    var a = bfs(seed), b = bfs(a.far), path = [], p = b.far;
    while (p !== -1) { path.push(p); p = b.par.get(p); }
    return { path: path.reverse(), len: b.dist, seen: a.seen };
  }
  // Lignes centrales d'un masque de routes : [{ line: [[x, y]…] en coordonnées de cellule (centre), width (cellules), len (cellules) }].
  // Plus long chemin du squelette, retiré avec son voisinage ; les branches restantes sont reprises tant qu'elles font minLen m.
  function centerlines(m, w, h, cell, opt){
    var sk = thin(m, w, h), dt = distTransform(m, w, h), alive = new Uint8Array(sk), out = [], guard = 0, minLen = opt.minLen / cell;
    for (var i0 = 0; i0 < sk.length && guard < 200; i0++) {
      if (!sk[i0] || !alive[i0]) continue;
      guard++;
      var lp = longestPath(sk, alive, w, h, i0);
      if (lp.len < minLen) { lp.seen.forEach(function(s){ alive[s] = 0; }); continue; }       // groupe trop court : écarté en entier
      lp.path.forEach(function(p){
        var x = p % w, y = (p - x) / w;
        for (var j = -1; j <= 1; j++) for (var i = -1; i <= 1; i++) { var nx = x + i, ny = y + j; if (nx >= 0 && ny >= 0 && nx < w && ny < h) alive[ny * w + nx] = 0; }
      });
      var ws = lp.path.map(function(p){ return dt[p]; }).sort(function(a, b){ return a - b; });
      out.push({ line: lp.path.map(function(p){ var x = p % w; return [x + 0.5, (p - x) / w + 0.5]; }), width: 2 * ws[ws.length >> 1] - 1, len: lp.len });
      i0 = -1;                                    // reprise du balayage : d'autres branches peuvent rester
    }
    return out;
  }

  // ---------- Rasterisation (masques OSM sur la grille de détection) ----------
  // G = { xmin, ymax, dc, cols, rows }
  function rasterPoly(mask, poly, G){
    var n = poly.length;
    for (var r = 0; r < G.rows; r++) {
      var y = G.ymax - (r + 0.5) * G.dc, xs = [];
      for (var i = 0, j = n - 1; i < n; j = i++) {
        var a = poly[i], b = poly[j];
        if ((a[1] > y) !== (b[1] > y)) xs.push((b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]);
      }
      xs.sort(function(p, q){ return p - q; });
      for (var k = 0; k + 1 < xs.length; k += 2) {
        var c0 = Math.max(0, Math.ceil((xs[k] - G.xmin) / G.dc - 0.5)), c1 = Math.min(G.cols - 1, Math.floor((xs[k + 1] - G.xmin) / G.dc - 0.5));
        for (var c = c0; c <= c1; c++) mask[r * G.cols + c] = 1;
      }
    }
  }
  function rasterLine(mask, line, width, G){
    var hw = width / 2 + G.dc * 0.75, h2 = hw * hw;
    for (var s = 0; s + 1 < line.length; s++) {
      var a = line[s], b = line[s + 1];
      var c0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - hw - G.xmin) / G.dc)), c1 = Math.min(G.cols - 1, Math.ceil((Math.max(a[0], b[0]) + hw - G.xmin) / G.dc));
      var r0 = Math.max(0, Math.floor((G.ymax - Math.max(a[1], b[1]) - hw) / G.dc)), r1 = Math.min(G.rows - 1, Math.ceil((G.ymax - Math.min(a[1], b[1]) + hw) / G.dc));
      for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) {
        if (segD2([G.xmin + (c + 0.5) * G.dc, G.ymax - (r + 0.5) * G.dc], a, b) <= h2) mask[r * G.cols + c] = 1;
      }
    }
  }

  // ---------- Détection ----------
  // o = { grid (du paquet), img: { px (RGBA), w, h } | null, mnt, mns|null, osm: { zones[] } | null, opt? }
  // L'image couvre l'emprise de la grille (bords des cellules). Renvoie { zones, dc, stats, cls (carte de classes), G }.
  B.detect = function(o){
    var g = o.grid, W = g.cols * g.cell, H = g.rows * g.cell, xmin = g.x0 - g.cell / 2, ymax = g.y0 + g.cell / 2, ymin = ymax - H;
    var dc = o.dc || (Math.max(W, H) > 1000 ? 3 : 2), cols = Math.ceil(W / dc), rows = Math.ceil(H / dc), N = cols * rows;
    var G = { xmin: xmin, ymax: ymax, dc: dc, cols: cols, rows: rows };
    var cls = new Uint8Array(N), i, x, y;
    var stats = { dc: dc, cols: cols, rows: rows, water: 0, forest: 0, road: 0, osmCovered: 0 };
    if (o.img) {
      var im = o.img, nn = new Float32Array(N), sr = new Float32Array(N), sg = new Float32Array(N), sb = new Float32Array(N), sl = new Float32Array(N), sl2 = new Float32Array(N);
      for (y = 0; y < im.h; y++) {
        var cy = Math.min(rows - 1, Math.floor(y * H / im.h / dc));
        for (x = 0; x < im.w; x++) {
          var cx = Math.min(cols - 1, Math.floor(x * W / im.w / dc)), p = (y * im.w + x) * 4, ci = cy * cols + cx, R_ = im.px[p], G_ = im.px[p + 1], B_ = im.px[p + 2], l = 0.299 * R_ + 0.587 * G_ + 0.114 * B_;
          nn[ci]++; sr[ci] += R_; sg[ci] += G_; sb[ci] += B_; sl[ci] += l; sl2[ci] += l * l;
        }
      }
      var chmS = null, chmN = null, nanN = new Float32Array(N), gN = new Float32Array(N);
      if (o.mns) { chmS = new Float32Array(N); chmN = new Float32Array(N); }
      var sub = Math.max(1, Math.floor(dc / g.cell));
      for (y = 0; y < g.rows; y += sub) {
        var dy = Math.min(rows - 1, Math.floor(y * g.cell / dc));
        for (x = 0; x < g.cols; x += sub) {
          var dx = Math.min(cols - 1, Math.floor(x * g.cell / dc)), gi = y * g.cols + x, di = dy * cols + dx;
          gN[di]++;
          if (!isFinite(o.mnt[gi])) nanN[di]++;
          else if (o.mns && isFinite(o.mns[gi])) { chmS[di] += o.mns[gi] - o.mnt[gi]; chmN[di]++; }
        }
      }
      for (i = 0; i < N; i++) {
        if (nn[i] < 1) continue;
        var m = sl[i] / nn[i], tex = Math.sqrt(Math.max(0, sl2[i] / nn[i] - m * m));
        cls[i] = B.classifyCell({ r: sr[i] / nn[i], g: sg[i] / nn[i], b: sb[i] / nn[i], tex: tex, chm: chmN && chmN[i] > 0 ? chmS[i] / chmN[i] : null, nan: gN[i] ? nanN[i] / gN[i] : 0 });
      }
      cls = modeFilter(cls, cols, rows);
    }
    // Zones OSM : elles l'emportent là où elles existent (les cellules qu'elles couvrent sont retirées de la détection)
    var osmM = { water: new Uint8Array(N), forest: new Uint8Array(N), road: new Uint8Array(N) }, osmZ = (o.osm && o.osm.zones) || [];
    osmZ.forEach(function(z){
      if (z.type === 'road') rasterLine(osmM.road, z.line, (z.width || 7) + 2, G);
      else rasterPoly(osmM[z.type === 'forest' ? 'forest' : 'water'], z.polygon, G);
    });
    for (i = 0; i < N; i++) {
      if (cls[i] === K.WATER && osmM.water[i]) { cls[i] = K.OTHER; stats.osmCovered++; }
      else if (cls[i] === K.FOREST && osmM.forest[i]) { cls[i] = K.OTHER; stats.osmCovered++; }
      else if (cls[i] === K.ROAD && osmM.road[i]) { cls[i] = K.OTHER; stats.osmCovered++; }
    }
    var zones = [], toL = function(v){ return [xmin + v[0] * dc, ymax - v[1] * dc]; };
    var polyOf = function(lb, c, minArea){
      var ring = B.traceOuter(lb.lab, c.id, cols, rows, c.first).map(toL);
      if (ring.length < 4) return null;
      ring = B.simplifyRing(ring, dc * 0.9);
      return ring.length >= 3 && B.polygonArea(ring) >= minArea ? ring : null;
    };
    [[K.WATER, 'water', 300], [K.FOREST, 'forest', 1200]].forEach(function(t){
      var mask = new Uint8Array(N); for (i = 0; i < N; i++) mask[i] = cls[i] === t[0] ? 1 : 0;
      mask = erode(dilate(mask, cols, rows), cols, rows);          // fermeture : rochers, écume ou ombres ne découpent pas une rivière en morceaux
      var lb = label(mask, cols, rows);
      lb.comps.forEach(function(c){
        if (c.n * dc * dc < t[2]) return;
        var ring = polyOf(lb, c, t[2]);
        if (!ring) return;
        var type = t[1];
        if (type === 'water') {                                // allongée et qui touche le bord du bloc : cours d'eau
          var xs = ring.map(function(p){ return p[0]; }), ys = ring.map(function(p){ return p[1]; }), bw = Math.max.apply(null, xs) - Math.min.apply(null, xs), bh = Math.max.apply(null, ys) - Math.min.apply(null, ys);
          var edge = Math.min.apply(null, xs) <= xmin + dc * 1.5 || Math.max.apply(null, xs) >= xmin + W - dc * 1.5 || Math.min.apply(null, ys) <= ymin + dc * 1.5 || Math.max.apply(null, ys) >= ymax - dc * 1.5;
          if (edge && Math.max(bw, bh) >= 2.5 * Math.min(bw, bh)) type = 'river';
        }
        zones.push({ type: type, source: 'auto', polygon: ring });
        stats[t[1]]++;
      });
    });
    // routes : masque gris ouvert d'une cellule (retire les petites taches), puis lignes centrales des composantes allongées
    var rm = new Uint8Array(N); for (i = 0; i < N; i++) rm[i] = cls[i] === K.ROAD ? 1 : 0;
    rm = dilate(erode(rm, cols, rows), cols, rows);
    // surfaces trop larges pour une route (stationnement, place, toit plat, rivière grise, plus de 28 m) : retirées, avec leur pourtour
    var rr = Math.max(2, Math.round(14 / dc)), core = rm, fat, it;
    for (it = 0; it < rr; it++) core = erode(core, cols, rows);
    fat = core; for (it = 0; it < rr + 1; it++) fat = dilate(fat, cols, rows);
    for (i = 0; i < N; i++) if (fat[i]) rm[i] = 0;
    var rl = label(rm, cols, rows), box = {};
    for (i = 0; i < N; i++) {
      var id2 = rl.lab[i]; if (!id2) continue;
      var bx = i % cols, by = (i - bx) / cols, bb = box[id2] || (box[id2] = { x0: bx, x1: bx, y0: by, y1: by, idx: [] });
      if (bx < bb.x0) bb.x0 = bx; if (bx > bb.x1) bb.x1 = bx; if (by < bb.y0) bb.y0 = by; if (by > bb.y1) bb.y1 = by;
      bb.idx.push(i);
    }
    rl.comps.forEach(function(c){
      if (c.n * dc * dc < 150) return;
      var bb = box[c.id], bw = bb.x1 - bb.x0 + 3, bh = bb.y1 - bb.y0 + 3, sub2 = new Uint8Array(bw * bh);
      bb.idx.forEach(function(q){ var qx = q % cols; sub2[(((q - qx) / cols) - bb.y0 + 1) * bw + (qx - bb.x0 + 1)] = 1; });
      centerlines(sub2, bw, bh, dc, { minLen: 30 }).forEach(function(cl){
        var wm = Math.max(cl.width, 1) * dc;
        if (wm > 26 || cl.len * dc < 30 || cl.len * dc / wm < 4) return;          // trop large ou pas assez allongé : parking, toit, place
        var line = cl.line.map(function(p){ return toL([p[0] + bb.x0 - 1, p[1] + bb.y0 - 1]); });
        line = B.simplifyLine(line, dc * 1.2);
        if (line.length >= 2) { zones.push({ type: 'road', source: 'auto', line: line, width: Math.max(3, Math.min(24, Math.round(wm * 2) / 2)) }); stats.road++; }
      });
    });
    return { zones: zones, dc: dc, stats: stats, cls: cls, G: G };
  };

  // ---------- OpenStreetMap (Overpass `out geom`) -> zones et ponts en mètres locaux ----------
  var HW_WIDTH = { motorway: 12, trunk: 10, primary: 9, secondary: 8, tertiary: 7, unclassified: 6, residential: 6, service: 4, motorway_link: 7, trunk_link: 7, primary_link: 6, secondary_link: 6, tertiary_link: 6, track: 3.5, living_street: 5 };
  B.OSM_HIGHWAYS = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|track|living_street';
  // Requête Overpass pour le rectangle (s, w, n, e)
  B.overpassQuery = function(s, w, n, e){
    var bb = [s, w, n, e].map(function(v){ return v.toFixed(6); }).join(',');
    return '[out:json][timeout:25];(' +
      'way[natural=water](' + bb + ');way[waterway~"^(riverbank|river|stream|canal|drain|ditch)$"](' + bb + ');' +
      'rel[natural=water](' + bb + ');rel[waterway=riverbank](' + bb + ');' +
      'way[natural=wood](' + bb + ');way[landuse=forest](' + bb + ');rel[natural=wood](' + bb + ');rel[landuse=forest](' + bb + ');' +
      'way[highway~"^(' + B.OSM_HIGHWAYS + ')$"](' + bb + ');way[man_made=bridge](' + bb + ');' +
      ');out geom;';
  };
  function tagNum(v){ var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : null; }
  // Renvoie { zones: [...], bridges: [{ line, name, ref }] } ; tout est découpé au rectangle du bloc (x0, y0, x1, y1 en m locaux)
  B.osmToZones = function(json, F, rc){
    var zones = [], bridges = [], els = (json && json.elements) || [];
    var loc = function(geom){ return (geom || []).map(function(p){ return B.toLocal(F, p.lat, p.lon); }); };
    var addPoly = function(ring, type){
      if (ring.length < 3) return;
      var c = B.clipPolygon(ring, rc);
      if (c.length >= 3 && B.polygonArea(c) >= 20) zones.push({ type: type, source: 'osm', polygon: c });
    };
    var waterPolys = [];
    els.forEach(function(el){
      var t = el.tags || {};
      var isWater = t.natural === 'water' || t.waterway === 'riverbank', isForest = t.natural === 'wood' || t.landuse === 'forest';
      if ((isWater || isForest) && el.type === 'way') {
        var ring = loc(el.geometry);
        if (ring.length > 3 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
        if (isForest) addPoly(ring, 'forest');
        else { addPoly(ring, (t.water === 'river' || t.waterway === 'riverbank' || t.water === 'canal') ? 'river' : 'water'); waterPolys.push(ring); }
      } else if ((isWater || isForest) && el.type === 'relation') {
        var outers = (el.members || []).filter(function(m){ return m.role === 'outer' && m.geometry; }).map(function(m){ return loc(m.geometry); });
        B.stitchRings(outers).forEach(function(ring){
          if (isForest) addPoly(ring, 'forest');
          else { addPoly(ring, (t.water === 'river' || t.waterway === 'riverbank' || t.water === 'canal') ? 'river' : 'water'); waterPolys.push(ring); }
        });
      }
    });
    // cours d'eau tracés en ligne seulement (sans surface cartographiée autour) : élargis à une largeur type
    els.forEach(function(el){
      var t = el.tags || {};
      if (el.type !== 'way' || !t.waterway || t.waterway === 'riverbank') return;
      var line = loc(el.geometry), width = tagNum(t.width) || ({ river: 25, canal: 14, stream: 4, drain: 3, ditch: 2 }[t.waterway] || 4);
      if (line.length < 2) return;
      // déjà dans une surface d'eau cartographiée (plus de la moitié de la ligne, échantillonnée tous les 10 m) : pas d'élargissement
      var smp = [], covered = false;
      for (var si = 0; si + 1 < line.length; si++) { var sl = Math.hypot(line[si + 1][0] - line[si][0], line[si + 1][1] - line[si][1]), sn = Math.max(1, Math.ceil(sl / 10)); for (var sk = 0; sk < sn; sk++) smp.push([line[si][0] + (line[si + 1][0] - line[si][0]) * sk / sn, line[si][1] + (line[si + 1][1] - line[si][1]) * sk / sn]); }
      waterPolys.forEach(function(r){ var c = 0; smp.forEach(function(q){ if (B.pointInPolygon(q, r)) c++; }); if (c * 2 > smp.length) covered = true; });
      if (covered) return;
      B.clipLine(line, rc).forEach(function(part){
        var poly = B.bufferLine(part, width / 2);
        if (poly.length >= 4) { var c = B.clipPolygon(poly, rc); if (c.length >= 3) zones.push({ type: 'river', source: 'osm', polygon: c, line: true }); }
      });
    });
    els.forEach(function(el){
      var t = el.tags || {};
      if (el.type !== 'way' || !((t.highway && HW_WIDTH[t.highway]) || t.man_made === 'bridge')) return;       // sentiers et pistes cyclables : ignorés
      var line = loc(el.geometry);
      if (line.length < 2) return;
      if (t.bridge && t.bridge !== 'no' || t.man_made === 'bridge') bridges.push({ line: line, name: t.name || t.ref || null, highway: t.highway || null });
      if (!t.highway || !HW_WIDTH[t.highway]) return;
      var width = tagNum(t.width) || (tagNum(t.lanes) ? tagNum(t.lanes) * 3.5 : null) || HW_WIDTH[t.highway] || 6;
      B.clipLine(line, rc).forEach(function(part){ zones.push({ type: 'road', source: 'osm', line: part, width: Math.max(3, Math.min(25, width)), bridge: !!(t.bridge && t.bridge !== 'no') }); });
    });
    return { zones: zones, bridges: bridges };
  };
  // Axe de pont proposé autour d'un point local `p` (position de la structure) : tronçon OSM « bridge » le plus proche
  // (à moins de `maxD` m), sinon route la plus proche, sinon axe est-ouest de `len` m. Orienté de l'ouest vers l'est
  // (ou du sud vers le nord si l'axe est presque vertical). Renvoie { axis, from: 'osm-pont' | 'osm-route' | 'defaut' }.
  B.suggestAxis = function(p, bridges, roads, len, maxD){
    maxD = maxD || 80;
    var best = null;
    var consider = function(line, from){
      var d = B.distToLine(p, line);
      if (d <= maxD && (!best || d < best.d - (from === 'osm-pont' && best.from !== 'osm-pont' ? 30 : 0))) best = { d: d, line: line, from: from };
    };
    bridges.forEach(function(b){ consider(b.line, 'osm-pont'); });
    if (!best) roads.forEach(function(r){ consider(r, 'osm-route'); });
    var a, b;
    if (best) {
      // segment le plus proche
      var line = best.line, bi = 0, bd = Infinity;
      for (var i = 0; i + 1 < line.length; i++) { var d = segD2(p, line[i], line[i + 1]); if (d < bd) { bd = d; bi = i; } }
      var s0 = line[bi], s1 = line[bi + 1], ux = s1[0] - s0[0], uy = s1[1] - s0[1], L = Math.hypot(ux, uy) || 1;
      ux /= L; uy /= L;
      var tp = Math.max(0, Math.min(L, (p[0] - s0[0]) * ux + (p[1] - s0[1]) * uy));
      p = [s0[0] + ux * tp, s0[1] + uy * tp];               // l'axe passe par le point de la route le plus proche de la structure
      if (best.from === 'osm-pont' && line.length >= 2) {
        // toute la longueur du tronçon « pont », projetée sur la direction du segment le plus proche
        var tmin = Infinity, tmax = -Infinity;
        line.forEach(function(q){ var t = (q[0] - p[0]) * ux + (q[1] - p[1]) * uy; if (t < tmin) tmin = t; if (t > tmax) tmax = t; });
        a = [p[0] + ux * tmin, p[1] + uy * tmin]; b = [p[0] + ux * tmax, p[1] + uy * tmax];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 8) { a = [p[0] - ux * len / 2, p[1] - uy * len / 2]; b = [p[0] + ux * len / 2, p[1] + uy * len / 2]; }
      } else { a = [p[0] - ux * len / 2, p[1] - uy * len / 2]; b = [p[0] + ux * len / 2, p[1] + uy * len / 2]; }
    } else { a = [p[0] - len / 2, p[1]]; b = [p[0] + len / 2, p[1]]; }
    var dx = b[0] - a[0], dy = b[1] - a[1];
    if (Math.abs(dx) >= Math.abs(dy) ? dx < 0 : dy < 0) { var t2 = a; a = b; b = t2; }
    return { axis: [a, b], from: best ? best.from : 'defaut' };
  };

  root.QA_MOD = root.QA_MOD || {};
  root.QA_MOD.bloc3dCalc = B;
  if (typeof module !== 'undefined' && module.exports) module.exports = B;
})(typeof window !== 'undefined' ? window : globalThis);
