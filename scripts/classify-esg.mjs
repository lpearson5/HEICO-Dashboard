// classify-esg.mjs
// Flags which HEI / HEI.A institutional holders are ESG / sustainable investors.
//
// Method:
//  1) A CURATED database of DEDICATED ESG/sustainable/impact managers (whole-firm
//     ESG mandate) — high confidence.
//  2) TIGHT name heuristics for ESG-branded funds (name literally says ESG /
//     Sustainable / SRI / Low-Carbon / Paris / Net-Zero). Deliberately narrow to
//     avoid false positives ("Greenlight", "Social Capital", generic "Values").
//
// Honest limit: 13F reports at the FIRM level, not the fund level. Diversified
// giants (BlackRock, Vanguard, …) run ESG *and* non-ESG funds and the filing
// can't say which sleeve holds HEICO — so those are NOT counted as ESG here.
//
// Output: data/esg-ownership.json { asOf, period, combined, hei, heia }

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DATA = join(process.cwd(), "data");
const read = (f) => { try { return JSON.parse(readFileSync(join(DATA, f), "utf8")); } catch { return null; } };

// ── 1) Dedicated ESG / sustainable / impact managers (whole-firm mandate) ──
const DEDICATED = [
  "calvert", "parnassus", "domini impact", "domini social", "trillium asset", "boston common",
  "green century", "impax", "pax world", "generation investment", "generation im",
  "nia impact", "zevin", "adasina", "mirova", "robeco", "etho capital",
  "ethic", "aperio", "community capital management", "natural investments",
  "praxis", "everence", "eventide", "inspire investing", "amana", "saturna",
  "guidestone", "friends fiduciary", "as you sow", "arjuna", "clean yield",
  "veris wealth", "sonen", "reynders mcveigh", "walden asset", "crossmark",
  "storebrand", "klp ", "triodos", "actiam", "candriam", "sycomore",
  "federated hermes", "eos at federation", "sustainalytics",
  "newday impact", "affirmative investment", "osmosis investment",
  "rockefeller asset", "jantzi", "nordea",
];

// A few of the above are broad houses with a strong-but-not-exclusive ESG tilt.
// Mark them "tilt" so the UI can separate pure-play from ESG-leaning.
const TILT = new Set(["robeco", "candriam", "nordea", "federated hermes", "rockefeller asset"]);

// ── 2) Tight ESG-branded fund-name heuristics ──────────────────────────
function brandedTier(name) {
  const n = name.toLowerCase();
  if (/\besg\b|sustainab|\bsri\b|paris[- ]?aligned|net[- ]?zero|low[- ]?carbon|decarbon|climate|impact investing|responsible invest/.test(n)) return "Branded ESG fund";
  return null;
}

function classify(name) {
  const n = name.toLowerCase();
  for (const t of DEDICATED) if (n.includes(t)) return { esg: true, tier: TILT.has(t) ? "ESG-tilted house" : "Dedicated ESG manager" };
  const b = brandedTier(name);
  if (b) return { esg: true, tier: b };
  return { esg: false };
}

function block(holdings) {
  const rows = holdings
    .map((h) => ({ name: h.filerName, sh: Array.isArray(h.shares) ? (h.shares[0] || 0) : (h.currentShares || 0) }))
    .filter((r) => r.sh > 0);
  const totalHolders = rows.length;
  const totalShares = rows.reduce((s, r) => s + r.sh, 0);

  const members = [];
  for (const r of rows) {
    const c = classify(r.name);
    if (c.esg) members.push({ name: r.name, shares: r.sh, tier: c.tier });
  }
  members.sort((a, b) => b.shares - a.shares);
  const esgShares = members.reduce((s, m) => s + m.shares, 0);

  const byTier = {};
  for (const m of members) byTier[m.tier] = (byTier[m.tier] || 0) + 1;

  return {
    total: totalHolders,
    totalShares,
    esgHolders: members.length,
    esgShares,
    holderPct: totalHolders ? Math.round((members.length / totalHolders) * 1000) / 10 : 0,
    sharePct: totalShares ? Math.round((esgShares / totalShares) * 1000) / 10 : 0,
    tiers: byTier,
    members,
  };
}

function combine(a, b) {
  const map = new Map();
  const add = (h) => {
    const sh = Array.isArray(h.shares) ? (h.shares[0] || 0) : (h.currentShares || 0);
    const key = (h.filerCik || h.filerName || "").toString();
    const prev = map.get(key);
    if (prev) prev.shares[0] += sh;
    else map.set(key, { filerName: h.filerName, filerCik: h.filerCik, shares: [sh] });
  };
  (a || []).forEach(add);
  (b || []).forEach(add);
  return [...map.values()];
}

const mHei = read("monthly-hei.json");
const mHeia = read("monthly-heia.json");
if (!mHei && !mHeia) { console.error("No monthly data; run fetch-edgar first."); process.exit(0); }

const heiH = mHei?.holdings || [];
const heiaH = mHeia?.holdings || [];

const out = {
  asOf: new Date().toISOString(),
  period: mHei?.quarters?.[0] || mHeia?.quarters?.[0] || null,
  hei: block(heiH),
  heia: block(heiaH),
  combined: block(combine(heiH, heiaH)),
};

writeFileSync(join(DATA, "esg-ownership.json"), JSON.stringify(out, null, 2));

const c = out.combined;
console.log(`ESG ownership (combined): ${c.esgHolders} of ${c.total} holders (${c.holderPct}%), ${c.sharePct}% of ESG-flagged shares`);
console.log("Tiers:", c.tiers);
console.log("Members:");
for (const m of c.members) console.log(`  ${m.name}  —  ${m.shares.toLocaleString()}  [${m.tier}]`);
