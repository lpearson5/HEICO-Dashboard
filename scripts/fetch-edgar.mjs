/**
 * Fetches HEICO institutional ownership from SEC EDGAR 13F-HR filings.
 * Run via:  node scripts/fetch-edgar.mjs
 * Outputs:  data/hei.json  and  data/heia.json
 *
 * Architecture:
 *  1. EDGAR EFTS full-text search → find every 13F-HR that mentions each CUSIP
 *  2. For each filing hit, download the information-table XML
 *  3. Parse share counts for the target CUSIP
 *  4. Compare current quarter vs prior quarter → derive action (Bought / Sold / etc.)
 *  5. Write result JSON
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ─── HEICO CUSIPs ────────────────────────────────────────────────────────────
const TICKERS = {
  HEI: "422819102",   // HEICO Corp Common
  HEIA: "422819201",  // HEICO Corp Class A
};

const USER_AGENT = "HEICO Ownership Dashboard contact@heico-dashboard.example";

// ─── Quarterly filing date ranges ────────────────────────────────────────────
function getQuarterRanges() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1–12

  // 13F-HR filing deadlines are ~45 days after quarter end:
  //   Q1 (Mar 31) → filed Apr–May
  //   Q2 (Jun 30) → filed Jul–Aug
  //   Q3 (Sep 30) → filed Oct–Nov
  //   Q4 (Dec 31) → filed Jan–Feb

  if (month >= 4 && month <= 6) {
    return {
      current:  { start: `${year}-04-01`, end: `${year}-05-31`,  label: `Q1 ${year}` },
      prior:    { start: `${year}-01-01`, end: `${year}-02-28`,  label: `Q4 ${year - 1}` },
    };
  }
  if (month >= 7 && month <= 9) {
    return {
      current:  { start: `${year}-07-01`, end: `${year}-08-31`,  label: `Q2 ${year}` },
      prior:    { start: `${year}-04-01`, end: `${year}-05-31`,  label: `Q1 ${year}` },
    };
  }
  if (month >= 10 && month <= 12) {
    return {
      current:  { start: `${year}-10-01`, end: `${year}-11-30`,  label: `Q3 ${year}` },
      prior:    { start: `${year}-07-01`, end: `${year}-08-31`,  label: `Q2 ${year}` },
    };
  }
  // Jan–Mar: most-recent complete quarter is Q4 of last year
  return {
    current:  { start: `${year}-01-01`, end: `${year}-02-28`,     label: `Q4 ${year - 1}` },
    prior:    { start: `${year - 1}-10-01`, end: `${year - 1}-11-30`, label: `Q3 ${year - 1}` },
  };
}

// ─── Throttled fetch (EDGAR allows ~10 req/s) ────────────────────────────────
const CONCURRENCY = 8;
const DELAY_MS = 120; // ~8 req/s

async function throttledFetch(url, opts = {}) {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "application/json, text/plain, */*",
    ...opts.headers,
  };
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    console.warn(`  [WARN] ${res.status} ${url.slice(0, 80)}`);
    return null;
  }
  return res;
}

async function batchProcess(items, fn, concurrency = CONCURRENCY) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + concurrency < items.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }
  return results;
}

// ─── EDGAR EFTS search ───────────────────────────────────────────────────────
async function eftsSearch(cusip, start, end) {
  const hits = [];
  let from = 0;
  const size = 200;
  const seen = new Set();

  while (true) {
    const url =
      `https://efts.sec.gov/LATEST/search-index` +
      `?q=%22${cusip}%22` +
      `&forms=13F-HR` +
      `&dateRange=custom&startdt=${start}&enddt=${end}` +
      `&from=${from}&size=${size}`;

    const res = await throttledFetch(url);
    if (!res) break;

    const data = await res.json();
    const pageHits = data?.hits?.hits ?? [];
    const total = data?.hits?.total?.value ?? 0;

    for (const h of pageHits) {
      const acc = h._source?.accession_no;
      if (acc && !seen.has(acc)) {
        seen.add(acc);
        hits.push(h._source);
      }
    }

    from += size;
    if (from >= total || pageHits.length === 0) break;

    await new Promise((r) => setTimeout(r, 110));
  }

  console.log(`  EFTS ${cusip} [${start}→${end}]: ${hits.length} filings`);
  return hits;
}

