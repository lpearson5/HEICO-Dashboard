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
