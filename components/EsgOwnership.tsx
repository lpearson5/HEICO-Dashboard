"use client";

import { useState } from "react";
import type { EsgData, EsgBlock } from "@/lib/types";

const TIER_COLOR: Record<string, string> = {
  "Dedicated ESG manager": "#059669",
  "ESG-tilted house": "#0d9488",
  "Branded ESG fund": "#0ea5e9",
};
const TIER_ORDER = ["Dedicated ESG manager", "ESG-tilted house", "Branded ESG fund"];
const fmtSh = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${n}`);
const cleanName = (s: string) => s.replace(/\s*\(.*?\)\s*$/g, "").trim();

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-2xl font-bold tabular-nums" style={{ color: tone ?? "#0f172a" }}>{value}</div>
      <div className="mt-0.5 text-xs font-medium text-gray-700">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-gray-400">{sub}</div>}
    </div>
  );
}

export default function EsgOwnership({ data }: { data: EsgData | null }) {
  const [scope, setScope] = useState<"combined" | "hei" | "heia">("combined");
  if (!data) {
    return <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">ESG ownership data hasn’t been generated yet. It appears after the next daily data refresh.</div>;
  }
  const b: EsgBlock = data[scope];
  const members = [...b.members].sort((a, c) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(c.tier) || c.shares - a.shares);
  const dedicated = b.members.filter((m) => m.tier === "Dedicated ESG manager").length;

  return (
    <div className="space-y-5">
      {/* Header + scope */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">ESG Ownership</h2>
          <p className="text-sm text-gray-500">
            Which of HEICO’s institutional holders run ESG / sustainable mandates{data.period ? `, as of ${data.period}` : ""}.
          </p>
        </div>
        <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
          {(["combined", "hei", "heia"] as const).map((s) => (
            <button key={s} onClick={() => setScope(s)} className={`px-3 py-1.5 font-medium ${scope === s ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
              {s === "combined" ? "Both classes" : s === "hei" ? "HEI" : "HEI.A"}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="ESG-focused holders" value={String(b.esgHolders)} sub={`of ${b.total} total`} tone="#059669" />
        <Stat label="of the register" value={`${b.holderPct}%`} sub="by # of holders" />
        <Stat label="of ESG-held shares" value={`${b.sharePct}%`} sub="by shares" />
        <Stat label="Dedicated ESG firms" value={String(dedicated)} sub="whole-firm mandate" tone="#0d9488" />
      </div>

      {/* Context callout — the defense-screening insight */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <span className="font-semibold">Why so few?</span> HEICO has a defense-electronics business, and most ESG/sustainable
        funds screen out defense — so dedicated-ESG ownership is small by design. The handful that hold HEICO are worth knowing:
        they’ve cleared their own screens, and they’re the realistic universe for ESG engagement or targeting.
      </div>

      {/* Holders table */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 px-4 py-2 text-xs text-gray-400">{members.length} ESG-focused holders</div>
        {members.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-400">No ESG-focused holders identified in this class.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Firm</th>
                  <th className="px-4 py-3">ESG classification</th>
                  <th className="px-4 py-3 text-right">Shares</th>
                  <th className="px-4 py-3 text-right">% of register</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m, i) => (
                  <tr key={m.name + i} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-gray-900">{cleanName(m.name)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: (TIER_COLOR[m.tier] ?? "#64748b") + "1f", color: TIER_COLOR[m.tier] ?? "#64748b" }}>
                        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TIER_COLOR[m.tier] ?? "#64748b" }} />
                        {m.tier}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">{fmtSh(m.shares)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-500">{b.totalShares ? ((m.shares / b.totalShares) * 100).toFixed(2) : "0"}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Methodology note */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs leading-relaxed text-gray-500">
        <span className="font-semibold text-gray-600">How ESG holders are identified:</span> a curated database of
        dedicated ESG/sustainable/impact managers (Calvert, Parnassus, Ethic, Praxis, Robeco, Federated Hermes, …) plus
        tight fund-name matching (ESG / Sustainable / SRI / Low-Carbon / Paris-aligned). <span className="font-medium text-gray-600">“Dedicated”</span> = the
        whole firm is ESG; <span className="font-medium text-gray-600">“ESG-tilted house”</span> = a large manager with a strong ESG program.
        {" "}<span className="italic">Important limit:</span> 13F filings report at the firm level, not the fund level — so a
        diversified giant like BlackRock or Vanguard may hold HEICO inside an ESG fund, but the filing can’t prove it, and
        those are deliberately <span className="font-medium text-gray-600">not counted here</span> to avoid overstating ESG ownership.
      </div>
    </div>
  );
}
