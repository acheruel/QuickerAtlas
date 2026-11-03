"""Repères kilométriques du MTMD (Données Québec « repere-kilometrique », CC BY 4.0) et appariement aux structures
(v0.6.8) : pour chaque structure, le repère le plus proche sur la même route, ou les deux repères qui l'encadrent.

Source : WFS `ms:repere_km` (≈ 14 000 panneaux « km » posés en bordure de route), en CSV WGS 84. Champs utiles :
`norte` (n° de route, « 00020 »), `nomrte` (« autoroute Jean-Lesage »), `affichnb` (valeur du panneau, 208.0),
`direction` (« Est », « Ouest », « Nord-Sud »…), `vocation` (« Routière », « Récréative »…), `coordx`/`coordy`.
Dictionnaire : https://www.donneesquebec.ca/recherche/dataset/0e94f067-713a-4d3e-9f84-5d940ca65a04/resource/4a1188fe-d9a8-409a-9425-541e7ffd739d/download/repere_km_dictionnaire.pdf

Couverture : surtout les autoroutes et une partie des routes numérotées (≈ 110 routes) ; une structure loin de tout
repère de sa route n'a rien (« lorsqu'applicable »).

Règles d'appariement :
- route de la structure = n° de la voie portée (« Autoroute 20 Est » → 20, sens Est), sinon nom de la voie
  (« Chemin Fitzpatrick », routes locales numérotées ≥ 1000 par le MTMD), sinon n° de la route franchie
  (viaduc d'une route municipale au-dessus de l'A-40 : repère de l'A-40, marqué « route franchie ») ;
- bretelles, raccordements, chemins d'accès : aucune (les repères sont ceux des routes reliées) ;
- repère le plus proche à moins de RAYON_M ; sur une chaussée séparée, on préfère les repères du même sens ;
- entre deux repères : voisins immédiats (km juste avant / juste après, même sens) si la structure se projette entre
  eux à moins de ECART_M de la droite qui les relie et si l'écart de km est ≤ PAS_MAX_KM ; on estime alors le km
  par interpolation (ex. « entre km 208 et km 209, ≈ km 208,4 »).

Sortie `data/reperes.js` :

    window.PQ_REPERES = {"generated", "source", "attribution", "routes": ["Autoroute 20", …], "sens": ["Est", …],
      "items": {"<n° de structure>": [route, km_a, dist_a_m, km_b|null, km_estime|null, sens|null, franchie], …}}

v0.6.8 (2e partie) : couche « Repères kilométriques » de la carte, `data/couche-reperes.js` :

    window.PQ_COUCHES.reperes = {"generated", "source", "attribution", "noms": ["autoroute Félix-Leclerc", …],
      "sens": ["Est", …], "points": [[lat_e5, lon_e5, km × 10, nom, sens|null, n° de route|null], …]}

`km_a` = repère le plus proche (à `dist_a_m` mètres) ; `km_b` = l'autre repère qui encadre la structure ; `route` et
`sens` = index dans `routes` et `sens` ; `franchie` = 1 si le repère est celui de la route franchie.
Usage : python -m etl.reperes [--no-fetch]
"""
import argparse
import csv
import io
import json
import logging
import math
import re
import sqlite3
import sys
import unicodedata
from datetime import date

from . import net
from .config import DATA_DIR, DB_PATH, RAW_DIR, WFS_BASE
from .debits import _RE_BRETELLE, route_numbers

log = logging.getLogger("etl.reperes")

URL = (f"{WFS_BASE}?service=wfs&version=2.0.0&request=getfeature&typename=ms:repere_km"
       "&srsname=EPSG:4326&outputformat=csv")
PAGE = "https://www.donneesquebec.ca/recherche/dataset/repere-kilometrique"
ATTRIBUTION = "Repères kilométriques : MTMD, Données Québec (CC BY 4.0)"
RAW = RAW_DIR / "repere_km.csv"
OUT = DATA_DIR / "reperes.js"
OUT_COUCHE = DATA_DIR / "couche-reperes.js"

RAYON_M = 2500        # repère le plus proche retenu jusqu'à cette distance
ECART_M = 300         # distance max. de la structure à la droite qui relie deux repères voisins
PAS_MAX_KM = 5        # au-delà, deux repères ne sont pas « voisins » (trou dans la série)
M_PAR_DEG = 111_195.0
CELL = 0.05           # index spatial (degrés ≈ 5 km)
_RE_SENS = re.compile(r"\b(Nord|Sud|Est|Ouest)\s*$", re.I)


