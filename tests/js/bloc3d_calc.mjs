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
ok('detect : eau, forêt et route reconnues sur une image synthétique', function(){
  var im = synth(), g = { cols: 100, rows: 80, cell: 2, x0: -99, y0: 79 }, N = g.cols * g.rows;
  var mnt = new Float32Array(N).fill(5), mns = new Float32Array(N).fill(5);
  // le MNS montre la canopée (12 m) sur la forêt
  for (var r = 0; r < g.rows; r++) for (var c = 0; c < g.cols; c++) if (c >= 60 && r >= 45) mns[r * g.cols + c] = 17;
  var R = B.detect({ grid: g, img: im, mnt: mnt, mns: mns, osm: null });
  var byType = {}; R.zones.forEach(function(z){ (byType[z.type] = byType[z.type] || []).push(z); });
  assert.ok(byType.river || byType.water, 'eau détectée'); assert.ok(byType.forest, 'forêt détectée'); assert.ok(byType.road, 'route détectée');
  var water = (byType.river || byType.water)[0], forest = byType.forest[0], road = byType.road[0];
  // eau : 70 × 70 m, coin nord-ouest (x ∈ [-100, -30], y ∈ [10, 80])
  near(B.polygonArea(water.polygon), 70 * 70, 600, 'aire de l\'eau');
  assert.ok(B.pointInPolygon([-65, 45], water.polygon)); assert.ok(!B.pointInPolygon([0, -30], water.polygon));
  // forêt : 80 × 70 m, coin sud-est (x ∈ [20, 100], y ∈ [-80, -10])
  near(B.polygonArea(forest.polygon), 80 * 70, 700, 'aire de la forêt');
  assert.ok(B.pointInPolygon([60, -45], forest.polygon));
  // route : bande de 8 m de large vers y = 80 − 82 = -2 (image à 1 m/px ; bord nord à y = 80)
  var xs = road.line.map(function(p){ return p[0]; }), ys = road.line.map(function(p){ return p[1]; });
  assert.ok(Math.max.apply(null, xs) - Math.min.apply(null, xs) > 150, 'longueur de la route');
  ys.forEach(function(y){ near(y, -2, 4, 'ordonnée de l\'axe'); });
  near(road.width, 8, 3, 'largeur');
  assert.ok(R.zones.every(function(z){ return z.source === 'auto'; }));
  assert.equal(R.dc, 2);
});
ok('detect : les zones OSM l\'emportent (cellules couvertes retirées de la détection)', function(){
  var im = synth(), g = { cols: 100, rows: 80, cell: 2, x0: -99, y0: 79 }, N = g.cols * g.rows;
  var mnt = new Float32Array(N).fill(5);
  var osm = { zones: [{ type: 'water', source: 'osm', polygon: [[-101, 81], [-28, 81], [-28, 8], [-101, 8]] }, { type: 'road', source: 'osm', line: [[-100, -2], [100, -2]], width: 8 }] };
  var R = B.detect({ grid: g, img: im, mnt: mnt, mns: null, osm: osm });
  assert.ok(!R.zones.some(function(z){ return z.type === 'water' || z.type === 'river'; }), 'eau déjà couverte par OSM');
  assert.ok(!R.zones.some(function(z){ return z.type === 'road'; }), 'route déjà couverte par OSM');
  assert.ok(R.zones.some(function(z){ return z.type === 'forest'; }), 'la forêt, absente d\'OSM, reste détectée');
  assert.ok(R.stats.osmCovered > 500);
});
ok('detect : sans image, aucune zone auto', function(){
  var g = { cols: 20, rows: 20, cell: 2, x0: -19, y0: 19 }, R = B.detect({ grid: g, img: null, mnt: new Float32Array(400), mns: null, osm: null });
  assert.equal(R.zones.length, 0);
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
ok('anneaux OSM : segments recousus, tampon autour d\'une ligne', function(){
  var rings = B.stitchRings([[[0, 0], [1, 0], [1, 1]], [[1, 1], [0, 1], [0, 0]]]);
  assert.equal(rings.length, 1); assert.equal(rings[0].length, 4);
  near(B.polygonArea(rings[0]), 1, 1e-9);
  var open = B.stitchRings([[[0, 0], [1, 0]], [[5, 5], [6, 6]]]);
  assert.equal(open.length, 0);
  var buf = B.bufferLine([[0, 0], [20, 0]], 3);
  near(B.polygonArea(buf), 120, 1e-6);
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

// ---- OpenStreetMap ----
ok('OSM : eau, forêt, route, pont convertis en mètres locaux et découpés au bloc', function(){
  var F = B.frame(46.8, -71.2), ll = function(x, y){ var q = B.toLatLon(F, x, y); return { lat: q[0], lon: q[1] }; };
  var rc = { x0: -100, y0: -100, x1: 100, y1: 100 };
  var json = { elements: [
    { type: 'way', tags: { natural: 'water', water: 'lake' }, geometry: [ll(-50, -50), ll(50, -50), ll(50, 50), ll(-50, 50), ll(-50, -50)] },
    { type: 'way', tags: { landuse: 'forest' }, geometry: [ll(50, 50), ll(300, 50), ll(300, 300), ll(50, 300), ll(50, 50)] },
    { type: 'way', tags: { highway: 'primary', bridge: 'yes', name: 'Pont X', lanes: '2' }, geometry: [ll(-150, 0), ll(150, 0)] },
    { type: 'way', tags: { highway: 'footway' }, geometry: [ll(-50, 10), ll(50, 10)] },
    { type: 'way', tags: { waterway: 'stream' }, geometry: [ll(-100, -90), ll(100, -90)] },
    { type: 'way', tags: { waterway: 'river' }, geometry: [ll(-80, 0), ll(80, 0)] },                       // dans le lac : pas élargie
    { type: 'relation', tags: { natural: 'water', type: 'multipolygon' }, members: [
      { role: 'outer', geometry: [ll(60, -90), ll(90, -90), ll(90, -60)] }, { role: 'outer', geometry: [ll(90, -60), ll(60, -60), ll(60, -90)] },
      { role: 'inner', geometry: [ll(70, -80), ll(75, -80), ll(75, -75)] } ] }
  ] };
  var R = B.osmToZones(json, F, rc), t = function(ty){ return R.zones.filter(function(z){ return z.type === ty; }); };
  assert.equal(t('water').length + t('river').length, 3);                         // lac, relation, ruisseau tamponné (rivière dans le lac omise)
  assert.equal(t('forest').length, 1);
  near(B.polygonArea(t('forest')[0].polygon), 50 * 50, 1, 'forêt découpée à 100 m');
  assert.equal(t('road').length, 1);                                              // le sentier (footway) n'est pas demandé mais l'élément reste ignoré
  near(t('road')[0].width, 7, 1e-9);                                              // 2 voies × 3,5 m
  assert.deepEqual(t('road')[0].line.map(function(p){ return Math.round(p[0]); }), [-100, 100]);
  assert.equal(R.bridges.length, 1); assert.equal(R.bridges[0].name, 'Pont X');
  assert.ok(R.zones.every(function(z){ return z.source === 'osm'; }));
  var q = B.overpassQuery(46.79, -71.21, 46.81, -71.19);
  assert.ok(/natural=water/.test(q) && /highway~/.test(q) && /out geom/.test(q) && /46\.790000,-71\.210000,46\.810000,-71\.190000/.test(q));
});
ok('axe du pont proposé : tronçon « pont » OSM, sinon route, sinon est-ouest ; orienté ouest -> est', function(){
  var bridges = [{ line: [[40, 12], [-40, 2]], name: null }], roads = [[[-100, 0], [100, 0]]];
  var a = B.suggestAxis([0, 7], bridges, roads, 60);
  assert.equal(a.from, 'osm-pont'); assert.ok(a.axis[0][0] < a.axis[1][0]);
  near(Math.hypot(a.axis[1][0] - a.axis[0][0], a.axis[1][1] - a.axis[0][1]), Math.hypot(80, 10), 0.5);
  var b = B.suggestAxis([0, 5], [], roads, 60);
  assert.equal(b.from, 'osm-route'); assert.deepEqual(b.axis, [[-30, 0], [30, 0]]);
  var c = B.suggestAxis([0, 0], [], [], 40);
  assert.equal(c.from, 'defaut'); assert.deepEqual(c.axis, [[-20, 0], [20, 0]]);
  var v = B.suggestAxis([0, 0], [], [[[3, 100], [3, -100]]], 40);                // route nord-sud : orientée vers le nord
  assert.ok(v.axis[0][1] < v.axis[1][1]);
});

console.log(n + ' essais Bloc 3D : ok');
