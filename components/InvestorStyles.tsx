"use client";

import { useState, Fragment } from "react";
import type { InvestorStylesData, StyleBlock, StyleCategory } from "@/lib/types";

// Fixed color + description per style so the chart, bar and table stay in sync.
const STYLE_META: Record<string, { color: string; blurb: string }> = {
  "Growth":         { color: "#059669", blurb: "Buys fast-growing, higher-multiple compounders (e.g. serial acquirers). HEICO's core active base." },
  "Value":          { color: "#2563eb", blurb: "Seeks cheap valuations / mean reversion. Rare for a premium-multiple name like HEICO." },
  "Momentum/Quant": { color: "#7c3aed", blurb: "Systematic, factor, multi-strategy and market-making shops. Trading-driven, not thesis-driven." },
  "Income":         { color: "#d97706", blurb: "Dividend / yield focused. Near-zero here — consistent with HEICO's ~0.1% yield." },
  "Blend/Core":     { color: "#64748b", blurb: "Index funds, passive, and diversified core managers, plus bank/broker & pension trusts." },
  "Unclassified":   { color: "#cbd5e1", blurb: "Smaller boutiques / hedge funds without a published style. Left unclassified rather than guessed." },
};
const ORDER = ["Growth", "Value", "Momentum/Quant", "Income", "Blend/Core", "Unclassified"];

