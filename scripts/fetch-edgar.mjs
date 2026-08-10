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

// HEICO shares outstanding by class, for "% of shares outstanding".
// These are FALLBACK defaults; each run fetches the live counts from HEICO's
// latest 10-Q/10-K cover (see getSharesOutstanding) and overrides these.
const SHARES_OUTSTANDING = { HEI: 55_148_527, HEIA: 84_369_872 };

// Monthly snapshot shows this many quarters of history (current + 3 prior).
const MONTHLY_QUARTERS = 4;

// Mutual-fund (N-PORT) settings.
const NPORT_CACHE_PATH = join(DATA_DIR, "nport-cache.json"); // parsed N-PORT filings (committed)
const NPORT_WINDOW_DAYS = 400;   // look-back for fund filings (captures current + a prior report)
const NPORT_STALE_DAYS  = 210;   // a fund is a "current" holder if its latest HEICO report is within this

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
const CACHE_VERSION = 4;   // bump: attribute-tolerant infoTable parsing (xmlns on <infoTable>); store fileDate

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

// Return all 13F-HR filings mentioning a CUSIP within the look-back window.
// (Narrow the window for very widely-held peers so results stay under the 10k cap.)
async function searchCusip(cusip, windowDays = 430) {
  const end   = new Date();
  const start = new Date(end.getTime() - windowDays * 24 * 3600 * 1000);
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

// The most recent quarter whose 13F filing deadline (quarter-end + 45 days) has
// passed — i.e. the latest "settled" quarter. Used for the monthly snapshot.
function mostRecentCompleteQuarterEnd(today) {
  let qe = mostRecentQuarterEnd(today);
  const deadlinePassed = qeStr => {
    const d = new Date(`${qeStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 45);
    return d.getTime() <= today.getTime();
  };
  for (let i = 0; i < 4 && !deadlinePassed(qe); i++) qe = priorQuarterEnd(qe);
  return qe;
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
  // Attribute-tolerant tags: some filers put an xmlns (or other attributes) on
  // <infoTable> and inner elements, and some wrap text in CDATA. Match either.
  const re  = /<(?:\w+:)?infoTable(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi;
  const tag = (b, name) => {
    const m2 = b.match(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>\\s*(?:<!\\[CDATA\\[)?\\s*([^<\\]]*?)\\s*(?:\\]\\]>)?\\s*<`, "i"));
    return m2 ? m2[1] : null;
  };
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b  = m[1];
    const cmRaw = tag(b, "cusip");
    if (cmRaw == null) continue;
    const cusip = cmRaw.replace(/[\s-]/g, "");
    const ticker = Object.keys(CUSIPS).find(t => CUSIPS[t] === cusip);
    if (!ticker) continue;
    // Exclude option positions (PUT/CALL): they list contracts under the same
    // CUSIP and would inflate the share count. Count actual shares only.
    const pc = (tag(b, "putCall") ?? "").trim().toUpperCase();
    if (pc === "PUT" || pc === "CALL") continue;
    const shares = parseInt((tag(b, "sshPrnamt") ?? "0").replace(/,/g, ""), 10) || 0;
    const value  = parseInt((tag(b, "value")     ?? "0").replace(/,/g, ""), 10) || 0;
    // Investment discretion (SOLE/DFND/OTR) and voting authority (Sole/Shared/None).
    const disc = (tag(b, "investmentDiscretion") ?? "").trim().toUpperCase();
    const voteSole   = parseInt((tag(b, "Sole")   ?? "0").replace(/,/g, ""), 10) || 0;
    const voteShared = parseInt((tag(b, "Shared") ?? "0").replace(/,/g, ""), 10) || 0;
    const voteNone   = parseInt((tag(b, "None")   ?? "0").replace(/,/g, ""), 10) || 0;
    // A filing can list a CUSIP across multiple rows (share classes/lots) — sum them.
    const prev = out[ticker];
    out[ticker] = {
      shares:     (prev?.shares ?? 0) + shares,
      value:      (prev?.value  ?? 0) + value,
      discretion: prev?.discretion || disc,        // first non-empty
      voteSole:   (prev?.voteSole   ?? 0) + voteSole,
      voteShared: (prev?.voteShared ?? 0) + voteShared,
      voteNone:   (prev?.voteNone   ?? 0) + voteNone,
    };
  }
  return out;
}

