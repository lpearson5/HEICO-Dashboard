"use client";

import { useMemo, useState } from "react";
import { useCrm } from "../store";
import { BtnPrimary, PRIORITY_COLOR, cleanName, fmtDate, daysUntil } from "../ui";
import { TaskForm } from "../forms";
import type { Task } from "@/lib/crm-types";

export default function Tasks({ onOpenInvestor }: { onOpenInvestor: (id: string) => void }) {
  const { data, dispatch } = useCrm();
  const [filter, setFilter] = useState<"open" | "all" | "done">("open");
  const [editing, setEditing] = useState<Task | null>(null);
  const [adding, setAdding] = useState(false);
  const inv = (id?: string | null) => data.investors.find((x) => x.id === id);
  const who = (id?: string | null) => data.team.find((t) => t.id === id)?.name ?? "—";

  const rows = useMemo(() =>
    [...data.tasks]
      .filter((t) => filter === "all" ? true : filter === "done" ? t.done : !t.done)
      .sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")),
  [data.tasks, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
          {(["open", "all", "done"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 font-medium capitalize ${filter === f ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}>{f}</button>
          ))}
        </div>
        <div className="ml-auto"><BtnPrimary onClick={() => setAdding(true)}>+ Add task</BtnPrimary></div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="divide-y divide-gray-50">
          {rows.length === 0 && <div className="px-4 py-6 text-sm text-gray-400">No tasks.</div>}
          {rows.map((t) => {
            const d = daysUntil(t.dueDate);
            const overdue = !t.done && d != null && d < 0;
            return (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                <input type="checkbox" checked={t.done} onChange={() => dispatch({ t: "task.toggle", id: t.id })} className="h-4 w-4 rounded border-gray-300" />
                <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: PRIORITY_COLOR[t.priority] }} />
                <div className="min-w-0 flex-1">
                  <div className={`text-sm ${t.done ? "text-gray-400 line-through" : "text-gray-800"}`}>{t.title}</div>
                  <div className="text-xs text-gray-400">
                    {t.investorId ? <button onClick={() => onOpenInvestor(t.investorId!)} className="hover:text-blue-600 hover:underline">{cleanName(inv(t.investorId)?.name ?? "")}</button> : "General"} · {who(t.assigneeId)}
                  </div>
                </div>
                {t.dueDate && <span className={`shrink-0 text-xs font-medium ${overdue ? "text-red-600" : "text-gray-500"}`}>{overdue ? `${-d!}d overdue` : fmtDate(t.dueDate)}</span>}
                <button onClick={() => setEditing(t)} className="shrink-0 text-xs text-gray-400 hover:text-blue-600">Edit</button>
                <button onClick={() => confirm("Delete task?") && dispatch({ t: "task.delete", id: t.id })} className="shrink-0 text-xs text-gray-400 hover:text-red-600">✕</button>
              </div>
            );
          })}
        </div>
      </div>

      {adding && <TaskForm onClose={() => setAdding(false)} />}
      {editing && <TaskForm existing={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
