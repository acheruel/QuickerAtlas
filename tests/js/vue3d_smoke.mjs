// Test de fumée de js/vue3d.js (sans navigateur, sans réseau, sans WebGL) : `node tests/js/vue3d_smoke.mjs`
//  - emprise EPSG:3857 autour d'un point (1 km au SOL, donc élargie de 1/cos(lat)) ;
//  - URL du WCS (grille imposée) et de l'export Esri ;
//  - lecture d'un GeoTIFF tuilé synthétique, échantillonnage bilinéaire, sans-données ;
//  - grille d'altitudes → hauteurs du maillage (exagération, trous comblés), jupe du bloc, angle du nord.
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ici = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(ici, '..', '..');
globalThis.window = { QA_MOD: {} };
await import(pathToFileURL(path.join(racine, 'js', 'vue3d.js')).href);
const T = window.QA_MOD.vue3d._t;
assert.ok(T && typeof window.QA_MOD.vue3d.render === 'function', 'module non enregistré');

let n = 0;
const ok = (nom, f) => { f(); n++; console.log('ok  ' + nom); };
const proche = (a, b, e, m) => assert.ok(Math.abs(a - b) <= e, (m || '') + ' : ' + a + ' vs ' + b);

ok('merc / unmerc : aller-retour', () => {
  const [x, y] = T.merc(45.586, -73.687), [la, lo] = T.unmerc(x, y);
  proche(la, 45.586, 1e-9); proche(lo, -73.687, 1e-9);
  proche(x, -8202799.3, 1);                                           // valeur de référence calculée hors module
});

ok('bboxAutour : carré centré, 1 km au sol (largeur Mercator = 1000 / cos lat)', () => {
  for (const [lat, lon] of [[45.586, -73.687], [46.744, -71.288], [49, -66]]) {
    const bb = T.bboxAutour(lat, lon), c = T.merc(lat, lon);
    proche((bb[0] + bb[2]) / 2, c[0], 1e-6); proche((bb[1] + bb[3]) / 2, c[1], 1e-6);
    proche(bb[2] - bb[0], bb[3] - bb[1], 1e-6, 'carré');
    proche((bb[2] - bb[0]) * Math.cos(lat * Math.PI / 180), 1000, 1e-6, 'côté au sol');
  }
  const p = T.bboxAutour(45.586, -73.687);
  proche(p[0], -8203299.3 + 0, 600);                                   // ordre de grandeur (la boîte de la reconnaissance faisait ± 500 m Mercator)
  assert.ok(p[0] < p[2] && p[1] < p[3]);
});

ok('urlWcs : service, identifiant, emprise, grille imposée', () => {
  const bb = [-8203299.3, 5713751.8, -8202299.3, 5714751.8];
  const u = T.urlWcs('https://x.test/wcs', 'dsm', bb, 400);
  assert.ok(u.startsWith('https://x.test/wcs?service=WCS&version=1.1.1&request=GetCoverage&identifier=dsm&boundingbox='));
  assert.ok(u.includes('boundingbox=-8203299.3,5713751.8,-8202299.3,5714751.8,urn:ogc:def:crs:EPSG::3857'));
  assert.ok(u.includes('format=image/geotiff') && u.includes('GridOrigin=-8203299.3,5714751.8'));
  assert.ok(u.includes('GridOffsets=2.5000,-2.5000'));
});

ok('urlEsri : export 3857 en jpg', () => {
  const u = T.urlEsri('https://server.arcgisonline.com/ArcGIS/rest/services/', [1, 2, 3, 4], 1024);
  assert.equal(u, 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=1.0,2.0,3.0,4.0&bboxSR=3857&imageSR=3857&size=1024,1024&format=jpg&f=image');
});

// GeoTIFF synthétique : 4 × 4, une tuile de 4 × 4, petit-boutiste, pixel (r, c) = 100 + 10 r + c ; (3, 3) = sans données
function tiffSynth(){
  const entries = [[256, 4, 1, 4], [257, 4, 1, 4], [322, 4, 1, 4], [323, 4, 1, 4], [324, 4, 1, 0], [33550, 12, 3, 0], [33922, 12, 6, 0]];
  const ifd = 8, nIfd = entries.length, fin = ifd + 2 + nIfd * 12 + 4;
  const bScale = fin, bTie = bScale + 24, bData = bTie + 48, buf = new ArrayBuffer(bData + 64), dv = new DataView(buf);
  dv.setUint16(0, 0x4949); dv.setUint16(0, 0x4949, false);                  // « II »
  dv.setUint8(0, 0x49); dv.setUint8(1, 0x49); dv.setUint16(2, 42, true); dv.setUint32(4, ifd, true);
  dv.setUint16(ifd, nIfd, true);
  entries.forEach(([tag, type, cnt, val], i) => {
    const e = ifd + 2 + i * 12;
    dv.setUint16(e, tag, true); dv.setUint16(e + 2, type, true); dv.setUint32(e + 4, cnt, true);
    if (tag === 324) dv.setUint32(e + 8, bData, true);
    else if (tag === 33550) dv.setUint32(e + 8, bScale, true);
    else if (tag === 33922) dv.setUint32(e + 8, bTie, true);
    else dv.setUint32(e + 8, val, true);
  });
  [10, 10, 0].forEach((v, i) => dv.setFloat64(bScale + i * 8, v, true));
  [0, 0, 0, 1000, 2000, 0].forEach((v, i) => dv.setFloat64(bTie + i * 8, v, true));   // coin nord-ouest (1000, 2000)
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) dv.setFloat32(bData + (r * 4 + c) * 4, r === 3 && c === 3 ? -32767 : 100 + 10 * r + c, true);
  return buf;
}

