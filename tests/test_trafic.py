"""Tests de la couche « Débits de circulation » sur tout le réseau (v0.6.8). Fixture : 4 sections réelles du WFS
`ms:circulation_routier` (2026-11-03) : sans DJMA, DJMA 2024 seulement, 118 000 véh./j, 1 880 véh./j en deux parties."""
from pathlib import Path

from etl import debits, trafic
from etl.reseaux import decoder_ligne

FIX = Path(__file__).parent / "fixtures" / "debits_reseau_extrait.geojson"


def _payload():
    return trafic.construire(debits.parse(FIX.read_bytes()))


def test_classes_du_mtmd():
    assert [trafic.classe(v) for v in (2, 4999, 5000, 9999, 10000, 24999, 25000, 49999, 50000, 99999, 100000, 250000)] == \
        [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]
    assert trafic.classe(None) == trafic.ND == 6
    assert trafic.plus_recent({2019: 10.0, 2024: 30.0, 2021: 20.0}) == (2024, 30.0)
    assert trafic.plus_recent({}) == (None, None)


def test_sections_et_valeur_la_plus_recente():
    p = _payload()
    assert p["annee"] == 2025
    s = {x[0]: x for x in p["sections"]}
    assert len(s) == 4
    assert s["0004059010"][3:5] == [118000, 2025]
    assert s["0014131000"][3:5] == [1880, 2025]
    assert s["0013806000"][3:5] == [12100, 2024]                  # pas de valeur 2025 : celle de 2024
    assert s["S001183733"][3] is None and s["S001183733"][4] is None


def test_lignes_classes_drapeaux_et_etiquette_unique():
    p = _payload()
    num = [x[0] for x in p["sections"]]
    par_section = {}
    for ligne in p["lines"]:
        c, i, drapeau, pts = decoder_ligne(ligne)
        assert len(pts) >= 2
        par_section.setdefault(num[i], []).append((c, drapeau))
    assert {c for c, _ in par_section["0004059010"]} == {5}           # 100 000 et +
    assert {c for c, _ in par_section["S001183733"]} == {trafic.ND}
    assert all(d & 1 for _, d in par_section["0013806000"])            # valeur d'une année antérieure : tirets
    assert not any(d & 1 for _, d in par_section["0004059010"])
    for parts in par_section.values():                                  # une seule partie porte l'étiquette
        assert sum(1 for _, d in parts if d & 2) == 1
    assert p["lines"][0][0] == trafic.ND                                # « non disponible » dessiné en premier (dessous)
