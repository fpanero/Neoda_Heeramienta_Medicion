"""Genera web/config/regions.json y web/config/regions.geojson para TODAS las provincias de España.

Para cada provincia elige automáticamente entre 1 y 6 puntos de muestreo de NASA POWER:
  - dentro de la provincia y, si cabe, a ≥ ~8 km de la costa/límite (para no caer en el mar),
  - lo más repartidos posible (muestreo del punto más lejano).
Añade también la región «Galicia» (unión de sus 4 provincias) que se usa en la demo.

Límites provinciales: spain-provinces.geojson de codeforgermany/click_that_hood.
Uso:  pip install shapely && python pipeline/build_regions.py ruta/a/spain-provinces.geojson
"""
from __future__ import annotations

import json
import math
import sys
import unicodedata
from pathlib import Path

from shapely.geometry import Point, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "web" / "config"

CCAA = {
    "01": "Andalucía", "02": "Aragón", "03": "Illes Balears", "04": "Canarias", "05": "Cantabria",
    "06": "Castilla-La Mancha", "07": "Castilla y León", "08": "Cataluña", "09": "Ceuta", "10": "Extremadura",
    "11": "Galicia", "12": "La Rioja", "13": "Comunidad de Madrid", "14": "Melilla", "15": "Región de Murcia",
    "16": "Navarra", "17": "País Vasco", "18": "Asturias", "19": "Comunitat Valenciana",
}
NAME_FIX = {"Santa Cruz De Tenerife": "Santa Cruz de Tenerife"}


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.split("/")[-1]).encode("ascii", "ignore").decode()
    return "".join(c if c.isalnum() else "_" for c in s.lower()).strip("_")


def sample_points(geom, k: int) -> list[tuple[float, float]]:
    inner = None
    for buf in (0.08, 0.04, 0.015):
        g = geom.buffer(-buf)
        if not g.is_empty and g.area > 0.002:
            inner = g
            break
    if inner is None:
        p = geom.representative_point()
        return [(p.x, p.y)]
    minx, miny, maxx, maxy = inner.bounds
    step = max(0.03, math.sqrt(inner.area / 400))
    cand = []
    y = miny
    while y <= maxy:
        x = minx
        while x <= maxx:
            if inner.contains(Point(x, y)):
                cand.append((x, y))
            x += step
        y += step
    if not cand:
        p = inner.representative_point()
        return [(p.x, p.y)]
    c = inner.centroid
    first = min(cand, key=lambda q: (q[0] - c.x) ** 2 + (q[1] - c.y) ** 2)
    chosen = [first]
    while len(chosen) < min(k, len(cand)):
        far = max(cand, key=lambda q: min((q[0] - s[0]) ** 2 + (q[1] - s[1]) ** 2 for s in chosen))
        chosen.append(far)
    return chosen


def n_points(geom) -> int:
    if geom.area < 0.05:
        return 1
    return max(3, min(6, round(geom.area / 0.35) + 2))


def sample_region(geom) -> list[tuple[float, float]]:
    """Islas (multipolígonos): al menos un punto por isla relevante, el resto según superficie."""
    parts = sorted(getattr(geom, "geoms", [geom]), key=lambda g: -g.area)
    parts = [g for g in parts if g.area >= 0.012] or parts[:1]
    if len(parts) == 1:
        return sample_points(parts[0], n_points(parts[0]))
    total = sum(g.area for g in parts)
    budget = max(len(parts), min(8, n_points(geom)))
    alloc = [1] * len(parts)
    for _ in range(budget - len(parts)):
        i = max(range(len(parts)), key=lambda j: parts[j].area / total - alloc[j] / budget)
        alloc[i] += 1
    pts = []
    for g, k in zip(parts, alloc):
        pts += sample_points(g, k)
    return pts


def map_geom(geom):
    """Geometría ligera para el mapa: sin islotes diminutos y simplificada."""
    from shapely.geometry import MultiPolygon
    parts = [g for g in getattr(geom, "geoms", [geom]) if g.area >= 0.003] or [geom]
    g = MultiPolygon(parts) if len(parts) > 1 else parts[0]
    return mapping(g.simplify(0.02, preserve_topology=True))


def region_entry(rid, name, rtype, ccaa, geom):
    pts = sample_region(geom)
    minx, miny, maxx, maxy = geom.bounds
    return {
        "id": rid, "name": name, "type": rtype, "ccaa": ccaa,
        "bbox": [round(minx, 3), round(miny, 3), round(maxx, 3), round(maxy, 3)],
        "points": [{"name": f"Punto {i + 1}", "lonlat": [round(x, 2), round(y, 2)]} for i, (x, y) in enumerate(pts)],
    }


def main(src: str) -> None:
    data = json.loads(Path(src).read_text(encoding="utf-8"))
    regions, features, galicia = [], [], []
    for f in data["features"]:
        props = f["properties"]
        name = NAME_FIX.get(props["name"], props["name"])
        geom = shape(f["geometry"]).buffer(0)
        rid = slug(name)
        ccaa = CCAA[props["cod_ccaa"]]
        regions.append(region_entry(rid, name, "provincia", ccaa, geom))
        features.append({"type": "Feature", "properties": {"id": rid, "name": name},
                         "geometry": map_geom(geom)})
        if props["cod_ccaa"] == "11":
            galicia.append(geom)

    g = unary_union(galicia)
    regions.append(region_entry("galicia", "Galicia (comunidad)", "comunidad autónoma", "Galicia", g))
    features.append({"type": "Feature", "properties": {"id": "galicia", "name": "Galicia (comunidad)"},
                     "geometry": map_geom(g)})

    regions.sort(key=lambda r: (r["ccaa"], r["type"] != "comunidad autónoma", r["name"]))
    doc = ("Regiones: todas las provincias de España + Galicia como comunidad. Generado por pipeline/build_regions.py. "
           "points = puntos de muestreo de NASA POWER (lon, lat) dentro de la provincia y alejados de la costa; "
           "la serie regional es su media. bbox = [oeste, sur, este, norte].")
    (CONFIG / "regions.json").write_text(
        json.dumps({"_doc": doc, "regions": regions}, ensure_ascii=False, indent=1), encoding="utf-8")

    def rnd(o):
        if isinstance(o, float):
            return round(o, 3)
        if isinstance(o, (list, tuple)):
            return [rnd(x) for x in o]
        if isinstance(o, dict):
            return {k: rnd(v) for k, v in o.items()}
        return o
    (CONFIG / "regions.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": rnd(features)}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")
    print(f"{len(regions)} regiones, {sum(len(r['points']) for r in regions)} puntos")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "spain-provinces.geojson")
