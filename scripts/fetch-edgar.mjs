/**
 * Fetches HEICO institutional ownership from SEC EDGAR 13F-HR filings.
 *
 * Strategy: Download EDGAR's quarterly crawler.idx (a pipe-delimited list of
 * every filing that quarter), filter for 13F-HR, then download each filer's
 * XML and check for HEICO CUSIPs.
 *
 * Runs on a self-hosted runner (your PC) so www.sec.gov is not blocked.
 */

// Corporate SSL inspection proxies re-sign certificates with a company CA that
// Node.js doesn't trust. Disable strict TLS verification so requests work on HEICO's network.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const CUSIPS = { HEI: "422819102", HEIA: "422819201" };

const HEADERS = {
  "User-Agent": "HEICO-Dashboard/1.0 lpearson@heico.com",
  "Accept-Encoding": "identity",
  "Accept": "*/*",
};

const CONCURRENCY = 20;

// ─── Quarter helpers ──────────────────────────────────────────────────────────

function getQuarters() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  // 13F-HR due ~45 days after quarter end
  if (m >= 4 && m <= 6)  return { cur: { y, q: 1, label: `Q1 ${y}` },   pri: { y: y-1, q: 4, label: `Q4 ${y-1}` } };
  if (m >= 7 && m <= 9)  return { cur: { y, q: 2, label: `Q2 ${y}` },   pri: { y,     q: 1, label: `Q1 ${y}`   } };
  if (m >= 10 && m <= 12) return { cur: { y, q: 3, label: `Q3 ${y}` },  pri: { y,     q: 2, label: `Q2 ${y}`   } };
  return                          { cur: { y: y-1, q: 4, label: `Q4 ${y-1}` }, pri: { y: y-1, q: 3, label: `Q3 ${y-1}` } };
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function get(url) {
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 429 || res.status === 503) { await sleep(3000 * i); continue; }
      if (!res.ok) { console.warn(`  [${res.status}] ${url.slice(0, 100)}`); return null; }
      return res;
    } catch (e) {
      if (i === 3) console.warn(`  [ERR] ${e.message.slice(0, 80)}`);
      await sleep(800 * i);
    }
  }
  return null;
}

async function batch(items, fn, concurrency = CONCURRENCY) {
  const out = [];
  for (let i = 0; i < items.length; i += concurrency) {
    out.push(...await Promise.all(items.slice(i, i + concurrency).map(fn)));
    if (i + concurrency < items.length) await sleep(120);
    if (i > 0 && i % 500 === 0) {
      console.log(`    … ${i}/${items.length} checked, ${out.filter(Boolean).length} HEICO holders so far`);
    }
  }
  return out;
}

// ─── Quarterly index ──────────────────────────────────────────────────────────

async function getQuarterFilers(y, q) {
  const url = `https://www.sec.gov/Archives/edgar/full-index/${y}/QTR${q}/company.idx`;
  console.log(`  Downloading index: ${url}`);
  const res = await get(url);
  if (!res) throw new Error(`Cannot download quarterly index for ${y} QTR${q}. Check your internet connection.`);

  const text = await res.text();
  const filers = [];
  const seen = new Set();

  // company.idx is fixed-width — use regex to find 13F-HR lines robustly
  for (const line of text.split("\n")) {
    if (!line.includes("13F-HR")) continue;
    // Match: company name, then 2+ spaces, then form type, then CIK (10 digits), then date, then edgar/ path
    const m = line.match(/^(.+?)\s{2,}(13F-HR\S*)\s+(\d{10})\s+\S+\s+(edgar\/\S+)/);
    if (!m) continue;
    const [, company, formType, cikRaw, filename] = m;
    if (!formType.startsWith("13F-HR")) continue;
    const accM = filename.match(/(\d{10}-\d{2}-\d{6})/);
    if (!accM) continue;
    if (seen.has(accM[1])) continue;
    seen.add(accM[1]);
    const cik = cikRaw.replace(/^0+/, "") || "0";
    filers.push({ cik, accessionNo: accM[1], company: company.trim(), indexPath: filename });
  }

  console.log(`  Found ${filers.length} 13F-HR filers for ${y} QTR${q}`);
  return filers;
}

// ─── XML finding & parsing ────────────────────────────────────────────────────

