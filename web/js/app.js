/* app.js — Interfaz de Neoda. Lee la configuración y las series (web/data), ejecuta Stats y pinta resultados. */
(function () {
  "use strict";
  const S = window.Stats;
  const $ = (sel) => document.querySelector(sel);
  const RECOMMENDED = ["precip", "tair", "rh", "eto", "gwetroot", "aridity"];
  const COLORS = { main: "#1f6f8b", compare: "#c2622d", trend: "#12302f", trend2: "#8a3a12", grid: "#e9e1d2" };
  const PLOT_CFG = { displayModeBar: false, responsive: true };

  const state = { region: "almeria", compare: "galicia", vars: new Set(RECOMMENDED), from: null, to: null, mode: "annual", alpha: 0.05 };
  let CFG = { variables: [], groups: [], regions: [], period: { first: 1981, last: 2025, default_from: 1991 } };
  const regionCache = new Map();
  let lastResults = null, map;

  // ---------- Formato ----------
  const fmt = (v, d = 2) => (S.isNum(v) ? v.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
  const fmtSigned = (v, d = 2) => (S.isNum(v) ? (v > 0 ? "+" : "") + fmt(v, d) : "—");
  const fmtP = (p) => (!S.isNum(p) ? "—" : p < 0.001 ? "< 0,001" : fmt(p, 3));
  const pTxt = (p) => (S.isNum(p) && p < 0.001 ? "p < 0,001" : `p = ${fmtP(p)}`);
  const smart = (v) => { const a = Math.abs(v); return a === 0 ? 2 : a < 0.01 ? 4 : a < 1 ? 3 : a < 100 ? 2 : 1; };
  const varById = (id) => CFG.variables.find((v) => v.id === id);
  const regionById = (id) => CFG.regions.find((r) => r.id === id);
  const lc = (s) => (/^[A-ZÁÉÍÓÚ]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- Carga de datos ----------
  async function getJSON(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${r.status} al cargar ${url}`);
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

  function unitsFor(v, mode) {
    if (mode === "monthly") return `anomalía, ${v.units}`;
    return v.units_annual || v.units;
  }

  /** Construye la serie a analizar: anual agregada o mensual sin ciclo estacional. */
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
    return { t: series.map((r) => r.t), v: series.map((r) => r.v), baseline, recent, source: data.meta, units: unitsFor(v, state.mode) };
  }

  function analyse(p) {
    const mk = S.mannKendall(p.v, state.alpha);
    const sen = S.senSlope(p.t, p.v, state.alpha);
    const ols = S.linearRegression(p.t, p.v, state.alpha);
    return { mk, sen, ols };
  }

  // ---------- Análisis completo ----------
  async function run() {
    const btn = $("#btn-run");
    if (!state.vars.size) { alert("Elige al menos una variable."); return; }
    if (state.from >= state.to - 4) { alert("Elige un periodo de al menos 6 años."); return; }
    btn.disabled = true; btn.textContent = "Analizando…";
    try {
      const regions = [state.region, state.compare].filter(Boolean);
      const vars = CFG.variables.filter((v) => state.vars.has(v.id));
      const results = {};
      const totalPts = regions.reduce((a, rid) => a + (regionCache.has(rid) ? 0 : regionById(rid).points.length), 0);
      let donePts = 0;
      if (totalPts) btn.textContent = `Descargando NASA POWER (0/${totalPts})…`;
      await Promise.all(regions.map((rid) => regionData(rid, () => { donePts++; btn.textContent = `Descargando NASA POWER (${donePts}/${totalPts})…`; })));
      btn.textContent = "Calculando tendencias…";
      for (const rid of regions) {
        results[rid] = {};
        await Promise.all(vars.map(async (v) => {
          const p = await prepared(rid, v);
          results[rid][v.id] = p ? { ...p, ...analyse(p) } : null;
        }));
      }
      const index = {};
      for (const rid of regions) index[rid] = buildIndex(results[rid], vars);
      lastResults = { regions, vars, results, index, alpha: state.alpha, mode: state.mode, from: state.from, to: state.to };
      render(lastResults);
      writeHash();
    } catch (e) {
      console.error(e); alert("No se pudo completar el análisis: " + e.message);
    } finally {
      btn.disabled = false; btn.textContent = "Analizar tendencias";
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
      contrib.push({ id: v.id, name: v.name, perDecade: sen.valid ? sen.slope * 10 : null, significant: r.mk.significant });
    });
    const ts = [...byT.keys()].sort((a, b) => a - b);
    const minN = Math.ceil(used.length / 2);
    const t = ts, v = ts.map((k) => (byT.get(k).length >= minN ? S.mean(byT.get(k)) : null));
    const p = { t, v };
    return { ...p, ...analyse(p), contrib: contrib.sort((a, b) => (a.perDecade ?? 0) - (b.perDecade ?? 0)), nVars: used.length };
  }

  // ---------- Textos ----------
  function interpretVar(v, r, regionName) {
    if (!r) return "Todavía no hay datos de esta variable para esta región.";
    if (!r.mk.valid || !r.sen.valid) return "No hay suficientes datos válidos en el periodo elegido para calcular una tendencia.";
    const per = r.sen.slope * 10, conf = Math.round((1 - state.alpha) * 100);
    const dir = per > 0 ? "aumenta" : per < 0 ? "disminuye" : "no cambia";
    let pct = "";
    const allowPct = state.mode === "annual" && v.pct && S.isNum(r.baseline) && r.baseline > 1e-6;
    if (allowPct) pct = ` (${fmtSigned((per / r.baseline) * 100, 1)} % por década respecto a la media)`;
    let head = `En ${regionName}, ${lc(v.name)} ${dir} a un ritmo de ${fmt(Math.abs(per), smart(per))} ${r.units} cada década${pct}.`;
    if (v.id === "aridity" && S.isNum(r.recent)) head += ` Clasificación UNEP de los últimos 10 años: <b>${aridityClass(r.recent)}</b> (P/ETo = ${fmt(r.recent, 2)}).`;
    if (v.id === "balance" && S.isNum(r.recent) && state.mode === "annual") head += ` Balance medio de los últimos 10 años: <b>${fmtSigned(r.recent, 0)} mm/año</b> (${r.recent < 0 ? "el clima gasta más agua de la que da" : "superávit"}).`;
    if (r.mk.significant) {
      const effect = v.water_sign === 0 ? "" : (per * v.water_sign < 0 ? " Este cambio juega en contra de los recursos hídricos." : " Este cambio favorece los recursos hídricos.");
      return `${head} La tendencia es <b>estadísticamente significativa</b> al ${conf} % (Mann-Kendall, ${pTxt(r.mk.p)}): es muy poco probable que sea casualidad.${effect}`;
    }
    return `${head} Pero la tendencia <b>no es significativa</b> (${pTxt(r.mk.p)}): puede ser variabilidad natural. Con más años de datos podría llegar a confirmarse.`;
  }

  function aridityClass(x) {
    return x < 0.05 ? "hiperárido" : x < 0.2 ? "árido" : x < 0.5 ? "semiárido" : x < 0.65 ? "subhúmedo seco" : "húmedo";
  }

  function verdict(ix) {
    if (!ix || !ix.mk.valid) return { title: "Sin índice combinado", badge: "—", cls: "flat" };
    if (!ix.mk.significant) return { title: "Sin tendencia significativa en el agua disponible", badge: "estable / no concluyente", cls: "flat" };
    return ix.sen.slope < 0
      ? { title: "Los recursos hídricos están disminuyendo", badge: "▼ tendencia significativa", cls: "down" }
      : { title: "Los recursos hídricos están aumentando", badge: "▲ tendencia significativa", cls: "up" };
  }

  function summaryText(L) {
    const rid = L.regions[0], ix = L.index[rid], rn = regionById(rid).name, conf = Math.round((1 - L.alpha) * 100);
    if (!ix) return "Las variables elegidas no entran en el índice combinado (por ejemplo, la lluvia máxima diaria). Elige alguna variable más.";
    const per = ix.sen.slope * 10;
    let t = `Combinando ${ix.nVars} variable${ix.nVars > 1 ? "s" : ""} en ${rn} (${L.from}–${L.to}), el índice ${per < 0 ? "baja" : "sube"} ${fmt(Math.abs(per), 2)} desviaciones típicas por década (IC ${conf} %: ${fmtSigned(ix.sen.ciLow * 10)} a ${fmtSigned(ix.sen.ciHigh * 10)}; Mann-Kendall ${pTxt(ix.mk.p)}; t-test ${pTxt(ix.ols.p)}).`;
    const neg = ix.contrib.filter((c) => S.isNum(c.perDecade) && c.perDecade < 0).slice(0, 2);
    const pos = ix.contrib.filter((c) => S.isNum(c.perDecade) && c.perDecade > 0).slice(-2).reverse();
    if (neg.length) t += ` Lo que más resta agua: ${neg.map((c) => lc(c.name)).join(" y ")}.`;
    if (pos.length) t += ` Lo que más suma: ${pos.map((c) => lc(c.name)).join(" y ")}.`;
    if (L.regions[1] && L.index[L.regions[1]] && L.index[L.regions[1]].mk.valid) {
      const c = L.index[L.regions[1]], cp = c.sen.slope * 10;
      t += ` En comparación, en ${regionById(L.regions[1]).name} el índice ${cp < 0 ? "baja" : "sube"} ${fmt(Math.abs(cp), 2)} σ/década (${c.mk.significant ? "significativo" : "no significativo"}, ${pTxt(c.mk.p)}).`;
    }
    if (L.mode === "monthly") t += " Nota: en modo mensual los meses consecutivos se parecen entre sí (autocorrelación), lo que puede exagerar la significancia; el modo anual es más conservador.";
    return t;
  }

  // ---------- Render ----------
  const baseLayout = (ytitle) => ({
    margin: { l: 55, r: 12, t: 34, b: 36 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "IBM Plex Sans, sans-serif", size: 12, color: "#3d5654" },
    xaxis: { gridcolor: COLORS.grid, zeroline: false }, yaxis: { title: { text: ytitle, font: { size: 11 } }, gridcolor: COLORS.grid, zerolinecolor: "#cdbfa6" },
    legend: { orientation: "h", y: 1.02, yanchor: "bottom", x: 0, font: { size: 11 } }, hovermode: "x unified",
  });

  function traces(r, name, color, trendColor, dash) {
    const out = [{ x: r.t, y: r.v, name, type: "scatter", mode: state.mode === "annual" ? "lines+markers" : "lines", line: { color, width: state.mode === "annual" ? 2 : 1.2, dash }, marker: { size: 5 }, connectgaps: false }];
    if (r.sen.valid) {
      const x0 = r.t[0], x1 = r.t[r.t.length - 1];
      out.push({ x: [x0, x1], y: [r.sen.intercept + r.sen.slope * x0, r.sen.intercept + r.sen.slope * x1], name: `Tendencia (Sen) ${name}`, showlegend: false, mode: "lines", line: { color: trendColor, width: 2.5, dash: "dot" }, hoverinfo: "skip" });
    }
    return out;
  }

  function sourceTag(src) {
    return src.mode === "snapshot" ? '<span class="pill demo" title="Copia guardada: no se pudo conectar en directo">NASA POWER · copia</span>' : '<span class="pill real" title="Descargado en directo">NASA POWER · en vivo</span>';
  }

  function render(L) {
    $("#empty").hidden = true; $("#output").hidden = false;
    const main = L.regions[0], cmp = L.regions[1];
    const ix = L.index[main], vd = verdict(ix);
    $("#sum-title").textContent = vd.title;
    const badge = $("#sum-badge"); badge.textContent = vd.badge; badge.className = "badge " + vd.cls;
    $("#sum-text").innerHTML = esc(summaryText(L));

    // Índice
    if (ix) {
      const tr = traces(ix, regionById(main).name, COLORS.main, COLORS.trend);
      if (cmp && L.index[cmp]) tr.push(...traces(L.index[cmp], regionById(cmp).name, COLORS.compare, COLORS.trend2, "dash"));
      Plotly.react("chart-index", tr, baseLayout("índice (σ)  ·  + más agua / − menos agua"), PLOT_CFG);
      const c = ix.contrib.filter((d) => S.isNum(d.perDecade));
      Plotly.react("chart-contrib", [{
        type: "bar", orientation: "h", y: c.map((d) => d.name), x: c.map((d) => d.perDecade),
        marker: { color: c.map((d) => (d.perDecade < 0 ? COLORS.compare : COLORS.main)), opacity: c.map((d) => (d.significant ? 1 : 0.45)) },
        hovertemplate: "%{y}: %{x:.2f} σ/década<extra></extra>",
      }], { ...baseLayout(""), margin: { l: 10, r: 10, t: 6, b: 32 }, hovermode: "closest", yaxis: { automargin: true }, xaxis: { title: { text: "σ por década", font: { size: 11 } }, gridcolor: COLORS.grid, zerolinecolor: "#12302f" } }, PLOT_CFG);
    } else {
      Plotly.purge("chart-index"); Plotly.purge("chart-contrib");
    }

    // Tarjetas por variable
    const cards = $("#cards"); cards.innerHTML = "";
    let anyDemo = false;
    L.vars.forEach((v) => {
      const r = L.results[main][v.id], rc = cmp ? L.results[cmp][v.id] : null;
      if (r && r.source.mode === "snapshot") anyDemo = r.source;
      if (rc && rc.source.mode === "snapshot") anyDemo = rc.source;
      const el = document.createElement("article");
      el.className = "card vcard";
      const per = r && r.sen.valid ? r.sen.slope * 10 : null;
      const tag = !r ? "" : !r.mk.significant ? '<span class="tag">sin tendencia significativa</span>' : per < 0 ? '<span class="tag down">▼ significativa</span>' : '<span class="tag up">▲ significativa</span>';
      el.innerHTML = `
        <h3>${esc(v.name)} ${r ? sourceTag(r.source) : ""} ${tag}</h3>
        <p class="interp">${interpretVar(v, r, regionById(main).name)}</p>
        <div class="chart" id="ch-${v.id}"></div>
        ${r ? statsTable(r, rc, cmp) : ""}
        <p class="src"><i>${esc(v.question)}</i><br>${esc(v.description)}<br>Fuente: ${v.power ? `NASA POWER · <code>${esc(v.power)}</code>` : "calculada a partir de NASA POWER"} · media de ${regionById(main).points.length} puntos de la región</p>`;
      cards.appendChild(el);
      if (r) {
        const tr = traces(r, regionById(main).name, COLORS.main, COLORS.trend);
        if (rc) tr.push(...traces(rc, regionById(cmp).name, COLORS.compare, COLORS.trend2, "dash"));
        Plotly.newPlot(`ch-${v.id}`, tr, baseLayout(r.units), PLOT_CFG);
      }
    });
    const banner = $("#demo-banner");
    banner.hidden = !anyDemo;
    if (anyDemo) banner.innerHTML = `<strong>Sin conexión con NASA POWER.</strong> Se muestran datos de la copia guardada el ${new Date(anyDemo.fetched).toLocaleDateString("es-ES")}. Pulsa «Analizar» de nuevo para reintentar en directo.`;
    const m0 = L.results[main][L.vars[0].id];
    $("#data-info").textContent = m0 ? `Datos: NASA POWER (MERRA-2 + GPM, rejilla 0,5° × 0,625°) · ${m0.source.mode === "live" ? "descargados en vivo" : "copia guardada"} el ${new Date(m0.source.fetched).toLocaleString("es-ES")} · ${m0.source.points} puntos por región.` : "";
    $("#share-hint").hidden = false;
  }

  function statsTable(r, rc, cmp) {
    const conf = Math.round((1 - state.alpha) * 100);
    const col = (x, f) => `<td class="num-c">${f(x)}</td>`;
    const rows = [
      ["Tasa de cambio (Sen) por década", (x) => (x.sen.valid ? fmtSigned(x.sen.slope * 10, smart(x.sen.slope * 10)) : "—")],
      [`IC ${conf} % de la tasa`, (x) => (x.sen.valid ? `${fmtSigned(x.sen.ciLow * 10, smart(x.sen.ciLow * 10))} … ${fmtSigned(x.sen.ciHigh * 10, smart(x.sen.ciHigh * 10))}` : "—")],
      ["Mann-Kendall p-valor", (x) => fmtP(x.mk.p)],
      ["τ de Kendall", (x) => fmt(x.mk.tau, 2)],
      ["t-test p-valor (regresión)", (x) => fmtP(x.ols.p)],
      ["R² de la regresión", (x) => fmt(x.ols.r2, 2)],
      ["Nº de datos", (x) => String(x.mk.n ?? "—")],
    ];
    const head = rc ? `<tr><td></td><td class="num-c"><b>${esc(regionById(state.region).name)}</b></td><td class="num-c"><b>${esc(regionById(cmp).name)}</b></td></tr>` : "";
    return `<table class="stats">${head}${rows.map(([label, f], i) => `<tr class="${i < 3 && r.mk.significant ? "sig" : ""}"><td>${label}</td>${col(r, f)}${rc ? col(rc, f) : ""}</tr>`).join("")}</table>`;
  }

  // ---------- CSV ----------
  function downloadCSV() {
    if (!lastResults) return;
    const L = lastResults, lines = [["region", "variable", "unidades", "modo", "desde", "hasta", "n", "sen_por_decada", "ic_inf", "ic_sup", "mk_p", "tau", "ttest_p", "r2", "significativa", "fuente"].join(",")];
    const push = (rid, id, name, r, units, src) => {
      if (!r || !r.mk.valid) return;
      lines.push([rid, name, `"${units}"`, L.mode, L.from, L.to, r.mk.n, r.sen.slope * 10, r.sen.ciLow * 10, r.sen.ciHigh * 10, r.mk.p, r.mk.tau, r.ols.p, r.ols.r2, r.mk.significant, src].join(","));
    };
    L.regions.forEach((rid) => {
      L.vars.forEach((v) => { const r = L.results[rid][v.id]; if (r) push(rid, v.id, v.power || v.id, r, r.units, "NASA POWER " + r.source.mode); });
      if (L.index[rid]) push(rid, "indice", "indice_combinado", L.index[rid], "sigma", "derivado");
    });
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `neoda_${L.regions.join("_vs_")}_${L.from}-${L.to}.csv`; a.click();
  }

  // ---------- Controles ----------
  function buildControls() {
    const byCcaa = new Map();
    CFG.regions.forEach((r) => { const k = r.ccaa || "Otras"; if (!byCcaa.has(k)) byCcaa.set(k, []); byCcaa.get(k).push(r); });
    const regOpts = [...byCcaa.keys()].sort((a, b) => a.localeCompare(b, "es")).map((k) =>
      `<optgroup label="${esc(k)}">${byCcaa.get(k).map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("")}</optgroup>`).join("");
    $("#sel-region").innerHTML = regOpts;
    $("#sel-compare").innerHTML = '<option value="">— Ninguna —</option>' + regOpts;

    const minY = CFG.period.first, maxY = CFG.period.last;
    const yrs = []; for (let y = minY; y <= maxY; y++) yrs.push(`<option>${y}</option>`);
    $("#sel-from").innerHTML = yrs.join(""); $("#sel-to").innerHTML = yrs.join("");
    if (state.from === null) state.from = CFG.period.default_from || minY; if (state.to === null) state.to = maxY;

    const list = $("#var-list"); list.innerHTML = "";
    CFG.groups.forEach((g) => {
      const vs = CFG.variables.filter((v) => v.group === g.id);
      if (!vs.length) return;
      const box = document.createElement("div"); box.className = "var-group";
      box.innerHTML = `<h4 title="${esc(g.description)}">${esc(g.name)}</h4>` + vs.map((v) => {
        const sc = v.water_sign > 0 ? "pos" : v.water_sign < 0 ? "neg" : "zero", st = v.water_sign > 0 ? "+" : v.water_sign < 0 ? "−" : "·";
        const tip = `${v.question} ${v.description} Unidades: ${v.units}. Efecto sobre el agua: ${v.water_sign > 0 ? "más = más agua" : v.water_sign < 0 ? "más = menos agua" : "no entra en el índice"}.${v.tier === 2 ? " (Variable calculada)" : ""}`;
        return `<label class="var-item"><input type="checkbox" value="${v.id}"><span class="vname">${esc(v.name)}${v.tier === 2 ? ' <small class="calc">calc.</small>' : ""}</span><span class="sign ${sc}" title="Efecto sobre el agua">${st}</span><button type="button" class="info" data-tip="${esc(tip)}" aria-label="Qué es ${esc(v.name)}">i</button></label>`;
      }).join("");
      list.appendChild(box);
    });
    list.addEventListener("change", (e) => { if (e.target.type === "checkbox") { e.target.checked ? state.vars.add(e.target.value) : state.vars.delete(e.target.value); } });
    list.addEventListener("click", (e) => { if (e.target.classList.contains("info")) e.preventDefault(); });

    document.querySelectorAll(".quick button").forEach((b) => b.addEventListener("click", () => {
      const p = b.dataset.preset;
      state.vars = new Set(p === "todas" ? CFG.variables.map((v) => v.id) : p === "ninguna" ? [] : RECOMMENDED);
      syncControls();
    }));
    $("#sel-region").addEventListener("change", (e) => { state.region = e.target.value; highlightMap(); });
    $("#sel-compare").addEventListener("change", (e) => { state.compare = e.target.value === state.region ? "" : e.target.value; highlightMap(); });
    $("#sel-from").addEventListener("change", (e) => (state.from = +e.target.value));
    $("#sel-to").addEventListener("change", (e) => (state.to = +e.target.value));
    $("#sel-alpha").addEventListener("change", (e) => (state.alpha = +e.target.value));
    document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", (e) => (state.mode = e.target.value)));
    $("#btn-run").addEventListener("click", run);
    $("#btn-csv").addEventListener("click", downloadCSV);
    $("#btn-demo").addEventListener("click", () => {
      Object.assign(state, { region: "almeria", compare: "galicia", vars: new Set([...RECOMMENDED, "balance", "spi12"]), mode: "annual", alpha: 0.05, from: CFG.period.default_from, to: CFG.period.last });
      syncControls(); highlightMap(); run().then(() => $("#output").scrollIntoView({ behavior: "smooth" }));
    });
  }

  function syncControls() {
    $("#sel-region").value = state.region; $("#sel-compare").value = state.compare;
    $("#sel-from").value = state.from; $("#sel-to").value = state.to; $("#sel-alpha").value = String(state.alpha);
    document.querySelectorAll('input[name="mode"]').forEach((r) => (r.checked = r.value === state.mode));
    document.querySelectorAll("#var-list input").forEach((c) => (c.checked = state.vars.has(c.value)));
  }

  // ---------- Mapa ----------
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
      const layer = L.geoJSON(f, { style: { weight: 0.7, color: "#7a8a86", fillOpacity: 0.04 } });
      layer.bindTooltip(`${r.name}<br><small>clic: elegir · Mayús+clic: comparar</small>`, { sticky: true });
      layer.on("click", (ev) => {
        if (ev.originalEvent && ev.originalEvent.shiftKey) { if (r.id !== state.region) state.compare = r.id; }
        else { state.region = r.id; if (state.compare === r.id) state.compare = ""; }
        syncControls(); highlightMap();
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
      layer.setStyle({ color: sel ? "#1f6f8b" : cmp ? "#c2622d" : "#7a8a86", weight: sel || cmp ? 2.5 : 0.7, fillOpacity: sel || cmp ? 0.3 : 0.04, fillColor: cmp ? "#c2622d" : "#1f6f8b" });
      if (sel || cmp) { layer.bringToFront(); focus.push(layer); }
    });
    [state.region, state.compare].filter(Boolean).forEach((rid) => (regionById(rid).points || []).forEach((p) =>
      L.circleMarker([p.lonlat[1], p.lonlat[0]], { radius: 3, color: "#12302f", weight: 1, fillOpacity: 0.9 }).bindTooltip(`${regionById(rid).name}: punto de muestreo NASA POWER`).addTo(pointLayer)));
    if (focus.length) map.fitBounds(L.featureGroup(focus).getBounds().pad(0.25), { animate: true, maxZoom: 8 });
  }


  // ---------- Mapa de España (coropletas) ----------
  const M = { map: null, layers: {}, data: null, var: "eto", mode: "trend", from: null, to: null };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(",")})`; };
  const NEUTRAL = "#f3ece0";
  function diverging(t) { // t en [-1, 1]: -1 = en contra del agua, +1 = a favor
    t = Math.max(-1, Math.min(1, t));
    return t < 0 ? mix(NEUTRAL, COLORS.compare, -t) : mix(NEUTRAL, COLORS.main, t);
  }
  function quantile(arr, q) { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] : 0; }

  function computeMap() {
    const v = varById(M.var), D = M.data, out = {};
    const idx = D.years.map((y, i) => (y >= M.from && y <= M.to ? i : -1)).filter((i) => i >= 0);
    Object.entries(D.regions).forEach(([rid, vals]) => {
      const series = vals[M.var]; if (!series) return;
      const t = idx.map((i) => D.years[i]), y = idx.map((i) => series[i]);
      if (M.mode === "mean") { out[rid] = { value: S.mean(y) }; return; }
      const mk = S.mannKendall(y, state.alpha), sen = S.senSlope(t, y, state.alpha);
      out[rid] = mk.valid && sen.valid ? { value: sen.slope * 10, p: mk.p, significant: mk.significant } : { value: null };
    });
    return out;
  }

  function styleFor(res, v, scale) {
    if (!res || !S.isNum(res.value)) return { fillColor: "#ddd", fillOpacity: 0.4, color: "#999", weight: 0.5, dashArray: null };
    if (M.mode === "trend") {
      const eff = res.value * (v.water_sign || 1);
      return { fillColor: diverging(eff / scale.max), fillOpacity: res.significant ? 0.9 : 0.35, color: res.significant ? "#12302f" : "#8a8a8a", weight: res.significant ? 0.8 : 0.6, dashArray: res.significant ? null : "3 3" };
    }
    let tt = scale.max > scale.min ? (res.value - scale.min) / (scale.max - scale.min) : 0.5;
    if (v.water_sign < 0) tt = 1 - tt;
    return { fillColor: v.water_sign === 0 ? mix(NEUTRAL, "#12302f", tt) : diverging(tt * 2 - 1), fillOpacity: 0.85, color: "#12302f", weight: 0.6, dashArray: null };
  }

  function renderMap() {
    if (!M.data || !M.map) return;
    const v = varById(M.var), res = computeMap();
    const vals = Object.values(res).map((r) => r.value).filter(S.isNum);
    const units = v.units_annual || v.units;
    let scale;
    if (M.mode === "trend") {
      const effs = Object.values(res).filter((r) => S.isNum(r.value)).map((r) => Math.abs(r.value));
      scale = { max: quantile(effs, 0.95) || 1 };
    } else scale = { min: quantile(vals, 0.02), max: quantile(vals, 0.98) };
    Object.entries(M.layers).forEach(([rid, layer]) => {
      const r = res[rid], name = regionById(rid).name;
      layer.setStyle(styleFor(r, v, scale));
      const txt = !r || !S.isNum(r.value) ? "sin datos" : M.mode === "trend"
        ? `${fmtSigned(r.value, smart(r.value))} ${units}/década<br>${r.significant ? "<b>significativa</b>" : "no significativa"} (${pTxt(r.p)})`
        : `${fmt(r.value, smart(r.value))} ${units}${v.id === "aridity" ? ` · ${aridityClass(r.value)}` : ""}`;
      layer.setTooltipContent(`<b>${esc(name)}</b><br>${esc(v.name)}: ${txt}`);
    });
    // Leyenda
    const lg = $("#m-legend");
    if (M.mode === "trend") {
      const lo = v.water_sign >= 0 ? -scale.max : scale.max, hi = -lo;
      lg.innerHTML = `<b>${esc(v.name)}</b> · tendencia (${esc(units)} por década)
        <div class="bar" style="background: linear-gradient(90deg, ${COLORS.compare}, ${NEUTRAL}, ${COLORS.main})"></div>
        <div class="ends"><span>${fmtSigned(lo, smart(lo))}</span><span>0</span><span>${fmtSigned(hi, smart(hi))}</span></div>
        <div class="ends"><span>${v.water_sign === 0 ? "baja" : "peor para el agua"}</span><span>${v.water_sign === 0 ? "sube" : "mejor para el agua"}</span></div>`;
    } else {
      const lowCol = v.water_sign === 0 ? NEUTRAL : v.water_sign > 0 ? COLORS.compare : COLORS.main;
      const highCol = v.water_sign === 0 ? "#12302f" : v.water_sign > 0 ? COLORS.main : COLORS.compare;
      lg.innerHTML = `<b>${esc(v.name)}</b> · media ${M.from}–${M.to} (${esc(units)})
        <div class="bar" style="background: linear-gradient(90deg, ${lowCol}, ${NEUTRAL}, ${highCol})"></div>
        <div class="ends"><span>${fmt(scale.min, smart(scale.min))}</span><span>${fmt(scale.max, smart(scale.max))}</span></div>`;
    }
    // Ranking
    const rows = Object.entries(res).filter(([, r]) => S.isNum(r.value) && (M.mode === "mean" || r.significant));
    const key = ([, r]) => (M.mode === "trend" ? r.value * (v.water_sign || 1) : r.value);
    rows.sort((a, b) => key(a) - key(b));
    const li = ([rid, r]) => `<li data-rid="${rid}">${esc(regionById(rid).name)} <span>${M.mode === "trend" ? fmtSigned(r.value, smart(r.value)) : fmt(r.value, smart(r.value))}</span></li>`;
    const labels = M.mode === "trend" ? (v.water_sign === 0 ? ["Más bajada", "Más subida"] : ["Peor evolución para el agua", "Mejor evolución para el agua"]) : ["Valores más bajos", "Valores más altos"];
    const nSig = M.mode === "trend" ? `<p class="note">${rows.length} de ${Object.keys(res).length} provincias con tendencia significativa (α = ${fmt(state.alpha, 2)}).</p>` : "";
    $("#m-rank").innerHTML = rows.length ? `${nSig}<h4>${labels[0]}</h4><ol>${rows.slice(0, 5).map(li).join("")}</ol><h4>${labels[1]}</h4><ol>${rows.slice(-5).reverse().map(li).join("")}</ol>` : `${nSig}<p class="note">Ninguna provincia con tendencia significativa en este periodo.</p>`;
  }

  async function buildChoropleth() {
    if (!window.L || !$("#chmap")) return;
    // Controles
    const groups = CFG.groups.map((g) => `<optgroup label="${esc(g.name)}">${CFG.variables.filter((v) => v.group === g.id).map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join("")}</optgroup>`).join("");
    $("#m-var").innerHTML = groups; $("#m-var").value = M.var;
    const yrs = []; for (let y = CFG.period.first; y <= CFG.period.last; y++) yrs.push(`<option>${y}</option>`);
    $("#m-from").innerHTML = yrs.join(""); $("#m-to").innerHTML = yrs.join("");
    M.from = CFG.period.default_from; M.to = CFG.period.last;
    $("#m-from").value = M.from; $("#m-to").value = M.to;
    $("#m-var").addEventListener("change", (e) => { M.var = e.target.value; renderMap(); });
    $("#m-from").addEventListener("change", (e) => { M.from = +e.target.value; renderMap(); });
    $("#m-to").addEventListener("change", (e) => { M.to = +e.target.value; renderMap(); });
    document.querySelectorAll('input[name="m-mode"]').forEach((r) => r.addEventListener("change", (e) => { M.mode = e.target.value; renderMap(); }));
    $("#sel-alpha").addEventListener("change", () => renderMap());
    $("#m-rank").addEventListener("click", (e) => { const li = e.target.closest("li"); if (li) selectFromMap(li.dataset.rid); });

    M.map = L.map("chmap", { scrollWheelZoom: false, zoomSnap: 0.25 }).setView([39.6, -3.7], 5.75);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Datos: NASA POWER', maxZoom: 9, opacity: 0.5 }).addTo(M.map);
    let gj;
    try { [gj, M.data] = await Promise.all([geo(), getJSON("data/map/annual.json")]); }
    catch (e) { $("#m-info").textContent = "El mapa aún no tiene datos (se generan en el despliegue)."; return; }
    gj.features.forEach((f) => {
      const r = regionById(f.properties.id); if (!r || r.type !== "provincia") return;
      const layer = L.geoJSON(f).addTo(M.map);
      layer.bindTooltip("", { sticky: true });
      layer.on("click", () => selectFromMap(r.id));
      M.layers[r.id] = layer;
    });
    // Canarias más cerca de la península no hace falta: se ve al hacer zoom; ajustamos a todo
    M.map.fitBounds(L.featureGroup(Object.values(M.layers)).getBounds(), { padding: [10, 10] });
    $("#m-info").textContent = `Copia de NASA POWER del ${new Date(M.data.fetched).toLocaleDateString("es-ES")}. Tendencias: pendiente de Sen + Mann-Kendall sobre series anuales, calculadas en tu navegador.`;
    renderMap();
  }

  function selectFromMap(rid) {
    state.region = rid; if (state.compare === rid) state.compare = "";
    syncControls(); highlightMap();
    if (!state.vars.has(M.var)) state.vars.add(M.var), syncControls();
    run().then(() => $("#output").scrollIntoView({ behavior: "smooth" }));
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

  // ---------- Inicio ----------
  async function init() {
    try {
      const [vars, regs] = await Promise.all([getJSON("config/variables.json"), getJSON("config/regions.json")]);
      CFG = { variables: vars.variables, groups: vars.groups, regions: regs.regions, period: vars.period || CFG.period };
    } catch (e) {
      $("#empty").innerHTML = `<h2>No se pudieron cargar los datos</h2><p>${esc(e.message)}</p>`;
      return;
    }
    const fromHash = readHash();
    buildControls(); syncControls(); buildMap(); buildChoropleth();
    if (fromHash) run();
  }
  window.addEventListener("hashchange", () => { if (CFG.regions.length && readHash()) { syncControls(); highlightMap(); run(); } });
  document.addEventListener("DOMContentLoaded", init);
})();
