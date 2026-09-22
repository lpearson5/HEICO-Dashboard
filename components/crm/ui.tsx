"use client";

import { useEffect } from "react";
import type { Priority, PipelineStage } from "@/lib/crm-types";

// ── formatting ──────────────────────────────────────────────────────
export const fmtDate = (d?: string | null) =>
  d ? new Date(d + (d.length <= 10 ? "T00:00:00" : "")).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

export const daysUntil = (d?: string | null): number | null => {
  if (!d) return null;
  const ms = new Date(d + "T00:00:00").getTime() - new Date(new Date().toDateString()).getTime();
  return Math.round(ms / 86400000);
};

export const initials = (name: string) =>
  name.replace(/\(.*?\)/g, "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

// Clean a 13F-style firm name for display (strip the "(TICKER, …)" suffix).
export const cleanName = (name: string) => name.replace(/\s*\(.*?\)\s*$/g, "").trim();

// Normalize a firm name for matching CRM records to live 13F holders.
export const normName = (s: string) =>
  s.toUpperCase().replace(/\(.*$/, "").replace(/[.,/]/g, " ").replace(/\s+/g, " ").trim();

// ── color maps ──────────────────────────────────────────────────────
export const STAGE_COLOR: Record<PipelineStage, string> = {
  Target: "#64748b", Contacted: "#0ea5e9", Engaged: "#8b5cf6", Owns: "#059669", Passed: "#94a3b8",
};
export const STYLE_COLOR: Record<string, string> = {
  Growth: "#059669", Value: "#2563eb", "Momentum/Quant": "#7c3aed",
  Income: "#d97706", "Blend/Core": "#64748b", Unclassified: "#cbd5e1",
};
export const PRIORITY_COLOR: Record<Priority, string> = {
  High: "#dc2626", Medium: "#d97706", Low: "#94a3b8",
};

export function Badge({ label, color, subtle }: { label: string; color: string; subtle?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={subtle
        ? { backgroundColor: color + "22", color: "#334155" }
        : { backgroundColor: color + "1f", color }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

export function Avatar({ name, color = "#475569" }: { name: string; color?: string }) {
  return (
    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ backgroundColor: color }}>
      {initials(name) || "?"}
    </span>
  );
}

// ── form controls ───────────────────────────────────────────────────
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      {children}
    </label>
  );
}
const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

export function Text({ value, onChange, placeholder, type = "text" }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputCls} />;
}
export function Area({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return <textarea value={value} placeholder={placeholder} rows={rows} onChange={(e) => onChange(e.target.value)} className={inputCls} />;
}
export function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ── modal ───────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose}>
      <div className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-2xl bg-white shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Close">✕</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function BtnPrimary({ children, onClick, type = "button" }: { children: React.ReactNode; onClick?: () => void; type?: "button" | "submit" }) {
  return <button type={type} onClick={onClick} className="rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700">{children}</button>;
}
export function BtnGhost({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return <button type="button" onClick={onClick} className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">{children}</button>;
}
