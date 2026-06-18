/**
 * Fetches HEICO institutional ownership from SEC EDGAR 13F-HR filings.
 *
 * Key design decisions:
 * - Scans the EDGAR filing-quarter index (not the holdings-period quarter).
 *   Q1 2026 holdings are FILED in QTR2 2026 (April-May). Previous versions
 *   scanned QTR1 which had Q4 2025 data — one quarter behind.
 * - Caches every scanned accession number. Weekly reruns skip already-scanned
 *   filers and only process newcomers, finishing in minutes instead of hours.
 * - Saves partial results every 500 filers so a timeout doesn't lose progress.
 * - Rate limiting: concurrency=3, 3 s between batches. ~4-5 hrs first run,
 *   minutes on subsequent weekly runs.
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, "..");
const DATA_DIR  = join(ROOT, "data");

const CUSIPS = { HEI: "422819102", HEIA: "422819201" };

const HEADERS = {
  "User-Agent":       "HEICO-Dashboard/1.0 lpearson@heico.com",
  "Accept-Encoding":  "identity",
  "Accept":           "*/*",
};

const CONCURRENCY  = 3;
const BATCH_SLEEP  = 3000;   // ms between batches — keeps SEC happy
const SAVE_EVERY   = 500;    // persist partial results this often

// ─── Quarter helpers ──────────────────────────────────────────────────────────
// 13F-HR filings are DUE ~45 days after quarter end and appear in EDGAR's
// *next* quarterly index. Map holdings period → EDGAR filing quarter.
//
//  Holdings period   | Filed       | EDGAR index
//  Q1 (Jan-Mar)      | Apr-May     | QTR2 same year
//  Q2 (Apr-Jun)      | Jul-Aug     | QTR3 same year
//  Q3 (Jul-Sep)      | Oct-Nov     | QTR4 same year
//  Q4 (Oct-Dec)      | Jan-Feb     | QTR1 next year

function getQuarters() {
  const now = new Date();
  const y   = now.getFullYear();
  const m   = now.getMonth() + 1;

  if (m >= 4 && m <= 6)   return {
    cur: { y, q: 2, label: `Q1 ${y}` },
    pri: { y, q: 1, label: `Q4 ${y - 1}` },
  };
  if (m >= 7 && m <= 9)   return {
    cur: { y, q: 3, label: `Q2 ${y}` },
    pri: { y, q: 2, label: `Q1 ${y}` },
  };
  if (m >= 10 && m <= 12) return {
    cur: { y, q: 4, label: `Q3 ${y}` },
    pri: { y, q: 3, label: `Q2 ${y}` },
  };
  // January-March
  return {
    cur: { y, q: 1, label: `Q4 ${y - 1}` },
    pri: { y: y - 1, q: 4, label: `Q3 ${y - 1}` },
  };
}

// ─── Cache ────────────────────────────────────────────────────────────────────
// Persists scanned accession numbers so weekly reruns skip already-checked filers.

const CACHE_PATH = join(DATA_DIR, "scan-cache.json");

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try { return JSON.parse(readFileSync(CACHE_PATH, "utf8")); }
  catch { return {}; }
}

function saveCache(cache) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function get(url) {
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 429 || res.status === 503) {
        console.warn(`  [${res.status}] rate-limited, waiting ${8 * i}s…`);
        await sleep(8000 * i);
        continue;
      }
      if (!res.ok) { console.warn(`  [${res.status}] ${url.slice(0, 100)}`); return null; }
      return res;
    } catch (e) {
      if (i === 3) console.warn(`  [ERR] ${e.message.slice(0, 80)}`);
      await sleep(2000 * i);
    }
  }
  return null;
}

async function batch(items, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    out.push(...await Promise.all(items.slice(i, i + CONCURRENCY).map(fn)));
    if (i + CONCURRENCY < items.length) await sleep(BATCH_SLEEP);
  }
  return out;
}

// ─── Index download ───────────────────────────────────────────────────────────

async function getQuarterFilers(y, q) {
  const url = `https://www.sec.gov/Archives/edgar/full-index/${y}/QTR${q}/company.idx`;
  console.log(`  Downloading index: ${url}`);
  const res = await get(url);
  if (!res) throw new Error(`Cannot download index for ${y} QTR${q}`);

  const text  = await res.text();
  const byKey = new Map(); // CIK → filer (keep latest accession per CIK)

  for (const line of text.split("\n")) {
    if (!line.includes("13F-HR")) continue;
    const m = line.match(/^(.+?)\s{2,}(13F-HR\S*)\s+(\d+)\s+\S+\s+(edgar\/\S+)/);
    if (!m) continue;
    const [, company, , cikRaw, filename] = m;
    const accM = filename.match(/(\d{10}-\d{2}-\d{6})/);
    if (!accM) continue;
    const cik = cikRaw.replace(/^0+/, "") || "0";
    // Prefer amendments (13F-HR/A) over originals — they supersede
    const existing = byKey.get(cik);
    const isAmend  = m[2].includes("/A");
    if (!existing || isAmend) {
      byKey.set(cik, { cik, accessionNo: accM[1], company: company.trim() });
    }
  }

  const filers = [...byKey.values()];
  console.log(`  ${filers.length} unique 13F filers for ${y} QTR${q}`);
  return filers;
}

