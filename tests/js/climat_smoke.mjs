// Test de fumée de js/climat.js (sans navigateur ni réseau) : `node tests/js/climat_smoke.mjs`
//  - noms de couches CanDCS-U6, URL GetFeatureInfo (v0.7.1 : plus d'API OGC ni d'indices CMIP5) ;
//  - analyse d'une réponse GetFeatureInfo réelle (tests/fixtures/climat_gfi_precip.txt) ;
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

// Données de Montréal/Laval (SSP2-4.5) arrondies : référence 1971-2000 et écarts de deux horizons
function jeu(){
  var D = { base: {}, ano: {} };
  T.VARS.forEach(function(v){ T.PERS.forEach(function(per){
    [10, 50, 90].forEach(function(p, i){
      D.base[T.layerBase('SSP245', v, p, per)] = (v === 'Precip' ? 970 : 10) + i;
      D.ano[T.layerAno('SSP245', v, p, '2041-2070', per)] = (v === 'Precip' ? 50 : 2) + i * 2;
      D.ano[T.layerAno('SSP245', v, p, '2021-2050', per)] = (v === 'Precip' ? 20 : 1) + i;
    });
  }); });
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
  assert.equal(par['tn-djf'].ec.pct, null);                           // pas de pourcentage pour une température
});

ok('v0.7.1 : référence 2021-2050 = base + écart 2021-2050 ; écart = différence des médianes, sans plage', function(){
  var par = {}; T.buildRows(jeu(), 'SSP245', '2041-2070', '2021-2050').forEach(function(r){ par[r.def.id] = r; });
  var t = par.t;
  assert.equal(t.base.v, 11 + 2); assert.equal(t.base.lo, 11 + 1); assert.equal(t.base.hi, 11 + 3);
  assert.equal(t.fut.v, 15); assert.equal(t.ec.v, 2); assert.equal(t.ec.lo, null);
  var p = par.p;
  assert.equal(p.base.v, 971 + 21); assert.equal(p.ec.v, 52 - 21); proche(p.ec.pct, 100 * 31 / 992);
  var D = jeu(); delete D.ano[T.layerAno('SSP245', 'AirTemp', 50, '2021-2050', '')];
  assert.equal(T.buildRows(D, 'SSP245', '2041-2070', '2021-2050')[0].etat, 'nd');
});

ok('lignes : données pas encore reçues → « att » ; valeur manquante → « nd »', function(){
  var vide = T.buildRows(null, 'SSP245', '2041-2070');
  assert.ok(vide.every(function(r){ return r.etat === 'att'; }));
  var D = jeu(); delete D.ano[T.layerAno('SSP245', 'AirTemp', 50, '2041-2070', '')];
  var rows = T.buildRows(D, 'SSP245', '2041-2070');
  assert.equal(rows[0].etat, 'nd'); assert.equal(rows[0].fut.v, null);
});

ok('tableau : 4 thèmes, icône par indice, flèche ET signe, plus de CMIP5 ni d’autres saisons', function(){
  var rows = T.buildRows(jeu(), 'SSP245', '2041-2070');
  var html = T.tableHtml(rows, { hor: '2041-2070', ref: '1971-2000' });
  ['Températures', 'Gel et dégel', 'Chaleur', 'Précipitations'].forEach(function(g){ assert.ok(html.indexOf('>' + g + '<') > 0, g); });
  assert.ok(html.indexOf('Autres saisons') < 0 && html.indexOf('CMIP5') < 0);
  assert.ok(/▲ \+4,0/.test(html), 'flèche + signe');
  assert.ok(html.indexOf('1971–2000') > 0 && html.indexOf('2041–2070') > 0);
  assert.equal((html.match(/class="cl-ic"/g) || []).length, T.DEFS.length);
  var h2 = T.tableHtml(T.buildRows(jeu(), 'SSP245', '2041-2070', '2021-2050'), { hor: '2041-2070', ref: '2021-2050' });
  assert.ok(h2.indexOf('>2021–2050<') > 0);
  var att = T.tableHtml(T.buildRows(null, 'SSP245', '2041-2070'), { hor: '2041-2070' });
  assert.ok(att.indexOf('chargement') > 0);
});

ok('données : 3 scénarios, 3 horizons, 2 références, 14 indices uniques avec icône, couches utiles seulement', function(){
  assert.deepEqual(T.SSPS.map(function(s){ return s.k; }), ['SSP126', 'SSP245', 'SSP585']);
  assert.deepEqual(T.HORS.map(function(h){ return h.k; }), ['2021-2050', '2041-2070', '2071-2100']);
  assert.deepEqual(T.REFS, ['1971-2000', '2021-2050']);
  assert.equal(T.DEFS.length, 14);
  assert.equal(new Set(T.DEFS.map(function(d){ return d.id; })).size, T.DEFS.length);
  T.DEFS.forEach(function(d){ assert.ok(d.g >= 0 && d.g < T.GROUPES.length); assert.ok(d.v); assert.ok(T.ICONES[d.id], d.id); });
  assert.equal(T.layersVar('SSP245', 'AirTemp', null).length, 3);             // annuel seulement
  assert.equal(T.layersVar('SSP245', 'AirTempMin', '2041-2070').length, 15);
});

console.log(n + ' tests OK');
