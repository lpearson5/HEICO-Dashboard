/**
 * Fetches HEICO institutional ownership from SEC EDGAR 13F-HR filings.
 *
 * Strategy (works from networks where www.sec.gov is throttled/flaky):
 *  1. Use EDGAR full-text search (efts.sec.gov) to find EVERY 13F-HR that
 *     mentions a HEICO CUSIP. This is ~a dozen reliable API calls and returns
 *     the exact accession + info-table document for each holder — no scraping
 *     of 17,000 archive files.
 *  2. Determine current/prior holdings quarters DATA-DRIVEN from the filings
 *     themselves (the most-populated recent period = "current", the quarter
 *     before = "prior"). No hard-coded quarter math — auto-adapts every week.
 *  3. Fetch each holder's info-table XML from www.sec.gov with long timeouts +
 *     retries (only ~hundreds of files, all known URLs).
 *  4. Cache parsed filings by accession number (filings are immutable), so
 *     weekly reruns only fetch newly-filed holders.
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, "..");
const DATA_DIR  = join(ROOT, "data");

// Email an alert when a filer's quarter-over-quarter move is this large or more.
const ALERT_THRESHOLD = 1_000_000;
const ALERTS_PATH = join(DATA_DIR, "alerts-sent.json");   // de-dupe state (committed)
const ALERT_MSG_PATH = join(ROOT, "new-alerts.txt");      // summary for the commit message (not committed)

// "New this week" = current-quarter 13F filed within this many days.
const NEW_WINDOW_DAYS = 7;

// HEICO Corp CUSIPs, confirmed from filings (nameOfIssuer "HEICO CORP NEW"):
//   HEI  = Common  422806109
//   HEIA = Class A 422806208
// NB: 422819102 is Heidrick & Struggles — do NOT use it for HEICO.
const CUSIPS = { HEI: "422806109", HEIA: "422806208" };

const HEADERS = {
  "User-Agent":      "HEICO-Dashboard/1.0 lpearson@heico.com",
  "Accept-Encoding": "identity",
  "Accept":          "*/*",
};

const CACHE_PATH = join(DATA_DIR, "scan-cache.json");

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── HTTP with retries (beats intermittent www.sec.gov timeouts) ───────────────

async function getRetry(url, { json = false, tries = 5 } = {}) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
      if (res.status === 429 || res.status === 503) { await sleep(5000 * i); continue; }
      if (!res.ok) return null;
      const text = await res.text();
      return json ? JSON.parse(text) : text;
    } catch {
      if (i < tries) await sleep(2500 * i);
    }
  }
  return null;
}

// ─── Cache ─────────────────────────────────────────────────────────────────────
// Bump CACHE_VERSION whenever parseInfoTable logic changes, so stale parsed
// results are discarded and filings are re-parsed on the next run.
const CACHE_VERSION = 2;

function loadCache() {
  if (!existsSync(CACHE_PATH)) return { _version: CACHE_VERSION };
  try {
    const c = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
    if (c._version !== CACHE_VERSION) return { _version: CACHE_VERSION };
    return c;
  } catch { return { _version: CACHE_VERSION }; }
}
function saveCache(c) {
  c._version = CACHE_VERSION;
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(c, null, 2));
}

// ─── Full-text search ────────────────────────────────────────────────────────

function ymd(d) { return d.toISOString().slice(0, 10); }

