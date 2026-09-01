"use client";

import { useState } from "react";
import type { ShortInterestData, ShortTicker } from "@/lib/types";

const fmtSh = (n: number | null | undefined) =>
  n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${n}`;
const pct = (n: number | null | undefined, d = 1) => (n == null ? "—" : `${n.toFixed(d)}%`);

// For short interest, a DECLINE is bullish (shorts covering) and a RISE is bearish.
function changeClass(n: number | null | undefined): string {
  if (n == null) return "text-gray-400";
  return n < 0 ? "text-green-600" : n > 0 ? "text-red-600" : "text-gray-500";
}

function TrendChart({ t }: { t: ShortTicker }) {
  const h = t.history ?? [];
  if (h.length < 2) return null;
  const W = 760, H = 200, PL = 46, PR = 12, PT = 12, PB = 22;
  const vals = h.map((r) => r.si);
  const lo = Math.min(...vals) * 0.98, hi = Math.max(...vals) * 1.02;
  const x = (i: number) => PL + (i / (h.length - 1)) * (W - PL - PR);
  const y = (v: number) => PT + (1 - (v - lo) / (hi - lo || 1)) * (H - PT - PB);
  const path = h.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r.si).toFixed(1)}`).join(" ");
  const ticks = [lo, (lo + hi) / 2, hi];
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 520 }}>
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={PL} y1={y(v)} x2={W - PR} y2={y(v)} stroke="#f1f5f9" />
            <text x={PL - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{fmtSh(v)}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke="#6366f1" strokeWidth={2} />
        {h.map((r, i) => <circle key={i} cx={x(i)} cy={y(r.si)} r={1.6} fill="#6366f1" />)}
        <text x={PL} y={H - 6} fontSize="10" fill="#94a3b8">{h[0].date}</text>
        <text x={W - PR} y={H - 6} textAnchor="end" fontSize="10" fill="#94a3b8">{h[h.length - 1].date}</text>
      </svg>
    </div>
  );
}

function Card({ t }: { t: ShortTicker }) {
  const l = t.latest;
  const prior = t.history.length >= 2 ? t.history[t.history.length - 2] : null;
  const siChg = l && prior ? l.si - prior.si : null;
  const siChgPct = l && prior && prior.si ? (siChg! / prior.si) * 100 : null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-gray-700">{t.name}</span>
        <span className="text-xs text-gray-400">{l?.date ?? "—"}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-3">
        <span className="text-2xl font-bold text-gray-900 tabular-nums">{fmtSh(l?.si)}</span>
        <span className="text-xs text-gray-500">shares short</span>
        {siChgPct != null && (
          <span className={`text-xs font-medium ${changeClass(siChgPct)}`}>
            {siChgPct > 0 ? "+" : ""}{siChgPct.toFixed(1)}% vs prior
          </span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-gray-50 p-2"><div className="text-gray-500">% of shares out</div><div className="text-sm font-semibold text-gray-800">{pct(t.pctFloat)}</div></div>
        <div className="rounded-lg bg-gray-50 p-2"><div className="text-gray-500">Days to cover</div><div className="text-sm font-semibold text-gray-800">{l?.daysToCover?.toFixed(1) ?? "—"}</div></div>
      </div>
    </div>
  );
}

export default function ShortInterest({ data }: { data: ShortInterestData | null }) {
  const [sel, setSel] = useState<string>("HEI");
  if (!data || !data.tickers?.length) return null;
  const main = data.tickers.filter((t) => t.main && t.latest);
  const peers = data.tickers.filter((t) => !t.main);
  const selTicker = data.tickers.find((t) => t.sym === sel) ?? main[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Short Interest</h2>
        <span className="text-xs text-gray-400">FINRA bi-monthly · {selTicker?.latest?.date ?? ""}</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {main.map((t) => <Card key={t.sym} t={t} />)}
      </div>

      {/* Trend chart */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-gray-700">Short interest trend <span className="font-normal text-gray-400">· shares short</span></span>
          <div className="flex flex-wrap gap-1">
            {data.tickers.filter((t) => t.history.length >= 2).map((t) => (
              <button key={t.sym} onClick={() => setSel(t.sym)}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${sel === t.sym ? "border-indigo-600 bg-indigo-600 text-white" : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"}`}>
                {t.sym}
              </button>
            ))}
          </div>
        </div>
        {selTicker && <TrendChart t={selTicker} />}
      </div>

      {/* Peer comparison */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              {["Peer", "Short interest", "% of shares out", "Days to cover", "Change"].map((h, i) => (
                <th key={h} className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500 ${i ? "text-right" : "text-left"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {[...main, ...peers].filter((t) => t.latest).map((t) => (
              <tr key={t.sym} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 font-medium text-gray-800">{t.name} <span className="text-xs text-gray-400">{t.sym}</span></td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{fmtSh(t.latest!.si)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{pct(t.pctFloat)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{t.latest!.daysToCover?.toFixed(1) ?? "—"}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${changeClass(t.latest!.changePct)}`}>{t.latest!.changePct == null ? "—" : `${t.latest!.changePct > 0 ? "+" : ""}${t.latest!.changePct.toFixed(1)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400">Consolidated short interest from FINRA (settled, published twice monthly). A rising short interest is generally bearish sentiment; a decline (shorts covering) is bullish. % of shares out uses SEC share counts.</p>
    </div>
  );
}
