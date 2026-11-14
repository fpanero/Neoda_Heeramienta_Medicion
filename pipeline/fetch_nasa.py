"""Descarga datos REALES de la NASA, los promedia por región y los escribe en web/data/series.

Requisitos:
  - Cuenta gratuita de NASA Earthdata: https://urs.earthdata.nasa.gov/users/new
  - Variables de entorno EARTHDATA_USERNAME y EARTHDATA_PASSWORD (o un ~/.netrc)
  - pip install -r pipeline/requirements.txt

Uso:
  python pipeline/fetch_nasa.py --regions almeria granada --variables precip tair --start 2001 --end 2025
  python pipeline/fetch_nasa.py --all

Estado de los adaptadores (ver ADAPTERS más abajo):
  - GLDAS Noah 2.1 mensual (tair, et, pet, qair, wind, swrad, sm_surface, sm_root, runoff, swe): implementado
  - GPM IMERG mensual (precip): implementado
  - precip_extreme (IMERG diario), lst y ndvi (MODIS), tws (GRACE): pendientes -> siguen en DEMO
Las variables sin adaptador NO se tocan: conservan los datos de demostración.
"""
from __future__ import annotations

import argparse
import sys

import numpy as np

from common import load_regions, load_variables, region_by_id, write_manifest, write_series

SECONDS_PER_MONTH = 86400 * 30.4375


def _days_in_months(times) -> np.ndarray:
    import pandas as pd
    return pd.DatetimeIndex(times).days_in_month.values


# ---------- Conversión de unidades GLDAS -> unidades de variables.json ----------
def _gldas(var_names, convert):
    return {"short_name": "GLDAS_NOAH025_M", "version": "2.1", "vars": var_names, "convert": convert}


GLDAS = {
    "tair": _gldas(["Tair_f_inst"], lambda ds, t: ds["Tair_f_inst"] - 273.15),
    "et": _gldas(["Evap_tavg"], lambda ds, t: ds["Evap_tavg"] * 86400 * _days_in_months(t)[:, None, None]),
    # PotEvap viene en W/m²; calor latente 2.45e6 J/kg -> kg/m²/s -> mm/mes
    "pet": _gldas(["PotEvap_tavg"], lambda ds, t: ds["PotEvap_tavg"] / 2.45e6 * 86400 * _days_in_months(t)[:, None, None]),
    "qair": _gldas(["Qair_f_inst"], lambda ds, t: ds["Qair_f_inst"] * 1000),
    "wind": _gldas(["Wind_f_inst"], lambda ds, t: ds["Wind_f_inst"]),
    "swrad": _gldas(["SWdown_f_tavg"], lambda ds, t: ds["SWdown_f_tavg"]),
    "sm_surface": _gldas(["SoilMoi0_10cm_inst"], lambda ds, t: ds["SoilMoi0_10cm_inst"]),
    "sm_root": _gldas(["RootMoist_inst"], lambda ds, t: ds["RootMoist_inst"]),
    # Qs_acc/Qsb_acc en el producto mensual son medias de acumulados de 3 h (kg/m²) -> 8 pasos/día
    "runoff": _gldas(["Qs_acc", "Qsb_acc"], lambda ds, t: (ds["Qs_acc"] + ds["Qsb_acc"]) * 8 * _days_in_months(t)[:, None, None]),
    "swe": _gldas(["SWE_inst"], lambda ds, t: ds["SWE_inst"]),
}

IMERG = {
    # IMERG V07 mensual: 'precipitation' en mm/h
    "precip": {"short_name": "GPM_3IMERGM", "version": "07", "vars": ["precipitation"], "group": "Grid",
               "convert": lambda ds, t: ds["precipitation"] * 24 * _days_in_months(t)[:, None, None]},
}

ADAPTERS = {**GLDAS, **IMERG}


def regional_monthly_mean(spec: dict, bbox: list[float], start: int, end: int):
    """Busca los granulos en Earthdata, abre solo el recuadro de la región y devuelve (fechas, medias)."""
    import earthaccess
    import xarray as xr

    w, s, e, n = bbox
    results = earthaccess.search_data(
        short_name=spec["short_name"], version=spec["version"],
        temporal=(f"{start}-01-01", f"{end}-12-31"), bounding_box=(w, s, e, n),
    )
    if not results:
        raise RuntimeError(f"Sin resultados para {spec['short_name']}")
    files = earthaccess.open(results)
    ds = xr.open_mfdataset(files, combine="by_coords", engine="h5netcdf", group=spec.get("group"))[spec["vars"]]
    lat = "lat" if "lat" in ds.coords else "latitude"
    lon = "lon" if "lon" in ds.coords else "longitude"
    ds = ds.sortby(lat).sel({lat: slice(s, n), lon: slice(w, e)}).sortby("time")
    times = ds["time"].values
    field = spec["convert"](ds, times)
    # Media ponderada por el coseno de la latitud
    weights = np.cos(np.deg2rad(field[lat]))
    series = field.weighted(weights).mean(dim=[lat, lon], skipna=True).compute()
    return series["time"].values, series.values


def to_monthly_list(times, values, start: int, end: int) -> list:
    import pandas as pd
    idx = pd.period_range(f"{start}-01", f"{end}-12", freq="M")
    s = pd.Series(values, index=pd.DatetimeIndex(times).to_period("M"))
    s = s[~s.index.duplicated()].reindex(idx)
    return [None if pd.isna(v) else float(v) for v in s.values]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--regions", nargs="*", default=[])
    ap.add_argument("--variables", nargs="*", default=[])
    ap.add_argument("--all", action="store_true", help="Todas las regiones y todas las variables con adaptador")
    ap.add_argument("--start", type=int, default=2001)
    ap.add_argument("--end", type=int, default=2025)
    args = ap.parse_args()

    import earthaccess
    earthaccess.login(strategy="environment" if "EARTHDATA_USERNAME" in __import__("os").environ else "netrc")

    regions = [r["id"] for r in load_regions()] if args.all or not args.regions else args.regions
    wanted = list(ADAPTERS) if args.all or not args.variables else args.variables
    units = {v["id"]: v["units"] for v in load_variables()}

    errors = 0
    for vid in wanted:
        if vid not in ADAPTERS:
            print(f"[saltar] {vid}: sin adaptador todavía (se mantiene DEMO)")
            continue
        spec = ADAPTERS[vid]
        for rid in regions:
            try:
                times, vals = regional_monthly_mean(spec, region_by_id(rid)["bbox"], args.start, args.end)
                write_series(rid, vid, f"{args.start}-01", to_monthly_list(times, vals, args.start, args.end), units[vid],
                             {"type": "nasa", "name": f"{spec['short_name']} v{spec['version']}", "variables": spec["vars"]})
                print(f"[ok] {rid}/{vid}")
            except Exception as exc:  # noqa: BLE001
                errors += 1
                print(f"[error] {rid}/{vid}: {exc}", file=sys.stderr)
    write_manifest()
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
