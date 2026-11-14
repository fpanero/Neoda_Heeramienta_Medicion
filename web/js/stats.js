/*
 * stats.js — Estadística de tendencias sin dependencias.
 *  - Mann-Kendall (con corrección por empates)
 *  - Pendiente de Sen con intervalo de confianza (Gilbert, 1987)
 *  - Regresión lineal (OLS) con t-test sobre la pendiente e IC
 *  - Agregación anual, anomalías mensuales (quitar ciclo estacional), z-scores
 * Funciona en el navegador (window.Stats) y en Node (require) para los tests.
 */
(function (root) {
  "use strict";

  // ---------- Distribuciones ----------
  function erf(x) {
    // Abramowitz & Stegun 7.1.26 (error < 1.5e-7)
    const s = Math.sign(x); x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

  function normInv(p) {
    // Algoritmo de Acklam
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425;
    let q, r;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  function lgamma(x) {
    const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) ser += g[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }
  function betacf(a, b, x) {
    const MAXIT = 200, EPS = 3e-14, FPMIN = 1e-300;
    let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d;
      const del = d * c; h *= del; if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  function ibeta(x, a, b) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }
  function tCdf(t, df) {
    const x = df / (df + t * t);
    const tail = 0.5 * ibeta(x, df / 2, 0.5);
    return t >= 0 ? 1 - tail : tail;
  }
  function tInv(p, df) {
    let lo = -1e3, hi = 1e3;
    for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (tCdf(mid, df) < p) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }

  // ---------- Utilidades ----------
  const isNum = (v) => v !== null && v !== undefined && Number.isFinite(v);
  function median(arr) {
    const s = [...arr].sort((a, b) => a - b), n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  function mean(arr) { const v = arr.filter(isNum); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
  function std(arr) {
    const v = arr.filter(isNum); if (v.length < 2) return null; const m = mean(v);
    return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
  }
  function pairs(x, y) { const X = [], Y = []; for (let i = 0; i < x.length; i++) if (isNum(x[i]) && isNum(y[i])) { X.push(x[i]); Y.push(y[i]); } return [X, Y]; }

  // ---------- Tests de tendencia ----------
  /** Mann-Kendall. Devuelve S, varS, z, p (bilateral), tau y la tendencia. */
  function mannKendall(yIn, alpha = 0.05) {
    const y = yIn.filter(isNum), n = y.length;
    if (n < 4) return { n, valid: false };
    let s = 0;
    for (let k = 0; k < n - 1; k++) for (let j = k + 1; j < n; j++) s += Math.sign(y[j] - y[k]);
    const counts = new Map(); y.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
    let tieTerm = 0; counts.forEach((t) => { if (t > 1) tieTerm += t * (t - 1) * (2 * t + 5); });
    const varS = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
    const z = s > 0 ? (s - 1) / Math.sqrt(varS) : s < 0 ? (s + 1) / Math.sqrt(varS) : 0;
    const p = 2 * (1 - normCdf(Math.abs(z)));
    const tau = s / (0.5 * n * (n - 1));
    const significant = p < alpha;
    return { n, valid: true, s, varS, z, p, tau, significant, trend: !significant ? "sin tendencia" : z > 0 ? "creciente" : "decreciente" };
  }

  /** Pendiente de Sen (unidades de y por unidad de x) con IC (Gilbert 1987). */
  function senSlope(xIn, yIn, alpha = 0.05) {
    const [x, y] = pairs(xIn, yIn), n = x.length;
    if (n < 4) return { valid: false };
    const slopes = [];
    for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) if (x[j] !== x[i]) slopes.push((y[j] - y[i]) / (x[j] - x[i]));
    slopes.sort((a, b) => a - b);
    const slope = median(slopes);
    const intercept = median(y.map((v, i) => v - slope * x[i]));
    const mk = mannKendall(y, alpha);
    const C = normInv(1 - alpha / 2) * Math.sqrt(mk.varS), N = slopes.length;
    const M1 = Math.round((N - C) / 2), M2 = Math.round((N + C) / 2);
    const lo = slopes[Math.max(0, Math.min(N - 1, M1 - 1))], hi = slopes[Math.max(0, Math.min(N - 1, M2))];
    return { valid: true, slope, intercept, ciLow: lo, ciHigh: hi };
  }

  /** Regresión lineal con t-test sobre la pendiente. */
  function linearRegression(xIn, yIn, alpha = 0.05) {
    const [x, y] = pairs(xIn, yIn), n = x.length;
    if (n < 4) return { valid: false };
    const mx = mean(x), my = mean(y);
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); syy += (y[i] - my) ** 2; }
    const slope = sxy / sxx, intercept = my - slope * mx;
    let sse = 0; for (let i = 0; i < n; i++) sse += (y[i] - (intercept + slope * x[i])) ** 2;
    const df = n - 2, se = Math.sqrt(sse / df / sxx), t = slope / se;
    const p = 2 * (1 - tCdf(Math.abs(t), df));
    const tc = tInv(1 - alpha / 2, df);
    return { valid: true, n, slope, intercept, se, t, df, p, r2: syy ? 1 - sse / syy : 0, ciLow: slope - tc * se, ciHigh: slope + tc * se, significant: p < alpha };
  }

  // ---------- Preparación de series ----------
  /** values mensuales desde 'AAAA-MM' → [{year, month, t (año decimal), v}] */
  function toMonthly(start, values) {
    const [y0, m0] = start.split("-").map(Number);
    return values.map((v, i) => { const k = (m0 - 1) + i; const year = y0 + Math.floor(k / 12), month = (k % 12) + 1; return { year, month, t: year + (month - 0.5) / 12, v: isNum(v) ? v : null }; });
  }
  function filterYears(rows, from, to) { return rows.filter((r) => r.year >= from && r.year <= to); }

  /** Agrega a valores anuales (sum/mean/max). Un año necesita ≥ minMonths meses válidos. */
  function annual(rows, agg = "mean", minMonths = 10) {
    const byYear = new Map();
    rows.forEach((r) => { if (!byYear.has(r.year)) byYear.set(r.year, []); if (isNum(r.v)) byYear.get(r.year).push(r.v); });
    return [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, vs]) => {
      let v = null;
      if (vs.length >= minMonths) {
        if (agg === "sum") v = vs.reduce((a, b) => a + b, 0) * (12 / vs.length);
        else if (agg === "max") v = Math.max(...vs);
        else v = vs.reduce((a, b) => a + b, 0) / vs.length;
      }
      return { year, t: year, v };
    });
  }

  /** Anomalías mensuales: resta a cada mes su media climatológica del periodo (quita el ciclo estacional). */
  function monthlyAnomalies(rows) {
    const clim = new Array(13).fill(0).map(() => []);
    rows.forEach((r) => { if (isNum(r.v)) clim[r.month].push(r.v); });
    const m = clim.map((a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null));
    return rows.map((r) => ({ ...r, v: isNum(r.v) && isNum(m[r.month]) ? r.v - m[r.month] : null }));
  }

  function zscores(vals) {
    const m = mean(vals), s = std(vals);
    return vals.map((v) => (isNum(v) && s ? (v - m) / s : null));
  }

  const Stats = { normCdf, normInv, tCdf, tInv, mannKendall, senSlope, linearRegression, toMonthly, filterYears, annual, monthlyAnomalies, zscores, mean, std, median, isNum };
  if (typeof module !== "undefined" && module.exports) module.exports = Stats; else root.Stats = Stats;
})(typeof window !== "undefined" ? window : globalThis);
