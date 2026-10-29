"""Habitats fauniques du MRNF pour la fenêtre « Environnement » (module js/environnement.js, v0.6.7).

Pourquoi un précalcul : le GeoServer du MRNF qui publie les habitats fauniques (`Habitat_legal`,
`Habitat_informationnel`, jeu « Habitats fauniques » de Données Québec, CC BY 4.0) répond 403 à toute requête qui
porte un en-tête Origin, donc à toute requête de navigateur venue de l'atlas. Les autres thèmes de la fenêtre
(aires protégées, espèces en situation précaire, milieux humides…) sont interrogés en direct par le navigateur.

On télécharge les deux couches entières (WFS GeoJSON, ≈ 45 Mo, 2 671 habitats), on simplifie les contours
(Douglas-Peucker, tolérance TOL_M) et on quantifie à 1e-5 degré (≈ 1 m). On y joint les fiches de Données Québec
(titre, licence, date de mise à jour, adresse) des jeux interrogés par la fenêtre : c'est la colonne « source ».

Le serveur du MRNF coupe les connexions TLS du client `requests` : téléchargement par urllib (User-Agent identifié,
délai par hôte de etl/net.py).

Sortie : `data/couche-environnement.js` :

    window.PQ_COUCHES.environnement = {"generated", "source", "attribution", "echelle": 100000, "tolerance_m",
      "categories": ["Héronnière", …], "especes": ["GRAND HÉRON", …],
      "habitats": [[cat, esp|null, nom|null, info (0/1), sup_ha|null, annee|null, vigueur|null, no,
                    [lat_min, lon_min, lat_max, lon_max], [[lat0, lon0, dlat1, dlon1, …], …]], …],
      "jeux": {"slug": {"titre", "licence", "maj", "url"}, …}}

Boîte et anneaux en entiers (degrés × 1e5) ; anneaux : première paire absolue, suivantes en deltas (comme les
réseaux), sans point de fermeture. `info` = 1 pour un habitat informationnel (sans protection légale propre).

Usage : python -m etl.environnement [--no-fetch]
"""
import argparse
import json
import logging
import math
import re
import sys
import urllib.parse
import urllib.request
from datetime import date

from . import net
from .config import DATA_DIR, RAW_DIR
from .reseaux import douglas_peucker

log = logging.getLogger("etl.environnement")

GEOSERVER = "https://servicesvecto3.mern.gouv.qc.ca/geoserver/Habitats_Fauniques_Pub/{couche}/ows"
COUCHES = ("Habitat_legal", "Habitat_informationnel")
PAGE = "https://www.donneesquebec.ca/recherche/dataset/habitats-fauniques"
ATTRIBUTION = "Habitats fauniques : MRNF, Données Québec (CC BY 4.0)"
CKAN = "https://www.donneesquebec.ca/recherche/api/3/action/package_show?id="
# Jeux de Données Québec cités par la fenêtre (identifiants CKAN)
JEUX = ("habitats-fauniques", "aires-protegees-au-quebec", "habitats-floristiques", "occurrences-especes-en-situation-precaire",
        "milieux-humides-du-quebec", "milieux-humides-potentiels", "especes-exotiques-envahissantes",
        "base-de-donnees-des-zones-inondables")
OUT = DATA_DIR / "couche-environnement.js"
ECHELLE = 100_000                   # 1e-5 degré ≈ 1 m
TOL_M = 12.0                        # simplification : la fenêtre affiche des rayons de 1 à 5 km
M_PAR_DEGRE = 111_320
AIRE_MIN_HA = 0.05                  # îlots plus petits omis (on garde toujours le plus grand anneau)
PAGE_WFS = 1000
# Le GeoServer coupe aussi les clients qui n'ont pas l'air d'un navigateur : préfixe « Mozilla », identité gardée
UA = "Mozilla/5.0 (compatible) " + net.USER_AGENT


def _get(url: str, timeout: float = 300) -> bytes:
    net.wait(url)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _raw(couche: str):
    return RAW_DIR / f"habitats_{couche}.geojson"


