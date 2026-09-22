"use client";

import { useMemo, useState } from "react";
import { useCrm } from "../store";
import { Avatar, BtnPrimary, cleanName } from "../ui";
import { ContactForm } from "../forms";

export default function Contacts({ onOpenInvestor }: { onOpenInvestor: (id: string) => void }) {
  const { data } = useCrm();
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const inv = (id: string) => data.investors.find((x) => x.id === id);

  const rows = useMemo(() =>
    [...data.contacts]
      .filter((c) => {
        if (!q) return true;
        const firm = inv(c.investorId)?.name ?? "";
        return [c.name, c.title, c.role, c.email, firm].some((s) => (s ?? "").toLowerCase().includes(q.toLowerCase()));
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  [data.contacts, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people, firm, role…" className="min-w-[180px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
        <BtnPrimary onClick={() => setAdding(true)}>+ Add contact</BtnPrimary>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-2 text-xs text-gray-400">{rows.length} people</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Firm</th>
                <th className="px-4 py-3">Title / role</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Phone</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} onClick={() => onOpenInvestor(c.investorId)} className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Avatar name={c.name} />
                      <span className="font-medium text-gray-900">{c.name}</span>
                      {c.primary && <span className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-700">primary</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{cleanName(inv(c.investorId)?.name ?? "")}</td>
                  <td className="px-4 py-3 text-gray-600">{[c.title, c.role].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-4 py-3 text-gray-500">{c.email || "—"}</td>
                  <td className="px-4 py-3 text-gray-500">{c.phone || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {adding && <ContactForm onClose={() => setAdding(false)} />}
    </div>
  );
}