// Return all 13F-HR filings (last ~14 months) mentioning a CUSIP.
async function searchCusip(cusip) {
  const end   = new Date();
  const start = new Date(end.getTime() - 430 * 24 * 3600 * 1000);
  const hits  = [];
  let from = 0, total = null;
  while (true) {
    const url = `https://efts.sec.gov/LATEST/search-index?q=%22${cusip}%22&forms=13F-HR`
      + `&dateRange=custom&startdt=${ymd(start)}&enddt=${ymd(end)}&from=${from}`;
    const j = await getRetry(url, { json: true });
    if (!j) { await sleep(3000); continue; }
    if (total === null) total = j.hits?.total?.value ?? 0;
    const page = j.hits?.hits ?? [];
    if (!page.length) break;
    for (const h of page) {
      const s   = h._source ?? {};
      const doc = String(h._id).split(":")[1];
      hits.push({
        accession: s.adsh,
        cik:       (s.ciks?.[0] ?? "").replace(/^0+/, "") || "0",
        name:      (s.display_names?.[0] ?? "Unknown").replace(/\s*\(CIK.*$/i, "").trim(),
        period:    s.period_ending,
        fileDate:  s.file_date,
        doc,
      });
    }
    from += page.length;
    if (from >= total || from >= 9900) break;
    await sleep(1200);
  }
  return hits;
}

// ─── Quarter selection (calendar-based, matches Vickers) ────────────────────────

function priorQuarterEnd(periodEnd) {
  // periodEnd like "2025-09-30" -> previous quarter end
  const [y, m] = periodEnd.split("-").map(Number);
  if (m === 3)  return `${y - 1}-12-31`;
  if (m === 6)  return `${y}-03-31`;
  if (m === 9)  return `${y}-06-30`;
  return `${y}-09-30`; // m === 12
}

// The most recent calendar quarter that has already ended as of `today`.
function mostRecentQuarterEnd(today) {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1; // 1-12
  if (m <= 3)  return `${y - 1}-12-31`;
  if (m <= 6)  return `${y}-03-31`;
  if (m <= 9)  return `${y}-06-30`;
  return `${y}-09-30`;
}

// Current = the most recent ended quarter (the one filers are actively reporting,
// even if only partially filed) — this is how Vickers presents the data. Falls
// back a quarter only if the newest one has no filings yet (very start of a season).
function pickPeriods(allHits, today) {
  const counts = {};
  for (const h of allHits) if (h.period) counts[h.period] = (counts[h.period] || 0) + 1;
  let current = mostRecentQuarterEnd(today);
  for (let i = 0; i < 4 && !(counts[current] > 0); i++) current = priorQuarterEnd(current);
  return { current, prior: priorQuarterEnd(current), counts };
}

// ─── Info-table parsing ─────────────────────────────────────────────────────────

function parseInfoTable(xml) {
  const out = {};
  const re  = /<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b  = m[1];
    const cm = b.match(/<(?:\w+:)?cusip>([^<]+)</i);
    if (!cm) continue;
    const cusip = cm[1].replace(/[\s-]/g, "");
    const ticker = Object.keys(CUSIPS).find(t => CUSIPS[t] === cusip);
    if (!ticker) continue;
    // Exclude option positions (PUT/CALL): they list contracts under the same
    // CUSIP and would inflate the share count. Count actual shares only.
    const pc = (b.match(/<(?:\w+:)?putCall>([^<]+)</i)?.[1] ?? "").trim().toUpperCase();
    if (pc === "PUT" || pc === "CALL") continue;
    const sm = b.match(/<(?:\w+:)?sshPrnamt>(\d+)</i);
    const vm = b.match(/<(?:\w+:)?value>(\d+)</i);
    const shares = sm ? parseInt(sm[1], 10) : 0;
    const value  = vm ? parseInt(vm[1], 10) : 0;
    // A filing can list a CUSIP across multiple rows (share classes/lots) — sum them.
    out[ticker] = {
      shares: (out[ticker]?.shares ?? 0) + shares,
      value:  (out[ticker]?.value  ?? 0) + value,
    };
  }
  return out;
}

