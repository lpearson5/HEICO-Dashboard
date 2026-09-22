"use client";

import { useState } from "react";
import { useCrm } from "./store";
import { Modal, Badge, Avatar, BtnPrimary, BtnGhost, fmtDate, cleanName, normName, STAGE_COLOR, STYLE_COLOR, PRIORITY_COLOR } from "./ui";
import { ContactForm, ActivityForm, TaskForm, InvestorForm } from "./forms";
import type { LivePosition, Contact, Activity, Task } from "@/lib/crm-types";

const SENT_COLOR: Record<string, string> = { Positive: "#059669", Neutral: "#94a3b8", Negative: "#dc2626" };
const fmtVal = (n: number | null) => n == null ? "—" : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${(n / 1e3).toFixed(0)}K`;
const fmtSh = (n: number | null) => n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n.toLocaleString("en-US");

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
        {action}
      </div>
      {children}
    </div>
  );
}

export default function InvestorDetail({ investorId, live, onClose }: { investorId: string; live: Record<string, LivePosition>; onClose: () => void }) {
  const { data, dispatch } = useCrm();
  const investor = data.investors.find((i) => i.id === investorId);
  const [modal, setModal] = useState<null | { kind: string; item?: any }>(null);

  if (!investor) return null;
  const contacts = data.contacts.filter((c) => c.investorId === investorId).sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
  const activities = data.activities.filter((a) => a.investorId === investorId).sort((a, b) => b.date.localeCompare(a.date));
  const tasks = data.tasks.filter((t) => t.investorId === investorId).sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  const owner = data.team.find((t) => t.id === investor.ownerId);
  const pos = live[normName(investor.name)];

  return (
    <Modal title={cleanName(investor.name)} onClose={onClose} wide
      footer={<BtnGhost onClick={onClose}>Close</BtnGhost>}>
      <div className="space-y-4">
        {/* header badges */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge label={investor.stage} color={STAGE_COLOR[investor.stage]} />
          {investor.style && <Badge label={investor.style} color={STYLE_COLOR[investor.style] ?? "#64748b"} />}
          <Badge label={`${investor.priority} priority`} color={PRIORITY_COLOR[investor.priority]} />
          <Badge label={investor.klass} color="#334155" subtle />
          {pos?.esg && <Badge label={`🌱 ${pos.esg}`} color="#059669" />}
          {investor.tags.map((t) => <Badge key={t} label={t} color="#0ea5e9" subtle />)}
          <button onClick={() => setModal({ kind: "editInvestor" })} className="ml-auto text-xs font-medium text-blue-600 hover:underline">Edit</button>
        </div>
        <div className="text-xs text-gray-500">
          {[investor.city, investor.country].filter(Boolean).join(", ") || "Location —"} · Owner: {owner?.name ?? "—"}
        </div>

        {/* live position (auto-linked to dashboard data) */}
        <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-slate-50 to-white p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Live position (from dashboard)</div>
          {pos ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><div className="text-lg font-bold tabular-nums text-gray-900">{fmtSh(pos.shares)}</div><div className="text-xs text-gray-500">shares</div></div>
              <div><div className="text-lg font-bold tabular-nums text-gray-900">{fmtVal(pos.value)}</div><div className="text-xs text-gray-500">value</div></div>
              <div><div className={`text-lg font-bold ${pos.action === "Bought" || pos.action === "New Position" ? "text-green-600" : pos.action === "Sold" || pos.action === "Sell Out" ? "text-red-600" : "text-gray-700"}`}>{pos.action ?? "—"}</div><div className="text-xs text-gray-500">this quarter</div></div>
              <div><div className="text-lg font-bold tabular-nums text-gray-900">{pos.pctChange == null ? "—" : `${pos.pctChange > 0 ? "+" : ""}${pos.pctChange}%`}</div><div className="text-xs text-gray-500">QoQ change</div></div>
            </div>
          ) : (
            <div className="text-sm text-gray-500">Not a current 13F holder — {investor.stage === "Target" || investor.stage === "Contacted" || investor.stage === "Engaged" ? "prospective (target)." : "no matched position."}</div>
          )}
        </div>

        {/* contacts */}
        <Section title={`Contacts (${contacts.length})`} action={<button onClick={() => setModal({ kind: "addContact" })} className="text-xs font-medium text-blue-600 hover:underline">+ Add</button>}>
          {contacts.length === 0 && <div className="px-4 py-4 text-sm text-gray-400">No contacts yet.</div>}
          <div className="divide-y divide-gray-50">
            {contacts.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar name={c.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-800">{c.name}{c.primary && <span className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-700">primary</span>}</div>
                  <div className="truncate text-xs text-gray-500">{[c.title, c.email, c.phone].filter(Boolean).join(" · ") || "—"}</div>
                </div>
                <button onClick={() => setModal({ kind: "editContact", item: c })} className="text-xs text-gray-400 hover:text-blue-600">Edit</button>
                <button onClick={() => confirm(`Delete contact ${c.name}?`) && dispatch({ t: "contact.delete", id: c.id })} className="text-xs text-gray-400 hover:text-red-600">Delete</button>
              </div>
            ))}
          </div>
        </Section>

        {/* activity timeline */}
        <Section title={`Activity (${activities.length})`} action={<button onClick={() => setModal({ kind: "addActivity" })} className="text-xs font-medium text-blue-600 hover:underline">+ Log</button>}>
          {activities.length === 0 && <div className="px-4 py-4 text-sm text-gray-400">No activity logged yet.</div>}
          <div className="divide-y divide-gray-50">
            {activities.map((a) => (
              <div key={a.id} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <Badge label={a.type} color="#6366f1" subtle />
                  <span className="text-sm font-medium text-gray-800">{a.subject}</span>
                  {a.sentiment && <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: SENT_COLOR[a.sentiment] }} title={a.sentiment} />}
                  <span className="ml-auto text-xs text-gray-400">{fmtDate(a.date)}</span>
                </div>
                {a.notes && <p className="mt-1 text-sm text-gray-600">{a.notes}</p>}
                <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                  {a.attendees && <span>HEICO: {a.attendees}</span>}
                  <button onClick={() => setModal({ kind: "editActivity", item: a })} className="hover:text-blue-600">Edit</button>
                  <button onClick={() => confirm("Delete this activity?") && dispatch({ t: "activity.delete", id: a.id })} className="hover:text-red-600">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* tasks */}
        <Section title={`Tasks (${tasks.filter((t) => !t.done).length} open)`} action={<button onClick={() => setModal({ kind: "addTask" })} className="text-xs font-medium text-blue-600 hover:underline">+ Add</button>}>
          {tasks.length === 0 && <div className="px-4 py-4 text-sm text-gray-400">No tasks.</div>}
          <div className="divide-y divide-gray-50">
            {tasks.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                <input type="checkbox" checked={t.done} onChange={() => dispatch({ t: "task.toggle", id: t.id })} className="h-4 w-4 rounded border-gray-300" />
                <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: PRIORITY_COLOR[t.priority] }} />
                <div className="min-w-0 flex-1">
                  <div className={`text-sm ${t.done ? "text-gray-400 line-through" : "text-gray-800"}`}>{t.title}</div>
                  {t.dueDate && <div className="text-xs text-gray-400">Due {fmtDate(t.dueDate)}</div>}
                </div>
                <button onClick={() => setModal({ kind: "editTask", item: t })} className="text-xs text-gray-400 hover:text-blue-600">Edit</button>
              </div>
            ))}
          </div>
        </Section>

        {/* notes */}
        {investor.notes && (
          <Section title="Notes"><p className="px-4 py-3 text-sm text-gray-600">{investor.notes}</p></Section>
        )}

        <div className="flex justify-end">
          <button onClick={() => confirm(`Delete ${cleanName(investor.name)} and all its records?`) && (dispatch({ t: "investor.delete", id: investor.id }), onClose())} className="text-xs text-gray-400 hover:text-red-600">Delete investor</button>
        </div>
      </div>

      {/* sub-modals */}
      {modal?.kind === "editInvestor" && <InvestorForm existing={investor} onClose={() => setModal(null)} />}
      {modal?.kind === "addContact" && <ContactForm investorId={investorId} onClose={() => setModal(null)} />}
      {modal?.kind === "editContact" && <ContactForm investorId={investorId} existing={modal.item as Contact} onClose={() => setModal(null)} />}
      {modal?.kind === "addActivity" && <ActivityForm investorId={investorId} onClose={() => setModal(null)} />}
      {modal?.kind === "editActivity" && <ActivityForm investorId={investorId} existing={modal.item as Activity} onClose={() => setModal(null)} />}
      {modal?.kind === "addTask" && <TaskForm investorId={investorId} onClose={() => setModal(null)} />}
      {modal?.kind === "editTask" && <TaskForm investorId={investorId} existing={modal.item as Task} onClose={() => setModal(null)} />}
    </Modal>
  );
}
