"use client";

import type { OptionsData } from "@/lib/types";

const fmt = (n: number) => (n ? n.toLocaleString("en-US") : "—");

export default function OptionsPositions({ data }: { data: OptionsData | null }) {
  if (!data || !data.holders?.length) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
        No 13F option positions on HEICO found for the current quarter.
      </div>
    );
  }
  const totPut = data.totals.HEI.put + data.totals.HEIA.put;
  const totCall = data.totals.HEI.call + data.totals.HEIA.call;
  const pcr = totCall ? totPut / totCall : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Options Positions</h2>
        <span className="text-xs text-gray-400">13F puts &amp; calls · {data.currentPeriod}</span>
      </div>

      {/* Honesty banner */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <b>Read this as market plumbing, not sentiment.</b> These are listed option positions reported in 13F filings — held almost entirely by <b>options market-makers and multi-strategy quant funds</b> as market-making inventory and hedges. They are <b>not</b> directional bets against (puts) or on (calls) HEICO, and most firms hold both. This is <i>not</i> a list of who is short the stock — U.S. rules don&apos;t disclose that.
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Put contracts (sh)", fmt(totPut)],
          ["Call contracts (sh)", fmt(totCall)],
          ["Put / call ratio", pcr == null ? "—" : pcr.toFixed(2)],
          ["Firms with options", String(data.holders.length)],
        ].map(([label, val]) => (
          <div key={label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-2xl font-bold text-gray-900 tabular-nums">{val}</div>
            <div className="mt-0.5 text-xs font-medium text-gray-500">{label}</div>
          </div>
        ))}
      </div>

      {/* Holders table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Firm</th>
              {["HEI puts", "HEI calls", "HEI/A puts", "HEI/A calls"].map((h) => (
                <th key={h} className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.holders.map((h) => (
              <tr key={h.cik} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 font-medium text-gray-800">{h.filer}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-red-600">{fmt(h.heiPut)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-green-600">{fmt(h.heiCall)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-red-600">{fmt(h.heiaPut)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-green-600">{fmt(h.heiaCall)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400">
        Put/call positions from 13F info tables (the ownership pages exclude these from share counts). Covers options-active managers (market-makers, quant/multi-strat funds, broker-dealers). Contracts shown as underlying shares. For reference only — not investment advice.
      </p>
    </div>
  );
}
