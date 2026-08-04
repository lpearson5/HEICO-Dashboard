"use client";

import { useMemo, useState } from "react";
import type { MonthlyData, MonthlyHolding, MonthlyAction, FundData } from "@/lib/types";

const ACTION_COLORS: Record<MonthlyAction, string> = {
  New:         "bg-blue-100 text-blue-800 border-blue-200",
  Bought:      "bg-green-100 text-green-800 border-green-200",
  Sold:        "bg-amber-100 text-amber-800 border-amber-200",
  Sellout:     "bg-red-100 text-red-800 border-red-200",
  "No Change": "bg-gray-100 text-gray-600 border-gray-200",
};

function fmt(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("en-US");
}
function fmtSigned(n: number | null): string {
  if (n == null) return "—";
  return (n > 0 ? "+" : "") + n.toLocaleString("en-US");
}
function fmtValue(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n}`;
}
// "2026-03-31" -> "Q1 2026"
function qLabel(period: string): string {
  const [y, m] = period.split("-");
  const q = { "03": "Q1", "06": "Q2", "09": "Q3", "12": "Q4" }[m] ?? m;
  return `${q} ${y}`;
}

function ChangeCell({ n }: { n: number | null }) {
  const cls = n == null ? "text-gray-400" : n > 0 ? "text-green-600" : n < 0 ? "text-red-600" : "text-gray-500";
  return <span className={`tabular-nums font-medium ${cls}`}>{fmtSigned(n)}</span>;
}

export default function MonthlySnapshot({ data, funds }: { data: MonthlyData | null; funds?: FundData | null }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return q ? data.holdings.filter((h) => h.filerName.toLowerCase().includes(q)) : data.holdings;
  }, [data, search]);

  if (!data) {
    return (
      <div className="py-16 text-center text-gray-500">
        Monthly snapshot isn’t available yet — it’s generated on the next data refresh.
      </div>
    );
  }

  const { quarters, summary } = data;

  const kpis = [
    { label: "Institutional Holders", value: summary.institutions.toLocaleString(), sub: "13F filers" },
    { label: "Shares Held", value: fmt(summary.totalShares), sub: `of ${fmt(data.sharesOutstanding)} outstanding` },
    { label: "% of Company Owned", value: `${summary.pctOut.toFixed(1)}%`, sub: "by institutions" },
    { label: "New / Sold Out", value: `${summary.newHolders} / ${summary.sellouts}`, sub: `this quarter` },
  ];

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        Settled quarterly view · Current quarter <b>{qLabel(quarters[0])}</b> · history back to {qLabel(quarters[quarters.length - 1])}
      </p>

      {/* KPI band */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-2xl font-bold text-gray-900 tabular-nums">{k.value}</div>
            <div className="text-xs font-medium text-gray-700 mt-1">{k.label}</div>
            <div className="text-xs text-gray-400">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Top 10 holders */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-700">
          Top 10 Institutional Holders
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">#</th>
                <th className="px-4 py-2 text-left">Institution</th>
                {quarters.map((q) => (
                  <th key={q} className="px-4 py-2 text-right whitespace-nowrap">{qLabel(q)}</th>
                ))}
                <th className="px-4 py-2 text-right">Net Chg</th>
                <th className="px-4 py-2 text-right">% Out</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.top10.map((h, i) => (
                <tr key={h.filerCik} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-400 tabular-nums">{i + 1}</td>
                  <td className="px-4 py-2 font-medium text-gray-900 max-w-xs truncate">{h.filerName}</td>
                  {h.shares.map((s, j) => (
                    <td key={j} className={`px-4 py-2 text-right tabular-nums ${j === 0 ? "text-gray-900 font-semibold" : "text-gray-500"}`}>{fmt(s)}</td>
                  ))}
                  <td className="px-4 py-2 text-right"><ChangeCell n={h.netChg} /></td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-600">{h.pctOut != null ? `${h.pctOut.toFixed(2)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* New holders & Sellouts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ListCard title={`New Holders (${data.newHolders.length})`} accent="text-blue-700"
          rows={data.newHolders} valueOf={(h) => h.shares[0]} />
        <ListCard title={`Sold Out (${data.sellouts.length})`} accent="text-red-700"
          rows={data.sellouts} valueOf={(h) => h.shares[1]} />
      </div>

      {/* Full history */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-gray-700">Full 13F Holder History · {filtered.length.toLocaleString()} shown</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search institution…"
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="overflow-x-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left">Institution</th>
                {quarters.map((q) => <th key={q} className="px-4 py-2 text-right whitespace-nowrap">{qLabel(q)}</th>)}
                <th className="px-4 py-2 text-right">Net Chg</th>
                <th className="px-4 py-2 text-right">% Out</th>
                <th className="px-4 py-2 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((h) => (
                <tr key={h.filerCik} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-900 max-w-xs truncate">{h.filerName}</td>
                  {h.shares.map((s, j) => (
                    <td key={j} className={`px-4 py-2 text-right tabular-nums ${j === 0 ? "text-gray-700" : "text-gray-400"}`}>{fmt(s)}</td>
                  ))}
                  <td className="px-4 py-2 text-right"><ChangeCell n={h.netChg} /></td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-600">{h.pctOut != null ? `${h.pctOut.toFixed(2)}%` : "—"}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full border ${ACTION_COLORS[h.action]}`}>{h.action}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Mutual funds & ETFs (N-PORT) ── */}
      <FundSection funds={funds} search={search} setSearch={setSearch} />

      <p className="text-xs text-gray-400 text-center pb-4">
        Source: SEC EDGAR 13F-HR (managers) &amp; N-PORT (funds) · % of shares outstanding based on {fmt(data.sharesOutstanding)} shares ·
        Updated {new Date(data.lastUpdated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
      </p>
    </div>
  );
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

function fmtReportDate(period: string): string {
  const [y, m] = period.split("-");
  const mon = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m)] ?? m;
  return `${mon} ${y}`;
}

function FundSection({
  funds, search, setSearch,
}: {
  funds?: FundData | null; search: string; setSearch: (s: string) => void;
}) {
  const rows = useMemo(() => {
    if (!funds) return [];
    const q = search.trim().toLowerCase();
    return q ? funds.holders.filter((h) => h.fundName.toLowerCase().includes(q) || h.registrant.toLowerCase().includes(q)) : funds.holders;
  }, [funds, search]);

  if (!funds) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-gray-500 text-sm">
        Mutual-fund (N-PORT) data will appear here on the next refresh.
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-2">
      <div className="border-t border-gray-200 pt-6">
        <h2 className="text-lg font-bold text-gray-900">Mutual Funds &amp; ETFs</h2>
        <p className="text-xs text-gray-500">
          Individual funds holding HEICO, from SEC N-PORT filings. Funds report on their own fiscal calendar, so each row shows that fund’s latest report date.
        </p>
      </div>

      {/* Fund KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-2xl font-bold text-gray-900 tabular-nums">{funds.summary.funds.toLocaleString()}</div>
          <div className="text-xs font-medium text-gray-700 mt-1">Funds Holding HEICO</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-2xl font-bold text-gray-900 tabular-nums">{fmt(funds.summary.totalShares)}</div>
          <div className="text-xs font-medium text-gray-700 mt-1">Shares Held by Funds</div>
          <div className="text-xs text-gray-400">{funds.summary.pctOut.toFixed(1)}% of shares outstanding</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-2xl font-bold text-blue-700 tabular-nums">{funds.summary.newFunds.toLocaleString()}</div>
          <div className="text-xs font-medium text-gray-700 mt-1">New Fund Positions</div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-gray-700">Fund Holders · {rows.length.toLocaleString()} shown</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search fund or family…"
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="overflow-x-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left">Fund</th>
                <th className="px-4 py-2 text-left">Family</th>
                <th className="px-4 py-2 text-center">Report</th>
                <th className="px-4 py-2 text-right">Shares</th>
                <th className="px-4 py-2 text-right">Chg</th>
                <th className="px-4 py-2 text-right">% Out</th>
                <th className="px-4 py-2 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((h, i) => (
                <tr key={`${h.cik}-${h.fundName}-${i}`} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-900 max-w-xs truncate">{decode(h.fundName)}</td>
                  <td className="px-4 py-2 text-gray-500 max-w-[10rem] truncate">{decode(h.registrant)}</td>
                  <td className="px-4 py-2 text-center text-gray-500 whitespace-nowrap">{fmtReportDate(h.reportDate)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-800">{fmt(h.shares)}</td>
                  <td className="px-4 py-2 text-right"><ChangeCell n={h.change} /></td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-600">{h.pctOut != null ? `${h.pctOut.toFixed(3)}%` : "—"}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full border ${
                      h.action === "New" ? "bg-blue-100 text-blue-800 border-blue-200"
                      : h.action === "Bought" ? "bg-green-100 text-green-800 border-green-200"
                      : h.action === "Sold" ? "bg-amber-100 text-amber-800 border-amber-200"
                      : "bg-gray-100 text-gray-600 border-gray-200"}`}>{h.action}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ListCard({
  title, accent, rows, valueOf,
}: {
  title: string; accent: string; rows: MonthlyHolding[]; valueOf: (h: MonthlyHolding) => number | null;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className={`px-4 py-3 border-b border-gray-100 text-sm font-semibold ${accent}`}>{title}</div>
      <div className="overflow-y-auto max-h-80 divide-y divide-gray-100">
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-gray-400 text-sm">None this quarter.</div>
        ) : rows.map((h) => (
          <div key={h.filerCik} className="px-4 py-2 flex items-center justify-between gap-3">
            <span className="text-sm text-gray-800 truncate">{h.filerName}</span>
            <span className="text-sm tabular-nums text-gray-600 whitespace-nowrap">{fmt(valueOf(h))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
