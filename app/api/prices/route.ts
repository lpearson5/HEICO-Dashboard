import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { fetchPrices } from "@/lib/yahoo-prices";

// Live prices, refreshed at most once a minute (near-live, protects Yahoo from
// per-visit hammering). Falls back to the daily committed snapshot if Yahoo fails.
export const revalidate = 60;

export async function GET() {
  try {
    const data = await fetchPrices();
    if (!data.main?.length) throw new Error("empty");
    return NextResponse.json({ ...data, live: true });
  } catch {
    try {
      const fb = JSON.parse(readFileSync(join(process.cwd(), "data", "prices.json"), "utf8"));
      return NextResponse.json({ ...fb, live: false });
    } catch {
      return NextResponse.json({ error: "prices unavailable" }, { status: 503 });
    }
  }
}
