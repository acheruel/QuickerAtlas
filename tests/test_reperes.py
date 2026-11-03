"""Tests des repères kilométriques (v0.6.8). Fixture : 14 lignes réelles du WFS `ms:repere_km` (2026-11-03)."""
from pathlib import Path

from etl import reperes

FIX = Path(__file__).parent / "fixtures" / "repere_km_extrait.csv"


def _index():
    return reperes.Index(reperes.parse(FIX.read_bytes()))


def test_parse_garde_les_reperes_routiers():
    r = reperes.parse(FIX.read_bytes())
    assert len(r) == 13                                              # le repère « Quad, Motoneige » est écarté
    a40 = [x for x in r if x["route"] == 40]
    assert len(a40) == 8 and {x["sens"] for x in a40} == {"Est", "Ouest"}
    assert reperes.libelle(a40[0]) == "Autoroute 40"
    r172 = next(x for x in r if x["route"] == 172)
    assert r172["sens"] is None and reperes.libelle(r172) == "Route 172"
    local = next(x for x in r if x["route"] == 39322)                # route locale : appariée par son nom
    assert local["cle"] == ("nom", "chemin fitzpatrick") and reperes.libelle(local) == "Chemin Fitzpatrick"


def test_cles_de_route():
    assert reperes.cles_structure("Autoroute 40 Ouest", "Rang du Bois-de-l'Ail") == [(40, "Ouest", 0)]
    assert reperes.cles_structure("9e Rang", "Autoroute 55") == [(("nom", "9e rang"), None, 0), (55, None, 1)]
    # bretelle : pas de repère sur la voie portée ; celui de la route franchie, avec son sens
    assert reperes.cles_structure("Bretelle A-30 Est vers A-15 Nord ( Bretelle H )", "Autoroute 15 Nord") == [(15, "Nord", 1)]
    assert reperes.cles_structure("Accès route 175", None) == [(("nom", "acces route 175"), None, 0)]


def test_entre_deux_reperes_meme_sens():
    # 14822N (A-40 Ouest, Saint-Augustin-de-Desmaures) : entre les panneaux km 272 et 273 de la chaussée ouest
    a, da, b, est, franchie = reperes.apparier(_index(), 46.686, -71.75162, "Autoroute 40 Ouest", "Rang du Bois-de-l'Ail")
    assert (a["km"], a["sens"], b["km"], franchie) == (272.0, "Ouest", 273.0, 0)
    assert 300 < da < 360 and 272.2 < est < 272.4


def test_reperes_non_consecutifs_route_172():
    # 06937 (route 172) : panneaux km 18 et 20 (pas de km 19 dans la série) → entre km 18 et km 20
    a, da, b, est, _ = reperes.apparier(_index(), 48.2653, -69.88717, "Route 172", "Rivière Sainte-Marguerite")
    assert (a["km"], b["km"]) == (18.0, 20.0) and 18 < est < 19


def test_rien_loin_de_la_route_ou_sans_route():
    assert reperes.apparier(_index(), 46.686, -71.75162, "Route 132", None) is None       # aucune 132 dans l'extrait
    assert reperes.apparier(_index(), 47.0, -71.0, "Autoroute 40", None) is None          # à plus de 2,5 km
    assert reperes.apparier(_index(), 46.686, -71.75162, None, None) is None


def test_construire_format_compact():
    rep = reperes.parse(FIX.read_bytes())
    res = reperes.construire(rep, [{"num": "14822N", "route": "Autoroute 40 Ouest", "obstacle": "Rang", "lat": 46.686, "lon": -71.75162},
                                   {"num": "00001", "route": "Rue X", "obstacle": None, "lat": 45.0, "lon": -73.0}])
    assert list(res["items"]) == ["14822N"]
    route, km_a, d_a, km_b, est, sens, franchie = res["items"]["14822N"]
    assert res["routes"][route] == "Autoroute 40" and res["sens"][sens] == "Ouest"
    assert (km_a, km_b, franchie) == (272.0, 273.0, 0) and isinstance(d_a, int) and est == 272.3
