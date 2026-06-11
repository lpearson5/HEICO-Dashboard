/**
 * Fetches HEICO institutional ownership from SEC EDGAR 13F-HR filings.
 *
 * Strategy: Download EDGAR's quarterly full-index (crawler.idx) to find every
 * 13F-HR filer for the relevant quarters, then download each filer's XML and
 * check whether it contains a HEICO CUSIP.
 *
 * This avoids the EDGAR EFTS full-text-search endpoint, which blocks cloud IPs.
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const CUSIPS = {
  HEI:  "422819102",
  HEIA: "422819201",
};

// EDGAR requires a descriptive User-Agent with a contact email
const HEADERS = {
  "User-Agent": "HEICO-Dashboard lpearson5@users.noreply.github.com",
  "Accept-Encoding": "gzip",
  "Accept": "*/*",
};

const CONCURRENCY = 15;
const DELAY_MS = 100;

// ─── Quarter helpers ─────────────────────────────────────────────────────────

function getQuarterInfo() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // 13F-HR due ~45 days after quarter end
  if (month >= 4 && month <= 6) {
    return {
      current: { year,     quarter: 1, label: `Q1 ${year}` },
      prior:   { year: year - 1, quarter: 4, label: `Q4 ${year - 1}` },
    };
  }
  if (month >= 7 && month <= 9) {
    return {
      current: { year, quarter: 2, label: `Q2 ${year}` },
      prior:   { year, quarter: 1, label: `Q1 ${year}` },
    };
  }
  if (month >= 10 && month <= 12) {
    return {
      current: { year, quarter: 3, label: `Q3 ${year}` },
      prior:   { year, quarter: 2, label: `Q2 ${year}` },
    };
  }
  return {
    current: { year: year - 1, quarter: 4, label: `Q4 ${year - 1}` },
    prior:   { year: year - 1, quarter: 3, label: `Q3 ${year - 1}` },
  };
}

// ─── Throttled fetch ──────────────────────────────────────────────────────────

async function get(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 429 || res.status === 503) {
        await sleep(2000 * attempt);
        continue;
      }
      if (!res.ok) {
        console.warn(`  [${res.status}] ${url.slice(0, 90)}`);
        return null;
      }
      return res;
    } catch (e) {
      if (attempt === 3) console.warn(`  [ERR] ${e.message.slice(0, 60)} — ${url.slice(0, 60)}`);
      await sleep(500 * attempt);
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function batchProcess(items, fn, concurrency = CONCURRENCY) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const out = await Promise.all(batch.map(fn));
    results.push(...out);
    if (i + concurrency < items.length) await sleep(DELAY_MS);
    if (i % 500 === 0 && i > 0) {
      const found = results.filter(Boolean).length;
      console.log(`  … ${i}/${items.length} checked, ${found} HEICO holders so far`);
    }
  }
  return results;
}

// ─── Download quarterly filer list ───────────────────────────────────────────

async function getQuarterFilers(year, quarter) {
  // crawler.idx is pipe-delimited: Company Name|Form Type|CIK|Date Filed|Filename
  const url = `https://www.sec.gov/Archives/edgar/full-index/${year}/QTR${quarter}/crawler.idx`;
  console.log(`  Fetching index: ${url}`);

  const res = await get(url);
  if (!res) throw new Error(`Failed to fetch quarterly index ${year} QTR${quarter}`);

  const text = await res.text();
  const filers = [];
  const seen = new Set();

  for (const line of text.split("\n")) {
    if (!line.includes("|13F-HR|")) continue;
    const [company, formType, cik, dateField, filename] = line.split("|");
    if (!formType || formType.trim() !== "13F-HR") continue;
    if (!filename) continue;

    const accMatch = filename.match(/(\d{10}-\d{2}-\d{6})/);
    if (!accMatch) continue;

    const cleanCik = cik ? cik.trim().replace(/^0+/, "") || "0" : "0";
    const key = accMatch[1];
    if (seen.has(key)) continue;
    seen.add(key);

    filers.push({
      cik: cleanCik,
      accessionNo: accMatch[1],
      company: company ? company.trim() : "Unknown",
      indexPath: filename.trim(),
    });
  }

  console.log(`  ${filers.length} 13F-HR filers found for ${year} QTR${quarter}`);
  return filers;
}

// ─── Find info-table XML URL ──────────────────────────────────────────────────

function buildIndexUrl(indexPath) {
  return `https://www.sec.gov/${indexPath.replace(/^\//, "")}`;
}

