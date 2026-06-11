import { readFileSync } from "fs";
import { join } from "path";
import Dashboard from "@/components/Dashboard";
import type { TickerData } from "@/lib/types";

function loadData(ticker: string): TickerData | null {
  try {
    const path = join(process.cwd(), "data", `${ticker}.json`);
    return JSON.parse(readFileSync(path, "utf8")) as TickerData;
  } catch {
    return null;
  }
}

export const revalidate = 3600; // re-read files every hour on Vercel

export default function Page() {
  const hei  = loadData("hei");
  const heia = loadData("heia");

  return <Dashboard hei={hei} heia={heia} />;
}
