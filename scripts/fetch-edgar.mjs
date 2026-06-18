/**
 * Fetches HEICO institutional ownership from WhalewWisdom API.
 * WhalewWisdom aggregates SEC 13F-HR filings and exposes a complete
 * holder list via their API (870 HEI holders, 682 HEI-A holders).
 *
 * Auth: HMAC-SHA1 signed requests using WW_SHARED_KEY + WW_SECRET secrets.
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { createHmac } from "crypto";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const WW_KEY    = process.env.WW_SHARED_KEY;
const WW_SECRET = process.env.WW_SECRET;

if (!WW_KEY || !WW_SECRET) {
  console.error("ERROR: WW_SHARED_KEY and WW_SECRET environment variables must be set.");
  process.exit(1);
}

const TICKERS = [
  { key: "HEI",  cusip: "422819102", wwName: "HEI"   },
  { key: "HEIA", cusip: "422819201", wwName: "HEI-A"  },
];

// ─── WhalewWisdom API ─────────────────────────────────────────────────────────

function wwSign(argsStr) {
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const base = argsStr + "\n" + timestamp;
  const sig = createHmac("sha1", WW_SECRET).update(base).digest("base64");
  return { timestamp, sig };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function wwCall(argsObj) {
  const argsStr = JSON.stringify(argsObj);
  const { timestamp, sig } = wwSign(argsStr);
  const url = [
    "https://whalewisdom.com/shell/command.json",
    `?args=${encodeURIComponent(argsStr)}`,
    `&api_shared_key=${encodeURIComponent(WW_KEY)}`,
    `&api_sig=${encodeURIComponent(sig)}`,
    `&timestamp=${encodeURIComponent(timestamp)}`,
  ].join("");

  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "HEICO-Dashboard/1.0 lpearson@heico.com" },
      });
      if (res.status === 429) { await sleep(5000 * i); continue; }
      if (!res.ok) {
        const text = await res.text();
        console.warn(`  [${res.status}] WW API: ${text.slice(0, 200)}`);
        return null;
      }
      return await res.json();
    } catch (e) {
      if (i === 3) console.warn(`  [ERR] ${e.message}`);
      await sleep(1000 * i);
    }
  }
  return null;
}

// ─── Stock lookup ─────────────────────────────────────────────────────────────

async function lookupStockId(ticker) {
  console.log(`  Looking up stock ID for ${ticker}...`);
  const data = await wwCall({ command: "stock_lookup", name: ticker });
  if (!data) return null;

  // Response is typically an array of matching stocks
  const list = Array.isArray(data) ? data : (data.results ?? data.stocks ?? []);
  const match = list.find(s =>
    (s.ticker ?? s.symbol ?? "").toUpperCase() === ticker.toUpperCase()
  ) ?? list[0];

  if (!match) { console.warn(`  No stock found for ${ticker}`); return null; }
  const id = match.id ?? match.stock_id ?? match.f13_id;
  console.log(`  → ${ticker} stock ID: ${id} (${match.name ?? match.stock_name ?? ""})`);
  return id;
}

// ─── Fetch holders ────────────────────────────────────────────────────────────

async function fetchHolders(stockId, ticker) {
  console.log(`  Fetching holders for ${ticker} (id=${stockId})...`);
  // No quarter_ids = most recent two quarters by default
  const data = await wwCall({
    command:   "holders",
    stock_ids: [stockId],
    limit:     2000,
  });

  if (!data) return [];

  const rows = Array.isArray(data) ? data : (data.results ?? data.holders ?? []);
  console.log(`  → ${rows.length} holder rows`);

  if (rows.length > 0) {
    console.log(`  Sample row keys: ${Object.keys(rows[0]).join(", ")}`);
    console.log(`  Sample: ${JSON.stringify(rows[0])}`);
  }
  return rows;
}

// ─── Quarter helpers ──────────────────────────────────────────────────────────

function periodToLabel(periodStr) {
  // periodStr like "2026-03-31" or "31-MAR-2026"
  if (!periodStr) return "Unknown";
  const d = new Date(periodStr);
  if (isNaN(d)) return periodStr;
  const m = d.getUTCMonth() + 1;
  const y = d.getUTCFullYear();
  if (m <= 3)  return `Q1 ${y}`;
  if (m <= 6)  return `Q2 ${y}`;
  if (m <= 9)  return `Q3 ${y}`;
  return `Q4 ${y}`;
}

// ─── Action classification ───────────────────────────────────────────────────

function classifyAction(curSh, priSh) {
  if (curSh == null && priSh != null) return "Sell Out";
  if (curSh != null && priSh == null) return "New Position";
  if (curSh == null) return "No Change";
  if (curSh > priSh) return "Bought";
  if (curSh < priSh) return "Sold";
  return "No Change";
}

// ─── Build holdings from WW rows ─────────────────────────────────────────────

function buildHoldings(rows) {
  if (!rows.length) return { holdings: [], currentPeriod: "Unknown", priorPeriod: "Unknown" };

  // WW returns current + prior shares in each row
  // Field names vary — try common variants
  const get = (row, ...keys) => {
    for (const k of keys) if (row[k] != null) return row[k];
    return null;
  };

  const holdings = rows.map(row => {
    const name     = get(row, "filer_name", "name", "fund_name", "manager_name") ?? "Unknown";
    const curSh    = get(row, "current_shares", "shares", "share_count", "position_size");
    const priSh    = get(row, "previous_shares", "prior_shares", "prev_shares", "last_shares");
    const change   = curSh != null && priSh != null ? curSh - priSh
                   : get(row, "change", "share_change", "shares_change") ?? null;
    const curVal   = get(row, "market_value", "value", "current_value", "mv");
    const pct      = curSh != null && priSh && priSh !== 0
                   ? Math.round((curSh - priSh) / priSh * 1000) / 10 : null;

    return {
      filerName:     name,
      currentShares: curSh != null ? Number(curSh) : null,
      priorShares:   priSh != null ? Number(priSh) : null,
      change:        change != null ? Number(change) : null,
      pctChange:     pct,
      currentValue:  curVal != null ? Number(curVal) : null,
      action:        classifyAction(
                       curSh != null ? Number(curSh) : null,
                       priSh != null ? Number(priSh) : null
                     ),
    };
  });

  // Determine period labels from sample row
  const sample = rows[0];
  const curPeriod = periodToLabel(
    get(sample, "quarter", "period_of_report", "quarter_end", "report_date", "as_of_date")
  );
  // WW might not give prior period label — derive it
  const priorPeriod = (() => {
    const map = { Q1: "Q4", Q2: "Q1", Q3: "Q2", Q4: "Q3" };
    const [q, y] = curPeriod.split(" ");
    if (!q || !y) return "Unknown";
    const prevQ = map[q];
    const prevY = q === "Q1" ? parseInt(y) - 1 : parseInt(y);
    return `${prevQ} ${prevY}`;
  })();

  return {
    holdings: holdings.sort((a, b) => (b.currentShares ?? -1) - (a.currentShares ?? -1)),
    currentPeriod,
    priorPeriod,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== HEICO Institutional Ownership via WhalewWisdom ===\n");
  mkdirSync(join(ROOT, "data"), { recursive: true });

  for (const { key, cusip, wwName } of TICKERS) {
    console.log(`\n── ${key} (${wwName}) ──`);

    const stockId = await lookupStockId(wwName);
    if (!stockId) {
      console.warn(`  Skipping ${key} — could not find stock ID`);
      continue;
    }

    await sleep(1000);
    const rows = await fetchHolders(stockId, key);

    const { holdings, currentPeriod, priorPeriod } = buildHoldings(rows);
    const withPos = holdings.filter(h => h.currentShares != null && h.currentShares > 0).length;

    writeFileSync(
      join(ROOT, "data", `${key.toLowerCase()}.json`),
      JSON.stringify({ ticker: key, cusip, currentPeriod, priorPeriod,
                       lastUpdated: new Date().toISOString(), holdings }, null, 2)
    );
    console.log(`  ${key}: ${withPos} current holders, ${holdings.length} total → data/${key.toLowerCase()}.json`);
    await sleep(2000);
  }

  console.log("\nDone!");
}

main().catch(e => { console.error(e); process.exit(1); });
