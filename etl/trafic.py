"""Couche « Débits de circulation » de la carte (v0.6.8) : toutes les sections de trafic du MTMD, colorées selon leur
DJMA le plus récent, comme la carte des débits du MTMD, avec la valeur écrite sur le tronçon.

Source : WFS `ms:circulation_routier` (jeu « Débit de circulation », Données Québec, CC BY 4.0), le même fichier que
`etl/debits.py` (`data/raw/debits_circulation.geojson`, téléchargé par `debits.run` ou ici s'il manque). Contrairement
aux débits de la fiche, aucun appariement aux structures : la couche n'a pas besoin de la base.

Classes : celles de la légende officielle du WMS du MTMD (couche `circulation_routier`, GetStyles du 2026-11-03) :
1–4 999, 5 000–9 999, 10 000–24 999, 25 000–49 999, 50 000–99 999, 100 000 et + ; « non disponible » à part.
Couleurs : mêmes teintes et même ordre que le MTMD (vert clair, vert, jaune, orange, rouge, bordeaux), clarté
ajustée pour rester distinctes en deutéranopie et protanopie (ΔE ≥ 15 entre deux classes ; palette du MTMD : 9) ;
le codage est doublé par l'épaisseur du trait et par le DJMA écrit sur la carte. Liseré foncé sous le trait (comme le
trait noir du MTMD) : les classes restent lisibles sur les routes jaunes et orange du fond de carte.

Sortie `data/couche-trafic.js` :

    window.PQ_COUCHES.trafic = {"generated", "source", "attribution", "annee": 2025, "classes": [{label, min, color, weight}, …],
      "sections": [[n° de section, début, fin, djma|null, année|null, djme|null, djmh|null, % camions|null], …],
      "lines": [[classe, i_section, drapeau, lat0, lon0, dlat1, dlon1, …], …]}

`drapeau` : bit 1 = DJMA d'une année antérieure à `annee` (tracé en tirets), bit 2 = partie qui porte l'étiquette du
DJMA (la plus longue de la section). Usage : python -m etl.trafic [--fetch]
"""
import argparse
import json
import logging
import math
import sys
from datetime import date

from . import debits, net
from .config import DATA_DIR, RAW_DIR
from .reseaux import ECHELLE, encoder_ligne, fusionner, quantifier, simplifier

log = logging.getLogger("etl.trafic")

OUT = DATA_DIR / "couche-trafic.js"
RAW = RAW_DIR / debits.RAW_NAME
TOLERANCE_M = 15.0
ATTRIBUTION = "Débits de circulation : MTMD, Données Québec (CC BY 4.0)"
PAGE = "https://www.donneesquebec.ca/recherche/dataset/debit-de-circulation"
# Bornes inférieures des classes du MTMD ; dernière classe = DJMA non disponible
CLASSES = [
    {"label": "1 – 4 999", "min": 1, "color": "#b8e186", "weight": 2.5},
    {"label": "5 000 – 9 999", "min": 5000, "color": "#2e7d32", "weight": 3},
    {"label": "10 000 – 24 999", "min": 10000, "color": "#fde047", "weight": 3.5},
    {"label": "25 000 – 49 999", "min": 25000, "color": "#f39200", "weight": 4},
    {"label": "50 000 – 99 999", "min": 50000, "color": "#c62828", "weight": 5},
    {"label": "100 000 et +", "min": 100000, "color": "#4a0f2e", "weight": 6},
    {"label": "Non disponible", "min": None, "color": "#9aa0a6", "weight": 1.5},
]
ND = len(CLASSES) - 1


def classe(djma: float | None) -> int:
    if djma is None:
        return ND
    k = 0
    for i, c in enumerate(CLASSES[:ND]):
        if djma >= c["min"]:
            k = i
    return k


def plus_recent(serie: dict[int, float]) -> tuple[int | None, float | None]:
    """{année: valeur} → (année la plus récente, valeur) ; (None, None) si vide."""
    if not serie:
        return None, None
    a = max(serie)
    return a, serie[a]


def _longueur(pts: list[tuple[int, int]]) -> float:
    if len(pts) < 2:
        return 0.0
    k = math.cos(math.radians(pts[0][0] / ECHELLE))
    return sum(math.hypot(b[0] - a[0], (b[1] - a[1]) * k) for a, b in zip(pts, pts[1:]))


def construire(sections: list[dict], tol_m: float = TOLERANCE_M) -> dict:
    annee_ref = max((a for s in sections for a in s["series"]["djma"]), default=None)
    out_sections, lignes = [], []
    for s in sections:
        parties = [p for p in (quantifier(l) for l in s["lignes"]) if len(p) >= 2]
        if not parties:
            continue
        a, djma = plus_recent(s["series"]["djma"])
        se = s["series"]
        i = len(out_sections)
        out_sections.append([s["num"], s["de"], s["a"], debits._compact(djma), a,
                             debits._compact(se["djme"].get(a)) if a else None,
                             debits._compact(se["djmh"].get(a)) if a else None,
                             debits._compact(se["cam"].get(a), 1) if a else None])
        c = classe(djma)
        ancien = 1 if a is not None and annee_ref is not None and a < annee_ref else 0
        jointes = [pts for _, pts in fusionner({j: ((c, i, 0), p) for j, p in enumerate(parties)})]
        jointes = [simplifier(p, tol_m) for p in jointes]
        jointes = [p for p in jointes if len(p) >= 2]
        if not jointes:
            continue
        la_plus_longue = max(range(len(jointes)), key=lambda j: _longueur(jointes[j]))
        for j, p in enumerate(jointes):
            lignes.append((c, i, ancien | (2 if j == la_plus_longue else 0), p))
    lignes.sort(key=lambda x: (x[0] != ND, x[0]))      # « non disponible » d'abord (dessous), gros débits au-dessus
    return {"annee": annee_ref, "classes": CLASSES, "sections": out_sections,
            "lines": [encoder_ligne(*x) for x in lignes]}


def run(fetch: bool = False) -> dict:
    """`fetch` : retélécharger le GeoJSON même s'il est déjà dans data/raw/ (sinon : téléchargé seulement s'il manque)."""
    if fetch or not RAW.exists():
        r = net.get(net.session(), debits.URL, timeout=600)
        net.save_raw(debits.RAW_NAME, r.content)
    sections = debits.parse(RAW.read_bytes())
    if len(sections) < 3000:
        raise RuntimeError(f"débits : {len(sections)} sections lues (≈ 7 900 attendues)")
    payload = {"generated": date.today().isoformat(), "source": PAGE, "attribution": ATTRIBUTION, **construire(sections)}
    corps = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(f"window.PQ_COUCHES=window.PQ_COUCHES||{{}};window.PQ_COUCHES.trafic={corps};\n", encoding="utf-8", newline="\n")
    n = len(payload["sections"])
    nd = sum(1 for x in payload["sections"] if x[3] is None)
    log.info("trafic : %d sections (%d sans DJMA), %d lignes, année %s", n, nd, len(payload["lines"]), payload["annee"])
    return {"path": OUT, "bytes": OUT.stat().st_size, "rows": n, "sans_djma": nd, "annee": payload["annee"]}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m etl.trafic", description=__doc__.splitlines()[0])
    ap.add_argument("--fetch", action="store_true", help="retélécharger le GeoJSON des débits (sinon : data/raw/)")
    args = ap.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    r = run(fetch=args.fetch)
    print(f"{r['path']} : {r['rows']} sections ({r['sans_djma']} sans DJMA), année {r['annee']}, {r['bytes'] / 1e6:.2f} Mo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
