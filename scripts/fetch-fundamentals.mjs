// ─── Fundamentals for the Valuation page ────────────────────────────────────────
// Pulls trailing-twelve-month financials for HEICO + peers from SEC XBRL (free) so
// the Valuation page can compute P/E, P/Sales, EV/EBITDA, dividend yield against a
// LIVE price. Writes data/fundamentals.json (fundamentals change quarterly; the
// component combines them with live prices from /api/prices).

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");
const UA = { "User-Agent": "HEICO-Dashboard/1.0 lpearson@heico.com", "Accept-Encoding": "identity" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Yahoo symbol (for price join in the UI), display name, SEC CIK.
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

async function concept(cik, taxonomy, tag) {
  const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${String(cik).padStart(10, "0")}/${taxonomy}/${tag}.json`;
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`status ${r.status}`);
      const j = await r.json();
      const unit = Object.keys(j.units || {})[0];
      return unit ? j.units[unit] : null;
    } catch (e) { if (i === 3) return null; await sleep(800 * i); }
  }
}
async function firstConcept(cik, tags, taxonomy = "us-gaap") {
  for (const t of tags) { const u = await concept(cik, taxonomy, t); if (u && u.length) return u; }
  return null;
}

const dur = (x) => (Date.parse(x.end) - Date.parse(x.start)) / 86_400_000;

// Trailing-twelve-month of a flow concept: last full fiscal year + current YTD - prior YTD.
function ttm(arr) {
  if (!arr) return null;
  const a = arr.filter((x) => x.form && x.form.startsWith("10") && x.start && x.end && x.val != null);
  if (!a.length) return null;
  const latest = a.reduce((m, x) => (x.end > m ? x.end : m), "0000");
  const annuals = a.filter((x) => dur(x) >= 340 && dur(x) <= 380).sort((p, q) => p.end.localeCompare(q.end));
  const annual = annuals[annuals.length - 1];
  if (!annual) { // no annual yet (recent IPO): annualize the longest available interim
    const longest = a.filter((x) => dur(x) > 80).sort((p, q) => dur(q) - dur(p))[0];
    return longest ? longest.val * (365 / dur(longest)) : null;
  }
  const interimsAtLatest = a.filter((x) => x.end === latest && dur(x) < 340 && dur(x) > 80);
  if (!interimsAtLatest.length) return annual.val; // latest point is a fiscal year-end
  const cur = interimsAtLatest.sort((p, q) => dur(q) - dur(p))[0];
  const te = new Date(Date.parse(cur.end)); te.setUTCFullYear(te.getUTCFullYear() - 1);
  const prior = a
    .filter((x) => Math.abs(dur(x) - dur(cur)) < 20 && Math.abs(Date.parse(x.end) - te.getTime()) < 25 * 86_400_000)
    .sort((p, q) => Math.abs(Date.parse(p.end) - te.getTime()) - Math.abs(Date.parse(q.end) - te.getTime()))[0];
  if (!prior) return annual.val;
  return annual.val + cur.val - prior.val;
}

// Latest instantaneous (balance-sheet) value. Ignore stale points (a concept a
// filer stopped using years ago must not win over a currently-reported one).
function latestInstant(arr) {
  if (!arr) return null;
  const cutoff = Date.now() - 500 * 86_400_000;
  let a = arr.filter((x) => x.val != null && x.end && Date.parse(x.end) >= cutoff);
  if (!a.length) a = arr.filter((x) => x.val != null && x.end); // fall back if nothing recent
  a.sort((p, q) => p.end.localeCompare(q.end));
  return a.length ? a[a.length - 1].val : null;
}

async function build(c) {
  const netIncome = ttm(await firstConcept(c.cik, ["NetIncomeLoss"]));
  const revenue = ttm(await firstConcept(c.cik, ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"]));
  const opInc = ttm(await firstConcept(c.cik, ["OperatingIncomeLoss"]));
  const da = ttm(await firstConcept(c.cik, ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization"]));
  const cash = latestInstant(await firstConcept(c.cik, ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"]));
  const debtLT = latestInstant(await firstConcept(c.cik, ["LongTermDebtAndCapitalLeaseObligations", "LongTermDebtNoncurrent", "LongTermDebt", "LongTermLineOfCredit"]));
  const debtCur = latestInstant(await firstConcept(c.cik, ["LongTermDebtCurrent", "DebtCurrent"]));
  const shares = latestInstant(await firstConcept(c.cik, ["EntityCommonStockSharesOutstanding"], "dei"));
  const divPS = ttm(await firstConcept(c.cik, ["CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid"]));
  const ebitda = opInc != null && da != null ? opInc + da : null;
  const totalDebt = (debtLT ?? 0) + (debtCur ?? 0);
  return {
    sym: c.sym, name: c.name, main: !!c.main,
    shares,
    revenueTTM: revenue, netIncomeTTM: netIncome, ebitdaTTM: ebitda,
    cash, totalDebt: (debtLT == null && debtCur == null) ? null : totalDebt,
    dividendPerShareTTM: divPS,
  };
}

async function main() {
  console.log("=== Fundamentals fetch (SEC XBRL, TTM) ===");
  mkdirSync(DATA_DIR, { recursive: true });
  const rows = [];
  for (const c of COMPANIES) {
    const r = await build(c);
    rows.push(r);
    console.log(`  ${c.sym}: rev ${fmt(r.revenueTTM)} · NI ${fmt(r.netIncomeTTM)} · EBITDA ${fmt(r.ebitdaTTM)} · shares ${fmt(r.shares)} · debt ${fmt(r.totalDebt)} · cash ${fmt(r.cash)}`);
    await sleep(300);
  }
  writeFileSync(join(DATA_DIR, "fundamentals.json"), JSON.stringify({ asOf: new Date().toISOString(), companies: rows }, null, 2));
  console.log("fundamentals.json written.");
}
const fmt = (n) => n == null ? "—" : Math.abs(n) >= 1e9 ? (n / 1e9).toFixed(2) + "B" : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n.toLocaleString();
main().catch((e) => { console.error("Fundamentals fetch failed:", e); process.exit(1); });
