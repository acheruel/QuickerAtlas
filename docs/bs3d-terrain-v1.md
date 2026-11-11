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
  source: 'QuickerAtlas v0.7.4',          // texte libre
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
  zones: [                                 // modifiables dans QA avant l'envoi et dans BS3D après (0.6.9)
    { type: 'river' | 'water' | 'forest' | 'grass', source: 'osm' | 'auto' | 'user', polygon: [[x, y], …],
      level: 52.3 },                       // facultatif, eau seulement : cote absolue lue dans le MNT par QA ou saisie (sinon estimée par BS3D)
    { type: 'road', source: 'osm' | 'auto' | 'user', line: [[x, y], …], width: 7,
      lanes: 2, oneway: 1 | -1, bridge: true },  // facultatifs (OSM) : voies, sens unique (1 = sens du tracé), sur ouvrage
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

Ajouts compatibles de 2026-11-08 (QA v0.7.3, BS3D 0.6.9), toujours `version: 1` : type de zone `grass` (herbe / sol
ouvert, OSM `landuse=grass|meadow|recreation_ground`, `natural=grassland`, `leisure=park`, ou tracé à la main),
attributs facultatifs `level`, `lanes`, `oneway`, `bridge`. Un lecteur plus ancien ignore une zone `grass` et ces
attributs ; il ne refuse pas le paquet.

Ajouts compatibles de 2026-11-10 (QA v0.7.4, BS3D 0.7.0), toujours `version: 1` : QA n'interroge plus OpenStreetMap ; ses
zones portent `source: 'auto'` (eau et forêt détectées par le LiDAR, herbe par la couleur, routes du masque CanVec de RNCan) ou
`'user'`. Les zones d'eau détectées portent leur cote `level`, lue dans le MNT. Si un axe de pont est fourni, QA retire le pont
existant des grilles : dans le couloir du tablier, le MNT est interpolé d'un bord à l'autre et le MNS ramené au sol. `'osm'`
reste une valeur acceptée de `source` (fichiers plus anciens) ; `lanes`, `oneway` et `bridge` restent facultatifs.

Ajouts compatibles de 2026-11-10 (QA v0.7.5, BS3D 0.7.1), toujours `version: 1` :
- **Bloc incliné** : `grid.rotation` (degrés, sens horaire) = azimut de l'axe `y` de la grille. Absent = nord en haut. Le
  repère du paquet est alors celui du bloc (`x` le long de sa largeur, `y` le long de sa hauteur) ; `center` reste le centre
  du bloc. BS3D n'en tire que la flèche du nord et le cap affiché ; un lecteur plus ancien l'ignore sans dommage.
- **Routes** : QA n'en détecte plus (elles se tracent, dans QA ou dans BS3D). Attributs facultatifs d'une route :
  `lanes`, `oneway`, `traffic: false` (pas de véhicules), `barriers: 'left' | 'right' | 'both'` (glissières, côtés pris
  dans le sens du tracé), `link: false` (ne prolonge jamais une approche de pont).
- **Densité** : `density` (0,25 à 3, 1 par défaut) sur une zone `forest` ou `grass`.
- **Image** : jusqu'à 4 096 px de côté (4 px par mètre au plus).
- **Fenêtre déjà ouverte** : quand les deux applis ont la même origine, QA demande « qui est ouvert ? » sur le
  `BroadcastChannel('bs3d-terrain-link')` : `{ type: 'bs3d-ping', ping: idQA }` ; chaque onglet BS3D répond
  `{ type: 'bs3d-here', tab, ping, name, terrain }`. Le paquet part sur le même canal avec `to: tab`, `from: idQA` et
  `transferId` ; l'accusé de réception revient avec `to: idQA`. Sinon QA réutilise la fenêtre qu'il a ouverte
  (`window.open` au même nom, `#terrain-import`) ou en ouvre une nouvelle, au choix de l'utilisateur.

## Transport

1. **BS3D ouvre QA** : bouton « IMPORT MNT/MNS » → `window.open(QA_URL + '?bs3d=1')`. QA en mode `bs3d` affiche un
   bandeau « Délimitez un bloc pour BridgeSketch 3D ». À l'envoi : `window.opener.postMessage(packet, '*')`
   (données publiques) avec les `ArrayBuffer` en transférables.
2. **QA seul** : bouton « Envoyer vers BridgeSketch 3D » → `w = window.open(BS3D_URL + '#terrain-import')` ; BS3D, au
   chargement avec ce hash, envoie `{ type: 'bs3d-ready' }` à `window.opener` ; QA répond par le paquet.
3. **Fichier** : QA « Télécharger .bs3dterrain » ; BS3D « Ouvrir un fichier… ».

**Accusé de réception (0.6.9)** : en `postMessage`, QA ajoute `transferId` (texte) au paquet. BS3D répond à la fenêtre
émettrice, à son origine exacte : `{ type: 'bs3d-terrain-ack', id: transferId, state, … }` avec `state` =
`'received'` (paquet valide, boîte ouverte ; `zones`, `axis`), `'applied'` (site et pont en place), `'closed'` (boîte
fermée sans appliquer) ou `'error'` (`message`). QA n'écoute que la fenêtre destinataire et l'identifiant du transfert ;
sans réponse en 15 s, il l'indique (ancienne version de BS3D) sans bloquer.

BS3D accepte un message seulement si `event.origin` est `https://acheruel.github.io` ou un hôte local
(`localhost`, `127.0.0.1`) et si `data.type === 'bs3d-terrain' && data.version === 1`.
URLs : `QA_URL = 'https://acheruel.github.io/QuickerAtlas/'`, `BS3D_URL = 'https://acheruel.github.io/BridgeSketch-3D/'` ;
en local, chaque appli lit un remplacement dans `localStorage` (`bs3d-qa-url`, `qa-bs3d-url`).

## Côté BS3D

- Le terrain importé est une **surcouche de session** : il n'entre ni dans le lien partagé ni dans le JSON du pont ; il
  est gardé dans IndexedDB pour survivre au rechargement. Par défaut, terrain procédural et 8 exemples inchangés.
- **Projet complet (0.6.9)** : Fichier › « Save complete project » écrit un `.bs3dproject` =
  `{ format: 'bs3d-project', formatVersion: 1, release, name, config, camera, placement, terrain }` où `terrain` est ce
  paquet (grilles en base64, zones corrigées comprises) et `config` la configuration du pont A avec `twin` (pont B).
  Fichier › Ouvrir le relit sur un navigateur vierge. Le `.bs3dterrain` autonome reste lisible.
- **Pont neutre (0.6.9)** : au premier transfert, la boîte propose un pont neutre (travées égales sur la longueur de
  l'axe, 8 au plus) ; travées, largeur, tablier, biais, pente, altitude et approches se règlent avant « Créer le pont sur
  ce site ». « Reprendre mon pont actuel » garde le pont en cours.
- **Pont B (0.6.9)** : `config.twin` = second pont indépendant sur le même site (entraxe, décalage, rotation, largeur,
  travées, tablier, biais, pente, altitude propres). Les deux ponts partagent terrain, eau, routes et lumière.
- Placement : l'axe `bridge.axis` est aligné sur l'axe du pont (centre de l'axe = milieu du pont, rotation = azimut de
  l'axe). Ajustements dans la boîte d'import : glisser / tourner / décalage vertical (auto : le profil du pont rejoint le
  MNT aux deux culées).
- Depuis 0.6.9, seules les **approches** (remblais, cônes 2H:1V, déblais) modifient le MNT. Entre les culées, le relief
  mesuré est conservé : un conflit avec le tablier est signalé dans la boîte d'import (relever le profil), jamais
  « résolu » en creusant une vallée.
