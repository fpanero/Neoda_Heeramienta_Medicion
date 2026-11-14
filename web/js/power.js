/*
 * power.js — Datos de NASA POWER en tiempo real + variables derivadas.
 *
 *  1. Descarga la API mensual de NASA POWER (sin clave) para varios puntos de cada región.
 *  2. Por punto calcula: precipitación y nieve en mm/mes, ETo FAO-56 Penman-Monteith, balance P − ETo.
 *  3. Promedia los puntos → serie regional.
 *  4. Sobre la serie regional calcula: índice de aridez, anomalía de humedad del suelo y SPI-12.
 *  Si la API falla, usa la copia guardada en data/power/<region>.json (generada en cada despliegue).
 */
(function (root) {
  "use strict";

  const API = "https://power.larc.nasa.gov/api/temporal/monthly/point";
  const PARAMS = ["PRECTOTCORR", "PRECSNOLAND", "T2M", "T2M_MAX", "T2M_MIN", "T2M_RANGE", "RH2M", "QV2M",
    "WS10M", "WS2M", "ALLSKY_SFC_SW_DWN", "CLOUD_AMT", "PS", "GWETTOP", "GWETROOT", "GWETPROF"];
  const FILL = -999;
  const Stats = root.Stats || (typeof require !== "undefined" ? require("./stats.js") : null);
  const isNum = (v) => v !== null && v !== undefined && Number.isFinite(v) && v !== FILL;

  // ---------- Utilidades de calendario ----------
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const midMonthDoy = (y, m) => Math.round((Date.UTC(y, m - 1, 15) - Date.UTC(y, 0, 0)) / 86400000);

  // ---------- FAO-56 Penman-Monteith (mm/día) ----------
  const satVap = (T) => 0.6108 * Math.exp((17.27 * T) / (T + 237.3));

  /** Radiación extraterrestre Ra (MJ/m²/día). FAO-56 ec. 21. */
  function extraterrestrialRadiation(latDeg, doy) {
    const phi = (latDeg * Math.PI) / 180;
    const dr = 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365);
    const delta = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39);
    const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))));
    return ((24 * 60) / Math.PI) * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws));
  }

  /**
   * ETo FAO-56 (mm/día). Entradas: tmax, tmin, tmean (°C); ea (kPa) o rh (%); rs (MJ/m²/día);
   * u2 (m/s a 2 m); p (kPa); lat (°); doy; z (m); g (MJ/m²/día, flujo de calor del suelo).
   */
  function eto({ tmax, tmin, tmean, ea, rh, rs, u2, p, lat, doy, z = 0, g = 0 }) {
    if (![tmax, tmin, tmean, rs, u2, p].every(isNum)) return null;
    const es = (satVap(tmax) + satVap(tmin)) / 2;
    const eaV = isNum(ea) ? ea : isNum(rh) ? (rh / 100) * es : null;
    if (eaV === null) return null;
    const delta = (4098 * satVap(tmean)) / (tmean + 237.3) ** 2;
    const gamma = 0.000665 * p;
    const ra = extraterrestrialRadiation(lat, doy);
    const rso = (0.75 + 2e-5 * z) * ra;
    const rns = 0.77 * rs;
    const ratio = rso > 0 ? Math.min(1, rs / rso) : 0.5;
    const sigma = 4.903e-9;
    const rnl = sigma * (((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2) * (0.34 - 0.14 * Math.sqrt(Math.max(0, eaV))) * (1.35 * ratio - 0.35);
    const rn = rns - rnl;
    const num = 0.408 * delta * (rn - g) + gamma * (900 / (tmean + 273)) * u2 * (es - eaV);
    const den = delta + gamma * (1 + 0.34 * u2);
    return Math.max(0, num / den);
  }

  // ---------- SPI (gamma, método de Thom) ----------
  function lgamma(x) {
    const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015; for (let j = 0; j < 6; j++) ser += g[j] / ++y;
    return -tmp + Math.log((2.5066282746310005 * ser) / x);
  }
  /** P(a, x): gamma incompleta regularizada inferior. */
  function gammaP(a, x) {
    if (x <= 0) return 0;
    if (x < a + 1) {
      let ap = a, sum = 1 / a, del = sum;
      for (let n = 0; n < 500; n++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-14) break; }
      return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
    }
    let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
    for (let i = 1; i < 500; i++) {
      const an = -i * (i - a); b += 2;
      d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-14) break;
    }
    return 1 - Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
  }
  /** SPI a `scale` meses sobre una serie mensual (mm/mes). Calibra con toda la serie, mes a mes. */
  function spi(precip, startMonth, scale = 12) {
    const n = precip.length, acc = new Array(n).fill(null);
    for (let i = scale - 1; i < n; i++) {
      let s = 0, ok = true;
      for (let k = i - scale + 1; k <= i; k++) { if (!isNum(precip[k])) { ok = false; break; } s += precip[k]; }
      if (ok) acc[i] = s;
    }
    const out = new Array(n).fill(null);
    for (let m = 0; m < 12; m++) {
      const idx = []; for (let i = 0; i < n; i++) if ((startMonth - 1 + i) % 12 === m && isNum(acc[i])) idx.push(i);
      const vals = idx.map((i) => acc[i]);
      const pos = vals.filter((v) => v > 0);
      if (pos.length < 10) continue;
      const q = (vals.length - pos.length) / vals.length;
      const mean = pos.reduce((a, b) => a + b, 0) / pos.length;
      const A = Math.log(mean) - pos.reduce((a, b) => a + Math.log(b), 0) / pos.length;
      const alpha = (1 + Math.sqrt(1 + (4 * A) / 3)) / (4 * A), beta = mean / alpha;
      idx.forEach((i) => {
        const H = q + (1 - q) * gammaP(alpha, acc[i] / beta);
        out[i] = Stats.normInv(Math.min(1 - 1e-6, Math.max(1e-6, H)));
      });
    }
    return out;
  }

  // ---------- Procesado de un punto ----------
  /** Convierte la respuesta de POWER (un punto) en series mensuales alineadas y variables por punto. */
  function processPoint(pt, startYear, endYear) {
    const P = pt.parameter, months = [];
    for (let y = startYear; y <= endYear; y++) for (let m = 1; m <= 12; m++) months.push([y, m]);
    const get = (name, y, m) => { const v = P[name] && P[name][`${y}${String(m).padStart(2, "0")}`]; return isNum(v) ? v : null; };
    const out = { precip: [], snow: [], tair: [], tmax: [], tmin: [], rh: [], qv: [], wind: [], rad: [], cloud: [], ps: [], gwettop: [], gwetroot: [], gwetprof: [], eto: [], balance: [] };
    let prevT = null;
    months.forEach(([y, m]) => {
      const d = daysInMonth(y, m);
      const pr = get("PRECTOTCORR", y, m), sn = get("PRECSNOLAND", y, m);
      const t = get("T2M", y, m), rng = get("T2M_RANGE", y, m);
      out.precip.push(pr === null ? null : pr * d);
      out.snow.push(sn === null ? null : sn * d);
      out.tair.push(t); out.tmax.push(get("T2M_MAX", y, m)); out.tmin.push(get("T2M_MIN", y, m));
      out.rh.push(get("RH2M", y, m)); out.qv.push(get("QV2M", y, m)); out.wind.push(get("WS10M", y, m));
      out.rad.push(get("ALLSKY_SFC_SW_DWN", y, m)); out.cloud.push(get("CLOUD_AMT", y, m)); out.ps.push(get("PS", y, m));
      out.gwettop.push(get("GWETTOP", y, m)); out.gwetroot.push(get("GWETROOT", y, m)); out.gwetprof.push(get("GWETPROF", y, m));
      // FAO-56: Tmax/Tmin medias diarias = T2M ± rango diario medio / 2 (T2M_MAX mensual es el extremo absoluto)
      let e = null;
      if (t !== null && rng !== null) {
        const g = prevT !== null ? 0.14 * (t - prevT) : 0; // FAO-56 ec. 44
        e = eto({ tmax: t + rng / 2, tmin: t - rng / 2, tmean: t, rh: get("RH2M", y, m), rs: get("ALLSKY_SFC_SW_DWN", y, m),
          u2: get("WS2M", y, m), p: get("PS", y, m), lat: pt.lat, doy: midMonthDoy(y, m), z: pt.z || 0, g });
      }
      prevT = t;
      out.eto.push(e === null ? null : e * d);
      out.balance.push(pr === null || e === null ? null : pr * d - e * d);
    });
    return out;
  }

  /** Media de varios puntos, mes a mes. */
  function averagePoints(perPoint) {
    const keys = Object.keys(perPoint[0]), out = {};
    keys.forEach((k) => {
      const n = perPoint[0][k].length;
      out[k] = Array.from({ length: n }, (_, i) => {
        const v = perPoint.map((p) => p[k][i]).filter(isNum);
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
      });
    });
    return out;
  }

  /** Variables que se calculan sobre la serie regional. */
  function addRegionalDerived(vars) {
    vars.aridity = vars.precip.map((p, i) => (isNum(p) && isNum(vars.eto[i]) && vars.eto[i] > 0 ? p / vars.eto[i] : null));
    const clim = Array.from({ length: 12 }, () => []);
    vars.gwetroot.forEach((v, i) => { if (isNum(v)) clim[i % 12].push(v); });
    const cm = clim.map((a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null));
    vars.soil_anom = vars.gwetroot.map((v, i) => (isNum(v) && isNum(cm[i % 12]) ? v - cm[i % 12] : null));
    vars.spi12 = spi(vars.precip, 1, 12);
    return vars;
  }

  // ---------- Descarga ----------
  async function fetchPoint(lon, lat, startYear, endYear, attempt = 0) {
    const url = `${API}?parameters=${PARAMS.join(",")}&community=AG&longitude=${lon}&latitude=${lat}&start=${startYear}&end=${endYear}&format=JSON`;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!j.properties || !j.properties.parameter) throw new Error("respuesta sin datos");
      return { lon, lat, z: j.geometry && j.geometry.coordinates ? j.geometry.coordinates[2] : 0, parameter: j.properties.parameter };
    } catch (e) {
      if (attempt < 1) { await new Promise((res) => setTimeout(res, 1200)); return fetchPoint(lon, lat, startYear, endYear, attempt + 1); }
      throw e;
    }
  }

  async function pool(tasks, limit, onDone) {
    const results = new Array(tasks.length); let next = 0, done = 0;
    async function worker() { while (next < tasks.length) { const i = next++; results[i] = await tasks[i](); onDone && onDone(++done, tasks.length); } }
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
    return results;
  }

  function build(points, startYear, endYear) {
    const per = points.map((p) => processPoint(p, startYear, endYear));
    return addRegionalDerived(averagePoints(per));
  }

  /**
   * Carga una región. Devuelve { start: 'AAAA-01', vars: {id: [mensual]}, meta: {mode, fetched, points} }.
   * mode = 'live' (API en directo) o 'snapshot' (copia guardada).
   */
  async function loadRegion(region, startYear, endYear, onProgress) {
    try {
      const tasks = region.points.map((p) => () => fetchPoint(p.lonlat[0], p.lonlat[1], startYear, endYear));
      const pts = await pool(tasks, 3, onProgress);
      return { start: `${startYear}-01`, vars: build(pts, startYear, endYear), meta: { mode: "live", fetched: new Date().toISOString(), points: pts.length } };
    } catch (liveErr) {
      console.warn("NASA POWER en directo no disponible, uso la copia guardada:", liveErr);
      const r = await fetch(`data/power/${region.id}.json`, { cache: "no-cache" });
      if (!r.ok) throw new Error(`No se pudo conectar con NASA POWER (${liveErr.message}) y no hay copia guardada.`);
      const snap = await r.json();
      return { start: `${snap.start}-01`, vars: build(snap.points, snap.start, snap.end), meta: { mode: "snapshot", fetched: snap.fetched, points: snap.points.length, error: liveErr.message } };
    }
  }

  const Power = { loadRegion, build, eto, extraterrestrialRadiation, spi, gammaP, processPoint, PARAMS, API };
  if (typeof module !== "undefined" && module.exports) module.exports = Power; else root.Power = Power;
})(typeof window !== "undefined" ? window : globalThis);