async function findXmlUrl(cik, accNo, indexPath) {
  const noD = accNo.replace(/-/g, "");
  const indexUrl = `https://www.sec.gov/${indexPath.replace(/^\//, "")}`;
  const res = await get(indexUrl);
  if (res) {
    const html = await res.text();
    const paths = [];
    const re = /href="(\/Archives\/edgar\/data\/[^"]+\.xml)"/gi;
    let m;
    while ((m = re.exec(html)) !== null) paths.push(m[1]);
    if (paths.length) {
      const p = paths.find(x => /infotable|informationtable|13finfo/i.test(x)) ?? paths[paths.length - 1];
      return `https://www.sec.gov${p}`;
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
    const b = m[1];
    const cm = b.match(/<(?:\w+:)?cusip>([^<]+)<\/(?:\w+:)?cusip>/i);
    if (!cm || cm[1].replace(/[\s-]/g, "") !== cusip) continue;
    const sm = b.match(/<(?:\w+:)?sshPrnamt>(\d+)<\/(?:\w+:)?sshPrnamt>/i);
    const vm = b.match(/<(?:\w+:)?value>(\d+)<\/(?:\w+:)?value>/i);
    return { shares: sm ? parseInt(sm[1], 10) : null, value: vm ? parseInt(vm[1], 10) : null };
  }
  return null;
}

async function processFiler(filer, cusips) {
  try {
    const xmlUrl = await findXmlUrl(filer.cik, filer.accessionNo, filer.indexPath);
    if (!xmlUrl) return null;
    const res = await get(xmlUrl);
    if (!res) return null;
    const xml = await res.text();
    const positions = {};
    for (const [t, c] of Object.entries(cusips)) {
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
  if (cur > pri) return "Bought";
  if (cur < pri) return "Sold";
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
    const cur = curMap.get(cik) ?? null;
    const curSh = cur?.shares ?? null, priSh = priMap.get(cik) ?? null;
    const change = curSh != null && priSh != null ? curSh - priSh : null;
    const pctChange = change != null && priSh ? Math.round((change / priSh) * 1000) / 10 : null;
    holdings.push({
      filerName: nameMap.get(cik) ?? "Unknown",
      filerCik: cik, currentShares: curSh, priorShares: priSh,
      change, pctChange, currentValue: cur?.value ?? null,
      action: classifyAction(curSh, priSh),
    });
  }
  return holdings.sort((a, b) => (b.currentShares ?? -1) - (a.currentShares ?? -1));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== HEICO 13F Fetch ===");
  const { cur, pri } = getQuarters();
  console.log(`Current quarter: ${cur.label}   Prior quarter: ${pri.label}\n`);

  console.log("Step 1: Downloading quarterly filer lists from EDGAR...");
  const curFilers = await getQuarterFilers(cur.y, cur.q);
  await sleep(2000); // pause so EDGAR doesn't rate-limit the second request
  const priFilers = await getQuarterFilers(pri.y, pri.q);

  const total = curFilers.length + priFilers.length;
  console.log(`\nStep 2: Checking ${total} filers for HEICO positions (this takes 5-15 minutes)...`);

  const [curResults, priResults] = await Promise.all([
    batch(curFilers, f => processFiler(f, CUSIPS)),
    batch(priFilers, f => processFiler(f, CUSIPS)),
  ]);

  const found = [...curResults, ...priResults].filter(Boolean).length;
  console.log(`\nFound ${found} HEICO holder records. Building output...`);

  mkdirSync(join(ROOT, "data"), { recursive: true });

  for (const [ticker, cusip] of Object.entries(CUSIPS)) {
    const holdings = buildHoldings(ticker, curResults, priResults);
    const withPos = holdings.filter(h => h.currentShares != null).length;
    writeFileSync(
      join(ROOT, "data", `${ticker.toLowerCase()}.json`),
      JSON.stringify({ ticker, cusip, currentPeriod: cur.label, priorPeriod: pri.label,
                       lastUpdated: new Date().toISOString(), holdings }, null, 2)
    );
    console.log(`  ${ticker}: ${withPos} current holders, ${holdings.length} total`);
  }
  console.log("\nDone!");
}

main().catch(e => { console.error(e); process.exit(1); });
