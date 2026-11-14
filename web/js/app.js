/* app.js — Interfaz de Neoda (ES/EN). Lee la configuración, descarga NASA POWER (power.js), calcula con stats.js y pinta. */
(function () {
  "use strict";
  const S = window.Stats;
  const $ = (sel) => document.querySelector(sel);
  const RECOMMENDED = ["precip", "tair", "rh", "eto", "gwetroot", "aridity"];
  const COLORS = { main: "#0a5f7e", compare: "#f2a93b", trend: "#06283d", trend2: "#b8741a", grid: "#e3eff2", worse: "#ef4e5a", better: "#0a5f7e", green: "#0fa67b", neutral: "#9db4bc" };
  const PLOT_CFG = { displayModeBar: false, responsive: true };

  const state = { region: "granada", compare: "", vars: new Set(RECOMMENDED), from: null, to: null, mode: "annual", alpha: 0.05 };
  let CFG = { variables: [], groups: [], regions: [], period: { first: 1981, last: 2025, default_from: 1991 } };
  const regionCache = new Map();
  let lastResults = null, map;

  // ---------- Idioma ----------
  let LANG = "es";
  try { if (localStorage.getItem("neoda-lang") === "en") LANG = "en"; } catch (e) { /* sin almacenamiento */ }
  const EN = () => LANG === "en";
  const T = (es, en) => (EN() ? en : es);
  const LOC = () => (EN() ? "en-GB" : "es-ES");
  const CCAA_EN = { "Andalucía": "Andalusia", "Aragón": "Aragon", "Illes Balears": "Balearic Islands", "Canarias": "Canary Islands", "Castilla-La Mancha": "Castile-La Mancha", "Castilla y León": "Castile and León", "Cataluña": "Catalonia", "Comunidad de Madrid": "Community of Madrid", "Región de Murcia": "Region of Murcia", "País Vasco": "Basque Country", "Comunitat Valenciana": "Valencian Community", "Navarra": "Navarre" };

  // ---------- Formato ----------
  const fmt = (v, d = 2) => (S.isNum(v) ? v.toLocaleString(LOC(), { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
  const fmtSigned = (v, d = 2) => (S.isNum(v) ? (v > 0 ? "+" : "") + fmt(v, d) : "—");
  const fmtP = (p) => (!S.isNum(p) ? "—" : p < 0.001 ? `< ${fmt(0.001, 3)}` : fmt(p, 3));
  const pTxt = (p) => (S.isNum(p) && p < 0.001 ? `p < ${fmt(0.001, 3)}` : `p = ${fmtP(p)}`);
  const smart = (v) => { const a = Math.abs(v); return a === 0 ? 2 : a < 0.01 ? 4 : a < 1 ? 3 : a < 100 ? 2 : 1; };
  const int = (v) => { if (!S.isNum(v)) return "—"; try { return new Intl.NumberFormat(LOC(), { maximumFractionDigits: 0, useGrouping: "always" }).format(Math.round(v)); } catch (e) { return Math.round(v).toLocaleString(LOC()); } };
  const signedInt = (v) => (S.isNum(v) ? (v > 0 ? "+" : v < 0 ? "−" : "") + int(Math.abs(v)) : "—");
  const signed1 = (v) => (S.isNum(v) ? (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v), 1) : "—");
  const pct = (x, d = 0) => (EN() ? `${fmt(x, d)}%` : `${fmt(x, d)} %`);
  const varById = (id) => CFG.variables.find((v) => v.id === id);
  const regionById = (id) => CFG.regions.find((r) => r.id === id);
  const lc = (s) => (/^[A-ZÁÉÍÓÚ]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Textos de variables, grupos y regiones en el idioma activo
  const vname = (v) => (EN() && v.en ? v.en.name : v.name);
  const vq = (v) => (EN() && v.en ? v.en.question : v.question);
  const vdesc = (v) => (EN() && v.en ? v.en.description : v.description);
  const vunits = (v) => (EN() && v.en ? v.en.units : v.units);
  const vunitsAnnual = (v) => (EN() && v.en ? v.en.units_annual || v.en.units : v.units_annual || v.units);
  const gname = (g) => (EN() && g.en ? g.en.name : g.name);
  const gdesc = (g) => (EN() && g.en ? g.en.description : g.description);
  const rname = (rOrId) => { const r = typeof rOrId === "string" ? regionById(rOrId) : rOrId; return r ? (EN() && r.id === "galicia" ? "Galicia (region)" : r.name) : ""; };
  const ccaaName = (c) => (EN() ? CCAA_EN[c] || c : c);
  const aridityClass = (x) => EN()
    ? (x < 0.05 ? "hyper-arid" : x < 0.2 ? "arid" : x < 0.5 ? "semi-arid" : x < 0.65 ? "dry sub-humid" : "humid")
    : (x < 0.05 ? "hiperárido" : x < 0.2 ? "árido" : x < 0.5 ? "semiárido" : x < 0.65 ? "subhúmedo seco" : "húmedo");
  const aridityZone = (x) => EN() ? aridityClass(x) : (x < 0.05 ? "hiperárida" : x < 0.2 ? "árida" : x < 0.5 ? "semiárida" : x < 0.65 ? "subhúmeda seca" : "húmeda");
  const pv = (n) => (EN() ? `${n} ${n === 1 ? "province" : "provinces"}` : `${n} ${n === 1 ? "provincia" : "provincias"}`);

  // ---------- Carga de datos ----------
  async function getJSON(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  }
  /** Descarga (una vez por sesión) todos los datos de NASA POWER de una región. */
  function regionData(rid, onProgress) {
    if (!regionCache.has(rid)) {
      const p = Power.loadRegion(regionById(rid), CFG.period.first, CFG.period.last, onProgress);
      p.catch(() => regionCache.delete(rid));
      regionCache.set(rid, p);
    }
    return regionCache.get(rid);
  }

  const unitsFor = (v, mode) => (mode === "monthly" ? T(`anomalía, ${vunits(v)}`, `anomaly, ${vunits(v)}`) : vunitsAnnual(v));

  /** Serie a analizar: anual agregada o mensual sin ciclo estacional. */
  async function prepared(regionId, v) {
    const data = await regionData(regionId);
    const values = data.vars[v.id];
    if (!values) return null;
    const rowsOf = (arr) => S.filterYears(S.toMonthly(data.start, arr), state.from, state.to);
    const rows = rowsOf(values);
    let annualRows;
    if (v.aggregation === "ratio") {
      // Índice anual = suma anual del numerador / suma anual del denominador (no media de cocientes mensuales)
      const num = S.annual(rowsOf(data.vars[v.ratio_of[0]]), "sum"), den = S.annual(rowsOf(data.vars[v.ratio_of[1]]), "sum");
      annualRows = num.map((r, i) => ({ ...r, v: S.isNum(r.v) && S.isNum(den[i].v) && den[i].v > 0 ? r.v / den[i].v : null }));
    } else annualRows = S.annual(rows, v.aggregation);
    const series = state.mode === "annual" ? annualRows : S.monthlyAnomalies(rows);
    const baseline = S.mean(annualRows.map((r) => r.v));
    const recent = S.mean(annualRows.slice(-10).map((r) => r.v));
    return { t: series.map((r) => r.t), v: series.map((r) => r.v), baseline, recent, source: data.meta };
  }

  function analyse(p) {
    return { mk: S.mannKendall(p.v, state.alpha), sen: S.senSlope(p.t, p.v, state.alpha), ols: S.linearRegression(p.t, p.v, state.alpha) };
  }

  // ---------- Análisis completo ----------
  function showEmpty(titleEs, titleEn, pEs, pEn) {
    $("#empty").hidden = false; $("#output").hidden = true;
    $("#empty").innerHTML = `<h2>${T(titleEs, titleEn)}</h2><p>${T(pEs, pEn)}</p>`;
  }
  async function run() {
    const btn = $("#btn-run");
    if (!state.vars.size) return showEmpty("Elige al menos un indicador", "Choose at least one indicator", "Marca uno o varios indicadores en el panel de la izquierda.", "Tick one or more indicators in the left panel.");
    if (state.from >= state.to - 4) return showEmpty("Periodo demasiado corto", "Period too short", "Elige un periodo de al menos 6 años para poder detectar una tendencia.", "Choose a period of at least 6 years to detect a trend.");
    btn.disabled = true; btn.textContent = T("Analizando…", "Analysing…");
    try {
      const regions = [state.region, state.compare].filter(Boolean);
      const vars = CFG.variables.filter((v) => state.vars.has(v.id));
      const results = {};
      const totalPts = regions.reduce((a, rid) => a + (regionCache.has(rid) ? 0 : regionById(rid).points.length), 0);
      let donePts = 0;
      const dl = () => T(`Descargando NASA POWER (${donePts}/${totalPts})…`, `Downloading NASA POWER (${donePts}/${totalPts})…`);
      if (totalPts) btn.textContent = dl();
      await Promise.all(regions.map((rid) => regionData(rid, () => { donePts++; btn.textContent = dl(); })));
      btn.textContent = T("Calculando tendencias…", "Computing trends…");
      for (const rid of regions) {
        results[rid] = {};
        await Promise.all(vars.map(async (v) => { const p = await prepared(rid, v); results[rid][v.id] = p ? { ...p, ...analyse(p) } : null; }));
      }
      const index = {};
      for (const rid of regions) index[rid] = buildIndex(results[rid], vars);
      lastResults = { regions, vars, results, index, alpha: state.alpha, mode: state.mode, from: state.from, to: state.to };
      render(lastResults);
      writeHash();
    } catch (e) {
      console.error(e); showEmpty("No se pudo completar el análisis", "The analysis could not be completed", esc(e.message), esc(e.message));
    } finally {
      btn.disabled = false; btn.textContent = T("Recalcular", "Recalculate");
    }
  }

  /** Índice combinado: media de anomalías estandarizadas con signo según su efecto sobre el agua. */
  function buildIndex(res, vars) {
    const used = vars.filter((v) => v.water_sign !== 0 && res[v.id] && res[v.id].mk.valid);
    if (!used.length) return null;
    const byT = new Map(), contrib = [];
    used.forEach((v) => {
      const r = res[v.id];
      const z = S.zscores(r.v).map((x) => (S.isNum(x) ? x * v.water_sign : null));
      z.forEach((x, i) => { if (!byT.has(r.t[i])) byT.set(r.t[i], []); if (S.isNum(x)) byT.get(r.t[i]).push(x); });
      const sen = S.senSlope(r.t, z, state.alpha);
      contrib.push({ id: v.id, perDecade: sen.valid ? sen.slope * 10 : null, significant: r.mk.significant });
    });
    const ts = [...byT.keys()].sort((a, b) => a - b);
    const minN = Math.ceil(used.length / 2);
    const p = { t: ts, v: ts.map((k) => (byT.get(k).length >= minN ? S.mean(byT.get(k)) : null)) };
    return { ...p, ...analyse(p), contrib: contrib.sort((a, b) => (a.perDecade ?? 0) - (b.perDecade ?? 0)), nVars: used.length };
  }

  // ---------- Textos generados ----------
  function interpretVar(v, r, regionName, L) {
    if (!r) return T("Todavía no hay datos de esta variable para esta región.", "No data yet for this variable in this region.");
    if (!r.mk.valid || !r.sen.valid) return T("No hay suficientes datos válidos en el periodo elegido para calcular una tendencia.", "Not enough valid data in the chosen period to compute a trend.");
    const per = r.sen.slope * 10, conf = Math.round((1 - L.alpha) * 100), units = unitsFor(v, L.mode);
    const dir = per > 0 ? T("aumenta", "increases") : per < 0 ? T("disminuye", "decreases") : T("no cambia", "does not change");
    let rel = "";
    if (L.mode === "annual" && v.pct && S.isNum(r.baseline) && r.baseline > 1e-6) {
      const x = fmtSigned((per / r.baseline) * 100, 1);
      rel = T(` (${x} % por década respecto a la media)`, ` (${x}% per decade relative to the mean)`);
    }
    let head = T(`En ${regionName}, la variable ${lc(vname(v))} ${dir} a un ritmo de ${fmt(Math.abs(per), smart(per))} ${units} cada década${rel}.`,
      `In ${regionName}, the variable ${lc(vname(v))} ${dir} at a rate of ${fmt(Math.abs(per), smart(per))} ${units} per decade${rel}.`);
    if (v.id === "aridity" && S.isNum(r.recent)) head += T(` Clasificación UNEP de los últimos 10 años: <b>${aridityClass(r.recent)}</b> (P/ETo = ${fmt(r.recent, 2)}).`, ` UNEP class over the last 10 years: <b>${aridityClass(r.recent)}</b> (P/ETo = ${fmt(r.recent, 2)}).`);
    if (v.id === "balance" && S.isNum(r.recent) && L.mode === "annual") head += T(` Balance medio de los últimos 10 años: <b>${fmtSigned(r.recent, 0)} mm/año</b> (${r.recent < 0 ? "el clima gasta más agua de la que da" : "superávit"}).`, ` Mean balance over the last 10 years: <b>${fmtSigned(r.recent, 0)} mm/year</b> (${r.recent < 0 ? "the climate spends more water than it receives" : "surplus"}).`);
    if (r.mk.significant) {
      const effect = v.water_sign === 0 ? "" : per * v.water_sign < 0 ? T(" Este cambio juega en contra de los recursos hídricos.", " This change works against water resources.") : T(" Este cambio favorece los recursos hídricos.", " This change favours water resources.");
      return head + T(` La tendencia es <b>estadísticamente significativa</b> al ${conf} % (Mann-Kendall, ${pTxt(r.mk.p)}): es muy poco probable que sea casualidad.`, ` The trend is <b>statistically significant</b> at the ${conf}% level (Mann-Kendall, ${pTxt(r.mk.p)}): it is very unlikely to be chance.`) + effect;
    }
    return head + T(` Pero la tendencia <b>no es significativa</b> (${pTxt(r.mk.p)}): puede ser variabilidad natural. Con más años de datos podría llegar a confirmarse.`, ` But the trend is <b>not significant</b> (${pTxt(r.mk.p)}): it may be natural variability. More years of data could confirm it.`);
  }

  /** Interpretación del gráfico «¿Qué variable empuja el cambio?». */
  function contribText(ix, regionName) {
    const c = ix.contrib.filter((d) => S.isNum(d.perDecade));
    const item = (d) => `${T("la variable ", "")}<b>${esc(lc(vname(varById(d.id))))}</b> (${fmtSigned(d.perDecade, 2)} ${T("σ por década", "σ per decade")}, ${d.significant ? T("comprobado", "confirmed") : T("sin cambio claro", "no clear change")})`;
    const neg = c.filter((d) => d.perDecade < 0), pos = c.filter((d) => d.perDecade > 0).reverse();
    let t = "";
    if (neg.length) {
      t += T(`En ${esc(regionName)}, lo que más está reduciendo el agua disponible es ${item(neg[0])}`, `In ${esc(regionName)}, the factor reducing available water the most is ${item(neg[0])}`);
      if (neg[1]) t += T(`, seguido de ${item(neg[1])}`, `, followed by ${item(neg[1])}`);
      t += ". ";
    } else t += T(`En ${esc(regionName)}, ninguna variable está reduciendo el agua disponible. `, `In ${esc(regionName)}, no variable is reducing available water. `);
    t += pos.length ? T(`A favor del agua juega ${item(pos[0])}.`, `Working in favour of water: ${item(pos[0])}.`) : T("Ninguna variable juega a favor del agua.", "No variable is working in favour of water.");
    return t;
  }

  function verdict(ix) {
    if (!ix || !ix.mk.valid) return { title: T("Sin índice combinado", "No combined index"), badge: "—", cls: "flat" };
    if (!ix.mk.significant) return { title: T("Sin tendencia significativa en el agua disponible", "No significant trend in available water"), badge: T("estable / no concluyente", "stable / inconclusive"), cls: "flat" };
    return ix.sen.slope < 0
      ? { title: T("Los recursos hídricos están disminuyendo", "Water resources are decreasing"), badge: T("▼ tendencia significativa", "▼ significant trend"), cls: "down" }
      : { title: T("Los recursos hídricos están aumentando", "Water resources are increasing"), badge: T("▲ tendencia significativa", "▲ significant trend"), cls: "up" };
  }

  function summaryText(L) {
    const rid = L.regions[0], ix = L.index[rid], rn = rname(rid), conf = Math.round((1 - L.alpha) * 100);
    if (!ix) return T("Las variables elegidas no entran en el índice combinado (por ejemplo, nubosidad o presión). Elige alguna variable más.", "The selected variables are not part of the combined index (e.g. cloud cover or pressure). Choose more variables.");
    const per = ix.sen.slope * 10, nm = (c) => lc(vname(varById(c.id)));
    let t = T(`Combinando ${ix.nVars} variable${ix.nVars > 1 ? "s" : ""} en ${rn} (${L.from}–${L.to}), el índice ${per < 0 ? "baja" : "sube"} ${fmt(Math.abs(per), 2)} desviaciones típicas por década (IC ${conf} %: ${fmtSigned(ix.sen.ciLow * 10)} a ${fmtSigned(ix.sen.ciHigh * 10)}; Mann-Kendall ${pTxt(ix.mk.p)}; t-test ${pTxt(ix.ols.p)}).`,
      `Combining ${ix.nVars} variable${ix.nVars > 1 ? "s" : ""} in ${rn} (${L.from}–${L.to}), the index ${per < 0 ? "falls" : "rises"} ${fmt(Math.abs(per), 2)} standard deviations per decade (${conf}% CI: ${fmtSigned(ix.sen.ciLow * 10)} to ${fmtSigned(ix.sen.ciHigh * 10)}; Mann-Kendall ${pTxt(ix.mk.p)}; t-test ${pTxt(ix.ols.p)}).`);
    const neg = ix.contrib.filter((c) => S.isNum(c.perDecade) && c.perDecade < 0).slice(0, 2);
    const pos = ix.contrib.filter((c) => S.isNum(c.perDecade) && c.perDecade > 0).slice(-2).reverse();
    const and = T(" y ", " and ");
    if (neg.length) t += T(` Lo que más resta agua: ${neg.map(nm).join(and)}.`, ` Main drains on water: ${neg.map(nm).join(and)}.`);
    if (pos.length) t += T(` Lo que más suma: ${pos.map(nm).join(and)}.`, ` Main gains: ${pos.map(nm).join(and)}.`);
    if (L.regions[1] && L.index[L.regions[1]] && L.index[L.regions[1]].mk.valid) {
      const c = L.index[L.regions[1]], cp = c.sen.slope * 10;
      t += T(` En comparación, en ${rname(L.regions[1])} el índice ${cp < 0 ? "baja" : "sube"} ${fmt(Math.abs(cp), 2)} σ/década (${c.mk.significant ? "significativo" : "no significativo"}, ${pTxt(c.mk.p)}).`,
        ` By comparison, in ${rname(L.regions[1])} the index ${cp < 0 ? "falls" : "rises"} ${fmt(Math.abs(cp), 2)} σ/decade (${c.mk.significant ? "significant" : "not significant"}, ${pTxt(c.mk.p)}).`);
    }
    if (L.mode === "monthly") t += T(" Nota: en modo mensual los meses consecutivos se parecen entre sí (autocorrelación), lo que puede exagerar la significancia; el modo anual es más conservador.", " Note: in monthly mode consecutive months resemble each other (autocorrelation), which can overstate significance; annual mode is more conservative.");
    return t;
  }

  // ---------- Render del panel ----------
  const baseLayout = (ytitle) => ({
    margin: { l: 55, r: 12, t: 34, b: 36 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "Archivo, sans-serif", size: 12, color: "#4a6572" }, separators: EN() ? ".," : ",.",
    xaxis: { gridcolor: COLORS.grid, zeroline: false }, yaxis: { title: { text: ytitle, font: { size: 11 } }, gridcolor: COLORS.grid, zerolinecolor: "#b9d3da" },
    legend: { orientation: "h", y: 1.02, yanchor: "bottom", x: 0, font: { size: 11 } }, hovermode: "x unified",
  });
  function traces(r, name, color, trendColor, dash, mode) {
    const out = [{ x: r.t, y: r.v, name, type: "scatter", mode: mode === "annual" ? "lines+markers" : "lines", line: { color, width: mode === "annual" ? 2 : 1.2, dash }, marker: { size: 5 }, connectgaps: false }];
    if (r.sen.valid) {
      const x0 = r.t[0], x1 = r.t[r.t.length - 1];
      out.push({ x: [x0, x1], y: [r.sen.intercept + r.sen.slope * x0, r.sen.intercept + r.sen.slope * x1], name: `${T("Tendencia (Sen)", "Sen trend")} ${name}`, showlegend: false, mode: "lines", line: { color: trendColor, width: 2.5, dash: "dot" }, hoverinfo: "skip" });
    }
    return out;
  }
  const sourceTag = (src) => (src.mode === "snapshot"
    ? `<span class="pill demo">${T("NASA POWER · copia", "NASA POWER · saved copy")}</span>`
    : `<span class="pill real">${T("NASA POWER · en vivo", "NASA POWER · live")}</span>`);

  function render(L) {
    $("#empty").hidden = true; $("#output").hidden = false;
    const main = L.regions[0], cmp = L.regions[1];
    const ix = L.index[main], vd = verdict(ix);
    $("#sum-title").textContent = vd.title;
    const badge = $("#sum-badge"); badge.textContent = vd.badge; badge.className = "badge " + vd.cls;
    $("#sum-text").innerHTML = esc(summaryText(L));
    if (ix) {
      const tr = traces(ix, rname(main), COLORS.main, COLORS.trend, undefined, L.mode);
      if (cmp && L.index[cmp]) tr.push(...traces(L.index[cmp], rname(cmp), COLORS.compare, COLORS.trend2, "dash", L.mode));
      Plotly.react("chart-index", tr, baseLayout(T("índice (σ)  ·  + más agua / − menos agua", "index (σ)  ·  + more water / − less water")), PLOT_CFG);
      const c = ix.contrib.filter((d) => S.isNum(d.perDecade));
      Plotly.react("chart-contrib", [{
        type: "bar", orientation: "h", y: c.map((d) => vname(varById(d.id))), x: c.map((d) => d.perDecade),
        marker: { color: c.map((d) => (d.perDecade < 0 ? COLORS.worse : COLORS.better)), opacity: c.map((d) => (d.significant ? 1 : 0.45)) },
        hovertemplate: `%{y}: %{x:.2f} ${T("σ/década", "σ/decade")}<extra></extra>`,
      }], { ...baseLayout(""), margin: { l: 10, r: 10, t: 6, b: 32 }, hovermode: "closest", yaxis: { automargin: true }, xaxis: { title: { text: T("σ por década", "σ per decade"), font: { size: 11 } }, gridcolor: COLORS.grid, zerolinecolor: "#06283d" } }, PLOT_CFG);
      $("#contrib-note").innerHTML = contribText(ix, rname(main));
    } else { Plotly.purge("chart-index"); Plotly.purge("chart-contrib"); $("#contrib-note").innerHTML = ""; }

    const cards = $("#cards"); cards.innerHTML = "";
    let snap = null;
    L.vars.forEach((v) => {
      const r = L.results[main][v.id], rc = cmp ? L.results[cmp][v.id] : null;
      if (r && r.source.mode === "snapshot") snap = r.source;
      if (rc && rc.source.mode === "snapshot") snap = rc.source;
      const el = document.createElement("article");
      el.className = "card vcard";
      const per = r && r.sen.valid ? r.sen.slope * 10 : null;
      const tag = !r ? "" : !r.mk.significant ? `<span class="tag">${T("sin tendencia significativa", "no significant trend")}</span>` : per < 0 ? `<span class="tag down">▼ ${T("significativa", "significant")}</span>` : `<span class="tag up">▲ ${T("significativa", "significant")}</span>`;
      const npts = regionById(main).points.length;
      el.innerHTML = `
        <h3>${esc(vname(v))} ${r ? sourceTag(r.source) : ""} ${tag}</h3>
        <p class="interp">${interpretVar(v, r, rname(main), L)}</p>
        <div class="chart" id="ch-${v.id}"></div>
        ${r ? statsTable(r, rc, L) : ""}
        <p class="src"><i>${esc(vq(v))}</i><br>${esc(vdesc(v))}<br>${T("Fuente", "Source")}: ${v.power ? `NASA POWER · <code>${esc(v.power)}</code>` : T("calculada a partir de NASA POWER", "computed from NASA POWER")} · ${T(`media de ${npts} puntos de la región`, `mean of ${npts} points in the region`)}</p>`;
      cards.appendChild(el);
      if (r) {
        const tr = traces(r, rname(main), COLORS.main, COLORS.trend, undefined, L.mode);
        if (rc) tr.push(...traces(rc, rname(cmp), COLORS.compare, COLORS.trend2, "dash", L.mode));
        Plotly.newPlot(`ch-${v.id}`, tr, baseLayout(unitsFor(v, L.mode)), PLOT_CFG);
      }
    });
    const banner = $("#demo-banner");
    banner.hidden = !snap;
    if (snap) banner.innerHTML = T(`<strong>Sin conexión con NASA POWER.</strong> Se muestran datos de la copia guardada el ${new Date(snap.fetched).toLocaleDateString(LOC())}. Pulsa «Recalcular» para reintentar en directo.`,
      `<strong>No connection to NASA POWER.</strong> Showing data from the copy saved on ${new Date(snap.fetched).toLocaleDateString(LOC())}. Press «Recalculate» to retry live.`);
    const m0 = L.results[main][L.vars[0].id];
    $("#data-info").textContent = !m0 ? "" : T(`Datos: NASA POWER (MERRA-2 + GPM, rejilla 0,5° × 0,625°) · ${m0.source.mode === "live" ? "descargados en vivo" : "copia guardada"} el ${new Date(m0.source.fetched).toLocaleString(LOC())} · ${m0.source.points} puntos por región.`,
      `Data: NASA POWER (MERRA-2 + GPM, 0.5° × 0.625° grid) · ${m0.source.mode === "live" ? "downloaded live" : "saved copy"} on ${new Date(m0.source.fetched).toLocaleString(LOC())} · ${m0.source.points} points per region.`);
  }

  function statsRows(L) {
    const conf = Math.round((1 - L.alpha) * 100);
    return [
      [T("Tasa de cambio (Sen) por década", "Rate of change (Sen) per decade"), (x) => (x.sen.valid ? fmtSigned(x.sen.slope * 10, smart(x.sen.slope * 10)) : "—")],
      [T(`IC ${conf} % de la tasa`, `${conf}% CI of the rate`), (x) => (x.sen.valid ? `${fmtSigned(x.sen.ciLow * 10, smart(x.sen.ciLow * 10))} … ${fmtSigned(x.sen.ciHigh * 10, smart(x.sen.ciHigh * 10))}` : "—")],
      [T("Mann-Kendall p-valor", "Mann-Kendall p-value"), (x) => fmtP(x.mk.p)],
      [T("τ de Kendall", "Kendall's τ"), (x) => fmt(x.mk.tau, 2)],
      [T("t-test p-valor (regresión)", "t-test p-value (regression)"), (x) => fmtP(x.ols.p)],
      [T("R² de la regresión", "R² of the regression"), (x) => fmt(x.ols.r2, 2)],
      [T("Nº de datos", "No. of data points"), (x) => String(x.mk.n ?? "—")],
    ];
  }
  function statsTable(r, rc, L) {
    const col = (x, f) => `<td class="num-c">${f(x)}</td>`;
    const head = rc ? `<tr><td></td><td class="num-c"><b>${esc(rname(L.regions[0]))}</b></td><td class="num-c"><b>${esc(rname(L.regions[1]))}</b></td></tr>` : "";
    return `<table class="stats">${head}${statsRows(L).map(([label, f], i) => `<tr class="${i < 3 && r.mk.significant ? "sig" : ""}"><td>${label}</td>${col(r, f)}${rc ? col(rc, f) : ""}</tr>`).join("")}</table>`;
  }

  // ---------- Informe PDF ----------
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("No se pudo cargar " + src)); document.head.appendChild(s); });
  }
  let pdfLibs = null;
  const ensurePdfLibs = () => (pdfLibs = pdfLibs || loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js")
    .then(() => loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js")));
  /** El PDF usa la fuente Helvetica (WinAnsi): se sustituyen los símbolos que no admite. */
  const pdfText = (s) => String(s).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/−/g, "-").replace(/σ/g, T("desv.", "sd")).replace(/≈/g, "~").replace(/τ/g, "tau").replace(/α/g, "alfa").replace(/[▲▼]/g, "").replace(/…/g, "...").replace(/ /g, " ").trim();

  async function downloadPDF() {
    if (!lastResults) return;
    const btn = $("#btn-pdf"), label = btn.querySelector("span"), old = label.textContent;
    label.textContent = T("Preparando PDF…", "Preparing PDF…"); btn.disabled = true;
    try {
      await ensurePdfLibs();
      const L = lastResults, { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M0 = 40, CW = W - 2 * M0;
      const ABYSS = [6, 40, 61], SLATE = [74, 101, 114], WORSE = [196, 45, 58], BETTER = [11, 125, 93];
      const main = L.regions[0], cmp = L.regions[1], conf = Math.round((1 - L.alpha) * 100);
      // Cabecera
      doc.setFillColor(...ABYSS); doc.rect(0, 0, W, 78, "F");
      doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(20);
      doc.text(T("Neoda · Informe de tendencias del agua", "Neoda · Water trend report"), M0, 38);
      doc.setFont("helvetica", "normal"); doc.setFontSize(11);
      doc.text(pdfText(`${rname(main)}${cmp ? T(" frente a ", " vs ") + rname(cmp) : ""} · ${L.from}-${L.to}`), M0, 60);
      // Ficha
      let y = 104;
      doc.setTextColor(...SLATE); doc.setFontSize(9.5);
      const src = L.results[main][L.vars[0].id];
      const meta = [
        [T("Provincia", "Province"), rname(main)], [T("Comparación", "Comparison"), cmp ? rname(cmp) : T("ninguna", "none")],
        [T("Periodo", "Period"), `${L.from}-${L.to}`], [T("Resolución", "Resolution"), L.mode === "annual" ? T("anual", "annual") : T("mensual sin ciclo estacional", "monthly, seasonal cycle removed")],
        [T("Confianza", "Confidence"), `${conf} %`], [T("Fuente", "Source"), `NASA POWER (${src && src.source.mode === "live" ? T("descargado en vivo", "downloaded live") : T("copia guardada", "saved copy")})`],
        [T("Generado", "Generated"), new Date().toLocaleString(LOC())],
      ];
      meta.forEach(([k, v], i) => { const cx = M0 + (i % 2) * (CW / 2), cy = y + Math.floor(i / 2) * 14; doc.setFont("helvetica", "bold"); doc.text(pdfText(k) + ":", cx, cy); doc.setFont("helvetica", "normal"); doc.text(pdfText(v), cx + 70, cy); });
      y += Math.ceil(meta.length / 2) * 14 + 16;
      // Conclusión
      const vd = verdict(L.index[main]);
      doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...(vd.cls === "down" ? WORSE : vd.cls === "up" ? BETTER : ABYSS));
      doc.text(pdfText(vd.title), M0, y); y += 16;
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...ABYSS);
      const sum = doc.splitTextToSize(pdfText(summaryText(L)), CW); doc.text(sum, M0, y); y += sum.length * 12.5 + 8;
      // Gráfico del índice
      if (L.index[main] && document.getElementById("chart-index").data) {
        try {
          const img = await Plotly.toImage("chart-index", { format: "png", width: 1000, height: 380 });
          const ih = CW * 0.38; doc.addImage(img, "PNG", M0, y, CW, ih); y += ih + 10;
        } catch (e) { console.warn("Sin imagen del gráfico", e); }
      }
      // Tabla por región
      const trendLabel = (v, r) => {
        if (!r || !r.mk.valid) return T("sin datos", "no data");
        if (!r.mk.significant) return T("Sin cambio claro", "No clear change");
        const up = r.sen.slope > 0;
        return (up ? T("Sube", "Rises") : T("Baja", "Falls")) + T(" (comprobado)", " (confirmed)");
      };
      const rowColor = (v, r) => (!r || !r.mk.significant || v.water_sign === 0 ? null : r.sen.slope * v.water_sign < 0 ? WORSE : BETTER);
      for (const rid of L.regions) {
        if (y > H - 160) { doc.addPage(); y = 50; }
        doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...ABYSS);
        doc.text(pdfText(T(`Indicadores · ${rname(rid)}`, `Indicators · ${rname(rid)}`)), M0, y); y += 6;
        const body = L.vars.map((v) => {
          const r = L.results[rid][v.id], ok = r && r.sen.valid;
          return [pdfText(vname(v)), ok ? pdfText(`${fmtSigned(r.sen.slope * 10, smart(r.sen.slope * 10))} ${unitsFor(v, L.mode)}`) : "-",
            ok ? pdfText(`${fmtSigned(r.sen.ciLow * 10, smart(r.sen.ciLow * 10))} / ${fmtSigned(r.sen.ciHigh * 10, smart(r.sen.ciHigh * 10))}`) : "-",
            r ? pdfText(fmtP(r.mk.p)) : "-", pdfText(trendLabel(v, r))];
        });
        doc.autoTable({
          startY: y + 4, margin: { left: M0, right: M0 }, theme: "grid",
          head: [[T("Indicador", "Indicator"), T("Cambio por década", "Change per decade"), T(`IC ${conf} %`, `${conf}% CI`), "p (Mann-Kendall)", T("Tendencia", "Trend")]],
          body, styles: { font: "helvetica", fontSize: 8.5, cellPadding: 4, textColor: ABYSS, lineColor: [214, 231, 236] },
          headStyles: { fillColor: [10, 95, 126], textColor: 255, fontStyle: "bold" },
          alternateRowStyles: { fillColor: [245, 251, 252] },
          didParseCell: (d) => { if (d.section === "body" && d.column.index === 4) { const v = L.vars[d.row.index], c = rowColor(v, L.results[rid][v.id]); if (c) { d.cell.styles.textColor = c; d.cell.styles.fontStyle = "bold"; } } },
        });
        y = doc.lastAutoTable.finalY + 18;
      }
      // Interpretación en texto
      if (y > H - 120) { doc.addPage(); y = 50; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...ABYSS);
      doc.text(T("Interpretación", "Interpretation"), M0, y); y += 16;
      for (const v of L.vars) {
        const txt = doc.splitTextToSize(pdfText(interpretVar(v, L.results[main][v.id], rname(main), L)), CW);
        if (y + 14 + txt.length * 12 > H - 50) { doc.addPage(); y = 50; }
        doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text(pdfText(vname(v)), M0, y); y += 13;
        doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.text(txt, M0, y); y += txt.length * 12 + 8;
      }
      // Pie en cada página
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i); doc.setFontSize(8); doc.setTextColor(...SLATE); doc.setFont("helvetica", "normal");
        doc.text(pdfText(T("Neoda · NASA Space Apps Challenge 2026 · Datos: NASA POWER · Método: pendiente de Sen + Mann-Kendall", "Neoda · NASA Space Apps Challenge 2026 · Data: NASA POWER · Method: Sen's slope + Mann-Kendall")), M0, H - 22);
        doc.text(`${i} / ${pages}`, W - M0, H - 22, { align: "right" });
      }
      doc.save(`neoda_${main}${cmp ? "_vs_" + cmp : ""}_${L.from}-${L.to}.pdf`);
    } catch (e) {
      console.error(e); alert(T("No se pudo generar el PDF: ", "The PDF could not be generated: ") + e.message);
    } finally { label.textContent = old; btn.disabled = false; }
  }

  // ---------- Controles del panel ----------
  function renderControls() {
    const byCcaa = new Map();
    CFG.regions.forEach((r) => { const k = r.ccaa || "Otras"; if (!byCcaa.has(k)) byCcaa.set(k, []); byCcaa.get(k).push(r); });
    const regOpts = [...byCcaa.keys()].sort((a, b) => ccaaName(a).localeCompare(ccaaName(b), LOC())).map((k) =>
      `<optgroup label="${esc(ccaaName(k))}">${byCcaa.get(k).map((r) => `<option value="${r.id}">${esc(rname(r))}</option>`).join("")}</optgroup>`).join("");
    $("#sel-region").innerHTML = regOpts;
    $("#sel-compare").innerHTML = `<option value="">${T("— Ninguna —", "— None —")}</option>` + regOpts;
    $("#sel-alpha").innerHTML = [["0.10", 90], ["0.05", 95], ["0.01", 99]].map(([a, c]) => `<option value="${a}">${EN() ? `${c}% (α = ${a})` : `${c} % (α = ${a.replace(".", ",")})`}</option>`).join("");
    const list = $("#var-list"); list.innerHTML = "";
    CFG.groups.forEach((g) => {
      const vs = CFG.variables.filter((v) => v.group === g.id);
      if (!vs.length) return;
      const box = document.createElement("div"); box.className = "var-group";
      box.innerHTML = `<h4 title="${esc(gdesc(g))}">${esc(gname(g))}</h4>` + vs.map((v) => {
        const sc = v.water_sign > 0 ? "pos" : v.water_sign < 0 ? "neg" : "zero", st = v.water_sign > 0 ? "+" : v.water_sign < 0 ? "−" : "·";
        const eff = v.water_sign > 0 ? T("más = más agua", "more = more water") : v.water_sign < 0 ? T("más = menos agua", "more = less water") : T("no entra en el índice", "not part of the index");
        const tip = `${vq(v)} ${vdesc(v)} ${T("Unidades", "Units")}: ${vunits(v)}. ${T("Efecto sobre el agua", "Effect on water")}: ${eff}.${v.tier === 2 ? T(" (Variable calculada)", " (Computed variable)") : ""}`;
        return `<label class="var-item"><input type="checkbox" value="${v.id}"><span class="vname">${esc(vname(v))}${v.tier === 2 ? ' <small class="calc">calc.</small>' : ""}</span><span class="sign ${sc}" title="${T("Efecto sobre el agua", "Effect on water")}">${st}</span><button type="button" class="info" data-tip="${esc(tip)}" aria-label="${T("Qué es", "What is")} ${esc(vname(v))}">i</button></label>`;
      }).join("");
      list.appendChild(box);
    });
    syncControls();
  }

  function setupControls() {
    const minY = CFG.period.first, maxY = CFG.period.last;
    const yrs = []; for (let y = minY; y <= maxY; y++) yrs.push(`<option>${y}</option>`);
    $("#sel-from").innerHTML = yrs.join(""); $("#sel-to").innerHTML = yrs.join("");
    if (state.from === null) state.from = CFG.period.default_from || minY;
    if (state.to === null) state.to = maxY;
    const list = $("#var-list");
    list.addEventListener("change", (e) => { if (e.target.type === "checkbox") { e.target.checked ? state.vars.add(e.target.value) : state.vars.delete(e.target.value); autoRun(); } });
    list.addEventListener("click", (e) => { if (e.target.classList.contains("info")) e.preventDefault(); });
    document.querySelectorAll(".quick button").forEach((b) => b.addEventListener("click", () => {
      const p = b.dataset.preset;
      state.vars = new Set(p === "todas" ? CFG.variables.map((v) => v.id) : p === "ninguna" ? [] : RECOMMENDED);
      syncControls(); autoRun();
    }));
    $("#sel-region").addEventListener("change", (e) => { state.region = e.target.value; if (state.compare === state.region) state.compare = ""; highlightMap(); syncControls(); autoRun(); });
    $("#sel-compare").addEventListener("change", (e) => { state.compare = e.target.value === state.region ? "" : e.target.value; highlightMap(); syncControls(); autoRun(); });
    $("#sel-from").addEventListener("change", (e) => { state.from = +e.target.value; autoRun(); });
    $("#sel-to").addEventListener("change", (e) => { state.to = +e.target.value; autoRun(); });
    $("#sel-alpha").addEventListener("change", (e) => { state.alpha = +e.target.value; autoRun(); renderMap(); });
    document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", (e) => { state.mode = e.target.value; autoRun(); }));
    $("#btn-run").addEventListener("click", run);
    $("#btn-pdf").addEventListener("click", downloadPDF);
  }

  function syncControls() {
    $("#sel-region").value = state.region; $("#sel-compare").value = state.compare;
    $("#sel-from").value = state.from; $("#sel-to").value = state.to;
    $("#sel-alpha").value = state.alpha === 0.1 ? "0.10" : String(state.alpha);
    document.querySelectorAll('input[name="mode"]').forEach((r) => (r.checked = r.value === state.mode));
    document.querySelectorAll("#var-list input").forEach((c) => (c.checked = state.vars.has(c.value)));
  }

  // ---------- Mapa pequeño del panel ----------
  let geoLayers = {}, pointLayer = null, geoPromise = null;
  const geo = () => (geoPromise = geoPromise || getJSON("config/regions.geojson"));
  async function buildMap() {
    if (!window.L) return;
    map = L.map("map", { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([39.5, -4], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 10 }).addTo(map);
    pointLayer = L.layerGroup().addTo(map);
    let gj;
    try { gj = await geo(); } catch (e) { console.warn("Sin límites para el mapa", e); return; }
    gj.features.forEach((f) => {
      const r = regionById(f.properties.id); if (!r) return;
      const layer = L.geoJSON(f, { style: { weight: 0.7, color: "#9db4bc", fillOpacity: 0.04 } });
      layer.bindTooltip("", { sticky: true });
      layer.on("click", (ev) => {
        if (ev.originalEvent && ev.originalEvent.shiftKey) { if (r.id !== state.region) state.compare = r.id; }
        else { state.region = r.id; if (state.compare === r.id) state.compare = ""; }
        syncControls(); highlightMap(); autoRun();
      });
      geoLayers[r.id] = layer;
      if (r.type === "provincia") layer.addTo(map);
    });
    highlightMap();
  }
  function highlightMap() {
    if (!map) return;
    pointLayer && pointLayer.clearLayers();
    const focus = [];
    Object.entries(geoLayers).forEach(([id, layer]) => {
      const r = regionById(id), sel = id === state.region, cmp = id === state.compare;
      // Las comunidades (p. ej. Galicia) solo se dibujan cuando están elegidas, para no tapar sus provincias
      if (r.type !== "provincia") { if (sel || cmp) layer.addTo(map); else map.removeLayer(layer); }
      layer.setStyle({ color: sel ? "#0a5f7e" : cmp ? "#f2a93b" : "#9db4bc", weight: sel || cmp ? 2.5 : 0.7, fillOpacity: sel || cmp ? 0.3 : 0.04, fillColor: cmp ? "#f2a93b" : "#0a5f7e" });
      layer.setTooltipContent(`${esc(rname(r))}<br><small>${T("clic: elegir · Mayús+clic: comparar", "click: select · Shift+click: compare")}</small>`);
      if (sel || cmp) { layer.bringToFront(); focus.push(layer); }
    });
    [state.region, state.compare].filter(Boolean).forEach((rid) => (regionById(rid).points || []).forEach((p) =>
      L.circleMarker([p.lonlat[1], p.lonlat[0]], { radius: 3, color: "#06283d", weight: 1, fillOpacity: 0.9 }).bindTooltip(`${esc(rname(rid))}: ${T("punto de muestreo NASA POWER", "NASA POWER sampling point")}`).addTo(pointLayer)));
    if (focus.length) map.fitBounds(L.featureGroup(focus).getBounds().pad(0.25), { animate: true, maxZoom: 8 });
  }

  // ---------- Mapa de España (coropletas) ----------
  const ICON = (d) => `<svg class="ico" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    tair: ICON('<path d="M13 5a3 3 0 0 1 6 0v13a6 6 0 1 1-6 0Z"/><path d="M16 12v10"/>'),
    eto: ICON('<circle cx="16" cy="18" r="5"/><path d="M16 6v3M6 18h3M23 18h3M9 11l2 2M23 11l-2 2"/><path d="M12 3c1 1 1 2 0 3M20 3c1 1 1 2 0 3"/>'),
    precip: ICON('<path d="M9 17a5 5 0 0 1 1-10 7 7 0 0 1 13 2 4 4 0 0 1 0 8Z"/><path d="M11 21l-1 4M17 21l-1 4M23 21l-1 4"/>'),
    balance: ICON('<path d="M16 5v22M8 27h16M6 9h20"/><path d="M6 9l-3 8a3 3 0 0 0 6 0ZM26 9l-3 8a3 3 0 0 0 6 0Z"/>'),
    gwetroot: ICON('<path d="M4 20h24"/><path d="M16 20v-7M16 13c0-4 3-6 7-6 0 4-3 6-7 6ZM16 15c0-3-2-5-6-5 0 3 2 5 6 5Z"/><path d="M10 24h2M18 25h2M14 27h1"/>'),
    aridity: ICON('<path d="M3 26h26"/><path d="M16 26V8a2 2 0 0 1 4 0v18M20 14h3V11a2 2 0 0 1 4 0v4a3 3 0 0 1-3 3h-4M16 17h-3a3 3 0 0 1-3-3v-3a2 2 0 0 1 4 0v3h2"/>'),
  };
  // Preguntas del mapa, en lenguaje llano (ES / EN)
  const MAP_Q = {
    es: {
      tair: { q: "¿Dónde hace más calor que antes?", worse: "Hace más calor", better: "Hace menos calor", none: "La temperatura apenas ha cambiado", lo: "más fresco", hi: "más calor", noun: "La temperatura" },
      eto: { q: "¿Dónde necesita más riego el campo?", worse: "El campo necesita más riego", better: "El campo necesita menos riego", none: "La necesidad de riego apenas ha cambiado", lo: "menos riego", hi: "más riego", noun: "La necesidad de riego" },
      precip: { q: "¿Dónde llueve más o menos que antes?", worse: "Llueve menos", better: "Llueve más", none: "La lluvia apenas ha cambiado", lo: "menos lluvia", hi: "más lluvia", noun: "La lluvia" },
      balance: { q: "¿Dónde falta más agua?", worse: "Falta más agua", better: "Falta menos agua", none: "El balance del agua apenas ha cambiado", lo: "falta agua", hi: "sobra agua", noun: "El balance del agua" },
      gwetroot: { q: "¿Dónde se está secando el suelo?", worse: "El suelo se está secando", better: "El suelo está más húmedo", none: "La humedad del suelo apenas ha cambiado", lo: "suelo seco", hi: "suelo húmedo", noun: "La humedad del suelo" },
      aridity: { q: "¿Dónde avanza la desertificación?", worse: "La desertificación avanza", better: "La desertificación retrocede", none: "La aridez apenas ha cambiado", lo: "más árido", hi: "más húmedo", noun: "La aridez" },
    },
    en: {
      tair: { q: "Where is it hotter than before?", worse: "It is getting hotter", better: "It is getting cooler", none: "Temperature has barely changed", lo: "cooler", hi: "hotter", noun: "Temperature" },
      eto: { q: "Where do farms need more irrigation?", worse: "Farms need more irrigation", better: "Farms need less irrigation", none: "Irrigation need has barely changed", lo: "less irrigation", hi: "more irrigation", noun: "Irrigation need" },
      precip: { q: "Where does it rain more or less than before?", worse: "It rains less", better: "It rains more", none: "Rainfall has barely changed", lo: "less rain", hi: "more rain", noun: "Rainfall" },
      balance: { q: "Where is water most lacking?", worse: "The water shortage is growing", better: "The water shortage is easing", none: "The water balance has barely changed", lo: "water deficit", hi: "water surplus", noun: "Water balance" },
      gwetroot: { q: "Where is the soil drying out?", worse: "The soil is drying out", better: "The soil is getting wetter", none: "Soil moisture has barely changed", lo: "dry soil", hi: "wet soil", noun: "Soil moisture" },
      aridity: { q: "Where is desertification advancing?", worse: "Desertification is advancing", better: "Desertification is receding", none: "Aridity has barely changed", lo: "more arid", hi: "more humid", noun: "Aridity" },
    },
  };
  const QS = () => MAP_Q[LANG];
  const LITRES = new Set(["precip", "eto", "balance", "snow"]);
  const M = { map: null, layers: {}, data: null, var: "eto", mode: "trend", from: null, to: null };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(",")})`; };
  const NEUTRAL = "#eef5f7";
  const diverging = (t) => { t = Math.max(-1, Math.min(1, t)); return t < 0 ? mix(NEUTRAL, COLORS.worse, -t) : mix(NEUTRAL, COLORS.better, t); };
  const quantile = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] : 0; };

  function computeMap() {
    const D = M.data, out = {};
    const idx = D.years.map((y, i) => (y >= M.from && y <= M.to ? i : -1)).filter((i) => i >= 0);
    Object.entries(D.regions).forEach(([rid, vals]) => {
      const reg = regionById(rid); if (!reg || reg.type !== "provincia") return; // el mapa es por provincias
      const series = vals[M.var]; if (!series) return;
      const t = idx.map((i) => D.years[i]), y = idx.map((i) => series[i]);
      if (M.mode === "mean") { out[rid] = { value: S.mean(y) }; return; }
      const mk = S.mannKendall(y, state.alpha), sen = S.senSlope(t, y, state.alpha);
      out[rid] = mk.valid && sen.valid ? { value: sen.slope * 10, p: mk.p, significant: mk.significant, mean: S.mean(y) } : { value: null };
    });
    return out;
  }

  function styleFor(res, v, scale) {
    if (!res || !S.isNum(res.value)) return { fillColor: "#ddd", fillOpacity: 0.4, color: "#999", weight: 0.5, dashArray: null };
    if (M.mode === "trend") {
      const eff = res.value * (v.water_sign || 1);
      return { fillColor: res.significant ? diverging(Math.sign(eff) * (0.35 + 0.65 * Math.min(1, Math.abs(eff) / scale.max))) : NEUTRAL, fillOpacity: res.significant ? 0.92 : 0.8, color: res.significant ? "#ffffff" : "#b9cdd3", weight: res.significant ? 1.2 : 0.8, dashArray: res.significant ? null : "3 3" };
    }
    let tt = scale.max > scale.min ? (res.value - scale.min) / (scale.max - scale.min) : 0.5;
    if (v.water_sign < 0) tt = 1 - tt;
    return { fillColor: v.water_sign === 0 ? mix(NEUTRAL, "#06283d", tt) : diverging(tt * 2 - 1), fillOpacity: 0.9, color: "#ffffff", weight: 1.2, dashArray: null };
  }

  /** Texto llano de un valor del mapa (cambio por década o valor medio). */
  function plainValue(v, r) {
    if (!r || !S.isNum(r.value)) return T("sin datos", "no data");
    const x = r.value;
    if (M.mode === "trend") {
      if (v.id === "tair") return T(`${signed1(x)} °C cada década`, `${signed1(x)} °C per decade`);
      if (LITRES.has(v.id)) return T(`${x >= 0 ? "+" : "−"}${int(Math.abs(x))} litros/m² al año, cada década`, `${x >= 0 ? "+" : "−"}${int(Math.abs(x))} litres/m² a year, per decade`);
      if (S.isNum(r.mean) && Math.abs(r.mean) > 1e-9) { const p = pct(Math.abs((x / r.mean) * 100), 1); return x >= 0 ? T(`sube un ${p} cada década`, `rises ${p} per decade`) : T(`baja un ${p} cada década`, `falls ${p} per decade`); }
      return T(`${fmtSigned(x, smart(x))} cada década`, `${fmtSigned(x, smart(x))} per decade`);
    }
    if (v.id === "tair") return T(`${fmt(x, 1)} °C de media`, `${fmt(x, 1)} °C on average`);
    if (v.id === "aridity") return T(`zona ${aridityZone(x)} (${fmt(x, 2)})`, `${aridityZone(x)} zone (${fmt(x, 2)})`);
    if (v.id.startsWith("gwet")) return T(`${int(x * 100)} % de humedad`, `${int(x * 100)}% moisture`);
    if (LITRES.has(v.id)) return T(`${v.id === "balance" ? signedInt(x) : int(x)} litros/m² al año`, `${v.id === "balance" ? signedInt(x) : int(x)} litres/m² a year`);
    return `${fmt(x, smart(x))} ${vunitsAnnual(v)}`;
  }

  function renderQuestions() {
    $("#m-quick").innerHTML = Object.entries(QS()).map(([id, q]) =>
      `<button type="button" class="q-btn${id === M.var ? " on" : ""}" data-var="${id}" aria-pressed="${id === M.var}">${ICONS[id] || ""}<span>${esc(q.q)}</span></button>`).join("");
  }

  function renderMap() {
    if (!M.data || !M.map) return;
    const v = varById(M.var), res = computeMap(), Q = QS()[M.var];
    const vals = Object.values(res).map((r) => r.value).filter(S.isNum);
    const scale = M.mode === "trend"
      ? { max: quantile(Object.values(res).filter((r) => S.isNum(r.value)).map((r) => Math.abs(r.value)), 0.95) || 1 }
      : { min: quantile(vals, 0.02), max: quantile(vals, 0.98) };
    Object.entries(M.layers).forEach(([rid, layer]) => {
      const r = res[rid];
      layer.setStyle(styleFor(r, v, scale));
      const tag = M.mode === "trend" && r && S.isNum(r.value) ? `<br><i>${r.significant ? T("cambio comprobado", "confirmed change") : T("sin cambio claro", "no clear change")}</i>` : "";
      layer.setTooltipContent(`<b>${esc(rname(rid))}</b><br>${esc(Q ? Q.noun : vname(v))}: ${plainValue(v, r)}${tag}`);
    });

    const entries = Object.entries(res).filter(([, r]) => S.isNum(r.value)), N = entries.length;
    const ans = $("#m-answer"), lg = $("#m-legend");
    const eff = ([, r]) => r.value * (v.water_sign || 1);
    if (M.mode === "trend") {
      const worse = entries.filter((x) => x[1].significant && eff(x) < 0), better = entries.filter((x) => x[1].significant && eff(x) > 0);
      const none = N - worse.length - better.length;
      const mainN = Math.max(worse.length, better.length), other = N - none - mainN;
      const [mainTxt, otherTxt] = worse.length >= better.length ? [Q.worse, Q.better] : [Q.better, Q.worse];
      const all = mainN === N ? T("todas las provincias", "every province") : pv(mainN);
      const rest = none === 0 ? "" : T(` En ${none === 1 ? "la otra" : "las otras " + none} no hay un cambio claro.`, ` In the ${none === 1 ? "remaining one" : "other " + none} there is no clear change.`);
      ans.innerHTML = mainN === 0
        ? `<b>${esc(Q.none)}.</b> ${T(`Desde ${M.from} no hay un cambio comprobado en ninguna provincia.`, `Since ${M.from} there is no confirmed change in any province.`)}`
        : `<b>${T(`Desde ${M.from}, ${esc(lc(mainTxt))} en ${all}.`, `Since ${M.from}, ${esc(lc(mainTxt))} in ${all}.`)}</b>${other ? ` ${esc(otherTxt)} ${T("en", "in")} ${pv(other)}.` : ""}${rest}`;
      lg.innerHTML = `<ul class="swatches">
        <li><span class="sw3" style="background:${COLORS.worse}"></span>${T("Empeora", "Worse")} <small>${T("(comprobado)", "(confirmed)")}</small></li>
        <li><span class="sw3" style="background:${COLORS.better}"></span>${T("Mejora", "Better")} <small>${T("(comprobado)", "(confirmed)")}</small></li>
        <li><span class="sw3 pale"></span>${T("Sin cambio claro", "No clear change")}</li></ul>
        <p class="note">${T("Cuanto más intenso el color, mayor el cambio.", "The stronger the colour, the bigger the change.")}</p>`;
    } else {
      const dir = v.water_sign < 0 ? -1 : 1; // de «peor» a «mejor» para el agua
      const sorted = [...entries].sort((a, b) => (a[1].value - b[1].value) * dir);
      const names = (arr) => arr.map(([rid]) => rname(rid)).join(", ");
      ans.innerHTML = `<b>${T("Peor situación", "Worst situation")}:</b> ${esc(names(sorted.slice(0, 3)))}.<br><b>${T("Mejor situación", "Best situation")}:</b> ${esc(names(sorted.slice(-3).reverse()))}.`;
      const lowCol = v.water_sign === 0 ? NEUTRAL : v.water_sign > 0 ? COLORS.worse : COLORS.better;
      const highCol = v.water_sign === 0 ? "#06283d" : v.water_sign > 0 ? COLORS.better : COLORS.worse;
      lg.innerHTML = `<div class="bar" style="background: linear-gradient(90deg, ${lowCol}, ${NEUTRAL}, ${highCol})"></div>
        <div class="ends"><span>${esc(Q.lo)}</span><span>${esc(Q.hi)}</span></div>
        <p class="note">${T(`Media de ${M.from} a ${M.to}.`, `Mean from ${M.from} to ${M.to}.`)}</p>`;
    }
    // Ranking (panel derecho)
    const li = ([rid, r]) => `<li data-rid="${rid}">${esc(rname(rid))}<span>${plainValue(v, r)}</span></li>`;
    const list = (title, rows) => `<h4>${title}</h4>` + (rows.length ? `<ol>${rows.map(li).join("")}</ol>` : `<p class="note">${T("Ninguna.", "None.")}</p>`);
    let html;
    if (M.mode === "trend") {
      const sig = entries.filter(([, r]) => r.significant);
      html = list(`<span class="dot red"></span> ${T("Donde más empeora", "Where it worsens most")}`, sig.filter((x) => eff(x) < 0).sort((a, b) => eff(a) - eff(b)).slice(0, 5))
        + list(`<span class="dot green"></span> ${T("Donde más mejora", "Where it improves most")}`, sig.filter((x) => eff(x) > 0).sort((a, b) => eff(b) - eff(a)).slice(0, 5));
    } else {
      const dir = v.water_sign < 0 ? -1 : 1;
      const sorted = [...entries].sort((a, b) => (a[1].value - b[1].value) * dir);
      html = list(T("Peor situación", "Worst situation"), sorted.slice(0, 5)) + list(T("Mejor situación", "Best situation"), sorted.slice(-5).reverse());
    }
    $("#m-rank").innerHTML = html;
  }

  async function buildChoropleth() {
    if (!window.L || !$("#chmap")) return;
    M.from = CFG.period.default_from; M.to = CFG.period.last;
    renderQuestions();
    $("#m-quick").addEventListener("click", (e) => {
      const b = e.target.closest(".q-btn"); if (!b) return;
      M.var = b.dataset.var;
      document.querySelectorAll("#m-quick .q-btn").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
      renderMap();
    });
    document.querySelectorAll('input[name="m-mode"]').forEach((r) => r.addEventListener("change", (e) => { M.mode = e.target.value; renderMap(); }));
    $("#m-rank").addEventListener("click", (e) => { const li = e.target.closest("li"); if (li) selectFromMap(li.dataset.rid); });
    M.map = L.map("chmap", { scrollWheelZoom: false, zoomSnap: 0.25, zoomControl: false }).setView([39.6, -3.7], 5.75);
    L.control.zoom({ position: "bottomright" }).addTo(M.map);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · NASA POWER', maxZoom: 9, opacity: 0.35 }).addTo(M.map);
    let gj;
    try { [gj, M.data] = await Promise.all([geo(), getJSON("data/map/annual.json")]); }
    catch (e) { $("#m-answer").textContent = T("El mapa aún no tiene datos (se generan en el despliegue).", "The map has no data yet (it is generated on deployment)."); return; }
    gj.features.forEach((f) => {
      const r = regionById(f.properties.id); if (!r || r.type !== "provincia") return;
      const layer = L.geoJSON(f).addTo(M.map);
      layer.bindTooltip("", { sticky: true });
      layer.on("click", () => selectFromMap(r.id));
      M.layers[r.id] = layer;
    });
    fitChoropleth();
    renderMap();
  }

  function selectFromMap(rid) {
    state.region = rid; if (state.compare === rid) state.compare = "";
    syncControls(); highlightMap();
    dirty = true;
    location.hash = "#explorar";
  }

  // ---------- Pestañas: Inicio · Mapa · Panel ----------
  function fitChoropleth() {
    if (!M.map || !Object.keys(M.layers).length) return;
    const wide = window.innerWidth > 860;
    // Deja sitio al panel flotante de la izquierda y al ranking de la derecha
    M.map.fitBounds(L.featureGroup(Object.values(M.layers)).getBounds(), wide ? { paddingTopLeft: [430, 30], paddingBottomRight: [window.innerWidth > 1100 ? 330 : 30, 30] } : { padding: [10, 10] });
  }
  function currentView() {
    const h = location.hash;
    if (h.includes("=")) return "explorar";
    const v = h.slice(1);
    return v === "mapa" || v === "explorar" ? v : "home";
  }
  function showView() {
    const v = currentView();
    const changed = document.body.dataset.view !== v;
    document.body.dataset.view = v;
    document.querySelectorAll(".view").forEach((el) => (el.hidden = el.dataset.view !== v));
    document.querySelectorAll(".nav nav a").forEach((a) => a.classList.toggle("active", a.dataset.go === v));
    if (changed) window.scrollTo({ top: 0 });
    if (v === "mapa" && M.map) setTimeout(() => { M.map.invalidateSize(); fitChoropleth(); }, 30);
    if (v === "explorar" && map) setTimeout(() => { map.invalidateSize(); highlightMap(); }, 30);
    if (v === "explorar" && (dirty || !lastResults)) { dirty = false; run(); }
  }

  // ---------- Recalcular al cambiar cualquier control ----------
  let dirty = false, runTimer = null;
  function autoRun() {
    if (currentView() !== "explorar") { dirty = true; return; }
    clearTimeout(runTimer); runTimer = setTimeout(run, 300);
  }

  // ---------- Inicio: cifras de toda España (copia de NASA POWER, 52 provincias) ----------
  let national = null;
  function setLive(key, html) { document.querySelectorAll(`[data-live="${key}"]`).forEach((el) => (el.innerHTML = html)); }
  async function renderNational() {
    if (!national) {
      let D0;
      try { D0 = await getJSON("data/map/annual.json"); } catch (e) { console.warn("Inicio: sin datos nacionales", e); return; }
      const from = 1991, to = CFG.period.last;
      const idx = D0.years.map((y, i) => (y >= from && y <= to ? i : -1)).filter((i) => i >= 0);
      const provs = Object.keys(D0.regions).filter((rid) => { const r = regionById(rid); return r && r.type === "provincia"; });
      const stat = (vid) => provs.map((rid) => {
        const ser = D0.regions[rid][vid]; if (!ser) return null;
        const t = idx.map((i) => D0.years[i]), y = idx.map((i) => ser[i]);
        const mk = S.mannKendall(y, 0.05), sen = S.senSlope(t, y, 0.05);
        return mk.valid && sen.valid ? { sig: mk.significant, slope: sen.slope, mean: S.mean(y) } : null;
      }).filter(Boolean);
      const up = (a) => a.filter((x) => x.sig && x.slope > 0).length, down = (a) => a.filter((x) => x.sig && x.slope < 0).length;
      const P = stat("precip"), Tm = stat("tair"), E = stat("eto"), B = stat("balance"), A = stat("aridity");
      national = { N: provs.length, noChange: P.filter((x) => !x.sig).length, tUp: up(Tm), tAvg: S.mean(Tm.map((x) => x.slope * 10)),
        eUp: up(E), eDown: down(E), deficit: B.filter((x) => x.mean < 0).length, arid: A.filter((x) => x.mean < 0.5).length };
    }
    const n = national, of = (k) => T(`${k} de ${n.N}`, `${k} of ${n.N}`), ofThe = (k) => T(`${k} de las ${n.N}`, `${k} of the ${n.N}`);
    setLive("precip", of(n.noChange)); setLive("precip-text", ofThe(n.noChange));
    setLive("tair", of(n.tUp)); setLive("tair-text", ofThe(n.tUp)); setLive("tair-avg", `${signed1(n.tAvg)} °C`);
    setLive("eto", of(n.eUp)); setLive("eto-text", ofThe(n.eUp));
    setLive("eto-down", n.eDown ? T(`y solo baja en ${n.eDown}`, `and falls in only ${n.eDown}`) : T("y no baja en ninguna", "and falls in none"));
    setLive("balance", of(n.deficit)); setLive("balance-text", ofThe(n.deficit)); setLive("arid-text", `${n.arid}`);
  }

  function initStory() {
    const tank = $(".tank"), cards = document.querySelectorAll(".step-card");
    if (!tank || !cards.length) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        cards.forEach((c) => c.classList.toggle("on", c === en.target));
        tank.dataset.step = en.target.dataset.step;
      });
    }, { rootMargin: "-45% 0px -45% 0px" });
    cards.forEach((c) => io.observe(c));
    cards[0].classList.add("on");
    const nav = $(".nav");
    window.addEventListener("scroll", () => nav.classList.toggle("scrolled", window.scrollY > 10), { passive: true });
  }

  // ---------- Selector de idioma ----------
  function setLang(lang) {
    LANG = lang === "en" ? "en" : "es";
    try { localStorage.setItem("neoda-lang", LANG); } catch (e) { /* sin almacenamiento */ }
    const sw = $("#lang-switch");
    sw.setAttribute("aria-checked", String(EN()));
    sw.classList.toggle("is-en", EN());
    I18N.applyStatic(LANG);
    renderControls();
    highlightMap();
    renderQuestions(); renderMap();
    renderNational();
    if (lastResults) render(lastResults);
    $("#btn-run").textContent = T("Recalcular", "Recalculate");
  }

  // ---------- URL compartible ----------
  function writeHash() {
    const p = new URLSearchParams({ region: state.region, vars: [...state.vars].join(","), from: state.from, to: state.to, mode: state.mode, alpha: state.alpha });
    if (state.compare) p.set("compare", state.compare);
    history.replaceState(null, "", "#" + p.toString());
  }
  function readHash() {
    if (!location.hash.includes("=")) return false;
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get("region") && regionById(p.get("region"))) state.region = p.get("region");
    state.compare = p.get("compare") && regionById(p.get("compare")) ? p.get("compare") : "";
    if (p.get("vars") !== null) state.vars = new Set(p.get("vars").split(",").filter(varById));
    if (p.get("from")) state.from = +p.get("from");
    if (p.get("to")) state.to = +p.get("to");
    if (p.get("mode") === "monthly") state.mode = "monthly";
    if (p.get("alpha")) state.alpha = +p.get("alpha");
    return true;
  }

  // ---------- Arranque ----------
  async function init() {
    I18N.applyStatic("es"); // guarda los textos originales en español
    try {
      const [vars, regs] = await Promise.all([getJSON("config/variables.json"), getJSON("config/regions.json")]);
      CFG = { variables: vars.variables, groups: vars.groups, regions: regs.regions, period: vars.period || CFG.period };
    } catch (e) {
      $("#empty").innerHTML = `<h2>${T("No se pudieron cargar los datos", "The data could not be loaded")}</h2><p>${esc(e.message)}</p>`;
      return;
    }
    readHash();
    setupControls();
    $("#lang-switch").addEventListener("click", () => setLang(EN() ? "es" : "en"));
    buildMap(); await Promise.resolve(); buildChoropleth();
    setLang(LANG);
    initStory(); showView();
    window.addEventListener("hashchange", () => { if (readHash()) { syncControls(); highlightMap(); dirty = true; } showView(); });
  }
  document.addEventListener("DOMContentLoaded", init);
})();