def telecharger(couche: str) -> dict:
    """Toutes les entités d'une couche, par pages de PAGE_WFS (triées : pagination stable)."""
    feats, debut = [], 0
    while True:
        q = {"service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeNames": "Habitats_Fauniques_Pub:" + couche,
             "outputFormat": "application/json", "srsName": "EPSG:4326", "count": PAGE_WFS, "startIndex": debut, "sortBy": "NO_HABITAT"}
        page = json.loads(_get(GEOSERVER.format(couche=couche) + "?" + urllib.parse.urlencode(q)))["features"]
        feats += page
        if len(page) < PAGE_WFS:
            return {"type": "FeatureCollection", "features": feats}
        debut += PAGE_WFS


def _anneaux(geom: dict | None):
    if not geom:
        return
    if geom["type"] == "Polygon":
        yield from geom["coordinates"]
    elif geom["type"] == "MultiPolygon":
        for poly in geom["coordinates"]:
            yield from poly


def aire_ha(pts: list[tuple[float, float]]) -> float:
    """Aire approchée d'un anneau [(lat, lon)…] en hectares (formule du lacet, longitude corrigée par cos(latitude))."""
    if len(pts) < 3:
        return 0.0
    k = math.cos(math.radians(sum(p[0] for p in pts) / len(pts)))
    s = sum(pts[i - 1][1] * pts[i][0] - pts[i][1] * pts[i - 1][0] for i in range(len(pts)))
    return abs(s) / 2 * k * M_PAR_DEGRE ** 2 / 1e4


def simplifier_anneau(coords, tol_m: float = TOL_M) -> list[tuple[int, int]]:
    """[[lon, lat]…] (fermé) → [(lat_e5, lon_e5)…] simplifié, sans le point de fermeture ; [] si dégénéré."""
    pts = [(lat, lon) for lon, lat in coords]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 3:
        return []
    k = math.cos(math.radians(sum(p[0] for p in pts) / len(pts)))
    # anneau fermé : coupé au point le plus éloigné du premier, pour que DP garde la forme (comme etl/degel.py)
    loin = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + ((pts[i][1] - pts[0][1]) * k) ** 2)
    out = []
    for morceau in (pts[:loin + 1], pts[loin:] + [pts[0]]):
        plan = [(la, lo * k) for la, lo in morceau]
        garde = set(map(id, douglas_peucker(plan, tol_m / M_PAR_DEGRE)))
        out += [morceau[i] for i, q in enumerate(plan) if id(q) in garde][:-1]
    q: list[tuple[int, int]] = []
    for la, lo in out:
        p = (round(la * ECHELLE), round(lo * ECHELLE))
        if not q or q[-1] != p:
            q.append(p)
    return q if len(q) >= 3 else []


def encoder(anneau: list[tuple[int, int]]) -> list[int]:
    """[(lat, lon)…] entiers → [lat0, lon0, dlat1, dlon1, …]."""
    out = [anneau[0][0], anneau[0][1]]
    for (a, b), (c, d) in zip(anneau, anneau[1:]):
        out += [c - a, d - b]
    return out


def _texte(v) -> str | None:
    v = re.sub(r"\s+", " ", str(v or "")).strip()
    return v or None


def _date(v) -> str | None:
    m = re.match(r"(\d{4}-\d{2}-\d{2})", str(v or ""))
    return m.group(1) if m else None


