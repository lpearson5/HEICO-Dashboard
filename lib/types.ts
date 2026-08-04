export type Action = "New Position" | "Bought" | "Sold" | "Sell Out" | "No Change" | "Not Filed Yet";

export interface Holding {
  filerName: string;
  filerCik: string;
  currentShares: number | null;
  priorShares: number | null;
  change: number | null;
  pctChange: number | null;
  currentValue: number | null; // USD thousands
  action: Action;
  fileDate: string;
  firstSeen?: string | null;   // date this holder first appeared (week-over-week tracking)
  newThisWeek?: boolean;       // new to the list or changed within the last 7 days
}

export interface TickerData {
  ticker: string;
  cusip: string;
  currentPeriod: string;
  priorPeriod: string;
  lastUpdated: string;
  holdings: Holding[];
}

// ── Monthly snapshot (Phase 1: 13F, 4-quarter history) ──
export type MonthlyAction = "New" | "Bought" | "Sold" | "Sellout" | "No Change";

export interface MonthlyHolding {
  filerName: string;
  filerCik: string;
  shares: (number | null)[];   // [current, -1q, -2q, -3q]
  netChg: number | null;       // current minus prior quarter
  currentValue: number | null; // USD thousands
  pctOut: number | null;       // % of shares outstanding
  action: MonthlyAction;
}

export interface MonthlySummary {
  institutions: number;
  totalShares: number;
  pctOut: number;
  newHolders: number;
  sellouts: number;
  bought: number;
  sold: number;
  held: number;
}

export interface MonthlyData {
  ticker: string;
  cusip: string;
  quarters: string[];          // 4 period-end dates, [current, -1q, -2q, -3q]
  sharesOutstanding: number;
  lastUpdated: string;
  summary: MonthlySummary;
  top10: MonthlyHolding[];
  newHolders: MonthlyHolding[];
  sellouts: MonthlyHolding[];
  holdings: MonthlyHolding[];
}

// ── Mutual-fund holders (Phase 2: N-PORT) ──
export type FundAction = "New" | "Bought" | "Sold" | "No Change";

export interface FundHolder {
  fundName: string;
  registrant: string;
  manager: string;             // parent 13F manager (empty if unmatched)
  cik: string;
  shares: number;
  value: number | null;
  reportDate: string;          // the fund's N-PORT period-end (funds report on their own calendar)
  priorShares: number | null;
  change: number | null;
  pctOut: number;
  action: FundAction;
}

export interface FundManager {
  manager: string;
  fundCount: number;
  shares: number;
  funds: { fundName: string; shares: number }[];
}

export interface FundData {
  ticker: string;
  cusip: string;
  sharesOutstanding: number;
  lastUpdated: string;
  summary: { funds: number; totalShares: number; pctOut: number; newFunds: number; linkedManagers: number; linkedShares: number };
  newHolders: FundHolder[];
  managers: FundManager[];
  holders: FundHolder[];
}
