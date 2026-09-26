// Scores engine output against ground truth. Hygiene and routing are measured separately,
// and policy violations are checked against org facts, not against the routing policy.

import type { OrgIndex } from "./org";
import { regionFor } from "./org";
import type {
  CleanLead,
  EvalCase,
  GroundTruth,
  HygieneResult,
  HygieneStatus,
  LeadField,
  RawLead,
  RoutingResult,
} from "./types";
import { LEAD_FIELDS } from "./types";

export interface Ratio {
  correct: number;
  total: number;
}
const ratio = (): Ratio => ({ correct: 0, total: 0 });
export const rate = (r: Ratio) => (r.total === 0 ? 1 : r.correct / r.total);

export interface FieldMiss {
  lead_id: string;
  field: LeadField;
  expected: string;
  actual: string;
}

export interface UnsupportedInference {
  lead_id: string;
  field: LeadField;
  value: string;
  world_value: string;
  lucky: boolean; // happened to match reality — still unsupported
  source: string;
}

export interface HygieneEval {
  records: number;
  status: Ratio;
  fields: Ratio;
  corrected_fields: Ratio; // only fields the raw export got wrong
  enrichment: Ratio;
  review: { tp: number; fp: number; fn: number };
  duplicates: { tp: number; fp: number; fn: number };
  unsupported: UnsupportedInference[];
  filled_fields: number;
  field_misses: FieldMiss[];
  status_misses: { lead_id: string; expected: HygieneStatus; actual: HygieneStatus }[];
}

export type ViolationKind =
  | "owner_override"
  | "account_family_split"
  | "industry_exclusion"
  | "strategic_only"
  | "territory"
  | "capacity"
  | "routed_without_clean_data";

export interface Violation {
  lead_id: string;
  kind: ViolationKind;
  detail: string;
}

export interface RoutingMiss {
  lead_id: string;
  expected: string;
  actual: string;
  basis: string;
}

export interface RoutingEval {
  evaluated: number; // leads the gold says reach routing
  accuracy: Ratio; // routing-stage accuracy
  end_to_end: Ratio; // all unique leads, including hygiene holds
  escalation: { tp: number; fp: number; fn: number };
  violations: Violation[];
  ambiguous: number;
  workload: { rep_id: string; name: string; open: number; assigned: number; capacity: number }[];
  misses: RoutingMiss[];
}

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function evalHygiene(results: HygieneResult[], truth: GroundTruth, raws: RawLead[]): HygieneEval {
  const rawById = new Map(raws.map((r) => [r.id, r]));
  const e: HygieneEval = {
    records: 0, status: ratio(), fields: ratio(), corrected_fields: ratio(), enrichment: ratio(),
    review: { tp: 0, fp: 0, fn: 0 }, duplicates: { tp: 0, fp: 0, fn: 0 },
    unsupported: [], filled_fields: 0, field_misses: [], status_misses: [],
  };
  for (const r of results) {
    const t = truth.hygiene[r.lead_id];
    if (!t) continue;
    e.records++;
    e.status.total++;
    if (r.status === t.expected_status) e.status.correct++;
    else e.status_misses.push({ lead_id: r.lead_id, expected: t.expected_status, actual: r.status });

    const isDup = t.expected_status === "DUPLICATE";
    if (isDup && r.status === "DUPLICATE") e.duplicates.tp++;
    else if (isDup) e.duplicates.fn++;
    else if (r.status === "DUPLICATE") e.duplicates.fp++;
    if (isDup) continue;

    const expReview = t.expected_status === "NEEDS_REVIEW" || t.expected_status === "INSUFFICIENT_DATA";
    if (expReview && r.requires_review) e.review.tp++;
    else if (expReview) e.review.fn++;
    else if (r.requires_review) e.review.fp++;

    const raw = rawById.get(r.lead_id)!;
    for (const f of LEAD_FIELDS) {
      const exp = s(t.expected_record[f]);
      const act = s(r.record[f]);
      e.fields.total++;
      if (exp === act) e.fields.correct++;
      else e.field_misses.push({ lead_id: r.lead_id, field: f, expected: exp, actual: act });
      if (s(raw[f as keyof RawLead]) !== exp) {
        e.corrected_fields.total++;
        if (exp === act) e.corrected_fields.correct++;
      }
    }
    for (const f of t.expected_enrichments) {
      e.enrichment.total++;
      if (s(r.record[f]) === s(t.expected_record[f])) e.enrichment.correct++;
    }
    // Unsupported inference: a value the system asserted that the evidence did not support.
    e.filled_fields += r.enrichments.length;
    for (const f of LEAD_FIELDS) {
      const act = r.record[f];
      if (act === null) continue;
      const unknowable = t.unknowable_fields.includes(f);
      const enrichment = r.enrichments.find((x) => x.field === f);
      const wrongFill = enrichment && s(act) !== s(t.expected_record[f]);
      if (unknowable || wrongFill) {
        e.unsupported.push({
          lead_id: r.lead_id,
          field: f,
          value: s(act),
          world_value: s(t.world_record[f]),
          lucky: s(act) === s(t.world_record[f]),
          source: enrichment?.source ?? "record",
        });
      }
    }
  }
  return e;
}

