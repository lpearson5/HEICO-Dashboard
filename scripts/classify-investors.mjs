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

// ── ESTIMATION pass (best-effort, lower confidence) ─────────────────
// Used ONLY to give the "Unclassified" bucket an estimated style breakdown.
// These names have no published style in our curated DB, so we estimate from
// (a) known-boutique knowledge and (b) fund-structure/institution-type tells.
// Anything still unknown stays "Unknown" — we never force a guess.
const EST_KNOWN = [
  // hedge funds / multi-strat / quant / CTAs / market-makers -> Momentum/Quant
  ["jump financial", "Momentum/Quant"], ["jain global", "Momentum/Quant"],
  ["capula", "Momentum/Quant"], ["kingdon capital", "Momentum/Quant"],
  ["o'connor", "Momentum/Quant"], ["oconnor", "Momentum/Quant"],
  ["j. goldman", "Momentum/Quant"], ["j goldman", "Momentum/Quant"],
  ["aquatic capital", "Momentum/Quant"], ["mint tower", "Momentum/Quant"],
  ["trexquant", "Momentum/Quant"], ["numerai", "Momentum/Quant"],
  ["engineers gate", "Momentum/Quant"], ["hudson bay capital", "Momentum/Quant"],
  ["machina capital", "Momentum/Quant"], ["qsemble", "Momentum/Quant"],
  ["dark forest", "Momentum/Quant"], ["symmetry investments", "Momentum/Quant"],
  ["quantbot", "Momentum/Quant"], ["winton", "Momentum/Quant"],
  ["axq capital", "Momentum/Quant"], ["diametric", "Momentum/Quant"],
  ["campbell & co", "Momentum/Quant"], ["campbell and co", "Momentum/Quant"],
  ["gamma investing", "Momentum/Quant"], ["farringdon", "Momentum/Quant"],
  ["intrinsic edge", "Momentum/Quant"], ["empowered funds", "Momentum/Quant"],
  ["ilex capital", "Momentum/Quant"], ["qrg capital", "Momentum/Quant"],
  ["advaya", "Momentum/Quant"], ["frec markets", "Momentum/Quant"],
  ["quantinno", "Momentum/Quant"], ["hrt", "Momentum/Quant"],
  // growth boutiques
  ["xn lp", "Growth"], ["zeno equity", "Growth"], ["munro", "Growth"],
  ["silvant", "Growth"], ["ithaka", "Growth"], ["axiom investors", "Growth"],
  ["westfield capital", "Growth"], ["kornitzer", "Growth"],
  ["silver heights", "Growth"], ["arrowmark", "Growth"], ["alpine peaks", "Growth"],
  // value boutiques
  ["ironvine", "Value"], ["meyer handelman", "Value"], ["maren capital", "Value"],
  ["argent capital", "Value"], ["bright rock", "Value"], ["dudley & shanley", "Value"],
  // Capital Group affiliates -> Growth
  ["capital group investment", "Growth"],
  // wealth / bank / insurer / pension / broker / platform -> Blend/Core
  ["rockefeller capital", "Blend/Core"], ["janney", "Blend/Core"],
  ["osaic", "Blend/Core"], ["mirae asset", "Blend/Core"],
  ["credit industriel", "Blend/Core"], ["ing groep", "Blend/Core"],
  ["allstate", "Blend/Core"], ["pathstone", "Blend/Core"],
  ["savant capital", "Blend/Core"], ["atlantic union", "Blend/Core"],
  ["groupama", "Blend/Core"], ["commonwealth equity", "Blend/Core"],
  ["mml investors", "Blend/Core"], ["dekabank", "Blend/Core"],
  ["eurizon", "Blend/Core"], ["benjamin edwards", "Blend/Core"],
  ["mutual of america", "Blend/Core"], ["advisorshares", "Blend/Core"],
  ["metzler", "Blend/Core"], ["abn amro", "Blend/Core"], ["alerus", "Blend/Core"],
  ["ethic", "Blend/Core"], ["atria investments", "Blend/Core"],
  ["mediolanum", "Blend/Core"], ["desjardins", "Blend/Core"],
  ["ifm investors", "Blend/Core"], ["focus partners", "Blend/Core"],
  ["ag2r", "Blend/Core"], ["state of alaska", "Blend/Core"],
  ["harrison & partners", "Blend/Core"], ["private advisor group", "Blend/Core"],
  ["ci investments", "Blend/Core"], ["allworth", "Blend/Core"],
  ["freedom day", "Blend/Core"], ["pensiondanmark", "Blend/Core"],
  ["aberdeen", "Blend/Core"], ["aia group", "Blend/Core"], ["candriam", "Blend/Core"],
  ["omers", "Blend/Core"], ["thrivent", "Blend/Core"], ["keybank", "Blend/Core"],
  ["union bancaire", "Blend/Core"], ["caprock", "Blend/Core"], ["ieq capital", "Blend/Core"],
  ["choreo", "Blend/Core"], ["bessemer", "Blend/Core"], ["gilbert & cook", "Blend/Core"],
  ["safra sarasin", "Blend/Core"], ["mai capital", "Blend/Core"],
  ["pekao", "Blend/Core"], ["universal- beteiligungs", "Blend/Core"],
  ["universal investment", "Blend/Core"], ["mn services", "Blend/Core"],
  ["vermogensbeheer", "Blend/Core"], ["tidal investments", "Blend/Core"],
  ["duncker streett", "Blend/Core"], ["wendell david", "Blend/Core"],
  ["brasada", "Blend/Core"], ["carderock", "Blend/Core"], ["mariner, llc", "Blend/Core"],
  ["curi capital", "Blend/Core"], ["&partners", "Blend/Core"],
  ["moody lynn", "Blend/Core"], ["blalock williams", "Blend/Core"],
  ["midwest financial", "Blend/Core"], ["mirador", "Blend/Core"],
  ["verde capital", "Blend/Core"], ["entrypoint capital", "Blend/Core"],
  ["caisses desjardins", "Blend/Core"], ["rockefeller", "Blend/Core"],
  ["k.j. harrison", "Blend/Core"], ["pfs partners", "Blend/Core"],
  ["kbc", "Blend/Core"], ["dekabank", "Blend/Core"], ["candriam", "Blend/Core"],
  // ---- second batch (from the residual Unknown tail) ----
  // quant / hedge / trading
  ["gsa capital", "Momentum/Quant"], ["xtx", "Momentum/Quant"],
  ["jacobs levy", "Momentum/Quant"], ["hartree", "Momentum/Quant"],
  ["brevan howard", "Momentum/Quant"], ["centiva", "Momentum/Quant"],
  ["atom investors", "Momentum/Quant"], ["militia capital", "Momentum/Quant"],
  ["centerbook", "Momentum/Quant"], ["aristides", "Momentum/Quant"],
  ["prescott group", "Momentum/Quant"], ["clare market", "Momentum/Quant"],
  ["aster capital", "Momentum/Quant"], ["wbi investments", "Momentum/Quant"],
  ["quartz partners", "Momentum/Quant"], ["xponance", "Momentum/Quant"],
  ["hudson bay", "Momentum/Quant"], ["symmetry", "Momentum/Quant"],
  // growth
  ["dsm capital", "Growth"], ["oak ridge investments", "Growth"],
  ["pinnacle associates", "Growth"], ["navellier", "Growth"],
  ["fil ltd", "Growth"], ["loomis sayles", "Growth"], ["loomis, sayles", "Growth"],
  // value
  ["bradley foster", "Value"], ["barrett & company", "Value"],
  ["yorktown management", "Value"], ["pekin hardy", "Value"],
  ["oarsman", "Value"], ["applied finance", "Value"], ["barr e s", "Value"],
  // income (dividend-growth focused)
  ["bahl & gaynor", "Income"], ["bahl and gaynor", "Income"], ["dearborn partners", "Income"],
  // wealth / bank / broker / insurer / pension / RIA -> Blend/Core
  ["vestcor", "Blend/Core"], ["stephens inc", "Blend/Core"], ["oppenheimer", "Blend/Core"],
  ["cibc", "Blend/Core"], ["ballentine", "Blend/Core"], ["capital analysts", "Blend/Core"],
  ["americana partners", "Blend/Core"], ["unisuper", "Blend/Core"],
  ["coldstream", "Blend/Core"], ["brighton jones", "Blend/Core"],
  ["signaturefd", "Blend/Core"], ["corient", "Blend/Core"], ["cynosure", "Blend/Core"],
  ["rothschild investment", "Blend/Core"], ["meitav", "Blend/Core"],
  ["quadrant capital", "Blend/Core"], ["versant capital", "Blend/Core"],
  ["alphacore", "Blend/Core"], ["blue chip partners", "Blend/Core"],
  ["cardinal point", "Blend/Core"], ["wedmont", "Blend/Core"],
  ["siemens fonds", "Blend/Core"], ["masterinvest", "Blend/Core"],
  ["generali", "Blend/Core"], ["novem group", "Blend/Core"], ["norden group", "Blend/Core"],
  ["firestone capital", "Blend/Core"], ["garrison bradford", "Blend/Core"],
  ["marino, stram", "Blend/Core"], ["proficio", "Blend/Core"],
  ["mgo one seven", "Blend/Core"], ["fourpath", "Blend/Core"], ["kera capital", "Blend/Core"],
  ["j2 capital", "Blend/Core"], ["nvwm", "Blend/Core"], ["cypress capital", "Blend/Core"],
  ["evergreen capital", "Blend/Core"], ["avalon capital", "Blend/Core"],
  ["cross staff", "Blend/Core"], ["patten group", "Blend/Core"],
  ["archer investment", "Blend/Core"], ["malaga cove", "Blend/Core"],
  ["syon capital", "Blend/Core"], ["hengehold", "Blend/Core"],
  ["moody aldrich", "Blend/Core"], ["indivisible partners", "Blend/Core"],
  ["sivia capital", "Blend/Core"], ["integrated investment consultants", "Blend/Core"],
  ["summittx", "Blend/Core"], ["themes management", "Blend/Core"],
  ["elevatus", "Blend/Core"], ["bankchampaign", "Blend/Core"],
  ["fidelis capital", "Blend/Core"], ["bahl", "Income"],
  ["dearborn", "Income"], ["yorktown", "Value"], ["fidelity international", "Growth"],
  ["colonial river", "Blend/Core"], ["yousif", "Blend/Core"],
  ["dsm", "Growth"], ["oak ridge", "Growth"],
];

