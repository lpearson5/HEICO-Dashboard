"use client";

import type { GeographyData, GeoRegion } from "@/lib/types";

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "Washington, D.C.",
};
const stateName = (code: string) => STATE_NAMES[code] ?? code;

const pct = (n: number) => `${n.toFixed(1)}%`;

function BarList({ title, rows, max, label }: { title: string; rows: GeoRegion[]; max: number; label: (name: string) => string }) {
  if (!rows.length) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 text-sm font-semibold text-gray-700">{title}</div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.name}>
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-gray-700">{label(r.name)} <span className="text-gray-400">· {r.holders} holder{r.holders !== 1 ? "s" : ""}</span></span>
              <span className="tabular-nums font-medium text-gray-600">{pct(r.pct)}</span>
            </div>
            <div className="mt-0.5 h-2 rounded-full bg-gray-100">
              <div className="h-2 rounded-full bg-blue-500" style={{ width: `${max ? (r.pct / max) * 100 : 0}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function GeographicOwnership({ data }: { data: GeographyData | null }) {
  if (!data || (!data.states.length && !data.countries.length)) return null;
  const maxMetro = Math.max(...data.metros.map((m) => m.pct), 1);
  const maxState = Math.max(...data.states.map((m) => m.pct), 1);

  return (
    <div className="mb-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Geographic Ownership</h2>
        <span className="text-xs text-gray-400">By filer location · covers {pct(data.coverage.pctOfInstitutional)} of institutional shares</span>
      </div>

      {/* US vs International split */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-2 text-sm font-semibold text-gray-700">United States vs. international</div>
        <div className="flex h-6 w-full overflow-hidden rounded-md">
          <div className="h-full bg-blue-600" style={{ width: `${data.usPct}%` }} title={`US ${pct(data.usPct)}`} />
          <div className="h-full bg-teal-500" style={{ width: `${data.intlPct}%` }} title={`International ${pct(data.intlPct)}`} />
          <div className="h-full bg-gray-200" style={{ width: `${data.unknownPct}%` }} title={`Unknown ${pct(data.unknownPct)}`} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-600" /> United States {pct(data.usPct)}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-teal-500" /> International {pct(data.intlPct)}</span>
          {data.unknownPct > 0 && <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-gray-200 ring-1 ring-inset ring-gray-300" /> Unknown {pct(data.unknownPct)}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <BarList title="Top metro areas" rows={data.metros.slice(0, 8)} max={maxMetro} label={(n) => n} />
        <BarList title="Top U.S. states" rows={data.states.slice(0, 8)} max={maxState} label={stateName} />
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-gray-700">International holders</div>
          {data.countries.length === 0 ? (
            <p className="text-sm text-gray-400">No international holders identified.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {data.countries.slice(0, 10).map((c) => (
                <li key={c.name} className="flex justify-between">
                  <span className="text-gray-700">{c.name} <span className="text-xs text-gray-400">· {c.holders}</span></span>
                  <span className="tabular-nums text-gray-600">{pct(c.pct)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="text-[11px] text-gray-400">Locations from each filer&apos;s SEC EDGAR business address (top {data.coverage.requested} holders by size). % of institutional shares covered.</p>
    </div>
  );
}