// ─── XML parsing ─────────────────────────────────────────────────────────────

async function getXmlUrl(filer) {
  const { cik, accessionNo } = filer;
  const noD = accessionNo.replace(/-/g, "");

  const indexRes = await get(
    `https://www.sec.gov/Archives/edgar/data/${cik}/${noD}/${accessionNo}-index.htm`
  );
  if (indexRes) {
    const html = await indexRes.text();
    const base = `https://www.sec.gov/Archives/edgar/data/${cik}/${noD}/`;
    const re   = /href="([^"]+\.xml)"/gi;
    let m;
    const candidates = [];
    while ((m = re.exec(html)) !== null) {
      const href = m[1];
      candidates.push(href.startsWith("/") ? `https://www.sec.gov${href}` : `${base}${href}`);
    }
    if (candidates.length) {
      return candidates.find(x => /infotable|informationtable|13finfo/i.test(x))
        ?? candidates[candidates.length - 1];
    }
  }

  const base = `https://www.sec.gov/Archives/edgar/data/${cik}/${noD}`;
  for (const name of ["infotable.xml", "form13fInfoTable.xml", "informationtable.xml"]) {
    const r = await get(`${base}/${name}`);
    if (r) return `${base}/${name}`;
  }
  return null;
}

function parseXml(xml, cusip) {
  const re = /<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b  = m[1];
    const cm = b.match(/<(?:\w+:)?cusip>([^<]+)<\/(?:\w+:)?cusip>/i);
    if (!cm || cm[1].replace(/[\s-]/g, "") !== cusip) continue;
    const sm = b.match(/<(?:\w+:)?sshPrnamt>(\d+)<\/(?:\w+:)?sshPrnamt>/i);
    const vm = b.match(/<(?:\w+:)?value>(\d+)<\/(?:\w+:)?value>/i);
    return { shares: sm ? parseInt(sm[1], 10) : null, value: vm ? parseInt(vm[1], 10) : null };
  }
  return null;
}

async function processFiler(filer) {
  try {
    const xmlUrl = await getXmlUrl(filer);
    if (!xmlUrl) return null;
    const res = await get(xmlUrl);
    if (!res) return null;
    const xml = await res.text();

    // Skip HTML block pages served by SEC bot detection
    if (!xml.includes("infoTable") && !xml.includes("InfoTable")) return null;

    const positions = {};
    for (const [t, c] of Object.entries(CUSIPS)) {
      const p = parseXml(xml, c);
      if (p) positions[t] = p;
    }
    if (!Object.keys(positions).length) return null;
    return { cik: filer.cik, name: filer.company, positions };
  } catch { return null; }
}

// ─── Holdings builder ─────────────────────────────────────────────────────────

function classifyAction(cur, pri) {
  if (cur == null && pri != null) return "Sell Out";
  if (cur != null && pri == null) return "New Position";
  if (cur == null) return "No Change";
  if (cur > pri)   return "Bought";
  if (cur < pri)   return "Sold";
  return "No Change";
}

function buildHoldings(ticker, curResults, priResults) {
  const curMap = new Map(), priMap = new Map(), nameMap = new Map();
  for (const r of curResults) {
    if (!r) continue;
    nameMap.set(r.cik, r.name);
    const p = r.positions[ticker];
    if (p) curMap.set(r.cik, p);
  }
  for (const r of priResults) {
    if (!r) continue;
    if (!nameMap.has(r.cik)) nameMap.set(r.cik, r.name);
    const p = r.positions[ticker];
    if (p?.shares != null) priMap.set(r.cik, p.shares);
  }
  const holdings = [];
  for (const cik of new Set([...curMap.keys(), ...priMap.keys()])) {
    const cur   = curMap.get(cik) ?? null;
    const curSh = cur?.shares ?? null;
    const priSh = priMap.get(cik) ?? null;
    const change    = curSh != null && priSh != null ? curSh - priSh : null;
    const pctChange = change != null && priSh ? Math.round(change / priSh * 1000) / 10 : null;
    holdings.push({
      filerName:     nameMap.get(cik) ?? "Unknown",
      filerCik:      cik,
      currentShares: curSh,
      priorShares:   priSh,
      change, pctChange,
      currentValue:  cur?.value ?? null,
      action:        classifyAction(curSh, priSh),
    });
  }
  return holdings.sort((a, b) => (b.currentShares ?? -1) - (a.currentShares ?? -1));
}

