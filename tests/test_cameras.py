"""Tests de la couche des caméras de circulation (Québec 511, v0.6.7)."""
import json
from pathlib import Path

from etl import cameras

FIX = Path(__file__).parent / "fixtures" / "cameras_extrait.geojson"


def test_parse_extrait_reel():
    r = cameras.parse(json.loads(FIX.read_text(encoding="utf-8")))
    c = {x[3]: x for x in r["cameras"]}
    assert len(c) == 4
    q = c["Q5413"]
    assert (q[0], q[1], q[2]) == (4678853, -7135488, 3998)
    assert q[4] == "Aut. 540 (direction ouest) à la hauteur du boul. Wilfrid-Hamel"
    assert q[5] == 540 and r["regions"][q[6]] == "Québec (Capitale-Nationale)" and q[7] is None
    assert c["Q7311"][7] == "Pont Pierre-Laporte"                    # caméra d'un pont
    assert [x[2] for x in r["cameras"]] == sorted(x[2] for x in r["cameras"])


def test_parse_ecarte_les_entites_sans_position_ou_identifiant():
    gj = {"features": [{"properties": {"IDEcamera": "12"}, "geometry": None},
                       {"properties": {"IDEcamera": ""}, "geometry": {"type": "Point", "coordinates": [-71, 46]}},
                       {"properties": {"IDEcamera": "7", "NumeroRoute": "", "NomRegionDiffusion": None}, "geometry": {"type": "Point", "coordinates": [-71, 46]}},
                       {"properties": {"IDEcamera": "7"}, "geometry": {"type": "Point", "coordinates": [-72, 47]}}]}
    r = cameras.parse(gj)
    assert len(r["cameras"]) == 1 and r["cameras"][0][5] is None and r["regions"] == ["Non précisée"]


def test_image_url_selon_la_ville():
    assert cameras.image_url("Q5413") == "https://www.quebec511.info/Images/Cameras/Quebec/cam/5413.jpg"
    assert cameras.image_url("M1330004") == "https://www.quebec511.info/Images/Cameras/Montreal/cam/1330004.jpg"
    assert cameras.image_url("X12") is None and cameras.image_url(None) is None
