"use client";

import { useMemo, useState } from "react";
import type { PeerOverlapData } from "@/lib/types";

const fmtSh = (n: number | null) => n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${n}`;
const fmtVal = (n: number) => !n ? "—" : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${(n / 1e3).toFixed(0)}K`;
const cleanName = (s: string) => s.replace(/\s*\(.*?\)\s*$/g, "").trim();

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-2xl font-bold tabular-nums" style={{ color: tone ?? "#0f172a" }}>{value}</div>
      <div className="mt-0.5 text-xs font-medium text-gray-700">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-gray-400">{sub}</div>}
    </div>
  );
}

function Chip({ t, active }: { t: string; active?: boolean }) {
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${active ? "bg-indigo-600 text-white" : "bg-indigo-50 text-indigo-700"}`}>{t}</span>;
}

export default function PeerOverlap({ data }: { data: PeerOverlapData | null }) {
  const [mode, setMode] = useState<"targets" | "holders">("targets");
  const [peer, setPeer] = useState("All");
  const [q, setQ] = useState("");

  const ownsAny = data ? data.holders.filter((h) => h.peers.length > 0).length : 0;
  const soldCount = data?.soldHeicoCount ?? 0;

  const targets = useMemo(() => !data ? [] : data.targets
    .filter((t) => peer === "All" || t.peers.some((p) => p.t === peer))
    .filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase())), [data, peer, q]);

  const holders = useMemo(() => !data ? [] : data.holders
    .filter((h) => peer === "All" ? h.peers.length > 0 : h.peers.includes(peer))
    .filter((h) => !q || h.name.toLowerCase().includes(q.toLowerCase())), [data, peer, q]);

  if (!data) {
    return <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">Peer-overlap data hasn’t been generated yet. It appears after the next daily data refresh.</div>;
  }
  const maxPct = Math.max(1, ...data.peers.map((p) => p.pctOfHeicoHolders));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Peer Overlap</h2>
        <p className="text-sm text-gray-500">Which investors own HEICO’s peers — and which own the peers but not HEICO{data.period ? `, as of ${data.period}` : ""}.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Our holders owning a peer" value={`${Math.round((ownsAny / Math.max(1, data.heicoHolderCount)) * 100)}%`} sub={`${ownsAny} of ${data.heicoHolderCount}`} tone="#4f46e5" />
        <Stat label="Peer-only investors" value={data.targetCount.toLocaleString()} sub="own a peer, not HEICO" tone="#059669" />
        <Stat label="Own 3+ peers, not HEICO" value={data.target3Plus.toLocaleString()} sub="strongest sector targets" />
        <Stat label="Sold HEICO, still own peers" value={String(soldCount)} sub="re-engagement candidates" tone={soldCount ? "#dc2626" : undefined} />
      </div>

      {/* Per-peer overlap */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Peer</th>
                <th className="px-4 py-3 text-right">13F holders</th>
                <th className="px-4 py-3 text-right">Also own HEICO</th>
                <th className="px-4 py-3">% of our register that owns it</th>
              </tr>
            </thead>
            <tbody>
              {data.peers.map((p) => (
                <tr key={p.ticker} onClick={() => setPeer(peer === p.ticker ? "All" : p.ticker)} className={`cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50 ${peer === p.ticker ? "bg-indigo-50/60" : ""}`}>
                  <td className="px-4 py-2.5"><div className="flex items-center gap-2"><Chip t={p.ticker} active={peer === p.ticker} /><span className="text-gray-700">{p.name}</span></div></td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{p.holders.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{p.overlap.toLocaleString()}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-40 max-w-full overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${(p.pctOfHeicoHolders / maxPct) * 100}%` }} /></div>
                      <span className="text-xs font-semibold tabular-nums text-gray-700">{p.pctOfHeicoHolders}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400">Click a peer to filter the lists below to that peer.</div>
      </div>

      {/* Lists */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-gray-300 text-sm">
          <button onClick={() => setMode("targets")} className={`px-3 py-1.5 font-medium ${mode === "targets" ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}>Own peers, not HEICO</button>
          <button onClick={() => setMode("holders")} className={`px-3 py-1.5 font-medium ${mode === "holders" ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}>Our holders & their peers</button>
        </div>
        <select value={peer} onChange={(e) => setPeer(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-700">
          <option value="All">All peers</option>
          {data.peers.map((p) => <option key={p.ticker} value={p.ticker}>{p.ticker} — {p.name}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search firm…" className="min-w-[160px] flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none" />
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {mode === "targets" ? (
          <>
            <div className="border-b border-gray-100 px-4 py-2 text-xs text-gray-400">{peer === "All" && !q
                ? `Showing the top ${targets.length} of ${data.targetCount.toLocaleString()} investors who own a peer but not HEICO`
                : `${targets.length} of the top-ranked investors own ${peer === "All" ? "a peer" : peer} but not HEICO`} — ranked by how many peers they own</div>
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3">Firm</th>
                    <th className="px-4 py-3">Peers owned</th>
                    <th className="px-4 py-3 text-right">Known peer value</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((t) => (
                    <tr key={t.cik} className="border-b border-gray-100 last:border-0 align-top">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-gray-900">{cleanName(t.name)}</div>
                        {t.soldHeico && <span className="mt-0.5 inline-block rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">Sold out of HEICO last quarter</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {t.peers.map((p) => <span key={p.t} title={p.shares != null ? `${fmtSh(p.shares)} sh` : "share count not fetched"}><Chip t={p.t} active={p.t === peer} /></span>)}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{fmtVal(t.knownValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className="border-b border-gray-100 px-4 py-2 text-xs text-gray-400">{holders.length} HEICO holders own {peer === "All" ? "at least one peer" : peer}</div>
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3">Firm</th>
                    <th className="px-4 py-3 text-right">HEICO shares</th>
                    <th className="px-4 py-3">Also owns</th>
                  </tr>
                </thead>
                <tbody>
                  {holders.map((h) => (
                    <tr key={h.cik} className="border-b border-gray-100 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-gray-900">{cleanName(h.name)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{fmtSh(h.heicoShares)}</td>
                      <td className="px-4 py-2.5"><div className="flex flex-wrap gap-1">{h.peers.map((t) => <Chip key={t} t={t} active={t === peer} />)}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs leading-relaxed text-gray-500">
        <span className="font-semibold text-gray-600">How this works:</span> each quarter we pull every 13F filer that reports a
        position in each peer and match them to HEICO’s holders by SEC CIK (so name-spelling differences don’t matter).
        For the smaller peers (LOAR, ARXS, VSEC, FTAI) share counts are known for every holder; for the large caps (RTX, BA,
        HWM, TDG, TDY) we know <span className="italic">who</span> holds them, but fetch share counts only for HEICO’s largest
        holders — so “known peer value” understates large-cap positions. Rows marked{" "}
        <span className="font-semibold text-red-700">Sold out of HEICO</span> owned us last quarter and still own the sector.
      </div>
    </div>
  );
}
