// Tests des fonctions pures du visualiseur (audit v0.5.5 n° 10) : extraites du HTML courant sans le réécrire.
// Lancé par tests/test_js.py (node tests/js/viewer_pure.mjs).
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readdirSync(root).filter(f => /^QuickerAtlas-v[\d.]+-[\d-]+\.html$/.test(f)).sort().pop();
// v0.6.0 : le profil LiDAR est dans js/lidar.js (module à la demande)
const src = readFileSync(join(root, html), 'utf8') + '\n' + readFileSync(join(root, 'js', 'lidar.js'), 'utf8');

// Source d'une fonction nommée (accolades équilibrées ; les fonctions visées n'en ont pas dans leurs chaînes)
function extract(name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'fonction absente : ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; }
  return src.slice(i, j + 1);
}
const fn = (name, deps = '') => new Function(deps + extract(name) + '; return ' + name + ';')();

// ldSamp : bilinéaire dans l'emprise, null au-delà (constat P1 : 99,5 renvoyé loin à droite d'une grille 2 × 2)
const ldSamp = fn('ldSamp');
const G = { a: Float32Array.from([0, 1, 0, 1]), w: 2, h: 2, sx: 1, sy: 1, X0: 0, Y0: 2 };
assert.equal(ldSamp(G, 1.0, 1.0), 0.5);                  // centre
assert.equal(ldSamp(G, 0.5, 1.5), 0);                    // centre du pixel (0,0)
assert.equal(ldSamp(G, 1.5, 0.5), 1);                    // centre du pixel (1,1)
assert.equal(ldSamp(G, 2.0, 1.0), 1);                    // bord droit : tolérance d'un demi-pixel
assert.equal(ldSamp(G, 100, 1.0), null);                 // loin à droite
assert.equal(ldSamp(G, -0.6, 1.0), null);                // gauche
assert.equal(ldSamp(G, 1.0, 2.6), null);                 // haut
assert.equal(ldSamp(G, 1.0, -0.6), null);                // bas

// v0.6.0 : pixel le plus proche (MNS filtré, sans mélange tablier / sol au bord du masque)
const ldNear = fn('ldNear');
assert.equal(ldNear(G, 0.9, 1.9), 0);                    // pixel (0,0)
assert.equal(ldNear(G, 1.1, 1.9), 1);                    // pixel (0,1)
assert.equal(ldNear(G, 2.1, 1.0), null);                 // hors emprise

// v0.6.0 : classes de couleur de l'imagerie (asphalte gris, végétation verte)
const ldRgbClass = fn('ldRgbClass');
assert.equal(ldRgbClass([90, 125, 70]), 'veg');          // herbe
assert.equal(ldRgbClass([40, 62, 45]), 'veg');           // conifères sombres
assert.equal(ldRgbClass([110, 112, 115]), 'gris');       // asphalte
assert.equal(ldRgbClass([192, 199, 191]), 'gris');       // béton clair à peine verdâtre (tablier de 11795)
assert.equal(ldRgbClass([200, 185, 160]), 'autre');      // sol beige, herbe sèche
assert.equal(ldRgbClass([20, 25, 30]), 'ombre');
assert.equal(ldRgbClass(null), null);

