"use client";

import type { EarningsData, EarningsRow } from "@/lib/types";

const monthKey = (d: string) => {
  const dt = new Date(d + "T00:00:00Z");
  return dt.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};
const dayLabel = (d: string) => {
  const dt = new Date(d + "T00:00:00Z");
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
};

export default function EarningsCalendar({ data }: { data: EarningsData | null }) {
  if (!data || !data.companies?.length) return null;
  const upcoming = data.companies
    .filter((c) => c.nextEstimated?.date)
    .sort((a, b) => a.nextEstimated!.date.localeCompare(b.nextEstimated!.date));
  const hei = data.companies.find((c) => c.main);

  // Group by month.
  const groups: { month: string; rows: EarningsRow[] }[] = [];
  for (const c of upcoming) {
    const m = monthKey(c.nextEstimated!.date);
    let g = groups.find((x) => x.month === m);
    if (!g) { g = { month: m, rows: [] }; groups.push(g); }
    g.rows.push(c);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Earnings Calendar</h2>
        <span className="text-xs text-gray-400">Estimated report dates · HEICO + peers</span>
      </div>

      {hei?.nextEstimated && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
          <div className="text-xs font-medium text-blue-700">HEICO&apos;s next report (estimated)</div>
          <div className="mt-0.5 flex items-baseline gap-3">
            <span className="text-2xl font-bold text-gray-900">{dayLabel(hei.nextEstimated.date)}</span>
            <span className="text-sm text-gray-500">in ~{hei.nextEstimated.daysAway} days</span>
          </div>
          {hei.lastReport && <div className="mt-1 text-[11px] text-gray-500">Last reported quarter ended {hei.lastReport.period}</div>}
        </div>
      )}

      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.month} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-gray-100 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-700">{g.month}</div>
            <ul className="divide-y divide-gray-100">
              {g.rows.map((c) => (
                <li key={c.sym} className={`flex items-center justify-between px-4 py-2.5 ${c.main ? "bg-blue-50/40" : ""}`}>
                  <div className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-sm font-medium tabular-nums text-gray-700">{dayLabel(c.nextEstimated!.date)}</span>
                    <span className={`text-sm ${c.main ? "font-semibold text-gray-900" : "text-gray-700"}`}>{c.name} <span className="text-xs text-gray-400">{c.sym}</span></span>
                  </div>
                  <span className="text-xs text-gray-400">~{c.nextEstimated!.daysAway}d</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-gray-400">
        Dates are <b>estimated</b> from each company&apos;s historical SEC filing cadence (next fiscal quarter‑end + typical filing lag) — actual earnings dates may differ by a week or more. Exact confirmed dates require a paid calendar feed.
      </p>
    </div>
  );
}
