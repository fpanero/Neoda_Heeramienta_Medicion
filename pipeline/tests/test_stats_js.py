"""Comprueba que la estadística de la web (web/js/stats.js) coincide con librerías de referencia en Python.

Ejecutar:  pytest pipeline/tests   (necesita Node.js instalado)
"""
import json
import subprocess
from pathlib import Path

import numpy as np
import pymannkendall as pmk
import pytest
from scipy import stats as st

ROOT = Path(__file__).resolve().parents[2]
STATS_JS = ROOT / "web" / "js" / "stats.js"


def run_js(x, y, alpha=0.05):
    code = f"""
      const S = require({json.dumps(str(STATS_JS))});
      const x = {json.dumps(list(x))}, y = {json.dumps(list(y))};
      console.log(JSON.stringify({{ mk: S.mannKendall(y, {alpha}), sen: S.senSlope(x, y, {alpha}), ols: S.linearRegression(x, y, {alpha}) }}));
    """
    out = subprocess.run(["node", "-e", code], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


CASES = {
    "creciente": np.arange(25) * 0.3 + np.random.default_rng(1).normal(0, 1, 25),
    "sin_tendencia": np.random.default_rng(2).normal(0, 1, 30),
    "decreciente_con_empates": np.round(10 - np.arange(40) * 0.1 + np.random.default_rng(3).normal(0, 0.8, 40)),
}


@pytest.mark.parametrize("name", CASES)
def test_matches_reference(name):
    y = CASES[name].astype(float)
    x = np.arange(2001, 2001 + len(y)).astype(float)
    js = run_js(x.tolist(), y.tolist())

    ref = pmk.original_test(y)
    assert js["mk"]["s"] == pytest.approx(ref.s)
    assert js["mk"]["varS"] == pytest.approx(ref.var_s)
    assert js["mk"]["z"] == pytest.approx(ref.z, rel=1e-9)
    assert js["mk"]["p"] == pytest.approx(ref.p, abs=1e-6)

    ts = st.theilslopes(y, x, 0.95)
    assert js["sen"]["slope"] == pytest.approx(ts.slope)
    assert js["sen"]["ciLow"] == pytest.approx(ts.low_slope)
    assert js["sen"]["ciHigh"] == pytest.approx(ts.high_slope)

    lr = st.linregress(x, y)
    assert js["ols"]["slope"] == pytest.approx(lr.slope)
    assert js["ols"]["p"] == pytest.approx(lr.pvalue, rel=1e-6, abs=1e-12)
    assert js["ols"]["se"] == pytest.approx(lr.stderr)
