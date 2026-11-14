/*
 * i18n.js — Textos fijos de la página en inglés.
 * El español es el texto que ya está en el HTML: al arrancar se guarda tal cual y se restaura al volver a ES.
 * Los textos que se generan con los datos (frases de tendencia, mapa, PDF) se traducen en app.js.
 */
(function (root) {
  "use strict";
  const EN = {
    "skip": "Skip to content",
    "nav.home": "Home",
    "nav.map": "Map of Spain",
    "nav.panel": "Analysis panel",
    "hero.title": "Is Spain running out of water?",
    "hero.sub": "Longer droughts, crops that need more irrigation, soils drying out. Neoda uses 45 years of NASA data to measure what is really changing in each Spanish province.",
    "hero.cue": "Scroll down to see what is happening to water in Spain",
    "tank.label": "Water available in Spain",
    "s1.h": "Rainfall has barely changed.",
    "s1.p": "Since 1991, rainfall shows no clear change in <span data-live=\"precip-text\">most</span> provinces. If we only looked at rain, we would say nothing is happening.",
    "s2.h": "But it is getting hotter all over Spain.",
    "s2.p": "Mean temperature has risen in a confirmed way in <span data-live=\"tair-text\">almost every</span> province, by <span data-live=\"tair-avg\">+0.4 °C</span> per decade on average. And with heat, water disappears faster.",
    "s3.h": "Every year the climate asks for more water.",
    "s3.p": "The evaporation the climate demands is growing in a confirmed way in <span data-live=\"eto-text\">many</span> provinces, <span data-live=\"eto-down\">and falls in none</span>. Growing the same crops takes more irrigation.",
    "s4.h": "And in much of the country the numbers no longer add up.",
    "s4.p": "In <span data-live=\"balance-text\">many</span> provinces the climate evaporates more water than falls as rain, and <span data-live=\"arid-text\">several</span> are already arid or semi-arid according to the UN. That gap is covered by reservoirs, aquifers and desalination plants, under growing pressure.",
    "cta.h": "See where it is happening",
    "cta.map": "All 52 provinces, coloured by how each water indicator is changing",
    "cta.panel": "All 19 variables with full statistics, province by province",
    "map.title": "Water in Spain, province by province",
    "map.ask": "What do you want to know?",
    "map.view": "Show",
    "map.trend": "How it has changed since 1991",
    "map.mean": "How it is now",
    "panel.title": "Trend analysis panel",
    "panel.intro": "For the scientific team: choose a province, another one to compare and the indicators. Every change is recalculated instantly with NASA POWER data downloaded live, using Sen's slope, the Mann-Kendall test, the t-test and their confidence intervals.",
    "panel.where": "Where",
    "panel.province": "Province",
    "panel.compare": "Compare with",
    "panel.optional": "(optional)",
    "panel.what": "Which variables",
    "panel.rec": "Recommended",
    "panel.all": "All",
    "panel.none": "None",
    "panel.how": "How",
    "panel.from": "From",
    "panel.to": "To",
    "panel.res": "Time resolution",
    "panel.annual": "Annual (recommended)",
    "panel.monthly": "Monthly, seasonal cycle removed",
    "panel.conf": "Confidence level",
    "panel.run": "Recalculate",
    "panel.loading": "Loading…",
    "panel.kicker": "Combined water resources index",
    "panel.drivers": "Which variable drives the change?",
    "panel.driversNote": "Trend of each variable in standard deviations per decade, signed by its effect on water: <span class=\"sw pos\"></span> more water, <span class=\"sw neg\"></span> less water.",
    "panel.pdf": "Download PDF report",
    "panel.detail": "Detail by variable",
    "m.title": "Method",
    "m.1h": "1 · Variables",
    "m.1p": "Each variable describes part of the water cycle: what <b>comes in</b> (rain), what the atmosphere <b>demands</b> (temperature, evapotranspiration, wind, radiation), what stays <b>stored</b> in the soil, and the derived <b>indicators</b> (balance, aridity, drought).",
    "m.2h": "2 · Region",
    "m.2p": "We download the monthly <b>NASA POWER</b> API live (MERRA-2 reanalysis, GPM-corrected rainfall, GEOS soil moisture) at several points across the province and average them, month by month, since 1981.",
    "m.3h": "3 · Time series",
    "m.3p": "In <b>annual</b> mode we add up or average the 12 months of each year. In <b>monthly</b> mode we subtract each month's historical mean to remove the seasonal cycle.",
    "m.4h": "4 · Statistics",
    "m.4p": "<b>Sen's slope</b>: a robust rate of change. <b>Mann-Kendall</b>: does the series rise or fall consistently? <b>t-test</b> on the regression and <b>confidence intervals</b>. A trend is <i>significant</i> when p &lt; α.",
    "m.5h": "Computed variables",
    "m.5p": "<b>ETo</b>: FAO-56 Penman-Monteith. <b>Balance</b> = P − ETo. <b>Aridity</b> = annual P / ETo (UNEP classes). <b>SPI-12</b>: gamma fit of 12-month accumulated rainfall. <b>Combined index</b>: mean of standardised anomalies, signed by their effect on water.",
    "m.6h": "Limitations",
    "m.6p": "Satellites do not see reservoirs, aquifers or desalination plants. The NASA POWER grid is ~50 km: it describes the climate of an area, not of a single farm. Two variables changing together does not prove that one causes the other.",
    "foot.1": "<b>Neoda</b> · Project for the <a href=\"https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/\" target=\"_blank\" rel=\"noopener\">NASA Space Apps Challenge 2026</a>, challenge «Be an Earth System Trend Detective». Granada.",
    "foot.2": "Data: <a href=\"https://power.larc.nasa.gov/\" target=\"_blank\" rel=\"noopener\">NASA POWER</a> (NASA Langley Research Center). Base map © OpenStreetMap. Open source on <a href=\"https://github.com/fpanero/Neoda_Heeramienta_Medicion\" target=\"_blank\" rel=\"noopener\">GitHub</a>.",
  };
  const ES_TITLE = "Neoda · ¿Se está quedando España sin agua?";
  const EN_TITLE = "Neoda · Is Spain running out of water?";
  let esCache = null;

  /** Aplica los textos fijos del idioma pedido. */
  function applyStatic(lang) {
    const els = document.querySelectorAll("[data-i18n]");
    if (!esCache) { esCache = new Map(); els.forEach((el) => esCache.set(el, el.innerHTML)); }
    els.forEach((el) => {
      const html = lang === "en" ? EN[el.dataset.i18n] : esCache.get(el);
      if (html !== undefined) el.innerHTML = html;
    });
    document.documentElement.lang = lang;
    document.title = lang === "en" ? EN_TITLE : ES_TITLE;
  }
  root.I18N = { applyStatic };
})(window);
