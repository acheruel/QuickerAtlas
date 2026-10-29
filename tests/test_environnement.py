"""Tests des habitats fauniques précalculés pour la fenêtre « Environnement » (v0.6.7)."""
import json
from pathlib import Path

from etl import environnement

FIX = Path(__file__).parent / "fixtures" / "habitats_extrait.geojson"


def _decoder(a):
    """[lat0, lon0, dlat1, dlon1, …] → [(lat, lon)…] entiers."""
    pts, lat, lon = [], 0, 0
    for i in range(0, len(a), 2):
        lat += a[i]; lon += a[i + 1]
        pts.append((lat, lon))
    return pts


def test_parse_extrait_reel():
    r = environnement.parse([json.loads(FIX.read_text(encoding="utf-8"))])
    hab = r["habitats"]
    assert len(hab) == 3
    cats = [r["categories"][h[0]] for h in hab]
    assert cats[0] == "Héronnière" and cats[1] == "Habitat du rat musqué" and cats[2] == "Habitat du poisson (Sans publication)"
    assert r["especes"][hab[0][1]] == "GRAND HÉRON, BIHOREAU GRIS, GRANDE AIGRETTE"
    assert [h[3] for h in hab] == [0, 1, 0]                       # légal, informationnel, légal
    assert hab[0][4] == 89.9 and hab[0][7] == "03-15-0425"
    # contour simplifié mais réel ; boîte = étendue des sommets de tous les anneaux
    pts = [p for a in hab[0][9] for p in _decoder(a)]
    assert 3 <= len(pts) < 756
    s, w, n, e = hab[0][8]
    assert s == min(p[0] for p in pts) and e == max(p[1] for p in pts) and s < n and w < e
    # « sans publication » : le point publié est gardé (anneau d'un seul sommet), espèce « Toutes espèces »
    assert len(hab[2][9]) == 1 and len(hab[2][9][0]) == 2


def test_simplifier_anneau_retire_les_points_alignes():
    carre = [[-72 + i / 100, 46.0] for i in range(11)] + [[-71.9, 46 + i / 100] for i in range(1, 11)] + \
            [[-71.9 - i / 100, 46.1] for i in range(1, 11)] + [[-72.0, 46.1 - i / 100] for i in range(1, 11)]
    a = environnement.simplifier_anneau(carre)
    assert sorted(a) == sorted([(4600000, -7200000), (4600000, -7190000), (4610000, -7190000), (4610000, -7200000)])


def test_encoder_deltas():
    assert environnement.encoder([(10, 20), (13, 18), (13, 25)]) == [10, 20, 3, -2, 0, 7]
    assert _decoder(environnement.encoder([(10, 20), (13, 18)])) == [(10, 20), (13, 18)]


def test_aire_ha_ordre_de_grandeur():
    # 0,01° × 0,01° à 46° N ≈ 1 113 m × 773 m ≈ 86 ha
    assert 80 < environnement.aire_ha([(46.0, -72.0), (46.0, -71.99), (46.01, -71.99), (46.01, -72.0)]) < 92
