# Formato de datos (contrato entre el pipeline y la web)

La web es **estática** (GitHub Pages): no descarga nada de la NASA en directo, porque los datos de Earthdata
necesitan usuario y contraseña y serían demasiado pesados para el navegador. En su lugar:

1. El **pipeline** (`pipeline/`) descarga los datos, los promedia por región y mes, y escribe JSON pequeños.
2. La **web** (`web/`) lee esos JSON y hace toda la estadística en el navegador (`web/js/stats.js`).

Mientras no haya datos reales, `pipeline/generate_demo.py` genera series **simuladas** con el mismo formato.

## 1. Una serie: `web/data/series/<region>/<variable>.json`

```json
{
  "region": "almeria",
  "variable": "precip",
  "frequency": "monthly",
  "start": "2001-01",
  "units": "mm/mes",
  "source": { "type": "nasa", "name": "GPM_3IMERGM v07" },
  "generated": "2026-11-14T10:00:00Z",
  "values": [12.3, 20.1, null, ...]
}
```

- Un valor por mes, consecutivos desde `start`. Huecos = `null`.
- `source.type`: `"demo"` (simulado, la web muestra aviso) o `"nasa"` (real).
- Las unidades deben coincidir con `web/config/variables.json`.

## 2. Índice: `web/data/manifest.json`

Lo genera `common.write_manifest()` automáticamente. La web solo ofrece las series que aparecen aquí.

## 3. Añadir una variable nueva

1. Añadirla a `web/config/variables.json` (id, nombre, grupo, unidades, `aggregation`: `sum`/`mean`/`max`,
   `water_sign`: `+1` si más valor = más agua, `-1` si menos agua, `0` si no entra en el índice).
2. Añadir su simulación en `generate_demo.py` (para que la demo siga funcionando).
3. Añadir su adaptador en `fetch_nasa.py` (`ADAPTERS`).

## 4. Añadir una región nueva

Añadirla a `web/config/regions.json` con su `bbox` = `[oeste, sur, este, norte]` y volver a ejecutar
`generate_demo.py` y/o `fetch_nasa.py`. Para más precisión se pueden cambiar los rectángulos por polígonos
(GeoJSON de provincias del IGN) y usar una máscara en `fetch_nasa.regional_monthly_mean`.

## 5. Estadística (en `web/js/stats.js`, validada contra Python en `pipeline/tests`)

| Objetivo del reto | Implementación |
|---|---|
| Tasa de cambio | Pendiente de Sen (mediana de todas las pendientes entre pares) |
| Significancia | Mann-Kendall con corrección por empates (p bilateral) |
| t-test | Regresión lineal OLS, t-test sobre la pendiente |
| Intervalos de confianza | IC de la pendiente de Sen (Gilbert 1987) y de la OLS (t de Student) |
| Quitar estacionalidad | Modo anual (agregación) o anomalías mensuales respecto a la climatología |
| Índice combinado | Media de z-scores con signo (`water_sign`) de las variables elegidas |
