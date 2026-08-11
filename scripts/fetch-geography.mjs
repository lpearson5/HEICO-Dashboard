// ─── Geographic ownership ───────────────────────────────────────────────────────
// Reads the monthly 13F holdings and resolves each holder's business location from
// EDGAR's submissions API (city + state/country), then aggregates shares by US
// state, international country, and metro. Writes data/geography-{ticker}.json.
// Locations are cached per CIK (data/geo-cache.json) so re-runs are cheap.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");
const H = { "User-Agent": "HEICO-Dashboard/1.0 lpearson@heico.com", "Accept-Encoding": "identity" };
const CACHE_PATH = join(DATA_DIR, "geo-cache.json");
const TOP_N = 300; // holders per ticker to resolve (covers the large majority of shares)

// US postal codes (states + DC + territories + military) — everything else is international.
const US_CODES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC","PR","GU","VI","AS","MP","AA","AE","AP",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url) {
  for (let i = 1; i <= 4; i++) {
    try {
      const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`status ${r.status}`);
      return await r.json();
    } catch (e) { if (i === 4) return null; await sleep(1000 * i); }
  }
}

function loadCache() { try { return JSON.parse(readFileSync(CACHE_PATH, "utf8")); } catch { return {}; } }

async function resolveLocation(cik, cache) {
  if (cache[cik]) return cache[cik];
  const s = await getJson(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`);
  const b = s?.addresses?.business ?? {};
  const code = (b.stateOrCountry ?? "").toUpperCase();
  const rec = {
    city: b.city ? titleCase(b.city) : null,
    code,
    region: b.stateOrCountryDescription || code || "Unknown",
    isUS: US_CODES.has(code),
  };
  if (code || rec.city) cache[cik] = rec; // cache only real hits
  return rec;
}

const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

async function buildFor(ticker, cache) {
  const file = join(DATA_DIR, `monthly-${ticker}.json`);
  if (!existsSync(file)) return null;
  const data = JSON.parse(readFileSync(file, "utf8"));
  const holders = (data.holdings ?? [])
    .map((h) => ({ cik: h.filerCik, name: h.filerName, shares: h.shares?.[0] ?? 0 }))
    .filter((h) => h.shares > 0)
    .sort((a, b) => b.shares - a.shares);
  const totalInst = holders.reduce((s, h) => s + h.shares, 0);
  const top = holders.slice(0, TOP_N);

  const byState = {}, byCountry = {}, byMetro = {};
  let usShares = 0, intlShares = 0, unknownShares = 0, covered = 0, resolved = 0;
  for (const h of top) {
    const loc = await resolveLocation(h.cik, cache);
    if (!loc || (!loc.code && !loc.city)) continue;
    resolved++;
    covered += h.shares;
    const bump = (obj, key) => { if (!key) return; const e = obj[key] ?? { shares: 0, holders: 0 }; e.shares += h.shares; e.holders += 1; obj[key] = e; };
    if (!loc.code) { unknownShares += h.shares; }        // located by city only / no state-or-country code
    else if (loc.isUS) { usShares += h.shares; bump(byState, loc.region); if (loc.city) bump(byMetro, `${loc.city}, ${loc.code}`); }
    else { intlShares += h.shares; bump(byCountry, loc.region); if (loc.city) bump(byMetro, `${loc.city} (${loc.region})`); }
  }

  const rank = (obj) => Object.entries(obj)
    .map(([name, e]) => ({ name, shares: e.shares, holders: e.holders, pct: covered ? Math.round((e.shares / covered) * 1000) / 10 : 0 }))
    .sort((a, b) => b.shares - a.shares);

  return {
    ticker: ticker.toUpperCase(),
    asOf: new Date().toISOString(),
    coverage: { resolvedHolders: resolved, requested: top.length, sharesCovered: covered, totalInstitutional: totalInst, pctOfInstitutional: totalInst ? Math.round((covered / totalInst) * 1000) / 10 : 0 },
    usPct: covered ? Math.round((usShares / covered) * 1000) / 10 : 0,
    intlPct: covered ? Math.round((intlShares / covered) * 1000) / 10 : 0,
    unknownPct: covered ? Math.round((unknownShares / covered) * 1000) / 10 : 0,
    states: rank(byState).slice(0, 12),
    countries: rank(byCountry).slice(0, 10),
    metros: rank(byMetro).slice(0, 12),
  };
}

async function main() {
  console.log("=== Geographic ownership fetch ===");
  mkdirSync(DATA_DIR, { recursive: true });
  const cache = loadCache();
  for (const ticker of ["hei", "heia"]) {
    const out = await buildFor(ticker, cache);
    writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
    if (out) {
      writeFileSync(join(DATA_DIR, `geography-${ticker}.json`), JSON.stringify(out, null, 2));
      console.log(`  ${ticker}: ${out.coverage.resolvedHolders} holders resolved, ${out.coverage.pctOfInstitutional}% of inst. shares · US ${out.usPct}% / Intl ${out.intlPct}% · ${out.states.length} states, ${out.countries.length} countries`);
    }
  }
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}
main().catch((e) => { console.error("Geography fetch failed:", e); process.exit(1); });