async function findInfoTableUrl(cik, accessionNo, indexPath) {
  const accNoDashes = accessionNo.replace(/-/g, "");

  // First: try fetching the filing index HTML and parsing it
  const indexUrl = buildIndexUrl(indexPath);
  const res = await get(indexUrl);

  if (res) {
    const html = await res.text();
    const xmlPaths = [];
    const re = /href="(\/Archives\/edgar\/data\/[^"]+\.xml)"/gi;
    let m;
    while ((m = re.exec(html)) !== null) xmlPaths.push(m[1]);

    if (xmlPaths.length > 0) {
      const preferred = xmlPaths.find((p) =>
        /infotable|informationtable|13finfo/i.test(p)
      );
      return `https://www.sec.gov${preferred ?? xmlPaths[xmlPaths.length - 1]}`;
    }
  }

  // Fallback: try common filenames
  const base = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDashes}`;
  for (const name of ["infotable.xml", "form13fInfoTable.xml", "informationtable.xml"]) {
    const r = await get(`${base}/${name}`);
    if (r) return `${base}/${name}`;
  }

  return null;
}

// ─── Parse XML for a CUSIP's position ────────────────────────────────────────

function parseInfoTable(xml, cusip) {
  const tableRe = /<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi;
  let m;
  while ((m = tableRe.exec(xml)) !== null) {
    const block = m[1];
    const cusipM = block.match(/<(?:\w+:)?cusip>([^<]+)<\/(?:\w+:)?cusip>/i);
    if (!cusipM) continue;
    if (cusipM[1].replace(/[\s-]/g, "") !== cusip) continue;

    const sharesM = block.match(/<(?:\w+:)?sshPrnamt>(\d+)<\/(?:\w+:)?sshPrnamt>/i);
    const valueM  = block.match(/<(?:\w+:)?value>(\d+)<\/(?:\w+:)?value>/i);
    return {
      shares: sharesM ? parseInt(sharesM[1], 10) : null,
      value:  valueM  ? parseInt(valueM[1],  10) : null,
    };
  }
  return null;
}

// ─── Process one filer ────────────────────────────────────────────────────────

async function processFiler(filer, cusips) {
  const xmlUrl = await findInfoTableUrl(filer.cik, filer.accessionNo, filer.indexPath);
  if (!xmlUrl) return null;

  const res = await get(xmlUrl);
  if (!res) return null;

  const xml = await res.text();

  const positions = {};
  for (const [ticker, cusip] of Object.entries(cusips)) {
    const pos = parseInfoTable(xml, cusip);
    if (pos) positions[ticker] = pos;
  }

  if (Object.keys(positions).length === 0) return null;

  return { cik: filer.cik, name: filer.company, positions };
}

// ─── Classify action ──────────────────────────────────────────────────────────

function classifyAction(current, prior) {
  if (current == null && prior != null) return "Sell Out";
  if (current != null && prior == null) return "New Position";
  if (current == null)                  return "No Change";
  if (current > prior)  return "Bought";
  if (current < prior)  return "Sold";
  return "No Change";
}

// ─── Build holdings output ────────────────────────────────────────────────────

function buildHoldings(ticker, currentResults, priorResults) {
  const curMap  = new Map();
  const priorMap = new Map();
  const nameMap  = new Map();

  for (const r of currentResults) {
    if (!r) continue;
    nameMap.set(r.cik, r.name);
    const pos = r.positions[ticker];
    if (pos) curMap.set(r.cik, pos);
  }
  for (const r of priorResults) {
    if (!r) continue;
    if (!nameMap.has(r.cik)) nameMap.set(r.cik, r.name);
    const pos = r.positions[ticker];
    if (pos?.shares != null) priorMap.set(r.cik, pos.shares);
  }

  const allCiks = new Set([...curMap.keys(), ...priorMap.keys()]);
  const holdings = [];

  for (const cik of allCiks) {
    const cur   = curMap.get(cik)   ?? null;
    const curSh = cur?.shares       ?? null;
    const priSh = priorMap.get(cik) ?? null;

    const change    = curSh != null && priSh != null ? curSh - priSh : null;
    const pctChange = change != null && priSh
      ? Math.round((change / priSh) * 1000) / 10 : null;

    holdings.push({
      filerName:    nameMap.get(cik) ?? "Unknown",
      filerCik:     cik,
      currentShares: curSh,
      priorShares:  priSh,
      change,
      pctChange,
      currentValue: cur?.value ?? null,
      action: classifyAction(curSh, priSh),
    });
  }

  holdings.sort((a, b) => (b.currentShares ?? -1) - (a.currentShares ?? -1));
  return holdings;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== HEICO Institutional Ownership Fetch ===");
  const { current, prior } = getQuarterInfo();
  console.log(`Current: ${current.label}  Prior: ${prior.label}`);

  // Download both quarter indexes
  const [curFilers, priFilersRaw] = await Promise.all([
    getQuarterFilers(current.year, current.quarter),
    getQuarterFilers(prior.year, prior.quarter),
  ]);

  // De-duplicate prior filers by CIK (keep most recent filing per filer)
  const priFilersByCik = new Map();
  for (const f of priFilersRaw) priFilersByCik.set(f.cik, f);
  const priFilers = [...priFilersByCik.values()];

  console.log(`\nProcessing ${curFilers.length} current + ${priFilers.length} prior filers...`);
  console.log("(This checks each filer's XML for HEICO positions — takes a few minutes)\n");

  const [currentResults, priorResults] = await Promise.all([
    batchProcess(curFilers,  (f) => processFiler(f, CUSIPS)),
    batchProcess(priFilers,  (f) => processFiler(f, CUSIPS)),
  ]);

  const curFound  = currentResults.filter(Boolean).length;
  const priFound  = priorResults.filter(Boolean).length;
  console.log(`\nFound ${curFound} HEICO holders in current quarter, ${priFound} in prior quarter`);

  mkdirSync(join(ROOT, "data"), { recursive: true });

  for (const [ticker] of Object.entries(CUSIPS)) {
    const holdings = buildHoldings(ticker, currentResults, priorResults);
    const out = {
      ticker,
      cusip: CUSIPS[ticker],
      currentPeriod: current.label,
      priorPeriod:   prior.label,
      lastUpdated:   new Date().toISOString(),
      holdings,
    };
    const path = join(ROOT, "data", `${ticker.toLowerCase()}.json`);
    writeFileSync(path, JSON.stringify(out, null, 2));
    const withPos = holdings.filter((h) => h.currentShares != null).length;
    console.log(`  ${ticker}: ${holdings.length} total, ${withPos} with current position → ${path}`);
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
