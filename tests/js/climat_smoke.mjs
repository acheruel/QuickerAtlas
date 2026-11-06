// Test de fumée de js/climat.js (sans navigateur ni réseau) : `node tests/js/climat_smoke.mjs`
//  - noms de couches CanDCS-U6, URL GetFeatureInfo et API OGC ;
//  - analyse d'une réponse GetFeatureInfo réelle (tests/fixtures/climat_gfi_precip.txt) et d'une réponse CoverageJSON réelle
//    (tests/fixtures/climat_coverage_rcp45_p50.json, Montréal/Laval, RCP4.5, percentile 50) ;
//  - cellule de grille, formatage français, assemblage des lignes et du tableau (flèche et signe, jamais la couleur seule).
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
var require = createRequire(import.meta.url);
var ici = path.dirname(fileURLToPath(import.meta.url));
var fix = function(nom){ return fs.readFileSync(path.join(ici, '..', 'fixtures', nom), 'utf8'); };

globalThis.window = { QA_MOD: {} };
require('../../js/climat.js');
var M = globalThis.window.QA_MOD.climat;
assert.ok(M && typeof M.render === 'function', 'module non enregistré');
var T = M._t;
var n = 0;
function ok(name, fn){ fn(); n++; console.log('ok  ' + name); }
var proche = function(a, b, e){ assert.ok(Math.abs(a - b) <= (e || 1e-6), a + ' ≠ ' + b); };

ok('noms de couches : référence et écart', function(){
  assert.equal(T.layerBase('SSP245', 'AirTempMax', 50, ''), 'CanDCSU6-SSP245_AirTempMax-Pct50_1971-2000_P0Y');
  assert.equal(T.layerBase('SSP126', 'Precip', 10, '-DJF'), 'CanDCSU6-SSP126_Precip-Pct10_1971-2000_P0Y-DJF');
  assert.equal(T.layerAno('SSP585', 'AirTempMin', 90, '2071-2100', '-JJA'), 'CanDCSU6-SSP585_AirTempMinAnomaly-Pct90_2071-2100_P0Y-JJA');
  assert.equal(T.layerAno('SSP245', 'Precip', 50, '2041-2070', ''), 'CanDCSU6-SSP245_PrecipAnomaly-Pct50_2041-2070_P0Y');
  var l = T.layersVar('SSP245', 'Precip', null);
  assert.equal(l.length, 15);                     // 3 percentiles × (annuel + 4 saisons)
  assert.equal(new Set(l).size, 15);
  assert.ok(l.every(function(x){ return /_1971-2000_P0Y(-[A-Z]{3})?$/.test(x); }));
  assert.ok(T.layersVar('SSP245', 'Precip', '2041-2070').every(function(x){ return /PrecipAnomaly-Pct(10|50|90)_2041-2070_P0Y/.test(x); }));
});

ok('URL GetFeatureInfo : WMS 1.3.0, bbox lat,lon, texte brut', function(){
  var u = T.urlGfi(['A', 'B'], 45.586, -73.687);
  assert.ok(u.indexOf('https://geo.weather.gc.ca/geomet-climate?') === 0);
  assert.ok(/request=GetFeatureInfo/.test(u) && /layers=A,B&query_layers=A,B/.test(u) && /info_format=text\/plain/.test(u));
  assert.ok(/bbox=45\.5360,-73\.7370,45\.6360,-73\.6370/.test(u), u);
  assert.ok(/i=50&j=50/.test(u));
});