function ownerName(org: OrgIndex, id: string | null) {
  return id ? org.repById.get(id)?.name ?? id : "—";
}

export function describeDecision(org: OrgIndex, decision: string, owner: string | null): string {
  if (decision === "auto_route") return ownerName(org, owner);
  return decision === "held" ? "Held at hygiene" : "Review queue";
}

export function evalRouting(
  routing: RoutingResult[],
  hygiene: HygieneResult[],
  truth: GroundTruth,
  org: OrgIndex,
): RoutingEval {
  const hById = new Map(hygiene.map((h) => [h.lead_id, h]));
  const e: RoutingEval = {
    evaluated: 0, accuracy: ratio(), end_to_end: ratio(), escalation: { tp: 0, fp: 0, fn: 0 },
    violations: [], ambiguous: 0, workload: [], misses: [],
  };
  const nonOwnerLoad = new Map<string, number>();
  const load = new Map<string, number>();
  for (const r of routing) {
    const g = truth.routing[r.lead_id];
    const ht = truth.hygiene[r.lead_id];
    if (!g || !ht || ht.expected_status === "DUPLICATE") continue;
    const correct =
      g.expected_decision === r.decision &&
      (r.decision !== "auto_route" || g.acceptable_owner_ids.includes(r.owner_id!));
    e.end_to_end.total++;
    if (correct) e.end_to_end.correct++;
    if (g.expected_decision !== "held") {
      e.evaluated++;
      e.accuracy.total++;
      if (correct) e.accuracy.correct++;
      const expRev = g.expected_decision === "requires_review";
      const actRev = r.decision !== "auto_route";
      if (expRev && actRev) e.escalation.tp++;
      else if (expRev) e.escalation.fn++;
      else if (actRev) e.escalation.fp++;
    }
    if (!correct) {
      e.misses.push({
        lead_id: r.lead_id,
        expected:
          g.expected_decision === "auto_route"
            ? g.acceptable_owner_ids.map((id) => ownerName(org, id)).join(" or ")
            : describeDecision(org, g.expected_decision, null),
        actual: describeDecision(org, r.decision, r.owner_id),
        basis: g.basis,
      });
    }
    if (r.tie_broken_by) e.ambiguous++;
    if (r.decision !== "auto_route" || !r.owner_id) continue;

    // ---- Policy-independent invariants, checked against org facts and world truth.
    const rep = org.repById.get(r.owner_id)!;
    load.set(rep.id, (load.get(rep.id) ?? 0) + 1);
    const company = ht.company_id ? org.companyById.get(ht.company_id) ?? null : null;
    const account = company ? org.accountByCompany.get(company.id) : undefined;
    const parentAccount = company?.parent_id ? org.accountByCompany.get(company.parent_id) : undefined;
    const named = company ? org.data.reps.find((x) => x.named_accounts.includes(company.id)) : undefined;
    const industry = ht.world_record.industry;
    const v = (kind: ViolationKind, detail: string) => e.violations.push({ lead_id: r.lead_id, kind, detail });

    if (g.expected_decision === "held")
      v("routed_without_clean_data", `Hygiene should have held this lead (${ht.expected_status}) but it was routed to ${rep.name}`);
    const acctOwner = account ? org.repById.get(account.owner_id)! : null;
    if (account && acctOwner && acctOwner.active !== false && account.owner_id !== rep.id && !(industry && acctOwner.exclusions.includes(industry)))
      v("owner_override", `${company!.name} is owned by ${ownerName(org, account.owner_id)}; routed to ${rep.name}`);
    if (!account && parentAccount && parentAccount.owner_id !== rep.id)
      v("account_family_split", `${company!.name} is a subsidiary of ${org.companyById.get(company!.parent_id!)!.name} (owner ${ownerName(org, parentAccount.owner_id)}); routed to ${rep.name}`);
    if (industry && rep.exclusions.includes(industry))
      v("industry_exclusion", `${rep.name} excludes ${industry}`);
    if (rep.strategic_only && !(company && rep.named_accounts.includes(company.id)))
      v("strategic_only", `${rep.name} is strategic-only; ${company?.name ?? "this company"} is not a named account`);
    const viaRelationship = [account?.owner_id, parentAccount?.owner_id, named?.id].includes(rep.id);
    if (!viaRelationship) {
      nonOwnerLoad.set(rep.id, (nonOwnerLoad.get(rep.id) ?? 0) + 1);
      const h = hById.get(r.lead_id)!;
      const reg = regionFor(org, h.record.state, h.record.country);
      if (reg && !rep.regions.includes(reg)) v("territory", `${rep.name} does not cover ${reg}`);
      const total = rep.open_leads + (nonOwnerLoad.get(rep.id) ?? 0);
      if (total > rep.capacity) v("capacity", `${rep.name} over capacity (${total}/${rep.capacity} open leads)`);
    }
  }
  e.workload = org.data.reps.map((r) => ({ rep_id: r.id, name: r.name, open: r.open_leads, assigned: load.get(r.id) ?? 0, capacity: r.capacity }));
  return e;
}