const fmtSh = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${n}`);

function ordered(cats: StyleCategory[]): StyleCategory[] {
  return [...cats].sort((a, b) => ORDER.indexOf(a.style) - ORDER.indexOf(b.style));
}

// ── Donut chart ─────────────────────────────────────────────────────
function Donut({ block, metric }: { block: StyleBlock; metric: "shares" | "holders" }) {
  const cats = ordered(block.categories);
  const key = metric === "shares" ? "sharePct" : "holderPct";
  const R = 80, r = 50, C = 110;
  let acc = 0;
  const segs = cats.map((c) => {
    const frac = (c as any)[key] / 100;
    const start = acc, end = acc + frac;
    acc = end;
    const a0 = start * 2 * Math.PI - Math.PI / 2;
    const a1 = end * 2 * Math.PI - Math.PI / 2;
    const large = end - start > 0.5 ? 1 : 0;
    const x0 = C + R * Math.cos(a0), y0 = C + R * Math.sin(a0);
    const x1 = C + R * Math.cos(a1), y1 = C + R * Math.sin(a1);
    const xi1 = C + r * Math.cos(a1), yi1 = C + r * Math.sin(a1);
    const xi0 = C + r * Math.cos(a0), yi0 = C + r * Math.sin(a0);
    const d = `M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} L${xi1},${yi1} A${r},${r} 0 ${large} 0 ${xi0},${yi0} Z`;
    return { d, color: STYLE_META[c.style]?.color ?? "#999", style: c.style, pct: (c as any)[key] };
  });
  const top = cats.reduce((m, c) => ((c as any)[key] > (m as any)[key] ? c : m), cats[0]);
  return (
    <svg viewBox="0 0 220 220" className="w-full max-w-[240px]">
      {segs.map((s, i) => s.pct > 0 && <path key={i} d={s.d} fill={s.color} stroke="#fff" strokeWidth={1} />)}
      <text x={C} y={C - 4} textAnchor="middle" fontSize="26" fontWeight="700" fill="#0f172a">
        {top ? `${(top as any)[key].toFixed(0)}%`.replace(".0", "") : ""}
      </text>
      <text x={C} y={C + 14} textAnchor="middle" fontSize="11" fill="#64748b">{top?.style}</text>
    </svg>
  );
}

// ── Horizontal 100% stacked bar (the compact "at a glance" chart) ────
function StackBar({ block, metric }: { block: StyleBlock; metric: "shares" | "holders" }) {
  const cats = ordered(block.categories);
  const key = metric === "shares" ? "sharePct" : "holderPct";
  return (
    <div className="flex h-7 w-full overflow-hidden rounded-md border border-gray-200">
      {cats.map((c) => {
        const pct = (c as any)[key];
        if (pct <= 0) return null;
        return (
          <div
            key={c.style}
            title={`${c.style}: ${pct}%`}
            style={{ width: `${pct}%`, backgroundColor: STYLE_META[c.style]?.color }}
            className="flex items-center justify-center"
          >
            {pct >= 8 && <span className="px-1 text-[11px] font-semibold text-white truncate">{pct}%</span>}
          </div>
        );
      })}
    </div>
  );
}

export default function InvestorStyles({ data }: { data: InvestorStylesData | null }) {
  const [scope, setScope] = useState<"combined" | "hei" | "heia">("combined");
  const [metric, setMetric] = useState<"shares" | "holders">("shares");
  const [openStyle, setOpenStyle] = useState<string | null>(null);

  if (!data) {
    return <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">Investor-style data hasn’t been generated yet. It appears after the next daily data refresh.</div>;
  }

  const block: StyleBlock = data[scope];
  const cats = ordered(block.categories);
  const metricLabel = metric === "shares" ? "% of shares" : "% of holders";
  const cov = block.coverage;
  const covClassified = block.total - cov.unclassified;
  const covPct = block.total ? Math.round((covClassified / block.total) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Header + controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Investor Styles</h2>
          <p className="text-sm text-gray-500">
            What kind of money owns HEICO — growth, value, momentum/quant, income, or index/core —
            {data.period ? ` as of ${data.period}.` : "."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
            {(["combined", "hei", "heia"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`px-3 py-1.5 font-medium ${scope === s ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
              >
                {s === "combined" ? "Both classes" : s === "hei" ? "HEI" : "HEI.A"}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
            {(["shares", "holders"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={`px-3 py-1.5 font-medium ${metric === m ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
              >
                {m === "shares" ? "By shares" : "By # holders"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart card: donut + legend + stacked bar */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-6 md:flex-row md:items-center">
          <div className="flex justify-center md:w-1/3">
            <Donut block={block} metric={metric} />
          </div>
          <div className="md:w-2/3">
            <div className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-400">
              Ownership mix — {metricLabel}
            </div>
            <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              {cats.map((c) => {
                const pct = metric === "shares" ? c.sharePct : c.holderPct;
                return (
                  <div key={c.style} className="flex items-center gap-2 text-sm">
                    <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: STYLE_META[c.style]?.color }} />
                    <span className="flex-1 text-gray-700">{c.style}</span>
                    <span className="font-semibold tabular-nums text-gray-900">{pct}%</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-4">
              <StackBar block={block} metric={metric} />
            </div>
          </div>
        </div>
      </div>

      {/* Detailed breakdown table — click a row to see every investor in it */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 px-4 py-2 text-xs text-gray-400">
          Click a style to expand the full list of investors in it.
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Style</th>
                <th className="px-4 py-3 text-right">Holders</th>
                <th className="px-4 py-3 text-right">% of holders</th>
                <th className="px-4 py-3 text-right">Shares</th>
                <th className="px-4 py-3 text-right">% of shares</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {cats.map((c) => {
                const open = openStyle === c.style;
                const catShares = c.shares || 1;
                return (
                  <Fragment key={c.style}>
                    <tr
                      onClick={() => setOpenStyle(open ? null : c.style)}
                      className={`cursor-pointer border-b border-gray-100 align-top transition-colors hover:bg-gray-50 ${open ? "bg-gray-50" : ""}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`text-gray-400 transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
                          <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: STYLE_META[c.style]?.color }} />
                          <span className="font-medium text-gray-900">{c.style}</span>
                        </div>
                        <div className="mt-1 max-w-xs pl-6 text-xs leading-snug text-gray-400">{STYLE_META[c.style]?.blurb}</div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{c.holders}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">{c.holderPct}%</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{fmtSh(c.shares)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">{c.sharePct}%</td>
                      <td className="px-4 py-3 text-right text-xs font-medium whitespace-nowrap" style={{ color: STYLE_META[c.style]?.color }}>
                        {open ? "Hide" : `See all ${c.holders} ▾`}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-gray-100 bg-gray-50/60">
                        <td colSpan={6} className="px-4 pb-4 pt-1">
                          <div className="max-h-96 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                            <table className="w-full text-sm">
                              <thead className="sticky top-0 bg-gray-50">
                                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                                  <th className="px-3 py-2 w-10 text-right">#</th>
                                  <th className="px-3 py-2">Investor</th>
                                  <th className="px-3 py-2 text-right">Shares</th>
                                  <th className="px-3 py-2 text-right">% of {c.style}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {c.members.map((m, i) => (
                                  <tr key={m.name + i} className="border-t border-gray-100">
                                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-400">{i + 1}</td>
                                    <td className="px-3 py-1.5 text-gray-800">{m.name}</td>
                                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{m.shares.toLocaleString("en-US")}</td>
                                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{((m.shares / catShares) * 100).toFixed(1)}%</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Methodology / coverage note */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs leading-relaxed text-gray-500">
        <span className="font-semibold text-gray-600">How styles are assigned:</span> each institution is mapped to its
        published investment style using a curated manager database (BlackRock → index/core, T. Rowe Price → growth,
        Two Sigma → quant, and so on) plus fund-name heuristics for the long tail. This is the same approach paid
        surveillance firms use. <span className="font-medium text-gray-600">{covPct}% of {scope === "combined" ? "holders across both classes" : scope.toUpperCase()} are classified</span>
        {" "}({cov.curated} from the curated database, {cov.heuristic} by heuristic); the remaining {cov.unclassified} are
        smaller boutiques/hedge funds left <span className="italic">Unclassified</span> rather than guessed. Because the
        largest holders are all in the curated database, the <span className="font-medium text-gray-600">“by shares” view is the most reliable</span> —
        only {block.categories.find((c) => c.style === "Unclassified")?.sharePct ?? 0}% of shares are unclassified.
      </div>
    </div>
  );
}