function saveOutput(ticker, curResults, priResults, curLabel, priLabel) {
  const holdings = buildHoldings(ticker, curResults, priResults);
  const withPos  = holdings.filter(h => h.currentShares != null).length;
  writeFileSync(
    join(DATA_DIR, `${ticker.toLowerCase()}.json`),
    JSON.stringify({
      ticker, cusip: CUSIPS[ticker],
      currentPeriod: curLabel, priorPeriod: priLabel,
      lastUpdated: new Date().toISOString(), holdings,
    }, null, 2)
  );
  return withPos;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== HEICO 13F Fetch (cached, correct quarters) ===");
  const { cur, pri } = getQuarters();
  console.log(`Holdings periods: current=${cur.label}  prior=${pri.label}`);
  console.log(`EDGAR indices:    current=QTR${cur.q} ${cur.y}  prior=QTR${pri.q} ${pri.y}\n`);

  mkdirSync(DATA_DIR, { recursive: true });

  const cache    = loadCache();
  const curKey   = `${cur.y}_QTR${cur.q}`;
  const priKey   = `${pri.y}_QTR${pri.q}`;
  const curCache = new Set(cache[curKey] ?? []);
  const priCache = new Set(cache[priKey] ?? []);

  console.log(`Cache: ${curCache.size} already scanned for ${curKey}, ${priCache.size} for ${priKey}\n`);

  // Download filer lists
  const curFilers = await getQuarterFilers(cur.y, cur.q);
  await sleep(2000);
  const priFilers = await getQuarterFilers(pri.y, pri.q);
  await sleep(2000);

  // Filter to only un-cached filers
  const newCurFilers = curFilers.filter(f => !curCache.has(f.accessionNo));
  const newPriFilers = priFilers.filter(f => !priCache.has(f.accessionNo));
  console.log(`\nNew filers to scan: ${newCurFilers.length} current, ${newPriFilers.length} prior`);

  // Load any existing partial results
  const allCurResults = [], allPriResults = [];

  // Scan current quarter filers
  if (newCurFilers.length > 0) {
    console.log(`\nScanning ${newCurFilers.length} current-quarter filers…`);
    let scanned = 0;
    for (let i = 0; i < newCurFilers.length; i += CONCURRENCY) {
      const chunk = newCurFilers.slice(i, i + CONCURRENCY);
      const results = await Promise.all(chunk.map(f => processFiler(f)));
      results.forEach((r, j) => {
        curCache.add(chunk[j].accessionNo);
        if (r) { allCurResults.push(r); console.log(`  ✓ ${r.name} — ${Object.keys(r.positions).join(", ")}`); }
      });
      scanned += chunk.length;
      if (i + CONCURRENCY < newCurFilers.length) await sleep(BATCH_SLEEP);

      if (scanned % SAVE_EVERY === 0 || scanned === newCurFilers.length) {
        cache[curKey] = [...curCache];
        saveCache(cache);
        for (const ticker of Object.keys(CUSIPS)) {
          const n = saveOutput(ticker, allCurResults, allPriResults, cur.label, pri.label);
          console.log(`  [checkpoint] ${ticker}: ${n} current holders so far (${scanned}/${newCurFilers.length} scanned)`);
        }
      }
    }
  }

  await sleep(3000);

  // Scan prior quarter filers
  if (newPriFilers.length > 0) {
    console.log(`\nScanning ${newPriFilers.length} prior-quarter filers…`);
    let scanned = 0;
    for (let i = 0; i < newPriFilers.length; i += CONCURRENCY) {
      const chunk = newPriFilers.slice(i, i + CONCURRENCY);
      const results = await Promise.all(chunk.map(f => processFiler(f)));
      results.forEach((r, j) => {
        priCache.add(chunk[j].accessionNo);
        if (r) { allPriResults.push(r); }
      });
      scanned += chunk.length;
      if (i + CONCURRENCY < newPriFilers.length) await sleep(BATCH_SLEEP);

      if (scanned % SAVE_EVERY === 0 || scanned === newPriFilers.length) {
        cache[priKey] = [...priCache];
        saveCache(cache);
        for (const ticker of Object.keys(CUSIPS)) {
          const n = saveOutput(ticker, allCurResults, allPriResults, cur.label, pri.label);
          console.log(`  [checkpoint] ${ticker}: ${n} current holders (${scanned}/${newPriFilers.length} prior scanned)`);
        }
      }
    }
  }

  // Final save
  cache[curKey] = [...curCache];
  cache[priKey] = [...priCache];
  saveCache(cache);

  for (const ticker of Object.keys(CUSIPS)) {
    const n = saveOutput(ticker, allCurResults, allPriResults, cur.label, pri.label);
    console.log(`  ${ticker}: ${n} current holders`);
  }

  console.log("\nDone!");
}

main().catch(e => { console.error(e); process.exit(1); });
