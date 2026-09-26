// Turns held and review leads into a human work queue: what is blocked, why the policy
// deliberately stops there, and what decision a person needs to make.

import type { OrgIndex } from "./org";
import { REGION_LABEL, SEGMENT_LABEL } from "./org";
import type { HygieneResult, Rep, RoutingResult } from "./types";

export type AttentionKind =
  | "employer_unknown"
  | "company_conflict"
  | "company_ambiguous"
  | "possible_duplicate"
  | "location_unknown"
  | "size_unknown"
  | "owner_inactive"
  | "owner_conflict"
  | "coverage_gap"
  | "capacity";

export const ATTENTION_META: Record<AttentionKind, { title: string; why: string; decide: string; stage: "Hygiene" | "Routing" }> = {
  employer_unknown: {
    title: "Employer unknown",
    stage: "Hygiene",
    why: "A personal email says nothing about where someone works, and the hygiene policy forbids guessing a company.",
    decide: "Find the employer (LinkedIn, the list source, rep notes), then re-run.",
  },
  company_conflict: {
    title: "Conflicting company signals",
    stage: "Hygiene",
    why: "The email domain and the company field point to unrelated companies. Picking one would silently discard a real signal.",
    decide: "Confirm which company this person works for.",
  },
  company_ambiguous: {
    title: "Company can't be confirmed",
    stage: "Hygiene",
    why: "The typed name isn't an exact match. Fuzzy matching is only allowed when one company clearly wins, and there's no work domain to confirm it.",
    decide: "Pick the right company, or confirm it's a new one.",
  },
  possible_duplicate: {
    title: "Possible duplicate",
    stage: "Hygiene",
    why: "Same name and company as another lead but a different email. Merging automatically could erase a real person; keeping both could route them twice.",
    decide: "Merge with the original, or keep as a separate person.",
  },
  location_unknown: {
    title: "Location unknown",
    stage: "Hygiene",
    why: "Territory is based on where the lead works. Copying the company HQ is not allowed, and ambiguous codes like \"WA\" aren't guessed.",
    decide: "Confirm where the lead is based.",
  },
  size_unknown: {
    title: "Company size unknown",
    stage: "Hygiene",
    why: "Segment depends on employee count. The company isn't in the reference database, so there is nothing to look up.",
    decide: "Look up the employee count.",
  },
  owner_inactive: {
    title: "Account owner has left",
    stage: "Routing",
    why: "This is an existing customer, but the CRM still lists a rep who has left. Handing a customer relationship to someone new is a manager's decision, so the router won't pick one.",
    decide: "Choose the new account owner. They get this lead, and the account should be reassigned in Salesforce too.",
  },
  owner_conflict: {
    title: "Account owner can't take it",
    stage: "Routing",
    why: "The CRM names an owner, but that rep is excluded from this industry. \"Owner keeps the account\" and \"exclusions apply everywhere\" can't both win.",
    decide: "Grant a one-off exception, or reassign the lead (or the account).",
  },
  coverage_gap: {
    title: "No rep covers this lead",
    stage: "Routing",
    why: "After exclusions, no rep covers this region, segment and industry. The policy won't force a lead onto someone outside their patch.",
    decide: "Assign manually, and consider fixing the territory map.",
  },
  capacity: {
    title: "Eligible reps are full",
    stage: "Routing",
    why: "Every rep who qualifies is at their open-lead capacity. Overloading someone is a manager's call, not the router's.",
    decide: "Approve overflow to one rep, or hold the lead.",
  },
};

export const ATTENTION_ORDER: AttentionKind[] = [
  "owner_inactive", "owner_conflict", "coverage_gap", "capacity",
  "employer_unknown", "company_conflict", "company_ambiguous", "possible_duplicate", "location_unknown", "size_unknown",
];

export interface AttentionItem {
  lead_id: string;
  kind: AttentionKind;
  blocking: string[]; // specific reasons from the engine
  options: { rep: Rep; note: string }[];
}

