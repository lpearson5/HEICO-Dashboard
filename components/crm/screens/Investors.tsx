"use client";

import { useMemo, useState } from "react";
import { useCrm } from "../store";
import { Badge, BtnPrimary, cleanName, normName, STAGE_COLOR, STYLE_COLOR, PRIORITY_COLOR, fmtDate } from "../ui";
import { InvestorForm } from "../forms";
import { PIPELINE_STAGES, type LivePosition } from "@/lib/crm-types";

const fmtSh = (n: number | null) => n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${n}`;

export default function Investors({ live, onOpenInvestor }: { live: Record<string, LivePosition>; onOpenInvestor: (id: string) => void }) {
  const { data } = useCrm();
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("All");
  const [style, setStyle] = useState("All");
  const [esgOnly, setEsgOnly] = useState(false);
  const [adding, setAdding] = useState(false);

  const lastContact = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of data.activities) if (!m[a.investorId] || a.date > m[a.investorId]) m[a.investorId] = a.date;
    return m;
  }, [data.activities]);

  const rows = useMemo(() => {
    return data.investors
      .filter((i) => stage === "All" || i.stage === stage)
      .filter((i) => style === "All" || i.style === style)
      .filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()) || i.tags.some((t) => t.toLowerCase().includes(q.toLowerCase())))
      .map((i) => ({ i, pos: live[normName(i.name)], last: lastContact[i.id] }))
      .filter((r) => !esgOnly || !!r.pos?.esg)
      .sort((a, b) => (b.pos?.shares ?? 0) - (a.pos?.shares ?? 0) || a.i.name.localeCompare(b.i.name));
  }, [data.investors, stage, style, q, esgOnly, live, lastContact]);

  const styles = ["All", "Growth", "Value", "Momentum/Quant", "Income", "Blend/Core", "Unclassified"];
  const selCls = "rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-700";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search firm or tag…" className="min-w-[180px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
        <select value={stage} onChange={(e) => setStage(e.target.value)} className={selCls}>
          {["All", ...PIPELINE_STAGES].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={style} onChange={(e) => setStyle(e.target.value)} className={selCls}>
          {styles.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button
          onClick={() => setEsgOnly((v) => !v)}
          className={`rounded-lg border px-3 py-2 text-sm font-medium ${esgOnly ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}
          title="Show only ESG / sustainable investors"
        >
          🌱 ESG only
        </button>
        <BtnPrimary onClick={() => setAdding(true)}>+ Add investor</BtnPrimary>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-2 text-xs text-gray-400">{rows.length} investors</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Firm</th>
                <th className="px-4 py-3">Stage</th>
                <th className="px-4 py-3">Style</th>
                <th className="px-4 py-3 text-right">Shares</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Last contact</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ i, pos, last }) => (
                <tr key={i.id} onClick={() => onOpenInvestor(i.id)} className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{cleanName(i.name)}</span>
                      {pos?.esg && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700" title={pos.esg}>🌱 ESG</span>}
                    </div>
                    <div className="text-xs text-gray-400">{[i.city, i.country].filter(Boolean).join(", ")}</div>
                  </td>
                  <td className="px-4 py-3"><Badge label={i.stage} color={STAGE_COLOR[i.stage]} /></td>
                  <td className="px-4 py-3">{i.style ? <Badge label={i.style} color={STYLE_COLOR[i.style] ?? "#64748b"} subtle /> : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{fmtSh(pos?.shares ?? null)}</td>
                  <td className="px-4 py-3"><span className="inline-flex items-center gap-1 text-xs text-gray-600"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: PRIORITY_COLOR[i.priority] }} />{i.priority}</span></td>
                  <td className="px-4 py-3 text-xs text-gray-500">{last ? fmtDate(last) : <span className="text-gray-300">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {adding && <InvestorForm onClose={() => setAdding(false)} />}
    </div>
  );
}
