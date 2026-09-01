"use client";

import { useEffect, useState } from "react";
import type { FundamentalsData, FundamentalRow, PricesData } from "@/lib/types";

// HEICO is dual-class; total market cap spans both classes.
const HEI_SHARES = 55_170_957, HEIA_SHARES = 84_488_320;

const money = (n: number | null) =>
  n == null ? "—" : n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : `$${n.toFixed(0)}`;
const mult = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}x`);
const pctS = (n: number | null) => (n == null ? "—" : `${n.toFixed(2)}%`);
const px = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);

interface M { price: number | null; mktCap: number | null; pe: number | null; ps: number | null; evEbitda: number | null; divYld: number | null }

function metricsOf(c: FundamentalRow, priceMap: Record<string, number>): M {
  const price = priceMap[c.sym] ?? null;
  let mktCap: number | null = null;
  if (c.main) {
    const p = priceMap["HEI"], pa = priceMap["HEIA"];
    mktCap = ((p ? p * HEI_SHARES : 0) + (pa ? pa * HEIA_SHARES : 0)) || null;
  } else if (price != null && c.shares) {
    mktCap = price * c.shares;
  }
  const pe = mktCap && c.netIncomeTTM && c.netIncomeTTM > 0 ? mktCap / c.netIncomeTTM : null;
  const ps = mktCap && c.revenueTTM && c.revenueTTM > 0 ? mktCap / c.revenueTTM : null;
  const ev = mktCap != null ? mktCap + (c.totalDebt ?? 0) - (c.cash ?? 0) : null;
  const evEbitda = ev != null && c.ebitdaTTM && c.ebitdaTTM > 0 ? ev / c.ebitdaTTM : null;
  const divYld = c.dividendPerShareTTM && price ? (c.dividendPerShareTTM / price) * 100 : null;
  return { price, mktCap, pe, ps, evEbitda, divYld };
}

const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null && isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export default function Valuation({ fundamentals }: { fundamentals: FundamentalsData | null }) {
  const [prices, setPrices] = useState<PricesData | null>(null);
  useEffect(() => {
    (async () => {
      try { const r = await fetch("/api/prices", { cache: "no-store" }); if (r.ok) setPrices(await r.json()); } catch { /* ignore */ }
    })();
  }, []);

  if (!fundamentals || !fundamentals.companies?.length) return null;

  const priceMap: Record<string, number> = {};
  if (prices) {
    for (const r of prices.main ?? []) if (r.key) priceMap[r.key] = r.last;
    for (const r of prices.peers ?? []) priceMap[r.symbol] = r.last;
  }

  const rows = fundamentals.companies.map((c) => ({ c, m: metricsOf(c, priceMap) }));
  const peerRows = rows.filter((r) => !r.c.main);
  const peerAvg = {
    pe: avg(peerRows.map((r) => r.m.pe)),
    evEbitda: avg(peerRows.map((r) => r.m.evEbitda)),
    ps: avg(peerRows.map((r) => r.m.ps)),
    divYld: avg(peerRows.map((r) => r.m.divYld)),
  };
  const hei = rows.find((r) => r.c.main);

  const Cell = ({ children, className = "" }: { children: React.ReactNode; className?: string }) =>
    <td className={`px-3 py-2.5 text-right tabular-nums ${className}`}>{children}</td>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Valuation</h2>
        <span className="text-xs text-gray-400">Live price × trailing-12-month fundamentals (SEC){prices ? "" : " · loading prices…"}</span>
      </div>

      {/* HEICO headline vs peer average */}
      {hei && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {([
            ["P/E", hei.m.pe, peerAvg.pe, mult],
            ["EV/EBITDA", hei.m.evEbitda, peerAvg.evEbitda, mult],
            ["P/Sales", hei.m.ps, peerAvg.ps, mult],
            ["Dividend yield", hei.m.divYld, peerAvg.divYld, pctS],
          ] as const).map(([label, v, pv, fmt]) => (
            <div key={label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-2xl font-bold text-gray-900 tabular-nums">{fmt(v as number | null)}</div>
              <div className="mt-0.5 text-xs font-medium text-gray-500">HEICO {label}</div>
              <div className="mt-0.5 text-[11px] text-gray-400">Peer avg {fmt(pv as number | null)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Full table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Company</th>
              {["Price", "Market cap", "P/E", "EV/EBITDA", "P/Sales", "Div yield", "Revenue (TTM)"].map((h) => (
                <th key={h} className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(({ c, m }) => (
              <tr key={c.sym} className={c.main ? "bg-blue-50/50 font-medium" : "hover:bg-gray-50"}>
                <td className="px-3 py-2.5 text-gray-800">{c.name} <span className="text-xs text-gray-400">{c.sym}</span></td>
                <Cell className="text-gray-700">{px(m.price)}</Cell>
                <Cell className="text-gray-700">{money(m.mktCap)}</Cell>
                <Cell className="text-gray-800">{mult(m.pe)}</Cell>
                <Cell className="text-gray-800">{mult(m.evEbitda)}</Cell>
                <Cell className="text-gray-800">{mult(m.ps)}</Cell>
                <Cell className="text-gray-800">{pctS(m.divYld)}</Cell>
                <Cell className="text-gray-600">{money(c.revenueTTM)}</Cell>
              </tr>
            ))}
            <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-gray-700">
              <td className="px-3 py-2.5">Peer average</td>
              <Cell>—</Cell><Cell>—</Cell>
              <Cell>{mult(peerAvg.pe)}</Cell>
              <Cell>{mult(peerAvg.evEbitda)}</Cell>
              <Cell>{mult(peerAvg.ps)}</Cell>
              <Cell>{pctS(peerAvg.divYld)}</Cell>
              <Cell>—</Cell>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400">
        Multiples use the live share price and trailing-12-month figures from SEC filings (net income, revenue, EBITDA = operating income + D&A; EV = market cap + debt − cash). P/E is blank for companies with negative earnings. Forward multiples and analyst targets require a paid estimates feed and are not shown. For reference only — not investment advice.
      </p>
    </div>
  );
}
