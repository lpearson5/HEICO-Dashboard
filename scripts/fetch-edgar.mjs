/**
 * Fetches HEICO institutional ownership from SEC EDGAR 13F-HR filings.
 *
 * Strategy: Use EDGAR full-text search (EFTS) to find only the ~500 filings
 * that actually mention HEICO's CUSIPs, rather than checking all 12,000+ filers.
 * Falls back to the full index scan if EFTS is unavailable.
 *
 * Runs on a self-hosted runner (your PC) so www.sec.gov is not blocked.
 */

// Corporate SSL inspection proxies re-sign certs with a company CA that
// Node.js doesn't trust by default.
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
  if (m >= 4 && m <= 6)   return { cur: { y, q: 1, label: `Q1 ${y}`,      start: `${y}-01-01`,     end: `${y}-03-31`     }, pri: { y: y-1, q: 4, label: `Q4 ${y-1}`, start: `${y-1}-10-01`, end: `${y-1}-12-31` } };
  if (m >= 7 && m <= 9)   return { cur: { y, q: 2, label: `Q2 ${y}`,      start: `${y}-04-01`,     end: `${y}-06-30`     }, pri: { y,     q: 1, label: `Q1 ${y}`,   start: `${y}-01-01`,   end: `${y}-03-31`   } };
  if (m >= 10 && m <= 12) return { cur: { y, q: 3, label: `Q3 ${y}`,      start: `${y}-07-01`,     end: `${y}-09-30`     }, pri: { y,     q: 2, label: `Q2 ${y}`,   start: `${y}-04-01`,   end: `${y}-06-30`   } };
  return                          { cur: { y: y-1, q: 4, label: `Q4 ${y-1}`, start: `${y-1}-10-01`, end: `${y-1}-12-31` }, pri: { y: y-1, q: 3, label: `Q3 ${y-1}`, start: `${y-1}-07-01`, end: `${y-1}-09-30` } };
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
    if (i + concurrency < items.length) await sleep(200);
    if (i > 0 && i % 100 === 0) {
      console.log(`    … ${i}/${items.length} processed`);
    }
  }
  return out;
}

// ─── Strategy 1: EFTS full-text search ───────────────────────────────────────

async function eftsSearch(cusip, startdt, enddt) {
  const allHits = [];
  let from = 0;
  const size = 100;

  while (true) {
    const url = `https://efts.sec.gov/LATEST/search-index?q=%22${cusip}%22&forms=13F-HR&dateRange=custom&startdt=${startdt}&enddt=${enddt}&from=${from}&size=${size}`;
    const res = await get(url);
    if (!res) return null;

    const json = await res.json();
    const hits = json.hits?.hits ?? [];
    allHits.push(...hits);

    const total = json.hits?.total?.value ?? 0;
    if (allHits.length >= total || hits.length === 0) break;
    from += size;
    await sleep(300);
  }

  return allHits.map(h => {
    const s = h._source ?? {};
    const accNo = (h._id ?? s.accession_no ?? "").replace(/\./g, "-");
    const cik = String(s.entity_id ?? "").replace(/^0+/, "") || "0";
    return { cik, accessionNo: accNo, company: s.entity_name ?? "Unknown" };
  }).filter(f => f.accessionNo);
}

// ─── Strategy 2: Full index scan (fallback) ───────────────────────────────────

async function getQuarterFilers(y, q) {
  const url = `https://www.sec.gov/Archives/edgar/full-index/${y}/QTR${q}/company.idx`;
  console.log(`  Downloading index: ${url}`);
  const res = await get(url);
  if (!res) throw new Error(`Cannot download quarterly index for ${y} QTR${q}.`);

  const text = await res.text();
  const filers = [];
  const seen = new Set();

  for (const line of text.split("\n")) {
    if (!line.includes("13F-HR")) continue;
    const m = line.match(/^(.+?)\s{2,}(13F-HR\S*)\s+(\d+)\s+\S+\s+(edgar\/\S+)/);
    if (!m) continue;
    const [, company, , cikRaw, filename] = m;
    const accM = filename.match(/(\d{10}-\d{2}-\d{6})/);
    if (!accM) continue;
    if (seen.has(accM[1])) continue;
    seen.add(accM[1]);
    filers.push({ cik: cikRaw.replace(/^0+/, "") || "0", accessionNo: accM[1], company: company.trim() });
  }

  console.log(`  Found ${filers.length} 13F-HR filers for ${y} QTR${q}`);
  return filers;
}

// ─── XML parsing ─────────────────────────────────────────────────────────────

async function getXmlUrl(filer) {
  const { cik, accessionNo } = filer;
  const noD = accessionNo.replace(/-/g, "");

  // The index page is always at /Archives/edgar/data/{CIK}/{noD}/{accNo}-index.htm
  const indexRes = await get(`https://www.sec.gov/Archives/edgar/data/${cik}/${noD}/${accessionNo}-index.htm`);
  if (indexRes) {
    const html = await indexRes.text();
    const re = /href="(\/Archives\/edgar\/data\/[^"]+\.xml)"/gi;
    let m;
    const candidates = [];
    while ((m = re.exec(html)) !== null) candidates.push(m[1]);
    if (candidates.length) {
      const p = candidates.find(x => /infotable|informationtable|13finfo/i.test(x)) ?? candidates[candidates.length - 1];
      return `https://www.sec.gov${p}`;
    }
  }

  // Fallback: try common XML filenames directly
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
    const xmlUrl = await getXmlUrl(filer);
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

async function getFilers(quarter, label) {
  console.log(`  Trying EFTS search for ${label}...`);
  const results = [];
  for (const [ticker, cusip] of Object.entries(CUSIPS)) {
    const hits = await eftsSearch(cusip, quarter.start, quarter.end);
    if (hits === null) {
      console.log(`  EFTS unavailable, falling back to full index scan for ${label}...`);
      return getQuarterFilers(quarter.y, quarter.q);
    }
    console.log(`  EFTS: ${hits.length} filers hold ${ticker} in ${label}`);
    results.push(...hits);
  }
  const seen = new Set();
  return results.filter(f => {
    if (seen.has(f.accessionNo)) return false;
    seen.add(f.accessionNo);
    return true;
  });
}

async function main() {
  console.log("=== HEICO 13F Fetch ===");
  const { cur, pri } = getQuarters();
  console.log(`Current quarter: ${cur.label}   Prior quarter: ${pri.label}\n`);

  console.log("Step 1: Finding filers with HEICO positions...");
  const curFilers = await getFilers(cur, cur.label);
  await sleep(1000);
  const priFilers = await getFilers(pri, pri.label);

  const total = curFilers.length + priFilers.length;
  console.log(`\nStep 2: Downloading and parsing ${total} filings...`);

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
