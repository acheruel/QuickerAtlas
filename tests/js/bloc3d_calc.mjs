// Tests des fonctions pures du « Bloc 3D pour BridgeSketch 3D » (js/bloc3d-calc.js, v0.7.2) : repère, rééchantillonnage,
// base64 Float32, paquet conforme au contrat bs3d-terrain v1, classification par la couleur, détection de zones,
// simplification, découpe, OSM. Lancé par tests/test_js.py (node tests/js/bloc3d_calc.mjs).
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
var require = createRequire(import.meta.url);
var B = require('../../js/bloc3d-calc.js');
var n = 0;
function ok(name, fn){ fn(); n++; console.log('ok  ' + name); }
var near = function(a, b, tol, msg){ assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' ≠ ' + b + ' (± ' + tol + ')'); };

ok('repère : aller-retour local ↔ lat/lon, mètres au sol', function(){
  var F = B.frame(46.8, -71.2), p = B.toLatLon(F, 100, -50), q = B.toLocal(F, p[0], p[1]);
  near(q[0], 100, 1e-6); near(q[1], -50, 1e-6);
  // 1 000 m vers l'est à 46,8° : 1 000 / (111 319,49 × cos 46,8°) degrés de longitude
  var e = B.toLatLon(F, 1000, 0);
  near(e[1] - F.lon, 1000 / (111319.4908 * Math.cos(46.8 * Math.PI / 180)), 3e-5);
  near(e[0], F.lat, 1e-9);
  // vers le nord : ≈ 1 000 m = 0,009 ° de latitude
  near(B.toLatLon(F, 0, 1000)[0] - F.lat, 1000 / 111200, 1e-4);
});
ok('bloc : dimensions au sol et centre d\'un rectangle de carte', function(){
  var F = B.frame(46.8, -71.2), sw = B.toLatLon(F, -300, -200), ne = B.toLatLon(F, 300, 200);
  var blk = B.blockFromBounds(sw[0], sw[1], ne[0], ne[1]);
  near(blk.wM, 600, 0.01); near(blk.hM, 400, 0.01);
  near(blk.F.lat, 46.8, 1e-4); near(blk.F.lon, -71.2, 1e-9);
});
ok('pas de grille : 1 m jusqu\'à 1,5 M de cellules, sinon 2 m', function(){
  assert.equal(B.chooseCell(1000, 1000), 1);
  assert.equal(B.chooseCell(1224, 1224), 1);               // 1 498 176
  assert.equal(B.chooseCell(1300, 1300), 2);               // 1 690 000 > 1,5 M
  assert.equal(B.chooseCell(1500, 1500), 2);
  var g = B.gridFor(600, 400);
  assert.deepEqual([g.cols, g.rows, g.cell, g.x0, g.y0], [600, 400, 1, -299.5, 199.5]);
  var g2 = B.gridFor(1500, 1500);
  assert.equal(g2.cell, 2); assert.equal(g2.cols, 750); assert.ok(g2.cols * g2.rows <= B.MAX_CELLS);
});
ok('rééchantillonnage : plan incliné Mercator -> grille locale, NaN hors emprise ou sans donnée', function(){
  var F = B.frame(46.8, -71.2), k = F.k;
  // source : 1,5 × 1,5 m Mercator par pixel, 100 × 100 px centrée sur F, z = 0,01·mx + 0,02·my (plan)
  var w = 100, h = 100, sx = 1.5, a = new Float32Array(w * h), X0 = F.cx - 50 * sx, Y0 = F.cy + 50 * sx;
  for (var r = 0; r < h; r++) for (var c = 0; c < w; c++) a[r * w + c] = 0.01 * (X0 + (c + 0.5) * sx - F.cx) + 0.02 * (Y0 - (r + 0.5) * sx - F.cy);
  a[50 * w + 50] = NaN; a[0] = NaN;
  var src = { a: a, w: w, h: h, sx: sx, sy: sx, X0: X0, Y0: Y0 };
  var g = { cols: 40, rows: 30, cell: 2, x0: -39, y0: 29 };
  var out = B.resample(src, F, g);
  assert.equal(out.length, 1200);
  // cellule (r=10, c=5) : x = -29, y = 9 -> z = 0,01·(x·k) + 0,02·(y·k)
  near(out[10 * 40 + 5], 0.01 * (-29 * k) + 0.02 * (9 * k), 0.01);
  // le plan est reproduit en tout point sauf près du pixel sans donnée
  var bad = 0; for (var i = 0; i < out.length; i++) { var rr = Math.floor(i / 40), cc = i % 40, z = 0.01 * ((g.x0 + cc * 2) * k) + 0.02 * ((g.y0 - rr * 2) * k); if (isFinite(out[i]) && Math.abs(out[i] - z) > 0.02) bad++; }
  assert.equal(bad, 0);
  // hors emprise : tout NaN
  var far = B.resample(src, F, { cols: 4, rows: 4, cell: 2, x0: 500, y0: 500 });
  assert.equal(B.finiteFraction(far), 0);
  // une source entièrement sans donnée donne NaN
  var vide = B.resample({ a: new Float32Array(4).fill(NaN), w: 2, h: 2, sx: 100, sy: 100, X0: F.cx - 100, Y0: F.cy + 100 }, F, { cols: 3, rows: 3, cell: 1, x0: -1, y0: 1 });
  assert.equal(B.finiteFraction(vide), 0);
});
ok('Float32 ↔ base64 : aller-retour exact, NaN conservé, octets petit-boutistes', function(){
  var f = Float32Array.from([0, 1.5, -2.25, 123456.789, NaN, 3.4e38, 1e-30]);
  var s = B.f32ToB64(f), back = B.b64ToF32(s);
  assert.equal(back.length, f.length);
  for (var i = 0; i < f.length; i++) assert.ok(Object.is(back[i], f[i]) || (isNaN(back[i]) && isNaN(f[i])), 'élément ' + i);
  // 1,0 en petit-boutiste : 00 00 80 3F -> "AACAPw=="
  assert.equal(B.f32ToB64(Float32Array.from([1])), 'AACAPw==');
  var big = new Float32Array(300000).map(function(_, i){ return i * 0.5; });          // plus grand que le morceau de conversion
  assert.deepEqual(Array.from(B.b64ToF32(B.f32ToB64(big)).subarray(299990)), Array.from(big.subarray(299990)));
});

