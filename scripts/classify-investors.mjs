// classify-investors.mjs
// Classifies each institutional holder of HEI / HEI.A by investment style:
//   Growth | Value | Momentum/Quant | Income | Blend/Core | Unclassified
//
// Method (the same approach surveillance firms use):
//  1) A CURATED database of well-known managers -> style. High confidence.
//     These names dominate the share count, so the share-weighted picture is
//     almost entirely curated.
//  2) KEYWORD heuristics for the long tail (fund-name giveaways like
//     "Dividend", "Value", "Growth", quant/hedge tells, wealth/trust = blend).
//  3) Anything left is "Unclassified" (we don't guess).
//
// Output: data/investor-styles.json  { asOf, combined, hei, heia }
// Each block: { total, categories:[{style,holders,holderPct,shares,sharePct,examples}],
//               coverage:{curated,heuristic,unclassified} }

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DATA = join(process.cwd(), "data");
const read = (f) => { try { return JSON.parse(readFileSync(join(DATA, f), "utf8")); } catch { return null; } };

const STYLES = ["Growth", "Value", "Momentum/Quant", "Income", "Blend/Core", "Unclassified"];

// ── 1) CURATED database ─────────────────────────────────────────────
// Each entry: [test, style]. test is a lowercase substring matched against the
// normalized filer name. Order matters: first match wins, so put the most
// specific tokens first. Confidence = "curated".
const CURATED = [
  // ---- Momentum / Quant / systematic & multi-strat hedge & market-makers ----
  ["two sigma", "Momentum/Quant"],
  ["renaissance tech", "Momentum/Quant"],
  ["d. e. shaw", "Momentum/Quant"], ["d.e. shaw", "Momentum/Quant"], ["de shaw", "Momentum/Quant"],
  ["aqr capital", "Momentum/Quant"],
  ["acadian", "Momentum/Quant"],
  ["arrowstreet", "Momentum/Quant"],
  ["panagora", "Momentum/Quant"],
  ["squarepoint", "Momentum/Quant"],
  ["balyasny", "Momentum/Quant"],
  ["millennium management", "Momentum/Quant"], ["millennium mgmt", "Momentum/Quant"],
  ["citadel", "Momentum/Quant"],
  ["point72", "Momentum/Quant"], ["point 72", "Momentum/Quant"],
  ["marshall wace", "Momentum/Quant"],
  ["man group", "Momentum/Quant"],
  ["numeric", "Momentum/Quant"],
  ["voloridge", "Momentum/Quant"],
  ["qube research", "Momentum/Quant"],
  ["walleye", "Momentum/Quant"],
  ["schonfeld", "Momentum/Quant"],
  ["verition", "Momentum/Quant"],
  ["exoduspoint", "Momentum/Quant"],
  ["jane street", "Momentum/Quant"],
  ["susquehanna", "Momentum/Quant"],
  ["optiver", "Momentum/Quant"],
  ["hudson river trading", "Momentum/Quant"],
  ["tower research", "Momentum/Quant"],
  ["jump trading", "Momentum/Quant"],
  ["de shaw", "Momentum/Quant"],
  ["woodline", "Momentum/Quant"],
  ["cubist", "Momentum/Quant"],
  ["freestone", "Momentum/Quant"],
  ["bridgewater", "Momentum/Quant"],
  ["pdt partners", "Momentum/Quant"],
  ["quantitative", "Momentum/Quant"],
  ["quantinno", "Momentum/Quant"],

  // ---- Growth ----
  ["t rowe price", "Growth"], ["t. rowe price", "Growth"], ["price t rowe", "Growth"],
  ["capital world investors", "Growth"],
  ["capital international investors", "Growth"],
  ["capital research", "Growth"],
  ["american century", "Growth"],
  ["blair william", "Growth"], ["william blair", "Growth"],
  ["harding loevner", "Growth"],
  ["riverbridge", "Growth"],
  ["bamco", "Growth"], ["baron capital", "Growth"],
  ["fisher asset", "Growth"], ["fisher investments", "Growth"],
  ["congress asset", "Growth"],
  ["jennison", "Growth"],
  ["wasatch", "Growth"],
  ["brown advisory", "Growth"],
  ["sands capital", "Growth"],
  ["ark investment", "Growth"],
  ["whale rock", "Growth"],
  ["coatue", "Growth"],
  ["tiger global", "Growth"],
  ["lone pine", "Growth"],
  ["polen capital", "Growth"],
  ["edgewood", "Growth"],
  ["winslow capital", "Growth"],
  ["sustainable growth", "Growth"],
  ["clearbridge", "Growth"],
  ["fmr llc", "Growth"], ["fidelity", "Growth"],   // Fidelity: growth-leaning flagship complex
  ["janus henderson", "Growth"], ["janus capital", "Growth"],
  ["morgan stanley investment", "Growth"],          // MSIM growth franchises (not the broker aggregate)
  ["stephens investment", "Growth"],
  ["mar vista", "Growth"],
  ["cooke & bieler", "Growth"],
  ["provident investment", "Growth"],
  ["conestoga", "Growth"],
  ["kayne anderson rudnick", "Growth"],
  ["chartwell", "Growth"],
  ["fred alger", "Growth"], ["alger management", "Growth"],
  ["df dent", "Growth"], ["d f dent", "Growth"], ["d. f. dent", "Growth"],
  ["nzs capital", "Growth"],
  ["geneva capital", "Growth"],
  ["marsico", "Growth"],
  ["sirios", "Growth"],
  ["baillie gifford", "Growth"],
  ["capital international, inc", "Growth"], ["capital international inc", "Growth"],

  // ---- Value ----
  ["dodge & cox", "Value"], ["dodge and cox", "Value"],
  ["barrow hanley", "Value"], ["barrow, hanley", "Value"],
  ["pzena", "Value"],
  ["lsv asset", "Value"],
  ["diamond hill", "Value"],
  ["first eagle", "Value"],
  ["tweedy", "Value"],
  ["hotchkis", "Value"],
  ["boston partners", "Value"],
  ["aristotle capital", "Value"],
  ["ariel investments", "Value"],
  ["sound shore", "Value"],
  ["schafer cullen", "Value"],
  ["cullen capital", "Value"],
  ["dimensional fund", "Value"], ["dimensional", "Value"], // factor: value/size tilt
  ["gabelli", "Value"], ["gamco", "Value"],
  ["olstein", "Value"],
  ["heartland advisors", "Value"],
  ["towle", "Value"],
  ["yacktman", "Value"],
  ["nwq", "Value"],
  ["river road asset", "Value"],
  ["pacific financial", "Value"],
  ["hillsdale", "Value"],
  ["snyder capital", "Value"],
  ["giverny", "Value"],
  ["fenimore", "Value"],
  ["weitz investment", "Value"],
  ["mairs & power", "Value"], ["mairs and power", "Value"],

  // ---- Momentum / Quant (more) ----
  ["aristeia", "Momentum/Quant"],
  ["hrt financial", "Momentum/Quant"],
  ["landscape capital", "Momentum/Quant"],

  // ---- Income (dividend / yield focused) ----
  ["reaves", "Income"],
  ["miller/howard", "Income"], ["miller howard", "Income"],
  ["federated hermes", "Blend/Core"],  // diversified complex, not primarily income

  // ---- Blend / Core (index, passive, diversified active, bank/broker trust) ----
  ["blackrock", "Blend/Core"],
  ["vanguard", "Blend/Core"],
  ["state street", "Blend/Core"],
  ["geode capital", "Blend/Core"],
  ["charles schwab", "Blend/Core"], ["schwab", "Blend/Core"],
  ["northern trust", "Blend/Core"],
  ["bank of new york", "Blend/Core"], ["bny mellon", "Blend/Core"], ["mellon", "Blend/Core"],
  ["legal & general", "Blend/Core"], ["legal and general", "Blend/Core"],
  ["nuveen", "Blend/Core"],
  ["voya", "Blend/Core"],
  ["invesco", "Blend/Core"],
  ["dws", "Blend/Core"], ["deutsche bank", "Blend/Core"],
  ["ubs", "Blend/Core"],
  ["morgan stanley", "Blend/Core"],   // broker/aggregate (after MSIM check above)
  ["goldman sachs", "Blend/Core"],
  ["bank of america", "Blend/Core"],
  ["jpmorgan", "Blend/Core"], ["jp morgan", "Blend/Core"], ["j.p. morgan", "Blend/Core"],
  ["wells fargo", "Blend/Core"],
  ["bnp paribas", "Blend/Core"],
  ["barclays", "Blend/Core"],
  ["credit suisse", "Blend/Core"],
  ["hsbc", "Blend/Core"],
  ["allianz", "Blend/Core"], ["pimco", "Blend/Core"],
  ["allspring", "Blend/Core"],
  ["macquarie", "Blend/Core"],
  ["amundi", "Blend/Core"],
  ["natixis", "Blend/Core"],
  ["franklin resources", "Blend/Core"], ["franklin advisers", "Blend/Core"],
  ["alliancebernstein", "Blend/Core"],
  ["dimensional holdings", "Blend/Core"],
  ["american international", "Blend/Core"],
  ["prudential", "Blend/Core"],
  ["metlife", "Blend/Core"],
  ["teachers insurance", "Blend/Core"], ["tiaa", "Blend/Core"],
  ["california public employees", "Blend/Core"], ["calpers", "Blend/Core"],
  ["california state teachers", "Blend/Core"], ["calstrs", "Blend/Core"],
  ["new york state", "Blend/Core"],
  ["florida state board", "Blend/Core"],
  ["swiss national bank", "Blend/Core"],
  ["norges bank", "Blend/Core"],
  ["government pension", "Blend/Core"],
  ["national pension", "Blend/Core"],
  ["raymond james", "Blend/Core"],
  ["ameriprise", "Blend/Core"],
  ["lpl financial", "Blend/Core"],
  ["fifth third", "Blend/Core"],
  ["pnc", "Blend/Core"],
  ["us bancorp", "Blend/Core"], ["u.s. bancorp", "Blend/Core"],
  ["citigroup", "Blend/Core"], ["citadel securities", "Momentum/Quant"],
  ["royal bank of canada", "Blend/Core"], ["rbc", "Blend/Core"],
  ["toronto dominion", "Blend/Core"], ["td ", "Blend/Core"],
  ["bank of montreal", "Blend/Core"], ["bmo", "Blend/Core"],
  ["nordea", "Blend/Core"],
  ["mackenzie", "Blend/Core"],
  ["principal financial", "Blend/Core"], ["principal global", "Blend/Core"],
  ["wellington management", "Blend/Core"],
  ["neuberger berman", "Blend/Core"],
  ["victory capital", "Blend/Core"],
  ["fiera", "Blend/Core"],
  ["nomura", "Blend/Core"],
  ["schroder", "Blend/Core"],
  ["brown brothers harriman", "Blend/Core"],
  ["sei investments", "Blend/Core"],
  ["stifel", "Blend/Core"],
  ["baird", "Blend/Core"],
  ["jones financial", "Blend/Core"], ["edward jones", "Blend/Core"],
  ["russell investments", "Blend/Core"],
  ["envestnet", "Blend/Core"],
  ["tcw group", "Blend/Core"],
  ["palisade capital", "Blend/Core"],
  ["markel", "Blend/Core"],
  ["eulav", "Blend/Core"],
  ["state of wisconsin", "Blend/Core"], ["wisconsin investment board", "Blend/Core"],
  ["strs ohio", "Blend/Core"],
  ["investment management corp of ontario", "Blend/Core"],
  ["local pensions partnership", "Blend/Core"],
  ["apg asset", "Blend/Core"],
  ["australiansuper", "Blend/Core"],
  ["aviva", "Blend/Core"],
  ["swedbank", "Blend/Core"],
  ["kbc group", "Blend/Core"],
  ["kantonalbank", "Blend/Core"],
  ["asr vermogens", "Blend/Core"],
  ["asset management one", "Blend/Core"],
  ["mitsubishi ufj", "Blend/Core"],
  ["resona", "Blend/Core"],
  ["sumitomo mitsui", "Blend/Core"],
  ["nissay", "Blend/Core"],
  ["erste asset", "Blend/Core"],
  ["efg international", "Blend/Core"],
  ["liontrust", "Blend/Core"],
  ["jupiter", "Blend/Core"],
  ["sg americas", "Blend/Core"],
  ["segall bryant", "Blend/Core"],
  ["assetmark", "Blend/Core"],
  ["cerity partners", "Blend/Core"],
  ["sixth street", "Blend/Core"],
  ["kinsale", "Blend/Core"],
  ["korea investment", "Blend/Core"],
  ["ap-fonden", "Blend/Core"], ["ap fonden", "Blend/Core"],
  ["treasurer of the state", "Blend/Core"], ["state of north carolina", "Blend/Core"],
  ["credit agricole", "Blend/Core"],
  ["banco santander", "Blend/Core"], ["santander", "Blend/Core"],
  ["nykredit", "Blend/Core"],
  ["lansforsakringar", "Blend/Core"],
  ["capital international sarl", "Growth"], ["capital international s.a", "Growth"],
  // ---- a few known style boutiques from the tail ----
  ["los angeles capital", "Momentum/Quant"],
  ["gilder gagnon", "Growth"],
];

