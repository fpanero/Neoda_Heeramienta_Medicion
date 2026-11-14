"""Utilidades compartidas: rutas, lectura de configuración y escritura de series en el formato de la web."""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
CONFIG = WEB / "config"
SERIES_DIR = WEB / "data" / "series"
MANIFEST = WEB / "data" / "manifest.json"


def load_regions() -> list[dict]:
    return json.loads((CONFIG / "regions.json").read_text(encoding="utf-8"))["regions"]


def load_variables() -> list[dict]:
    return json.loads((CONFIG / "variables.json").read_text(encoding="utf-8"))["variables"]


def region_by_id(region_id: str) -> dict:
    for r in load_regions():
        if r["id"] == region_id:
            return r
    raise KeyError(f"Región desconocida: {region_id}")


def write_series(region: str, variable: str, start: str, values: list, units: str, source: dict) -> Path:
    """Escribe una serie mensual. `start` = 'AAAA-MM'. Los huecos se guardan como null."""
    clean = [None if (v is None or (isinstance(v, float) and math.isnan(v))) else round(float(v), 4) for v in values]
    out = SERIES_DIR / region / f"{variable}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "region": region,
        "variable": variable,
        "frequency": "monthly",
        "start": start,
        "units": units,
        "source": source,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "values": clean,
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return out


def write_manifest() -> Path:
    """Recorre web/data/series y escribe el índice que lee la web."""
    entries = {}
    for f in sorted(SERIES_DIR.glob("*/*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        n = len(d["values"])
        y, m = map(int, d["start"].split("-"))
        end_idx = y * 12 + (m - 1) + n - 1
        entries.setdefault(d["region"], {})[d["variable"]] = {
            "start": d["start"],
            "end": f"{end_idx // 12}-{end_idx % 12 + 1:02d}",
            "source_type": d["source"].get("type", "unknown"),
            "source_name": d["source"].get("name", ""),
        }
    MANIFEST.write_text(
        json.dumps({"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "series": entries},
                   ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    return MANIFEST