function sample(){
  var g = B.gridFor(60, 40, 1), N = g.cols * g.rows, mnt = new Float32Array(N).fill(10), mns = new Float32Array(N).fill(10);
  mnt[0] = NaN;
  return B.buildPacket({ frame: { lat: 46.81, lon: -71.21 }, grid: g, mnt: mnt, mns: mns, image: { dataUrl: 'data:image/jpeg;base64,/9j/AAA=', attribution: 'Esri World Imagery' },
    zones: [{ type: 'water', source: 'auto', polygon: [[0, 0], [10, 0], [10, 10]] }, { type: 'road', source: 'osm', line: [[-30, 0], [30, 0]], width: 8 }, { type: 'forest', source: 'user', polygon: [[0, 0], [5, 0], [5, 5], [0, 5]] }],
    bridge: { axis: [[-20, 0], [20, 3]], structure: { id: '13891', name: 'Pont Etchemin' } },
    attribution: ['MNEHR 1 m © RNCan (OGL-Canada)', 'OpenStreetMap contributors (ODbL)', 'Esri World Imagery'] });
}
ok('paquet : champs du contrat bs3d-terrain v1 et validation', function(){
  var p = sample();
  assert.equal(p.type, 'bs3d-terrain'); assert.equal(p.version, 1);
  assert.deepEqual(Object.keys(p).sort(), ['attribution', 'bridge', 'center', 'created', 'grid', 'image', 'mnt', 'mns', 'source', 'type', 'version', 'zones'].sort());
  assert.deepEqual(Object.keys(p.grid).sort(), ['cell', 'cols', 'rows', 'x0', 'y0']);
  assert.deepEqual(B.validatePacket(p), []);
  assert.deepEqual(B.validatePacket(Object.assign({}, p, { mns: null, image: null, bridge: null })), []);
  assert.ok(B.validatePacket(Object.assign({}, p, { version: 2 })).length > 0);
  assert.ok(B.validatePacket(Object.assign({}, p, { mnt: new Float32Array(5) })).some(function(e){ return /^mnt/.test(e); }));
  assert.ok(B.validatePacket(Object.assign({}, p, { zones: [{ type: 'lac', source: 'auto', polygon: [[0, 0], [1, 1], [2, 0]] }] })).length > 0);
  assert.ok(B.validatePacket(Object.assign({}, p, { zones: [{ type: 'road', source: 'auto', line: [[0, 0], [1, 1]] }] })).length > 0);   // largeur absente
  assert.ok(B.validatePacket(Object.assign({}, p, { bridge: { axis: [[1, 1], [1, 1]], structure: null } })).length > 0);
  assert.ok(B.validatePacket(Object.assign({}, p, { grid: { cols: 2000, rows: 1000, cell: 1, x0: 0, y0: 0 } })).length > 0);       // > 1,5 M
});
ok('paquet : JSON (.bs3dterrain) avec grilles en base64, relu et valide', function(){
  var p = sample(), txt = B.packetToJson(p), q = JSON.parse(txt);
  assert.equal(typeof q.mnt, 'string'); assert.equal(typeof q.mns, 'string');
  assert.deepEqual(B.validatePacket(q), []);
  var m = B.b64ToF32(q.mnt);
  assert.equal(m.length, 60 * 40); assert.ok(isNaN(m[0])); assert.equal(m[1], 10);
  assert.equal(q.zones[1].width, 8); assert.deepEqual(q.zones[1].line, [[-30, 0], [30, 0]]);
  assert.equal(q.bridge.structure.id, '13891');
});
ok('paquet : message postMessage, grilles copiées et transférables', function(){
  var p = sample(), m = B.packetForPost(p);
  assert.ok(m.message.mnt instanceof Float32Array); assert.equal(m.transfer.length, 2);
  assert.ok(m.transfer.every(function(b){ return b instanceof ArrayBuffer; }));
  assert.notStrictEqual(m.message.mnt.buffer, p.mnt.buffer);              // l'original reste utilisable après le transfert
  assert.deepEqual(B.validatePacket(m.message), []);
});

