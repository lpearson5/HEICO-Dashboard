"use client";

import { useCrm } from "../store";
import { Badge, STAGE_COLOR, STYLE_COLOR, PRIORITY_COLOR, cleanName, normName } from "../ui";
import { PIPELINE_STAGES, type PipelineStage, type LivePosition } from "@/lib/crm-types";

const fmtSh = (n: number | null) => n == null ? null : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M sh` : `${(n / 1e3).toFixed(0)}K sh`;

export default function Pipeline({ live, onOpenInvestor }: { live: Record<string, LivePosition>; onOpenInvestor: (id: string) => void }) {
  const { data, dispatch } = useCrm();

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-3" style={{ minWidth: 900 }}>
        {PIPELINE_STAGES.map((stage) => {
          const items = data.investors.filter((i) => i.stage === stage).sort((a, b) => (live[normName(b.name)]?.shares ?? 0) - (live[normName(a.name)]?.shares ?? 0));
          return (
            <div key={stage} className="flex-1 rounded-xl bg-gray-50 p-2" style={{ minWidth: 170 }}>
              <div className="flex items-center gap-2 px-2 py-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STAGE_COLOR[stage] }} />
                <span className="text-sm font-semibold text-gray-700">{stage}</span>
                <span className="ml-auto text-xs text-gray-400">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map((i) => {
                  const pos = live[normName(i.name)];
                  const sh = fmtSh(pos?.shares ?? null);
                  return (
                    <div key={i.id} className="rounded-lg border border-gray-200 bg-white p-2.5 shadow-sm">
                      <button onClick={() => onOpenInvestor(i.id)} className="block w-full text-left">
                        <div className="flex items-start gap-1.5">
                          <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: PRIORITY_COLOR[i.priority] }} title={`${i.priority} priority`} />
                          <span className="text-sm font-medium leading-snug text-gray-900">{cleanName(i.name)}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {i.style && <Badge label={i.style} color={STYLE_COLOR[i.style] ?? "#64748b"} subtle />}
                          {sh && <span className="text-[11px] text-gray-500">{sh}</span>}
                        </div>
                      </button>
                      <select
                        value={stage}
                        onChange={(e) => dispatch({ t: "investor.stage", id: i.id, stage: e.target.value as PipelineStage })}
                        className="mt-2 w-full rounded border border-gray-200 bg-gray-50 px-1.5 py-1 text-[11px] text-gray-600"
                      >
                        {PIPELINE_STAGES.map((s) => <option key={s} value={s}>Move to: {s}</option>)}
                      </select>
                    </div>
                  );
                })}
                {items.length === 0 && <div className="px-2 py-4 text-center text-xs text-gray-300">Empty</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