async function fetchFiling(h, cache) {
  // Reuse cache only for successful fetches; retry past failures (filings are
  // immutable, so a success never needs re-fetching).
  const cached = cache[h.accession];
  if (cached && cached.ok) return cached;
  const noD = h.accession.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${h.cik}/${noD}/${h.doc}`;
  const xml = await getRetry(url);
  const positions = xml ? parseInfoTable(xml) : {};
  const rec = { cik: h.cik, name: h.name, period: h.period, positions, ok: !!xml };
  if (rec.ok) cache[h.accession] = rec;   // don't persist failures
  return rec;
}

// ─── Holdings builder ─────────────────────────────────────────────────────────

function classify(cur, pri, filedCurrent) {
  // No current position but held last quarter: distinguish a real exit (they
  // filed this quarter and dropped HEICO) from a filer who simply hasn't filed yet.
  if (cur == null && pri != null) return filedCurrent ? "Sell Out" : "Not Filed Yet";
  if (cur != null && pri == null) return "New Position";
  if (cur == null) return "No Change";
  if (cur > pri) return "Bought";
  if (cur < pri) return "Sold";
  return "No Change";
}

function buildHoldings(ticker, curByCik, priByCik, nameByCik, filedSet) {
  const holdings = [];
  for (const cik of new Set([...curByCik.keys(), ...priByCik.keys()])) {
    const curSh = curByCik.get(cik)?.shares ?? null;
    const priSh = priByCik.get(cik)?.shares ?? null;
    const change    = curSh != null && priSh != null ? curSh - priSh : null;
    const pctChange = change != null && priSh ? Math.round(change / priSh * 1000) / 10 : null;
    holdings.push({
      filerName:     nameByCik.get(cik) ?? "Unknown",
      filerCik:      cik,
      currentShares: curSh,
      priorShares:   priSh,
      change, pctChange,
      currentValue:  curByCik.get(cik)?.value ?? null,
      action:        classify(curSh, priSh, filedSet.has(cik)),
    });
  }
  return holdings.sort((a, b) => (b.currentShares ?? -1) - (a.currentShares ?? -1));
}

// Mark holders whose current-quarter 13F was filed within the last NEW_WINDOW_DAYS
// as "new this week" — the same definition Vickers uses ("filed during the past week").
function annotateNewThisWeek(holdings, fileDateByCik, today) {
  const daysSince = d => (today.getTime() - Date.parse(d)) / 86_400_000;
  for (const h of holdings) {
    const fd = fileDateByCik.get(h.filerCik) ?? null;
    h.firstSeen = fd;  // date their current-quarter 13F was filed
    h.newThisWeek = h.currentShares != null && fd != null && daysSince(fd) <= NEW_WINDOW_DAYS;
  }
}

// Size and direction of a holding's quarter-over-quarter move, for alerting.
function moveOf(h) {
  if (h.action === "Bought")       return { size: h.change,        dir: "increased" };
  if (h.action === "Sold")         return { size: -h.change,       dir: "decreased" };
  if (h.action === "New Position") return { size: h.currentShares, dir: "new position" };
  if (h.action === "Sell Out")     return { size: h.priorShares,   dir: "exited" };
  return null; // No Change / Not Filed Yet → not a confirmed move
}

// Has this filer submitted any 13F-HR for the given holdings period yet?
// Cached as true once filed (immutable); pending results are not cached so
// they get re-checked next run.
async function hasFiledCurrent(cik, period, cache) {
  if (!cache._filed) cache._filed = {};
  const key = `${cik}|${period}`;
  if (cache._filed[key]) return true;
  const sub = await getRetry(
    `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`,
    { json: true }
  );
  const f = sub?.filings?.recent;
  if (!f) return false;
  let filed = false;
  for (let i = 0; i < f.form.length; i++) {
    if (f.form[i].startsWith("13F-HR") && f.reportDate[i] === period) { filed = true; break; }
  }
  if (filed) cache._filed[key] = true;
  return filed;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== HEICO 13F Fetch (full-text search) ===");
  mkdirSync(DATA_DIR, { recursive: true });
  const cache = loadCache();

  // 1. Find every HEICO 13F filing via full-text search.
  console.log("Searching EDGAR full-text index…");
  const hitsByCusip = {};
  const allHits = [];
  for (const [ticker, cusip] of Object.entries(CUSIPS)) {
    const hits = await searchCusip(cusip);
    hitsByCusip[ticker] = hits;
    allHits.push(...hits);
    console.log(`  ${ticker} (${cusip}): ${hits.length} filings found`);
    await sleep(1500);
  }

  // 2. Pick current/prior holdings periods: current = most recent ended quarter.
  const today = new Date();
  const { current, prior, counts } = pickPeriods(allHits, today);
  console.log(`\nHoldings periods: current=${current}  prior=${prior}`);
  console.log(`  filing counts by period: ${JSON.stringify(counts)}`);

  // 3. Collect the relevant filings (dedupe per cik+period, latest filing wins).
  const nameByCik = new Map();
  const want = new Map(); // key `${cik}|${period}` -> hit
  for (const h of allHits) {
    if (h.period !== current && h.period !== prior) continue;
    if (!h.accession || !h.doc) continue;
    nameByCik.set(h.cik, h.name);
    const key = `${h.cik}|${h.period}`;
    const prev = want.get(key);
    if (!prev || (h.fileDate ?? "") > (prev.fileDate ?? "")) want.set(key, h);
  }
  const filings = [...want.values()];
  const toFetch = filings.filter(h => !cache[h.accession]);
  console.log(`\nRelevant filings: ${filings.length} (${toFetch.length} new, ${filings.length - toFetch.length} cached)`);

  // 4. Fetch each info table from www.sec.gov (with retries), checkpointing.
  let done = 0, failed = 0;
  for (const h of filings) {
    const rec = await fetchFiling(h, cache);
    done++;
    if (!rec.ok && !cache[h.accession]?.ok) failed++;
    if (done % 25 === 0) { saveCache(cache); console.log(`  fetched ${done}/${filings.length} (${failed} failed)`); }
    if (!cache[h.accession] || cache[h.accession]?.justFetched) await sleep(400);
  }
  saveCache(cache);

  // 4b. Determine which filers have submitted a current-period 13F yet.
  // Anyone with a current-period HEICO filing obviously filed; for the rest
  // (held last quarter, no current HEICO position) check their submissions.
  const filedSet = new Set(filings.filter(h => h.period === current).map(h => h.cik));
  const priorOnly = [...new Set(
    filings.filter(h => h.period === prior && !filedSet.has(h.cik)).map(h => h.cik)
  )];
  console.log(`\nChecking filing status of ${priorOnly.length} prior-only filers…`);
  let pc = 0;
  for (const cik of priorOnly) {
    if (await hasFiledCurrent(cik, current, cache)) filedSet.add(cik);
    if (++pc % 25 === 0) { saveCache(cache); console.log(`  filing status ${pc}/${priorOnly.length}`); }
    await sleep(150);
  }
  saveCache(cache);

  // 5. Build per-period maps and write output (collecting large movers).
  // Filing date of each filer's current-quarter 13F (for "new this week").
  const curFileDateByCik = new Map();
  for (const h of filings) if (h.period === current) curFileDateByCik.set(h.cik, h.fileDate);

  const bigMovers = [];
  for (const ticker of Object.keys(CUSIPS)) {
    const curByCik = new Map(), priByCik = new Map();
    for (const h of filings) {
      const rec = cache[h.accession];
      const pos = rec?.positions?.[ticker];
      if (!pos) continue;
      if (h.period === current) curByCik.set(h.cik, pos);
      else if (h.period === prior) priByCik.set(h.cik, pos);
    }
    const holdings = buildHoldings(ticker, curByCik, priByCik, nameByCik, filedSet);
    annotateNewThisWeek(holdings, curFileDateByCik, today);
    const withPos  = holdings.filter(x => x.currentShares != null).length;
    const newCount = holdings.filter(x => x.newThisWeek).length;
    writeFileSync(join(DATA_DIR, `${ticker.toLowerCase()}.json`), JSON.stringify({
      ticker, cusip: CUSIPS[ticker],
      currentPeriod: current, priorPeriod: prior,
      lastUpdated: today.toISOString(),
      holdings,
    }, null, 2));
    console.log(`  ${ticker}: ${withPos} current holders, ${holdings.length} total records, ${newCount} new this week`);

    for (const h of holdings) {
      const mv = moveOf(h);
      if (mv && mv.size >= ALERT_THRESHOLD) {
        bigMovers.push({ ticker, cik: h.filerCik, name: h.filerName, size: mv.size, dir: mv.dir });
      }
    }
  }

  // 6. Large-move alerts: email only NEW movers (de-duped). On the very first
  // run there is no state file, so we baseline all current movers silently.
  const seeding = !existsSync(ALERTS_PATH);
  const alerts = seeding ? { sent: {} } : (() => {
    try { return JSON.parse(readFileSync(ALERTS_PATH, "utf8")); } catch { return { sent: {} }; }
  })();
  if (!alerts.sent) alerts.sent = {};

  const tName = t => (t === "HEIA" ? "HEI/A" : "HEI");
  const newMovers = [];
  for (const m of bigMovers) {
    const key = `${m.ticker}|${m.cik}|${current}|${m.dir}`;
    if (!alerts.sent[key]) {
      alerts.sent[key] = { name: m.name, size: m.size, period: current };
      if (!seeding) newMovers.push(m);
    }
  }
  writeFileSync(ALERTS_PATH, JSON.stringify(alerts, null, 2));

  if (newMovers.length) {
    const parts = newMovers
      .sort((a, b) => b.size - a.size)
      .map(m => `${m.name} ${m.dir} ${tName(m.ticker)} by ${m.size.toLocaleString("en-US")}`);
    const shown = parts.slice(0, 6).join("; ");
    const extra = parts.length > 6 ? ` (+${parts.length - 6} more)` : "";
    writeFileSync(ALERT_MSG_PATH, `${newMovers.length} large HEICO 13F move(s): ${shown}${extra}`);
    console.log(`\n⚑ ${newMovers.length} NEW large move(s) — alert queued.`);
  } else {
    writeFileSync(ALERT_MSG_PATH, "");   // empty => no alert this run
    console.log(seeding
      ? `\nBaselined ${bigMovers.length} existing large holders (no alerts on first run).`
      : `\nNo new large moves.`);
  }

  console.log("\nDone!");
}

main().catch(e => { console.error(e); process.exit(1); });