// ---- Classification des couleurs ----
ok('classifyCell : eau, forêt, route, autre (couleurs d\'imagerie typiques)', function(){
  var K = B.CLASS, c = B.classifyCell;
  assert.equal(c({ r: 55, g: 80, b: 100, tex: 3, chm: 0.1, nan: 0 }), K.WATER);                    // eau bleutée, lisse
  assert.equal(c({ r: 30, g: 40, b: 45, tex: 3, chm: 0, nan: 0 }), K.WATER);                       // eau très sombre
  assert.equal(c({ r: 90, g: 100, b: 95, tex: 4, chm: 0, nan: 1 }), K.WATER);                      // pas de retour LiDAR sur fond sombre
  assert.equal(c({ r: 45, g: 70, b: 40, tex: 14, chm: 12, nan: 0 }), K.FOREST);                    // forêt : vert sombre, canopée
  assert.equal(c({ r: 45, g: 70, b: 40, tex: 14, chm: null, nan: 0 }), K.FOREST);                  // sans MNS : texture
  assert.equal(c({ r: 120, g: 155, b: 80, tex: 4, chm: 0.05, nan: 0 }), K.OTHER);                  // gazon : vert clair, lisse, bas
  assert.equal(c({ r: 45, g: 70, b: 40, tex: 3, chm: 0.2, nan: 0 }), K.OTHER);                     // vert sombre mais au ras du sol, lisse
  assert.equal(c({ r: 110, g: 112, b: 114, tex: 5, chm: 0.1, nan: 0 }), K.ROAD);                   // asphalte
  assert.equal(c({ r: 150, g: 150, b: 148, tex: 6, chm: 5, nan: 0 }), K.OTHER);                    // toit gris : surélevé
  assert.equal(c({ r: 200, g: 185, b: 160, tex: 8, chm: 0, nan: 0 }), K.OTHER);                    // sol nu, herbe sèche
});