async function fetchFiling(h, cache) {
  // Reuse cache only for successful fetches; retry past failures (filings are
  // immutable, so a success never needs re-fetching).
  const cached = cache[h.accession];
  if (cached && cached.ok) {
    // Backfill fields on older cache records so the durability union (below) can
    // dedupe by filing date even for filings first seen before this was tracked.
    if (cached.fileDate == null && h.fileDate) cached.fileDate = h.fileDate;
    if (cached.name == null && h.name) cached.name = h.name;
    return cached;
  }
  const noD = h.accession.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${h.cik}/${noD}/${h.doc}`;
  const xml = await getRetry(url);
  const positions = xml ? parseInfoTable(xml) : {};
  const rec = { cik: h.cik, name: h.name, period: h.period, fileDate: h.fileDate ?? null, positions, ok: !!xml };
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

// Live shares outstanding by class, parsed from HEICO's latest 10-Q/10-K cover.
// Falls back to SHARES_OUTSTANDING defaults if the fetch/parse fails.
async function getSharesOutstanding() {
  try {
    const sub = await getRetry("https://data.sec.gov/submissions/CIK0000046619.json", { json: true });
    const f = sub?.filings?.recent;
    if (!f) return {};
    let acc, doc;
    for (let i = 0; i < f.form.length; i++) {
      if (f.form[i] === "10-Q" || f.form[i] === "10-K") { acc = f.accessionNumber[i]; doc = f.primaryDocument[i]; break; }
    }
    if (!acc) return {};
    const html = await getRetry(`https://www.sec.gov/Archives/edgar/data/46619/${acc.replace(/-/g, "")}/${doc}`);
    if (!html) return {};
    const txt = html.replace(/<[^>]+>/g, " ").replace(/&#160;|&nbsp;/g, " ").replace(/\s+/g, " ");
    const out = {};
    for (const m of txt.matchAll(/(Class A )?Common Stock[\s\S]{0,40}?par value\s+([\d,]{6,})\s*shares/gi)) {
      const n = parseInt(m[2].replace(/,/g, ""), 10);
      if (m[1]) out.HEIA = n; else out.HEI = n;
    }
    return out;
  } catch { return {}; }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== HEICO 13F Fetch (full-text search) ===");
  mkdirSync(DATA_DIR, { recursive: true });
  const cache = loadCache();

  // Live shares outstanding (for "% of shares outstanding" everywhere).
  const liveShares = await getSharesOutstanding();
  if (liveShares.HEI)  SHARES_OUTSTANDING.HEI  = liveShares.HEI;
  if (liveShares.HEIA) SHARES_OUTSTANDING.HEIA = liveShares.HEIA;
  console.log(`Shares outstanding: HEI ${SHARES_OUTSTANDING.HEI.toLocaleString()}, HEI.A ${SHARES_OUTSTANDING.HEIA.toLocaleString()}${liveShares.HEI ? " (live)" : " (fallback)"}`);

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
  const consider = (h) => {
    if (h.period !== current && h.period !== prior) return;
    if (!h.accession) return;
    if (h.name) nameByCik.set(h.cik, h.name);
    const key = `${h.cik}|${h.period}`;
    const prev = want.get(key);
    if (!prev || (h.fileDate ?? "") > (prev.fileDate ?? "")) want.set(key, h);
  };
  for (const h of allHits) if (h.doc) consider(h);
  // Durability: EDGAR's full-text index is eventually-consistent and intermittently
  // omits filings we've already discovered — without this, a real holder silently
  // vanishes from the dashboard on any day the search happens to drop them. The
  // scan-cache is our durable record of every filing ever seen, so fold it in.
  // (latest filing per cik+period still wins, so amendments and refilings apply.)
  for (const [accession, rec] of Object.entries(cache)) {
    if (accession.startsWith("_") || !rec || !rec.ok) continue;
    consider({ accession, cik: rec.cik, name: rec.name, period: rec.period,
               fileDate: rec.fileDate ?? "", doc: null });
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
      // A filing that lists the CUSIP with 0 shares is not a holder (Vickers omits
      // these too) — skip so they don't surface as phantom "New Position" rows.
      if (!pos || !(pos.shares > 0)) continue;
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

  // 7. Monthly snapshot (Phase 1: 13F, 4-quarter history). Uses the most
  //    complete quarter as "current" (a settled view), unlike the weekly page.
  await buildMonthly(allHits, counts, cache, today);

  // 8. Mutual-fund holders (Phase 2: N-PORT).
  await buildFunds(today);

  // 9. §11 beneficial-ownership filings (13G/13D/14D).
  await buildBeneficialOwners(today);

  // 10. §12/§13 peer reports.
  await buildPeerReports(today);

  console.log("\nDone!");
}

// ─── Monthly snapshot builder ───────────────────────────────────────────────────

function monthlyAction(cur, prev) {
  if (cur == null && prev != null) return "Sellout";
  if (cur != null && prev == null) return "New";
  if (cur == null) return "No Change";
  if (cur > prev) return "Bought";
  if (cur < prev) return "Sold";
  return "No Change";
}

async function buildMonthly(allHits, counts, cache, today) {
  // Current = most recent quarter whose filing deadline has passed. Then 3 prior.
  const monthlyCurrent = mostRecentCompleteQuarterEnd(today);
  const quarters = [monthlyCurrent];
  for (let i = 1; i < MONTHLY_QUARTERS; i++) quarters.push(priorQuarterEnd(quarters[i - 1]));
  console.log(`\nMonthly snapshot quarters: ${quarters.join(", ")}`);

  // Latest filing per (cik, period) across the 4 quarters.
  const want = new Map(), nameByCik = new Map();
  for (const h of allHits) {
    if (!quarters.includes(h.period) || !h.accession || !h.doc) continue;
    nameByCik.set(h.cik, h.name);
    const key = `${h.cik}|${h.period}`;
    const prev = want.get(key);
    if (!prev || (h.fileDate ?? "") > (prev.fileDate ?? "")) want.set(key, h);
  }
  const filings = [...want.values()];
  const toFetch = filings.filter(h => !cache[h.accession]?.ok);
  console.log(`  monthly filings: ${filings.length} (${toFetch.length} to fetch)`);
  let n = 0;
  for (const h of filings) {
    const before = cache[h.accession]?.ok;
    await fetchFiling(h, cache);
    if (!before) await sleep(400);
    if (++n % 100 === 0) { saveCache(cache); console.log(`  monthly fetched ${n}/${filings.length}`); }
  }
  saveCache(cache);

  for (const ticker of Object.keys(CUSIPS)) {
    const outShares = SHARES_OUTSTANDING[ticker];
    // cik -> { period -> {shares,value} }
    const byCik = new Map();
    for (const h of filings) {
      const pos = cache[h.accession]?.positions?.[ticker];
      if (!pos) continue;
      if (!byCik.has(h.cik)) byCik.set(h.cik, {});
      byCik.get(h.cik)[h.period] = pos;
    }
    const records = [];
    for (const [cik, byP] of byCik) {
      const shares = quarters.map(p => byP[p]?.shares ?? null);
      const cur = shares[0], prev = shares[1];
      const curPos = byP[quarters[0]];
      const netChg = cur != null && prev != null ? cur - prev
        : cur != null ? cur : prev != null ? -prev : null;
      records.push({
        filerName: nameByCik.get(cik) ?? "Unknown",
        filerCik: cik,
        shares,                                   // [current, -1q, -2q, -3q]
        netChg,
        currentValue: curPos?.value ?? null,
        pctOut: cur != null ? Math.round(cur / outShares * 1e4) / 1e4 * 100 : null,
        action: monthlyAction(cur, prev),
        discretion: curPos?.discretion ?? null,   // SOLE / DFND / OTR
        voteSole: curPos?.voteSole ?? null,
        voteShared: curPos?.voteShared ?? null,
        voteNone: curPos?.voteNone ?? null,
      });
    }
    records.sort((a, b) => (b.shares[0] ?? -1) - (a.shares[0] ?? -1));

    const heldCur = records.filter(r => r.shares[0] != null);
    const totalShares = heldCur.reduce((s, r) => s + r.shares[0], 0);
    const summary = {
      institutions: heldCur.length,
      totalShares,
      pctOut: Math.round(totalShares / outShares * 1e4) / 1e4 * 100,
      newHolders: records.filter(r => r.action === "New").length,
      sellouts:   records.filter(r => r.action === "Sellout").length,
      bought:     records.filter(r => r.action === "Bought").length,
      sold:       records.filter(r => r.action === "Sold").length,
      held:       records.filter(r => r.action === "No Change" && r.shares[0] != null).length,
    };
    const top10    = heldCur.slice(0, 10);
    const newList  = records.filter(r => r.action === "New").sort((a, b) => (b.shares[0] ?? 0) - (a.shares[0] ?? 0));
    const sellouts = records.filter(r => r.action === "Sellout").sort((a, b) => (b.shares[1] ?? 0) - (a.shares[1] ?? 0));

    writeFileSync(join(DATA_DIR, `monthly-${ticker.toLowerCase()}.json`), JSON.stringify({
      ticker, cusip: CUSIPS[ticker],
      quarters, sharesOutstanding: outShares,
      lastUpdated: today.toISOString(),
      summary, top10, newHolders: newList, sellouts, holdings: records,
    }, null, 2));
    console.log(`  monthly ${ticker}: ${summary.institutions} holders, ${summary.pctOut.toFixed(2)}% of shares; ${summary.newHolders} new, ${summary.sellouts} sellouts`);
  }
}

// ─── Mutual-fund (N-PORT) builder ───────────────────────────────────────────────

function loadNportCache() {
  if (!existsSync(NPORT_CACHE_PATH)) return {};
  try { return JSON.parse(readFileSync(NPORT_CACHE_PATH, "utf8")); } catch { return {}; }
}
function saveNportCache(c) { mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(NPORT_CACHE_PATH, JSON.stringify(c, null, 2)); }

// Find NPORT-P filings that mention a HEICO CUSIP (last NPORT_WINDOW_DAYS).
async function searchNport(cusip, today) {
  const end = today, start = new Date(end.getTime() - NPORT_WINDOW_DAYS * 864e5);
  const hits = [];
  let from = 0, total = null;
  while (true) {
    const url = `https://efts.sec.gov/LATEST/search-index?q=%22${cusip}%22&forms=NPORT-P`
      + `&dateRange=custom&startdt=${ymd(start)}&enddt=${ymd(end)}&from=${from}`;
    const j = await getRetry(url, { json: true });
    if (!j) { await sleep(3000); continue; }
    if (total === null) total = j.hits?.total?.value ?? 0;
    const page = j.hits?.hits ?? [];
    if (!page.length) break;
    for (const h of page) {
      const s = h._source ?? {};
      hits.push({
        accession: s.adsh,
        cik: (s.ciks?.[0] ?? "").replace(/^0+/, "") || "0",
        regName: (s.display_names?.[0] ?? "Unknown").replace(/\s*\(CIK.*$/i, "").trim(),
        period: s.period_ending,
        fileDate: s.file_date,
        doc: String(h._id).split(":")[1],
      });
    }
    from += page.length;
    if (from >= total || from >= 9900) break;
    await sleep(1000);
  }
  return hits;
}

// Parse a fund's N-PORT: identity + HEICO positions.
function parseNport(xml) {
  const seriesId   = xml.match(/<seriesId>([^<]+)<\/seriesId>/i)?.[1] ?? null;
  const seriesName = (xml.match(/<seriesName>([^<]+)<\/seriesName>/i)?.[1] ?? "").trim();
  const regName    = (xml.match(/<regName>([^<]+)<\/regName>/i)?.[1] ?? "").replace(/&amp;/g, "&").trim();
  const positions = {};
  const re = /<invstOrSec>([\s\S]*?)<\/invstOrSec>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const cusip = (b.match(/<cusip>([^<]+)<\/cusip>/i)?.[1] ?? "").replace(/[\s-]/g, "");
    const ticker = Object.keys(CUSIPS).find(t => CUSIPS[t] === cusip);
    if (!ticker) continue;
    const shares = Math.round(parseFloat(b.match(/<balance>([^<]+)<\/balance>/i)?.[1] ?? "0"));
    const value  = Math.round(parseFloat(b.match(/<valUSD>([^<]+)<\/valUSD>/i)?.[1] ?? "0"));
    out(positions, ticker, shares, value);
  }
  return { seriesId, seriesName, regName, positions };
  function out(o, t, s, v) { o[t] = { shares: (o[t]?.shares ?? 0) + s, value: (o[t]?.value ?? 0) + v }; }
}

async function fetchNport(h, cache) {
  const cached = cache[h.accession];
  if (cached && cached.ok) return cached;
  const noD = h.accession.replace(/-/g, "");
  const xml = await getRetry(`https://www.sec.gov/Archives/edgar/data/${h.cik}/${noD}/${h.doc}`);
  const parsed = xml ? parseNport(xml) : null;
  const rec = parsed
    ? { ...parsed, cik: h.cik, period: h.period, fileDate: h.fileDate, ok: true }
    : { ok: false };
  if (rec.ok) cache[h.accession] = rec;
  return rec;
}

// Curated fund-family → 13F manager map (major families cover most fund AUM).
// Matched against the fund's registrant and series name; unmatched funds get "".
const FAMILY_TO_MANAGER = [
  [/vanguard/i, "Vanguard Group"],
  [/fidelity|FMR|strategic advisers|VIP /i, "FMR (Fidelity)"],
  [/blackrock|ishares/i, "BlackRock"],
  [/growth fund of america|american funds|capital group|capital world|capital research|washington mutual investors|new perspective|europacific|amcap|investment company of america|fundamental investors|new economy|smallcap world|new world fund|capital income builder|income fund of america/i, "Capital Group (American Funds)"],
  [/SPDR|state street/i, "State Street"],
  [/T\.? Rowe/i, "T. Rowe Price"],
  [/JPMorgan|J\.?P\.? Morgan/i, "JPMorgan"],
  [/invesco/i, "Invesco"],
  [/dimensional|DFA /i, "Dimensional"],
  [/geode/i, "Geode Capital"],
  [/baron/i, "Baron Capital"],
  [/nuveen|TIAA/i, "Nuveen (TIAA)"],
  [/franklin|templeton/i, "Franklin Resources"],
  [/morgan stanley|eaton vance|calvert|parametric/i, "Morgan Stanley"],
  [/columbia/i, "Columbia (Ameriprise)"],
  [/janus/i, "Janus Henderson"],
  [/neuberger/i, "Neuberger Berman"],
  [/northern (funds|trust|inst)|flexshares/i, "Northern Trust"],
  [/goldman sachs/i, "Goldman Sachs"],
  [/schwab/i, "Charles Schwab"],
  [/voya/i, "Voya"],
  [/PGIM|prudential/i, "PGIM (Prudential)"],
  [/principal/i, "Principal"],
  [/wisdomtree/i, "WisdomTree"],
  [/first trust/i, "First Trust"],
  [/\bARK\b/i, "ARK Invest"],
  [/hartford/i, "Hartford"],
  [/MFS |massachusetts financial/i, "MFS"],
  [/putnam/i, "Putnam"],
  [/john hancock/i, "John Hancock"],
  [/lord abbett/i, "Lord Abbett"],
  [/dodge & cox|dodge &amp; cox/i, "Dodge & Cox"],
  [/american century/i, "American Century"],
];
function resolveManager(registrant, fundName) {
  const hay = `${registrant} ${fundName}`;
  for (const [re, mgr] of FAMILY_TO_MANAGER) if (re.test(hay)) return mgr;
  return "";
}

function fundAction(cur, prev) {
  if (cur != null && prev == null) return "New";
  if (cur == null) return "No Change";
  if (prev == null) return "New";
  if (cur > prev) return "Bought";
  if (cur < prev) return "Sold";
  return "No Change";
}

// Latest NPORT-P period a fund registrant has filed (for detecting fund sellouts).
async function registrantLatestNport(cik, memo) {
  if (memo.has(cik)) return memo.get(cik);
  const sub = await getRetry(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, { json: true });
  let latest = null;
  const f = sub?.filings?.recent;
  if (f) for (let i = 0; i < f.form.length; i++) {
    if (f.form[i] === "NPORT-P" && (latest == null || f.reportDate[i] > latest)) latest = f.reportDate[i];
  }
  memo.set(cik, latest);
  return latest;
}

async function buildFunds(today) {
  console.log("\nBuilding mutual-fund (N-PORT) holders…");
  const cache = loadNportCache();
  const nportMemo = new Map();

  // 1. Find all N-PORT filings mentioning either HEICO CUSIP.
  const byAcc = new Map();
  for (const cusip of Object.values(CUSIPS)) {
    const hits = await searchNport(cusip, today);
    console.log(`  N-PORT filings mentioning ${cusip}: ${hits.length}`);
    for (const h of hits) if (h.accession && h.doc) byAcc.set(h.accession, h);
    await sleep(1500);
  }
  const filings = [...byAcc.values()];
  const toFetch = filings.filter(h => !cache[h.accession]?.ok).length;
  console.log(`  unique N-PORT filings: ${filings.length} (${toFetch} to fetch)`);

  // 2. Fetch + parse each (cached).
  let n = 0;
  for (const h of filings) {
    const before = cache[h.accession]?.ok;
    await fetchNport(h, cache);
    if (!before) await sleep(300);
    if (++n % 100 === 0) { saveNportCache(cache); console.log(`  N-PORT fetched ${n}/${filings.length}`); }
  }
  saveNportCache(cache);

  // 3. Group filings per fund (seriesId, else registrant+series name).
  const recs = filings.map(h => cache[h.accession]).filter(r => r && r.ok);
  const byFund = new Map();
  for (const r of recs) {
    const key = r.seriesId || `${r.cik}|${r.seriesName}`;
    if (!byFund.has(key)) byFund.set(key, []);
    byFund.get(key).push(r);
  }

  const staleCut = today.getTime() - NPORT_STALE_DAYS * 864e5;

  for (const ticker of Object.keys(CUSIPS)) {
    const outShares = SHARES_OUTSTANDING[ticker];
    const holders = [];
    for (const [, list] of byFund) {
      // sort this fund's filings newest first
      const sorted = [...list].sort((a, b) => (b.period ?? "").localeCompare(a.period ?? ""));
      const latest = sorted[0];
      const cur = latest.positions?.[ticker]?.shares ?? null;
      if (cur == null || cur <= 0) continue;                       // not a long holder (skip zero/short positions)
      if (Date.parse(latest.period) < staleCut) continue;          // stale report → treat as no longer current
      // prior = this fund's previous report that we have
      const prevRec = sorted.find(r => r !== latest && r.positions?.[ticker]?.shares != null);
      const prev = prevRec?.positions?.[ticker]?.shares ?? null;
      const change = cur != null && prev != null ? cur - prev : null;
      const fundName = latest.seriesName || "(unnamed fund)";
      holders.push({
        fundName,
        registrant: latest.regName,
        manager: resolveManager(latest.regName, fundName),
        cik: latest.cik,
        shares: cur,
        value: latest.positions[ticker].value ?? null,
        reportDate: latest.period,
        priorShares: prev,
        change,
        pctOut: Math.round(cur / outShares * 1e6) / 1e6 * 100,
        action: fundAction(cur, prev),
      });
    }
    holders.sort((a, b) => b.shares - a.shares);
    const totalShares = holders.reduce((s, h) => s + h.shares, 0);

    // §5: fund sellouts — held HEICO, but registrant has filed a newer N-PORT
    // (past this fund's last HEICO report), i.e. they've since reported without it.
    const sellouts = [];
    for (const [, list] of byFund) {
      const sorted = [...list].sort((a, b) => (b.period ?? "").localeCompare(a.period ?? ""));
      const latest = sorted[0];
      const had = latest.positions?.[ticker]?.shares ?? null;
      if (had == null || had <= 0) continue;                     // only real long positions
      if (Date.parse(latest.period) >= staleCut) continue;       // still a current holder
      const regLatest = await registrantLatestNport(latest.cik, nportMemo);
      await sleep(100);
      if (regLatest && regLatest > latest.period) {
        sellouts.push({
          fundName: latest.seriesName || "(unnamed fund)",
          registrant: latest.regName,
          manager: resolveManager(latest.regName, latest.seriesName || ""),
          lastShares: had, lastReport: latest.period,
        });
      }
    }
    sellouts.sort((a, b) => b.lastShares - a.lastShares);

    // §10: 13F managers with their affiliated funds.
    const mgrMap = new Map();
    for (const h of holders) {
      if (!h.manager) continue;
      if (!mgrMap.has(h.manager)) mgrMap.set(h.manager, { manager: h.manager, fundCount: 0, shares: 0, funds: [] });
      const g = mgrMap.get(h.manager);
      g.fundCount++; g.shares += h.shares; g.funds.push({ fundName: h.fundName, shares: h.shares });
    }
    const managers = [...mgrMap.values()].sort((a, b) => b.shares - a.shares);
    managers.forEach(g => g.funds.sort((a, b) => b.shares - a.shares));
    const linkedShares = managers.reduce((s, g) => s + g.shares, 0);

    const summary = {
      funds: holders.length,
      totalShares,
      pctOut: Math.round(totalShares / outShares * 1e6) / 1e6 * 100,
      newFunds: holders.filter(h => h.action === "New").length,
      sellouts: sellouts.length,
      linkedManagers: managers.length,
      linkedShares,
    };
    const newHolders = holders.filter(h => h.action === "New");

    writeFileSync(join(DATA_DIR, `funds-${ticker.toLowerCase()}.json`), JSON.stringify({
      ticker, cusip: CUSIPS[ticker], sharesOutstanding: outShares,
      lastUpdated: today.toISOString(),
      summary, newHolders, sellouts, managers, holders,
    }, null, 2));
    console.log(`  funds ${ticker}: ${summary.funds} funds hold, ${summary.pctOut.toFixed(2)}% of shares, ${summary.newFunds} new, ${sellouts.length} sellouts`);
  }
}

// ─── §12/§13: Peer reports ───────────────────────────────────────────────────────

const PEERS = [
  { name: "RTX Corp.",             ticker: "RTX",  cusip: "75513E101" },
  { name: "Boeing Co.",            ticker: "BA",   cusip: "097023105" },
  { name: "Howmet Aerospace",      ticker: "HWM",  cusip: "443201108" },
  { name: "TransDigm Group",       ticker: "TDG",  cusip: "893641100" },
  { name: "Teledyne Technologies", ticker: "TDY",  cusip: "879360105" },
  { name: "Loar Holdings",         ticker: "LOAR", cusip: "53947R105" },
  { name: "Arxis Inc.",            ticker: "ARXS", cusip: "04339D105" },
  { name: "VSE Corp.",             ticker: "VSEC", cusip: "918284100" },
  { name: "FTAI Aviation",         ticker: "FTAI", cusip: "G3730V105" },
];
const PEER_CACHE_PATH = join(DATA_DIR, "peer-cache.json");

// Parse a single CUSIP's long position from a 13F info table or an N-PORT.
function parseCusipHoldings(xml, cusip, isNport) {
  let shares = 0, value = 0;
  if (isNport) {
    const re = /<invstOrSec>([\s\S]*?)<\/invstOrSec>/gi; let m;
    while ((m = re.exec(xml)) !== null) {
      const b = m[1];
      if ((b.match(/<cusip>([^<]+)<\/cusip>/i)?.[1] ?? "").replace(/[\s-]/g, "") !== cusip) continue;
      shares += Math.round(parseFloat(b.match(/<balance>([^<]+)</i)?.[1] ?? "0"));
      value  += Math.round(parseFloat(b.match(/<valUSD>([^<]+)</i)?.[1] ?? "0"));
    }
  } else {
    const re = /<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi; let m;
    while ((m = re.exec(xml)) !== null) {
      const b = m[1];
      if ((b.match(/<(?:\w+:)?cusip>([^<]+)</i)?.[1] ?? "").replace(/[\s-]/g, "") !== cusip) continue;
      const pc = (b.match(/<(?:\w+:)?putCall>([^<]+)</i)?.[1] ?? "").trim().toUpperCase();
      if (pc === "PUT" || pc === "CALL") continue;
      shares += parseInt(b.match(/<(?:\w+:)?sshPrnamt>(\d+)</i)?.[1] ?? "0", 10);
      value  += parseInt(b.match(/<(?:\w+:)?value>(\d+)</i)?.[1] ?? "0", 10);
    }
  }
  return shares > 0 ? { shares, value } : null;
}

async function buildPeerReports(today) {
  console.log("\nBuilding peer reports (§12/§13)…");
  const cache = existsSync(PEER_CACHE_PATH) ? (() => { try { return JSON.parse(readFileSync(PEER_CACHE_PATH, "utf8")); } catch { return {}; } })() : {};
  const saveP = () => { writeFileSync(PEER_CACHE_PATH, JSON.stringify(cache, null, 2)); };

  // Candidate mega-managers = HEICO's largest 13F holders (they dominate large-cap ownership).
  const candidateCiks = new Set();
  for (const file of ["monthly-hei.json", "monthly-heia.json"]) {
    try {
      const m = JSON.parse(readFileSync(join(DATA_DIR, file), "utf8"));
      m.holdings.filter(h => h.shares[0] != null).sort((a, b) => b.shares[0] - a.shares[0]).slice(0, 60)
        .forEach(h => candidateCiks.add(h.filerCik));
    } catch {}
  }

  const fetchParse = async (h, cusip, isNport) => {
    const key = `${h.accession}|${cusip}`;
    if (cache[key] !== undefined) return cache[key];
    const noD = h.accession.replace(/-/g, "");
    const xml = await getRetry(`https://www.sec.gov/Archives/edgar/data/${h.cik}/${noD}/${h.doc}`);
    const pos = xml ? parseCusipHoldings(xml, cusip, isNport) : null;
    cache[key] = pos;
    await sleep(300);
    return pos;
  };

  const out = [];
  for (const peer of PEERS) {
    // §12 — top 13F holders (from candidate mega-managers, most recent settled quarter).
    // Narrow window (~1 quarter) so widely-held peers don't truncate at the 10k cap.
    const hits13 = await searchCusip(peer.cusip, 165);
    let curQ = mostRecentCompleteQuarterEnd(today);
    // Recent IPOs weren't public in the settled quarter — fall back to their latest period.
    const periodsPresent = new Set(hits13.filter(h => h.accession && h.period).map(h => h.period));
    if (!periodsPresent.has(curQ)) {
      curQ = [...periodsPresent].filter(p => p <= mostRecentQuarterEnd(today)).sort((a, b) => b.localeCompare(a))[0] ?? curQ;
    }
    const dedup13 = new Map();
    for (const h of hits13) {
      if (h.period !== curQ || !h.accession || !h.doc) continue;
      const prev = dedup13.get(h.cik);
      if (!prev || (h.fileDate ?? "") > (prev.fileDate ?? "")) dedup13.set(h.cik, h);
    }
    // Small company → fetch every holder for an exact top-20; large-cap → mega-managers only.
    const small13 = dedup13.size <= 1200;
    const targets13 = [...dedup13.values()].filter(h => small13 || candidateCiks.has(h.cik));
    const top13F = [];
    for (const h of targets13) {
      const pos = await fetchParse(h, peer.cusip, false);
      if (pos) top13F.push({ filer: h.name, shares: pos.shares, value: pos.value });
    }
    top13F.sort((a, b) => b.value - a.value);

    // §13 — top mutual-fund holders
    const hitsN = await searchNport(peer.cusip, today);
    const dedupN = new Map();
    for (const h of hitsN) {
      if (!h.accession || !h.doc) continue;
      const key = `${h.cik}|${h.doc}`;
      const prev = dedupN.get(key);
      if (!prev || (h.fileDate ?? "") > (prev.fileDate ?? "")) dedupN.set(key, h);
    }
    const smallN = dedupN.size <= 1200;
    const targetsN = [...dedupN.values()].filter(h => smallN || resolveManager(h.regName, ""));
    const topFunds = [];
    for (const h of targetsN) {
      const pos = await fetchParse(h, peer.cusip, true);
      if (pos) topFunds.push({ fund: h.regName, manager: resolveManager(h.regName, ""), shares: pos.shares, value: pos.value });
    }
    topFunds.sort((a, b) => b.value - a.value);

    saveP();
    out.push({ name: peer.name, ticker: peer.ticker, top13F: top13F.slice(0, 20), topFunds: topFunds.slice(0, 20) });
    console.log(`  ${peer.name}: ${top13F.length} candidate 13F holders, ${topFunds.length} candidate fund holders`);
  }

  writeFileSync(join(DATA_DIR, "peers.json"), JSON.stringify({ lastUpdated: today.toISOString(), peers: out }, null, 2));
  console.log(`  peers.json written (${out.length} peers).`);
}

// ─── §11: Forms 13G / 13D / 14D beneficial-ownership filings ─────────────────────

async function buildBeneficialOwners(today) {
  console.log("\nBuilding 13G/13D/14D beneficial-ownership filings…");
  const end = today, start = new Date(end.getTime() - 3 * 366 * 864e5);  // ~3 years
  const forms = "SC 13D,SC 13D/A,SC 13G,SC 13G/A,SC 14D9,SC 14D9/A";
  const hits = [];
  for (const cusip of Object.values(CUSIPS)) {
    let from = 0, total = null;
    while (true) {
      const url = `https://efts.sec.gov/LATEST/search-index?q=%22${cusip}%22&forms=${encodeURIComponent(forms)}`
        + `&dateRange=custom&startdt=${ymd(start)}&enddt=${ymd(end)}&from=${from}`;
      const j = await getRetry(url, { json: true });
      if (!j) { await sleep(3000); continue; }
      if (total === null) total = j.hits?.total?.value ?? 0;
      const page = j.hits?.hits ?? [];
      if (!page.length) break;
      for (const h of page) hits.push(h);
      from += page.length;
      if (from >= total || from >= 500) break;
      await sleep(1000);
    }
    await sleep(1000);
  }
  // Latest filing per filer CIK (exclude HEICO's own CIK 0000046619).
  const byFiler = new Map();
  for (const h of hits) {
    const s = h._source ?? {};
    const filerCik = (s.ciks ?? []).find(c => c !== "0000046619") ?? "";
    const filer = (s.display_names ?? []).find(n => !/HEICO CORP/i.test(n))?.replace(/\s*\(CIK.*$/i, "").trim() ?? "Unknown";
    if (!filerCik) continue;
    const rec = { filer, filerCik, form: s.file_type, fileDate: s.file_date, adsh: s.adsh, doc: String(h._id).split(":")[1] };
    const prev = byFiler.get(filerCik);
    if (!prev || (rec.fileDate ?? "") > (prev.fileDate ?? "")) byFiler.set(filerCik, rec);
  }

  const filers = [];
  for (const rec of byFiler.values()) {
    const noD = rec.adsh.replace(/-/g, "");
    const url = `https://www.sec.gov/Archives/edgar/data/${rec.filerCik.replace(/^0+/, "")}/${noD}/${rec.doc}`;
    const html = await getRetry(url);
    let shares = null, pct = null;
    if (html) {
      const txt = html.replace(/<[^>]+>/g, " ").replace(/&#160;|&nbsp;/g, " ").replace(/\s+/g, " ");
      // Handles the standard cover, Fidelity's "(a) Amount beneficially owned: N",
      // and percents written without a "%" sign ("…Row (9) 11.7").
      shares = (txt.match(/AGGREGATE AMOUNT BENEFICIALLY OWNED(?:\s+BY\s+EACH\s+REPORTING\s+PERSON)?[\s\S]{0,60}?([\d,]{4,})/i)?.[1]
             ?? txt.match(/amount beneficially owned[:\s()a-z]{0,20}?([\d,]{4,})/i)?.[1])?.replace(/,/g, "");
      pct = txt.match(/PERCENT OF CLASS[\s\S]{0,140}?(\d{1,2}(?:\.\d+)?)\s*%/i)?.[1]
         ?? txt.match(/percent of class[\s\S]{0,60}?row\s*\(?\d+\)?\s+(\d{1,2}(?:\.\d+)?)/i)?.[1];
    }
    filers.push({
      filer: rec.filer, form: rec.form, fileDate: rec.fileDate,
      shares: shares ? parseInt(shares, 10) : null,
      pctClass: pct ? parseFloat(pct) : null,
      url,
    });
    await sleep(300);
  }
  filers.sort((a, b) => (b.shares ?? -1) - (a.shares ?? -1));

  writeFileSync(join(DATA_DIR, "beneficial-owners.json"), JSON.stringify({
    lastUpdated: today.toISOString(), filers,
  }, null, 2));
  console.log(`  beneficial owners: ${filers.length} filers (13G/13D/14D)`);
}

main().catch(e => { console.error(e); process.exit(1); });
