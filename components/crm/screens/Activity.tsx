"use client";

import { useMemo, useState } from "react";
import { useCrm } from "../store";
import { Badge, BtnPrimary, cleanName, fmtDate } from "../ui";
import { ActivityForm } from "../forms";
import { ACTIVITY_TYPES } from "@/lib/crm-types";

const SENT_COLOR: Record<string, string> = { Positive: "#059669", Neutral: "#94a3b8", Negative: "#dc2626" };

export default function Activity({ onOpenInvestor }: { onOpenInvestor: (id: string) => void }) {
  const { data } = useCrm();
  const [type, setType] = useState("All");
  const [adding, setAdding] = useState(false);
  const inv = (id: string) => data.investors.find((x) => x.id === id);

  const rows = useMemo(() =>
    [...data.activities]
      .filter((a) => type === "All" || a.type === type)
      .sort((a, b) => b.date.localeCompare(a.date)),
  [data.activities, type]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-700">
          {["All", ...ACTIVITY_TYPES].map((t) => <option key={t}>{t}</option>)}
        </select>
        <div className="ml-auto"><BtnPrimary onClick={() => setAdding(true)}>+ Log activity</BtnPrimary></div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-2 text-xs text-gray-400">{rows.length} interactions</div>
        <div className="divide-y divide-gray-50">
          {rows.map((a) => (
            <button key={a.id} onClick={() => onOpenInvestor(a.investorId)} className="block w-full px-4 py-3 text-left hover:bg-gray-50">
              <div className="flex items-center gap-2">
                <Badge label={a.type} color="#6366f1" subtle />
                <span className="text-sm font-medium text-gray-800">{a.subject}</span>
                {a.sentiment && <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: SENT_COLOR[a.sentiment] }} title={a.sentiment} />}
                <span className="ml-auto text-xs text-gray-400">{fmtDate(a.date)}</span>
              </div>
              <div className="mt-0.5 text-xs text-gray-500">{cleanName(inv(a.investorId)?.name ?? "")}</div>
              {a.notes && <p className="mt-1 line-clamp-2 text-sm text-gray-600">{a.notes}</p>}
            </button>
          ))}
        </div>
      </div>

      {adding && <ActivityForm onClose={() => setAdding(false)} />}
    </div>
  );
}
