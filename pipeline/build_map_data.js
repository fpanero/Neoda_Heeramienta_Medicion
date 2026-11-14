/*
 * Precalcula las series ANUALES de todas las variables para todas las regiones, a partir de la copia
 * de NASA POWER (web/data/power/<region>.json), con el mismo código que usa la web (power.js + stats.js).
 * Salida: web/data/map/annual.json  → { years: [1981..], regions: { id: { var: [valor por año] } } }
 * La web calcula las tendencias del mapa en el navegador sobre estas series (periodo y α a elección).
 *
 * Uso: node pipeline/build_map_data.js
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const WEB = path.join(ROOT, "web");
const Stats = require(path.join(WEB, "js", "stats.js"));
globalThis.Stats = Stats;
const Power = require(path.join(WEB, "js", "power.js"));

const variables = JSON.parse(fs.readFileSync(path.join(WEB, "config", "variables.json"), "utf8"));
const regions = JSON.parse(fs.readFileSync(path.join(WEB, "config", "regions.json"), "utf8")).regions;
const { first, last } = variables.period;
const years = [];
for (let y = first; y <= last; y++) years.push(y);

const round = (v) => (Stats.isNum(v) ? Math.round(v * 10000) / 10000 : null);
const out = { generated: new Date().toISOString(), years, regions: {}, missing: [] };

for (const r of regions) {
  const f = path.join(WEB, "data", "power", `${r.id}.json`);
  if (!fs.existsSync(f)) { out.missing.push(r.id); continue; }
  const snap = JSON.parse(fs.readFileSync(f, "utf8"));
  const vars = Power.build(snap.points, snap.start, snap.end);
  const start = `${snap.start}-01`;
  const annualOf = (arr, agg) => {
    const a = Stats.annual(Stats.filterYears(Stats.toMonthly(start, arr), first, last), agg);
    const byYear = new Map(a.map((x) => [x.year, x.v]));
    return years.map((y) => (byYear.has(y) ? byYear.get(y) : null));
  };
  const reg = {};
  for (const v of variables.variables) {
    if (v.aggregation === "ratio") {
      const num = annualOf(vars[v.ratio_of[0]], "sum"), den = annualOf(vars[v.ratio_of[1]], "sum");
      reg[v.id] = num.map((n, i) => round(Stats.isNum(n) && Stats.isNum(den[i]) && den[i] > 0 ? n / den[i] : null));
    } else {
      reg[v.id] = annualOf(vars[v.id], v.aggregation).map(round);
    }
  }
  out.regions[r.id] = reg;
  out.fetched = snap.fetched;
}

fs.mkdirSync(path.join(WEB, "data", "map"), { recursive: true });
fs.writeFileSync(path.join(WEB, "data", "map", "annual.json"), JSON.stringify(out));
console.log(`Mapa: ${Object.keys(out.regions).length} regiones, ${out.missing.length} sin copia (${out.missing.join(", ")})`);