// ---- Image synthétique : bloc de 200 × 160 m, 1 px = 1 m ----
// eau bleutée lisse (haut gauche, bord ouest), forêt verte texturée (bas droite), bande grise de 8 m (route), fond beige
function synth(){
  var W = 200, H = 160, px = new Uint8ClampedArray(W * H * 4), seed = 7, rnd = function(){ seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var c = [205 + (rnd() * 6 - 3), 188 + (rnd() * 6 - 3), 160 + (rnd() * 6 - 3)];                    // fond beige
    if (x < 70 && y < 70) c = [58 + rnd() * 3, 84 + rnd() * 3, 104 + rnd() * 3];                         // eau
    if (x >= 120 && y >= 90) { var t = (rnd() - 0.5) * 70; c = [40 + t * 0.4, 66 + t, 38 + t * 0.4]; }   // forêt (texture forte)
    if (y >= 78 && y < 86 && x >= 5) c = [112 + rnd() * 4, 114 + rnd() * 4, 116 + rnd() * 4];            // route horizontale (y local 8 m)
    var p = (y * W + x) * 4; px[p] = c[0]; px[p + 1] = c[1]; px[p + 2] = c[2]; px[p + 3] = 255;
  }
  return { px: px, w: W, h: H };
}
// v0.7.4 : détection par le LiDAR. Terrain en pente douce (2 %), un lac plan à la cote 3 (60 × 60 m, rives 1 m plus haut),
// une forêt (canopée de 12 m, rugueuse) et une pelouse verte ; l'image n'est utile qu'à l'herbe.
function site(){
  var g = { cols: 200, rows: 160, cell: 1, x0: -99.5, y0: 79.5 }, N = g.cols * g.rows, mnt = new Float32Array(N), mns = new Float32Array(N);
  var W = 200, H = 160, px = new Uint8ClampedArray(W * H * 4);
  for (var r = 0; r < g.rows; r++) for (var c = 0; c < g.cols; c++) {
    var x = g.x0 + c, y = g.y0 - r, i = r * g.cols + c, lake = x > -80 && x < -20 && y > 10 && y < 70, forest = x > 20 && y < -10, lawn = x < -10 && y < -20;
    mnt[i] = lake ? 3 : 4.2 + 0.02 * (x + 100) + 0.03 * Math.sin(x * 0.9) * Math.cos(y * 1.1);
    mns[i] = mnt[i] + (forest ? 9 + 4 * Math.abs(Math.sin(c * 1.7) * Math.cos(r * 2.3)) : 0);
    var col = lake ? [40, 60, 70] : forest ? [40, 80, 40] : lawn ? [90, 150, 70] : [150, 135, 110];
    px[i * 4] = col[0]; px[i * 4 + 1] = col[1]; px[i * 4 + 2] = col[2]; px[i * 4 + 3] = 255;
  }
  return { grid: g, mnt: mnt, mns: mns, img: { px: px, w: W, h: H } };
}
ok('detect : lac plan (avec sa cote), forêt par la canopée, herbe ; peu de zones, toutes « auto »', function(){
  var s = site(), R = B.detect({ grid: s.grid, img: s.img, mnt: s.mnt, mns: s.mns, roads: null });
  var t = function(k){ return R.zones.filter(function(z){ return z.type === k; }); };
  assert.equal(t('water').length + t('river').length, 1, 'un seul plan d\'eau');
  var lake = t('water')[0];
  assert.ok(lake, 'lac fermé : « water », pas « river »');
  near(B.polygonArea(lake.polygon), 3600, 500, 'aire du lac'); near(lake.level, 3, 0.05, 'cote du lac lue dans le MNT');
  assert.ok(B.pointInPolygon([-50, 40], lake.polygon)); assert.ok(!B.pointInPolygon([50, 40], lake.polygon));
  assert.equal(t('forest').length, 1); near(B.polygonArea(t('forest')[0].polygon), 80 * 70, 800, 'aire de la forêt');
  assert.equal(t('grass').length, 1); assert.ok(B.pointInPolygon([-60, -50], t('grass')[0].polygon));
  assert.equal(t('road').length, 0);
  assert.ok(R.zones.length <= 4 && R.zones.every(function(z){ return z.source === 'auto'; }));
});
ok('detect : un sol plan sans rive plus haute ni couleur d\'eau n\'est pas de l\'eau ; sans MNS ni image, rien n\'est inventé', function(){
  var g = { cols: 120, rows: 120, cell: 1, x0: -59.5, y0: 59.5 }, N = g.cols * g.rows, mnt = new Float32Array(N), px = new Uint8ClampedArray(N * 4);
  // dalle parfaitement plane de 30 × 30 m, 20 cm plus haute que le terrain autour (stationnement, toit bas), sol brun partout
  for (var r = 0; r < g.rows; r++) for (var c = 0; c < g.cols; c++) { var i = r * g.cols + c, slab = Math.abs(g.x0 + c) < 15 && Math.abs(g.y0 - r) < 15; mnt[i] = slab ? 10.2 : 10 + 0.04 * Math.sin(c * 0.8 + r); px[i * 4] = 150; px[i * 4 + 1] = 135; px[i * 4 + 2] = 110; px[i * 4 + 3] = 255; }
  var R = B.detect({ grid: g, img: { px: px, w: 120, h: 120 }, mnt: mnt, mns: new Float32Array(mnt), roads: null });
  assert.equal(R.zones.filter(function(z){ return z.type === 'water' || z.type === 'river'; }).length, 0);
  var R2 = B.detect({ grid: g, img: null, mnt: mnt, mns: null, roads: null });
  assert.equal(R2.zones.length, 0);
});
ok('routes : masque d\'image -> lignes centrales longues, carrefour en T, largeur selon l\'épaisseur du trait', function(){
  var W = 200, H = 200, px = new Uint8ClampedArray(W * H * 4), set = function(x, y){ if (x >= 0 && y >= 0 && x < W && y < H) px[(y * W + x) * 4 + 3] = 255; };
  for (var x = 0; x < W; x++) for (var k = -1; k <= 1; k++) set(x, 100 + k);            // route est-ouest, trait de 3 px
  for (var y = 100; y < H; y++) set(60, y);                                             // rue vers le sud, trait de 1 px
  for (var q = 0; q < 6; q++) set(150 + q, 30);                                         // tache : trop courte
  var roads = B.roadsFromMask({ px: px, w: W, h: H }, { x0: -100, y0: -100, x1: 100, y1: 100 });
  assert.equal(roads.length, 2, 'la route principale n\'est pas coupée au carrefour');
  var main = roads[0], side = roads[1];
  assert.ok(Math.abs(main.line[0][0] - main.line[main.line.length - 1][0]) > 180, 'route principale d\'un bord à l\'autre');
  main.line.forEach(function(p){ near(p[1], -0.5, 2, 'ordonnée de la route principale'); });
  assert.equal(main.width, 11); assert.equal(side.width, 6.5);
  side.line.forEach(function(p){ near(p[0], -39.5, 2, 'abscisse de la rue'); });
  assert.ok(roads.every(function(z){ return z.type === 'road' && z.source === 'auto'; }));
});
ok('pont existant retiré du relief : sol interpolé sous le tablier, MNS ramené au sol, reste intact', function(){
  // vallée en V (rivière nord-sud en x = 0), tablier à la cote 10 de x = -20 à 20, 10 m de large, resté dans le MNT
  var g = B.gridFor(100, 60), N = g.cols * g.rows, mnt = new Float32Array(N), mns = new Float32Array(N);
  for (var r = 0; r < g.rows; r++) for (var c = 0; c < g.cols; c++) { var x = g.x0 + c, y = g.y0 - r, gr = Math.min(10, Math.abs(x) * 0.5), deck = Math.abs(y) <= 5 && Math.abs(x) <= 20; mnt[r * g.cols + c] = deck ? 10 : gr; mns[r * g.cols + c] = deck ? 11 : gr + (y > 20 ? 8 : 0); }
  var o = B.removeBridge(g, mnt, mns, [[-20, 0], [20, 0]], 10), at = function(a, x, y){ return a[Math.round(g.y0 - y) * g.cols + Math.round(x - g.x0)]; };
  near(at(o.mnt, 0.5, 0.5), 0.25, 0.01, 'fond de vallée sous le tablier'); near(at(o.mnt, 10.5, 0.5), 5.25, 0.01, 'versant sous le tablier');
  near(at(o.mns, 0.5, 0.5), 0.25, 0.01, 'MNS sans tablier');
  assert.equal(at(o.mnt, 0.5, 20.5), 0.25); assert.equal(at(o.mns, 0.5, 25.5), 8.25);      // hors du couloir : inchangé
  assert.equal(at(mnt, 0.5, 0.5), 10, 'grilles d\'origine intactes'); assert.ok(o.cells > 300);
  // MNT déjà sans pont : rien à corriger (le sol mesuré est gardé)
  var bare = new Float32Array(N); for (var i = 0; i < N; i++) bare[i] = Math.min(10, Math.abs(g.x0 + i % g.cols) * 0.5);
  assert.equal(B.removeBridge(g, bare, null, [[-20, 0], [20, 0]], 10).cells, 0);
});
ok('tablier lu dans le MNS : les deux bouts de l\'axe', function(){
  var g = B.gridFor(100, 40), N = g.cols * g.rows, mnt = new Float32Array(N).fill(5), mns = new Float32Array(N).fill(5);
  for (var r = 0; r < g.rows; r++) for (var c = 0; c < g.cols; c++) { var x = g.x0 + c, y = g.y0 - r; if (x >= -18 && x <= 22 && Math.abs(y) <= 4) mns[r * g.cols + c] = 11; }
  var e = B.deckExtent([0, 0], [1, 0], g, mnt, mns, 60);
  near(e[0][0], -18, 1.5); near(e[1][0], 22, 1.5);
  assert.equal(B.deckExtent([0, 15], [1, 0], g, mnt, mns, 60), null, 'pas de tablier ici');
  assert.equal(B.deckExtent([0, 0], [1, 0], g, mnt, null, 60), null, 'sans MNS');
});
ok('contour d\'une composante : carré avec un coin manquant', function(){
  var w = 6, h = 6, lab = new Int32Array(w * h);
  for (var y = 1; y <= 3; y++) for (var x = 1; x <= 3; x++) lab[y * w + x] = 1;
  lab[1 * w + 3] = 0;                                         // coin nord-est retiré
  var ring = B.traceOuter(lab, 1, w, h, 1 * w + 1);
  assert.equal(ring.length, 6);                       // forme en L : 6 coins
  near(B.polygonArea(ring), 8, 1e-9);
});

