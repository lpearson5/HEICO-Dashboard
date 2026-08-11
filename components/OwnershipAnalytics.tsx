"use client";

import { useMemo } from "react";
import type { MonthlyData, BeneficialData } from "@/lib/types";

// Managers that are (predominantly) passive/index. Used only for the clearly-
// labeled ESTIMATED passive-vs-active split — 13F filings don't carry an
// active/passive tag, so this is a name-based approximation, not exact.
const PASSIVE = [
  "vanguard", "state street", "geode", "blackrock", "northern trust", "schwab",
  "rhumbline", "mellon", "ssga", "legal & general", "norges", "proshare",
  "global x", "wisdomtree", "first trust", "dimensional", "flexshares", "nuveen etf",
];
const isPassive = (name: string) => {
  const n = name.toLowerCase();
  return PASSIVE.some((p) => n.includes(p));
};

const pctFmt = (n: number) => `${n.toFixed(1)}%`;
const numFmt = (n: number) => n.toLocaleString("en-US");

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-2xl font-bold text-gray-900 tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs font-medium text-gray-500">{label}</div>
      {sub && <div className="mt-0.5 text-[11px] text-gray-400">{sub}</div>}
    </div>
  );
}

export default function OwnershipAnalytics({
  data,
  beneficial,
}: {
  data: MonthlyData | null;
  beneficial: BeneficialData | null;
}) {
  const analytics = useMemo(() => {
    if (!data || !data.holdings?.length) return null;
    const so = data.sharesOutstanding || 0;
    const sorted = [...data.holdings]
      .map((h) => ({ name: h.filerName, shares: h.shares?.[0] ?? 0 }))
      .filter((h) => h.shares > 0)
      .sort((a, b) => b.shares - a.shares);

    const sumN = (n: number) => sorted.slice(0, n).reduce((s, h) => s + h.shares, 0);
    const totalInst = sorted.reduce((s, h) => s + h.shares, 0);
    const cPct = (v: number) => (so ? (v / so) * 100 : 0);

    // Concentration bands as % of shares outstanding.
    const bands = [
      { label: "5 largest holders", v: cPct(sumN(5)), color: "#1d4ed8" },
      { label: "Holders #6–10", v: cPct(sumN(10) - sumN(5)), color: "#3b82f6" },
      { label: "Holders #11–25", v: cPct(sumN(25) - sumN(10)), color: "#93c5fd" },
      { label: "All other institutions", v: cPct(totalInst - sumN(25)), color: "#dbeafe" },
    ];
    const instPct = cPct(totalInst);
    const otherFloat = Math.max(0, 100 - instPct);

    // Estimated passive vs active (by manager name).
    let passive = 0;
    for (const h of sorted) if (isPassive(h.name)) passive += h.shares;
    const passivePct = totalInst ? (passive / totalInst) * 100 : 0;

    // Net institutional flow this quarter (sum of quarter-over-quarter changes).
    let netFlow = 0, buyers = 0, sellers = 0;
    for (const h of data.holdings) {
      const nc = h.netChg;
      if (nc == null) continue;
      netFlow += nc;
      if (nc > 0) buyers++; else if (nc < 0) sellers++;
    }

    // Shareholders by position size.
    const SIZE = [
      { label: "≥ 5M shares", min: 5_000_000, color: "#1e3a8a" },
      { label: "1M – 5M", min: 1_000_000, color: "#2563eb" },
      { label: "250K – 1M", min: 250_000, color: "#60a5fa" },
      { label: "50K – 250K", min: 50_000, color: "#bfdbfe" },
      { label: "< 50K", min: 0, color: "#eff6ff" },
    ];
    const buckets = SIZE.map((s) => ({ ...s, holders: 0, shares: 0 }));
    for (const h of sorted) {
      const b = buckets.find((x) => h.shares >= x.min);
      if (b) { b.holders++; b.shares += h.shares; }
    }
    const sizeBuckets = buckets.map((b) => ({
      label: b.label, color: b.color, holders: b.holders, shares: b.shares,
      pct: totalInst ? Math.round((b.shares / totalInst) * 1000) / 10 : 0,
    }));

    return {
      institutions: sorted.length,
      instPct,
      top5: cPct(sumN(5)),
      top10: cPct(sumN(10)),
      top25: cPct(sumN(25)),
      bands,
      otherFloat,
      passivePct,
      activePct: 100 - passivePct,
      netFlow, buyers, sellers, sizeBuckets,
    };
  }, [data]);

  const activism = useMemo(() => {
    const filers = beneficial?.filers ?? [];
    const isActivist = (f: string) => /13D|14D/i.test(f);
    const activists = filers.filter((f) => isActivist(f.form));
    const passives = filers.filter((f) => !isActivist(f.form));
    return { activists, passives, total: filers.length };
  }, [beneficial]);

  if (!analytics) return null;

  return (
    <div className="mb-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Ownership Analytics</h2>

      {/* Concentration stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Institutional owners" value={numFmt(analytics.institutions)} sub="13F filers holding HEICO" />
        <StatCard label="Institutional ownership" value={pctFmt(analytics.instPct)} sub="of shares outstanding" />
        <StatCard label="Top 10 concentration" value={pctFmt(analytics.top10)} sub={`Top 5: ${pctFmt(analytics.top5)}`} />
        <StatCard label="Top 25 concentration" value={pctFmt(analytics.top25)} sub="A high top-10 share can be a vulnerability" />
      </div>

      {/* Concentration bar */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-1 text-sm font-semibold text-gray-700">How HEICO&apos;s shares are held</div>
        <p className="mb-3 text-xs text-gray-500">
          Every HEICO share, split by who owns it. Each blue block is a group of the largest institutional holders; the grey block is everyone else.
        </p>
        <div className="flex h-7 w-full overflow-hidden rounded-md">
          {analytics.bands.map((b) => (
            <div key={b.label} className="h-full" style={{ width: `${b.v}%`, backgroundColor: b.color }} title={`${b.label}: ${pctFmt(b.v)} of shares outstanding`} />
          ))}
          <div className="h-full flex-1 bg-gray-100" title={`Retail, insiders & other: ${pctFmt(analytics.otherFloat)}`} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
          {analytics.bands.map((b) => (
            <span key={b.label} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: b.color }} />
              {b.label} — {pctFmt(b.v)}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-gray-100 ring-1 ring-inset ring-gray-200" />
            Retail, insiders &amp; other — {pctFmt(analytics.otherFloat)}
          </span>
        </div>
        <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-600">
          In plain terms: HEICO&apos;s <b>5 largest institutions own {pctFmt(analytics.top5)}</b> of the company, and the top 25 own {pctFmt(analytics.top25)}. Institutions hold {pctFmt(analytics.instPct)} in total; the remaining <b>{pctFmt(analytics.otherFloat)}</b> sits with retail investors, insiders (e.g. the Mendelson family), and holders too small to file 13F reports. A high top‑10 share can be a vulnerability — a few big holders selling can move the stock.
        </p>
      </div>

      {/* Shareholders by size + net flow */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-gray-700">Shareholders by size <span className="font-normal text-gray-400">· % of institutional shares</span></span>
          <span className={`text-xs font-medium ${analytics.netFlow >= 0 ? "text-green-600" : "text-red-600"}`}>
            Net flow this quarter: {analytics.netFlow >= 0 ? "+" : ""}{numFmt(analytics.netFlow)} sh · {analytics.buyers} buyers / {analytics.sellers} sellers
          </span>
        </div>
        <div className="flex h-6 w-full overflow-hidden rounded-md ring-1 ring-inset ring-gray-200">
          {analytics.sizeBuckets.map((b) => b.pct > 0 && (
            <div key={b.label} className="h-full" style={{ width: `${b.pct}%`, backgroundColor: b.color }} title={`${b.label}: ${b.holders} holders, ${pctFmt(b.pct)}`} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
          {analytics.sizeBuckets.map((b) => (
            <span key={b.label} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm ring-1 ring-inset ring-gray-200" style={{ backgroundColor: b.color }} />
              {b.label}: {b.holders} · {pctFmt(b.pct)}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Activism */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">Activism monitor</span>
            <span className="text-xs text-gray-400">Schedule 13D / 13G filers</span>
          </div>
          {activism.activists.length === 0 ? (
            <div className="flex items-start gap-2 rounded-lg bg-green-50 p-3">
              <span className="mt-0.5 text-green-600">✓</span>
              <div className="text-sm text-gray-700">
                <span className="font-semibold text-green-700">No activist positions.</span> All {activism.passives.length} &gt;5% beneficial owner{activism.passives.length !== 1 ? "s" : ""} on record filed a passive Schedule 13G — none have filed a 13D (which signals intent to influence control).
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-gray-700">
              <span className="font-semibold text-red-700">{activism.activists.length} activist filer{activism.activists.length !== 1 ? "s" : ""} (Schedule 13D):</span>
              <ul className="mt-1 list-disc pl-5">
                {activism.activists.map((a, i) => <li key={i}>{a.filer} — {a.pctClass ?? "?"}% ({a.form})</li>)}
              </ul>
            </div>
          )}
          {activism.passives.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-medium text-gray-500">Passive &gt;5% holders (13G)</div>
              <ul className="space-y-1 text-sm">
                {activism.passives
                  .slice()
                  .sort((a, b) => (b.pctClass ?? 0) - (a.pctClass ?? 0))
                  .map((f, i) => (
                    <li key={i} className="flex justify-between">
                      <span className="text-gray-700">{f.filer}</span>
                      <span className="tabular-nums text-gray-500">{f.pctClass ?? "—"}%</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>

        {/* Passive vs active (estimated) */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">Passive vs. active</span>
            <span className="text-xs text-gray-400">estimated</span>
          </div>
          <div className="flex h-6 w-full overflow-hidden rounded-md">
            <div className="h-full bg-slate-400" style={{ width: `${analytics.passivePct}%` }} title={`Passive/index ~${pctFmt(analytics.passivePct)}`} />
            <div className="h-full flex-1 bg-emerald-500" title={`Active ~${pctFmt(analytics.activePct)}`} />
          </div>
          <div className="mt-2 flex justify-between text-sm">
            <span className="flex items-center gap-1.5 text-gray-600"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-400" /> Passive / index ~{pctFmt(analytics.passivePct)}</span>
            <span className="flex items-center gap-1.5 text-gray-600"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Active ~{pctFmt(analytics.activePct)}</span>
          </div>
          <p className="mt-3 text-[11px] text-gray-400">
            Estimated by manager name (index shops like Vanguard, State Street, Geode, BlackRock counted as passive). 13F filings don&apos;t tag active vs passive, so treat this as directional. Share of identified institutional holdings.
          </p>
        </div>
      </div>
    </div>
  );
}
