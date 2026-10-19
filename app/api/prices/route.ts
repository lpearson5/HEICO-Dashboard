import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { fetchPrices } from "@/lib/yahoo-prices";

// Live prices. Rendered on every request (no stale-while-revalidate, which served
// the first visitor after a quiet stretch an old price). A 30-second in-memory
// buffer protects Yahoo from bursts. Falls back to the daily committed snapshot
// if Yahoo fails.
export const dynamic = "force-dynamic";

const TTL_MS = 30_000;
let buffer: { at: number; body: unknown } | null = null;

export async function GET() {
  if (buffer && Date.now() - buffer.at < TTL_MS) {
    return NextResponse.json(buffer.body, { headers: { "Cache-Control": "no-store" } });
  }
  try {
    const data = await fetchPrices();
    if (!data.main?.length) throw new Error("empty");
    const body = { ...data, live: true };
    buffer = { at: Date.now(), body };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch {
    try {
      const fb = JSON.parse(readFileSync(join(process.cwd(), "data", "prices.json"), "utf8"));
      return NextResponse.json({ ...fb, live: false }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return NextResponse.json({ error: "prices unavailable" }, { status: 503 });
    }
  }
}
