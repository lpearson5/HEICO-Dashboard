import type { CrmData } from "./crm-types";

// Sample IR data for the UI preview. Firm names match real 13F holders so the
// live-position auto-linking demo works; contacts/activities/tasks are fictional.
// NOTE: preview only — this is seed data, not real investor-interaction records.

export const CRM_SAMPLE: CrmData = {
  team: [
    { id: "u1", name: "Larry Pearson", email: "lpearson@heico.com" },
    { id: "u2", name: "IR Associate", email: "ir2@heico.com" },
    { id: "u3", name: "CFO Office", email: "cfo@heico.com" },
  ],

  investors: [
    { id: "i1", name: "BlackRock, Inc.  (BLK)", klass: "Both", style: "Blend/Core", city: "New York", country: "USA", stage: "Owns", priority: "High", ownerId: "u1", tags: ["Top 10", "Index"], notes: "Largest holder. Mostly passive/index sleeves.", createdAt: "2026-01-05" },
    { id: "i2", name: "PRICE T ROWE ASSOCIATES INC /MD/", klass: "Both", style: "Growth", city: "Baltimore", country: "USA", stage: "Owns", priority: "High", ownerId: "u1", tags: ["Top 10", "Active", "Growth"], notes: "Added materially last quarter — key active growth holder.", createdAt: "2026-01-05" },
    { id: "i3", name: "Capital International Investors", klass: "Both", style: "Growth", city: "Los Angeles", country: "USA", stage: "Owns", priority: "High", ownerId: "u1", tags: ["Top 10", "Capital Group"], notes: "", createdAt: "2026-01-05" },
    { id: "i4", name: "FMR LLC", klass: "HEI", style: "Growth", city: "Boston", country: "USA", stage: "Owns", priority: "High", ownerId: "u2", tags: ["Fidelity", "Active"], notes: "Trimmed slightly. Schedule a catch-up.", createdAt: "2026-01-05" },
    { id: "i5", name: "BAMCO INC /NY/", klass: "HEI", style: "Growth", city: "New York", country: "USA", stage: "Owns", priority: "Medium", ownerId: "u1", tags: ["Baron", "Long-term"], notes: "High-conviction long-term holder.", createdAt: "2026-02-10" },
    { id: "i6", name: "BLAIR WILLIAM & CO/IL", klass: "Both", style: "Growth", city: "Chicago", country: "USA", stage: "Engaged", priority: "Medium", ownerId: "u2", tags: ["SMID Growth"], notes: "Growing position; interested in aftermarket parts story.", createdAt: "2026-03-01" },
    { id: "i7", name: "Fisher Asset Management, LLC", klass: "HEI", style: "Growth", city: "Camas", country: "USA", stage: "Owns", priority: "Low", ownerId: "u2", tags: [], notes: "", createdAt: "2026-02-18" },
    { id: "i8", name: "HARDING LOEVNER LP", klass: "HEI.A", style: "Growth", city: "Bridgewater", country: "USA", stage: "Engaged", priority: "Medium", ownerId: "u1", tags: ["Quality Growth"], notes: "Prefers HEI.A for liquidity/valuation.", createdAt: "2026-04-02" },
    { id: "i9", name: "DODGE & COX", klass: "Target", style: "Value", city: "San Francisco", country: "USA", stage: "Contacted", priority: "High", ownerId: "u1", tags: ["Value", "Target"], notes: "Value shop — long sales cycle. Sent latest deck.", createdAt: "2026-05-11" },
    { id: "i10", name: "Akre Capital Management", klass: "Target", style: "Growth", city: "Middleburg", country: "USA", stage: "Target", priority: "High", ownerId: "u1", tags: ["Quality Compounder", "Target"], notes: "Ideal fit — compounder mandate. Warm intro pending.", createdAt: "2026-06-01" },
    { id: "i11", name: "Brown Advisory Inc", klass: "Target", style: "Growth", city: "Baltimore", country: "USA", stage: "Contacted", priority: "Medium", ownerId: "u2", tags: ["Target", "ESG-aware"], notes: "", createdAt: "2026-06-15" },
    { id: "i12", name: "Norges Bank", klass: "Both", style: "Blend/Core", city: "Oslo", country: "Norway", stage: "Owns", priority: "Medium", ownerId: "u3", tags: ["Sovereign", "International"], notes: "Passive/quasi-index sovereign.", createdAt: "2026-03-20" },
    { id: "i13", name: "Wellington Management Group LLP", klass: "HEI", style: "Blend/Core", city: "Boston", country: "USA", stage: "Engaged", priority: "High", ownerId: "u2", tags: ["Active", "Multi-strat"], notes: "Multiple PMs — map the right desk.", createdAt: "2026-04-28" },
    { id: "i14", name: "Massachusetts Financial Services (MFS)", klass: "Target", style: "Blend/Core", city: "Boston", country: "USA", stage: "Passed", priority: "Low", ownerId: "u2", tags: ["Target"], notes: "Passed for now — valuation concerns cited.", createdAt: "2026-02-25" },
  ],

  contacts: [
    { id: "c1", investorId: "i2", name: "Jennifer Wu", title: "Portfolio Manager", role: "PM", email: "jwu@troweprice.com", phone: "410-555-0142", primary: true, notes: "Covers industrials/aerospace." },
    { id: "c2", investorId: "i2", name: "Mark Delgado", title: "Senior Analyst", role: "Analyst", email: "mdelgado@troweprice.com", primary: false },
    { id: "c3", investorId: "i4", name: "Steve Kaczmarek", title: "Sector Analyst", role: "Analyst", email: "skaczmarek@fmr.com", primary: true, notes: "Detail-oriented on margins." },
    { id: "c4", investorId: "i5", name: "Ron Baron Jr.", title: "Portfolio Manager", role: "PM", email: "rbaron@baronfunds.com", primary: true },
    { id: "c5", investorId: "i6", name: "Priya Nair", title: "Portfolio Manager", role: "PM", email: "pnair@williamblair.com", phone: "312-555-0199", primary: true },
    { id: "c6", investorId: "i8", name: "Thomas Reed", title: "Analyst", role: "Analyst", email: "treed@hardingloevner.com", primary: true },
    { id: "c7", investorId: "i9", name: "Susan Alvarez", title: "Research Analyst", role: "Analyst", email: "salvarez@dodgeandcox.com", primary: true, notes: "Gatekeeper before PM meeting." },
    { id: "c8", investorId: "i10", name: "Chuck Akre Jr.", title: "Managing Partner", role: "PM", email: "info@akrecapital.com", primary: true },
    { id: "c9", investorId: "i13", name: "Alan Fitzpatrick", title: "Portfolio Manager", role: "PM", email: "afitzpatrick@wellington.com", primary: true },
    { id: "c10", investorId: "i13", name: "Dana Lu", title: "ESG Specialist", role: "ESG", email: "dlu@wellington.com", primary: false },
    { id: "c11", investorId: "i1", name: "Global Index Team", title: "Stewardship", role: "Ops", email: "stewardship@blackrock.com", primary: true },
  ],

  activities: [
    { id: "a1", investorId: "i2", contactIds: ["c1"], type: "Meeting", date: "2026-09-10", subject: "Post-Q3 catch-up", notes: "Discussed FSG margin trajectory and M&A pipeline. Constructive.", attendees: "Larry Pearson, CFO", sentiment: "Positive", createdAt: "2026-09-10" },
    { id: "a2", investorId: "i4", contactIds: ["c3"], type: "Call", date: "2026-09-05", subject: "Position trim follow-up", notes: "Asked about organic growth vs acquisitions. Wants a follow-up model walk-through.", attendees: "IR Associate", sentiment: "Neutral", createdAt: "2026-09-05" },
    { id: "a3", investorId: "i6", contactIds: ["c5"], type: "Conference 1x1", date: "2026-08-28", subject: "Jefferies Industrials Conf 1x1", notes: "Building position. Bullish on defense electronics.", attendees: "Larry Pearson", sentiment: "Positive", createdAt: "2026-08-28" },
    { id: "a4", investorId: "i9", contactIds: ["c7"], type: "Email", date: "2026-09-15", subject: "Sent Q3 deck + 10-Q", notes: "Susan to circulate internally before requesting PM time.", attendees: "Larry Pearson", sentiment: "Neutral", createdAt: "2026-09-15" },
    { id: "a5", investorId: "i8", contactIds: ["c6"], type: "Meeting", date: "2026-07-22", subject: "Intro meeting", notes: "Focus on HEI.A discount vs HEI. Quality-growth mandate fit.", attendees: "Larry Pearson", sentiment: "Positive", createdAt: "2026-07-22" },
    { id: "a6", investorId: "i13", contactIds: ["c9", "c10"], type: "Meeting", date: "2026-09-18", subject: "PM + ESG joint session", notes: "ESG questions on supply chain. Provided sustainability summary.", attendees: "Larry Pearson, IR Associate", sentiment: "Neutral", createdAt: "2026-09-18" },
    { id: "a7", investorId: "i5", contactIds: ["c4"], type: "Earnings Call", date: "2026-08-26", subject: "Q3 earnings call attendance", notes: "On the call; no question asked.", attendees: "", sentiment: "Neutral", createdAt: "2026-08-26" },
    { id: "a8", investorId: "i11", contactIds: [], type: "Email", date: "2026-09-02", subject: "Intro outreach", notes: "Cold intro email with company overview.", attendees: "IR Associate", sentiment: "Neutral", createdAt: "2026-09-02" },
  ],

  tasks: [
    { id: "t1", title: "Send follow-up model walk-through to Fidelity", investorId: "i4", dueDate: "2026-09-24", done: false, priority: "High", assigneeId: "u2", notes: "Steve requested after 9/5 call." },
    { id: "t2", title: "Request PM meeting with Dodge & Cox", investorId: "i9", dueDate: "2026-09-26", done: false, priority: "High", assigneeId: "u1" },
    { id: "t3", title: "Secure warm intro to Akre Capital", investorId: "i10", dueDate: "2026-09-30", done: false, priority: "High", assigneeId: "u1" },
    { id: "t4", title: "Map Wellington PM coverage / right desk", investorId: "i13", dueDate: "2026-09-25", done: false, priority: "Medium", assigneeId: "u2" },
    { id: "t5", title: "Prep HEI.A vs HEI valuation one-pager for Harding Loevner", investorId: "i8", dueDate: "2026-10-02", done: false, priority: "Medium", assigneeId: "u1" },
    { id: "t6", title: "Confirm Q4 roadshow city list", investorId: null, dueDate: "2026-10-06", done: false, priority: "Medium", assigneeId: "u1" },
    { id: "t7", title: "Log William Blair conference notes", investorId: "i6", dueDate: "2026-09-01", done: true, priority: "Low", assigneeId: "u2" },
    { id: "t8", title: "Send thank-you to T. Rowe after catch-up", investorId: "i2", dueDate: "2026-09-12", done: true, priority: "Low", assigneeId: "u1" },
  ],
};
