# Datos: de dónde salen y cómo se calculan

## Fuente: NASA POWER (en directo)

Al pulsar **Analizar**, la web (`web/js/power.js`) llama a la API mensual de NASA POWER, que no necesita clave:

```
https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=...&community=AG&longitude=..&latitude=..&start=1981&end=2025&format=JSON
```

- Hay **52 provincias + Galicia (comunidad)**. Cada una se representa con **1 a 6 puntos** generados por `pipeline/build_regions.py`:
  dentro de la provincia, a ~8 km o más de la costa cuando cabe, lo más repartidos posible y con al menos uno por isla grande.
  La serie regional es la media de los puntos (Ceuta y Melilla: 1 punto).
- Se piden 16 parámetros en una sola llamada por punto (el límite es 20).
- Los datos de cada región se descargan una vez por sesión (~2 s).
- Si la API falla, se usa la copia `web/data/power/<region>.json`, que GitHub Actions regenera en cada despliegue y cada lunes (`pipeline/fetch_power.py`).

## Tier 1: parámetros de NASA POWER

| Variable | Parámetro | Unidades en la app | Nota |
|---|---|---|---|
| Precipitación | PRECTOTCORR | mm/mes (mm/día × días del mes) | |
| Nieve | PRECSNOLAND | mm/mes | |
| Temperatura media | T2M | °C | |
| Máxima / mínima extrema | T2M_MAX / T2M_MIN | °C | En la API **mensual** son el extremo absoluto del mes, no la media diaria |
| Humedad relativa / específica | RH2M / QV2M | % / g/kg | |
| Viento | WS10M | m/s | Para FAO-56 se usa WS2M |
| Radiación solar | ALLSKY_SFC_SW_DWN | MJ/m²/día | Con `community=AG` ya viene en MJ |
| Nubosidad / presión | CLOUD_AMT / PS | % / kPa | Contexto / soporte |
| Humedad del suelo | GWETTOP, GWETROOT, GWETPROF | fracción 0–1 | |

## Tier 2: variables calculadas

| Variable | Cálculo |
|---|---|
| ETo | FAO-56 Penman-Monteith mensual. Tmax/Tmin medias = T2M ± T2M_RANGE/2; ea = RH·es; u2 = WS2M; Rs = ALLSKY; Ra según latitud y día 15 del mes; G = 0,14·(T_mes − T_mes anterior). Validado con el ejemplo 17 de FAO-56. |
| Balance hídrico | P − ETo (por punto, luego media) |
| Índice de aridez | En anual: ΣP / ΣETo del año. Clases UNEP. |
| Anomalía de humedad del suelo | GWETROOT − media de ese mes (1981–hoy) |
| SPI-12 | Lluvia acumulada en 12 meses → ajuste gamma por mes del año (Thom) → normal estándar. Validado contra scipy. |

## Estadística (`web/js/stats.js`)

Pendiente de Sen + IC (Gilbert 1987), Mann-Kendall con empates, OLS con t-test e IC, agregación anual
(sum/mean/max/min/ratio) o anomalías mensuales. Validada contra pymannkendall y scipy (`pytest pipeline/tests`).

## Añadir una región

Las provincias se generan con `python pipeline/build_regions.py spain-provinces.geojson` (necesita `shapely`).
Para una región a medida, añadirla a mano a `web/config/regions.json` con su `bbox` y entre 3 y 8 `points` en tierra.