ok('lireTiff : dimensions, géoréférence, sans-données (−32767) → NaN', () => {
  const D = T.lireTiff(tiffSynth());
  assert.equal(D.w, 4); assert.equal(D.h, 4); assert.equal(D.sx, 10); assert.equal(D.X0, 1000); assert.equal(D.Y0, 2000);
  assert.equal(D.a[0], 100); assert.equal(D.a[5], 111); assert.ok(Number.isNaN(D.a[15]));
  proche(D.ok, 15 / 16, 1e-12);
  assert.throws(() => T.lireTiff(new ArrayBuffer(64)), /GeoTIFF|pas un/);
});

ok('echant : centre d’un pixel, bilinéaire, hors emprise et voisin vide → NaN', () => {
  const D = T.lireTiff(tiffSynth());
  proche(T.echant(D, 1005, 1995), 100, 1e-4);                           // centre du pixel (0, 0)
  proche(T.echant(D, 1010, 1990), 105.5, 1e-4);                          // entre 4 pixels : 100,101,110,111 → 105,5
  assert.ok(Number.isNaN(T.echant(D, 900, 1990)));
  assert.ok(Number.isNaN(T.echant(D, 1035, 1965)), 'pixel sans données');
  assert.ok(Number.isNaN(T.echant(D, 1030, 1970)), 'voisin sans données');
});

ok('grilleAltitudes : (n + 1)² sommets, nord en rangée 0, part de sommets valides', () => {
  const D = T.lireTiff(tiffSynth()), g = T.grilleAltitudes(D, [1000, 1960, 1040, 2000], 4);
  assert.equal(g.z.length, 25);
  proche(g.z[0], 100, 1e-4);                                             // coin nord-ouest
  proche(g.z[4], 103, 1e-4);                                             // coin nord-est
  assert.ok(g.ok < 1 && g.ok > 0.5);
  const hors = T.grilleAltitudes(D, [5000, 5000, 5040, 5040], 4);
  assert.equal(hors.ok, 0);
});

ok('combler : trous bouchés par les voisins, tout vide → valeur de repli', () => {
  const z = new Float32Array([1, 2, 3, NaN, NaN, 6, 7, 8, 9]);
  const k = T.combler(z, 2, 0);
  assert.equal(k, 2); assert.ok(Array.from(z).every(Number.isFinite));
  assert.ok(z[3] >= 1 && z[3] <= 9);
  const v = new Float32Array(9).fill(NaN);
  T.combler(v, 2, 42); assert.deepEqual(Array.from(v), new Array(9).fill(42));
});

ok('minMax ignore les NaN ; hauteurs : (z − réf) × exagération, NaN → 0', () => {
  const mm = T.minMax(new Float32Array([5, NaN, 12, 7.5]));
  assert.equal(mm.min, 5); assert.equal(mm.max, 12); assert.equal(T.minMax(new Float32Array([NaN])), null);
  for (const e of T.EXAGS) {
    const y = T.hauteurs(new Float32Array([5, NaN, 12]), 5, e);
    proche(y[0], 0, 1e-9); proche(y[1], 0, 1e-9); proche(y[2], 7 * e, 1e-5);
  }
  assert.deepEqual(T.EXAGS, [1, 1.5, 2, 3]);
});

ok('positionsMaille : nord vers −Z, est vers +X, hauteur en Y', () => {
  const y = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), p = T.positionsMaille(y, 2, 1000);
  assert.equal(p.length, 27);
  assert.deepEqual(Array.from(p.slice(0, 3)), [-500, 1, -500]);          // nord-ouest
  assert.deepEqual(Array.from(p.slice(6, 9)), [500, 3, -500]);           // nord-est
  assert.deepEqual(Array.from(p.slice(24, 27)), [500, 9, 500]);          // sud-est
});

ok('jupe : 4 parois (haut = terrain, bas = base) et indices valides', () => {
  const y = new Float32Array(9).fill(7), j = T.jupe(y, 2, 1000, -12), idx = T.jupeIndex(2);
  assert.equal(j.length, 4 * 3 * 2 * 3);
  assert.deepEqual(Array.from(j.slice(0, 6)), [-500, 7, -500, -500, -12, -500]);
  assert.equal(idx.length, 4 * 2 * 6);
  assert.ok(idx.every(i => i >= 0 && i < j.length / 3));
});

ok('couverture et angleNord', () => {
  assert.equal(T.couverture(0), 'vide'); assert.equal(T.couverture(0.5), 'partiel'); assert.equal(T.couverture(1), 'complet');
  proche(T.angleNord(Math.PI / 2), 90, 1e-9); assert.equal(T.angleNord(0), 0);
});

console.log(n + ' tests réussis');
