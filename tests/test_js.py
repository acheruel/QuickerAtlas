"""Tests JavaScript (Node) : fonctions pures du visualiseur et modules js/*.js. Ignorés si Node est absent."""
import shutil
import subprocess
from pathlib import Path

import pytest

JS = sorted((Path(__file__).parent / "js").glob("*.mjs"))


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js absent")
@pytest.mark.parametrize("script", JS, ids=[p.name for p in JS])
def test_js(script):
    r = subprocess.run(["node", str(script)], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr


MODULES = sorted((Path(__file__).parent.parent / "js").glob("*.js"))


# v0.7.3 : une erreur de syntaxe dans un module chargé à la demande (js/bloc3d.js) passait inaperçue des autres tests
@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js absent")
@pytest.mark.parametrize("module", MODULES, ids=[p.name for p in MODULES])
def test_syntaxe_module(module):
    r = subprocess.run(["node", "--check", str(module)], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr
