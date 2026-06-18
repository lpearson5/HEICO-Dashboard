/**
 * Fetches HEICO institutional ownership from SEC EDGAR bulk 13F data sets.
 *
 * SEC publishes quarterly ZIP files containing ALL 13F holdings data.
 * We download one ZIP per quarter, extract the infotable TSV, and filter
 * for HEICO's CUSIPs — no per-filer scraping required.
 *
 * Bulk data URL: https://www.sec.gov/data/form13f/{YEAR}q{Q}_form13f.zip
 * Each ZIP contains:
 *   INFOTABLE.tsv  — one row per holding (CUSIP, shares, value, accession)
 *   COVERPAGE.tsv  — one row per filing (accession, filer name, period)
 *   SUBMISSION.tsv — accession → CIK mapping
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createInflateRaw } from "zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const CUSIPS = { HEI: "422819102", HEIA: "422819201" };

const HEADERS = {
  "User-Agent": "HEICO-Dashboard/1.0 lpearson@heico.com",
  "Accept-Encoding": "identity",
  "Accept": "*/*",
};

// ─── Quarter helpers ──────────────────────────────────────────────────────────

function getQuarters() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  // 13F due ~45 days after quarter end; if Apr-Jun we're in the Q1 filing window
  if (m >= 4 && m <= 6)   return { cur: { y, q: 1, label: `Q1 ${y}` },        pri: { y: y-1, q: 4, label: `Q4 ${y-1}` } };
  if (m >= 7 && m <= 9)   return { cur: { y, q: 2, label: `Q2 ${y}` },        pri: { y,     q: 1, label: `Q1 ${y}` } };
  if (m >= 10 && m <= 12) return { cur: { y, q: 3, label: `Q3 ${y}` },        pri: { y,     q: 2, label: `Q2 ${y}` } };
  return                          { cur: { y: y-1, q: 4, label: `Q4 ${y-1}` }, pri: { y: y-1, q: 3, label: `Q3 ${y-1}` } };
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchBuffer(url) {
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 429 || res.status === 503) { await sleep(5000 * i); continue; }
      if (!res.ok) { console.warn(`  [${res.status}] ${url}`); return null; }
      const buf = Buffer.from(await res.arrayBuffer());
      return buf;
    } catch (e) {
      if (i === 3) console.warn(`  [ERR] ${e.message}`);
      await sleep(1000 * i);
    }
  }
  return null;
}

// ─── ZIP reader (no npm deps) ─────────────────────────────────────────────────
// Minimal ZIP parser: reads local file headers and extracts stored/deflated entries.

function readUint16LE(buf, off) { return buf[off] | (buf[off+1] << 8); }
function readUint32LE(buf, off) { return (buf[off] | (buf[off+1]<<8) | (buf[off+2]<<16) | (buf[off+3]<<24)) >>> 0; }

async function extractFileFromZip(zipBuf, targetName) {
  // Walk local file headers (PK\x03\x04)
  let off = 0;
  while (off < zipBuf.length - 4) {
    if (zipBuf[off] !== 0x50 || zipBuf[off+1] !== 0x4B ||
        zipBuf[off+2] !== 0x03 || zipBuf[off+3] !== 0x04) {
      off++;
      continue;
    }
    const compression   = readUint16LE(zipBuf, off + 8);
    const compSize      = readUint32LE(zipBuf, off + 18);
    const uncompSize    = readUint32LE(zipBuf, off + 22);
    const nameLen       = readUint16LE(zipBuf, off + 26);
    const extraLen      = readUint16LE(zipBuf, off + 28);
    const name          = zipBuf.slice(off + 30, off + 30 + nameLen).toString("utf8");
    const dataStart     = off + 30 + nameLen + extraLen;

    if (name.toUpperCase() === targetName.toUpperCase()) {
      const compData = zipBuf.slice(dataStart, dataStart + compSize);
      if (compression === 0) {
        // Stored — no compression
        return compData.toString("utf8");
      } else if (compression === 8) {
        // Deflated
        return await new Promise((resolve, reject) => {
          const chunks = [];
          const inflate = createInflateRaw();
          inflate.on("data", c => chunks.push(c));
          inflate.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
          inflate.on("error", reject);
          inflate.write(compData);
          inflate.end();
        });
      } else {
        throw new Error(`Unsupported ZIP compression method: ${compression}`);
      }
    }
    off = dataStart + compSize;
  }
  return null;
}

// ─── TSV parser ───────────────────────────────────────────────────────────────

function parseTsv(text) {
  const lines = text.split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t").map(h => h.trim().toUpperCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split("\t");
    const row = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = (cols[j] ?? "").trim();
    rows.push(row);
  }
  return rows;
}

// ─── Bulk 13F download ────────────────────────────────────────────────────────

async function fetchQuarterData(y, q) {
  const url = `https://www.sec.gov/data/form13f/${y}q${q}_form13f.zip`;
  console.log(`  Downloading bulk data: ${url}`);
  const buf = await fetchBuffer(url);
  if (!buf) {
    // Try alternate URL format
    const url2 = `https://www.sec.gov/Archives/edgar/form13f/${y}q${q}_form13f.zip`;
    console.log(`  Trying alternate URL: ${url2}`);
    const buf2 = await fetchBuffer(url2);
    if (!buf2) throw new Error(`Cannot download 13F bulk data for ${y} Q${q}`);
    return buf2;
  }
  return buf;
}

async function getHolderData(y, q) {
  const zipBuf = await fetchQuarterData(y, q);
  console.log(`  Downloaded ${(zipBuf.length / 1024 / 1024).toFixed(1)} MB`);

  console.log(`  Extracting INFOTABLE.tsv...`);
  const infoTsv = await extractFileFromZip(zipBuf, "INFOTABLE.tsv");
  if (!infoTsv) throw new Error("INFOTABLE.tsv not found in ZIP");

  console.log(`  Extracting COVERPAGE.tsv...`);
  const coverTsv = await extractFileFromZip(zipBuf, "COVERPAGE.tsv");
  if (!coverTsv) throw new Error("COVERPAGE.tsv not found in ZIP");

  // Build accession → filer name map from cover page
  const coverRows = parseTsv(coverTsv);
  const filerMap = new Map();
  for (const row of coverRows) {
    const acc = row["ACCESSION_NUMBER"] ?? row["ACCESSION-NUMBER"] ?? "";
    const name = row["FILINGMANAGER_NAME"] ?? row["FILER_NAME"] ?? row["MANAGERNAME"] ?? "Unknown";
    if (acc) filerMap.set(acc, name);
  }
  console.log(`  ${filerMap.size} filers in cover page`);

  // Filter infotable for HEICO CUSIPs
  const infoRows = parseTsv(infoTsv);
  console.log(`  ${infoRows.length} total holding rows`);

  const results = [];
  for (const row of infoRows) {
    const cusip = (row["CUSIP"] ?? "").replace(/[\s-]/g, "");
    for (const [ticker, targetCusip] of Object.entries(CUSIPS)) {
      if (cusip === targetCusip) {
        const acc = row["ACCESSION_NUMBER"] ?? row["ACCESSION-NUMBER"] ?? "";
        const shares = parseInt(row["SSHPRNAMT"] ?? "0", 10) || null;
        const value  = parseInt(row["VALUE"] ?? "0", 10) || null;
        results.push({
          accession: acc,
          ticker,
          filerName: filerMap.get(acc) ?? "Unknown",
          shares,
          value,
        });
      }
    }
  }
  console.log(`  Found ${results.length} HEICO holding rows`);
  return results;
}

// ─── Action classification ───────────────────────────────────────────────────

function classifyAction(cur, pri) {
  if (cur == null && pri != null) return "Sell Out";
  if (cur != null && pri == null) return "New Position";
  if (cur == null) return "No Change";
  if (cur > pri) return "Bought";
  if (cur < pri) return "Sold";
  return "No Change";
}

// ─── Build holdings ───────────────────────────────────────────────────────────

function buildHoldings(ticker, curRows, priRows) {
  // Map by filer name (bulk data doesn't always have CIK)
  const curMap = new Map(), priMap = new Map();
  for (const r of curRows.filter(x => x.ticker === ticker)) {
    curMap.set(r.accession, { shares: r.shares, value: r.value, name: r.filerName });
  }
  for (const r of priRows.filter(x => x.ticker === ticker)) {
    priMap.set(r.accession, { shares: r.shares, name: r.filerName });
  }

  // Merge by accession (same institution may use same accession prefix pattern)
  // For cross-quarter comparison, match by filer name
  const curByName = new Map(), priByName = new Map();
  for (const [, v] of curMap) curByName.set(v.name, v);
  for (const [, v] of priMap) priByName.set(v.name, v);

  const allNames = new Set([...curByName.keys(), ...priByName.keys()]);
  const holdings = [];
  for (const name of allNames) {
    const cur = curByName.get(name) ?? null;
    const pri = priByName.get(name) ?? null;
    const curSh = cur?.shares ?? null;
    const priSh = pri?.shares ?? null;
    const change = curSh != null && priSh != null ? curSh - priSh : null;
    const pctChange = change != null && priSh ? Math.round((change / priSh) * 1000) / 10 : null;
    holdings.push({
      filerName: name,
      currentShares: curSh,
      priorShares: priSh,
      change,
      pctChange,
      currentValue: cur?.value ?? null,
      action: classifyAction(curSh, priSh),
    });
  }
  return holdings.sort((a, b) => (b.currentShares ?? -1) - (a.currentShares ?? -1));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== HEICO 13F Bulk Fetch ===");
  const { cur, pri } = getQuarters();
  console.log(`Current quarter: ${cur.label}   Prior quarter: ${pri.label}\n`);

  console.log(`Fetching ${cur.label} bulk data...`);
  const curRows = await getHolderData(cur.y, cur.q);
  await sleep(2000);

  console.log(`\nFetching ${pri.label} bulk data...`);
  const priRows = await getHolderData(pri.y, pri.q);

  mkdirSync(join(ROOT, "data"), { recursive: true });

  for (const ticker of Object.keys(CUSIPS)) {
    const holdings = buildHoldings(ticker, curRows, priRows);
    const withPos = holdings.filter(h => h.currentShares != null).length;
    writeFileSync(
      join(ROOT, "data", `${ticker.toLowerCase()}.json`),
      JSON.stringify({ ticker, cusip: CUSIPS[ticker], currentPeriod: cur.label,
                       priorPeriod: pri.label, lastUpdated: new Date().toISOString(), holdings }, null, 2)
    );
    console.log(`  ${ticker}: ${withPos} current holders, ${holdings.length} total`);
  }
  console.log("\nDone!");
}

main().catch(e => { console.error(e); process.exit(1); });
