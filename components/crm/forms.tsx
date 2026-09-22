"use client";

import { useState } from "react";
import { useCrm } from "./store";
import { Modal, Field, Text, Area, Select, BtnPrimary, BtnGhost } from "./ui";
import {
  PIPELINE_STAGES, ACTIVITY_TYPES, type Investor, type Contact, type Activity, type Task,
  type PipelineStage, type Priority, type ClassTag, type ActivityType, type Sentiment,
} from "@/lib/crm-types";

const PRIORITIES: Priority[] = ["High", "Medium", "Low"];
const KLASSES: ClassTag[] = ["Both", "HEI", "HEI.A", "Target"];
const STYLES = ["Growth", "Value", "Momentum/Quant", "Income", "Blend/Core", "Unclassified"];
const opts = (arr: string[]) => arr.map((v) => ({ value: v, label: v }));

// ── Investor add/edit ───────────────────────────────────────────────
export function InvestorForm({ existing, onClose }: { existing?: Investor; onClose: () => void }) {
  const { data, dispatch } = useCrm();
  const [f, setF] = useState({
    name: existing?.name ?? "", klass: existing?.klass ?? "Target", style: existing?.style ?? "Unclassified",
    stage: existing?.stage ?? "Target", priority: existing?.priority ?? "Medium", ownerId: existing?.ownerId ?? data.team[0]?.id ?? "",
    city: existing?.city ?? "", country: existing?.country ?? "", tags: (existing?.tags ?? []).join(", "), notes: existing?.notes ?? "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const save = () => {
    if (!f.name.trim()) return;
    const v = {
      name: f.name.trim(), klass: f.klass as ClassTag, style: f.style, stage: f.stage as PipelineStage,
      priority: f.priority as Priority, ownerId: f.ownerId, city: f.city, country: f.country,
      tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean), notes: f.notes,
    };
    if (existing) dispatch({ t: "investor.update", id: existing.id, v });
    else dispatch({ t: "investor.add", v });
    onClose();
  };
  return (
    <Modal title={existing ? "Edit investor" : "Add investor"} onClose={onClose} wide
      footer={<><BtnGhost onClick={onClose}>Cancel</BtnGhost><BtnPrimary onClick={save}>Save</BtnPrimary></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Firm name"><Text value={f.name} onChange={(v) => set("name", v)} placeholder="e.g. Wellington Management" /></Field></div>
        <Field label="Class held / targeted"><Select value={f.klass} onChange={(v) => set("klass", v)} options={opts(KLASSES)} /></Field>
        <Field label="Style"><Select value={f.style} onChange={(v) => set("style", v)} options={opts(STYLES)} /></Field>
        <Field label="Pipeline stage"><Select value={f.stage} onChange={(v) => set("stage", v)} options={opts(PIPELINE_STAGES)} /></Field>
        <Field label="Priority"><Select value={f.priority} onChange={(v) => set("priority", v)} options={opts(PRIORITIES)} /></Field>
        <Field label="Owner"><Select value={f.ownerId} onChange={(v) => set("ownerId", v)} options={data.team.map((t) => ({ value: t.id, label: t.name }))} /></Field>
        <Field label="City"><Text value={f.city} onChange={(v) => set("city", v)} /></Field>
        <Field label="Country"><Text value={f.country} onChange={(v) => set("country", v)} /></Field>
        <div className="sm:col-span-2"><Field label="Tags (comma-separated)"><Text value={f.tags} onChange={(v) => set("tags", v)} placeholder="Top 10, Active, Growth" /></Field></div>
        <div className="sm:col-span-2"><Field label="Notes"><Area value={f.notes} onChange={(v) => set("notes", v)} /></Field></div>
      </div>
    </Modal>
  );
}

// ── Contact add/edit ────────────────────────────────────────────────
export function ContactForm({ investorId: fixedInvestor, existing, onClose }: { investorId?: string; existing?: Contact; onClose: () => void }) {
  const { data, dispatch } = useCrm();
  const [f, setF] = useState({
    investorId: existing?.investorId ?? fixedInvestor ?? data.investors[0]?.id ?? "",
    name: existing?.name ?? "", title: existing?.title ?? "", role: existing?.role ?? "Analyst",
    email: existing?.email ?? "", phone: existing?.phone ?? "", primary: existing?.primary ?? false, notes: existing?.notes ?? "",
  });
  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }));
  const save = () => {
    if (!f.name.trim() || !f.investorId) return;
    const v = { investorId: f.investorId, name: f.name.trim(), title: f.title, role: f.role, email: f.email, phone: f.phone, primary: f.primary, notes: f.notes };
    if (existing) dispatch({ t: "contact.update", id: existing.id, v });
    else dispatch({ t: "contact.add", v });
    onClose();
  };
  return (
    <Modal title={existing ? "Edit contact" : "Add contact"} onClose={onClose}
      footer={<><BtnGhost onClick={onClose}>Cancel</BtnGhost><BtnPrimary onClick={save}>Save</BtnPrimary></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!fixedInvestor && !existing && (
          <div className="sm:col-span-2"><Field label="Firm"><Select value={f.investorId} onChange={(v) => set("investorId", v)} options={data.investors.map((i) => ({ value: i.id, label: i.name }))} /></Field></div>
        )}
        <div className="sm:col-span-2"><Field label="Name"><Text value={f.name} onChange={(v) => set("name", v)} /></Field></div>
        <Field label="Title"><Text value={f.title} onChange={(v) => set("title", v)} placeholder="Portfolio Manager" /></Field>
        <Field label="Role"><Select value={f.role} onChange={(v) => set("role", v)} options={opts(["PM", "Analyst", "ESG", "Ops", "Other"])} /></Field>
        <Field label="Email"><Text value={f.email} onChange={(v) => set("email", v)} type="email" /></Field>
        <Field label="Phone"><Text value={f.phone} onChange={(v) => set("phone", v)} /></Field>
        <div className="sm:col-span-2">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={f.primary} onChange={(e) => set("primary", e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
            Primary contact
          </label>
        </div>
        <div className="sm:col-span-2"><Field label="Notes"><Area value={f.notes} onChange={(v) => set("notes", v)} rows={2} /></Field></div>
      </div>
    </Modal>
  );
}

// ── Activity add/edit ───────────────────────────────────────────────
export function ActivityForm({ investorId: fixedInvestor, existing, onClose }: { investorId?: string; existing?: Activity; onClose: () => void }) {
  const { data, dispatch } = useCrm();
  const [f, setF] = useState({
    investorId: existing?.investorId ?? fixedInvestor ?? data.investors[0]?.id ?? "",
    type: existing?.type ?? "Meeting", date: existing?.date ?? new Date().toISOString().slice(0, 10),
    subject: existing?.subject ?? "", attendees: existing?.attendees ?? "", sentiment: existing?.sentiment ?? "Neutral",
    notes: existing?.notes ?? "", contactIds: existing?.contactIds ?? [],
  });
  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }));
  const firmContacts = data.contacts.filter((c) => c.investorId === f.investorId);
  const toggleContact = (id: string) => set("contactIds", f.contactIds.includes(id) ? f.contactIds.filter((x) => x !== id) : [...f.contactIds, id]);
  const save = () => {
    if (!f.subject.trim()) return;
    const v = {
      investorId: f.investorId, contactIds: f.contactIds, type: f.type as ActivityType, date: f.date,
      subject: f.subject.trim(), attendees: f.attendees, sentiment: f.sentiment as Sentiment, notes: f.notes,
    };
    if (existing) dispatch({ t: "activity.update", id: existing.id, v });
    else dispatch({ t: "activity.add", v });
    onClose();
  };
  return (
    <Modal title={existing ? "Edit activity" : "Log activity"} onClose={onClose} wide
      footer={<><BtnGhost onClick={onClose}>Cancel</BtnGhost><BtnPrimary onClick={save}>Save</BtnPrimary></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!fixedInvestor && (
          <div className="sm:col-span-2"><Field label="Investor"><Select value={f.investorId} onChange={(v) => set("investorId", v)} options={data.investors.map((i) => ({ value: i.id, label: i.name }))} /></Field></div>
        )}
        <Field label="Type"><Select value={f.type} onChange={(v) => set("type", v)} options={opts(ACTIVITY_TYPES)} /></Field>
        <Field label="Date"><Text value={f.date} onChange={(v) => set("date", v)} type="date" /></Field>
        <div className="sm:col-span-2"><Field label="Subject"><Text value={f.subject} onChange={(v) => set("subject", v)} placeholder="e.g. Post-Q3 catch-up" /></Field></div>
        <Field label="Sentiment"><Select value={f.sentiment} onChange={(v) => set("sentiment", v)} options={opts(["Positive", "Neutral", "Negative"])} /></Field>
        <Field label="HEICO attendees"><Text value={f.attendees} onChange={(v) => set("attendees", v)} placeholder="Larry Pearson, CFO" /></Field>
        {firmContacts.length > 0 && (
          <div className="sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-gray-600">Their contacts present</span>
            <div className="flex flex-wrap gap-2">
              {firmContacts.map((c) => (
                <button key={c.id} type="button" onClick={() => toggleContact(c.id)}
                  className={`rounded-full border px-2.5 py-1 text-xs ${f.contactIds.includes(c.id) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-300 bg-white text-gray-600"}`}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="sm:col-span-2"><Field label="Notes"><Area value={f.notes} onChange={(v) => set("notes", v)} rows={4} /></Field></div>
      </div>
    </Modal>
  );
}

// ── Task add/edit ───────────────────────────────────────────────────
export function TaskForm({ investorId: fixedInvestor, existing, onClose }: { investorId?: string; existing?: Task; onClose: () => void }) {
  const { data, dispatch } = useCrm();
  const [f, setF] = useState({
    title: existing?.title ?? "", investorId: existing?.investorId ?? fixedInvestor ?? "",
    dueDate: existing?.dueDate ?? "", priority: existing?.priority ?? "Medium", assigneeId: existing?.assigneeId ?? data.team[0]?.id ?? "", notes: existing?.notes ?? "",
  });
  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }));
  const save = () => {
    if (!f.title.trim()) return;
    const v = {
      title: f.title.trim(), investorId: f.investorId || null, dueDate: f.dueDate || null,
      priority: f.priority as Priority, assigneeId: f.assigneeId || null, notes: f.notes, done: existing?.done ?? false,
    };
    if (existing) dispatch({ t: "task.update", id: existing.id, v });
    else dispatch({ t: "task.add", v });
    onClose();
  };
  return (
    <Modal title={existing ? "Edit task" : "Add task"} onClose={onClose} wide
      footer={<><BtnGhost onClick={onClose}>Cancel</BtnGhost><BtnPrimary onClick={save}>Save</BtnPrimary></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Task"><Text value={f.title} onChange={(v) => set("title", v)} placeholder="Follow up with…" /></Field></div>
        <div className="sm:col-span-2"><Field label="Investor (optional)"><Select value={f.investorId} onChange={(v) => set("investorId", v)} options={[{ value: "", label: "— none —" }, ...data.investors.map((i) => ({ value: i.id, label: i.name }))]} /></Field></div>
        <Field label="Due date"><Text value={f.dueDate} onChange={(v) => set("dueDate", v)} type="date" /></Field>
        <Field label="Priority"><Select value={f.priority} onChange={(v) => set("priority", v)} options={opts(PRIORITIES)} /></Field>
        <div className="sm:col-span-2"><Field label="Assignee"><Select value={f.assigneeId} onChange={(v) => set("assigneeId", v)} options={data.team.map((t) => ({ value: t.id, label: t.name }))} /></Field></div>
        <div className="sm:col-span-2"><Field label="Notes"><Area value={f.notes} onChange={(v) => set("notes", v)} rows={2} /></Field></div>
      </div>
    </Modal>
  );
}
