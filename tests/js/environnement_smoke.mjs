// Test minimal de js/environnement.js (v0.6.7) : charge le module dans un faux « window » et vérifie les fonctions pures.
// Lancer : node tests/js/environnement_smoke.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
var require = createRequire(import.meta.url);

globalThis.window = {};
require('../../js/environnement.js');
var T = globalThis.window.QA_MOD.environnement._t;
var n = 0;
function ok(name, fn){ fn(); n++; console.log('ok  ' + name); }

// Carré de 0,01° autour de (46,005 ; -71,995), anneau fermé [lon, lat]
var CARRE = [[[-72.0, 46.0], [-71.99, 46.0], [-71.99, 46.01], [-72.0, 46.01], [-72.0, 46.0]]];

ok('polyDist : 0 dedans, distance au bord dehors', function(){
  assert.equal(T.polyDist(46.005, -71.995, CARRE), 0);
  var d = T.polyDist(46.005, -71.98, CARRE);                // 0,01° de longitude à l'est du bord : ≈ 773 m à 46° N
  assert.ok(d > 760 && d < 790, String(d));
  assert.ok(Math.abs(T.polyDist(46.02, -71.995, CARRE) - 1105) < 10);   // 0,01° de latitude au nord
});
ok('polyDist : trou (règle pair-impair)', function(){
  var trou = [[-71.996, 46.004], [-71.994, 46.004], [-71.994, 46.006], [-71.996, 46.006], [-71.996, 46.004]];
  assert.ok(T.polyDist(46.005, -71.995, [CARRE[0], trou]) > 50);       // au centre du trou : hors du polygone
});
ok('aireM2 : ordre de grandeur', function(){
  var a = T.aireM2(CARRE);                                   // ≈ 773 m × 1 105 m ≈ 0,86 km²
  assert.ok(a > 8.2e5 && a < 9e5, String(a));
});
ok('decodeRing : deltas entiers, anneau fermé ; point seul gardé tel quel', function(){
  assert.deepEqual(T.decodeRing([4600000, -7200000, 0, 1000, 1000, 0], 1e5), [[-72, 46], [-71.99, 46], [-71.99, 46.01], [-72, 46]]);
  assert.deepEqual(T.decodeRing([4650000, -7300000], 1e5), [[-73, 46.5]]);
});
ok('habitatsNear : boîte, distance, point sans contour, rayon', function(){
  var C = { echelle: 1e5, categories: ['Héronnière', 'Habitat du poisson (Sans publication)'], especes: ['GRAND HÉRON'],
    habitats: [
      [0, 0, 'LAC X', 0, 12.5, 1998, '2015-06-11', '03-15-0001', [4600000, -7200000, 4601000, -7199000], [[4600000, -7200000, 0, 1000, 1000, 0, 0, -1000]]],
      [1, null, 'Ruisseau Y', 0, 0, 2024, null, '19-01-1', [4602000, -7199500, 4602000, -7199500], [[4602000, -7199500]]],
      [0, 0, 'LOIN', 1, 3, 1990, null, '03-15-0002', [4700000, -7000000, 4701000, -6999000], [[4700000, -7000000, 0, 1000, 1000, 0, 0, -1000]]]]
  };
  var r = T.habitatsNear(C, 46.005, -71.995, 2000);
  assert.equal(r.length, 2);
  var lac = r.filter(function(x){ return x.nom === 'LAC X'; })[0], pt = r.filter(function(x){ return x.sansContour; })[0];
  assert.equal(lac.d, 0); assert.equal(lac.type, 'Héronnière'); assert.equal(lac.especes, 'GRAND HÉRON'); assert.equal(lac.info, false);
  assert.ok(pt.d > 1600 && pt.d < 1700, String(pt.d)); assert.deepEqual(pt.pt, [46.02, -71.995]); assert.equal(pt.rings, null);
  assert.equal(T.habitatsNear(C, 46.005, -71.995, 1000).length, 1);   // le point est à ≈ 1,66 km
});
ok('inR, rayonRequete, txtD', function(){
  assert.deepEqual(T.inR([{ d: 900 }, { d: 10 }, { d: 1500 }], 1000).map(function(x){ return x.d; }), [10, 900]);
  assert.equal(T.rayonRequete(1000), 2000); assert.equal(T.rayonRequete(2000), 2000); assert.equal(T.rayonRequete(5000), 5000);
  assert.equal(T.txtD(0), 'dans le polygone'); assert.equal(T.txtD(342), 'à 340 m'); assert.equal(T.txtD(2260), 'à 2,3 km');
});
console.log(n + ' tests réussis');
