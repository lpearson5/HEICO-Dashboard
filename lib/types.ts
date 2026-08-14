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
  discretion?: string | null;  // investment discretion: SOLE / DFND / OTR
  voteSole?: number | null;    // voting authority — sole
  voteShared?: number | null;  // voting authority — shared
  voteNone?: number | null;    // voting authority — none
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

export interface FundSellout {
  fundName: string;
  registrant: string;
  manager: string;
  lastShares: number;
  lastReport: string;
}

export interface FundData {
  ticker: string;
  cusip: string;
  sharesOutstanding: number;
  lastUpdated: string;
  summary: { funds: number; totalShares: number; pctOut: number; newFunds: number; sellouts: number; linkedManagers: number; linkedShares: number };
  newHolders: FundHolder[];
  sellouts: FundSellout[];
  managers: FundManager[];
  holders: FundHolder[];
}

// ── §11 Beneficial-ownership filings (13G/13D/14D) ──
export interface BeneficialOwner {
  filer: string;
  form: string;
  fileDate: string;
  shares: number | null;
  pctClass: number | null;
  url: string;
}

export interface BeneficialData {
  lastUpdated: string;
  filers: BeneficialOwner[];
}

// ── §12/§13 Peer reports ──
export interface PeerHolder { filer: string; shares: number; value: number }
export interface PeerFund { fund: string; manager: string; shares: number; value: number }
export interface Peer {
  name: string;
  ticker: string;
  top13F: PeerHolder[];
  topFunds: PeerFund[];
}
export interface PeersData {
  lastUpdated: string;
  peers: Peer[];
}

// ── Market prices & performance (Yahoo chart feed) ──
export interface PriceRow {
  key?: string;
  symbol: string;
  name: string;
  last: number;
  asOfDate: string;
  prevClose: number;
  dayPct: number | null;
  weekPct: number | null;
  ytdPct: number | null;
  high52: number;
  low52: number;
  volume: number;
  avgVol: number | null;
}
export interface PricesData {
  asOf: string;
  asOfDate: string;
  main: PriceRow[];
  peers: PriceRow[];
  indices: PriceRow[];
  series: { labels: string[] } & Record<string, (number | null)[]>; // indexed to 100 at Jan 1
  priceSeries?: Record<string, (number | null)[]>;                   // actual closing prices ($), aligned to series.labels
}

// ── Geographic ownership (EDGAR filer locations) ──
export interface GeoRegion { name: string; shares: number; holders: number; pct: number }
export interface GeographyData {
  ticker: string;
  asOf: string;
  coverage: { resolvedHolders: number; requested: number; sharesCovered: number; totalInstitutional: number; pctOfInstitutional: number };
  usPct: number;
  intlPct: number;
  unknownPct: number;
  states: GeoRegion[];
  countries: GeoRegion[];
  metros: GeoRegion[];
}
