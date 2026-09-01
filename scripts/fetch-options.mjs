// ─── Options positions (13F put/call) ───────────────────────────────────────────
// 13F filers report listed option positions (puts/calls) on HEICO. The main
// ownership pipeline deliberately EXCLUDES these from share counts; this script
// surfaces them separately for the Options page. On HEICO these are held almost
// entirely by options market-makers and multi-strategy quant funds (hedging /
// market-making inventory — NOT directional short bets), so we scan the current-
// quarter HEICO filers whose names match that universe. Writes data/options.json.

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");
const UA = { "User-Agent": "HEICO-Dashboard/1.0 lpearson@heico.com", "Accept-Encoding": "identity" };
const CUSIPS = { HEI: "422806109", HEIA: "422806208" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Options market-makers, quant/multi-strat funds and big broker-dealers — the
// realistic universe of HEICO option holders. (Substring, case-insensitive.)
const OPT = /susquehanna|citadel|jane street|wolverine|group one|simplex|optiver|\bimc\b|jump trading|virtu|flow traders|millennium|squarepoint|point72|cubist|d\.? ?e\.? shaw|two sigma|worldquant|qube|balyasny|verition|schonfeld|walleye|exoduspoint|hrt|hudson river|tower research|marshall wace|voloridge|ghisallo|graham capital|caxton|dynamic technology|entropy tech|quantinno|trexquant|gsa capital|maven|xtx|jain global|freestone grove|morgan stanley|goldman sachs|\bubs\b|barclays|bank of america|bofa|merrill|wells fargo|citigroup|citadel securities|jefferies|nomura|mizuho|\brbc\b|bnp paribas|societe generale|td securities|deutsche bank|hsbc|scotia|natwest|macquarie/i;

async function get(url) {
  for (let i = 1; i <= 4; i++) {
    try { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) }); return await r.text(); }
    catch (e) { if (i === 4) return ""; await sleep(1200 * i); }
  }
}

// Extract summed put/call shares per HEICO class from an info table.
function parseOptions(xml) {
  const out = { HEI: { put: 0, call: 0 }, HEIA: { put: 0, call: 0 } };
  const re = /<(?:\w+:)?infoTable(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const cm = b.match(/<(?:\w+:)?cusip(?:\s[^>]*)?>\s*([^<]+?)\s*</i);
    if (!cm) continue;
    const cusip = cm[1].replace(/[\s-]/g, "");
    const ticker = Object.keys(CUSIPS).find((t) => CUSIPS[t] === cusip);
    if (!ticker) continue;
    const pc = (b.match(/<(?:\w+:)?putCall(?:\s[^>]*)?>\s*(put|call)/i)?.[1] ?? "").toLowerCase();
    if (pc !== "put" && pc !== "call") continue;
    const sh = parseInt((b.match(/<(?:\w+:)?sshPrnamt(?:\s[^>]*)?>\s*(\d+)/i)?.[1] ?? "0"), 10) || 0;
    out[ticker][pc] += sh;
  }
  return out;
}

async function main() {
  console.log("=== Options positions (13F put/call) ===");
  mkdirSync(DATA_DIR, { recursive: true });
  const current = JSON.parse(readFileSync(join(DATA_DIR, "hei.json"), "utf8")).currentPeriod;
  const cache = JSON.parse(readFileSync(join(DATA_DIR, "scan-cache.json"), "utf8"));
  const candidates = Object.entries(cache)
    .filter(([k, v]) => !k.startsWith("_") && v && v.period === current && OPT.test(v.name || ""))
    .map(([acc, v]) => ({ acc, cik: v.cik, name: v.name }));
  console.log(`Current quarter ${current}: ${candidates.length} options-universe filers to scan…`);

  const holders = [];
  const totals = { HEI: { put: 0, call: 0 }, HEIA: { put: 0, call: 0 } };
  for (const c of candidates) {
    const base = `https://www.sec.gov/Archives/edgar/data/${c.cik}/${c.acc.replace(/-/g, "")}/`;
    const idx = await get(base);
    const xmls = (idx.match(/href="([^"]*\.xml)"/gi) || []).map((x) => x.match(/href="([^"]*)"/i)[1]).filter((x) => !/primary_doc/i.test(x));
    let opt = null;
    for (const dd of xmls) { const xml = await get(base + dd.split("/").pop()); const o = parseOptions(xml); if (o.HEI.put || o.HEI.call || o.HEIA.put || o.HEIA.call) { opt = o; break; } if (xml.includes("422806")) { opt = o; break; } }
    if (opt && (opt.HEI.put || opt.HEI.call || opt.HEIA.put || opt.HEIA.call)) {
      holders.push({ filer: c.name, cik: c.cik, heiPut: opt.HEI.put, heiCall: opt.HEI.call, heiaPut: opt.HEIA.put, heiaCall: opt.HEIA.call });
      for (const t of ["HEI", "HEIA"]) { totals[t].put += opt[t].put; totals[t].call += opt[t].call; }
    }
    await sleep(250);
  }
  holders.sort((a, b) => (b.heiPut + b.heiCall + b.heiaPut + b.heiaCall) - (a.heiPut + a.heiCall + a.heiaPut + a.heiaCall));
  writeFileSync(join(DATA_DIR, "options.json"), JSON.stringify({ asOf: new Date().toISOString(), currentPeriod: current, totals, holders }, null, 2));
  console.log(`options.json written: ${holders.length} holders with options.`);
}
main().catch((e) => { console.error("Options fetch failed:", e); process.exit(1); });