// ── 2) KEYWORD heuristics for the tail ──────────────────────────────
// Applied only if no curated match. Confidence = "heuristic".
function heuristic(name) {
  const n = name.toLowerCase();
  // fund-name giveaways
  if (/\b(dividend|equity income|income fund|high yield|yield)\b/.test(n)) return "Income";
  if (/\bvalue\b/.test(n)) return "Value";
  if (/\bgrowth\b/.test(n)) return "Growth";
  if (/\b(quant|quantitative|systematic|arbitrage|stat[- ]?arb|alpha|trading|securities llc|market making)\b/.test(n)) return "Momentum/Quant";
  if (/\b(index|indexed)\b/.test(n)) return "Blend/Core";
  // pensions, insurance, banks, trusts -> diversified blend/core
  if (/\b(pension|retirement|employees|teachers|insurance|assurance|life co|bank|banc|bancorp|trust co|trust company|savings|investment board|superannuation|super pty|kantonalbank|sparkasse|raiffeisen|handelsbank|vermogens)\b/.test(n)) return "Blend/Core";
  // broker-dealers, diversified financial groups -> blend/core
  if (/\b(securities|financial corp|financial group|financial companies|financial inc|financial services|capital markets|brokerage)\b/.test(n)) return "Blend/Core";
  // broad wealth / advisory / RIA -> typically diversified blend
  if (/\b(wealth|advisors|advisers|advisory|counsel|planning|fiduciary|family office|private client|multi-family)\b/.test(n)) return "Blend/Core";
  // generic diversified institutional managers (foreign asset managers, TAMPs, etc.)
  // — "asset management" / "investment management" without a boutique "capital" tell.
  if (/\b(asset management|asset managers|investment management|fund management|global investors|investment managers|investment counsel|investment advisors|investment company|investment trust|investors inc|investment group)\b/.test(n) && !/\bcapital\b/.test(n)) return "Blend/Core";
  return "Unclassified";
}

