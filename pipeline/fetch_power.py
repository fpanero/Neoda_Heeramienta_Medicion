"""Guarda una copia de respaldo de NASA POWER en web/data/power/<region>.json.

La web descarga los datos en directo al pulsar «Analizar». Esta copia solo se usa si la API no responde
(por ejemplo, sin wifi en la presentación). Se ejecuta automáticamente en cada despliegue (GitHub Actions).

Uso:  python pipeline/fetch_power.py            (solo librería estándar)
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "web" / "config"
OUT = ROOT / "web" / "data" / "power"
API = "https://power.larc.nasa.gov/api/temporal/monthly/point"
PARAMS = ["PRECTOTCORR", "PRECSNOLAND", "T2M", "T2M_MAX", "T2M_MIN", "T2M_RANGE", "RH2M", "QV2M",
          "WS10M", "WS2M", "ALLSKY_SFC_SW_DWN", "CLOUD_AMT", "PS", "GWETTOP", "GWETROOT", "GWETPROF"]


def fetch_point(lon: float, lat: float, start: int, end: int) -> dict:
    url = (f"{API}?parameters={','.join(PARAMS)}&community=AG&longitude={lon}&latitude={lat}"
           f"&start={start}&end={end}&format=JSON")
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                j = json.load(r)
            return {"lon": lon, "lat": lat, "z": j["geometry"]["coordinates"][2], "parameter": j["properties"]["parameter"]}
        except Exception as exc:  # noqa: BLE001
            print(f"  reintento {attempt + 1} ({lon}, {lat}): {exc}", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"No se pudo descargar el punto ({lon}, {lat})")


def main() -> int:
    period = json.loads((CONFIG / "variables.json").read_text(encoding="utf-8"))["period"]
    regions = json.loads((CONFIG / "regions.json").read_text(encoding="utf-8"))["regions"]
    OUT.mkdir(parents=True, exist_ok=True)
    failed = 0
    for reg in regions:
        try:
            pts = []
            for p in reg["points"]:
                pt = fetch_point(p["lonlat"][0], p["lonlat"][1], period["first"], period["last"])
                pt["name"] = p["name"]
                pts.append(pt)
            snap = {"region": reg["id"], "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "start": period["first"], "end": period["last"], "points": pts}
            (OUT / f"{reg['id']}.json").write_text(json.dumps(snap, separators=(",", ":")), encoding="utf-8")
            print(f"[ok] {reg['id']}: {len(pts)} puntos")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"[error] {reg['id']}: {exc}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
