// Live price & performance fetch, shared by the /api/prices route handler (live,
// per-request) and mirrored by scripts/fetch-prices.mjs (daily committed snapshot
// used as SSR seed / fallback). Source: Yahoo Finance public chart endpoint.
import type { PricesData, PriceRow } from "@/lib/types";

const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" };

const MAIN = [
  { key: "HEI",  symbol: "HEI",   name: "HEICO Corp (HEI)" },
  { key: "HEIA", symbol: "HEI-A", name: "HEICO Corp (HEI/A)" },
];
const PEERS = [
  { symbol: "RTX",  name: "RTX Corp" },
  { symbol: "BA",   name: "Boeing" },
  { symbol: "HWM",  name: "Howmet Aerospace" },
  { symbol: "TDG",  name: "TransDigm" },
  { symbol: "TDY",  name: "Teledyne" },
  { symbol: "LOAR", name: "Loar Holdings" },
  { symbol: "ARXS", name: "Arxis" },
  { symbol: "VSEC", name: "VSE Corp" },
  { symbol: "FTAI", name: "FTAI Aviation" },
];
const INDICES = [
  { symbol: "^GSPC", name: "S&P 500" },
  { symbol: "^DJI",  name: "Dow Jones" },
  { symbol: "^IXIC", name: "Nasdaq Composite" },
];

interface Pt { date: string; close: number; volume: number }

async function getChart(symbol: string): Promise<{ meta: any; pts: Pt[] } | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
  try {
    // Cache upstream 60s so many page loads don't hammer Yahoo, while staying near-live.
    const r = await fetch(url, { headers: UA, next: { revalidate: 60 }, signal: AbortSignal.timeout(15000) });
    const j: any = await r.json();
    const res = j?.chart?.result?.[0];
    if (!res) return null;
    const ts: number[] = res.timestamp ?? [];
    const q = res.indicators?.quote?.[0] ?? {};
    const closes: (number | null)[] = q.close ?? [];
    const vols: (number | null)[] = q.volume ?? [];
    const pts: Pt[] = [];
    for (let k = 0; k < ts.length; k++) {
      if (closes[k] == null) continue;
      pts.push({ date: new Date(ts[k] * 1000).toISOString().slice(0, 10), close: closes[k] as number, volume: vols[k] ?? 0 });
    }
    return { meta: res.meta ?? {}, pts };
  } catch {
    return null;
  }
}

function pct(from: number | null, to: number | null): number | null {
  if (from == null || to == null || from === 0) return null;
  return Math.round(((to - from) / from) * 1000) / 10;
}

function summarize(pts: Pt[], curYear: number): Partial<PriceRow> {
  if (!pts.length) return {};
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2] ?? last;
  const weekAgo = pts[Math.max(0, pts.length - 6)];
  let ytdBase: Pt | null = null;
  for (let k = pts.length - 1; k >= 0; k--) { if (pts[k].date < `${curYear}-01-01`) { ytdBase = pts[k]; break; } }
  if (!ytdBase) ytdBase = pts.find((p) => p.date >= `${curYear}-01-01`) ?? pts[0];
  const closes = pts.map((p) => p.close);
  const vols = pts.map((p) => p.volume).filter((v) => v > 0);
  return {
    last: last.close,
    asOfDate: last.date,
    prevClose: prev.close,
    dayPct: pct(prev.close, last.close),
    weekPct: pct(weekAgo.close, last.close),
    ytdPct: pct(ytdBase.close, last.close),
    high52: Math.max(...closes),
    low52: Math.min(...closes),
    volume: last.volume,
    avgVol: vols.length ? Math.round(vols.reduce((a, b) => a + b, 0) / vols.length) : null,
  };
}

export async function fetchPrices(): Promise<PricesData> {
  const now = new Date();
  const curYear = now.getUTCFullYear();
  const all = [...MAIN, ...PEERS, ...INDICES];
  const charts: Record<string, { meta: any; pts: Pt[] } | null> = {};
  await Promise.all(all.map(async (s) => { charts[s.symbol] = await getChart(s.symbol); }));

  const row = (s: { symbol: string; name: string; key?: string }): PriceRow =>
    ({ key: s.key, symbol: s.symbol, name: s.name, ...summarize(charts[s.symbol]?.pts ?? [], curYear) } as PriceRow);

  const mainOut = MAIN.map(row).filter((x) => x.last != null);
  const peersOut = PEERS.map(row).filter((x) => x.last != null).sort((a, b) => (b.ytdPct ?? -999) - (a.ytdPct ?? -999));
  const indicesOut = INDICES.map(row).filter((x) => x.last != null);

  const heiPts = (charts["HEI"]?.pts ?? []).filter((p) => p.date >= `${curYear}-01-01`);
  const labels = heiPts.map((p) => p.date);
  const seriesSymbols = ["HEI", "HEI-A", ...PEERS.map((p) => p.symbol), "^GSPC"];
  const nameOf = (sym: string) =>
    sym === "HEI" ? "HEI" : sym === "HEI-A" ? "HEI/A" :
    (PEERS.find((p) => p.symbol === sym)?.name) ?? INDICES.find((i) => i.symbol === sym)?.name ?? sym;
  const series = { labels } as PricesData["series"];
  for (const sym of seriesSymbols) {
    const pts = charts[sym]?.pts ?? [];
    const byDate = new Map(pts.map((p) => [p.date, p.close]));
    let base: number | null = null;
    for (let k = pts.length - 1; k >= 0; k--) { if (pts[k].date < `${curYear}-01-01`) { base = pts[k].close; break; } }
    if (base == null) base = pts.find((p) => p.date >= `${curYear}-01-01`)?.close ?? null;
    let lastVal: number | null = null;
    series[nameOf(sym)] = labels.map((d) => {
      const c = byDate.get(d);
      if (c != null && base) lastVal = Math.round((c / base) * 1000) / 10;
      return lastVal;
    });
  }

  return {
    asOf: now.toISOString(),
    asOfDate: mainOut[0]?.asOfDate ?? now.toISOString().slice(0, 10),
    main: mainOut,
    peers: peersOut,
    indices: indicesOut,
    series,
  };
}