function classify(name) {
  const n = name.toLowerCase();
  for (const [test, style] of CURATED) if (n.includes(test)) return { style, conf: "curated" };
  return { style: heuristic(name), conf: "heuristic" };
}

// ── Build a breakdown block from a holdings array ───────────────────
function block(holdings) {
  // holdings: [{filerName, shares:[cur,...]}]  (monthly format)
  const rows = holdings
    .map((h) => ({ name: h.filerName, sh: Array.isArray(h.shares) ? (h.shares[0] || 0) : (h.currentShares || 0) }))
    .filter((r) => r.sh > 0);

  const agg = {};
  for (const s of STYLES) agg[s] = { style: s, holders: 0, shares: 0, examples: [] };
  const coverage = { curated: 0, heuristic: 0, unclassified: 0 };

  for (const r of rows) {
    const { style, conf } = classify(r.name);
    const a = agg[style];
    a.holders++;
    a.shares += r.sh;
    if (style === "Unclassified") coverage.unclassified++;
    else if (conf === "curated") coverage.curated++;
    else coverage.heuristic++;
    a.examples.push({ name: r.name, sh: r.sh });
  }

  const totalHolders = rows.length;
  const totalShares = rows.reduce((s, r) => s + r.sh, 0);

  const categories = STYLES.map((s) => {
    const a = agg[s];
    const examples = a.examples.sort((x, y) => y.sh - x.sh).slice(0, 5).map((e) => e.name);
    return {
      style: s,
      holders: a.holders,
      holderPct: totalHolders ? Math.round((a.holders / totalHolders) * 1000) / 10 : 0,
      shares: a.shares,
      sharePct: totalShares ? Math.round((a.shares / totalShares) * 1000) / 10 : 0,
      examples,
    };
  }).filter((c) => c.holders > 0);

  return { total: totalHolders, totalShares, categories, coverage };
}