// ─── Find info-table XML URL from EDGAR filing index ─────────────────────────
function cikFromAccession(accessionNo) {
  // "0000102909-25-010000" → 102909
  return parseInt(accessionNo.split("-")[0], 10);
}

function accNoDashes(accessionNo) {
  return accessionNo.replace(/-/g, "");
}

async function findInfoTableUrl(accessionNo) {
  const cik = cikFromAccession(accessionNo);
  const noD = accNoDashes(accessionNo);
  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${noD}/${accessionNo}-index.htm`;

  const res = await throttledFetch(indexUrl);
  if (!res) return tryCommonXmlUrls(cik, noD);

  const html = await res.text();

  // Collect all .xml paths in the page
  const xmlPaths = [];
  const re = /href="(\/Archives\/edgar\/data\/[^"]+\.xml)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) xmlPaths.push(m[1]);

  if (xmlPaths.length === 0) return tryCommonXmlUrls(cik, noD);

  // Prefer paths containing info-table keywords
  const preferred = xmlPaths.find((p) =>
    /infotable|informationtable|13finfo/i.test(p)
  );
  const chosen = preferred ?? xmlPaths[xmlPaths.length - 1];
  return `https://www.sec.gov${chosen}`;
}

async function tryCommonXmlUrls(cik, noD) {
  const base = `https://www.sec.gov/Archives/edgar/data/${cik}/${noD}`;
  for (const name of ["infotable.xml", "form13fInfoTable.xml", "informationtable.xml"]) {
    const url = `${base}/${name}`;
    const r = await throttledFetch(url);
    if (r) return url;
  }
  return null;
}

// ─── Parse XML for a specific CUSIP's position ───────────────────────────────
function parseInfoTable(xml, cusip) {
  // Handle both namespaced and plain elements
  const tableRe = /<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi;
  let m;
  while ((m = tableRe.exec(xml)) !== null) {
    const block = m[1];
    // Check CUSIP match (strip spaces/dashes just in case)
    const cusipMatch = block.match(/<(?:\w+:)?cusip>([^<]+)<\/(?:\w+:)?cusip>/i);
    if (!cusipMatch) continue;
    if (cusipMatch[1].replace(/\s|-/g, "") !== cusip) continue;

    const sharesMatch = block.match(/<(?:\w+:)?sshPrnamt>(\d+)<\/(?:\w+:)?sshPrnamt>/i);
    const valueMatch  = block.match(/<(?:\w+:)?value>(\d+)<\/(?:\w+:)?value>/i);
    return {
      shares: sharesMatch ? parseInt(sharesMatch[1], 10) : null,
      value:  valueMatch  ? parseInt(valueMatch[1],  10) : null, // in $thousands
    };
  }
  return null;
}

// ─── Process one filing hit ───────────────────────────────────────────────────
async function processHit(hit, cusip) {
  try {
    const xmlUrl = await findInfoTableUrl(hit.accession_no);
    if (!xmlUrl) return null;

    const res = await throttledFetch(xmlUrl);
    if (!res) return null;

    const xml = await res.text();
    const position = parseInfoTable(xml, cusip);
    if (!position) return null;

    return {
      cik: String(cikFromAccession(hit.accession_no)),
      name: hit.entity_name ?? "Unknown",
      accessionNo: hit.accession_no,
      fileDate: hit.file_date ?? "",
      periodOfReport: hit.period_of_report ?? "",
      shares: position.shares,
      value: position.value,
    };
  } catch (e) {
    return null;
  }
}

