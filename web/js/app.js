/* app.js — Interfaz de Neoda. Lee la configuración y las series (web/data), ejecuta Stats y pinta resultados. */
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
    if (!state.vars.size) { $("#empty").hidden = false; $("#output").hidden = true; $("#empty").innerHTML = "<h2>Elige al menos un indicador</h2><p>Marca uno o varios indicadores en el panel de la izquierda.</p>"; return; }
    if (state.from >= state.to - 4) { $("#empty").hidden = false; $("#output").hidden = true; $("#empty").innerHTML = "<h2>Periodo demasiado corto</h2><p>Elige un periodo de al menos 6 años para poder detectar una tendencia.</p>"; return; }
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
    font: { family: "Archivo, sans-serif", size: 12, color: "#4a6572" },
    xaxis: { gridcolor: COLORS.grid, zeroline: false }, yaxis: { title: { text: ytitle, font: { size: 11 } }, gridcolor: COLORS.grid, zerolinecolor: "#b9d3da" },
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
        marker: { color: c.map((d) => (d.perDecade < 0 ? COLORS.worse : COLORS.better)), opacity: c.map((d) => (d.significant ? 1 : 0.45)) },
        hovertemplate: "%{y}: %{x:.2f} σ/década<extra></extra>",
      }], { ...baseLayout(""), margin: { l: 10, r: 10, t: 6, b: 32 }, hovermode: "closest", yaxis: { automargin: true }, xaxis: { title: { text: "σ por década", font: { size: 11 } }, gridcolor: COLORS.grid, zerolinecolor: "#06283d" } }, PLOT_CFG);
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
    if (anyDemo) banner.innerHTML = `<strong>Sin conexión con NASA POWER.</strong> Se muestran datos de la copia guardada el ${new Date(anyDemo.fetched).toLocaleDateString("es-ES")}. Pulsa «Recalcular» para reintentar en directo.`;
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
    $("#sel-alpha").addEventListener("change", (e) => { state.alpha = +e.target.value; autoRun(); });
    document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", (e) => { state.mode = e.target.value; autoRun(); }));
    $("#btn-run").addEventListener("click", run);
    $("#btn-csv").addEventListener("click", downloadCSV);
    $("#btn-demo") && $("#btn-demo").addEventListener("click", () => {
      Object.assign(state, { region: "almeria", compare: "galicia", vars: new Set([...RECOMMENDED, "balance", "spi12"]), mode: "annual", alpha: 0.05, from: CFG.period.default_from, to: CFG.period.last });
      syncControls(); highlightMap(); run().then(() => $("#output").scrollIntoView({ behavior: "smooth" }));
    });
  }

  function syncControls() {
    $("#sel-region").value = state.region; $("#sel-compare").value = state.compare;
    if ($("#d-region")) { $("#d-region").value = state.region; $("#d-compare").value = state.compare; }
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
      const layer = L.geoJSON(f, { style: { weight: 0.7, color: "#9db4bc", fillOpacity: 0.04 } });
      layer.bindTooltip(`${r.name}<br><small>clic: elegir · Mayús+clic: comparar</small>`, { sticky: true });
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
      if (sel || cmp) { layer.bringToFront(); focus.push(layer); }
    });
    [state.region, state.compare].filter(Boolean).forEach((rid) => (regionById(rid).points || []).forEach((p) =>
      L.circleMarker([p.lonlat[1], p.lonlat[0]], { radius: 3, color: "#06283d", weight: 1, fillOpacity: 0.9 }).bindTooltip(`${regionById(rid).name}: punto de muestreo NASA POWER`).addTo(pointLayer)));
    if (focus.length) map.fitBounds(L.featureGroup(focus).getBounds().pad(0.25), { animate: true, maxZoom: 8 });
  }



  // ---------- Portada: semáforo del agua ----------
  const D = { from: 1991, token: 0 };
  const ICON = (d) => `<svg class="ico" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const KPIS = [
    { id: "tair", title: "Temperatura", icon: ICON('<path d="M13 5a3 3 0 0 1 6 0v13a6 6 0 1 1-6 0Z"/><path d="M16 12v10"/>') },
    { id: "eto", title: "Agua que «pide» el clima", icon: ICON('<circle cx="16" cy="18" r="5"/><path d="M16 6v3M6 18h3M23 18h3M9 11l2 2M23 11l-2 2"/><path d="M12 3c1 1 1 2 0 3M20 3c1 1 1 2 0 3"/>') },
    { id: "precip", title: "Lluvia", icon: ICON('<path d="M9 17a5 5 0 0 1 1-10 7 7 0 0 1 13 2 4 4 0 0 1 0 8Z"/><path d="M11 21l-1 4M17 21l-1 4M23 21l-1 4"/>') },
    { id: "balance", title: "Balance del agua", icon: ICON('<path d="M16 5v22M8 27h16M6 9h20"/><path d="M6 9l-3 8a3 3 0 0 0 6 0ZM26 9l-3 8a3 3 0 0 0 6 0Z"/>') },
    { id: "gwetroot", title: "Humedad del suelo", icon: ICON('<path d="M4 20h24"/><path d="M16 20v-7M16 13c0-4 3-6 7-6 0 4-3 6-7 6ZM16 15c0-3-2-5-6-5 0 3 2 5 6 5Z"/><path d="M10 24h2M18 25h2M14 27h1"/>') },
    { id: "aridity", title: "Nivel de aridez", icon: ICON('<path d="M3 26h26"/><path d="M16 26V8a2 2 0 0 1 4 0v18M20 14h3V11a2 2 0 0 1 4 0v4a3 3 0 0 1-3 3h-4M16 17h-3a3 3 0 0 1-3-3v-3a2 2 0 0 1 4 0v3h2"/>') },
  ];
  const STATUS = {
    red: { label: "Empeora", cls: "red" },
    green: { label: "Mejora", cls: "green" },
    gray: { label: "Sin cambio claro", cls: "gray" },
  };
  const L_M2 = "litros/m²";
  const NF0 = (() => { try { return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0, useGrouping: "always" }); } catch (e) { return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }); } })();
  const int = (v) => (S.isNum(v) ? NF0.format(Math.round(v)) : "—");
  const signedInt = (v) => (S.isNum(v) ? (v > 0 ? "+" : v < 0 ? "−" : "") + NF0.format(Math.abs(Math.round(v))) : "—");
  const aridityZone = (x) => (x < 0.05 ? "hiperárida" : x < 0.2 ? "árida" : x < 0.5 ? "semiárida" : x < 0.65 ? "subhúmeda seca" : "húmeda");
  const signed1 = (v) => (S.isNum(v) ? (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v), 1) : "—");

  function annualSeries(data, v, from, to) {
    const rowsOf = (arr) => S.filterYears(S.toMonthly(data.start, arr), from, to);
    let rows;
    if (v.aggregation === "ratio") {
      const num = S.annual(rowsOf(data.vars[v.ratio_of[0]]), "sum"), den = S.annual(rowsOf(data.vars[v.ratio_of[1]]), "sum");
      rows = num.map((r, i) => ({ ...r, v: S.isNum(r.v) && S.isNum(den[i].v) && den[i].v > 0 ? r.v / den[i].v : null }));
    } else rows = S.annual(rowsOf(data.vars[v.id]), v.aggregation);
    return { t: rows.map((r) => r.t), v: rows.map((r) => r.v) };
  }

  function kpiStats(series, v, from, to) {
    const mk = S.mannKendall(series.v, 0.05), sen = S.senSlope(series.t, series.v, 0.05);
    if (!mk.valid || !sen.valid) return null;
    const years = to - from;
    const startFit = sen.intercept + sen.slope * from;
    const change = sen.slope * years;
    const status = !mk.significant ? "gray" : sen.slope * (v.water_sign || 1) < 0 ? "red" : "green";
    return { mk, sen, change, pct: Math.abs(startFit) > 1e-9 ? (change / Math.abs(startFit)) * 100 : null,
      mean: S.mean(series.v), recent: S.mean(series.v.slice(-10)), status, series };
  }

  /** Texto llano de cada indicador. */
  function kpiText(k, st, name, from) {
    if (!st) return { big: "—", text: "Sin datos suficientes." };
    const sure = st.status !== "gray";
    switch (k.id) {
      case "tair":
        return sure ? { big: `${signed1(st.change)} °C`, text: `Desde ${from}, la temperatura media en ${name} ha ${st.change > 0 ? "subido" : "bajado"} ${fmt(Math.abs(st.change), 1)} °C.` }
          : { big: `${signed1(st.change)} °C`, text: `La temperatura de ${name} no muestra un cambio claro desde ${from}.` };
      case "eto":
        return { big: `${signedInt(st.change)} ${L_M2}`, text: sure
          ? `Cada año, el clima de ${name} evapora ${int(Math.abs(st.change))} litros más por m² que en ${from} (${signed1(st.pct)} %). El campo necesita más riego para lo mismo.`
          : `La evaporación que «pide» el clima en ${name} no ha cambiado de forma clara desde ${from}.` };
      case "precip":
        return sure ? { big: `${signedInt(st.pct)} %`, text: `Llueve ${st.change < 0 ? "menos" : "más"} que en ${from}: unos ${int(Math.abs(st.change))} litros/m² al año ${st.change < 0 ? "menos" : "más"}. Hoy caen de media ${int(st.recent)} litros/m² al año.` }
          : { big: "≈ igual", text: `La lluvia en ${name} no ha cambiado de forma clara desde ${from}. Caen de media unos ${int(st.mean)} litros por m² al año.` };
      case "balance":
        return { big: `${signedInt(st.recent)} ${L_M2}`, text: (st.recent < 0
          ? `Cada año el clima de ${name} «gasta» ${int(Math.abs(st.recent))} litros por m² más de los que llueven (media de los últimos 10 años).`
          : `En ${name} llueve más de lo que el clima evapora: sobran ${int(st.recent)} litros por m² al año (últimos 10 años).`)
          + (sure ? ` Y la cuenta ${st.status === "red" ? "va a peor" : "va a mejor"}.` : " No hay un cambio claro en el tiempo.") };
      case "gwetroot":
        return { big: sure ? `${signedInt(st.pct)} %` : "≈ igual", text: sure
          ? `El agua disponible para las raíces de los cultivos ha ${st.change < 0 ? "bajado" : "subido"} un ${int(Math.abs(st.pct))} % desde ${from}.`
          : `La humedad del suelo donde crecen las raíces no ha cambiado de forma clara desde ${from}.` };
      case "aridity": {
        const cls = aridityZone(st.recent);
        return { big: cls.charAt(0).toUpperCase() + cls.slice(1), text: `Según la clasificación de la ONU, ${name} es una zona <b>${cls}</b>` + (sure ? ` y se está volviendo ${st.status === "red" ? "más seca" : "más húmeda"}.` : "; no se ve un cambio claro desde " + from + "."), gauge: st.recent };
      }
    }
    return { big: "—", text: "" };
  }

  function sparkline(series, st, color) {
    const W = 220, H = 46, P = 3, xs = series.t, ys = series.v;
    const vals = ys.filter(S.isNum); if (vals.length < 2) return "";
    const x0 = xs[0], x1 = xs[xs.length - 1], lo = Math.min(...vals), hi = Math.max(...vals), rng = hi - lo || 1;
    const X = (x) => P + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * P), Y = (y) => H - P - ((y - lo) / rng) * (H - 2 * P);
    let d = ""; ys.forEach((y, i) => { if (S.isNum(y)) d += `${d && S.isNum(ys[i - 1]) ? "L" : "M"}${X(xs[i]).toFixed(1)},${Y(y).toFixed(1)}`; });
    const tl = `M${X(x0).toFixed(1)},${Y(st.sen.intercept + st.sen.slope * x0).toFixed(1)}L${X(x1).toFixed(1)},${Y(st.sen.intercept + st.sen.slope * x1).toFixed(1)}`;
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="#9fb3b0" stroke-width="1.4"/><path d="${tl}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"/></svg>
      <div class="spark-x"><span>${x0}</span><span>${x1}</span></div>`;
  }

  function aridityGauge(x) {
    const classes = [["Hiperárido", 0, 0.05], ["Árido", 0.05, 0.2], ["Semiárido", 0.2, 0.5], ["Subhúmedo seco", 0.5, 0.65], ["Húmedo", 0.65, 1.5]];
    // escala no lineal: cada clase ocupa el mismo ancho
    const i = classes.findIndex(([, a, b]) => x >= a && x < b), ci = i < 0 ? 4 : i;
    const [, a, b] = classes[ci], pos = ((ci + Math.min(1, Math.max(0, (x - a) / (b - a)))) / classes.length) * 100;
    return `<div class="gauge"><div class="gauge-bar">${classes.map(([n]) => `<span title="${n}"></span>`).join("")}</div><div class="gauge-mark" style="left:${pos}%"></div>
      <div class="gauge-lbl"><span>Desierto</span><span>Húmedo</span></div></div>`;
  }

  async function renderDashboard() {
    if (!$("#d-kpis")) return;
    const tok = ++D.token, from = D.from, to = CFG.period.last;
    const main = state.region, cmp = state.compare && state.compare !== main ? state.compare : "";
    const name = regionById(main).name, cname = cmp ? regionById(cmp).name : "";
    $("#d-question").textContent = `¿Se está quedando ${name} sin agua?`;
    $("#d-answer").textContent = "Descargando los datos de la NASA…";
    $("#d-verdict").innerHTML = ""; $("#d-kpis").innerHTML = '<div class="loading">🛰️ Consultando los datos de la NASA de ' + esc(name) + (cmp ? " y " + esc(cname) : "") + "…</div>";
    let dm, dc;
    try { [dm, dc] = await Promise.all([regionData(main), cmp ? regionData(cmp) : null]); }
    catch (e) { $("#d-kpis").innerHTML = `<div class="loading">No se pudieron cargar los datos: ${esc(e.message)}</div>`; return; }
    if (tok !== D.token) return; // el usuario cambió de provincia mientras cargaba

    const res = KPIS.map((k) => {
      const v = varById(k.id);
      const st = kpiStats(annualSeries(dm, v, from, to), v, from, to);
      const sc = dc ? kpiStats(annualSeries(dc, v, from, to), v, from, to) : null;
      return { k, v, st, sc };
    });
    const nRed = res.filter((r) => r.st && r.st.status === "red").length, nGreen = res.filter((r) => r.st && r.st.status === "green").length;
    const cRed = dc ? res.filter((r) => r.sc && r.sc.status === "red").length : 0;
    let verdict;
    if (nRed >= 2 && nRed > nGreen) verdict = { cls: "red", light: "🔴", title: "La presión sobre el agua está aumentando", answer: nRed >= 4 ? `Sí, ${name} va a peor: ${nRed} de 6 indicadores empeoran de forma comprobada desde ${from}.`
      : `Cada vez hay más presión sobre el agua: ${nRed} de 6 indicadores empeoran de forma comprobada desde ${from}${nGreen ? ` y ${nGreen} mejora${nGreen > 1 ? "n" : ""}` : " y ninguno mejora"}.` };
    else if (nGreen > nRed && nGreen >= 2) verdict = { cls: "green", light: "🟢", title: "La situación del agua está mejorando", answer: `No: en ${name}, ${nGreen} de 6 indicadores mejoran de forma comprobada desde ${from}.` };
    else verdict = { cls: "amber", light: "🟡", title: "Sin un cambio claro todavía", answer: `Por ahora no: en ${name} la mayoría de indicadores no muestra un cambio comprobado desde ${from}${nRed ? `, aunque ${nRed === 1 ? "uno empeora" : nRed + " empeoran"}` : ""}.` };
    $("#d-answer").textContent = verdict.answer;
    $("#d-verdict").className = "verdict " + verdict.cls;
    $("#d-verdict").innerHTML = `<span class="light" aria-hidden="true"></span><div><b>${esc(verdict.title)}</b><span class="sub">${nRed} empeoran · ${nGreen} mejoran · ${6 - nRed - nGreen} sin cambio claro${cmp ? ` &nbsp;|&nbsp; ${esc(cname)}: ${cRed} de 6 empeoran` : ""}</span></div>`;

    const colorOf = { red: COLORS.worse, green: COLORS.green, gray: COLORS.neutral };
    $("#d-kpis").innerHTML = res.map(({ k, v, st, sc }) => {
      const t = kpiText(k, st, name, from), s = STATUS[st ? st.status : "gray"];
      let cmpLine = "";
      if (sc) { const tc = kpiText(k, sc, cname, from); cmpLine = `<p class="kpi-cmp">${esc(cname)}: <b>${tc.big}</b> <span class="dot ${STATUS[sc.status].cls}"></span> ${STATUS[sc.status].label.toLowerCase()}</p>`; }
      return `<article class="kpi ${s.cls}" title="${esc(v.question)}">
        <div class="kpi-head">${k.icon}<span class="kpi-title">${esc(k.title)}</span><span class="pill-st ${s.cls}">${s.label}</span></div>
        <div class="kpi-big">${t.big}</div>
        <p class="kpi-text">${t.text}</p>
        ${t.gauge !== undefined ? aridityGauge(t.gauge) : st ? sparkline(st.series, st, colorOf[st.status]) : ""}
        ${cmpLine}
        <p class="kpi-conf">${st && st.status !== "gray" ? "✔ Cambio comprobado (95 % de confianza)" : "Los datos no muestran una tendencia clara"}</p>
      </article>`;
    }).join("");
    const src = dm.meta;
    $("#d-source").innerHTML = `Fuente: <b>NASA POWER</b> (satélites y modelos de la NASA) · ${from}–${to} · media de ${regionById(main).points.length} puntos de la provincia · ${src.mode === "live" ? "descargado en directo" : "copia guardada"} el ${new Date(src.fetched).toLocaleString("es-ES")}. 1 mm de agua = 1 litro por m².`;
  }

  function buildDashboard() {
    if (!$("#d-region")) return;
    $("#d-region").innerHTML = $("#sel-region").innerHTML;
    $("#d-compare").innerHTML = $("#sel-compare").innerHTML;
    $("#d-region").value = state.region; $("#d-compare").value = state.compare;
    const onChange = () => {
      state.region = $("#d-region").value;
      state.compare = $("#d-compare").value === state.region ? "" : $("#d-compare").value;
      syncControls(); highlightMap(); renderDashboard();
    };
    $("#d-region").addEventListener("change", onChange);
    $("#d-compare").addEventListener("change", onChange);
    document.querySelectorAll("#inicio .chip-btn").forEach((b) => b.addEventListener("click", () => {
      document.querySelectorAll("#inicio .chip-btn").forEach((x) => x.classList.toggle("on", x === b));
      D.from = +b.dataset.from; renderDashboard();
    }));
  }

  // ---------- Mapa de España (coropletas) ----------
  const M = { map: null, layers: {}, data: null, var: "eto", mode: "trend", from: null, to: null };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(",")})`; };
  const NEUTRAL = "#eef5f7";
  function diverging(t) { // t en [-1, 1]: -1 = en contra del agua, +1 = a favor
    t = Math.max(-1, Math.min(1, t));
    return t < 0 ? mix(NEUTRAL, COLORS.worse, -t) : mix(NEUTRAL, COLORS.better, t);
  }
  function quantile(arr, q) { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] : 0; }

  function computeMap() {
    const v = varById(M.var), D = M.data, out = {};
    const idx = D.years.map((y, i) => (y >= M.from && y <= M.to ? i : -1)).filter((i) => i >= 0);
    Object.entries(D.regions).forEach(([rid, vals]) => {
      const reg = regionById(rid); if (!reg || reg.type !== "provincia") return; // el mapa es por provincias
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
      return { fillColor: diverging(eff / scale.max), fillOpacity: res.significant ? 0.9 : 0.35, color: res.significant ? "#ffffff" : "#b9cdd3", weight: res.significant ? 1.2 : 0.8, dashArray: res.significant ? null : "3 3" };
    }
    let tt = scale.max > scale.min ? (res.value - scale.min) / (scale.max - scale.min) : 0.5;
    if (v.water_sign < 0) tt = 1 - tt;
    return { fillColor: v.water_sign === 0 ? mix(NEUTRAL, "#06283d", tt) : diverging(tt * 2 - 1), fillOpacity: 0.9, color: "#ffffff", weight: 1.2, dashArray: null };
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
      lg.innerHTML = `<b>${esc(v.name)}</b> · cuánto cambia cada 10 años (${esc(units)})
        <div class="bar" style="background: linear-gradient(90deg, ${COLORS.worse}, ${NEUTRAL}, ${COLORS.better})"></div>
        <div class="ends"><span>${fmtSigned(lo, smart(lo))}</span><span>0</span><span>${fmtSigned(hi, smart(hi))}</span></div>
        <div class="ends"><span>${v.water_sign === 0 ? "baja" : "peor para el agua"}</span><span>${v.water_sign === 0 ? "sube" : "mejor para el agua"}</span></div>`;
    } else {
      const lowCol = v.water_sign === 0 ? NEUTRAL : v.water_sign > 0 ? COLORS.worse : COLORS.better;
      const highCol = v.water_sign === 0 ? "#06283d" : v.water_sign > 0 ? COLORS.better : COLORS.worse;
      lg.innerHTML = `<b>${esc(v.name)}</b> · media ${M.from}–${M.to} (${esc(units)})
        <div class="bar" style="background: linear-gradient(90deg, ${lowCol}, ${NEUTRAL}, ${highCol})"></div>
        <div class="ends"><span>${fmt(scale.min, smart(scale.min))}</span><span>${fmt(scale.max, smart(scale.max))}</span></div>`;
    }
    // Ranking
    const li = ([rid, r]) => `<li data-rid="${rid}">${esc(regionById(rid).name)} <span>${M.mode === "trend" ? fmtSigned(r.value, smart(r.value)) : fmt(r.value, smart(r.value))}</span></li>`;
    const list = (title, rows) => `<h4>${title}</h4>` + (rows.length ? `<ol>${rows.map(li).join("")}</ol>` : '<p class="note">Ninguna.</p>');
    let html;
    if (M.mode === "trend") {
      const sig = Object.entries(res).filter(([, r]) => S.isNum(r.value) && r.significant);
      const eff = ([, r]) => r.value * (v.water_sign || 1);
      const worse = sig.filter((x) => eff(x) < 0).sort((a, b) => eff(a) - eff(b)).slice(0, 5);
      const better = sig.filter((x) => eff(x) > 0).sort((a, b) => eff(b) - eff(a)).slice(0, 5);
      const labels = v.water_sign === 0 ? ["Donde más baja", "Donde más sube"] : ['<span class="dot red"></span> Donde más empeora', '<span class="dot green"></span> Donde más mejora'];
      html = `<p class="note">El cambio está <b>comprobado</b> en ${sig.length} de ${Object.keys(res).length} provincias (${Math.round((1 - state.alpha) * 100)} % de confianza).</p>` + list(labels[0], worse) + list(labels[1], better);
    } else {
      const rows = Object.entries(res).filter(([, r]) => S.isNum(r.value)).sort((a, b) => a[1].value - b[1].value);
      html = list("Valores más bajos", rows.slice(0, 5)) + list("Valores más altos", rows.slice(-5).reverse());
    }
    $("#m-rank").innerHTML = html;
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
    const setVar = (id) => { M.var = id; $("#m-var").value = id; document.querySelectorAll("#m-quick .chip-btn").forEach((b) => b.classList.toggle("on", b.dataset.var === id)); renderMap(); };
    $("#m-var").addEventListener("change", (e) => setVar(e.target.value));
    document.querySelectorAll("#m-quick .chip-btn").forEach((b) => b.addEventListener("click", () => setVar(b.dataset.var)));
    $("#m-from").addEventListener("change", (e) => { M.from = +e.target.value; renderMap(); });
    $("#m-to").addEventListener("change", (e) => { M.to = +e.target.value; renderMap(); });
    document.querySelectorAll('input[name="m-mode"]').forEach((r) => r.addEventListener("change", (e) => { M.mode = e.target.value; renderMap(); }));
    $("#sel-alpha").addEventListener("change", () => renderMap());
    $("#m-rank").addEventListener("click", (e) => { const li = e.target.closest("li"); if (li) selectFromMap(li.dataset.rid); });

    M.map = L.map("chmap", { scrollWheelZoom: false, zoomSnap: 0.25, zoomControl: false }).setView([39.6, -3.7], 5.75);
    L.control.zoom({ position: "bottomright" }).addTo(M.map);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Datos: NASA POWER', maxZoom: 9, opacity: 0.35 }).addTo(M.map);
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
    fitChoropleth();
    $("#m-info").textContent = `Datos de NASA POWER (copia del ${new Date(M.data.fetched).toLocaleDateString("es-ES")}). Las cifras son el cambio cada 10 años.`;
    renderMap();
  }

  function selectFromMap(rid) {
    state.region = rid; if (state.compare === rid) state.compare = "";
    syncControls(); highlightMap();
    dirty = true;
    location.hash = "#explorar";
  }


  // ---------- Pestañas: Inicio · Mapa · Mi provincia ----------
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
  async function renderNational() {
    let D0;
    try { D0 = await getJSON("data/map/annual.json"); } catch (e) { console.warn("Inicio: sin datos nacionales", e); return; }
    const from = 1991, to = CFG.period.last;
    const idx = D0.years.map((y, i) => (y >= from && y <= to ? i : -1)).filter((i) => i >= 0);
    const provs = Object.keys(D0.regions).filter((rid) => { const r = regionById(rid); return r && r.type === "provincia"; });
    const N = provs.length;
    const stat = (vid) => provs.map((rid) => {
      const ser = D0.regions[rid][vid]; if (!ser) return null;
      const t = idx.map((i) => D0.years[i]), y = idx.map((i) => ser[i]);
      const mk = S.mannKendall(y, 0.05), sen = S.senSlope(t, y, 0.05);
      return mk.valid && sen.valid ? { rid, sig: mk.significant, slope: sen.slope, mean: S.mean(y) } : null;
    }).filter(Boolean);
    const up = (a) => a.filter((x) => x.sig && x.slope > 0).length, down = (a) => a.filter((x) => x.sig && x.slope < 0).length;
    const P = stat("precip"), T = stat("tair"), E = stat("eto"), B = stat("balance"), A = stat("aridity"),
      SPI = stat("spi12"), SM = stat("gwetroot"), TX = stat("tmax"), SN = stat("snow"), GP = stat("gwetprof");
    const noChange = P.filter((x) => !x.sig).length;
    const tAvg = S.mean(T.map((x) => x.slope * 10));
    const deficit = B.filter((x) => x.mean < 0).length;
    const arid = A.filter((x) => x.mean < 0.5).length;
    const of = (n) => `${n} de ${N}`;
    setLive("precip", of(noChange)); setLive("precip-text", `${noChange} de las ${N}`);
    setLive("tair", of(up(T))); setLive("tair-text", `${up(T)} de las ${N}`); setLive("tair-avg", `${signed1(tAvg)} °C`);
    setLive("eto", of(up(E))); setLive("eto-text", `${up(E)} de las ${N}`);
    setLive("eto-down", down(E) ? `y solo baja en ${down(E)}` : "y no baja en ninguna");
    setLive("balance", of(deficit)); setLive("balance-text", `${deficit} de las ${N}`); setLive("arid-text", `${arid}`);
    const line = (txt) => `<b>En España:</b> ${txt}`;
    setLive("p-drought", line(`el índice de sequía empeora de forma comprobada en ${down(SPI)} provincias y mejora en ${up(SPI)}.`));
    setLive("p-irrig", line(`la demanda de riego sube en ${up(E)} provincias; la humedad del suelo baja en ${down(SM)}.`));
    setLive("p-desert", line(`${arid} provincias son áridas o semiáridas; la aridez avanza de forma comprobada en ${down(A)}.`));
    setLive("p-heat", line(`la máxima extrema del año sube de forma comprobada en ${up(TX)} provincias.`));
    setLive("p-reserve", line(`la nieve baja de forma comprobada en ${down(SN)} provincias y la humedad profunda en ${down(GP)}.`));
  }

  // ---------- Inicio: historia del depósito con datos reales de Almería ----------
  function setLive(key, html) { document.querySelectorAll(`[data-live="${key}"]`).forEach((el) => (el.innerHTML = html)); }
  async function renderLanding() {
    try {
      const d = await regionData("almeria");
      const from = 1991, to = CFG.period.last;
      const g = (id) => kpiStats(annualSeries(d, varById(id), from, to), varById(id), from, to);
      const p = g("precip"), t = g("tair"), e = g("eto"), b = g("balance");
      if (p) { setLive("precip", `≈ ${int(p.mean)} litros`); setLive("precip-text", int(p.mean)); }
      if (t) setLive("tair", `${signed1(t.change)} °C`);
      if (e) { setLive("eto", `${signedInt(e.change)} litros`); setLive("eto-text", int(Math.abs(e.change))); }
      if (b) { setLive("balance", `${signedInt(b.recent)} litros`); setLive("balance-text", int(Math.abs(b.recent))); }
    } catch (err) { console.warn("Inicio: se mantienen las cifras de referencia", err); }
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
    buildControls(); syncControls(); buildDashboard(); buildMap(); buildChoropleth();
    initStory(); showView();
    window.addEventListener("hashchange", showView);
    renderNational();
    if (fromHash) run();
  }
  window.addEventListener("hashchange", () => { if (CFG.regions.length && readHash()) { syncControls(); highlightMap(); run(); } });
  document.addEventListener("DOMContentLoaded", init);
})();