// ── Combine two holdings lists by filer (union, sum shares) ─────────
function combine(a, b) {
  const map = new Map();
  const add = (h) => {
    const sh = Array.isArray(h.shares) ? (h.shares[0] || 0) : (h.currentShares || 0);
    const key = (h.filerCik || h.filerName || "").toString();
    const prev = map.get(key);
    if (prev) prev.shares[0] += sh;
    else map.set(key, { filerName: h.filerName, filerCik: h.filerCik, shares: [sh] });
  };
  (a || []).forEach(add);
  (b || []).forEach(add);
  return [...map.values()];
}

// ── Main ────────────────────────────────────────────────────────────
const mHei = read("monthly-hei.json");
const mHeia = read("monthly-heia.json");
if (!mHei && !mHeia) { console.error("No monthly data found; run fetch-edgar first."); process.exit(0); }

const heiHoldings = mHei?.holdings || [];
const heiaHoldings = mHeia?.holdings || [];

const out = {
  asOf: new Date().toISOString(),
  period: mHei?.quarters?.[0] || mHeia?.quarters?.[0] || null,
  hei: block(heiHoldings),
  heia: block(heiaHoldings),
  combined: block(combine(heiHoldings, heiaHoldings)),
};

writeFileSync(join(DATA, "investor-styles.json"), JSON.stringify(out, null, 2));

const c = out.combined;
console.log(`Investor styles (combined, ${c.total} unique holders):`);
for (const cat of c.categories.sort((a, b) => b.shares - a.shares)) {
  console.log(`  ${cat.style.padEnd(15)} ${String(cat.holders).padStart(4)} holders  ${cat.holderPct}% of holders   ${cat.sharePct}% of shares`);
}
console.log(`Coverage: ${c.coverage.curated} curated, ${c.coverage.heuristic} heuristic, ${c.coverage.unclassified} unclassified`);

if (process.env.DEBUG_UNCLASSIFIED) {
  const rows = combine(heiHoldings, heiaHoldings)
    .map((h) => ({ name: h.filerName, sh: h.shares[0] || 0 }))
    .filter((r) => r.sh > 0 && classify(r.name).style === "Unclassified")
    .sort((a, b) => b.sh - a.sh);
  console.log(`\n--- ${rows.length} UNCLASSIFIED (top 70 by shares) ---`);
  console.log(rows.slice(0, 70).map((r) => `${r.name}  ${r.sh}`).join("\n"));
}