// ─── Classify action ─────────────────────────────────────────────────────────
function classifyAction(current, prior) {
  if (current == null && prior != null) return "Sell Out";
  if (current != null && prior == null) return "New Position";
  if (current == null && prior == null) return "No Change";
  if (current > prior) return "Bought";
  if (current < prior) return "Sold";
  return "No Change";
}

// ─── Main per-ticker function ─────────────────────────────────────────────────
async function fetchTickerData(ticker, cusip, ranges) {
  console.log(`\n=== ${ticker} (CUSIP ${cusip}) ===`);

  const [currentHits, priorHits] = await Promise.all([
    eftsSearch(cusip, ranges.current.start, ranges.current.end),
    eftsSearch(cusip, ranges.prior.start, ranges.prior.end),
  ]);

  console.log(`  Processing ${currentHits.length} current + ${priorHits.length} prior filings…`);

  const [currentResults, priorResults] = await Promise.all([
    batchProcess(currentHits, (h) => processHit(h, cusip)),
    batchProcess(priorHits,   (h) => processHit(h, cusip)),
  ]);

  // Build CIK → data maps
  const currentMap = new Map();
  const nameMap    = new Map();

  for (const r of currentResults) {
    if (!r) continue;
    currentMap.set(r.cik, { shares: r.shares, value: r.value, fileDate: r.fileDate });
    nameMap.set(r.cik, r.name);
  }

  const priorMap = new Map();
  for (const r of priorResults) {
    if (!r) continue;
    if (r.shares != null) priorMap.set(r.cik, r.shares);
    if (!nameMap.has(r.cik)) nameMap.set(r.cik, r.name);
  }

  const allCiks = new Set([...currentMap.keys(), ...priorMap.keys()]);
  const holdings = [];

  for (const cik of allCiks) {
    const cur  = currentMap.get(cik) ?? null;
    const curShares  = cur?.shares  ?? null;
    const curValue   = cur?.value   ?? null;
    const priorShares = priorMap.get(cik) ?? null;

    const change = curShares != null && priorShares != null
      ? curShares - priorShares : null;
    const pctChange = change != null && priorShares
      ? (change / priorShares) * 100 : null;

    holdings.push({
      filerName:    nameMap.get(cik) ?? "Unknown",
      filerCik:     cik,
      currentShares: curShares,
      priorShares,
      change,
      pctChange:    pctChange != null ? Math.round(pctChange * 10) / 10 : null,
      currentValue: curValue,
      action:       classifyAction(curShares, priorShares),
      fileDate:     cur?.fileDate ?? "",
    });
  }

  // Sort: current shares desc (nulls last)
  holdings.sort((a, b) => (b.currentShares ?? -1) - (a.currentShares ?? -1));

  const okCount = holdings.filter((h) => h.currentShares != null).length;
  console.log(`  ${ticker}: ${holdings.length} total holders (${okCount} with current position)`);

  return {
    ticker,
    cusip,
    currentPeriod: ranges.current.label,
    priorPeriod:   ranges.prior.label,
    lastUpdated:   new Date().toISOString(),
    holdings,
  };
}

// ─── Entry point ─────────────────────────────────────────────────────────────
async function main() {
  console.log("Fetching HEICO 13F institutional ownership from SEC EDGAR…");
  const ranges = getQuarterRanges();
  console.log(`Quarters: current=${ranges.current.label}, prior=${ranges.prior.label}`);

  const dataDir = join(ROOT, "data");
  mkdirSync(dataDir, { recursive: true });

  for (const [ticker, cusip] of Object.entries(TICKERS)) {
    try {
      const data = await fetchTickerData(ticker, cusip, ranges);
      const outPath = join(dataDir, `${ticker.toLowerCase()}.json`);
      writeFileSync(outPath, JSON.stringify(data, null, 2));
      console.log(`  Saved → ${outPath}`);
    } catch (err) {
      console.error(`  ERROR for ${ticker}:`, err.message);
    }
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