// ---- Géométrie ----
ok('simplification Douglas-Peucker : ligne et contour', function(){
  var line = []; for (var i = 0; i <= 100; i++) line.push([i, i % 2 ? 0.2 : 0]);
  var s = B.simplifyLine(line, 0.5);
  assert.deepEqual(s, [[0, 0], [100, 0]]);
  assert.ok(B.simplifyLine([[0, 0], [5, 0], [10, 8]], 0.1).length === 3);
  var sq = [[0, 0], [5, 0.1], [10, 0], [10, 5], [10, 10], [5, 10.1], [0, 10], [0, 5]];
  var rs = B.simplifyRing(sq, 0.5);
  assert.equal(rs.length, 4);
  near(B.polygonArea(rs), 100, 1.5);
});
ok('découpe au rectangle : polygone et ligne', function(){
  var rc = { x0: -10, y0: -10, x1: 10, y1: 10 };
  var p = B.clipPolygon([[-20, -20], [20, -20], [20, 20], [-20, 20]], rc);
  near(B.polygonArea(p), 400, 1e-9);
  near(B.polygonArea(B.clipPolygon([[0, 0], [30, 0], [30, 30], [0, 30]], rc)), 100, 1e-9);
  assert.equal(B.clipPolygon([[50, 50], [60, 50], [60, 60]], rc).length, 0);
  var l = B.clipLine([[-20, 0], [20, 0]], rc);
  assert.deepEqual(l, [[[-10, 0], [10, 0]]]);
  assert.equal(B.clipLine([[-20, 20], [20, 20]], rc).length, 0);
  assert.equal(B.clipLine([[-5, 0], [5, 0], [5, 30]], rc).length, 1);
  var two = B.clipLine([[-5, 0], [30, 0], [30, 5], [5, 5]], rc);       // sort du bloc, y revient : deux morceaux
  assert.equal(two.length, 2);
});
ok('relief ombré : pente exposée au nord-ouest plus claire que celle exposée au sud-est', function(){
  var cols = 21, rows = 21, up = new Float32Array(cols * rows), down = new Float32Array(cols * rows);
  for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) { up[r * cols + c] = (c + r) * 0.5; down[r * cols + c] = -(c + r) * 0.5; }
  // z croît vers le sud-est : la pente regarde le nord-ouest, d'où vient le soleil
  var a = B.hillshade(up, cols, rows, 1), b = B.hillshade(down, cols, rows, 1);
  assert.ok(a.gray[10 * a.w + 10] > b.gray[10 * b.w + 10] + 60, a.gray[10 * a.w + 10] + ' vs ' + b.gray[10 * b.w + 10]);
  assert.equal(a.w, 21);
  var flat = B.hillshade(new Float32Array(cols * rows).fill(3), cols, rows, 1);
  near(flat.gray[10 * flat.w + 10], 180, 1, 'terrain plat');
  var nan = B.hillshade(new Float32Array(cols * rows).fill(NaN), cols, rows, 1);
  assert.equal(nan.gray[0], 235);
});

