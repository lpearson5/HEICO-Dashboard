"use client";

import { createContext, useContext, useEffect, useReducer, useCallback } from "react";
import type { CrmData, Investor, Contact, Activity, Task, PipelineStage, Conference, ConferenceAttendee } from "@/lib/crm-types";
import { CRM_SAMPLE } from "@/lib/crm-sample";

// Browser-only store (preview). Seeds from sample data, persists to localStorage
// so demo edits survive a refresh. When we connect Supabase, only this file's
// internals change — the actions below become API/db calls, screens stay put.

const KEY = "heico-crm-v1";
const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 9)}`;
const now = () => new Date().toISOString().slice(0, 10);

type Action =
  | { t: "reset" }
  | { t: "load"; data: CrmData }
  | { t: "investor.add"; v: Omit<Investor, "id" | "createdAt"> }
  | { t: "investor.update"; id: string; v: Partial<Investor> }
  | { t: "investor.delete"; id: string }
  | { t: "investor.stage"; id: string; stage: PipelineStage }
  | { t: "contact.add"; v: Omit<Contact, "id"> }
  | { t: "contact.update"; id: string; v: Partial<Contact> }
  | { t: "contact.delete"; id: string }
  | { t: "activity.add"; v: Omit<Activity, "id" | "createdAt"> }
  | { t: "activity.update"; id: string; v: Partial<Activity> }
  | { t: "activity.delete"; id: string }
  | { t: "task.add"; v: Omit<Task, "id" | "createdAt"> }
  | { t: "task.update"; id: string; v: Partial<Task> }
  | { t: "task.delete"; id: string }
  | { t: "task.toggle"; id: string }
  | { t: "conf.add"; v: Omit<Conference, "id" | "createdAt"> }
  | { t: "conf.update"; id: string; v: Partial<Conference> }
  | { t: "conf.delete"; id: string }
  | { t: "conf.attendee.add"; confId: string; v: Omit<ConferenceAttendee, "id"> }
  | { t: "conf.attendee.update"; confId: string; id: string; v: Partial<ConferenceAttendee> }
  | { t: "conf.attendee.delete"; confId: string; id: string };

function reducer(s: CrmData, a: Action): CrmData {
  switch (a.t) {
    case "reset": return structuredClone(CRM_SAMPLE);
    case "load": return a.data;
    case "investor.add": return { ...s, investors: [{ ...a.v, id: uid("i"), createdAt: now() }, ...s.investors] };
    case "investor.update": return { ...s, investors: s.investors.map((x) => x.id === a.id ? { ...x, ...a.v } : x) };
    case "investor.delete": return {
      ...s,
      investors: s.investors.filter((x) => x.id !== a.id),
      contacts: s.contacts.filter((x) => x.investorId !== a.id),
      activities: s.activities.filter((x) => x.investorId !== a.id),
      tasks: s.tasks.map((x) => x.investorId === a.id ? { ...x, investorId: null } : x),
      conferences: s.conferences.map((c) => ({ ...c, attendees: c.attendees.filter((m) => m.investorId !== a.id) })),
    };
    case "investor.stage": return { ...s, investors: s.investors.map((x) => x.id === a.id ? { ...x, stage: a.stage } : x) };
    case "contact.add": return { ...s, contacts: [...s.contacts, { ...a.v, id: uid("c") }] };
    case "contact.update": return { ...s, contacts: s.contacts.map((x) => x.id === a.id ? { ...x, ...a.v } : x) };
    case "contact.delete": return {
      ...s,
      contacts: s.contacts.filter((x) => x.id !== a.id),
      conferences: s.conferences.map((c) => ({ ...c, attendees: c.attendees.map((m) => ({ ...m, contactIds: m.contactIds.filter((id) => id !== a.id) })) })),
    };
    case "activity.add": return { ...s, activities: [{ ...a.v, id: uid("a"), createdAt: now() }, ...s.activities] };
    case "activity.update": return { ...s, activities: s.activities.map((x) => x.id === a.id ? { ...x, ...a.v } : x) };
    case "activity.delete": return { ...s, activities: s.activities.filter((x) => x.id !== a.id) };
    case "task.add": return { ...s, tasks: [{ ...a.v, id: uid("t"), createdAt: now() }, ...s.tasks] };
    case "task.update": return { ...s, tasks: s.tasks.map((x) => x.id === a.id ? { ...x, ...a.v } : x) };
    case "task.delete": return { ...s, tasks: s.tasks.filter((x) => x.id !== a.id) };
    case "task.toggle": return { ...s, tasks: s.tasks.map((x) => x.id === a.id ? { ...x, done: !x.done } : x) };
    case "conf.add": return { ...s, conferences: [...s.conferences, { ...a.v, id: uid("cf"), createdAt: now() }] };
    case "conf.update": return { ...s, conferences: s.conferences.map((c) => c.id === a.id ? { ...c, ...a.v } : c) };
    case "conf.delete": return { ...s, conferences: s.conferences.filter((c) => c.id !== a.id) };
    case "conf.attendee.add": return { ...s, conferences: s.conferences.map((c) => c.id === a.confId ? { ...c, attendees: [...c.attendees, { ...a.v, id: uid("ca") }] } : c) };
    case "conf.attendee.update": return { ...s, conferences: s.conferences.map((c) => c.id === a.confId ? { ...c, attendees: c.attendees.map((m) => m.id === a.id ? { ...m, ...a.v } : m) } : c) };
    case "conf.attendee.delete": return { ...s, conferences: s.conferences.map((c) => c.id === a.confId ? { ...c, attendees: c.attendees.filter((m) => m.id !== a.id) } : c) };
    default: return s;
  }
}

interface CrmCtx {
  data: CrmData;
  dispatch: React.Dispatch<Action>;
  reset: () => void;
}
const Ctx = createContext<CrmCtx | null>(null);

export function CrmProvider({ children }: { children: React.ReactNode }) {
  const [data, dispatch] = useReducer(reducer, null, () => structuredClone(CRM_SAMPLE));

  // Load persisted state once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const stored: CrmData = JSON.parse(raw);
        // Additively merge in any NEW sample rows (by id) added since this browser
        // last saved — so newly-seeded demo records (e.g. ESG holders) appear
        // without wiping the user's own edits. Existing rows are never overwritten.
        const mergeNew = <T extends { id: string }>(mine: T[] = [], sample: T[] = []): T[] => {
          const have = new Set(mine.map((r) => r.id));
          return [...mine, ...sample.filter((r) => !have.has(r.id))];
        };
        dispatch({ t: "load", data: {
          team: CRM_SAMPLE.team, // roster is canonical
          investors: mergeNew(stored.investors, CRM_SAMPLE.investors),
          contacts: mergeNew(stored.contacts, CRM_SAMPLE.contacts),
          activities: mergeNew(stored.activities, CRM_SAMPLE.activities),
          tasks: mergeNew(stored.tasks, CRM_SAMPLE.tasks),
          conferences: mergeNew(stored.conferences, CRM_SAMPLE.conferences),
        } });
      }
    } catch { /* ignore */ }
  }, []);

  // Persist on every change.
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignore */ }
  }, [data]);

  const reset = useCallback(() => {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    dispatch({ t: "reset" });
  }, []);

  return <Ctx.Provider value={{ data, dispatch, reset }}>{children}</Ctx.Provider>;
}

export function useCrm(): CrmCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCrm must be used inside CrmProvider");
  return c;
}
