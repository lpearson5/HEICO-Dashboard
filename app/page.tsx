import { readFileSync } from "fs";
import { join } from "path";
import Dashboard from "@/components/Dashboard";
import type { TickerData, MonthlyData } from "@/lib/types";

function load<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "data", file), "utf8")) as T;
  } catch {
    return null;
  }
}

export const revalidate = 3600; // re-read files every hour on Vercel

export default function Page() {
  return (
    <Dashboard
      hei={load<TickerData>("hei.json")}
      heia={load<TickerData>("heia.json")}
      monthlyHei={load<MonthlyData>("monthly-hei.json")}
      monthlyHeia={load<MonthlyData>("monthly-heia.json")}
    />
  );
}
