"use client";

import { useState, useMemo } from "react";
import type { TickerData, Holding, Action, MonthlyData, FundData, BeneficialData, PeersData, PricesData, GeographyData, ShortInterestData, FundamentalsData } from "@/lib/types";
import MonthlySnapshot from "@/components/MonthlySnapshot";
import MarketPerformance from "@/components/MarketPerformance";
import OwnershipAnalytics from "@/components/OwnershipAnalytics";
import GeographicOwnership from "@/components/GeographicOwnership";
import ShortInterest from "@/components/ShortInterest";
import Valuation from "@/components/Valuation";

type View = "weekly" | "monthly" | "markets" | "valuation" | "short";
const VIEWS: { id: View; label: string }[] = [
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "markets", label: "Markets & Performance" },
  { id: "valuation", label: "Valuation" },
  { id: "short", label: "Short Interest" },
];
// Views that show 13F ownership tables use the HEI / HEI.A ticker toggle.
const OWNERSHIP_VIEWS: View[] = ["weekly", "monthly"];

const ACTION_COLORS: Record<Action, string> = {
  "New Position":  "bg-blue-100 text-blue-800 border-blue-200",
  Bought:          "bg-green-100 text-green-800 border-green-200",
  Sold:            "bg-amber-100 text-amber-800 border-amber-200",
  "Sell Out":      "bg-red-100 text-red-800 border-red-200",
  "No Change":     "bg-gray-100 text-gray-600 border-gray-200",
  "Not Filed Yet": "bg-purple-100 text-purple-800 border-purple-200",
};

const ACTION_FILTER_ORDER: (Action | "All")[] = [
  "All", "New Position", "Bought", "Sold", "Sell Out", "No Change", "Not Filed Yet",
];

// Rank used when sorting by the Action column (logical order, not alphabetical).
const ACTION_RANK: Record<Action, number> = {
  "New Position": 0, Bought: 1, Sold: 2, "Sell Out": 3, "No Change": 4, "Not Filed Yet": 5,
};

// A "large move" = a quarter-over-quarter buy or sell of this many shares or more.
const LARGE_MOVE = 1_000_000;

function largeMove(h: Holding): { big: boolean; dir: "up" | "down" } {
  let size = 0;
  let dir: "up" | "down" = "up";
  if (h.action === "Bought" && h.change != null)            { size = h.change;        dir = "up"; }
  else if (h.action === "Sold" && h.change != null)         { size = -h.change;       dir = "down"; }
  else if (h.action === "New Position" && h.currentShares != null) { size = h.currentShares; dir = "up"; }
  else if (h.action === "Sell Out" && h.priorShares != null)       { size = h.priorShares;   dir = "down"; }
  return { big: size >= LARGE_MOVE, dir };
}

type SortKey =
  | "filerName" | "currentShares" | "priorShares" | "change"
  | "pctChange" | "currentValue" | "action" | "filed";

// A filer has reported for the current quarter unless they're still pending.
const hasFiled = (h: Holding): boolean => h.action !== "Not Filed Yet";

