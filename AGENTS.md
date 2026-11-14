# AGENTS.md — QuickerAtlas

Atlas web des ≈ 11 700 structures du MTMD (Québec) : ETL Python → SQLite → fichiers `data/*.js` → visualiseur HTML
unique (Leaflet, sans build, sans clé d'API). En ligne : <https://acheruel.github.io/QuickerAtlas/> (GitHub Pages,
`main`, racine). Doc technique détaillée : [docs/TECHNIQUE.md](docs/TECHNIQUE.md). Historique : `docs/rapports/`.

## Règles du projet

- **Interface en français seulement** (README.md en anglais, README.fr.md en français). Thème repris de l'app QuickerBridge.
- **Utilisateur daltonien** : tout codage couleur doit être sûr (palette vérifiée) et doublé d'une forme ou d'un texte.
  Points de la carte : ronds ; ICG vert/jaune/orange/rouge (`#1f9d7a/#fde047/#ef6c00/#a50026`).
- **Données ouvertes seulement**, licence citée dans la fiche/légende. Pas d'images sans licence libre (site public).
- Requêtes réseau via `etl/net.py` (User-Agent identifié, ≥ 1 s par hôte). Ne pas marteler les serveurs publics.
- Commentaires et noms en français ; on marque les changements par `// vX.Y.Z : …` (habitude du code, à garder).
- Nouvelle source de données : prototype ou rapport d'abord (`docs/rapports/` ; le dossier `prototypes/` a été retiré
  en v0.6.8, un prototype jetable va dans le bloc-notes de la session), intégration seulement si l'utilisateur la valide.
- Ne pas re-proposer les idées écartées (comparateur, indicateurs de risque, préremplissage QuickerBridge, quiz,
  module autres provinces) ni Structurae en contenu (robots interdits : liens seulement).

## Arborescence

