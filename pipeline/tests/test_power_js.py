"""Valida los cálculos de web/js/power.js.

- ETo: ejemplo 17 del manual FAO-56 (Bangkok, abril) → 5,72 mm/día.
- SPI: comparación con un ajuste gamma de referencia en scipy.
"""
import json
import subprocess
from pathlib import Path

import numpy as np
import pytest
from scipy import stats as st

ROOT = Path(__file__).resolve().parents[2]
POWER_JS = ROOT / "web" / "js" / "power.js"


def node(expr: str):
    code = f"const P = require({json.dumps(str(POWER_JS))}); console.log(JSON.stringify({expr}));"
    return json.loads(subprocess.run(["node", "-e", code], capture_output=True, text=True, check=True).stdout)


def test_extraterrestrial_radiation_fao_example():
    # FAO-56 ejemplo 8: 20°S, 3 de septiembre (día 246) → Ra = 32,2 MJ/m²/día
    assert node("P.extraterrestrialRadiation(-20, 246)") == pytest.approx(32.2, abs=0.1)


def test_eto_fao56_example17():
    # Bangkok (13°44'N, z = 2 m), abril: Tmax 34,8, Tmin 25,6, ea 2,85 kPa, u2 2 m/s, Rs 22,65, G = 0,14 → 5,72 mm/día
    lat = 13 + 44 / 60
    v = node(f"P.eto({{tmax: 34.8, tmin: 25.6, tmean: 30.2, ea: 2.85, rs: 22.65, u2: 2, p: 101.3, lat: {lat}, doy: 105, z: 2, g: 0.14}})")
    assert v == pytest.approx(5.72, abs=0.06)


def test_spi_matches_scipy_gamma():
    rng = np.random.default_rng(7)
    months = 45 * 12
    precip = rng.gamma(2.0, 20.0, months)  # mm/mes
    js = np.array(node(f"P.spi({json.dumps(precip.round(4).tolist())}, 1, 12)"), dtype=float)

    acc = np.convolve(precip.round(4), np.ones(12), "valid")  # acc[i] = suma de los meses i..i+11
    ref = np.full(months, np.nan)
    for m in range(12):
        idx = [i for i in range(11, months) if i % 12 == m]
        vals = acc[np.array(idx) - 11]
        a, loc, scale = st.gamma.fit(vals, floc=0)
        ref[idx] = st.norm.ppf(st.gamma.cdf(vals, a, loc=0, scale=scale))
    ok = ~np.isnan(ref)
    # Thom (JS) vs máxima verosimilitud (scipy): diferencias pequeñas esperables
    assert np.nanmax(np.abs(js[ok] - ref[ok])) < 0.08
    assert np.isnan(js[:11].astype(float)).all() or all(v is None for v in js[:11])