ok('cellule de grille : centre de la cellule de 1/12° qui contient l’ouvrage', function(){
  var c = T.cellCentre(45.586, -73.687);
  proche(c.lat, 45.625, 1e-4); proche(c.lon, -73.7083, 1e-4);      // même cellule que GeoMet (x = -73,708336 ; y = 45,625)
  [[46.75, -71.29], [48.83, -64.48], [49.91, -74.37]].forEach(function(pt){
    var k = T.cellCentre(pt[0], pt[1]);
    assert.ok(Math.abs(k.lat - pt[0]) <= 1 / 24 + 1e-6 && Math.abs(k.lon - pt[1]) <= 1 / 24 + 1e-6, JSON.stringify(k));    // au plus une demi-cellule
    var i = (k.lat - 41.04166667) * 12, j = (k.lon + 140.95833333) * 12;
    assert.ok(Math.abs(i - Math.round(i)) < 1e-4 && Math.abs(j - Math.round(j)) < 1e-4);                                   // sur la grille
  });
  assert.ok(T.distKm(45.586, -73.687, 45.625, -73.7083) < 6);
  assert.ok(/45,625 ° N, 73,708 ° O/.test(T.coordTxt(45.625, -73.7083)));
});

ok('GetFeatureInfo réel : valeurs par couche', function(){
  var p = T.parseGfi(fix('climat_gfi_precip.txt'));
  assert.equal(Object.keys(p.vals).length, 15);
  proche(p.vals['CanDCSU6-SSP245_Precip-Pct50_1971-2000_P0Y'], 970.6463);
  proche(p.vals['CanDCSU6-SSP245_Precip-Pct10_1971-2000_P0Y'], 952.85608);
  assert.ok(p.vals['CanDCSU6-SSP245_Precip-Pct90_1971-2000_P0Y'] > p.vals['CanDCSU6-SSP245_Precip-Pct10_1971-2000_P0Y']);
  proche(p.x, -73.708336); proche(p.y, 45.625);
  T.layersVar('SSP245', 'Precip', null).forEach(function(l){ assert.ok(l in p.vals, l); });
});

ok('GetFeatureInfo : couche sans valeur (hors grille) → null ; entrée invalide → vide', function(){
  var t = "GetFeatureInfo results:\n\nLayer 'X'\n\nLayer 'Y'\n  Feature 0: \n    x = '-70.5'\n    y = '46.0'\n    value_0 = '3.5'\n    class = '3 3.5'\n";
  var p = T.parseGfi(t);
  assert.equal(p.vals.X, null); assert.equal(p.vals.Y, 3.5); proche(p.x, -70.5);
  assert.deepEqual(T.parseGfi(null).vals, {});
  assert.deepEqual(T.parseGfi('<ServiceExceptionReport>').vals, {});
  assert.equal(T.parseGfi("Layer 'Z'\n value_0 = 'nodata'").vals.Z, null);
});

ok('URL de l’API OGC : historique et projections', function(){
  var c = { lat: 45.625, lon: -73.7083 };
  var u = T.urlIdx(true, c, 95, 'RCP8.5', '2006/2100');
  assert.ok(u.indexOf('https://api.weather.gc.ca/collections/climate:indices:projected/coverage?f=json&bbox=') === 0);
  assert.ok(/properties=tx30,tn20,cdd,hdd,prep1&datetime=2006\/2100&subset=percentile\(95\),scenario\(RCP8\.5\)$/.test(u), u);
  assert.ok(/bbox=-73\.7283,45\.6050,-73\.6883,45\.6450/.test(u));
  var h = T.urlIdx(false, c, 5, null, '1971/2000');
  assert.ok(/climate:indices:historical\/coverage/.test(h) && /subset=percentile\(5\)$/.test(h) && !/scenario/.test(h));
});

var COV = null;
ok('CoverageJSON réel (RCP4.5, p50) : années et séries', function(){
  COV = T.parseCoverage(JSON.parse(fix('climat_coverage_rcp45_p50.json')));
  assert.equal(COV.years.length, 95); assert.equal(COV.years[0], 2006); assert.equal(COV.years[94], 2100);
  ['tx30', 'tn20', 'cdd', 'hdd', 'prep1'].forEach(function(k){ assert.equal(COV.props[k].length, 95, k); });
  assert.equal(COV.props.tx30[35], 27);                   // 2041 : 27 jours (même valeur que GetFeatureInfo)
  proche(COV.x, -73.7083, 1e-3); proche(COV.y, 45.625, 1e-3);
  assert.deepEqual(T.parseCoverage(null).years, []);
  assert.deepEqual(T.parseCoverage({ domain: {}, ranges: {} }).years, []);
});

ok('moyenne : fenêtre de 4 ans', function(){
  assert.equal(T.moyenne([2001, 2002, 2003, 2004], [1, 2, 3, 4], 2002, 2003), 2.5);
});

ok('moyenne : au moins 80 % des années exigées', function(){
  assert.equal(T.moyenne([1, 2, 3, 4, 5], [1, 2, 3, 4, 5], 1, 5), 3);
  assert.equal(T.moyenne([1, 2, 3, 4, 5], [1, null, 3, 4, 5], 1, 5), 13 / 4);       // 4 sur 5 = 80 %
  assert.equal(T.moyenne([1, 2, 3, 4, 5], [1, null, null, 4, 5], 1, 5), null);      // 3 sur 5 : trop peu
  assert.equal(T.moyenne([], [], 2041, 2070), null);
  var m = T.moyenne(COV.years, COV.props.tx30, 2041, 2070);
  assert.ok(m > 20 && m < 35, String(m));
});

ok('formatage : virgule, vrai signe moins, flèche', function(){
  assert.equal(T.fmt(11.104, 1), '11,1');
  assert.equal(T.fmt(-13.04, 1), '−13,0');
  assert.equal(T.fmt(null, 1), '—');
  assert.equal(T.fmt(NaN, 0), '—');
  assert.equal(T.fmt(-0.04, 1), '0,0');                              // pas de « −0,0 »
  assert.equal(T.fmt(4493.2, 0), '4 493');                       // espace fine insécable
  assert.equal(T.fmtSigne(3.1, 1), '+3,1');
  assert.equal(T.fmtSigne(-782, 0), '−782');
  assert.equal(T.fmtSigne(0, 1), '0,0');
  assert.equal(T.fleche(3.1, 1), '▲'); assert.equal(T.fleche(-0.5, 1), '▼'); assert.equal(T.fleche(0.01, 1), '=');
});

// Données de Montréal/Laval (SSP2-4.5, 2041-2070) arrondies : valeurs observées lors de la recherche
function jeu(){
  var D = { base: {}, ano: {}, idxH: {}, idxF: {} };
  T.VARS.forEach(function(v){ T.PERS.forEach(function(per){
    [10, 50, 90].forEach(function(p, i){
      D.base[T.layerBase('SSP245', v, p, per)] = (v === 'Precip' ? 970 : 10) + i;
      D.ano[T.layerAno('SSP245', v, p, '2041-2070', per)] = (v === 'Precip' ? 50 : 2) + i * 2;
    });
  }); });
  var ans = []; for (var y = 1971; y <= 2000; y++) ans.push(y);
  [5, 50, 95].forEach(function(p, i){
    D.idxH[p] = { years: ans, props: {
      tx30: ans.map(function(y){ return (y % 2 ? 8 : 10) + i; }), tn20: ans.map(function(){ return 4; }), cdd: ans.map(function(){ return 250; }),
      hdd: ans.map(function(){ return 4500; }), prep1: ans.map(function(){ return 137; }) } };
    D.idxF[p] = { years: COV.years, props: { tx30: COV.years.map(function(){ return 30 + i * 10; }), tn20: COV.years.map(function(){ return 15; }), cdd: COV.years.map(function(){ return 500; }), hdd: COV.years.map(function(){ return 3700; }), prep1: COV.years.map(function(){ return 138; }) } };
  });
  return D;
}

ok('lignes : référence + écart = futur, plage des écarts, pourcentage des pluies', function(){
  var rows = T.buildRows(jeu(), 'SSP245', '2041-2070');
  assert.equal(rows.length, T.DEFS.length);
  var par = {}; rows.forEach(function(r){ par[r.def.id] = r; });
  var t = par.t;
  assert.equal(t.etat, 'ok');
  assert.equal(t.base.v, 11); assert.equal(t.base.lo, 10); assert.equal(t.base.hi, 12);
  assert.equal(t.ec.v, 4); assert.equal(t.fut.v, 15);                // 11 + 4
  assert.equal(t.fut.lo, 11 + 2); assert.equal(t.fut.hi, 11 + 6);     // plage = changement p10–p90 appliqué à la médiane de référence
  var p = par.p;
  assert.equal(p.ec.v, 52); proche(p.ec.pct, 100 * 52 / 971);
  assert.equal(par['t-djf'].ec.pct, null);                            // pas de pourcentage pour une température
});

