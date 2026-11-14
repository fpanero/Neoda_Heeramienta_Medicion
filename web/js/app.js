/* app.js — Interfaz de Neoda. Lee la configuración y las series (web/data), ejecuta Stats y pinta resultados. */
(function () {
  "use strict";
  const S = window.Stats;
  const $ = (sel) => document.querySelector(sel);
  const RECOMMENDED = ["precip", "tair", "et", "sm_root", "ndvi"];
  const COLORS = { main: "#1f6f8b", compare: "#c2622d", trend: "#12302f", trend2: "#8a3a12", grid: "#e9e1d2" };
  const PLOT_CFG = { displayModeBar: false, responsive: true };

  const state = { region: "almeria", compare: "galicia", vars: new Set(RECOMMENDED), from: null, to: null, mode: "annual", alpha: 0.05 };
  let CFG = { variables: [], groups: [], regions: [], manifest: { series: {} } };
  const cache = new Map();
  let lastResults = null, map, rectLayers = {};

  // ---------- Formato ----------
  const fmt = (v, d = 2) => (S.isNum(v) ? v.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
  const fmtSigned = (v, d = 2) => (S.isNum(v) ? (v > 0 ? "+" : "") + fmt(v, d) : "—");
  const fmtP = (p) => (!S.isNum(p) ? "—" : p < 0.001 ? "< 0,001" : fmt(p, 3));
  const pTxt = (p) => (S.isNum(p) && p < 0.001 ? "p < 0,001" : `p = ${fmtP(p)}`);
  const smart = (v) => { const a = Math.abs(v); return a === 0 ? 2 : a < 0.01 ? 4 : a < 1 ? 3 : a < 100 ? 2 : 1; };
  const varById = (id) => CFG.variables.find((v) => v.id === id);
  const regionById = (id) => CFG.regions.find((r) => r.id === id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- Carga de datos ----------
  async function getJSON(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${r.status} al cargar ${url}`);
    return r.json();
  }
  async function loadSeries(region, variable) {
    const key = `${region}/${variable}`;
    if (!CFG.manifest.series[region] || !CFG.manifest.series[region][variable]) return null;
    if (!cache.has(key)) cache.set(key, getJSON(`data/series/${key}.json`).catch(() => null));
    return cache.get(key);
  }

  function unitsFor(v, mode) {
    if (mode === "monthly") return `anomalía, ${v.units}`;
    if (v.aggregation === "sum") return v.units.replace("/mes", "/año");
    if (v.aggregation === "max") return `${v.units}, máx. del año`;
    return v.units;
  }

  /** Construye la serie a analizar: anual agregada o mensual sin ciclo estacional. */
  async function prepared(regionId, v) {
    const raw = await loadSeries(regionId, v.id);
    if (!raw) return null;
    const rows = S.filterYears(S.toMonthly(raw.start, raw.values), state.from, state.to);
    const series = state.mode === "annual" ? S.annual(rows, v.aggregation) : S.monthlyAnomalies(rows);
    const baseline = state.mode === "annual" ? S.mean(series.map((r) => r.v)) : (() => { const a = S.annual(rows, v.aggregation); return S.mean(a.map((r) => r.v)); })();
    return { t: series.map((r) => r.t), v: series.map((r) => r.v), baseline, source: raw.source || {}, units: unitsFor(v, state.mode) };
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
    const allowPct = state.mode === "annual" && !/°C|índice|cm/.test(v.units) && S.isNum(r.baseline) && r.baseline > 1e-6;
    if (allowPct) pct = ` (${fmtSigned((per / r.baseline) * 100, 1)} % por década respecto a la media)`;
    const head = `En ${regionName}, ${v.name.toLowerCase()} ${dir} a un ritmo de ${fmt(Math.abs(per), smart(per))} ${r.units} cada década${pct}.`;
    if (r.mk.significant) {
      const effect = v.water_sign === 0 ? "" : (per * v.water_sign < 0 ? " Este cambio juega en contra de los recursos hídricos." : " Este cambio favorece los recursos hídricos.");
      return `${head} La tendencia es <b>estadísticamente significativa</b> al ${conf} % (Mann-Kendall, ${pTxt(r.mk.p)}): es muy poco probable que sea casualidad.${effect}`;
    }
    return `${head} Pero la tendencia <b>no es significativa</b> (${pTxt(r.mk.p)}): puede ser variabilidad natural. Con más años de datos podría llegar a confirmarse.`;
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
    if (neg.length) t += ` Lo que más resta agua: ${neg.map((c) => c.name.toLowerCase()).join(" y ")}.`;
    if (pos.length) t += ` Lo que más suma: ${pos.map((c) => c.name.toLowerCase()).join(" y ")}.`;
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
    return src.type === "demo" ? '<span class="pill demo">DEMO</span>' : '<span class="pill real">NASA</span>';
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
      }], { ...baseLayout(""), margin: { l: 175, r: 10, t: 6, b: 32 }, hovermode: "closest", xaxis: { title: { text: "σ por década", font: { size: 11 } }, gridcolor: COLORS.grid, zerolinecolor: "#12302f" } }, PLOT_CFG);
    } else {
      Plotly.purge("chart-index"); Plotly.purge("chart-contrib");
    }

    // Tarjetas por variable
    const cards = $("#cards"); cards.innerHTML = "";
    let anyDemo = false;
    L.vars.forEach((v) => {
      const r = L.results[main][v.id], rc = cmp ? L.results[cmp][v.id] : null;
      if (r && r.source.type === "demo") anyDemo = true;
      if (rc && rc.source.type === "demo") anyDemo = true;
      const el = document.createElement("article");
      el.className = "card vcard";
      const per = r && r.sen.valid ? r.sen.slope * 10 : null;
      const tag = !r ? "" : !r.mk.significant ? '<span class="tag">sin tendencia significativa</span>' : per < 0 ? '<span class="tag down">▼ significativa</span>' : '<span class="tag up">▲ significativa</span>';
      el.innerHTML = `
        <h3>${esc(v.name)} ${r ? sourceTag(r.source) : ""} ${tag}</h3>
        <p class="interp">${interpretVar(v, r, regionById(main).name)}</p>
        <div class="chart" id="ch-${v.id}"></div>
        ${r ? statsTable(r, rc, cmp) : ""}
        <p class="src">${esc(v.description)}<br>Fuente prevista: ${esc(v.source.dataset)} · ${esc(v.source.provider)} · ${esc(v.source.resolution)}</p>`;
      cards.appendChild(el);
      if (r) {
        const tr = traces(r, regionById(main).name, COLORS.main, COLORS.trend);
        if (rc) tr.push(...traces(rc, regionById(cmp).name, COLORS.compare, COLORS.trend2, "dash"));
        Plotly.newPlot(`ch-${v.id}`, tr, baseLayout(r.units), PLOT_CFG);
      }
    });
    $("#demo-banner").hidden = !anyDemo;
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
      L.vars.forEach((v) => { const r = L.results[rid][v.id]; if (r) push(rid, v.id, v.id, r, r.units, r.source.type); });
      if (L.index[rid]) push(rid, "indice", "indice_combinado", L.index[rid], "sigma", "derivado");
    });
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `neoda_${L.regions.join("_vs_")}_${L.from}-${L.to}.csv`; a.click();
  }

  // ---------- Controles ----------
  function buildControls() {
    const regOpts = CFG.regions.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("");
    $("#sel-region").innerHTML = regOpts;
    $("#sel-compare").innerHTML = '<option value="">— Ninguna —</option>' + regOpts;

    // Años disponibles según el manifiesto
    let minY = 9999, maxY = 0;
    Object.values(CFG.manifest.series).forEach((vars) => Object.values(vars).forEach((m) => { minY = Math.min(minY, +m.start.slice(0, 4)); maxY = Math.max(maxY, +m.end.slice(0, 4)); }));
    if (minY > maxY) { minY = 2001; maxY = 2025; }
    const yrs = []; for (let y = minY; y <= maxY; y++) yrs.push(`<option>${y}</option>`);
    $("#sel-from").innerHTML = yrs.join(""); $("#sel-to").innerHTML = yrs.join("");
    if (state.from === null) state.from = minY; if (state.to === null) state.to = maxY;

    const list = $("#var-list"); list.innerHTML = "";
    CFG.groups.forEach((g) => {
      const vs = CFG.variables.filter((v) => v.group === g.id);
      if (!vs.length) return;
      const box = document.createElement("div"); box.className = "var-group";
      box.innerHTML = `<h4 title="${esc(g.description)}">${esc(g.name)}</h4>` + vs.map((v) => {
        const sc = v.water_sign > 0 ? "pos" : v.water_sign < 0 ? "neg" : "zero", st = v.water_sign > 0 ? "+" : v.water_sign < 0 ? "−" : "·";
        const tip = `${v.description} Unidades: ${v.units}. Efecto sobre el agua: ${v.water_sign > 0 ? "más = más agua" : v.water_sign < 0 ? "más = menos agua" : "no entra en el índice"}.`;
        return `<label class="var-item"><input type="checkbox" value="${v.id}"><span class="vname">${esc(v.name)}</span><span class="sign ${sc}" title="Efecto sobre el agua">${st}</span><button type="button" class="info" data-tip="${esc(tip)}" aria-label="Qué es ${esc(v.name)}">i</button></label>`;
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
      Object.assign(state, { region: "almeria", compare: "galicia", vars: new Set([...RECOMMENDED, "pet", "tws"]), mode: "annual", alpha: 0.05 });
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
  function buildMap() {
    if (!window.L) return;
    map = L.map("map", { zoomControl: false, attributionControl: true, scrollWheelZoom: false }).setView([38.5, -3.5], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 10 }).addTo(map);
    CFG.regions.forEach((r) => {
      const [w, s, e, n] = r.bbox;
      const rect = L.rectangle([[s, w], [n, e]], { weight: 1, color: "#1f6f8b", fillOpacity: 0.08 }).addTo(map);
      rect.bindTooltip(r.name);
      rect.on("click", () => { state.region = r.id; if (state.compare === r.id) state.compare = ""; syncControls(); highlightMap(); });
      rectLayers[r.id] = rect;
    });
    highlightMap();
  }
  function highlightMap() {
    Object.entries(rectLayers).forEach(([id, rect]) => {
      const sel = id === state.region, cmp = id === state.compare;
      rect.setStyle({ color: sel ? "#1f6f8b" : cmp ? "#c2622d" : "#7a8a86", weight: sel || cmp ? 2.5 : 0.8, fillOpacity: sel || cmp ? 0.28 : 0.05, fillColor: cmp ? "#c2622d" : "#1f6f8b" });
      if (sel || cmp) rect.bringToFront();
    });
    if (map && rectLayers[state.region]) map.fitBounds(L.featureGroup(Object.values(rectLayers)).getBounds().pad(0.15), { animate: true });
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
      const [vars, regs, manifest] = await Promise.all([getJSON("config/variables.json"), getJSON("config/regions.json"), getJSON("data/manifest.json")]);
      CFG = { variables: vars.variables, groups: vars.groups, regions: regs.regions, manifest };
    } catch (e) {
      $("#empty").innerHTML = `<h2>No se pudieron cargar los datos</h2><p>${esc(e.message)}</p>`;
      return;
    }
    const fromHash = readHash();
    buildControls(); syncControls(); buildMap();
    if (fromHash) run();
  }
  window.addEventListener("hashchange", () => { if (CFG.regions.length && readHash()) { syncControls(); highlightMap(); run(); } });
  document.addEventListener("DOMContentLoaded", init);
})();
