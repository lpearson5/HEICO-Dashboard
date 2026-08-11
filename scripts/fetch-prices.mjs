// ─── HEICO price & performance feed ────────────────────────────────────────────
// Pulls daily price history for HEICO, its 9 peers, and the major indices from
// Yahoo Finance's public chart endpoint (no key, no auth). Computes day / week /
// YTD performance, 52-week range, and an indexed-to-100 YTD comparison series for
// the dashboard's Markets panel. Writes data/prices.json.
//
// Why Yahoo's chart endpoint: it is the only free source that reliably returns
// full daily history for a NYSE-listed name (HEICO) plus peers and indices in one
// place, without the anti-bot / auth walls that block Stooq and Yahoo's newer
// quote/quoteSummary endpoints. Prices are end-of-day (matches Nasdaq's cadence).

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" };

// HEICO share classes (Yahoo symbols). HEI.A trades as "HEI-A" on Yahoo.
const MAIN = [
  { key: "HEI",  symbol: "HEI",   name: "HEICO Corp (HEI)" },
  { key: "HEIA", symbol: "HEI-A", name: "HEICO Corp (HEI/A)" },
];
// Peer set mirrors the ownership dashboard's 9 peers.
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getChart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
  for (let i = 1; i <= 5; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      if (!res) throw new Error("no result");
      const ts = res.timestamp ?? [];
      const q = res.indicators?.quote?.[0] ?? {};
      const closes = q.close ?? [];
      const vols = q.volume ?? [];
      // Zip into clean {date, close, volume} points, dropping holiday nulls.
      const pts = [];
      for (let k = 0; k < ts.length; k++) {
        if (closes[k] == null) continue;
        pts.push({
          date: new Date(ts[k] * 1000).toISOString().slice(0, 10),
          close: closes[k],
          volume: vols[k] ?? 0,
        });
      }
      return { meta: res.meta ?? {}, pts };
    } catch (e) {
      if (i === 5) { console.warn(`  ${symbol}: FAILED (${e.message})`); return null; }
      await sleep(1200 * i);
    }
  }
}

// Percentage change helpers over the cleaned point series.
function pct(from, to) {
  if (from == null || to == null || from === 0) return null;
  return Math.round(((to - from) / from) * 1000) / 10;
}

function summarize(pts, curYear) {
  if (!pts.length) return null;
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2] ?? last;
  // Week = 5 trading days back.
  const weekAgo = pts[Math.max(0, pts.length - 6)];
  // YTD base = last close of the previous calendar year (fallback: first point of this year).
  let ytdBase = null;
  for (let k = pts.length - 1; k >= 0; k--) {
    if (pts[k].date < `${curYear}-01-01`) { ytdBase = pts[k]; break; }
  }
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

async function main() {
  console.log("=== HEICO Price & Performance fetch (Yahoo chart) ===");
  mkdirSync(DATA_DIR, { recursive: true });
  const today = new Date();
  const curYear = today.getUTCFullYear();

  const all = [...MAIN, ...PEERS, ...INDICES];
  const charts = {};
  for (const s of all) {
    const c = await getChart(s.symbol);
    if (c) charts[s.symbol] = c;
    await sleep(400);
  }

  const mainOut = MAIN.map((s) => ({ key: s.key, symbol: s.symbol, name: s.name, ...(summarize(charts[s.symbol]?.pts ?? [], curYear) ?? {}) }))
    .filter((x) => x.last != null);
  const peersOut = PEERS.map((s) => ({ symbol: s.symbol, name: s.name, ...(summarize(charts[s.symbol]?.pts ?? [], curYear) ?? {}) }))
    .filter((x) => x.last != null)
    .sort((a, b) => (b.ytdPct ?? -999) - (a.ytdPct ?? -999));
  const indicesOut = INDICES.map((s) => ({ symbol: s.symbol, name: s.name, ...(summarize(charts[s.symbol]?.pts ?? [], curYear) ?? {}) }))
    .filter((x) => x.last != null);

  // Indexed-to-100 YTD comparison series (base = each symbol's YTD base close),
  // aligned to HEI's YTD trading dates. Compared lines: HEI, HEI/A, peers, S&P 500.
  const heiPts = (charts["HEI"]?.pts ?? []).filter((p) => p.date >= `${curYear}-01-01`);
  const labels = heiPts.map((p) => p.date);
  const seriesSymbols = ["HEI", "HEI-A", ...PEERS.map((p) => p.symbol), "^GSPC"];
  const nameOf = (sym) =>
    sym === "HEI" ? "HEI" : sym === "HEI-A" ? "HEI/A" :
    (PEERS.find((p) => p.symbol === sym)?.name) ?? INDICES.find((i) => i.symbol === sym)?.name ?? sym;
  const series = { labels };
  for (const sym of seriesSymbols) {
    const pts = charts[sym]?.pts ?? [];
    const byDate = new Map(pts.map((p) => [p.date, p.close]));
    // Base = last close before this year (fallback first of year).
    let base = null;
    for (let k = pts.length - 1; k >= 0; k--) { if (pts[k].date < `${curYear}-01-01`) { base = pts[k].close; break; } }
    if (base == null) base = pts.find((p) => p.date >= `${curYear}-01-01`)?.close ?? null;
    let lastVal = null;
    series[nameOf(sym)] = labels.map((d) => {
      const c = byDate.get(d);
      if (c != null && base) lastVal = Math.round((c / base) * 1000) / 10;
      return lastVal; // carry forward across any missing dates
    });
  }

  const out = {
    asOf: today.toISOString(),
    asOfDate: mainOut[0]?.asOfDate ?? today.toISOString().slice(0, 10),
    main: mainOut,
    peers: peersOut,
    indices: indicesOut,
    series,
  };
  writeFileSync(join(DATA_DIR, "prices.json"), JSON.stringify(out, null, 2));
  console.log(`prices.json written: ${mainOut.length} HEICO, ${peersOut.length} peers, ${indicesOut.length} indices, ${labels.length} YTD points.`);
}

main().catch((e) => { console.error("Price fetch failed:", e); process.exit(1); });
