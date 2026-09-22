"use client";

import { useMemo } from "react";
import { useCrm } from "../store";
import { Badge, PRIORITY_COLOR, STAGE_COLOR, fmtDate, daysUntil, cleanName } from "../ui";

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-2xl font-bold tabular-nums" style={{ color: tone ?? "#0f172a" }}>{value}</div>
      <div className="mt-0.5 text-xs text-gray-500">{label}</div>
    </div>
  );
}

export default function Home({ onOpenInvestor, goto }: { onOpenInvestor: (id: string) => void; goto: (tab: string) => void }) {
  const { data } = useCrm();
  const inv = (id?: string | null) => data.investors.find((x) => x.id === id);

  const owns = data.investors.filter((i) => i.stage === "Owns").length;
  const pipeline = data.investors.filter((i) => i.stage !== "Owns" && i.stage !== "Passed").length;
  const openTasks = data.tasks.filter((t) => !t.done);
  const dueThisWeek = openTasks
    .filter((t) => { const d = daysUntil(t.dueDate); return d != null && d <= 7; })
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  const recentAct = [...data.activities].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);

  // Owned holders (high/med priority) with no logged activity in 60+ days.
  const stale = useMemo(() => {
    const last: Record<string, string> = {};
    for (const a of data.activities) if (!last[a.investorId] || a.date > last[a.investorId]) last[a.investorId] = a.date;
    return data.investors
      .filter((i) => i.stage === "Owns" && i.priority !== "Low")
      .map((i) => ({ i, last: last[i.id] ?? null, d: daysUntil(last[i.id]) }))
      .filter((x) => x.last == null || (x.d != null && x.d <= -60))
      .sort((a, b) => (a.last ?? "").localeCompare(b.last ?? ""))
      .slice(0, 5);
  }, [data]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Investors owning" value={owns} tone="#059669" />
        <Stat label="In pipeline" value={pipeline} tone="#7c3aed" />
        <Stat label="Open tasks" value={openTasks.length} tone="#2563eb" />
        <Stat label="Due this week" value={dueThisWeek.length} tone={dueThisWeek.length ? "#dc2626" : "#0f172a"} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Due this week */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-900">Due this week</h3>
            <button onClick={() => goto("tasks")} className="text-xs font-medium text-blue-600 hover:underline">All tasks →</button>
          </div>
          <div className="divide-y divide-gray-50">
            {dueThisWeek.length === 0 && <div className="px-4 py-6 text-sm text-gray-400">Nothing due this week 🎉</div>}
            {dueThisWeek.map((t) => {
              const d = daysUntil(t.dueDate);
              const overdue = d != null && d < 0;
              return (
                <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: PRIORITY_COLOR[t.priority] }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-gray-800">{t.title}</div>
                    {t.investorId && <div className="truncate text-xs text-gray-400">{cleanName(inv(t.investorId)?.name ?? "")}</div>}
                  </div>
                  <span className={`shrink-0 text-xs font-medium ${overdue ? "text-red-600" : "text-gray-500"}`}>
                    {overdue ? `${-d!}d overdue` : d === 0 ? "Today" : `in ${d}d`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent activity */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-900">Recent activity</h3>
            <button onClick={() => goto("activity")} className="text-xs font-medium text-blue-600 hover:underline">All activity →</button>
          </div>
          <div className="divide-y divide-gray-50">
            {recentAct.map((a) => (
              <button key={a.id} onClick={() => onOpenInvestor(a.investorId)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-gray-800">{a.subject}</div>
                  <div className="truncate text-xs text-gray-400">{cleanName(inv(a.investorId)?.name ?? "")} · {a.type}</div>
                </div>
                <span className="shrink-0 text-xs text-gray-400">{fmtDate(a.date)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Needs attention */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">Needs attention</h3>
          <p className="text-xs text-gray-400">Key holders with no logged contact in 60+ days.</p>
        </div>
        <div className="divide-y divide-gray-50">
          {stale.length === 0 && <div className="px-4 py-6 text-sm text-gray-400">All key holders recently touched.</div>}
          {stale.map(({ i, last }) => (
            <button key={i.id} onClick={() => onOpenInvestor(i.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-gray-800">{cleanName(i.name)}</div>
                <div className="text-xs text-gray-400">Last contact: {last ? fmtDate(last) : "never logged"}</div>
              </div>
              <Badge label={i.stage} color={STAGE_COLOR[i.stage]} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
