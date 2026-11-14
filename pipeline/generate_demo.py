"""Genera series mensuales SIMULADAS para todas las regiones y variables.

Sirven para desarrollar y probar la app antes de tener los datos reales de la NASA.
Todas las series se marcan con "source": {"type": "demo"} y la web muestra un aviso.

Uso:
    python pipeline/generate_demo.py              # 2001-2025, todas las regiones/variables
    python pipeline/generate_demo.py --start 2001 --end 2025
"""
from __future__ import annotations

import argparse
import hashlib

import numpy as np

from common import load_regions, load_variables, write_manifest, write_series

# Parámetros climáticos aproximados por región (solo para que la demo sea verosímil).
REGION_CLIMATE = {
    #                     lluvia anual (mm), T media (°C), nieve (sí/no)
    "almeria":             (230, 18.5, False),
    "galicia":             (1300, 13.5, True),
    "poniente_almeriense": (220, 18.8, False),
    "granada":             (450, 15.0, True),
    "malaga":              (550, 18.0, False),
    "jaen":                (520, 17.0, False),
    "cordoba":             (560, 18.0, False),
    "sevilla":             (540, 19.0, False),
    "cadiz":               (650, 18.0, False),
    "huelva":              (520, 18.0, False),
    "murcia":              (300, 18.0, False),
    "alicante":            (330, 18.0, False),
    "madrid":              (420, 14.5, True),
    "zaragoza":            (330, 15.0, True),
}

# Distribución mensual típica mediterránea de la lluvia (ene..dic), suma 1.
RAIN_SHAPE = np.array([0.11, 0.10, 0.09, 0.09, 0.06, 0.02, 0.005, 0.01, 0.05, 0.12, 0.15, 0.145])
RAIN_SHAPE = RAIN_SHAPE / RAIN_SHAPE.sum()
# Ciclo anual de temperatura (anomalía respecto a la media anual, °C)
TEMP_SHAPE = 7.5 * -np.cos(2 * np.pi * (np.arange(12) - 0.5) / 12)


def rng_for(*keys: str) -> np.random.Generator:
    seed = int(hashlib.sha256("|".join(keys).encode()).hexdigest()[:8], 16)
    return np.random.default_rng(seed)


def simulate(region: str, var: str, n_years: int) -> np.ndarray:
    rain_mm, t_mean, has_snow = REGION_CLIMATE.get(region, (450, 16.0, False))
    rng = rng_for(region, var)
    months = np.tile(np.arange(12), n_years)
    t_dec = np.repeat(np.arange(n_years), 12) / 10.0 + months / 120.0  # tiempo en décadas
    greenhouse = region == "poniente_almeriense"

    # Señal climática compartida (la misma para todas las variables de la región)
    shared = rng_for(region, "shared")
    dry_years = np.repeat(shared.normal(0, 1, n_years), 12)  # >0 = año húmedo

    if var == "precip":
        base = rain_mm * RAIN_SHAPE[months]
        factor = np.exp(0.35 * dry_years + rng.normal(0, 0.45, months.size))
        v = base * factor * (1 - 0.04 * t_dec)  # -4 %/década
    elif var == "precip_extreme":
        base = rain_mm * RAIN_SHAPE[months] * 0.45
        v = base * np.exp(rng.normal(0, 0.6, months.size)) * (1 + 0.05 * t_dec)
    elif var == "tair":
        v = t_mean + TEMP_SHAPE[months] + 0.35 * t_dec + rng.normal(0, 0.8, months.size)
    elif var == "lst":
        trend = -0.30 if greenhouse else 0.45  # efecto albedo de los invernaderos
        v = t_mean + 4 + 1.6 * TEMP_SHAPE[months] + trend * t_dec + rng.normal(0, 1.2, months.size)
    elif var == "pet":
        v = 30 + 160 * (TEMP_SHAPE[months] + 7.5) / 15 + 4.0 * t_dec + rng.normal(0, 6, months.size)
    elif var == "et":
        avail = rain_mm / 450
        v = (10 + 45 * avail * (1 - np.abs(months - 4) / 8).clip(0.2)) * (1 + 0.12 * dry_years) \
            + 1.2 * t_dec + rng.normal(0, 3, months.size)
    elif var == "qair":
        v = 7.5 + 2.5 * (TEMP_SHAPE[months] + 7.5) / 15 - 0.05 * t_dec + rng.normal(0, 0.4, months.size)
    elif var == "wind":
        v = 3.2 + 0.4 * np.sin(2 * np.pi * months / 12) + rng.normal(0, 0.3, months.size)
    elif var == "swrad":
        v = 200 + 110 * (TEMP_SHAPE[months] + 7.5) / 15 + 1.5 * t_dec + rng.normal(0, 8, months.size)
    elif var == "sm_surface":
        wet = RAIN_SHAPE[months] / RAIN_SHAPE.max()
        v = 12 + 14 * wet * (rain_mm / 450) + 3 * dry_years - 0.8 * t_dec + rng.normal(0, 1.5, months.size)
    elif var == "sm_root":
        wet = np.convolve(np.tile(RAIN_SHAPE, 3), np.ones(3) / 3, "same")[12:24] / RAIN_SHAPE.max()
        v = 150 + 80 * wet[months] * (rain_mm / 450) + 18 * dry_years - 6 * t_dec + rng.normal(0, 6, months.size)
    elif var == "runoff":
        base = 0.08 * rain_mm * RAIN_SHAPE[months]
        v = base * np.exp(0.6 * dry_years + rng.normal(0, 0.5, months.size)) * (1 - 0.06 * t_dec)
    elif var == "swe":
        if not has_snow:
            v = np.zeros(months.size)
        else:
            season = np.array([1, 1.1, 0.8, 0.4, 0.1, 0, 0, 0, 0, 0, 0.2, 0.6])
            v = 25 * season[months] * np.exp(0.4 * dry_years) * (1 - 0.12 * t_dec) + rng.normal(0, 1, months.size)
    elif var == "tws":
        # Anomalía relativa: tendencia negativa fuerte en el sureste (acuíferos sobreexplotados)
        se = region in ("almeria", "poniente_almeriense", "murcia", "alicante")  # Galicia: descenso leve
        v = 4 * np.sin(2 * np.pi * (months - 2) / 12) + 3 * dry_years - (2.2 if se else 0.8) * t_dec \
            + rng.normal(0, 1, months.size)
        return np.round(v, 3)
    elif var == "ndvi":
        green = 0.22 + 0.25 * (rain_mm / 650)
        season = 0.06 * np.cos(2 * np.pi * (months - 3) / 12)
        trend = 0.012 if greenhouse else -0.004
        v = green + season + 0.02 * dry_years + trend * t_dec + rng.normal(0, 0.015, months.size)
    else:
        raise ValueError(f"Variable sin simulación definida: {var}")

    return np.round(np.clip(v, 0, None), 3)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--start", type=int, default=2001)
    ap.add_argument("--end", type=int, default=2025)
    args = ap.parse_args()

    regions = load_regions()
    variables = load_variables()
    n_years = args.end - args.start + 1
    for r in regions:
        for v in variables:
            values = simulate(r["id"], v["id"], n_years)
            write_series(
                region=r["id"], variable=v["id"], start=f"{args.start}-01", values=values.tolist(),
                units=v["units"], source={"type": "demo", "name": "Datos simulados (DEMO)"},
            )
    write_manifest()
    print(f"Generadas {len(regions) * len(variables)} series de demostración ({args.start}-{args.end}).")


if __name__ == "__main__":
    main()
