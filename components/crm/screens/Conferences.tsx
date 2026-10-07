"use client";

import { useMemo, useState } from "react";
import { useCrm } from "../store";
import { Modal, Badge, BtnPrimary, BtnGhost, cleanName, fmtDate, daysUntil, STAGE_COLOR } from "../ui";
import { ConferenceForm, AttendeeForm } from "../forms";
import type { Conference, ConferenceAttendee } from "@/lib/crm-types";

const TYPE_COLOR: Record<string, string> = {
  "Conference": "#4f46e5", "Roadshow / NDR": "#0d9488", "Investor Day": "#d97706", "Site Visit": "#db2777", "Virtual": "#64748b",
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayIso = () => iso(new Date());

function dateRange(c: Conference) {
  return c.startDate === c.endDate ? fmtDate(c.startDate) : `${fmtDate(c.startDate)} – ${fmtDate(c.endDate)}`;
}

// ── Month calendar ──────────────────────────────────────────────────
function Calendar({ conferences, onOpen, onAddOn }: { conferences: Conference[]; onOpen: (id: string) => void; onAddOn: (date: string) => void }) {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const first = new Date(ym.y, ym.m, 1);
  const start = new Date(first); start.setDate(1 - first.getDay()); // back to Sunday
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const lastRowUsed = days.slice(35).some((d) => d.getMonth() === ym.m);
  const shown = lastRowUsed ? days : days.slice(0, 35);
  const today = todayIso();
  const move = (n: number) => setYm(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <button onClick={() => move(-1)} className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100" aria-label="Previous month">‹</button>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-900">{MONTHS[ym.m]} {ym.y}</span>
          <button onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() })} className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-50">Today</button>
        </div>
        <button onClick={() => move(1)} className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100" aria-label="Next month">›</button>
      </div>
      <div className="overflow-x-auto">
        <div className="grid grid-cols-7" style={{ minWidth: 560 }}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="border-b border-gray-100 bg-gray-50 px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-400">{d}</div>
          ))}
          {shown.map((d) => {
            const key = iso(d);
            const inMonth = d.getMonth() === ym.m;
            const events = conferences.filter((c) => c.startDate <= key && key <= c.endDate);
            return (
              <div key={key} onDoubleClick={() => onAddOn(key)} title="Double-click to add a conference on this day"
                className={`min-h-[84px] border-b border-r border-gray-100 p-1 ${inMonth ? "bg-white" : "bg-gray-50/60"}`}>
                <div className={`mb-0.5 text-right text-[11px] ${key === today ? "font-bold text-indigo-600" : inMonth ? "text-gray-500" : "text-gray-300"}`}>
                  {key === today ? <span className="rounded-full bg-indigo-600 px-1.5 py-0.5 text-white">{d.getDate()}</span> : d.getDate()}
                </div>
                <div className="space-y-0.5">
                  {events.map((c) => (
                    <button key={c.id} onClick={() => onOpen(c.id)} title={`${c.name} · ${c.attendees.length} investor meeting(s)`}
                      className="block w-full truncate rounded px-1 py-0.5 text-left text-[10.5px] font-medium text-white hover:opacity-90"
                      style={{ backgroundColor: TYPE_COLOR[c.type] ?? "#4f46e5" }}>
                      {key === c.startDate || d.getDay() === 0 ? c.name : " "}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap gap-3 border-t border-gray-100 px-4 py-2 text-[11px] text-gray-500">
        {Object.entries(TYPE_COLOR).map(([t, c]) => <span key={t} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: c }} />{t}</span>)}
        <span className="ml-auto text-gray-400">Double-click a day to add an event</span>
      </div>
    </div>
  );
}

// ── Conference detail (who's attending) ─────────────────────────────
function ConferenceDetail({ confId, onClose, onOpenInvestor }: { confId: string; onClose: () => void; onOpenInvestor: (id: string) => void }) {
  const { data, dispatch } = useCrm();
  const conf = data.conferences.find((c) => c.id === confId);
  const [modal, setModal] = useState<null | { kind: "edit" } | { kind: "addMtg" } | { kind: "editMtg"; item: ConferenceAttendee }>(null);
  const [logged, setLogged] = useState<Set<string>>(new Set());
  if (!conf) return null;

  const team = conf.heicoAttendeeIds.map((id) => data.team.find((t) => t.id === id)?.name).filter(Boolean) as string[];
  const inv = (id: string) => data.investors.find((i) => i.id === id);
  const contactName = (id: string) => data.contacts.find((c) => c.id === id)?.name;
  const d = daysUntil(conf.startDate);
  const when = d == null ? "" : d > 0 ? `in ${d} day${d === 1 ? "" : "s"}` : (daysUntil(conf.endDate) ?? 0) >= 0 ? "happening now" : "past";

  const logActivity = (m: ConferenceAttendee) => {
    dispatch({ t: "activity.add", v: {
      investorId: m.investorId, contactIds: m.contactIds, type: "Conference 1x1", date: conf.startDate,
      subject: `${conf.name}${m.format !== "1x1" ? ` (${m.format})` : ""}`, notes: m.notes ?? "", attendees: team.join(", "), sentiment: null,
    } });
    setLogged((s) => new Set(s).add(m.id));
  };

  return (
    <Modal title={conf.name} onClose={onClose} wide footer={<BtnGhost onClick={onClose}>Close</BtnGhost>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge label={conf.type} color={TYPE_COLOR[conf.type] ?? "#4f46e5"} />
          {when && <Badge label={when} color={when === "past" ? "#94a3b8" : "#059669"} subtle />}
          <button onClick={() => setModal({ kind: "edit" })} className="ml-auto text-xs font-medium text-blue-600 hover:underline">Edit</button>
        </div>
        <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
          <div><div className="text-xs text-gray-400">Dates</div><div className="text-gray-800">{dateRange(conf)}</div></div>
          <div><div className="text-xs text-gray-400">Location</div><div className="text-gray-800">{conf.location || "—"}</div></div>
          <div><div className="text-xs text-gray-400">Host</div><div className="text-gray-800">{conf.host || "—"}</div></div>
        </div>

        <div className="rounded-xl border border-gray-200 p-3">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">HEICO attending</div>
          {team.length ? <div className="flex flex-wrap gap-1.5">{team.map((n) => <span key={n} className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">{n}</span>)}</div>
            : <p className="text-xs text-gray-400">No one assigned yet — click Edit to add.</p>}
        </div>

        <div className="rounded-xl border border-gray-200">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Investor meetings ({conf.attendees.length})</h4>
            <button onClick={() => setModal({ kind: "addMtg" })} className="text-xs font-medium text-blue-600 hover:underline">+ Add investor</button>
          </div>
          {conf.attendees.length === 0 && <div className="px-4 py-4 text-sm text-gray-400">No investor meetings booked yet.</div>}
          <div className="divide-y divide-gray-50">
            {conf.attendees.map((m) => {
              const i = inv(m.investorId);
              const people = m.contactIds.map(contactName).filter(Boolean);
              return (
                <div key={m.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => onOpenInvestor(m.investorId)} className="text-sm font-medium text-gray-900 hover:text-blue-600 hover:underline">{cleanName(i?.name ?? "(removed investor)")}</button>
                    {i && <Badge label={i.stage} color={STAGE_COLOR[i.stage]} subtle />}
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{m.format}</span>
                    {m.time && <span className="text-xs text-gray-500">{m.time}</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">{people.length ? `Attending: ${people.join(", ")}` : "Attendees not specified"}</div>
                  {m.notes && <p className="mt-1 text-sm text-gray-600">{m.notes}</p>}
                  <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                    <button onClick={() => setModal({ kind: "editMtg", item: m })} className="hover:text-blue-600">Edit</button>
                    <button onClick={() => confirm("Remove this meeting?") && dispatch({ t: "conf.attendee.delete", confId: conf.id, id: m.id })} className="hover:text-red-600">Remove</button>
                    {logged.has(m.id)
                      ? <span className="text-green-600">✓ Logged to activity</span>
                      : <button onClick={() => logActivity(m)} className="hover:text-blue-600" title="Add this meeting to the investor's activity log">Log as activity</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {conf.notes && <div className="rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-600"><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Notes</div>{conf.notes}</div>}

        <div className="flex justify-end">
          <button onClick={() => confirm(`Delete ${conf.name}?`) && (dispatch({ t: "conf.delete", id: conf.id }), onClose())} className="text-xs text-gray-400 hover:text-red-600">Delete conference</button>
        </div>
      </div>

      {modal?.kind === "edit" && <ConferenceForm existing={conf} onClose={() => setModal(null)} />}
      {modal?.kind === "addMtg" && <AttendeeForm confId={conf.id} onClose={() => setModal(null)} />}
      {modal?.kind === "editMtg" && <AttendeeForm confId={conf.id} existing={modal.item} onClose={() => setModal(null)} />}
    </Modal>
  );
}

// ── Screen ──────────────────────────────────────────────────────────
export default function Conferences({ onOpenInvestor }: { onOpenInvestor: (id: string) => void }) {
  const { data } = useCrm();
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ date?: string } | null>(null);
  const [showPast, setShowPast] = useState(false);
  const today = todayIso();

  const upcoming = useMemo(() => data.conferences.filter((c) => c.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate)), [data.conferences, today]);
  const past = useMemo(() => data.conferences.filter((c) => c.endDate < today).sort((a, b) => b.startDate.localeCompare(a.startDate)), [data.conferences, today]);
  const teamName = (id: string) => data.team.find((t) => t.id === id)?.name?.split(" ")[0] ?? "";

  const Row = ({ c }: { c: Conference }) => (
    <button onClick={() => setOpenId(c.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-gray-50">
      <span className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: TYPE_COLOR[c.type] ?? "#4f46e5" }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-gray-900">{c.name}</div>
        <div className="truncate text-xs text-gray-500">{dateRange(c)}{c.location ? ` · ${c.location}` : ""}{c.host ? ` · ${c.host}` : ""}</div>
        <div className="mt-0.5 text-xs text-gray-400">
          {c.attendees.length} investor meeting{c.attendees.length === 1 ? "" : "s"}
          {c.heicoAttendeeIds.length ? ` · HEICO: ${c.heicoAttendeeIds.map(teamName).join(", ")}` : " · no HEICO attendees yet"}
        </div>
      </div>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-gray-500">Conferences, roadshows and investor events — who from HEICO is going and which investors you’re meeting.</p>
        <div className="ml-auto"><BtnPrimary onClick={() => setAdding({})}>+ Add conference</BtnPrimary></div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
        <Calendar conferences={data.conferences} onOpen={setOpenId} onAddOn={(date) => setAdding({ date })} />

        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-900">Upcoming ({upcoming.length})</div>
            {upcoming.length === 0 && <div className="px-4 py-6 text-sm text-gray-400">Nothing scheduled.</div>}
            <div className="divide-y divide-gray-50">{upcoming.map((c) => <Row key={c.id} c={c} />)}</div>
          </div>
          {past.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <button onClick={() => setShowPast((v) => !v)} className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-semibold text-gray-700">
                Past ({past.length}) <span className="text-xs font-normal text-gray-400">{showPast ? "Hide" : "Show"}</span>
              </button>
              {showPast && <div className="divide-y divide-gray-50 border-t border-gray-100">{past.map((c) => <Row key={c.id} c={c} />)}</div>}
            </div>
          )}
        </div>
      </div>

      {openId && <ConferenceDetail confId={openId} onClose={() => setOpenId(null)} onOpenInvestor={onOpenInvestor} />}
      {adding && <ConferenceForm defaultDate={adding.date} onClose={() => setAdding(null)} />}
    </div>
  );
}
