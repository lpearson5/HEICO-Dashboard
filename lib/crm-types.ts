// CRM domain types. UI-first: these describe the shape of the (currently
// browser-only, sample) data. When we connect Supabase/SSO later, these same
// types back the database rows, so screens won't change.

export type PipelineStage = "Target" | "Contacted" | "Engaged" | "Owns" | "Passed";
export const PIPELINE_STAGES: PipelineStage[] = ["Target", "Contacted", "Engaged", "Owns", "Passed"];

export type Priority = "High" | "Medium" | "Low";
export type ClassTag = "HEI" | "HEI.A" | "Both" | "Target";

export type ActivityType =
  | "Call" | "Meeting" | "Roadshow" | "Conference 1x1" | "Earnings Call" | "Email" | "Other";
export const ACTIVITY_TYPES: ActivityType[] = ["Meeting", "Call", "Conference 1x1", "Roadshow", "Earnings Call", "Email", "Other"];

export type Sentiment = "Positive" | "Neutral" | "Negative";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
}

export interface Investor {
  id: string;
  name: string;              // firm name (matches 13F holder name where they own)
  cik?: string | null;
  klass: ClassTag;           // which class they hold / are targeted for
  style?: string | null;     // Growth / Value / etc. (from Investor Styles)
  city?: string | null;
  country?: string | null;
  stage: PipelineStage;
  priority: Priority;
  ownerId: string;           // IR team member responsible
  tags: string[];
  esg?: boolean;             // manual ESG flag (in addition to auto-detection from the register)
  notes?: string;
  createdAt: string;
}

export interface Contact {
  id: string;
  investorId: string;
  name: string;
  title?: string;
  role?: string;             // PM / Analyst / ESG / Ops
  email?: string;
  phone?: string;
  primary?: boolean;
  notes?: string;
}

export interface Activity {
  id: string;
  investorId: string;
  contactIds: string[];
  type: ActivityType;
  date: string;              // ISO date
  subject: string;
  notes?: string;
  attendees?: string;        // HEICO side, free text
  sentiment?: Sentiment | null;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  investorId?: string | null;
  dueDate?: string | null;   // ISO date
  done: boolean;
  priority: Priority;
  assigneeId?: string | null;
  notes?: string;
  createdAt?: string;
}

export type ConferenceType = "Conference" | "Roadshow / NDR" | "Investor Day" | "Site Visit" | "Virtual";
export const CONFERENCE_TYPES: ConferenceType[] = ["Conference", "Roadshow / NDR", "Investor Day", "Site Visit", "Virtual"];

export type MeetingFormat = "1x1" | "Small group" | "Group / lunch" | "Fireside / panel";
export const MEETING_FORMATS: MeetingFormat[] = ["1x1", "Small group", "Group / lunch", "Fireside / panel"];

// An investor meeting booked at a conference.
export interface ConferenceAttendee {
  id: string;
  investorId: string;
  contactIds: string[];      // which of the firm's people are attending
  format: MeetingFormat;
  time?: string;             // free text, e.g. "Tue 10:30am"
  notes?: string;
}

export interface Conference {
  id: string;
  name: string;
  host?: string;             // sponsoring broker / organizer
  type: ConferenceType;
  startDate: string;         // ISO date
  endDate: string;           // ISO date (same as start for one-day events)
  location?: string;
  heicoAttendeeIds: string[]; // HEICO team members going
  attendees: ConferenceAttendee[];
  notes?: string;
  createdAt?: string;
}

export interface CrmData {
  team: TeamMember[];
  investors: Investor[];
  contacts: Contact[];
  activities: Activity[];
  tasks: Task[];
  conferences: Conference[];
}

// Live position info matched from the public dashboard data (auto-linking).
export interface LivePosition {
  shares: number | null;
  value: number | null;      // USD thousands (13F)
  action: string | null;     // Bought / Sold / New Position / ...
  style: string | null;
  pctChange: number | null;
  esg?: string | null;       // ESG tier if the holder is an ESG/sustainable manager
  peers?: string[];          // peer tickers this holder also owns (from Peer Overlap)
}