// v0.6.0 : plage continue autour de 0 (trous tolérés), médiane glissante
const ldRunAt = fn('ldRunAt');
const S11 = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
assert.deepEqual(ldRunAt(S11, [0, 1, 1, 1, 0, 1, 1, 0, 0, 0, 1], 1, 3), { s0: -4, s1: 1 });   // trou d'un échantillon franchi
assert.deepEqual(ldRunAt(S11, [0, 1, 1, 1, 0, 1, 1, 0, 0, 0, 1], 0, 3), { s0: 0, s1: 1 });
assert.deepEqual(ldRunAt(S11, [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0, 4), { s0: -5, s1: -4 }); // la plus proche, à 4 m
assert.equal(ldRunAt(S11, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0, 3), null);                    // trop loin
const ldMed = fn('ldMed');
const ldMed1 = fn('ldMed1', extract('ldMed'));
assert.deepEqual(ldMed1([1, 1, 9, 1, 1, null, 2], 1), [1, 1, 1, 1, 1, null, 2]);              // pic isolé retiré
assert.equal(ldMed([3, null, 1, 2]), 2);

// v0.6.0 : MNS filtré sur une grille synthétique (MNT plat à 10 m, pixels de 1 m)
const ldDsmFilt = fn('ldDsmFilt', extract('ldMed') + extract('ldRgbClass') + extract('ldRgbAt'));
{
  const W = 40, T = new Float32Array(W * W).fill(10), A = new Float32Array(W * W).fill(10);
  const at = (x, y) => y * W + x;
  for (let y = 15; y <= 24; y++) for (let x = 5; x <= 34; x++) A[at(x, y)] = 17;                    // tablier lisse de 30 × 10 m, 7 m au-dessus du sol
  for (let y = 18; y <= 19; y++) for (let x = 18; x <= 21; x++) A[at(x, y)] = 19.5;                 // voiture haute sur le tablier
  for (let y = 21; y <= 23; y++) for (let x = 8; x <= 17; x++) A[at(x, y)] = 21;                   // camion : 30 m² lisses, posé sur le tablier
  for (let y = 2; y <= 8; y++) for (let x = 2; x <= 8; x++) A[at(x, y)] = 13 + (((x * 7 + y * 13) % 5) - 2) * 0.8;   // arbre (rugueux)
  for (let y = 33; y <= 35; y++) for (let x = 33; x <= 35; x++) A[at(x, y)] = 11.5;                 // voiture (lisse, 9 m² < 25 m²)
  const D = a => ({ a, w: W, h: W, sx: 1, sy: 1, X0: 0, Y0: W, ok: 1 });
  const R = ldDsmFilt(D(T), D(A), null, 1);
  assert.equal(R.F.a[at(10, 20)], 17);                   // tablier gardé
  assert.equal(R.mask.a[at(10, 20)], 1);
  assert.ok(Math.abs(R.F.a[at(19, 18)] - 17) < 0.01);    // voiture : altitude du tablier (pontage)
  assert.ok(Math.abs(R.F.a[at(12, 22)] - 17) < 0.01);    // camion écarté (posé sur une autre composante), puis ponté
  assert.equal(R.F.a[at(5, 5)], 10);                     // arbre retiré : MNT
  assert.equal(R.mask.a[at(5, 5)], 0);
  assert.equal(R.F.a[at(34, 34)], 10);                   // voiture isolée retirée
  assert.equal(R.F.a[at(0, 0)], 10);                     // sol inchangé
  assert.ok(R.lab[at(10, 20)] > 0 && R.lab[at(5, 5)] === 0);
}

// v0.6.0 : chaussée lue sur une section : fenêtre grise préférée au terre-plein gazonné
const ldPlat = fn('ldPlat', extract('ldMed'));
const ldRuns = fn('ldRuns', extract('ldMed'));
{
  const sec = { t: [], z: [], g: [] };
  for (let t = -8; t <= 8; t += 0.5) { sec.t.push(t); sec.z.push(5); sec.g.push(Math.abs(t) <= 3 ? 'gris' : 'veg'); }
  const pI = ldPlat(sec, 5, 4, true), p0 = ldPlat(sec, 5, 4, false);
  assert.ok(pI.t <= 2 && pI.gris === 1, 'fenêtre grise attendue, obtenu t = ' + pI.t);
  assert.equal(p0.t, 5);                                 // sans image : la plus plane, la plus proche de l'axe OSM
  const rI = ldRuns(sec, true), r0 = ldRuns(sec, false);
  assert.equal(rI.length, 1); assert.equal(rI[0].t, 0); assert.equal(rI[0].len, 6); assert.equal(rI[0].gris, 1);
  assert.equal(r0.length, 1); assert.equal(r0[0].len, 16);
}

// v0.6.1 : profil en long de la route : droite, parabole ou double pente, robuste aux pics ; alerte au-delà de 10 % (v0.6.2)
const ldGrade = fn('ldGrade', 'var LD_GMAX = 0.10;');
{
  const S = [], bruit = i => ((i * 7919) % 11 - 5) * 0.004;               // bruit déterministe de ± 2 cm
  for (let s = -60; s <= 60; s += 1) S.push(s);
  // pente constante de 2 %, avec un camion (pic de 2,5 m sur 4 m) : la droite reste à 2 %
  let g = ldGrade(S, S.map((s, i) => 30 + 0.02 * s + bruit(i) + (s >= 10 && s < 14 ? 2.5 : 0)), -60, 60);
  assert.equal(g.type, 'droite'); assert.ok(Math.abs(g.g(0) - 0.02) < 0.001); assert.equal(g.warn, false);
  // courbe verticale en sommet : z = 31 − (s − 8)² / (2 × 2000) → parabole, rayon et sommet retrouvés
  g = ldGrade(S, S.map((s, i) => 31 - (s - 8) ** 2 / 4000 + bruit(i)), -60, 60);
  assert.equal(g.type, 'parabole'); assert.ok(g.sommet);
  assert.ok(Math.abs(g.R - 2000) / 2000 < 0.08, 'rayon ' + g.R);
  assert.ok(Math.abs(g.apex.s - 8) < 1.5 && Math.abs(g.apex.z - 31) < 0.03);
  assert.ok(Math.abs(g.g(-60) - 0.034) < 0.002 && Math.abs(g.g(60) + 0.026) < 0.002);
  // double pente : +1,5 % puis −2 % avec cassure à s = 10
  g = ldGrade(S, S.map((s, i) => 30 + (s < 10 ? 0.015 * (s - 10) : -0.02 * (s - 10)) + bruit(i)), -60, 60);
  assert.equal(g.type, 'double'); assert.ok(Math.abs(g.sb - 10) <= 3, 'cassure ' + g.sb);
  assert.ok(Math.abs(g.g(-30) - 0.015) < 0.002 && Math.abs(g.g(40) + 0.02) < 0.002);
  // pente de 8 % : plus signalée en v0.6.2 (seuil 10 %) ; −12 % : signalée
  g = ldGrade(S, S.map((s, i) => 30 + 0.08 * s + bruit(i)), -60, 60);
  assert.equal(g.warn, false);
  g = ldGrade(S, S.map((s, i) => 30 - 0.12 * s + bruit(i)), -60, 60);
  assert.equal(g.warn, true);
  // trop peu de points
  assert.equal(ldGrade([0, 1, 2], [1, 1, 1], 0, 2), null);
}

// csvCell : formules neutralisées, nombres et texte ordinaire inchangés
const csvCell = fn('csvCell');
assert.equal(csvCell('=1+1'), "'=1+1");
assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
assert.equal(csvCell(' \t=HYPERLINK("x")'), "\"' \t=HYPERLINK(\"\"x\"\")\"");
assert.equal(csvCell('-12,5'), '-12,5');
assert.equal(csvCell(12.5), '12,5');
assert.equal(csvCell('Pont; rivière'), '"Pont; rivière"');
assert.equal(csvCell(null), '');

// fetchT : le délai couvre la lecture du corps (constat n° 7)
const fetchT = fn('fetchT');
globalThis.window = globalThis;
globalThis.fetch = (url, opt) => Promise.resolve({ ok: true, json: () => new Promise((res, rej) => {
  opt.signal.addEventListener('abort', () => rej(Object.assign(new Error('abandon'), { name: 'AbortError' })));
}) });
await assert.rejects(fetchT('x', null, 20, 'json'), e => e.name === 'AbortError');
globalThis.fetch = () => Promise.resolve({ ok: false, status: 503 });
await assert.rejects(fetchT('x', null, 50, 'json'), /HTTP 503/);
// v0.6.8 : texte du repère kilométrique de la fiche
const rkTexte = fn('rkTexte', "var nf = new Intl.NumberFormat('fr-CA'); var nf1 = new Intl.NumberFormat('fr-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); var nfKm = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 1 });");
const RK = { routes: ['Autoroute 40', 'Route 172'], sens: ['Ouest'] };
assert.equal(rkTexte(RK, [0, 272, 330, 273, 272.3, 0, 0]), 'Autoroute 40 : entre km 272 et km 273 (≈ km 272,3)');
assert.equal(rkTexte(RK, [0, 5, 120, 4, 4.9, 0, 0]), 'Autoroute 40 : entre km 4 et km 5 (≈ km 4,9)');      // km décroissant
assert.equal(rkTexte(RK, [1, 18, 40, null, null, null, 0]), 'Route 172 : au km 18');
assert.equal(rkTexte(RK, [1, 3.3, 1048, null, null, null, 1]), 'Route 172 : à 1,0 km du km 3,3 (route franchie)');
assert.equal(rkTexte(RK, [1, 18, 456, null, null, null, 0]), 'Route 172 : à 460 m du km 18');
// v0.7.0 : étiquettes de recherche (n° normalisés sur 5 chiffres, « P- » accepté ; listes collées découpées)
const tagNum = fn('tagNum');
assert.equal(tagNum('4296'), '04296');
assert.equal(tagNum(' P-04296 '), '04296');
assert.equal(tagNum('p 7724'), '07724');
assert.equal(tagNum('9788s'), '09788S');
assert.equal(tagNum('12345AB'), '12345AB');
assert.equal(tagNum('Papineau'), null);
assert.equal(tagNum('route 25'), null);
const parseTags = fn('parseTags', extract('tagNum'));
assert.deepEqual(parseTags('04296, 07724;00003\n12345'), ['04296', '07724', '00003', '12345']);
assert.deepEqual(parseTags('04296 07724 P-3'), ['04296', '07724', 'P-3']);      // n° séparés par des espaces
assert.deepEqual(parseTags('pont Champlain, 04296'), ['pont Champlain', '04296']);  // mots gardés entiers
// v0.7.0 : « P- » sur la carte pour les ponts du MTMD seulement
const numLbl = fn('numLbl');
assert.equal(numLbl({ num: '04296', fam: 'pont' }), 'P-04296');
assert.equal(numLbl({ num: '12345', fam: 'ponceau' }), '12345');
assert.equal(numLbl({ num: 'M-1', fam: 'pont', src: 'mtl' }), 'M-1');
// v0.7.0 : KMZ — CRC-32 (valeur de référence de « 123456789 ») et KML bien formé, échappé, groupé par ICG
const crc32 = fn('crc32', 'var CRC_T = null;');
assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
// v0.7.1 : un seul dossier « QuickerAtlas », repère standard (aucun style), n° et nom, sans lien vers l'atlas
const buildKml = fn('buildKml', extract('kmlEsc'));
const kml = buildKml([{ num: '04296', nom: 'Pont <A & B>', lat: 46.7, lon: -71.3, icg: '2' }, { num: '1', lat: 45, lon: -73, icg: null }], { title: 'QuickerAtlas' });
assert.ok(kml.includes('<name>QuickerAtlas</name>'));
assert.ok(kml.includes('<name>04296 — Pont &lt;A &amp; B&gt;</name>') && kml.includes('<name>1</name>'));
assert.ok(kml.includes('<coordinates>-71.300000,46.700000,0</coordinates>'));
assert.ok(!/<Style|<styleUrl|<Folder|<a href/.test(kml));
assert.equal((kml.match(/<Placemark>/g) || []).length, 2);
// v0.7.1 : GeoJSON (mêmes champs que le CSV)
const EXP = 'var EXP_COLS = ' + src.match(/var EXP_COLS = (\[[^\]]*\]);/)[1] + ';' + extract('expVals');
const gj = JSON.parse(fn('buildGeojson', EXP)([{ num: '04296', nom: 'Pont', lat: 46.7, lon: -71.3, icg: '2', pub: 1 }], { a: 1 }));
assert.equal(gj.type, 'FeatureCollection');
assert.deepEqual(gj.features[0].geometry, { type: 'Point', coordinates: [-71.3, 46.7] });
assert.equal(gj.features[0].properties.num, '04296');
assert.equal(gj.features[0].properties.gestionnaire, 'MTMD');
assert.equal(gj.features[0].properties.route, null);
assert.equal(Object.keys(gj.features[0].properties).length, 28);
// v0.7.1 : archive ZIP de plusieurs fichiers (fiches PDF) : en-têtes locaux, répertoire central, nombre d'entrées
const zipFiles = fn('zipFiles', 'var CRC_T = null;' + extract('crc32'));
const enc = s => new TextEncoder().encode(s);
const zb = new Uint8Array(await zipFiles([{ name: 'a.pdf', raw: enc('AAA'), packed: enc('AAA'), method: 0 }, { name: 'b.pdf', raw: enc('BB'), packed: enc('BB'), method: 0 }]).arrayBuffer());
const dv = new DataView(zb.buffer), eocd = zb.length - 22;
assert.equal(dv.getUint32(0, true), 0x04034b50);
assert.equal(dv.getUint32(30 + 5 + 3, true), 0x04034b50);           // 2e en-tête local après « a.pdf » + 3 octets
assert.equal(dv.getUint32(eocd, true), 0x06054b50);
assert.equal(dv.getUint16(eocd + 10, true), 2);
const cenOff = dv.getUint32(eocd + 16, true);
assert.equal(dv.getUint32(cenOff, true), 0x02014b50);
assert.equal(dv.getUint32(cenOff + 46 + 5 + 42, true), 38);          // décalage du 2e fichier dans le répertoire central
// v0.7.1 : texte des fiches PDF (polices standard WinAnsi)
const pdfTxt = fn('pdfTxt', 'var PDF_CAR = ' + src.match(/var PDF_CAR = (\{[^\n]*\});/)[1] + ';');
assert.equal(pdfTxt('Rivière « l’Anse » — 12\u202f345 m ≈ œuvre ↗'), 'Rivière « l\'Anse » - 12\u00a0345 m ~ oeuvre');   // milliers insécables
console.log('viewer_pure : ok (' + html + ')');
