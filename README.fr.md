# QuickerAtlas — l’atlas des ponts du Québec

*[English version](README.md)*

**[▶ Ouvrir l’atlas](https://acheruel.github.io/QuickerAtlas/)** — gratuit, sans compte, dans le navigateur.

![Carte de QuickerAtlas](docs/capture.jpg)

QuickerAtlas affiche sur une carte les **≈ 11 700 ouvrages d’art** du ministère des Transports et de la Mobilité
durable du Québec (MTMD) : ponts, ponceaux, murs et tunnels. Il reprend l’inventaire public du Ministère et le rend
plus rapide à explorer.

## Ce que vous pouvez faire

- **Chercher et filtrer** : par nom, route, cours d’eau, municipalité, région, type de pont, année, longueur,
  état (ICG), restrictions (IAS), limitation de poids ou de hauteur. Plusieurs structures à la fois : collez une liste
  de numéros (ou tapez-les, séparés par des virgules), chacun devient une étiquette.
- **Lire la fiche d’un ouvrage** : photo, dimensions, état, dernière inspection, trafic, repère kilométrique le plus
  proche (ou les deux repères qui l’encadrent), liens vers la fiche et le
  rapport d’inspection officiels du MTMD, et vers Wikipédia pour environ 160 ponts connus.
- **Exporter** les structures filtrées avec le bouton « Exporter » (s’ouvre au survol) : CSV (tableur), KMZ (Google
  Earth), GeoJSON (SIG) ou **fiches PDF** (une fiche imprimable par ouvrage : photo, carte de situation, état, liens
  vers la fiche d’inventaire du MTMD ; plusieurs fiches arrivent en .zip).
- **Changer de point de vue** avec la barre d’onglets : carte, liste, statistiques cliquables
  (rangées en cinq catégories : vue d’ensemble, régions, âge, caractéristiques, suivi et trafic), galerie (une structure
  à la fois, en photo), « Quoi de neuf » (changements entre les mises à jour et inspections récentes), ou
  **ponts remarquables** : les ouvrages du MTMD qui ont un article Wikipédia (avec sa photo), puis les ponts du Canada
  hors inventaire (étoiles dorées sur la carte, hors filtres et statistiques).
- **Ajouter des couches** : réseau routier et ferroviaire, cours d’eau, sondages géotechniques, aléa sismique et
  classes de site, zones de dégel du MTMD, **débits de circulation** (DJMA de tout le réseau, comme la carte du MTMD), repères
  kilométriques, **caméras de circulation de Québec 511** (vidéo en direct au survol), autres
  ponts hors MTMD (forestiers, municipaux…), ouvrages des villes de Montréal et Sherbrooke. Le bouton **Masquer**, sous « Couches », cache tous les points pour lire une couche seule.
- **Outils d’ingénierie** (dans la fiche) : profil LiDAR (hauteur sous l’ouvrage, pentes), cours d’eau et débits au
  pont, **environnement** (aires protégées, habitats fauniques et floristiques, espèces en situation précaire, milieux
  humides, zones inondables et espèces envahissantes à 1, 2 ou 5 km), aléa sismique du code national du bâtiment.
  **Climat futur** : températures et précipitations passées et futures à l’ouvrage (scénarios CMIP6 d’ECCC, référence
  1971-2000 ou 2021-2050).
- **Export vers Bridge Sketch 3D** (v0.7.2, v0.7.3) : le bouton **Export BS3D** (sous « Couches » ou dans une fiche)
  permet de tracer un rectangle de 1,5 km au plus, d’en extraire le relief LiDAR 1 m (sol et surface), l’image satellite
  et l’eau, les forêts, l’herbe et les routes d’OpenStreetMap (voies et sens unique conservés), de repérer cours d’eau,
  forêts et routes d’après les couleurs de l’image (zones regroupées par famille, à corriger, supprimer ou ajouter, herbe
  comprise ; axe du pont à placer), puis d’envoyer le bloc à BridgeSketch 3D, qui confirme chaque étape (envoyé → reçu
  et validé → appliqué), ou d’en faire un fichier `.bs3dterrain` (format : [docs/bs3d-terrain-v1.md](docs/bs3d-terrain-v1.md)).
  Le pont et les corrections de zones suivantes se règlent dans BridgeSketch 3D.

Chaque vue garde ses filtres dans l’adresse : copiez le lien pour partager exactement ce que vous voyez.

## D’où viennent les données ?

Uniquement de **données ouvertes** : inventaire des structures du MTMD et Données Québec (CC-BY 4.0), LiDAR de
Ressources naturelles Canada, OpenStreetMap, MRNF, CNBC 2020, Wikipédia (CC BY-SA) et Wikidata (CC0). Elles sont mises à jour toutes les deux semaines ; la date
figure en haut à droite de l’atlas.

> Projet personnel et indépendant, **non affilié au MTMD**, pour visualisation et apprentissage seulement : l’atlas
> le rappelle à chaque démarrage. Pour toute décision, la fiche officielle du Ministère et les normes en vigueur font
> foi. Ne pas utiliser pour la conception, la construction ou la gestion d’actifs.

---

Développeurs : mise à jour des données, sources et architecture dans [docs/TECHNIQUE.md](docs/TECHNIQUE.md).
Le dépôt s’appelait `QuickerAtlasOA` jusqu’en octobre 2026 : l’ancienne adresse web ne marche plus.
Auteur : Anthony Chéruel.