ok('lignes (indices CMIP5) : moyenne des années, écart de médianes', function(){
  var rows = T.buildRows(jeu(), 'SSP245', '2041-2070'), ix;
  rows.forEach(function(r){ if (r.def.id === 'tx30') ix = r; });
  assert.equal(ix.base.v, 10);           // p50 : moyenne de 9 et 11 (années alternées) ; p5 : 9 ; p95 : 11
  assert.equal(ix.base.lo, 9); assert.equal(ix.base.hi, 11);
  assert.equal(ix.fut.v, 40); assert.equal(ix.fut.lo, 30); assert.equal(ix.fut.hi, 50);
  assert.equal(ix.ec.v, 30); assert.equal(ix.ec.lo, null);
  assert.equal(ix.etat, 'ok');
});

ok('lignes : données pas encore reçues → « att » ; valeur manquante → « nd »', function(){
  var vide = T.buildRows({ base: null, ano: null, idxH: null, idxF: null }, 'SSP245', '2041-2070');
  assert.ok(vide.every(function(r){ return r.etat === 'att'; }));
  var D = jeu(); delete D.ano[T.layerAno('SSP245', 'AirTemp', 50, '2041-2070', '')];
  var rows = T.buildRows(D, 'SSP245', '2041-2070');
  assert.equal(rows[0].etat, 'nd'); assert.equal(rows[0].fut.v, null);
  var D2 = jeu(); D2.idxF[50] = { years: [2041], props: { tx30: [1] } };       // une seule année sur 30 : trop peu
  var r2 = T.buildRows(D2, 'SSP245', '2041-2070').filter(function(r){ return r.def.id === 'tx30'; })[0];
  assert.equal(r2.etat, 'nd');
});

ok('tableau : thèmes, étiquette CMIP5, flèche ET signe, autres saisons repliées', function(){
  var rows = T.buildRows(jeu(), 'SSP245', '2041-2070');
  var html = T.tableHtml(rows, { hor: '2041-2070', rcp: 'RCP4.5', saisons: false });
  ['Températures', 'Gel et dégel', 'Chaleur', 'Précipitations'].forEach(function(g){ assert.ok(html.indexOf('>' + g + '<') > 0, g); });
  assert.ok(html.indexOf('Autres saisons') < 0);
  assert.ok(html.indexOf('>CMIP5<') > 0);
  assert.ok(/▲ \+4,0/.test(html), 'flèche + signe');
  assert.ok(html.indexOf('1971-2000') > 0 && html.indexOf('2041–2070') > 0);
  var plein = T.tableHtml(rows, { hor: '2041-2070', rcp: 'RCP4.5', saisons: true });
  assert.ok(plein.indexOf('Autres saisons') > 0);
  var att = T.tableHtml(T.buildRows({ base: null, ano: null, idxH: null, idxF: null }, 'SSP245', '2041-2070'), { hor: '2041-2070', rcp: 'RCP4.5', saisons: false });
  assert.ok(att.indexOf('chargement') > 0);
});

ok('données : 3 scénarios, 3 horizons, indices uniques', function(){
  assert.deepEqual(T.SSPS.map(function(s){ return s.k; }), ['SSP126', 'SSP245', 'SSP585']);
  assert.deepEqual(T.HORS.map(function(h){ return h.k; }), ['2021-2050', '2041-2070', '2071-2100']);
  assert.equal(new Set(T.DEFS.map(function(d){ return d.id; })).size, T.DEFS.length);
  T.DEFS.forEach(function(d){ assert.ok(d.g >= 0 && d.g < T.GROUPES.length); assert.ok(d.v || d.idx); });
});

console.log(n + ' tests OK');