function fmt(n: number | null, decimals = 0): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// 13F values are reported in whole dollars (post-2023 SEC convention).
function fmtValue(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toLocaleString()}`;
}

export default function Dashboard({
  hei,
  heia,
  monthlyHei = null,
  monthlyHeia = null,
  fundsHei = null,
  fundsHeia = null,
  beneficial = null,
  peers = null,
  prices = null,
  geoHei = null,
  geoHeia = null,
  shortInterest = null,
  fundamentals = null,
}: {
  hei: TickerData | null;
  heia: TickerData | null;
  monthlyHei?: MonthlyData | null;
  monthlyHeia?: MonthlyData | null;
  fundsHei?: FundData | null;
  fundsHeia?: FundData | null;
  beneficial?: BeneficialData | null;
  peers?: PeersData | null;
  prices?: PricesData | null;
  geoHei?: GeographyData | null;
  geoHeia?: GeographyData | null;
  shortInterest?: ShortInterestData | null;
  fundamentals?: FundamentalsData | null;
}) {
  const [view, setView] = useState<View>("weekly");
  const [activeTicker, setActiveTicker] = useState<"HEI" | "HEIA">("HEI");
  const [actionFilter, setActionFilter] = useState<Action | "All">("All");
  const [largeOnly, setLargeOnly] = useState(false);
  const [newOnly, setNewOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("currentShares");
  const [sortAsc, setSortAsc] = useState(false);

  const data = activeTicker === "HEI" ? hei : heia;
  const monthlyData = activeTicker === "HEI" ? monthlyHei : monthlyHeia;
  const fundsData = activeTicker === "HEI" ? fundsHei : fundsHeia;
  const geoData = activeTicker === "HEI" ? geoHei : geoHeia;

  const summary = useMemo(() => {
    if (!data) return null;
    const counts: Record<Action, number> = {
      "New Position": 0, Bought: 0, Sold: 0, "Sell Out": 0, "No Change": 0, "Not Filed Yet": 0,
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
    if (largeOnly) {
      rows = rows.filter((h) => largeMove(h).big);
    }
    if (newOnly) {
      rows = rows.filter((h) => h.newThisWeek);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((h) => h.filerName.toLowerCase().includes(q));
    }

    rows = [...rows].sort((a, b) => {
      if (sortKey === "action") {
        const ar = ACTION_RANK[a.action], br = ACTION_RANK[b.action];
        return sortAsc ? ar - br : br - ar;
      }
      if (sortKey === "filed") {
        const af = hasFiled(a) ? 1 : 0, bf = hasFiled(b) ? 1 : 0;
        return sortAsc ? af - bf : bf - af;
      }
      const av = (a as unknown as Record<string, number | string | null>)[sortKey] ?? (sortAsc ? Infinity : -Infinity);
      const bv = (b as unknown as Record<string, number | string | null>)[sortKey] ?? (sortAsc ? Infinity : -Infinity);
      if (typeof av === "string" && typeof bv === "string") {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });

    return rows;
  }, [data, actionFilter, largeOnly, newOnly, search, sortKey, sortAsc]);

  const largeCount = useMemo(
    () => (data ? data.holdings.filter((h) => largeMove(h).big).length : 0),
    [data]
  );
  const newCount = useMemo(
    () => (data ? data.holdings.filter((h) => h.newThisWeek).length : 0),
    [data]
  );

  // Column totals across the currently-shown rows.
  const totals = useMemo(() => {
    let current = 0, prior = 0, value = 0;
    for (const h of filtered) {
      current += h.currentShares ?? 0;
      prior   += h.priorShares ?? 0;
      value   += h.currentValue ?? 0;
    }
    return { current, prior, change: current - prior, value };
  }, [filtered]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(false); }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span className="text-gray-300 ml-1">↕</span>;
    return <span className="text-blue-600 ml-1">{sortAsc ? "↑" : "↓"}</span>;
  }

  const Th = ({
    k, label, right, center
  }: { k: SortKey; label: string; right?: boolean; center?: boolean }) => (
    <th
      className={`px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:bg-gray-100 select-none ${right ? "text-right" : center ? "text-center" : "text-left"}`}
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
                {view === "markets" ? (
                  <>HEICO, peers &amp; indices · Live prices &amp; performance</>
                ) : view === "short" ? (
                  <>HEICO vs peers · Short interest (FINRA)</>
                ) : view === "valuation" ? (
                  <>HEICO vs peers · Live multiples &amp; fundamentals</>
                ) : (
                  <>
                    {view === "weekly"
                      ? <>{data.currentPeriod} vs {data.priorPeriod} · Weekly 13F tracker</>
                      : <>Monthly ownership snapshot · SEC EDGAR 13F-HR</>}
                    {" · "}Updated {new Date(data.lastUpdated).toLocaleDateString("en-US", {
                      month: "short", day: "numeric", year: "numeric",
                    })}
                  </>
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
              {/* View tabs */}
              <div className="flex flex-wrap rounded-lg border border-gray-300 overflow-hidden">
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setView(v.id)}
                    className={`px-3.5 py-2 text-sm font-medium transition-colors ${
                      view === v.id ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>

              {/* Ticker toggle — only for 13F ownership views */}
              <div className={`flex rounded-lg border border-gray-300 overflow-hidden ${OWNERSHIP_VIEWS.includes(view) ? "" : "hidden"}`}>
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
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {view === "monthly" && <>
          <OwnershipAnalytics data={monthlyData} beneficial={beneficial} />
          <GeographicOwnership data={geoData} />
          <MonthlySnapshot data={monthlyData} funds={fundsData} beneficial={beneficial} peers={peers} />
        </>}
        {view === "markets" && <MarketPerformance initial={prices} />}
        {view === "valuation" && <Valuation fundamentals={fundamentals} />}
        {view === "short" && <ShortInterest data={shortInterest} />}
      </div>

      <div className={`max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6 ${view !== "weekly" ? "hidden" : ""}`}>

        {/* Summary cards */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {(
              [
                { label: "New Positions", key: "New Position",  color: "text-blue-600",   bg: "bg-blue-50",   border: "border-blue-100" },
                { label: "Buyers",        key: "Bought",        color: "text-green-600",  bg: "bg-green-50",  border: "border-green-100" },
                { label: "Sellers",       key: "Sold",          color: "text-amber-600",  bg: "bg-amber-50",  border: "border-amber-100" },
                { label: "Sell Outs",     key: "Sell Out",      color: "text-red-600",    bg: "bg-red-50",    border: "border-red-100" },
                { label: "No Change",     key: "No Change",     color: "text-gray-600",   bg: "bg-gray-50",   border: "border-gray-200" },
                { label: "Not Filed Yet", key: "Not Filed Yet", color: "text-purple-600", bg: "bg-purple-50", border: "border-purple-100" },
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

          {/* Action filter pills + large-move toggle */}
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
            <button
              onClick={() => setLargeOnly((v) => !v)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
                largeOnly
                  ? "bg-amber-500 text-white border-amber-500"
                  : "bg-amber-50 text-amber-700 border-amber-300 hover:border-amber-400"
              }`}
              title="Show only buys or sells of 1,000,000+ shares"
            >
              ⚑ Large Moves ≥1M ({largeCount})
            </button>
            <button
              onClick={() => setNewOnly((v) => !v)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
                newOnly
                  ? "bg-teal-600 text-white border-teal-600"
                  : "bg-teal-50 text-teal-700 border-teal-300 hover:border-teal-400"
              }`}
              title="Holders whose most recent 13F was filed within the last 7 days (new positions and changes alike)"
            >
              🆕 Filed in Last 7 Days ({newCount})
            </button>
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
                  <Th k="filed"         label="Filed" center />
                  <Th k="currentShares" label={`${data.currentPeriod} Shares`} right />
                  <Th k="priorShares"   label={`${data.priorPeriod} Shares`}   right />
                  <Th k="change"        label="Change"       right />
                  <Th k="pctChange"     label="% Change"     right />
                  <Th k="currentValue"  label="Value"        right />
                  <Th k="action"        label="Action"       center />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                      No results match your filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map((h) => {
                    const lm = largeMove(h);
                    return (
                    <tr
                      key={h.filerCik}
                      className={`transition-colors ${
                        lm.big
                          ? "bg-amber-50 border-l-4 border-amber-400 hover:bg-amber-100"
                          : "hover:bg-gray-50"
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">
                        {h.filerName}
                        {lm.big && (
                          <span
                            className={`ml-2 inline-block px-1.5 py-0.5 text-[10px] font-bold rounded align-middle ${
                              lm.dir === "up" ? "bg-green-600 text-white" : "bg-red-600 text-white"
                            }`}
                            title="Large move: 1,000,000+ shares"
                          >
                            {lm.dir === "up" ? "▲" : "▼"} 1M+
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {hasFiled(h) ? (
                          <span className="text-green-600 font-bold" title="Filed this quarter">✓</span>
                        ) : (
                          <span className="text-red-500 font-bold" title="Not filed yet">✗</span>
                        )}
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
                    );
                  })
                )}
              </tbody>
              {filtered.length > 0 && (
                <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-gray-900">
                  <tr>
                    <td className="px-4 py-3">
                      Total · {filtered.length.toLocaleString()} institution{filtered.length !== 1 ? "s" : ""}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-gray-500 font-medium whitespace-nowrap">
                      {filtered.filter(hasFiled).length} filed
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmt(totals.current)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmt(totals.prior)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${
                      totals.change > 0 ? "text-green-600" :
                      totals.change < 0 ? "text-red-600" : "text-gray-500"
                    }`}>
                      {(totals.change > 0 ? "+" : "") + fmt(totals.change)}
                    </td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-right tabular-nums text-gray-600">{fmtValue(totals.value)}</td>
                    <td className="px-4 py-3" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Footer */}
        <p className="text-xs text-gray-400 text-center pb-4">
          Data sourced from SEC EDGAR 13F-HR filings · Automatically refreshed daily ·
          CUSIPs: HEI 422806109 · HEI/A 422806208
        </p>
      </div>
    </div>
  );
}
