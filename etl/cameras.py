"""Caméras de circulation du MTMD (Québec 511) : position et nom de chaque caméra, pour la couche « Caméras » (v0.6.7).

Source de la liste : WFS du MTMD (couche `ms:infos_cameras`, jeu « Caméra de circulation » de Données Québec,
CC BY 4.0, mis à jour chaque jour), en WGS 84 : ≈ 680 caméras.

Les images ne sont PAS téléchargées : le visualiseur les affiche en direct depuis le serveur de Québec 511, au survol
seulement (aucun enregistrement). Adresses (vérifiées le 2026-10-29) :
  - vidéo : boucle MP4 de ≈ 5 s des dernières images, `…/Carte/Fenetres/camera.ashx?id=<IDEcamera>&format=mp4`
    (Québec 511 renvoie une vidéo « séquence non disponible » quand la caméra est muette) ;
  - image fixe : `…/Images/Cameras/<Ville>/cam/<n°>.jpg` (n° sans sa lettre ; Q = Quebec, M = Montreal,
    T = TroisRivieres, G = Gatineau) ; caméra hors service : Québec 511 y met son image « Cette image n'est pas
    disponible en ce moment » ;
  - carte de Québec 511 centrée sur un point : `…/fr/Carte/Default.aspx?lat=<lat>&lng=<lon>&zoom=16`.
Les balises <video> et <img> n'ont besoin ni de CORS ni d'en-tête Referer.

Sortie : `data/couche-cameras.js` :

    window.PQ_COUCHES.cameras = {"generated", "source", "attribution", "conditions", "video", "image", "carte",
      "villes": {"Q": "Quebec", …}, "regions": ["Montréal", …],
      "cameras": [[lat_e5, lon_e5, ide, "Q5413", "Aut. 540 (direction ouest) à la hauteur…", route|null, region, pont|null], …]}

`video`, `image`, `carte` : gabarits ({id}, {ville}, {n}, {lat}, {lon}). Usage : python -m etl.cameras [--no-fetch]
"""
import argparse
import json
import logging
import re
import sys
from datetime import date

from . import net
from .config import DATA_DIR, RAW_DIR, WFS_BASE

log = logging.getLogger("etl.cameras")

URL = (f"{WFS_BASE}?service=wfs&version=2.0.0&request=getfeature&typename=ms:infos_cameras"
       "&srsname=EPSG:4326&outputformat=geojson")
PAGE = "https://www.donneesquebec.ca/recherche/dataset/camera-de-circulation"
ATTRIBUTION = "Caméras : MTMD, Données Québec (CC BY 4.0) · images en direct © Québec 511"
CONDITIONS = "https://www.quebec511.info/fr/basdepage/Utilisation.aspx"
Q511 = "https://www.quebec511.info"
GABARITS = {"video": Q511 + "/Carte/Fenetres/camera.ashx?id={id}&format=mp4",
            "image": Q511 + "/Images/Cameras/{ville}/cam/{n}.jpg",
            "carte": Q511 + "/fr/Carte/Default.aspx?lat={lat}&lng={lon}&zoom=16"}
VILLES = {"Q": "Quebec", "M": "Montreal", "T": "TroisRivieres", "G": "Gatineau"}
RAW = RAW_DIR / "infos_cameras.geojson"
OUT = DATA_DIR / "couche-cameras.js"
ECHELLE = 100_000


def _texte(v) -> str | None:
    v = re.sub(r"\s+", " ", str(v or "")).strip()
    return v or None


def parse(geojson: dict) -> dict:
    """GeoJSON du WFS → {regions, cameras} (une caméra sans position ou sans identifiant est écartée)."""
    regions: dict[str, int] = {}
    cams, vus = [], set()
    for f in geojson.get("features", []):
        p = f.get("properties") or {}
        g = f.get("geometry") or {}
        ide = str(p.get("IDEcamera") or "").strip()
        if g.get("type") != "Point" or not ide.isdigit() or ide in vus:
            continue
        vus.add(ide)
        lon, lat = g["coordinates"][:2]
        route = re.sub(r"^0+", "", str(p.get("NumeroRoute") or "")) or None
        reg = _texte(p.get("NomRegionDiffusion")) or "Non précisée"
        cams.append([round(lat * ECHELLE), round(lon * ECHELLE), int(ide), _texte(p.get("NumeroCamera")),
                     _texte(p.get("DescriptionLocalisationFr")) or "Caméra " + ide,
                     int(route) if route and route.isdigit() else None, regions.setdefault(reg, len(regions)),
                     _texte(p.get("NomPontFrontalier"))])
    cams.sort(key=lambda c: c[2])
    return {"regions": list(regions), "cameras": cams}


def image_url(numero: str | None) -> str | None:
    """Image fixe d'une caméra d'après son n° (« Q5413 » → …/Quebec/cam/5413.jpg) ; None si la ville est inconnue."""
    m = re.match(r"^([A-Z])(\d+)$", numero or "")
    if not m or m.group(1) not in VILLES:
        return None
    return GABARITS["image"].format(ville=VILLES[m.group(1)], n=m.group(2))


def run(fetch: bool = True) -> dict:
    if fetch:
        r = net.get(net.session(), URL, timeout=120)
        RAW.parent.mkdir(parents=True, exist_ok=True)
        RAW.write_bytes(r.content)
    res = parse(json.loads(RAW.read_bytes().decode("utf-8")))
    if len(res["cameras"]) < 300:
        raise RuntimeError(f"caméras : {len(res['cameras'])} lues (≈ 680 attendues)")
    payload = {"generated": date.today().isoformat(), "source": PAGE, "attribution": ATTRIBUTION, "conditions": CONDITIONS,
               **GABARITS, "villes": VILLES, "echelle": ECHELLE, **res}
    corps = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(f"window.PQ_COUCHES=window.PQ_COUCHES||{{}};window.PQ_COUCHES.cameras={corps};\n", encoding="utf-8", newline="\n")
    return {"path": OUT, "bytes": OUT.stat().st_size, "rows": len(res["cameras"])}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m etl.cameras", description=__doc__.splitlines()[0])
    ap.add_argument("--no-fetch", action="store_true", help="relit data/raw/infos_cameras.geojson au lieu de télécharger")
    args = ap.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    r = run(fetch=not args.no_fetch)
    print(f"{r['path']} : {r['rows']} caméras, {r['bytes'] / 1e3:.0f} Ko")
    return 0


if __name__ == "__main__":
    sys.exit(main())
