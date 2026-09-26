// Shared types for the Lead Routing Lab pipeline.

export type Region = "us-west" | "us-central" | "us-east" | "emea" | "apac";
export type Segment = "smb" | "mid-market" | "enterprise";

// ---------- Reference data (config/) ----------

export interface Company {
  id: string;
  name: string;
  aliases: string[];
  domain: string;
  industry: string;
  employees: number;
  hq: { city: string; state: string; country: string };
  parent_id?: string;
  strategic?: boolean;
}

export interface Account {
  account_id: string;
  company_id: string;
  owner_id: string;
  strategic: boolean;
}

export interface Rep {
  id: string; // Salesforce Owner ID (005...)
  name: string;
  title: string;
  regions: Region[];
  segments: Segment[];
  industries: string[]; // specialization
  products: string[];
  named_accounts: string[]; // company ids
  exclusions: string[]; // industries this rep may not take
  strategic_only: boolean;
  active?: boolean; // false = deactivated user; can still own CRM accounts
  open_leads: number; // open leads already in the rep's queue before this event
  capacity: number; // max open leads the rep can carry
}

export interface Location {
  city: string;
  state: string; // full name, or "" when not applicable
  country: string;
}

export interface RoutingConfig {
  salesforce_api_version: string;
  review_queue_id: string;
  review_queue_name: string;
  personal_email_domains: string[];
  us_states: Record<string, string>; // code -> full name
  ambiguous_state_codes: Record<string, string>; // code -> reason
  provinces: Record<string, string>; // code -> full name (Canada)
  country_aliases: Record<string, string>; // alias -> canonical
  region_by_state: Record<string, Region>; // full state/province name -> region
  region_by_country: Record<string, Region>;
}

export interface OrgData {
  companies: Company[];
  accounts: Account[];
  reps: Rep[];
  config: RoutingConfig;
}

// ---------- Lead records ----------

export const LEAD_FIELDS = [
  "first_name",
  "last_name",
  "email",
  "company",
  "company_domain",
  "title",
  "city",
  "state",
  "country",
  "industry",
  "employee_count",
] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];

/** A row exactly as exported from the event badge-scan platform. Everything is a string. */
export interface RawLead {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  company: string;
  company_domain: string;
  title: string;
  city: string;
  state: string;
  country: string;
  industry: string;
  employee_count: string;
  product_interest: string;
  session: string;
  lead_source: string;
}

/** A cleaned record. null means "unknown" — never a guess. */
export interface CleanLead {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company: string | null;
  company_domain: string | null;
  title: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  industry: string | null;
  employee_count: number | null;
}

// ---------- Hygiene ----------

export type HygieneStatus =
  | "CLEAN"
  | "NORMALIZED"
  | "ENRICHED"
  | "NEEDS_REVIEW"
  | "INSUFFICIENT_DATA"
  | "DUPLICATE";

export interface FieldChange {
  field: LeadField;
  from: string;
  to: string;
  reason: string;
}

export interface Enrichment {
  field: LeadField;
  value: string | number;
  source: string; // "company_record" | "policy_inference:<name>"
  kind: "lookup" | "inference";
  reason: string;
}

export interface Unresolved {
  field: LeadField | "company_identity" | "duplicate";
  reason: string;
}

export interface HygieneResult {
  lead_id: string;
  status: HygieneStatus;
  changes: FieldChange[];
  enrichments: Enrichment[];
  unresolved: Unresolved[];
  requires_review: boolean;
  duplicate_of: string | null;
  company_id: string | null;
  personal_email: boolean;
  record: CleanLead;
}

// ---------- Routing ----------

export type RoutingDecision = "auto_route" | "requires_review" | "held";

export interface TraceStep {
  step: string; // policy step key
  label: string;
  outcome: string;
  status: "pass" | "match" | "skip" | "fail";
}

export interface CandidateVerdict {
  rep_id: string;
  name: string;
  eligible: boolean;
  notes: string[]; // e.g. ["US West", "Enterprise", "Retail"] or ["Strategic accounts only"]
  eliminated_by?: string;
}

export interface RoutingResult {
  lead_id: string;
  owner: string | null;
  owner_id: string | null;
  decision: RoutingDecision;
  reason: string[];
  rules_applied: string[];
  decisive_rule: string | null;
  requires_review: boolean;
  review_reason: string | null;
  tie_broken_by: string | null;
  manual?: { previous_owner: string | null; previous_decision: RoutingDecision; previous_reason: string | null };
  trace: TraceStep[];
  candidates: CandidateVerdict[];
  context: {
    company_id: string | null;
    account_id: string | null;
    region: Region | null;
    segment: Segment | null;
    industry: string | null;
  };
}

// ---------- Ground truth ----------

export interface HygieneTruth {
  lead_id: string;
  person_id: string;
  corruptions: string[];
  expected_status: HygieneStatus;
  expected_record: CleanLead; // recoverable truth: what a careful system could know
  world_record: CleanLead; // world truth: what is actually true
  expected_enrichments: LeadField[];
  unknowable_fields: LeadField[]; // fields that must stay null
  duplicate_of: string | null;
  company_id: string | null; // world truth company (null for unknown startups)
}

export interface RoutingTruth {
  lead_id: string;
  expected_decision: RoutingDecision;
  acceptable_owner_ids: string[];
  basis: string; // human-readable reason for the gold label
}

export interface GroundTruth {
  hygiene: Record<string, HygieneTruth>;
  routing: Record<string, RoutingTruth>;
}

export interface EvalCase {
  id: string;
  title: string;
  why_hard: string;
  raw: RawLead;
  expected_status: HygieneStatus;
  expected_fields: Partial<CleanLead>;
  must_be_null: LeadField[];
  expected_decision: RoutingDecision;
  acceptable_owner_ids: string[];
}

export interface Dataset {
  seed: number;
  leads: RawLead[];
  truth: GroundTruth;
}
