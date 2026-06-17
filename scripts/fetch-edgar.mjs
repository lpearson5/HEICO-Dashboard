/**
 * Fetches HEICO institutional ownership from Financial Modeling Prep (FMP) API.
 * FMP aggregates 13F-HR filings from SEC EDGAR, providing complete holder lists
 * without requiring direct EDGAR XML scraping.
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const FMP_KEY = process.env.FMP_API_KEY;
if (!FMP_KEY) {
  console.error("ERROR: FMP_API_KEY environment variable is not set.");
  process.exit(1);
}

const TICKERS = { HEI: "HEI", HEIA: "HEI-A" };
const CUSIPS  = { HEI: "422819102", HEIA: "422819201" };

// ─── Quarter helpers ──────────────────────────────────────────────────────────

function getQuarterLabel(dateStr) {
  // dateStr is like "2025-12-31" (period of report)
  const d = new Date(dateStr);
  const m = d.getMonth() + 1; // 1-12
  const y = d.getFullYear();
  if (m <= 3)  return `Q1 ${y}`;
  if (m <= 6)  return `Q2 ${y}`;
  if (m <= 9)  return `Q3 ${y}`;
  return `Q4 ${y}`;
}

function currentExpectedQuarter() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  // 13F-HR filings are due ~45 days after quarter end.
  // If we're in Apr-Jun, the most recent completed filing period is Q1.
  if (m >= 4 && m <= 6)  return `Q1 ${y}`;
  if (m >= 7 && m <= 9)  return `Q2 ${y}`;
  if (m >= 10 && m <= 12) return `Q3 ${y}`;
  return `Q4 ${y - 1}`;
}

function priorQuarter(label) {
  const m = { Q1: 4, Q2: 7, Q3: 10, Q4: 1 };
  const [q, y] = label.split(" ");
  const yr = parseInt(y, 10);
  const prevQ = { Q1: "Q4", Q2: "Q1", Q3: "Q2", Q4: "Q3" }[q];
  const prevY = q === "Q1" ? yr - 1 : yr;
  return `${prevQ} ${prevY}`;
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fmpGet(path) {
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://financialmodelingprep.com/api/v3${path}${sep}apikey=${FMP_KEY}`;
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) { await sleep(5000 * i); continue; }
      if (!res.ok) {
        console.warn(`  [${res.status}] FMP ${path}`);
        return null;
      }
      const json = await res.json();
      // FMP returns {"error":"..."} on bad key etc.
      if (json?.error) {
        console.error(`  FMP API error: ${json.error}`);
        return null;
      }
      return json;
    } catch (e) {
      if (i === 3) console.warn(`  [ERR] ${e.message}`);
      await sleep(800 * i);
    }
  }
  return null;
}

// ─── FMP institutional holder fetch ──────────────────────────────────────────

async function fetchHolders(fmpTicker) {
  console.log(`  Fetching holders for ${fmpTicker}...`);
  // Returns array of { holder, shares, change, dateReported, weightPercent }
  const data = await fmpGet(`/institutional-holder/${fmpTicker}`);
  if (!Array.isArray(data)) {
    console.warn(`  Unexpected FMP response for ${fmpTicker}`);
    return [];
  }
  console.log(`  → ${data.length} holders returned`);
  return data;
}

// ─── Action classification ───────────────────────────────────────────────────

function classifyAction(curShares, change) {
  if (curShares == null) return "No Data";
  if (change == null)    return "No Change";
  if (curShares === 0 && change < 0) return "Sell Out";
  if (change > 0 && (curShares - change) === 0) return "New Position";
  if (change > 0)  return "Bought";
  if (change < 0)  return "Sold";
  return "No Change";
}

// ─── Build holdings array ─────────────────────────────────────────────────────

function buildHoldings(fmpData, curPeriod, priPeriod) {
  return fmpData
    .map(item => {
      const curShares = item.shares != null ? item.shares : null;
      const change    = item.change != null ? item.change : null;
      const priShares = curShares != null && change != null ? curShares - change : null;
      const pctChange = change != null && priShares ? Math.round((change / priShares) * 1000) / 10 : null;
      const curValue  = item.marketValue != null ? Math.round(item.marketValue) : null;

      return {
        filerName:     item.investorName ?? item.holder ?? "Unknown",
        currentShares: curShares,
        priorShares:   priShares,
        change,
        pctChange,
        currentValue:  curValue,
        action:        classifyAction(curShares, change),
        dateReported:  item.dateReported ?? null,
      };
    })
    .sort((a, b) => (b.currentShares ?? -1) - (a.currentShares ?? -1));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== HEICO Institutional Ownership via FMP API ===\n");

  const curPeriod = currentExpectedQuarter();
  const priPeriod = priorQuarter(curPeriod);
  console.log(`Expected period: ${curPeriod}   Prior: ${priPeriod}\n`);

  mkdirSync(join(ROOT, "data"), { recursive: true });

  for (const [key, fmpTicker] of Object.entries(TICKERS)) {
    const cusip = CUSIPS[key];
    const fmpData = await fetchHolders(fmpTicker);

    if (fmpData.length === 0) {
      console.warn(`  WARNING: No data returned for ${fmpTicker}. Skipping.`);
      continue;
    }

    // Determine actual period from the dateReported field if available
    const sample = fmpData.find(d => d.dateReported);
    const actualPeriod = sample ? getQuarterLabel(sample.dateReported) : curPeriod;
    const actualPrior  = priorQuarter(actualPeriod);

    const holdings = buildHoldings(fmpData, actualPeriod, actualPrior);
    const withPos   = holdings.filter(h => h.currentShares != null && h.currentShares > 0).length;

    const out = {
      ticker:        key,
      cusip,
      currentPeriod: actualPeriod,
      priorPeriod:   actualPrior,
      lastUpdated:   new Date().toISOString(),
      holdings,
    };

    const outPath = join(ROOT, "data", `${key.toLowerCase()}.json`);
    writeFileSync(outPath, JSON.stringify(out, null, 2));
    console.log(`  ${key} (${fmpTicker}): ${withPos} current holders, ${holdings.length} total → data/${key.toLowerCase()}.json`);

    await sleep(500);
  }

  console.log("\nDone!");
}

main().catch(e => { console.error(e); process.exit(1); });
