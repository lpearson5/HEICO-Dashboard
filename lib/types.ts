export type Action = "New Position" | "Bought" | "Sold" | "Sell Out" | "No Change";

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
}

export interface TickerData {
  ticker: string;
  cusip: string;
  currentPeriod: string;
  priorPeriod: string;
  lastUpdated: string;
  holdings: Holding[];
}