ok('axe du pont proposé : la route la plus proche, sinon est-ouest ; orienté ouest -> est ; cote d\'eau dans le paquet', function(){
  var roads = [[[-100, 0], [100, 0]]];
  var b = B.suggestAxis([0, 5], roads, 60);
  assert.equal(b.from, 'route'); assert.deepEqual(b.axis, [[-30, 0], [30, 0]]); assert.deepEqual(b.at, [0, 0]);
  var c = B.suggestAxis([0, 0], [], 40);
  assert.equal(c.from, 'defaut'); assert.deepEqual(c.axis, [[-20, 0], [20, 0]]);
  var v = B.suggestAxis([0, 0], [[[3, 100], [3, -100]]], 40);                // route nord-sud : orientée vers le nord
  assert.ok(v.axis[0][1] < v.axis[1][1]);
  assert.equal(B.suggestAxis([0, 200], roads, 60).from, 'defaut', 'route trop loin');
  var pk = B.buildPacket({ frame: B.frame(46.8, -71.2), grid: { cols: 2, rows: 2, cell: 1, x0: 0, y0: 1 }, mnt: new Float32Array(4),
    zones: [{ type: 'river', source: 'auto', polygon: [[0, 0], [1, 0], [1, 1]], level: 12.34 }, { type: 'forest', source: 'auto', polygon: [[0, 0], [1, 0], [1, 1]], level: 3 }] });
  assert.equal(pk.zones[0].level, 12.34); assert.equal(pk.zones[1].level, undefined);
  assert.deepEqual(B.validatePacket(pk), []);
});

console.log(n + ' essais Bloc 3D : ok');
