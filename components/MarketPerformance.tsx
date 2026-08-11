"use client";

import { useMemo, useState } from "react";
import type { PricesData, PriceRow } from "@/lib/types";

// Colorblind-aware line colors. HEI/HEI-A and the S&P are emphasized; peers use
// an Okabe-Ito-derived set so lines stay distinguishable without relying on hue alone.
const LINE_COLORS: Record<string, string> = {
  "HEI": "#2563eb",
  "HEI/A": "#7c3aed",
  "S&P 500": "#6b7280",
  "RTX Corp": "#e69f00",
  "Boeing": "#009e73",
  "Howmet Aerospace": "#d55e00",
  "TransDigm": "#cc79a7",
  "Teledyne": "#0072b2",
  "Loar Holdings": "#56b4e9",
  "Arxis": "#b47846",
  "VSE Corp": "#ca9161",
  "FTAI Aviation": "#949494",
};
const DEFAULT_ON = ["HEI", "HEI/A", "S&P 500"];

function pctClass(n: number | null | undefined): string {
  if (n == null) return "text-gray-400";
  return n > 0 ? "text-green-600" : n < 0 ? "text-red-600" : "text-gray-500";
}
const pctStr = (n: number | null | undefined) =>
  n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compact = (n: number | null | undefined) =>
  n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${n}`;

// Where the last price sits inside the 52-week range, 0–100%.
function rangePos(r: PriceRow): number {
  if (r.high52 === r.low52) return 50;
  return Math.max(0, Math.min(100, ((r.last - r.low52) / (r.high52 - r.low52)) * 100));
}

function HeicoCard({ r }: { r: PriceRow }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-gray-700">{r.name}</span>
        <span className={`text-sm font-semibold ${pctClass(r.dayPct)}`}>{pctStr(r.dayPct)} today</span>
      </div>
      <div className="mt-1 flex items-baseline gap-3">
        <span className="text-3xl font-bold text-gray-900 tabular-nums">{money(r.last)}</span>
        <span className={`text-sm font-medium ${pctClass(r.ytdPct)}`}>{pctStr(r.ytdPct)} YTD</span>
      </div>
      {/* 52-week range bar */}
      <div className="mt-4">
        <div className="relative h-2 rounded-full bg-gradient-to-r from-red-200 via-amber-200 to-green-200">
          <div
            className="absolute -top-1 h-4 w-1 rounded-full bg-gray-900"
            style={{ left: `calc(${rangePos(r)}% - 2px)` }}
            title={`Last ${money(r.last)}`}
          />
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-gray-400 tabular-nums">
          <span>52-wk low {money(r.low52)}</span>
          <span>high {money(r.high52)}</span>
        </div>
      </div>
      <div className="mt-3 flex gap-4 text-xs text-gray-500">
        <span>Week <span className={pctClass(r.weekPct)}>{pctStr(r.weekPct)}</span></span>
        <span>Vol {compact(r.volume)}</span>
        <span>Avg {compact(r.avgVol)}</span>
      </div>
    </div>
  );
}

function ComparisonChart({ data }: { data: PricesData }) {
  const [on, setOn] = useState<Set<string>>(new Set(DEFAULT_ON));
  const lines = Object.keys(data.series).filter((k) => k !== "labels");
  const labels = data.series.labels;
  const W = 820, H = 340, PL = 44, PR = 12, PT = 14, PB = 24;

  const { paths, yMin, yMax, ticks } = useMemo(() => {
    const visible = lines.filter((l) => on.has(l));
    let lo = Infinity, hi = -Infinity;
    for (const l of visible) for (const v of data.series[l]) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!isFinite(lo)) { lo = 90; hi = 110; }
    const pad = (hi - lo) * 0.08 || 2;
    lo -= pad; hi += pad;
    const n = labels.length || 1;
    const x = (i: number) => PL + (i / Math.max(1, n - 1)) * (W - PL - PR);
    const y = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
    const paths: Record<string, string> = {};
    for (const l of visible) {
      let d = ""; let started = false;
      data.series[l].forEach((v, i) => {
        if (v == null) return;
        d += `${started ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
        started = true;
      });
      paths[l] = d;
    }
    const tickVals = [lo, (lo + hi) / 2, hi];
    const ticks = tickVals.map((v) => ({ v, y: y(v) }));
    return { paths, yMin: lo, yMax: hi, ticks };
  }, [on, data, labels.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const baseY = useMemo(() => {
    const y = (v: number) => PT + (1 - (v - yMin) / (yMax - yMin)) * (H - PT - PB);
    return y(100);
  }, [yMin, yMax]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">Year-to-date price performance <span className="font-normal text-gray-400">· indexed to 100 at Jan 1</span></span>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 560 }}>
          {/* y grid + labels */}
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={PL} y1={t.y} x2={W - PR} y2={t.y} stroke="#f1f5f9" />
              <text x={PL - 6} y={t.y + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{t.v.toFixed(0)}</text>
            </g>
          ))}
          {/* baseline at 100 */}
          {baseY > PT && baseY < H - PB && (
            <line x1={PL} y1={baseY} x2={W - PR} y2={baseY} stroke="#cbd5e1" strokeDasharray="3 3" />
          )}
          {/* x end labels */}
          {labels.length > 0 && (
            <>
              <text x={PL} y={H - 8} fontSize="10" fill="#94a3b8">{labels[0]}</text>
              <text x={W - PR} y={H - 8} textAnchor="end" fontSize="10" fill="#94a3b8">{labels[labels.length - 1]}</text>
            </>
          )}
          {/* lines — emphasized names drawn thicker/last */}
          {lines.filter((l) => on.has(l)).sort((a, b) => (DEFAULT_ON.includes(a) ? 1 : 0) - (DEFAULT_ON.includes(b) ? 1 : 0)).map((l) => (
            <path
              key={l}
              d={paths[l]}
              fill="none"
              stroke={LINE_COLORS[l] ?? "#94a3b8"}
              strokeWidth={l === "HEI" ? 2.6 : DEFAULT_ON.includes(l) ? 1.8 : 1.2}
              strokeDasharray={l === "S&P 500" ? "4 3" : undefined}
              opacity={DEFAULT_ON.includes(l) ? 1 : 0.85}
            />
          ))}
        </svg>
      </div>
      {/* legend / toggles */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {lines.map((l) => {
          const active = on.has(l);
          return (
            <button
              key={l}
              onClick={() => setOn((prev) => { const n = new Set(prev); n.has(l) ? n.delete(l) : n.add(l); return n; })}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                active ? "border-gray-300 bg-white text-gray-700" : "border-gray-200 bg-gray-50 text-gray-400"
              }`}
            >
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: active ? (LINE_COLORS[l] ?? "#94a3b8") : "#d1d5db" }} />
              {l}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PerfTable({ rows, label }: { rows: PriceRow[]; label: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-200 bg-gray-50">
          <tr>
            <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</th>
            <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Last</th>
            <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Day</th>
            <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Week</th>
            <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">YTD</th>
            <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">52-wk Range</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.symbol} className="hover:bg-gray-50">
              <td className="px-4 py-2.5 font-medium text-gray-800">{r.name} <span className="text-xs text-gray-400">{r.symbol.replace("^", "")}</span></td>
              <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{money(r.last)}</td>
              <td className={`px-4 py-2.5 text-right tabular-nums ${pctClass(r.dayPct)}`}>{pctStr(r.dayPct)}</td>
              <td className={`px-4 py-2.5 text-right tabular-nums ${pctClass(r.weekPct)}`}>{pctStr(r.weekPct)}</td>
              <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${pctClass(r.ytdPct)}`}>{pctStr(r.ytdPct)}</td>
              <td className="px-4 py-2.5">
                <div className="relative h-1.5 w-28 rounded-full bg-gray-200 ml-auto">
                  <div className="absolute -top-1 h-3.5 w-0.5 rounded bg-gray-700" style={{ left: `calc(${rangePos(r)}% - 1px)` }} title={`${money(r.low52)} – ${money(r.high52)}`} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MarketPerformance({ prices }: { prices: PricesData | null }) {
  if (!prices || !prices.main?.length) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Markets & Performance</h2>
        <span className="text-xs text-gray-400">End-of-day · {prices.asOfDate}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {prices.main.map((r) => <HeicoCard key={r.key ?? r.symbol} r={r} />)}
      </div>
      <ComparisonChart data={prices} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <PerfTable rows={prices.peers} label="Peer" />
        <PerfTable rows={prices.indices} label="Index" />
      </div>
      <p className="text-[11px] text-gray-400">Price data: Yahoo Finance (end-of-day). For reference only — not investment advice.</p>
    </div>
  );
}
