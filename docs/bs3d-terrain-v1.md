# Paquet terrain `bs3d-terrain` v1 — contrat QuickerAtlas → BridgeSketch 3D

Décision du 2026-11-06 : QuickerAtlas (QA) délimite, extrait et prépare le bloc ; BridgeSketch 3D (BS3D) l'affiche en 3D
et y implante le pont. Ce document est la source de vérité des deux côtés (copie dans `QuickerAtlas/docs/`).

## Repère

- **Grille locale métrique** (pas de Mercator dans le paquet) : origine = centre du bloc (`center.lat`, `center.lon`),
  `x` vers l'est, `y` vers le nord, en **mètres au sol**. QA rééchantillonne la grille WCS (EPSG:3857) dans ce repère
  (mètres Mercator × cos(lat) = mètres au sol).
- Altitudes `z` en mètres (CGVD2013 tel que fourni par le MNEHR de RNCan), `NaN` = pas de donnée.

## Objet (JSON ; en `postMessage` les grilles peuvent être des `Float32Array`)

```js
{
  type: 'bs3d-terrain',
  version: 1,
  source: 'QuickerAtlas v0.7.2',          // texte libre
  created: '2026-11-06T12:00:00Z',
  center: { lat: 46.81, lon: -71.21 },
  grid: {
    cols: 600, rows: 400,                  // cols × rows ≤ 1 500 000
    cell: 1,                               // pas en m au sol (1 m ; 2 m ou plus si le bloc est grand)
    x0: -300, y0: 200,                     // centre de la cellule [0,0] = coin nord-ouest ; ligne 0 au nord
  },
  // Rangée par rangée, du nord au sud, chaque rangée d'ouest en est : z[r * cols + c] en (x0 + c*cell, y0 - r*cell)
  mnt: Float32Array | 'base64…',           // sol nu (obligatoire)
  mns: Float32Array | 'base64…' | null,    // surface (facultatif)
  image: { dataUrl: 'data:image/jpeg;base64,…', attribution: 'Esri World Imagery' } | null, // même emprise que la grille
  zones: [                                 // modifiables par l'utilisateur dans QA avant l'envoi
    { type: 'river' | 'water' | 'forest', source: 'osm' | 'auto' | 'user', polygon: [[x, y], …] },
    { type: 'road', source: 'osm' | 'auto' | 'user', line: [[x, y], …], width: 7 },
  ],
  bridge: {                                // axe du pont placé par l'utilisateur (2 clics) ou repris d'OSM / de la structure
    axis: [[x, y], [x, y]],                // culée ouest/début → culée est/fin, en m locaux
    structure: { id: '12345', name: 'Pont …' } | null,
  } | null,
  attribution: ['MNEHR 1 m © RNCan (OGL-Canada)', 'OpenStreetMap contributors (ODbL)', 'Esri World Imagery'],
}
```

Les grilles en base64 = octets d'un `Float32Array` little-endian. Fichier `.bs3dterrain` = ce JSON (grilles en base64),
UTF-8, téléchargé par QA et ouvrable par BS3D (« IMPORT MNT/MNS » › Ouvrir un fichier).

## Transport

1. **BS3D ouvre QA** : bouton « IMPORT MNT/MNS » → `window.open(QA_URL + '?bs3d=1')`. QA en mode `bs3d` affiche un
   bandeau « Délimitez un bloc pour BridgeSketch 3D ». À l'envoi : `window.opener.postMessage(packet, '*')`
   (données publiques) avec les `ArrayBuffer` en transférables.
2. **QA seul** : bouton « Envoyer vers BridgeSketch 3D » → `w = window.open(BS3D_URL + '#terrain-import')` ; BS3D, au
   chargement avec ce hash, envoie `{ type: 'bs3d-ready' }` à `window.opener` ; QA répond par le paquet.
3. **Fichier** : QA « Télécharger .bs3dterrain » ; BS3D « Ouvrir un fichier… ».

BS3D accepte un message seulement si `event.origin` est `https://acheruel.github.io` ou un hôte local
(`localhost`, `127.0.0.1`) et si `data.type === 'bs3d-terrain' && data.version === 1`.
URLs : `QA_URL = 'https://acheruel.github.io/QuickerAtlas/'`, `BS3D_URL = 'https://acheruel.github.io/BridgeSketch-3D/'` ;
en local, chaque appli lit un remplacement dans `localStorage` (`bs3d-qa-url`, `qa-bs3d-url`).

## Côté BS3D

- Le terrain importé est une **surcouche de session** : il n'entre ni dans le lien partagé ni dans le JSON du pont ; il
  est gardé dans IndexedDB pour survivre au rechargement. Par défaut, terrain procédural et 8 exemples inchangés.
- Placement : l'axe `bridge.axis` est aligné sur l'axe du pont (centre de l'axe = milieu du pont, rotation = azimut de
  l'axe). Ajustements dans la boîte d'import : glisser / tourner / décalage vertical (auto : le profil du pont rejoint le
  MNT aux deux culées).
- Le corridor du pont et de ses approches (remblais, cônes 2H:1V, talus) remplace le MNT localement ; le MNT reste
  ailleurs.