| Chemin | Rôle |
|---|---|
| `QuickerAtlas-vX.Y.Z-AAAA-MM-JJ.html` | Visualiseur courant (≈ 3 900 lignes, CSS + HTML + JS en un fichier) ; un seul à la racine |
| `index.html` | **Copie identique** du fichier versionné (page servie par Pages) |
| `js/lidar.js`, `js/hydro.js`, `js/sismique.js`, `js/environnement.js`, `js/climat.js` | Modules chargés à la demande (contrat `window.QA_MOD`) |
| `js/bloc3d.js`, `js/bloc3d-calc.js` | Export vers BridgeSketch 3D (v0.7.2, refait en v0.7.4 ; v0.7.5 : ouvert par le menu « Exporter », bloc incliné, image jusqu'à 4 096 px en dalles ; v0.7.7 : aperçu en grand des options d'image (visionneuse), case « Joindre toutes les images » (`images[]` du paquet pour basculer dans BS3D), image refaite sous l'ancien pont retiré (`fillImageCorridor`) ; v0.7.6 : image au choix parmi 3 orthophotos ouvertes du Québec au plus (WMS Imagerie du MERN lu à l'ouverture, GéoMont 2023 ; sondage de couverture, ≤ 8 192 px, PNG ≤ 25 Mo sinon JPEG 0,98 ; Esri = repli et image de détection), plus de routes détectées, herbe olive, envoi vers une fenêtre BS3D déjà ouverte) : carte satellite à part, bloc, extraction MNT/MNS + imagerie + routes CanVec (plus d'OSM), zones détectées par le LiDAR et modifiables (sélection multiple, glisser, Suppr, Ctrl + Z), pont existant retiré du relief, envoi avec accusé de réception ; `bloc3d-calc.js` = fonctions pures testées (`tests/js/bloc3d_calc.mjs`) ; contrat du paquet : `docs/bs3d-terrain-v1.md` |
| `sw.js` | Service Worker : cache des photos du MTMD (http(s) seulement) |
| `etl/` | Pipeline Python (`python -m etl …`), un module par source ou couche |
| `etl/donnees/` | Grilles versionnées (classes de site, masque d'eau) |
| `data/*.js` | Sorties générées, chargées par `<script src>` (marche en `file://`). **Ne pas éditer à la main** |
| `data/raw/`, `data/ponts.sqlite` | Téléchargements bruts et base (non versionnés) |
| `tests/` | pytest + `tests/js/*.mjs` (Node) ; `tests/fixtures/` = extraits réels des sources |
| `outils/` | Scripts Windows de l'extraction automatique (tâche planifiée aux 2 semaines, voir TECHNIQUE.md) |
| `Doc_ref/` | Références locales (icônes MTMD, PDF) — ignoré par git, ne jamais publier |

## Commandes

```bash
pip install -r requirements.txt
python -m etl update              # toutes les sources + consolidation + export + couches (~2-3 min)
python -m etl update --only wfs   # une source (wfs, apex_list, hauteurs, gps, odata…)
python -m etl update --no-fetch   # reconsolider depuis data/raw/
python -m etl export              # data/structures.js, details.js, journal.js
python -m etl couches [--no-fetch]  # couches seules (réseaux, géotech, débits, débits du réseau, repères km, villes, forestiers, sismique, dégel, wikiponts, habitats, caméras)
python -m etl report              # rapport de jointure
python -m pytest                  # tous les tests (Python + Node si présent)
python -m http.server 8765 --bind 127.0.0.1   # serveur local (config « ponts-web » de .claude/launch.json)
```

Une source ou une couche en échec n'arrête pas les autres : lire le journal et le code de retour.

**Extraction automatique** : tâche Windows « QuickerAtlas - extraction » (`outils\planifier-extraction.cmd`), toutes les
2 semaines depuis le 2026-11-03, sur le PC de l'auteur. Les serveurs du MTMD (APEX, OData) et Québec 511 refusent les IP
de centres de données (403) : ni GitHub Actions ni une session infonuagique ne peuvent faire l'extraction complète
(seul le WFS `ws.mapserver…` répond).

## Architecture

- **ETL** : chaque source expose `SOURCE`, `TABLE`, `collect(session)` (enregistrée dans `SOURCES` de
  `etl/__main__.py`) ; `merge.build` consolide la table `structure` ; `merge.journaliser` alimente `changement`
  → `data/journal.js` (« Quoi de neuf »). Format compact de `structures.js` : `COLS` de `etl/build.py`.
- **Couches** : un module `etl/<couche>.py` avec `run(fetch=True) -> {"path", "bytes"}` qui écrit
  `window.PQ_COUCHES.<clé> = {generated, source, attribution, …}` dans `data/couche-<clé>.js`.
- **Visualiseur** : sections repérées par `// ---------- Titre ----------`. Couches superposables dans le tableau
  `OVERLAYS` (`key`, `src`, `z`, `build`, options `filtre`, `propre`, `couche`) ; `EXCLUSIFS` = une seule à la fois.
  Un seul canevas cliquable pour réseaux/points (ordre rétabli par `restack()`) ; une couche non cliquable prend
  son propre pane (`propre: true`). `FastLines` doit garder `renderer: canvas`.
- **Modules à la demande** : `window.QA_MOD[clé].render(o, body, ctx)` (LiDAR : `QA_MOD.lidar.open(o)`) ; la page
  leur prête `window.QA` (esc, formats, `fetchT`, `loadScript`, `distM`…).
- **État** : filtres dans le hash d'URL (`#c=mode&s=<num>`, `#w=Q…` pour un pont remarquable) ; préférences en
  `localStorage` (`pq-couches-v060`, `pq-filtres-masques`…). Changer une clé = nouveau suffixe de version.

### Ajouter une couche

1. `etl/<clé>.py` (+ `parse` pur testé avec une fixture dans `tests/fixtures/`), ajouté à `_couches()` de `etl/__main__.py`.
2. Entrée dans `OVERLAYS` + fonction `build…` + légende ; ajouter à `EXCLUSIFS` si elle couvre la province.
3. Ligne dans le tableau des couches de `docs/TECHNIQUE.md`.

## Publier une version (procédure habituelle)

1. Renommer le fichier courant au nouveau nom versionné (`git mv QuickerAtlas-v….html QuickerAtlas-vX.Y.Z-AAAA-MM-JJ.html`) :
   pas de dossier `old/` depuis la v0.6.8, les versions précédentes restent dans l'historique git.
2. Mettre à jour dans le HTML : `<title>` et `window.PQ_META = {"version", "date", …}`.
3. `cp QuickerAtlas-vX.Y.Z-AAAA-MM-JJ.html index.html` (toujours identiques).
4. `python -m pytest` vert (`tests/js/viewer_pure.mjs` lit le dernier fichier versionné de la racine).
5. Vérifier dans le navigateur (console sans erreur, largeurs 1440 / 800 / 375 px).
6. Rapport `docs/rapports/AAAA-MM-JJ-vX.Y.Z-rapport-de-version.md` (+ page Notion, comme d'habitude) ;
   mettre à jour `docs/TECHNIQUE.md` et les README si l'usage change.
7. Commit `QuickerAtlas vX.Y.Z : résumé` ; **push seulement sur demande explicite** (Pages se met à jour en ~1 min).

## Pièges connus

- Le navigateur garde `data/*.js` en cache : `await fetch('data/x.js',{cache:'reload'})` puis recharger avec `?r=N`.
- Fonds Plan Québec et OSM exigent un Referer : absents en `file://`.
- Québec 511 (caméras) est derrière Cloudflare : Chrome sans interface et les requêtes de script reçoivent un 403 ;
  la vidéo des caméras ne se vérifie que dans un vrai navigateur. Laptop du travail (2026-11-04) : vidéo OK dans Edge,
  refusée dans Firefox → hypothèse : cookies isolés par site dans Firefox + Cloudflare (voir rapport v0.6.9), pas le filtre web. Habitats fauniques du MRNF : 403 dès qu'un en-tête
  Origin est présent → précalcul ETL (`etl/environnement.py`), pas de requête depuis la page.
- Serveurs fragiles : AQréseau+/MRNF coupent `requests` (curl ou urllib) ; Overpass limité (4 requêtes/IP, souvent
  lent : l'atlas abandonne à 7 s) ; Openverse ~20 s/requête ; MELCCFP parfois hors service.
- OData : DJMA de 1 = « ND » ; IES/IFS vides ; pas de sens du biais.
- Débits : le n° d'une section vient de son RTSS seulement ; les bretelles ne reçoivent pas le DJMA de l'autoroute.
- Photos Wikipédia : correspondances automatiques peu fiables → règle stricte + `PHOTOS_CHOISIES` vérifiées à la main.
- Heredocs du shell Windows : accents abîmés → écrire les scripts d'édition avec un outil d'écriture de fichier.
- Session infonuagique : Overpass, cdnjs et les serveurs du MTMD sont injoignables ; RNCan (WCS, WMS CanVec) et Esri répondent si leurs hôtes sont permis. Pour un essai au navigateur, servir Leaflet en local (voir rapport v0.7.4).
- Le texte d'une demande peut citer un mauvais n° de structure : se fier aux captures d'écran.
- Vue pleine largeur (`body.view-x3d`) : sa règle de grille doit battre `.workspace:not(.no-filters)` des largeurs ≤ 1100 px et ≥ 1500 px, sinon la vue reste dans la colonne des filtres et sa carte fait 0 px de large (carte absente de la v0.7.4 sur certains écrans). Tester à 1024 et 1600 px, pas seulement 1440 / 800 / 375.
- Export d'image Esri : au-delà de 1 400 px de côté, demander en dalles parallèles (`imageTiles` de `js/bloc3d.js`) : 2 400 px d'un seul tenant prennent 25 s, en dalles 3 s.
- Essai de l'envoi vers une fenêtre BridgeSketch 3D déjà ouverte : les deux applis doivent avoir la même origine (servir le dossier parent : `python -m http.server 8770 --directory ..`).
- Orthophotos ouvertes (v0.7.6) : le WMS Imagerie du MERN renvoie un PNG transparent de 5 631 octets hors couverture (le rectangle des capacités ment : sonder l'image) ; 4 000 px au plus par requête (dalles de 2 000 px) ; les couches « Telechargement_imagerie » dupliquent celles des partenaires ; GéoMont 2020 (CC BY-NC) et CMQ 2021 (CC BY-NC-SA) sont écartées ; GéoMont refuse le User-Agent de `urllib` (403), pas celui d'un navigateur ni de curl. Un PNG d'orthophoto pèse ≈ 2 octets par pixel : au-delà de ≈ 12 millions de pixels, JPEG 0,98.
