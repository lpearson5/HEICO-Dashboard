// ─── Peer earnings calendar ─────────────────────────────────────────────────────
// Estimates the next quarterly report date for HEICO + peers from each company's
// SEC 10-Q/10-K filing history (next fiscal quarter-end + the company's typical
// filing lag). Exact call dates need a paid calendar feed; these are estimates.
// Writes data/earnings.json.

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");
const UA = { "User-Agent": "HEICO-Dashboard/1.0 lpearson@heico.com", "Accept-Encoding": "identity" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COMPANIES = [
  { sym: "HEI",  name: "HEICO",            cik: 46619,   main: true },
  { sym: "RTX",  name: "RTX Corp",         cik: 101829 },
  { sym: "BA",   name: "Boeing",           cik: 12927 },
  { sym: "HWM",  name: "Howmet Aerospace", cik: 4281 },
  { sym: "TDG",  name: "TransDigm",        cik: 1260221 },
  { sym: "TDY",  name: "Teledyne",         cik: 1094285 },
  { sym: "LOAR", name: "Loar Holdings",    cik: 2000178 },
  { sym: "ARXS", name: "Arxis",            cik: 2093536 },
  { sym: "VSEC", name: "VSE Corp",         cik: 102752 },
  { sym: "FTAI", name: "FTAI Aviation",    cik: 1590364 },
];

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; };
const days = (a, b) => Math.round((a - b) / 86_400_000);

async function build(c) {
  try {
    const r = await fetch(`https://data.sec.gov/submissions/CIK${String(c.cik).padStart(10, "0")}.json`, { headers: UA, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { ...pick(c), lastReport: null, nextEstimated: null };
    const f = (await r.json()).filings?.recent;
    const recs = [];
    for (let i = 0; i < (f?.form?.length ?? 0); i++) {
      if ((f.form[i] === "10-Q" || f.form[i] === "10-K") && f.reportDate[i] && f.filingDate[i])
        recs.push({ period: f.reportDate[i], filed: f.filingDate[i] });
    }
    recs.sort((a, b) => a.period.localeCompare(b.period));
    if (recs.length < 2) return { ...pick(c), lastReport: recs.at(-1) ?? null, nextEstimated: null };
    const lag = median(recs.slice(-8).map((x) => days(Date.parse(x.filed), Date.parse(x.period))));
    const last = recs.at(-1);
    // Next fiscal quarter-end ≈ last period + 3 months; roll forward until the
    // estimated report date is in the future.
    const now = Date.now();
    let q = addMonths(Date.parse(last.period), 3);
    let est = addMonths(q, 0); est = new Date(Date.parse(q.toISOString()) + lag * 86_400_000);
    while (est.getTime() < now) { q = addMonths(q, 3); est = new Date(q.getTime() + lag * 86_400_000); }
    const dateStr = est.toISOString().slice(0, 10);
    return { ...pick(c), lag, lastReport: last, nextEstimated: { date: dateStr, daysAway: days(est.getTime(), now) } };
  } catch { return { ...pick(c), lastReport: null, nextEstimated: null }; }
}
const pick = (c) => ({ sym: c.sym, name: c.name, main: !!c.main });

async function main() {
  console.log("=== Earnings calendar estimate (SEC filing pattern) ===");
  mkdirSync(DATA_DIR, { recursive: true });
  const rows = [];
  for (const c of COMPANIES) {
    const r = await build(c);
    rows.push(r);
    console.log(`  ${c.sym}: last ${r.lastReport?.period ?? "—"} · next ~${r.nextEstimated?.date ?? "—"} (${r.nextEstimated?.daysAway ?? "?"}d)`);
    await sleep(250);
  }
  rows.sort((a, b) => (a.nextEstimated?.date ?? "9999").localeCompare(b.nextEstimated?.date ?? "9999"));
  writeFileSync(join(DATA_DIR, "earnings.json"), JSON.stringify({ asOf: new Date().toISOString(), companies: rows }, null, 2));
  console.log("earnings.json written.");
}
main().catch((e) => { console.error("Earnings fetch failed:", e); process.exit(1); });
