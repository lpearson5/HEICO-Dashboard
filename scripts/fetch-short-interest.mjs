// ─── Short interest (FINRA consolidated) ────────────────────────────────────────
// Pulls bi-monthly consolidated short-interest history for HEICO and its peers from
// FINRA's public data API (no key). Computes % of shares outstanding using share
// counts from SEC. Writes data/short-interest.json.

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");
const UA = { "User-Agent": "HEICO-Dashboard/1.0 lpearson@heico.com", "Accept-Encoding": "identity" };

// FINRA symbol, display name, SEC CIK (for shares outstanding).
const TICKERS = [
  // HEICO is dual-class; the SEC dei tag is per-class, so pin each class's float.
  { sym: "HEI",  name: "HEICO (HEI)",       cik: 46619,   main: true, sharesOverride: 55_170_957 },
  { sym: "HEI.A",name: "HEICO (HEI/A)",     cik: 46619,   main: true, sharesOverride: 84_488_320 },
  { sym: "RTX",  name: "RTX Corp",          cik: 101829 },
  { sym: "BA",   name: "Boeing",            cik: 12927 },
  { sym: "HWM",  name: "Howmet Aerospace",  cik: 4281 },
  { sym: "TDG",  name: "TransDigm",         cik: 1260221 },
  { sym: "TDY",  name: "Teledyne",          cik: 1094285 },
  { sym: "LOAR", name: "Loar Holdings",     cik: 2000178 },
  { sym: "ARXS", name: "Arxis",             cik: 2093536 },
  { sym: "VSEC", name: "VSE Corp",          cik: 102752 },
  { sym: "FTAI", name: "FTAI Aviation",     cik: 1590364 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function finraSI(symbol) {
  // Last ~18 months of readings; FINRA returns oldest-first, we sort client-side.
  const since = new Date(Date.now() - 550 * 86400000).toISOString().slice(0, 10);
  const body = JSON.stringify({
    limit: 60,
    compareFilters: [
      { fieldName: "symbolCode", fieldValue: symbol, compareType: "EQUAL" },
      { fieldName: "settlementDate", fieldValue: since, compareType: "GTE" },
    ],
  });
  for (let i = 1; i <= 4; i++) {
    try {
      const r = await fetch("https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest", {
        method: "POST",
        headers: { ...UA, "Content-Type": "application/json", Accept: "application/json" },
        body, signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const arr = await r.json();
      return (Array.isArray(arr) ? arr : [])
        .map((x) => ({
          date: x.settlementDate,
          si: x.currentShortPositionQuantity ?? null,
          avgVol: x.averageDailyVolumeQuantity ?? null,
          daysToCover: x.daysToCoverQuantity ?? null,
          changePct: x.changePercent ?? null,
        }))
        .filter((x) => x.date && x.si != null)
        .sort((a, b) => a.date.localeCompare(b.date));
    } catch (e) { if (i === 4) { console.warn(`  ${symbol}: FINRA failed (${e.message})`); return []; } await sleep(1500 * i); }
  }
}

async function sharesOutstanding(cik) {
  try {
    const r = await fetch(`https://data.sec.gov/api/xbrl/companyconcept/CIK${String(cik).padStart(10, "0")}/dei/EntityCommonStockSharesOutstanding.json`,
      { headers: UA, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const j = await r.json();
    const u = j.units[Object.keys(j.units)[0]] ?? [];
    const last = u[u.length - 1];
    return last?.val ?? null;
  } catch { return null; }
}

async function main() {
  console.log("=== Short interest fetch (FINRA) ===");
  mkdirSync(DATA_DIR, { recursive: true });
  const out = [];
  const sharesCache = {};
  for (const t of TICKERS) {
    const hist = await finraSI(t.sym);
    if (sharesCache[t.cik] === undefined) sharesCache[t.cik] = await sharesOutstanding(t.cik);
    const shares = t.sharesOverride ?? sharesCache[t.cik];
    const latest = hist[hist.length - 1] ?? null;
    out.push({
      sym: t.sym, name: t.name, main: !!t.main,
      shares,
      latest,
      pctFloat: latest && shares ? Math.round((latest.si / shares) * 10000) / 100 : null,
      history: hist,
    });
    console.log(`  ${t.sym}: ${hist.length} readings, latest SI ${latest?.si?.toLocaleString() ?? "—"} (${latest?.date ?? "—"})`);
    await sleep(400);
  }
  writeFileSync(join(DATA_DIR, "short-interest.json"), JSON.stringify({ asOf: new Date().toISOString(), tickers: out }, null, 2));
  console.log("short-interest.json written.");
}
main().catch((e) => { console.error("Short-interest fetch failed:", e); process.exit(1); });
