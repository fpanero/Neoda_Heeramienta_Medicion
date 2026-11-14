# Neoda · Detective de recursos hídricos 💧

Herramienta web para **detectar tendencias** (no predecir) estadísticamente significativas en los problemas del agua en España
(sequía, demanda de riego, desertificación, calor extremo y reservas), con datos de **NASA POWER descargados en directo**.

Tres pestañas: **Inicio** (el problema, qué medimos y el alcance, con cifras de las 52 provincias), **Mapa de España** y
**Panel de análisis** (para el equipo científico: 19 indicadores con toda la estadística, se recalcula con cada cambio). Proyecto para el **NASA Space Apps Challenge 2026** —
[Be an Earth System Trend Detective](https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/) (Granada).

**👉 App en vivo:** https://fpanero.github.io/Neoda_Heeramienta_Medicion/

## Qué hace

1. **Eliges cualquier provincia de España** (52, más Galicia como comunidad) en el desplegable o en el mapa y, opcionalmente, otra para comparar. Ejemplo de la demo: **Almería** (semiárida, invernaderos) frente a **Galicia** (atlántica, húmeda).
2. **Eliges las variables** del ciclo del agua (19: 15 de NASA POWER y 4 calculadas): precipitación, temperatura, ETo, balance, aridez, SPI-12,
   humedad del suelo, nieve, viento, radiación…
3. La app genera la **serie temporal** (anual, o mensual sin ciclo estacional) y calcula:
   - **tasa de cambio** por década (pendiente de Sen),
   - **significancia** (Mann-Kendall y t-test),
   - **intervalos de confianza**.
4. Combina las variables en un **índice de recursos hídricos** y muestra **qué variable empuja el cambio**.

Los resultados se pueden descargar en CSV y la URL guarda el análisis para compartirlo.

5. **Mapa de España**: todas las provincias coloreadas según la variable elegida, por **tendencia por década**
   (rojo = peor para el agua, azul = mejor; tenue = no significativa) o por **valor medio** del periodo, con ranking.
   Las series anuales se precalculan en el despliegue (`pipeline/build_map_data.js`) y la estadística se hace en el navegador.

## Estado

| Parte | Estado |
|---|---|
| Datos en directo de NASA POWER (16 parámetros, 1981–2025, 6 puntos por región) | ✅ |
| Variables calculadas: ETo FAO-56, balance P − ETo, aridez P/ETo, anomalía de humedad, SPI-12 | ✅ |
| Estadística validada (pymannkendall, scipy, ejemplo 17 de FAO-56) | ✅ `pytest pipeline/tests` |
| Copia de respaldo por si no hay conexión | ✅ se regenera en cada despliegue |

## Estructura

```
web/                   → la app (se publica tal cual en GitHub Pages)
  config/variables.json → catálogo de 19 variables (Tier 1 NASA POWER + Tier 2 calculadas)
  config/regions.json   → 53 regiones y sus puntos de muestreo (generado por pipeline/build_regions.py)
  config/regions.geojson → límites provinciales para el mapa
  js/power.js          → descarga NASA POWER + ETo FAO-56, balance, aridez, SPI-12
  js/stats.js          → Mann-Kendall, Sen, OLS, anomalías, z-scores
  js/app.js            → interfaz
pipeline/
  fetch_power.py       → copia de respaldo de NASA POWER (la ejecuta GitHub Actions)
  build_regions.py     → genera regiones y puntos a partir de los límites provinciales
  tests/               → validación de la estadística y de FAO-56/SPI
docs/DATA_CONTRACT.md  → de dónde sale cada variable y cómo se calcula
```

## Desarrollo local

```bash
# Ver la web
cd web && python3 -m http.server 8000   # → http://localhost:8000

# Tests de la estadística (necesita Node.js)
pip install numpy scipy pymannkendall pytest && pytest pipeline/tests
```

## Escalabilidad

- **Cualquier región del mundo**: los datos de la NASA son globales; basta con añadir regiones a `regions.json`.
- **Más variables y fuentes** (GRACE para acuíferos, MODIS para vegetación, Copernicus, AEMET).
- **Alertas** cuando una tendencia se vuelve significativa (seguimos detectando, no prediciendo).
- **API** para cooperativas, ayuntamientos y confederaciones hidrográficas.

## Limitaciones

Los satélites no ven las desaladoras ni el bombeo de pozos; la rejilla de NASA POWER es de ~50 km;
y correlación no implica causalidad.

## Créditos

Datos: [NASA POWER](https://power.larc.nasa.gov/) (NASA Langley Research Center). Límites provinciales:
[click_that_hood](https://github.com/codeforgermany/click_that_hood) (spain-provinces.geojson). Mapa base © OpenStreetMap.