function options(org: OrgIndex, r: RoutingResult, kind: AttentionKind): { rep: Rep; note: string }[] {
  const { region, segment, industry } = r.context;
  if (!region || !segment) return [];
  const load = (rep: Rep) => `${rep.open_leads} open / ${rep.capacity}`;
  if (kind === "owner_inactive" || kind === "owner_conflict" || kind === "capacity") {
    return org.data.reps
      .filter((rep) => !rep.strategic_only && rep.regions.includes(region) && rep.segments.includes(segment) && !(industry && rep.exclusions.includes(industry)))
      .sort((a, b) => Number(!!industry && b.industries.includes(industry)) - Number(!!industry && a.industries.includes(industry)))
      .map((rep) => ({ rep, note: `${industry && rep.industries.includes(industry) ? `${industry} specialist · ` : ""}${load(rep)}` }));
  }
  if (kind === "coverage_gap") {
    return org.data.reps
      .filter((rep) => !rep.strategic_only && rep.regions.includes(region))
      .map((rep) => ({
        rep,
        note: industry && rep.exclusions.includes(industry)
          ? `covers ${REGION_LABEL[region]} ${SEGMENT_LABEL[segment]} but excludes ${industry}`
          : `covers ${REGION_LABEL[region]}, not ${SEGMENT_LABEL[segment]}`,
      }));
  }
  return [];
}

export function attentionItems(hygiene: HygieneResult[], routing: RoutingResult[], org: OrgIndex): AttentionItem[] {
  const rById = new Map(routing.map((r) => [r.lead_id, r]));
  const items: AttentionItem[] = [];
  for (const h of hygiene) {
    if (h.status === "DUPLICATE") continue; // exact duplicates merge automatically
    const r = rById.get(h.lead_id)!;
    if (h.status === "NEEDS_REVIEW" || h.status === "INSUFFICIENT_DATA") {
      const has = (f: string) => h.unresolved.some((u) => u.field === f);
      const identity = h.unresolved.find((u) => u.field === "company_identity");
      const kind: AttentionKind =
        has("duplicate") ? "possible_duplicate"
        : h.status === "INSUFFICIENT_DATA" ? "employer_unknown"
        : identity && /^Email domain/.test(identity.reason) ? "company_conflict"
        : identity ? "company_ambiguous"
        : has("country") || has("state") ? "location_unknown"
        : "size_unknown";
      items.push({ lead_id: h.lead_id, kind, blocking: h.unresolved.map((u) => u.reason), options: [] });
    } else if (r.decision === "requires_review") {
      const reason = r.review_reason ?? "";
      const kind: AttentionKind =
        /no longer active/.test(reason) ? "owner_inactive" : /excluded from/.test(reason) ? "owner_conflict" : /capacity/.test(reason) ? "capacity" : "coverage_gap";
      items.push({ lead_id: h.lead_id, kind, blocking: [reason], options: options(org, r, kind) });
    }
  }
  return items.sort((a, b) => ATTENTION_ORDER.indexOf(a.kind) - ATTENTION_ORDER.indexOf(b.kind) || a.lead_id.localeCompare(b.lead_id));
}

// ---------- Export overview ----------

export type AssignmentType = "existing" | "subsidiary" | "named" | "territory" | "manual";
export const ASSIGNMENT_LABEL: Record<AssignmentType, string> = {
  existing: "Existing customers",
  subsidiary: "Subsidiaries of customers",
  named: "Named accounts",
  territory: "New logos (territory)",
  manual: "Manual assignments",
};

export function assignmentType(r: RoutingResult): AssignmentType {
  if (r.manual) return "manual";
  switch (r.decisive_rule) {
    case "existing_account_owner": return "existing";
    case "parent_account_owner": return "subsidiary";
    case "named_account": return "named";
    default: return "territory";
  }
}
