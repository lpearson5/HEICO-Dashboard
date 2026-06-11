/**
 * Fetches HEICO institutional ownership from SEC EDGAR 13F-HR filings.
 * Must run from a residential/non-cloud IP — SEC blocks cloud servers.
 * Designed to run via GitHub Actions self-hosted runner on your local PC.
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const CUSIPS = { HEI: "422819102", HEIA: "422819201" };

const HEADERS = {
  "User-Agent": "HEICO-Dashboard lpearson5@users.noreply.github.com",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

const CONCURRENCY = 8;
const DELAY_MS = 120;

// ─── Quarter date ranges ──────────────────────────────────────────────────────

function getQuarterRanges() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  if (month >= 4 && month <= 6)
    return {
      current: { start: `${year}-04-01`, end: `${year}-05-31`, label: `Q1 ${year}` },
      prior:   { start: `${year}-01-01`, end: `${year}-02-28`, label: `Q4 ${year - 1}` },
    };
  if (month >= 7 && month <= 9)
    return {
      current: { start: `${year}-07-01`, end: `${year}-08-31`, label: `Q2 ${year}` },
      prior:   { start: `${year}-04-01`, end: `${year}-05-31`, label: `Q1 ${year}` },
    };
  if (month >= 10 && month <= 12)
    return {
      current: { start: `${year}-10-01`, end: `${year}-11-30`, label: `Q3 ${year}` },
      prior:   { start: `${year}-07-01`, end: `${year}-08-31`, label: `Q2 ${year}` },
    };
  return {
    current: { start: `${year}-01-01`, end: `${year}-02-28`, label: `Q4 ${year - 1}` },
    prior:   { start: `${year - 1}-10-01`, end: `${year - 1}-11-30`, label: `Q3 ${year - 1}` },
  };
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function get(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 429 || res.status === 503) { await sleep(2000 * attempt); continue; }
      if (!res.ok) { console.warn(`  [${res.status}] ${url.slice(0, 90)}`); return null; }
      return res;
    } catch (e) {
      if (attempt === 3) console.warn(`  [ERR] ${e.message.slice(0, 60)}`);
      await sleep(600 * attempt);
    }
  }
  return null;
}

async function batchProcess(items, fn, concurrency = CONCURRENCY) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...await Promise.all(batch.map(fn)));
    if (i + concurrency < items.length) await sleep(DELAY_MS);
    if (i % 200 === 0 && i > 0)
      console.log(`  … ${i}/${items.length} processed, ${results.filter(Boolean).length} holders found`);
  }
  return results;
}

// ─── EDGAR EFTS search ────────────────────────────────────────────────────────

async function eftsSearch(cusip, start, end) {
  const hits = [];
  let from = 0;
  const seen = new Set();

  while (true) {
    const url = `https://efts.sec.gov/LATEST/search-index?q=%22${cusip}%22&forms=13F-HR` +
                `&dateRange=custom&startdt=${start}&enddt=${end}&from=${from}&size=200`;
    const res = await get(url);
    if (!res) { console.warn("  EFTS returned no response — is this running on a cloud server?"); break; }

    const data = await res.json();
    const pageHits = data?.hits?.hits ?? [];
    const total = data?.hits?.total?.value ?? 0;

    for (const h of pageHits) {
      const acc = h._source?.accession_no;
      if (acc && !seen.has(acc)) { seen.add(acc); hits.push(h._source); }
    }

    from += 200;
    if (from >= total || pageHits.length === 0) break;
    await sleep(110);
  }

  console.log(`  EFTS [${start}→${end}]: ${hits.length} filings`);
  return hits;
}

// ─── Filing XML discovery ─────────────────────────────────────────────────────

function cikFromAcc(acc) { return parseInt(acc.split("-")[0], 10); }
function accNoDashes(acc) { return acc.replace(/-/g, ""); }

async function findInfoTableUrl(acc) {
  const cik = cikFromAcc(acc);
  const noD = accNoDashes(acc);
  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${noD}/${acc}-index.htm`;

  const res = await get(indexUrl);
  if (res) {
    const html = await res.text();
    const paths = [];
    const re = /href="(\/Archives\/edgar\/data\/[^"]+\.xml)"/gi;
    let m;
    while ((m = re.exec(html)) !== null) paths.push(m[1]);
    if (paths.length > 0) {
      const p = paths.find((x) => /infotable|informationtable|13finfo/i.test(x)) ?? paths[paths.length - 1];
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

// ─── XML parsing ──────────────────────────────────────────────────────────────

function parseInfoTable(xml, cusip) {
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

async function processHit(hit, cusip) {
  try {
    const xmlUrl = await findInfoTableUrl(hit.accession_no);
    if (!xmlUrl) return null;
    const res = await get(xmlUrl);
    if (!res) return null;
    const xml = await res.text();
    const pos = parseInfoTable(xml, cusip);
    if (!pos) return null;
    return { cik: String(cikFromAcc(hit.accession_no)), name: hit.entity_name ?? "Unknown", ...pos };
  } catch { return null; }
}

// ─── Holdings builder ─────────────────────────────────────────────────────────

function classifyAction(cur, prior) {
  if (cur == null && prior != null) return "Sell Out";
  if (cur != null && prior == null) return "New Position";
  if (cur == null) return "No Change";
  if (cur > prior) return "Bought";
  if (cur < prior) return "Sold";
  return "No Change";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== HEICO 13F Fetch ===");
  const { current, prior } = getQuarterRanges();
  console.log(`Current: ${current.label}  Prior: ${prior.label}\n`);

  mkdirSync(join(ROOT, "data"), { recursive: true });

  for (const [ticker, cusip] of Object.entries(CUSIPS)) {
    console.log(`\n--- ${ticker} (CUSIP ${cusip}) ---`);

    const [curHits, priHits] = await Promise.all([
      eftsSearch(cusip, current.start, current.end),
      eftsSearch(cusip, prior.start,   prior.end),
    ]);

    console.log(`  Processing ${curHits.length} current + ${priHits.length} prior filings…`);

    const [curResults, priResults] = await Promise.all([
      batchProcess(curHits, (h) => processHit(h, cusip)),
      batchProcess(priHits, (h) => processHit(h, cusip)),
    ]);

    const curMap = new Map(), priMap = new Map(), nameMap = new Map();
    for (const r of curResults) {
      if (!r) continue;
      curMap.set(r.cik, { shares: r.shares, value: r.value });
      nameMap.set(r.cik, r.name);
    }
    for (const r of priResults) {
      if (!r) continue;
      if (r.shares != null) priMap.set(r.cik, r.shares);
      if (!nameMap.has(r.cik)) nameMap.set(r.cik, r.name);
    }

    const allCiks = new Set([...curMap.keys(), ...priMap.keys()]);
    const holdings = [];

    for (const cik of allCiks) {
      const cur = curMap.get(cik) ?? null;
      const curSh = cur?.shares ?? null, priSh = priMap.get(cik) ?? null;
      const change = curSh != null && priSh != null ? curSh - priSh : null;
      const pctChange = change != null && priSh ? Math.round((change / priSh) * 1000) / 10 : null;
      holdings.push({
        filerName: nameMap.get(cik) ?? "Unknown",
        filerCik: cik,
        currentShares: curSh,
        priorShares: priSh,
        change, pctChange,
        currentValue: cur?.value ?? null,
        action: classifyAction(curSh, priSh),
      });
    }

    holdings.sort((a, b) => (b.currentShares ?? -1) - (a.currentShares ?? -1));

    const out = { ticker, cusip, currentPeriod: current.label, priorPeriod: prior.label,
                  lastUpdated: new Date().toISOString(), holdings };
    const path = join(ROOT, "data", `${ticker.toLowerCase()}.json`);
    writeFileSync(path, JSON.stringify(out, null, 2));
    console.log(`  ✓ ${ticker}: ${holdings.filter(h => h.currentShares).length} current holders → ${path}`);
  }

  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