def parse(geojsons: list[dict]) -> dict:
    """GeoJSON des deux couches → {categories, especes, habitats} (format compact du module ; doublons écartés)."""
    cats: dict[str, int] = {}
    esps: dict[str, int] = {}
    habitats, vus = [], set()
    for gj in geojsons:
        for f in gj.get("features", []):
            p = f.get("properties") or {}
            cle = (p.get("NO_HABITAT"), p.get("HFA_NO_SEQ"))
            if cle in vus:
                continue
            vus.add(cle)
            bruts = [r for r in (simplifier_anneau(c) for c in _anneaux(f.get("geometry"))) if r]
            if bruts:
                aires = [aire_ha([(a / ECHELLE, b / ECHELLE) for a, b in r]) for r in bruts]
                grand = max(range(len(bruts)), key=lambda i: aires[i])
                anneaux = [r for i, r in enumerate(bruts) if i == grand or aires[i] >= AIRE_MIN_HA]
            else:
                # « Habitat du poisson (Sans publication) » : le MRNF ne publie qu'un point (contour de 0 m) ; on le garde
                # comme anneau d'un seul point, que le module dessine en repère
                pts = [(lat, lon) for c in _anneaux(f.get("geometry")) for lon, lat in c]
                if not pts:
                    continue
                anneaux = [[(round(sum(a for a, _ in pts) / len(pts) * ECHELLE), round(sum(b for _, b in pts) / len(pts) * ECHELLE))]]
            lats = [a for r in anneaux for a, _ in r]
            lons = [b for r in anneaux for _, b in r]
            cat = _texte(p.get("CATEGORIE")) or "Habitat faunique"
            esp = _texte(p.get("ESPECE"))
            if esp and esp.upper() in ("NA", "N/A", "ND"):
                esp = None
            sup = p.get("SUP_HA")
            habitats.append([
                cats.setdefault(cat, len(cats)), esps.setdefault(esp, len(esps)) if esp else None, _texte(p.get("TOPONYME")),
                1 if re.search(r"informationnel", str(p.get("STATUT") or ""), re.I) else 0,
                round(float(sup), 2) if isinstance(sup, (int, float)) else None,
                p.get("ANNEE_INV") if isinstance(p.get("ANNEE_INV"), int) else None,
                _date(p.get("DA_ENT_VIG")), _texte(p.get("NO_HABITAT")),
                [min(lats), min(lons), max(lats), max(lons)], [encoder(r) for r in anneaux]])
    return {"categories": list(cats), "especes": list(esps), "habitats": habitats}


def fiches_jeux(fetch: bool) -> dict:
    """Fiches CKAN (titre, licence, date) des jeux cités ; à défaut, l'adresse de la page seulement."""
    brut = RAW_DIR / "environnement_jeux.json"
    jeux = json.loads(brut.read_text(encoding="utf-8")) if brut.exists() else {}
    if fetch:
        for slug in JEUX:
            try:
                r = json.loads(_get(CKAN + slug, timeout=60))["result"]
                jeux[slug] = {"titre": r.get("title"), "licence": r.get("license_title"), "maj": (r.get("metadata_modified") or "")[:10] or None}
            except Exception as e:  # noqa: BLE001 — une fiche manquante n'empêche pas la couche
                log.warning("fiche %s indisponible : %s", slug, e)
        brut.parent.mkdir(parents=True, exist_ok=True)
        brut.write_text(json.dumps(jeux, ensure_ascii=False, indent=1), encoding="utf-8")
    return {slug: dict(jeux.get(slug) or {}, url="https://www.donneesquebec.ca/recherche/dataset/" + slug) for slug in JEUX}


def run(fetch: bool = True) -> dict:
    if fetch:
        for c in COUCHES:
            gj = telecharger(c)
            _raw(c).parent.mkdir(parents=True, exist_ok=True)
            _raw(c).write_text(json.dumps(gj, ensure_ascii=False), encoding="utf-8")
    res = parse([json.loads(_raw(c).read_text(encoding="utf-8")) for c in COUCHES])
    if len(res["habitats"]) < 1000:
        raise RuntimeError(f"habitats fauniques : {len(res['habitats'])} lus (≈ 2 600 attendus)")
    payload = {"generated": date.today().isoformat(), "source": PAGE, "attribution": ATTRIBUTION, "echelle": ECHELLE,
               "tolerance_m": TOL_M, **res, "jeux": fiches_jeux(fetch)}
    corps = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(f"window.PQ_COUCHES=window.PQ_COUCHES||{{}};window.PQ_COUCHES.environnement={corps};\n", encoding="utf-8", newline="\n")
    return {"path": OUT, "bytes": OUT.stat().st_size, "rows": len(res["habitats"]),
            "points": sum(len(a) // 2 for h in res["habitats"] for a in h[9])}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m etl.environnement", description=__doc__.splitlines()[0])
    ap.add_argument("--no-fetch", action="store_true", help="relit data/raw/habitats_*.geojson au lieu de télécharger")
    args = ap.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    r = run(fetch=not args.no_fetch)
    print(f"{r['path']} : {r['rows']} habitats, {r['points']} sommets, {r['bytes'] / 1e6:.2f} Mo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