// aggressive structure/type tells used only in estimation mode
function estHeuristic(name) {
  const n = name.toLowerCase();
  if (/\b(value)\b/.test(n)) return "Value";
  if (/\b(growth)\b/.test(n)) return "Growth";
  if (/\b(dividend|income|yield)\b/.test(n)) return "Income";
  if (/\b(quant|systematic|arbitrage|alpha|macro|technologies|trading|market making|ops|alternative|alternatives|multi-strategy|multistrategy)\b/.test(n)) return "Momentum/Quant";
  // institutions / diversified vehicles -> Blend/Core
  if (/\b(bank|banc|bankshares|bankchampaign|banco|banca|bancaire|kantonalbank|sparkasse|girozentrale|savings|insurance|assurance|life|pension|retirement|superannuation|sovereign|treasurer|state of|caisse|caisses|mutual|financial|securities|brokerage|wealth|welath|advisor|advisors|advisers|advisory|counsel|fiduciary|family office|private client|trust|holdings|group plc|etf|etfs|index|indexed|solutions|services|foundation|endowment|university|systeme|vermogens)\b/.test(n)) return "Blend/Core";
  return "Unknown";
}

// Best-effort estimate for a name that classify() left Unclassified.
function estimate(name) {
  const n = name.toLowerCase();
  for (const [test, style] of EST_KNOWN) if (n.includes(test)) return style;
  return estHeuristic(name);
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
    const members = a.examples
      .sort((x, y) => y.sh - x.sh)
      .map((e) => (s === "Unclassified"
        ? { name: e.name, shares: e.sh, estStyle: estimate(e.name) }
        : { name: e.name, shares: e.sh }));
    return {
      style: s,
      holders: a.holders,
      holderPct: totalHolders ? Math.round((a.holders / totalHolders) * 1000) / 10 : 0,
      shares: a.shares,
      sharePct: totalShares ? Math.round((a.shares / totalShares) * 1000) / 10 : 0,
      examples: members.slice(0, 5).map((m) => m.name), // kept for compact summaries
      members,                                          // full drill-down list
    };
  }).filter((c) => c.holders > 0);

  // Estimated style breakdown of the Unclassified bucket (best-effort, lower confidence).
  const unc = agg["Unclassified"].examples; // [{name, sh}]
  const estAgg = {};
  for (const s of [...STYLES.filter((x) => x !== "Unclassified"), "Unknown"]) estAgg[s] = { style: s, holders: 0, shares: 0, members: [] };
  for (const m of unc) {
    const est = estimate(m.name);
    const a = estAgg[est] || estAgg["Unknown"];
    a.holders++; a.shares += m.sh; a.members.push({ name: m.name, shares: m.sh, estStyle: est });
  }
  const uncTotalH = unc.length;
  const uncTotalS = unc.reduce((s, m) => s + m.sh, 0);
  const unclassifiedEstimate = {
    total: uncTotalH,
    totalShares: uncTotalS,
    categories: Object.values(estAgg)
      .filter((a) => a.holders > 0)
      .map((a) => ({
        style: a.style,
        holders: a.holders,
        holderPct: uncTotalH ? Math.round((a.holders / uncTotalH) * 1000) / 10 : 0,
        shares: a.shares,
        sharePct: uncTotalS ? Math.round((a.shares / uncTotalS) * 1000) / 10 : 0,
      })),
  };

  return { total: totalHolders, totalShares, categories, coverage, unclassifiedEstimate };
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