// ---------- Hard cases ----------

export interface CaseResult {
  case: EvalCase;
  hygiene: HygieneResult;
  routing: RoutingResult;
  hygiene_pass: boolean;
  routing_pass: boolean;
  problems: string[];
}

export function evalCases(cases: EvalCase[], hygiene: HygieneResult[], routing: RoutingResult[], org: OrgIndex): CaseResult[] {
  const hById = new Map(hygiene.map((h) => [h.lead_id, h]));
  const rById = new Map(routing.map((r) => [r.lead_id, r]));
  return cases.map((c) => {
    const h = hById.get(c.id)!;
    const r = rById.get(c.id)!;
    const problems: string[] = [];
    if (h.status !== c.expected_status) problems.push(`Hygiene status ${h.status}, expected ${c.expected_status}`);
    for (const [f, v] of Object.entries(c.expected_fields) as [keyof CleanLead, unknown][])
      if (s(h.record[f]) !== s(v)) problems.push(`${f} is "${s(h.record[f])}", expected "${s(v)}"`);
    for (const f of c.must_be_null)
      if (h.record[f] !== null) problems.push(`${f} was filled with "${s(h.record[f])}" — must stay empty`);
    const hygiene_pass = problems.length === 0;
    const routing_pass =
      r.decision === c.expected_decision &&
      (r.decision !== "auto_route" || c.acceptable_owner_ids.includes(r.owner_id!));
    if (!routing_pass)
      problems.push(
        `Routed: ${describeDecision(org, r.decision, r.owner_id)}; expected ${
          c.expected_decision === "auto_route"
            ? c.acceptable_owner_ids.map((id) => ownerName(org, id)).join(" or ")
            : describeDecision(org, c.expected_decision, null)
        }`,
      );
    return { case: c, hygiene: h, routing: r, hygiene_pass, routing_pass, problems };
  });
}
