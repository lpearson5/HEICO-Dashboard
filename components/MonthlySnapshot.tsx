"use client";

import { Fragment, useMemo, useState } from "react";
import type { MonthlyData, MonthlyHolding, MonthlyAction, FundData, FundHolder, FundManager, BeneficialData, PeersData } from "@/lib/types";

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

// ── Reusable sortable-table helper ──
type SortState = { key: string; asc: boolean; toggle: (k: string) => void };

function useSort<T>(rows: T[], accessors: Record<string, (t: T) => number | string | null>, initialKey: string): { sorted: T[] } & SortState {
  const [key, setKey] = useState(initialKey);
  const [asc, setAsc] = useState(false);
  const sorted = useMemo(() => {
    const acc = accessors[key];
    if (!acc) return rows;
    return [...rows].sort((a, b) => {
      const av = acc(a), bv = acc(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;          // nulls last
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") return asc ? av.localeCompare(bv) : bv.localeCompare(av);
      return asc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [rows, key, asc, accessors]);
  const toggle = (k: string) => { if (k === key) setAsc(v => !v); else { setKey(k); setAsc(false); } };
  return { sorted, key, asc, toggle };
}

function SortTh({ id, label, sort, align = "left" }: { id: string; label: string; sort: SortState; align?: "left" | "right" | "center" }) {
  const active = sort.key === id;
  const a = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <th
      onClick={() => sort.toggle(id)}
      className={`px-4 py-2 ${a} cursor-pointer select-none hover:bg-gray-100 whitespace-nowrap`}
    >
      {label}
      <span className={`ml-1 ${active ? "text-blue-600" : "text-gray-300"}`}>{active ? (sort.asc ? "↑" : "↓") : "↕"}</span>
    </th>
  );
}

export default function MonthlySnapshot({ data, funds, beneficial, peers }: { data: MonthlyData | null; funds?: FundData | null; beneficial?: BeneficialData | null; peers?: PeersData | null }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return q ? data.holdings.filter((h) => h.filerName.toLowerCase().includes(q)) : data.holdings;
  }, [data, search]);

  const histAcc = useMemo<Record<string, (h: MonthlyHolding) => number | string | null>>(() => ({
    name: (h) => h.filerName,
    q0: (h) => h.shares[0], q1: (h) => h.shares[1], q2: (h) => h.shares[2], q3: (h) => h.shares[3],
    netChg: (h) => h.netChg, pctOut: (h) => h.pctOut, action: (h) => h.action,
  }), []);
  const hist = useSort(filtered, histAcc, "q0");

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

      {/* §2 Ownership Profile by Institution Type */}
      <OwnershipProfile data={data} funds={funds} />
      <OwnershipDonut data={data} funds={funds} />

      {/* Top 10 holders */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-700">
          Top 10 Institutional Holders (13F)
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
                <SortTh id="name" label="Institution" sort={hist} />
                {quarters.map((q, j) => <SortTh key={q} id={`q${j}`} label={qLabel(q)} sort={hist} align="right" />)}
                <SortTh id="netChg" label="Net Chg" sort={hist} align="right" />
                <SortTh id="pctOut" label="% Out" sort={hist} align="right" />
                <SortTh id="action" label="Action" sort={hist} align="center" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {hist.sorted.map((h) => (
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

      {/* §9 Investment Discretion & Voting Authority */}
      <DiscretionSection holdings={data.holdings} />

      {/* ── Mutual funds & ETFs (N-PORT) ── */}
      <FundSection funds={funds} search={search} setSearch={setSearch} />

      {/* §11 Forms 13G / 13D / 14D */}
      <BeneficialSection beneficial={beneficial} outShares={data.sharesOutstanding} />

      {/* §12/§13 Peer reports */}
      <PeerSection peers={peers} />

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
    return q ? funds.holders.filter((h) =>
      h.fundName.toLowerCase().includes(q) || h.registrant.toLowerCase().includes(q) || h.manager.toLowerCase().includes(q)
    ) : funds.holders;
  }, [funds, search]);

  const fundAcc = useMemo<Record<string, (h: FundHolder) => number | string | null>>(() => ({
    fund: (h) => h.fundName, family: (h) => h.registrant, manager: (h) => h.manager || "~",
    report: (h) => h.reportDate, shares: (h) => h.shares, chg: (h) => h.change,
    pctOut: (h) => h.pctOut, action: (h) => h.action,
  }), []);
  const fundSort = useSort(rows, fundAcc, "shares");

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

      {/* §3 New fund holders */}
      {funds.newHolders.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-blue-700">
            New Fund Holders ({funds.newHolders.length})
          </div>
          <div className="overflow-y-auto max-h-80 divide-y divide-gray-100">
            {[...funds.newHolders].sort((a, b) => b.shares - a.shares).map((h, i) => (
              <div key={`${h.cik}-${i}`} className="px-4 py-2 flex items-center justify-between gap-3">
                <span className="text-sm text-gray-800 truncate">
                  {decode(h.fundName)}
                  <span className="text-gray-400"> · {decode(h.registrant)}{h.manager ? ` (${h.manager})` : ""}</span>
                </span>
                <span className="text-sm tabular-nums text-gray-600 whitespace-nowrap">{fmt(h.shares)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* §5 Fund sellouts */}
      {funds.sellouts && funds.sellouts.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-red-700">
            Sold-Out Funds ({funds.sellouts.length})
          </div>
          <div className="overflow-y-auto max-h-80 divide-y divide-gray-100">
            {funds.sellouts.map((h, i) => (
              <div key={`${h.registrant}-${h.fundName}-${i}`} className="px-4 py-2 flex items-center justify-between gap-3">
                <span className="text-sm text-gray-800 truncate">
                  {decode(h.fundName)}
                  <span className="text-gray-400"> · {decode(h.registrant)}{h.manager ? ` (${h.manager})` : ""}</span>
                </span>
                <span className="text-sm tabular-nums text-gray-500 whitespace-nowrap">last held {fmt(h.lastShares)} ({fmtReportDate(h.lastReport)})</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
                <SortTh id="fund" label="Fund" sort={fundSort} />
                <SortTh id="manager" label="Manager" sort={fundSort} />
                <SortTh id="report" label="Report" sort={fundSort} align="center" />
                <SortTh id="shares" label="Shares" sort={fundSort} align="right" />
                <SortTh id="chg" label="Chg" sort={fundSort} align="right" />
                <SortTh id="pctOut" label="% Out" sort={fundSort} align="right" />
                <SortTh id="action" label="Action" sort={fundSort} align="center" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {fundSort.sorted.map((h, i) => (
                <tr key={`${h.cik}-${h.fundName}-${i}`} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-900 max-w-xs truncate" title={decode(h.registrant)}>{decode(h.fundName)}</td>
                  <td className="px-4 py-2 text-gray-500 max-w-[10rem] truncate">{h.manager || <span className="text-gray-300">—</span>}</td>
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

      {/* §10: 13F Managers with Affiliated Funds */}
      <ManagersSection managers={funds.managers} outShares={funds.sharesOutstanding} />
    </div>
  );
}

const DISC_LABEL: Record<string, string> = { SOLE: "Sole", DFND: "Defined", OTR: "Other" };

function DiscretionSection({ holdings }: { holdings: MonthlyHolding[] }) {
  const [search, setSearch] = useState("");
  const base = useMemo(() => holdings.filter((h) => h.shares[0] != null), [holdings]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? base.filter((h) => h.filerName.toLowerCase().includes(q)) : base;
  }, [base, search]);
  const acc = useMemo<Record<string, (h: MonthlyHolding) => number | string | null>>(() => ({
    name: (h) => h.filerName, shares: (h) => h.shares[0], disc: (h) => h.discretion ?? "",
    vs: (h) => h.voteSole ?? 0, vsh: (h) => h.voteShared ?? 0, vn: (h) => h.voteNone ?? 0,
  }), []);
  const s = useSort(rows, acc, "shares");

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-gray-700">Investment Discretion & Voting Authority</span>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search institution…"
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <div className="overflow-x-auto max-h-[70vh]">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky top-0">
            <tr>
              <SortTh id="name" label="Institution" sort={s} />
              <SortTh id="shares" label="Shares" sort={s} align="right" />
              <SortTh id="disc" label="Discretion" sort={s} align="center" />
              <SortTh id="vs" label="Vote: Sole" sort={s} align="right" />
              <SortTh id="vsh" label="Shared" sort={s} align="right" />
              <SortTh id="vn" label="None" sort={s} align="right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {s.sorted.map((h) => (
              <tr key={h.filerCik} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-medium text-gray-900 max-w-xs truncate">{h.filerName}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-800">{fmt(h.shares[0])}</td>
                <td className="px-4 py-2 text-center text-gray-600">{h.discretion ? (DISC_LABEL[h.discretion] ?? h.discretion) : "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-600">{fmt(h.voteSole ?? null)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-600">{fmt(h.voteShared ?? null)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-600">{fmt(h.voteNone ?? null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PeerSection({ peers }: { peers?: PeersData | null }) {
  const [sel, setSel] = useState(0);
  if (!peers || peers.peers.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center text-gray-500 text-sm">
        Peer reports will appear here on the next refresh.
      </div>
    );
  }
  const p = peers.peers[sel] ?? peers.peers[0];
  return (
    <div className="space-y-4">
      <div className="border-t border-gray-200 pt-6">
        <h2 className="text-lg font-bold text-gray-900">Peer Reports</h2>
        <p className="text-xs text-gray-500">Top holders of HEICO's sector peers, ranked by market value of shares held. Computed from large institutional managers and fund families (approximate top-20).</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {peers.peers.map((pr, i) => (
          <button key={pr.ticker} onClick={() => setSel(i)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
              i === sel ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"}`}>
            {pr.ticker} · {pr.name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PeerTable title={`§12 · Top 13F Holders — ${p.name}`} rows={p.top13F.map(r => ({ name: r.filer, sub: "", shares: r.shares, value: r.value }))} />
        <PeerTable title={`§13 · Top Fund Holders — ${p.name}`} rows={p.topFunds.map(r => ({ name: decode(r.fund), sub: r.manager, shares: r.shares, value: r.value }))} />
      </div>
    </div>
  );
}

function PeerTable({ title, rows }: { title: string; rows: { name: string; sub: string; shares: number; value: number }[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-700">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2 text-left">#</th>
              <th className="px-4 py-2 text-left">Holder</th>
              <th className="px-4 py-2 text-right">Shares</th>
              <th className="px-4 py-2 text-right">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No data.</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-gray-400 tabular-nums">{i + 1}</td>
                <td className="px-4 py-2 text-gray-900 max-w-xs truncate" title={r.sub}>
                  {r.name}{r.sub ? <span className="text-gray-400"> · {r.sub}</span> : null}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-700">{fmt(r.shares)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-900 font-medium">{fmtValue(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BeneficialSection({ beneficial, outShares }: { beneficial?: BeneficialData | null; outShares: number }) {
  if (!beneficial || beneficial.filers.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center text-gray-500 text-sm">
        No 13G / 13D / 14D beneficial-ownership filings on record.
      </div>
    );
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">Forms 13G / 13D / 14D Filers</span>
        <p className="text-xs text-gray-500 mt-0.5">Beneficial-ownership filings ({'>'}5% holders). Latest filing per filer, from SEC EDGAR.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2 text-left">Filer</th>
              <th className="px-4 py-2 text-center">Form</th>
              <th className="px-4 py-2 text-center">Filed</th>
              <th className="px-4 py-2 text-right">Shares Owned</th>
              <th className="px-4 py-2 text-right">% of Class</th>
              <th className="px-4 py-2 text-center">Filing</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {beneficial.filers.map((f, i) => (
              <tr key={`${f.filer}-${i}`} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-medium text-gray-900">{f.filer}</td>
                <td className="px-4 py-2 text-center text-gray-600 whitespace-nowrap">{f.form}</td>
                <td className="px-4 py-2 text-center text-gray-500 whitespace-nowrap">{f.fileDate}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-800">{fmt(f.shares)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-700">{f.pctClass != null ? `${f.pctClass}%` : "—"}</td>
                <td className="px-4 py-2 text-center">
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs">view →</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OwnershipDonut({ data, funds }: { data: MonthlyData; funds?: FundData | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const out = data.sharesOutstanding;
  const inst = data.summary.totalShares;
  const fundShares = funds?.summary.totalShares ?? 0;
  // Split the 13F total into funds vs. other-institutional so nothing double-counts.
  const segs = [
    { label: "Mutual funds & ETFs", shares: fundShares, color: "#2563eb" },
    { label: "Other 13F institutional", shares: Math.max(0, inst - fundShares), color: "#0d9488" },
    { label: "Insiders & other holders", shares: Math.max(0, out - inst), color: "#ea580c" },
  ].filter((s) => s.shares > 0);

  const R = 68, SW = 26, C = 2 * Math.PI * R, GAP = 3;
  let cum = 0;
  const arcs = segs.map((s) => {
    const frac = s.shares / out;
    const len = Math.max(0, frac * C - GAP);
    const arc = { ...s, frac, len, offset: -cum * C };
    cum += frac;
    return arc;
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="text-sm font-semibold text-gray-700 mb-3">Ownership Composition</div>
      <div className="flex flex-col sm:flex-row items-center gap-6">
        <div className="relative shrink-0" style={{ width: 200, height: 200 }}>
          <svg viewBox="0 0 200 200" width="200" height="200" role="img" aria-label="Ownership composition donut">
            <g transform="rotate(-90 100 100)">
              {arcs.map((a, i) => (
                <circle
                  key={i} cx="100" cy="100" r={R} fill="none"
                  stroke={a.color} strokeWidth={hover === i ? SW + 4 : SW}
                  strokeDasharray={`${a.len} ${C - a.len}`} strokeDashoffset={a.offset}
                  opacity={hover === null || hover === i ? 1 : 0.35}
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                  style={{ transition: "opacity .12s, stroke-width .12s", cursor: "default" }}
                />
              ))}
            </g>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            {hover === null ? (
              <>
                <div className="text-xl font-bold text-gray-900 tabular-nums">{data.summary.pctOut.toFixed(1)}%</div>
                <div className="text-[11px] text-gray-500">institutional</div>
              </>
            ) : (
              <>
                <div className="text-lg font-bold tabular-nums" style={{ color: arcs[hover].color }}>{(arcs[hover].frac * 100).toFixed(1)}%</div>
                <div className="text-[11px] text-gray-500 text-center px-2">{arcs[hover].label}</div>
              </>
            )}
          </div>
        </div>
        <div className="flex-1 w-full space-y-2">
          {arcs.map((a, i) => (
            <div key={i} className={`flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 ${hover === i ? "bg-gray-50" : ""}`}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <span className="flex items-center gap-2 text-sm text-gray-700">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ background: a.color }} />
                {a.label}
              </span>
              <span className="text-sm tabular-nums text-gray-600">{fmt(a.shares)} · <b className="text-gray-900">{(a.frac * 100).toFixed(1)}%</b></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OwnershipProfile({ data, funds }: { data: MonthlyData; funds?: FundData | null }) {
  const out = data.sharesOutstanding;
  const inst = data.summary.totalShares;
  const other = Math.max(0, out - inst);
  const pct = (n: number) => `${(n / out * 100).toFixed(1)}%`;
  const rows: { label: string; n: string; shares: number; indent?: boolean; strong?: boolean }[] = [
    { label: "13F Institutional Managers", n: data.summary.institutions.toLocaleString(), shares: inst, strong: true },
  ];
  if (funds) {
    rows.push({ label: "— of which mutual funds & ETFs", n: funds.summary.funds.toLocaleString(), shares: funds.summary.totalShares, indent: true });
  }
  rows.push({ label: "Insiders & other holders", n: "—", shares: other });

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-700">
        Ownership Profile by Institution Type
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2 text-left">Holder Type</th>
              <th className="px-4 py-2 text-right">Institutions</th>
              <th className="px-4 py-2 text-right">Shares</th>
              <th className="px-4 py-2 text-right">% of Shares Out</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.label} className={r.indent ? "bg-gray-50/50" : ""}>
                <td className={`px-4 py-2 ${r.indent ? "pl-8 text-gray-500 italic" : "text-gray-800 font-medium"}`}>{r.label}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-600">{r.n}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${r.strong ? "font-semibold text-gray-900" : "text-gray-700"}`}>{fmt(r.shares)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-600">{pct(r.shares)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
              <td className="px-4 py-2 text-gray-900">Total Shares Outstanding</td>
              <td className="px-4 py-2" />
              <td className="px-4 py-2 text-right tabular-nums text-gray-900">{fmt(out)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-600">100%</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-xs text-gray-400">Mutual-fund shares are a subset of the 13F total (each fund’s shares are also reported by its parent manager), shown indented to avoid double-counting.</p>
    </div>
  );
}

function ManagersSection({ managers, outShares }: { managers: FundManager[]; outShares: number }) {
  const acc = useMemo<Record<string, (m: FundManager) => number | string | null>>(() => ({
    manager: (m) => m.manager, funds: (m) => m.fundCount, shares: (m) => m.shares,
  }), []);
  const s = useSort(managers ?? [], acc, "shares");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setExpanded((prev) => {
    const n = new Set(prev);
    n.has(k) ? n.delete(k) : n.add(k);
    return n;
  });
  const allExpanded = expanded.size === (managers?.length ?? 0) && (managers?.length ?? 0) > 0;
  if (!managers || managers.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-gray-700">13F Managers with Affiliated Funds</span>
          <p className="text-xs text-gray-500 mt-0.5">Click a manager to see all of its affiliated funds. Funds not matched to a manager still appear in the fund list above.</p>
        </div>
        <button
          onClick={() => setExpanded(allExpanded ? new Set() : new Set(managers.map((m) => m.manager)))}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 hover:bg-gray-50 whitespace-nowrap"
        >
          {allExpanded ? "Collapse all" : "Expand all"}
        </button>
      </div>
      <div className="overflow-x-auto max-h-[70vh]">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky top-0">
            <tr>
              <SortTh id="manager" label="Manager" sort={s} />
              <SortTh id="funds" label="# Funds" sort={s} align="right" />
              <SortTh id="shares" label="Total Fund Shares" sort={s} align="right" />
              <th className="px-4 py-2 text-right">% Out</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {s.sorted.map((m) => {
              const open = expanded.has(m.manager);
              return (
                <Fragment key={m.manager}>
                  <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => toggle(m.manager)}>
                    <td className="px-4 py-2 font-medium text-gray-900 whitespace-nowrap">
                      <span className="inline-block w-4 text-gray-400">{open ? "▾" : "▸"}</span>{m.manager}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-700">{m.fundCount}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-900 font-semibold">{fmt(m.shares)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-600">{(m.shares / outShares * 100).toFixed(2)}%</td>
                  </tr>
                  {open && m.funds.map((f, i) => (
                    <tr key={`${m.manager}-${i}`} className="bg-gray-50/60">
                      <td className="pl-12 pr-4 py-1.5 text-gray-600" colSpan={2}>{decode(f.fundName)}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums text-gray-600">{fmt(f.shares)}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums text-gray-400">{(f.shares / outShares * 100).toFixed(3)}%</td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
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
