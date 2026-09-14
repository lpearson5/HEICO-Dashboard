// ─── Self-audit: independent integrity check (replaces the Vickers cross-check) ──
// Runs at the end of the daily pipeline. Flags the bug classes we've actually hit
// (transpositions, shares==value, duplicate CIKs, vanished holders, implausible
// jumps, stale/missing feeds) AND cross-checks the top holders against a FRESH
// independent SEC re-pull. Writes data/self-audit.json; if anything is CRITICAL or
// WARN it appends to audit-findings.txt so the workflow emails an alert.

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");
const UA = { "User-Agent": "HEICO-Dashboard/1.0 lpearson@heico.com", "Accept-Encoding": "identity" };
const CUSIPS = { hei: "422806109", heia: "422806208" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const load = (f) => { try { return JSON.parse(readFileSync(join(DATA_DIR, f), "utf8")); } catch { return null; } };
const findings = [];
const add = (level, check, detail) => findings.push({ level, check, detail });

// ── Structural checks (no network) ──────────────────────────────────────────────
function structural() {
  const soByT = {
    hei: load("monthly-hei.json")?.sharesOutstanding ?? 55_170_957,
    heia: load("monthly-heia.json")?.sharesOutstanding ?? 84_488_320,
  };
  const prior = load("self-audit.json");
  const counts = {};

  for (const t of ["hei", "heia"]) {
    const d = load(`${t}.json`);
    if (!d) { add("CRITICAL", "data-present", `${t}.json missing`); continue; }
    const so = soByT[t];
    const held = d.holdings.filter((h) => h.currentShares != null);
    counts[t] = held.length;

    // 1. duplicate CIKs (JSON merge corruption)
    const seen = {}; let dup = 0;
    for (const h of d.holdings) { if (seen[h.filerCik]) dup++; seen[h.filerCik] = 1; }
    if (dup) add("CRITICAL", "duplicate-cik", `${t}: ${dup} duplicate filer CIK(s)`);

    // 2. transposition signature (>25% of shares outstanding)
    const tp = d.holdings.filter((h) => h.currentShares > so * 0.25);
    for (const h of tp) add("CRITICAL", "transposition", `${t}: ${h.filerName} holds ${h.currentShares.toLocaleString()} (${(h.currentShares / so * 100).toFixed(0)}% of shares out) — likely value/shares swap`);

    // 3. shares == value (Diamant-type)
    const sv = d.holdings.filter((h) => h.currentShares > 0 && h.currentValue > 0 && h.currentShares === h.currentValue);
    for (const h of sv) add("CRITICAL", "shares-eq-value", `${t}: ${h.filerName} shares == value (${h.currentShares})`);

    // 4. implausible single-holder jump that isn't a New Position / Sell Out
    const jump = d.holdings.filter((h) => (h.action === "Bought" || h.action === "Sold") && h.priorShares > 0 && h.currentShares != null && Math.abs(h.currentShares - h.priorShares) > 5_000_000);
    for (const h of jump) add("WARN", "large-jump", `${t}: ${h.filerName} moved ${h.priorShares.toLocaleString()} → ${h.currentShares.toLocaleString()} (verify)`);

    // 5. holder-count drop vs prior run (FTS dropout)
    const pc = prior?.counts?.[t];
    if (pc && counts[t] < pc * 0.90) add("WARN", "holder-drop", `${t}: current holders ${counts[t]} vs ${pc} last run (−${Math.round((1 - counts[t] / pc) * 100)}%)`);

    // 6. staleness
    const age = (Date.now() - Date.parse(d.lastUpdated)) / 86_400_000;
    if (age > 2.5) add("WARN", "stale", `${t}.json is ${age.toFixed(1)} days old`);
  }

  // 7. institutional ownership % sanity (monthly summary)
  for (const t of ["hei", "heia"]) {
    const m = load(`monthly-${t}.json`);
    const pct = m?.summary?.pctOut;
    if (pct != null && (pct > 100 || pct < 30)) add(pct > 100 ? "CRITICAL" : "WARN", "inst-pct", `${t}: institutional ownership ${pct}% (implausible)`);
  }

  // 8. auxiliary feeds present & fresh
  for (const [f, key, days] of [["prices.json", "asOf", 3], ["short-interest.json", "asOf", 20], ["fundamentals.json", "asOf", 100], ["earnings.json", "asOf", 3], ["options.json", "asOf", 100]]) {
    const d = load(f);
    if (!d) { add("WARN", "feed-missing", `${f} missing`); continue; }
    const age = (Date.now() - Date.parse(d[key])) / 86_400_000;
    if (age > days) add("WARN", "feed-stale", `${f} is ${age.toFixed(0)} days old (>${days})`);
  }
  return counts;
}

// ── Independent SEC cross-check of the top holders ────────────────────────────────
async function getText(url) {
  for (let i = 1; i <= 3; i++) { try { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw 0; return await r.text(); } catch { if (i === 3) return ""; await sleep(1000 * i); } }
}
// Guarded HEICO share parse (mirrors the pipeline's guards so a correctly-handled
// filer error doesn't false-alarm; structural check #2/#3 catch guard failures).
function heicoShares(xml, cusip, so) {
  const re = /<(?:\w+:)?infoTable(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi; let m, sh = 0, val = 0, vs = 0, vsh = 0, vn = 0, found = false;
  while ((m = re.exec(xml))) { const b = m[1]; const cm = b.match(/<(?:\w+:)?cusip[^>]*>\s*([^<]+?)\s*</i); if (!cm || cm[1].replace(/[\s-]/g, "") !== cusip) continue; const pc = (b.match(/<(?:\w+:)?putCall[^>]*>\s*(put|call)/i) || [])[1]; if (pc) continue; found = true; sh += parseInt((b.match(/<(?:\w+:)?sshPrnamt[^>]*>\s*(\d+)/i) || [])[1] || 0, 10); val += parseInt((b.match(/<(?:\w+:)?value[^>]*>\s*(\d+)/i) || [])[1] || 0, 10); vs += parseInt((b.match(/<(?:\w+:)?Sole[^>]*>\s*(\d+)/i) || [])[1] || 0, 10); vsh += parseInt((b.match(/<(?:\w+:)?Shared[^>]*>\s*(\d+)/i) || [])[1] || 0, 10); vn += parseInt((b.match(/<(?:\w+:)?None[^>]*>\s*(\d+)/i) || [])[1] || 0, 10); }
  if (!found) return null;
  const vt = vs + vsh + vn;
  if (sh > 0 && sh === val && vt > 0 && vt !== sh) sh = vt;
  else if (sh > 0 && val > 0 && val < sh && so && sh > so * 0.2) sh = val;
  return sh;
}
async function crossCheck() {
  const soByT = { hei: load("monthly-hei.json")?.sharesOutstanding ?? 55_170_957, heia: load("monthly-heia.json")?.sharesOutstanding ?? 84_488_320 };
  for (const t of ["hei", "heia"]) {
    const d = load(`${t}.json`); if (!d) continue;
    const top = d.holdings.filter((h) => h.currentShares != null).sort((a, b) => b.currentShares - a.currentShares).slice(0, 15);
    let checked = 0, mism = 0;
    for (const h of top) {
      const sub = JSON.parse(await getText(`https://data.sec.gov/submissions/CIK${String(h.filerCik).padStart(10, "0")}.json`) || "null");
      const f = sub?.filings?.recent; if (!f) continue;
      let acc = null, doc = null;
      for (let i = 0; i < f.form.length; i++) if (f.form[i].startsWith("13F-HR") && f.reportDate[i] === d.currentPeriod) { acc = f.accessionNumber[i]; break; }
      if (!acc) continue;
      const base = `https://www.sec.gov/Archives/edgar/data/${h.filerCik}/${acc.replace(/-/g, "")}/`;
      const idx = await getText(base);
      const xmls = (idx.match(/href="([^"]*\.xml)"/gi) || []).map((x) => x.match(/href="([^"]*)"/i)[1]).filter((x) => !/primary_doc/i.test(x));
      let secSh = null;
      for (const dd of xmls) { const xml = await getText(base + dd.split("/").pop()); const s = heicoShares(xml, CUSIPS[t], soByT[t]); if (s != null) { secSh = s; break; } }
      if (secSh == null) continue;
      checked++;
      const tol = Math.max(1, h.currentShares * 0.01);
      if (Math.abs(secSh - h.currentShares) > tol) { mism++; add("WARN", "sec-mismatch", `${t}: ${h.filerName} dashboard ${h.currentShares.toLocaleString()} vs SEC ${secSh.toLocaleString()}`); }
      await sleep(200);
    }
    add("INFO", "cross-check", `${t}: cross-checked ${checked} top holders vs SEC, ${mism} mismatch(es)`);
  }
}

async function main() {
  console.log("=== Self-audit ===");
  const counts = structural();
  try { await crossCheck(); } catch (e) { add("WARN", "cross-check", `cross-check errored: ${e.message}`); }

  const crit = findings.filter((f) => f.level === "CRITICAL");
  const warn = findings.filter((f) => f.level === "WARN");
  const status = crit.length ? "CRITICAL" : warn.length ? "WARN" : "OK";
  const out = { asOf: new Date().toISOString(), status, counts, findings };
  writeFileSync(join(DATA_DIR, "self-audit.json"), JSON.stringify(out, null, 2));

  // Alert file for the workflow → email (only on real problems, not INFO).
  if (crit.length || warn.length) {
    const lines = [...crit, ...warn].map((f) => `[${f.level}] ${f.check}: ${f.detail}`);
    writeFileSync(join(process.cwd(), "audit-findings.txt"), `Dashboard self-audit found ${crit.length} critical / ${warn.length} warning:\n` + lines.join("\n"));
  }
  console.log(`Self-audit: ${status} — ${crit.length} critical, ${warn.length} warn`);
  findings.forEach((f) => console.log(`  [${f.level}] ${f.check}: ${f.detail}`));
}
main().catch((e) => { console.error("Self-audit failed:", e); process.exit(0); }); // never fail the pipeline
