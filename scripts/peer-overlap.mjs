// peer-overlap.mjs
// Cross-references HEICO's 13F holders with the holders of each peer company.
//
//  • Overlap  — which HEICO holders also own each peer (and which peers each
//               HEICO holder owns).
//  • Targets  — investors who own one or more peers but NOT HEICO: sector-aware
//               money that hasn't bought us yet. Ranked by how many peers they
//               own, then by known position size. Firms that recently SOLD OUT of
//               HEICO are flagged (re-engagement candidates).
//
// Matching is by SEC CIK, so name-spelling variants don't matter.
// Input:  data/peer-holders.json (from fetch-edgar), data/monthly-hei(a).json
// Output: data/peer-overlap.json

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DATA = join(process.cwd(), "data");
const read = (f) => { try { return JSON.parse(readFileSync(join(DATA, f), "utf8")); } catch { return null; } };
const normCik = (c) => String(c ?? "").replace(/^0+/, "");

const ph = read("peer-holders.json");
const mHei = read("monthly-hei.json");
const mHeia = read("monthly-heia.json");
if (!ph || (!mHei && !mHeia)) { console.error("peer-overlap: missing inputs; skipping."); process.exit(0); }

// ── HEICO register (both classes), keyed by CIK ──
const heico = new Map(); // cik -> { name, shares, soldOut }
for (const m of [mHei, mHeia]) {
  for (const h of m?.holdings ?? []) {
    const cik = normCik(h.filerCik);
    const cur = h.shares?.[0] ?? 0;
    const rec = heico.get(cik) ?? { name: h.filerName, shares: 0, soldOut: false };
    rec.shares += cur > 0 ? cur : 0;
    if (h.action === "Sellout") rec.soldOut = true;
    heico.set(cik, rec);
  }
}
const holdsHeico = (cik) => (heico.get(cik)?.shares ?? 0) > 0;
const heicoHolderCount = [...heico.values()].filter((r) => r.shares > 0).length;

// ── Walk every peer holder ──
const peers = [];
const heicoPeers = new Map();  // HEICO-holder cik -> Set(tickers)
const targets = new Map();     // non-holder cik -> { name, peers: [] }

for (const p of ph.peers) {
  let overlap = 0;
  for (const [cikRaw, name, shares, value] of p.holders) {
    const cik = normCik(cikRaw);
    if (holdsHeico(cik)) {
      overlap++;
      if (!heicoPeers.has(cik)) heicoPeers.set(cik, new Set());
      heicoPeers.get(cik).add(p.ticker);
    } else {
      const t = targets.get(cik) ?? { cik, name, peers: [] };
      t.peers.push({ t: p.ticker, shares, value });
      targets.set(cik, t);
    }
  }
  peers.push({
    ticker: p.ticker, name: p.name, period: p.period,
    holders: p.holders.length,
    overlap,
    pctOfHeicoHolders: heicoHolderCount ? Math.round((overlap / heicoHolderCount) * 1000) / 10 : 0,
    pctOfPeerHolders: p.holders.length ? Math.round((overlap / p.holders.length) * 1000) / 10 : 0,
    sharesKnownForAll: p.sharesKnownForAll,
  });
}

// ── HEICO holders → which peers they own (largest HEICO holders first) ──
const holders = [...heico.entries()]
  .filter(([, r]) => r.shares > 0)
  .map(([cik, r]) => ({ cik, name: r.name, heicoShares: r.shares, peers: [...(heicoPeers.get(cik) ?? [])].sort() }))
  .sort((a, b) => b.heicoShares - a.heicoShares);

// How concentrated is sector overlap? # of HEICO holders by number of peers owned.
const distribution = Array.from({ length: ph.peers.length + 1 }, (_, n) => ({ peers: n, holders: holders.filter((h) => h.peers.length === n).length }));

// ── Targets: own peers, not HEICO ──
const allTargets = [...targets.values()]
  .map((t) => ({
    ...t,
    peerCount: t.peers.length,
    knownValue: t.peers.reduce((s, x) => s + (x.value ?? 0), 0),
    soldHeico: !!heico.get(t.cik)?.soldOut,
  }))
  .sort((a, b) => b.peerCount - a.peerCount || b.knownValue - a.knownValue);
// Headline counts use the FULL set; the list shown is capped for page size, but
// recent HEICO sellers are always kept in it.
const target3Plus = allTargets.filter((t) => t.peerCount >= 3).length;
const soldHeicoCount = allTargets.filter((t) => t.soldHeico).length;
const targetList = [...allTargets.slice(0, 300), ...allTargets.slice(300).filter((t) => t.soldHeico)];

const out = {
  asOf: new Date().toISOString(),
  period: mHei?.quarters?.[0] ?? mHeia?.quarters?.[0] ?? null,
  heicoHolderCount,
  peers,
  distribution,
  holders,
  targets: targetList,
  targetCount: targets.size,
  target3Plus,
  soldHeicoCount,
};
writeFileSync(join(DATA, "peer-overlap.json"), JSON.stringify(out));

console.log(`Peer overlap: ${heicoHolderCount} HEICO holders, ${targets.size} peer-only investors (targets)`);
for (const p of peers) console.log(`  ${p.ticker.padEnd(5)} ${String(p.holders).padStart(5)} holders, ${String(p.overlap).padStart(4)} also own HEICO (${p.pctOfHeicoHolders}% of our register)`);
console.log("Top targets:");
for (const t of targetList.slice(0, 10)) console.log(`  ${t.name} — ${t.peerCount} peers [${t.peers.map((x) => x.t).join(", ")}]${t.soldHeico ? " (sold HEICO)" : ""}`);
