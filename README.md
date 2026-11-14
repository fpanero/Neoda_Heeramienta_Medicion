# Neoda · Detective de recursos hídricos 💧

Herramienta web para detectar **tendencias estadísticamente significativas** en los recursos hídricos de España
con datos de satélite de la NASA. Proyecto para el **NASA Space Apps Challenge 2026** —
[Be an Earth System Trend Detective](https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/) (Granada).

**👉 App en vivo:** https://fpanero.github.io/Neoda_Heeramienta_Medicion/

## Qué hace

1. **Eliges la región** (provincias de Andalucía y otras de España, o el Poniente almeriense) y, opcionalmente, otra para comparar.
2. **Eliges las variables** del ciclo del agua (15 disponibles): precipitación, temperatura, evapotranspiración,
   humedad del suelo, nieve, agua subterránea (GRACE), vegetación…
3. La app genera la **serie temporal** (anual, o mensual sin ciclo estacional) y calcula:
   - **tasa de cambio** por década (pendiente de Sen),
   - **significancia** (Mann-Kendall y t-test),
   - **intervalos de confianza**.
4. Combina las variables en un **índice de recursos hídricos** y muestra **qué variable empuja el cambio**.

Los resultados se pueden descargar en CSV y la URL guarda el análisis para compartirlo.

## Estado

| Parte | Estado |
|---|---|
| Web (selección, gráficas, estadística, índice, mapa, CSV) | ✅ |
| Estadística validada contra `pymannkendall` y `scipy` | ✅ (`pytest pipeline/tests`) |
| Datos | ⚠️ **DEMO (simulados)** hasta ejecutar el pipeline de la NASA |
| Pipeline NASA: GLDAS (10 variables) + GPM IMERG (lluvia) | 🧪 implementado, pendiente de probar con credenciales |
| Pipeline NASA: MODIS (LST, NDVI), GRACE, IMERG diario | ⏳ pendiente |

## Estructura

```
web/                 → la app (se publica tal cual en GitHub Pages)
  config/            → catálogo de variables y regiones (editable)
  data/series/       → series mensuales por región y variable (JSON)
  js/stats.js        → Mann-Kendall, Sen, OLS, anomalías, z-scores
  js/app.js          → interfaz
pipeline/
  generate_demo.py   → genera datos simulados
  fetch_nasa.py      → descarga datos reales de NASA Earthdata y los promedia por región
  tests/             → valida la estadística JS contra Python
docs/DATA_CONTRACT.md → formato de datos y cómo añadir variables/regiones
```

## Desarrollo local

```bash
# Ver la web
cd web && python3 -m http.server 8000   # → http://localhost:8000

# Regenerar datos de demostración
python3 pipeline/generate_demo.py

# Tests de la estadística (necesita Node.js)
pip install numpy scipy pymannkendall pytest && pytest pipeline/tests
```

## Pasar a datos reales de la NASA

1. Crear cuenta gratuita en [NASA Earthdata](https://urs.earthdata.nasa.gov/users/new).
2. En GitHub: *Settings → Secrets and variables → Actions* → añadir `EARTHDATA_USERNAME` y `EARTHDATA_PASSWORD`.
3. *Actions → "Actualizar datos de la NASA" → Run workflow* (o en local: `python pipeline/fetch_nasa.py --regions almeria --variables precip tair`).
4. Las series pasan de `DEMO` a `NASA` automáticamente y la web se vuelve a desplegar.

## Escalabilidad

- **Cualquier región del mundo**: los datos de la NASA son globales; basta con añadir regiones a `regions.json`.
- **Más variables y fuentes** (Copernicus, AEMET) con el mismo formato de datos.
- **Previsión y alertas** a corto plazo sobre las mismas series.
- **API** para cooperativas, ayuntamientos y confederaciones hidrográficas.

## Limitaciones

Los satélites no ven las desaladoras ni el bombeo de pozos; la resolución va de ~5 km (MODIS) a ~300 km (GRACE);
y correlación no implica causalidad.