def _norm(nom: str | None) -> str:
    """Nom de voie comparable : minuscules, sans accents ni ponctuation (« Chemin Fitzpatrick » = « chemin fitzpatrick »)."""
    s = unicodedata.normalize("NFD", nom or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _sens(v: str | None) -> str | None:
    """« Est » → « Est » ; « Nord-Sud », « Est-Ouest », « Null », vide → None (chaussée non séparée ou inconnu)."""
    v = (v or "").strip().capitalize()
    return v if v in ("Nord", "Sud", "Est", "Ouest") else None


def parse(contenu: bytes) -> list[dict]:
    """CSV du WFS → repères routiers [{route, nom, cle, km, lat, lon, sens}] (pistes, motoneige, vélo écartés)."""
    out = []
    for r in csv.DictReader(io.StringIO(contenu.decode("utf-8-sig"))):
        if (r.get("vocation") or "").strip() != "Routière":
            continue
        try:
            km, lat, lon = float(r["affichnb"]), float(r["coordy"]), float(r["coordx"])
        except (TypeError, ValueError, KeyError):
            continue
        no = int(r["norte"]) if (r.get("norte") or "").strip().isdigit() else None
        nom = re.sub(r"\s+", " ", r.get("nomrte") or "").strip()
        # clé d'appariement : n° pour le réseau numéroté (< 1000), nom de la voie pour les routes locales
        cle = no if no and no < 1000 else ("nom", _norm(nom)) if nom else None
        if cle is None:
            continue
        out.append({"route": no, "nom": nom, "cle": cle, "km": km, "lat": lat, "lon": lon, "sens": _sens(r.get("direction"))})
    return out


def libelle(rep: dict) -> str:
    """Nom de la route d'un repère, tel qu'affiché dans la fiche."""
    n, nom = rep["route"], rep["nom"]
    if n and n < 1000:
        return f"{'Autoroute' if nom.lower().startswith('autoroute') else 'Route'} {n}"
    return nom[:1].upper() + nom[1:]


class Index:
    """Repères par clé de route, en grille de CELL degrés."""

    def __init__(self, reperes: list[dict]):
        self.cells: dict[tuple, list[dict]] = {}
        for r in reperes:
            self.cells.setdefault((r["cle"], int(r["lat"] // CELL), int(r["lon"] // CELL)), []).append(r)

    def autour(self, cle, lat: float, lon: float) -> list[dict]:
        i, j = int(lat // CELL), int(lon // CELL)
        return [r for di in (-1, 0, 1) for dj in (-1, 0, 1) for r in self.cells.get((cle, i + di, j + dj), ())]


def _xy(lat0: float, lon0: float, lat: float, lon: float) -> tuple[float, float]:
    return (lon - lon0) * M_PAR_DEG * math.cos(math.radians(lat0)), (lat - lat0) * M_PAR_DEG


def cles_structure(route: str | None, obstacle: str | None) -> list[tuple]:
    """Clés de route à essayer, dans l'ordre : [(clé, sens, franchie)]."""
    out = []
    if route and not _RE_BRETELLE.search(route):
        m = _RE_SENS.search(route)
        sens = m.group(1).capitalize() if m else None
        nums = route_numbers(route)
        if nums:
            out.append((nums[0], sens, 0))
        elif _norm(route):
            out.append((("nom", _norm(route)), None, 0))
    if obstacle and not _RE_BRETELLE.search(obstacle):
        m = _RE_SENS.search(obstacle)
        for n in route_numbers(obstacle)[:1]:
            if not any(c[0] == n for c in out):
                out.append((n, m.group(1).capitalize() if m else None, 1))
    return out


def apparier(index: Index, lat: float, lon: float, route: str | None, obstacle: str | None):
    """→ (repère A, distance A en m, repère B | None, km estimé | None, franchie) ou None."""
    for cle, sens, franchie in cles_structure(route, obstacle):
        proches = []
        for r in index.autour(cle, lat, lon):
            x, y = _xy(lat, lon, r["lat"], r["lon"])
            d = math.hypot(x, y)
            if d <= RAYON_M:
                proches.append((d, r, x, y))
        if not proches:
            continue
        if sens and any(p[1]["sens"] == sens for p in proches):      # chaussée séparée : même sens d'abord
            proches = [p for p in proches if p[1]["sens"] in (sens, None)]
        proches.sort(key=lambda p: p[0])
        da, a, ax, ay = proches[0]
        meme = [p for p in proches if p[1]["sens"] == a["sens"]]
        avant = [p for p in meme if a["km"] - PAS_MAX_KM <= p[1]["km"] < a["km"]]
        apres = [p for p in meme if a["km"] < p[1]["km"] <= a["km"] + PAS_MAX_KM]
        voisins = []
        for groupe, plus_pres_km in ((avant, max), (apres, min)):
            if groupe:
                k = plus_pres_km(p[1]["km"] for p in groupe)       # km immédiatement voisin…
                voisins.append(min((p for p in groupe if p[1]["km"] == k), key=lambda p: p[0]))   # …le plus proche
        meilleur = None
        for _, b, bx, by in voisins:
            dx, dy = bx - ax, by - ay
            n2 = dx * dx + dy * dy
            if n2 == 0:
                continue
            t = (-ax * dx - ay * dy) / n2                        # projection de la structure (origine) sur A→B
            if not 0 <= t <= 1:
                continue
            ecart = abs(ax * dy - ay * dx) / math.sqrt(n2)
            if ecart <= ECART_M and (meilleur is None or ecart < meilleur[0]):
                meilleur = (ecart, b, a["km"] + t * (b["km"] - a["km"]))
        if meilleur:
            return a, da, meilleur[1], meilleur[2], franchie
        return a, da, None, None, franchie
    return None


def charger_structures() -> list[dict]:
    """Structures géolocalisées : base SQLite si elle est remplie, sinon `data/structures.js` (clone neuf)."""
    if DB_PATH.exists():
        conn = sqlite3.connect(DB_PATH.as_uri() + "?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        try:
            rows = [dict(r) for r in conn.execute(
                "SELECT num_dossr AS num, route, obstacle, lat, lon FROM structure "
                "WHERE lat IS NOT NULL AND lon IS NOT NULL ORDER BY num_dossr")]
        except sqlite3.Error:
            rows = []
        finally:
            conn.close()
        if rows:
            return rows
    txt = (DATA_DIR / "structures.js").read_text(encoding="utf-8")
    s = json.loads(txt[txt.index("=") + 1:].rstrip().rstrip(";"))
    c = {k: i for i, k in enumerate(s["cols"])}
    return [{"num": r[c["num"]], "route": r[c["route"]], "obstacle": r[c["obstacle"]], "lat": r[c["lat"]], "lon": r[c["lon"]]}
            for r in s["rows"] if r[c["lat"]] is not None and r[c["lon"]] is not None]


def construire(reperes: list[dict], structures: list[dict]) -> dict:
    index = Index(reperes)
    routes: dict[str, int] = {}
    sens_l: dict[str, int] = {}
    items = {}
    for s in structures:
        m = apparier(index, s["lat"], s["lon"], s["route"], s["obstacle"])
        if not m:
            continue
        a, da, b, est, franchie = m
        items[s["num"]] = [routes.setdefault(libelle(a), len(routes)), a["km"], int(round(da)),
                           b["km"] if b else None, round(est, 1) if est is not None else None,
                           sens_l.setdefault(a["sens"], len(sens_l)) if a["sens"] else None, franchie]
    return {"routes": list(routes), "sens": list(sens_l), "items": items}


def couche(reperes: list[dict]) -> dict:
    """Points de la couche de la carte (repères routiers seulement), triés par route puis km."""
    noms: dict[str, int] = {}
    sens: dict[str, int] = {}
    pts = []
    for r in sorted(reperes, key=lambda r: (r["route"] or 0, r["nom"], r["km"])):
        pts.append([round(r["lat"] * 1e5), round(r["lon"] * 1e5), round(r["km"] * 10), noms.setdefault(r["nom"], len(noms)),
                    sens.setdefault(r["sens"], len(sens)) if r["sens"] else None, r["route"]])
    return {"noms": list(noms), "sens": list(sens), "points": pts}


def run(fetch: bool = True) -> dict:
    if fetch:
        r = net.get(net.session(), URL, timeout=300)
        net.save_raw(RAW.name, r.content)
    reperes = parse(RAW.read_bytes())
    if len(reperes) < 5000:
        raise RuntimeError(f"repères kilométriques : {len(reperes)} lus (≈ 13 500 attendus)")
    structures = charger_structures()
    res = construire(reperes, structures)
    payload = {"generated": date.today().isoformat(), "source": PAGE, "attribution": ATTRIBUTION, **res}
    corps = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(f"window.PQ_REPERES={corps};\n", encoding="utf-8", newline="\n")
    c = {"generated": payload["generated"], "source": PAGE, "attribution": ATTRIBUTION, **couche(reperes)}
    corps = json.dumps(c, ensure_ascii=False, separators=(",", ":"))
    OUT_COUCHE.write_text(f"window.PQ_COUCHES=window.PQ_COUCHES||{{}};window.PQ_COUCHES.reperes={corps};\n", encoding="utf-8", newline="\n")
    n = len(res["items"])
    entre = sum(1 for v in res["items"].values() if v[3] is not None)
    log.info("repères : %d lus, %d structures sur %d (%d entre deux repères)", len(reperes), n, len(structures), entre)
    return {"path": OUT, "bytes": OUT.stat().st_size, "rows": n, "structures": len(structures), "entre": entre}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m etl.reperes", description=__doc__.splitlines()[0])
    ap.add_argument("--no-fetch", action="store_true", help="relit data/raw/repere_km.csv au lieu de télécharger")
    args = ap.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    r = run(fetch=not args.no_fetch)
    print(f"{r['path']} : {r['rows']} structures sur {r['structures']} ({r['entre']} entre deux repères), "
          f"{r['bytes'] / 1e3:.0f} Ko")
    return 0


if __name__ == "__main__":
    sys.exit(main())
