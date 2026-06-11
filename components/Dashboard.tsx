"use client";

import { useState, useMemo } from "react";
import type { TickerData, Holding, Action } from "@/lib/types";

const ACTION_COLORS: Record<Action, string> = {
  "New Position": "bg-blue-100 text-blue-800 border-blue-200",
  Bought:         "bg-green-100 text-green-800 border-green-200",
  Sold:           "bg-amber-100 text-amber-800 border-amber-200",
  "Sell Out":     "bg-red-100 text-red-800 border-red-200",
  "No Change":    "bg-gray-100 text-gray-600 border-gray-200",
};

const ACTION_FILTER_ORDER: (Action | "All")[] = [
  "All", "New Position", "Bought", "Sold", "Sell Out", "No Change",
];

type SortKey = keyof Pick<
  Holding,
  "filerName" | "currentShares" | "priorShares" | "change" | "pctChange"
>;

function fmt(n: number | null, decimals = 0): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtValue(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}B`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}M`;
  return `$${n.toLocaleString()}K`;
}

export default function Dashboard({
  hei,
  heia,
}: {
  hei: TickerData | null;
  heia: TickerData | null;
}) {
  const [activeTicker, setActiveTicker] = useState<"HEI" | "HEIA">("HEI");
  const [actionFilter, setActionFilter] = useState<Action | "All">("All");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("currentShares");
  const [sortAsc, setSortAsc] = useState(false);

  const data = activeTicker === "HEI" ? hei : heia;

  const summary = useMemo(() => {
    if (!data) return null;
    const counts: Record<Action, number> = {
      "New Position": 0, Bought: 0, Sold: 0, "Sell Out": 0, "No Change": 0,
    };
    for (const h of data.holdings) counts[h.action]++;
    return counts;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let rows = data.holdings;

    if (actionFilter !== "All") {
      rows = rows.filter((h) => h.action === actionFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((h) => h.filerName.toLowerCase().includes(q));
    }

    rows = [...rows].sort((a, b) => {
      const av = a[sortKey] ?? (sortAsc ? Infinity : -Infinity);
      const bv = b[sortKey] ?? (sortAsc ? Infinity : -Infinity);
      if (typeof av === "string" && typeof bv === "string") {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });

    return rows;
  }, [data, actionFilter, search, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(false); }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span className="text-gray-300 ml-1">↕</span>;
    return <span className="text-blue-600 ml-1">{sortAsc ? "↑" : "↓"}</span>;
  }

  const Th = ({
    k, label, right
  }: { k: SortKey; label: string; right?: boolean }) => (
    <th
      className={`px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:bg-gray-100 select-none ${right ? "text-right" : "text-left"}`}
      onClick={() => toggleSort(k)}
    >
      {label}
      <SortIcon k={k} />
    </th>
  );

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500 text-lg">
          No data available yet. The nightly fetch will populate this shortly.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">HEICO Institutional Ownership</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {data.currentPeriod} vs {data.priorPeriod} · SEC EDGAR 13F-HR ·{" "}
                Updated {new Date(data.lastUpdated).toLocaleDateString("en-US", {
                  month: "short", day: "numeric", year: "numeric",
                })}
              </p>
            </div>

            {/* Ticker toggle */}
            <div className="flex rounded-lg border border-gray-300 overflow-hidden self-start sm:self-auto">
              {(["HEI", "HEIA"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setActiveTicker(t)}
                  className={`px-5 py-2 text-sm font-medium transition-colors ${
                    activeTicker === t
                      ? "bg-blue-600 text-white"
                      : "bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {t === "HEIA" ? "HEI/A" : t}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Summary cards */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {(
              [
                { label: "New Positions", key: "New Position", color: "text-blue-600",  bg: "bg-blue-50",  border: "border-blue-100" },
                { label: "Buyers",        key: "Bought",       color: "text-green-600", bg: "bg-green-50", border: "border-green-100" },
                { label: "Sellers",       key: "Sold",         color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-100" },
                { label: "Sell Outs",     key: "Sell Out",     color: "text-red-600",   bg: "bg-red-50",   border: "border-red-100" },
                { label: "No Change",     key: "No Change",    color: "text-gray-600",  bg: "bg-gray-50",  border: "border-gray-200" },
              ] as const
            ).map(({ label, key, color, bg, border }) => (
              <button
                key={key}
                onClick={() => setActionFilter(actionFilter === key ? "All" : key)}
                className={`rounded-xl border p-4 text-left transition-all ${bg} ${border} ${
                  actionFilter === key ? "ring-2 ring-offset-1 ring-blue-500" : "hover:shadow-sm"
                }`}
              >
                <div className={`text-2xl font-bold ${color}`}>{summary[key]}</div>
                <div className="text-xs text-gray-500 mt-0.5 font-medium">{label}</div>
              </button>
            ))}
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by institution name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Action filter pills */}
          <div className="flex flex-wrap gap-1.5">
            {ACTION_FILTER_ORDER.map((a) => (
              <button
                key={a}
                onClick={() => setActionFilter(a)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                  actionFilter === a
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">
              {filtered.length.toLocaleString()} institution{filtered.length !== 1 ? "s" : ""}
              {actionFilter !== "All" && ` · ${actionFilter}`}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <Th k="filerName"     label="Institution" />
                  <Th k="currentShares" label={`${data.currentPeriod} Shares`} right />
                  <Th k="priorShares"   label={`${data.priorPeriod} Shares`}   right />
                  <Th k="change"        label="Change"       right />
                  <Th k="pctChange"     label="% Change"     right />
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">
                    Value
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-center">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                      No results match your filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map((h) => (
                    <tr key={h.filerCik} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">
                        {h.filerName}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                        {fmt(h.currentShares)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                        {fmt(h.priorShares)}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums font-medium ${
                        h.change == null ? "text-gray-400" :
                        h.change > 0 ? "text-green-600" :
                        h.change < 0 ? "text-red-600" : "text-gray-500"
                      }`}>
                        {h.change == null ? "—" : (h.change > 0 ? "+" : "") + fmt(h.change)}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums font-medium ${
                        h.pctChange == null ? "text-gray-400" :
                        h.pctChange > 0 ? "text-green-600" :
                        h.pctChange < 0 ? "text-red-600" : "text-gray-500"
                      }`}>
                        {h.pctChange == null ? "—" :
                          (h.pctChange > 0 ? "+" : "") + fmt(h.pctChange, 1) + "%"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                        {fmtValue(h.currentValue)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block px-2.5 py-0.5 text-xs font-semibold rounded-full border ${ACTION_COLORS[h.action]}`}>
                          {h.action}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <p className="text-xs text-gray-400 text-center pb-4">
          Data sourced from SEC EDGAR 13F-HR filings · Automatically refreshed daily ·
          CUSIPs: HEI 422819102 · HEI/A 422819201
        </p>
      </div>
    </div>
  );
}
