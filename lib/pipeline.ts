// Generate → Normalize → Route → Evaluate, plus policy-run comparison.

import { EVAL_CASES } from "./evalCases";
import { evalCases, evalHygiene, evalRouting, rate, type CaseResult, type HygieneEval, type RoutingEval } from "./evals";
import { ROUTABLE, runHygiene } from "./hygiene";
import type { OrgIndex } from "./org";
import { parseHygienePolicy, parseRoutingPolicy } from "./policy";
import { runRouting } from "./routing";
import type { Dataset, HygieneResult, RoutingResult } from "./types";

export interface PolicyVersion {
  version: number;
  label: string;
  hygieneMd: string;
  routingMd: string;
}

export interface Funnel {
  imported: number;
  duplicates: number;
  unique: number;
  dirty: number;
  repaired: number;
  review: number;
  routable: number;
  auto_routed: number;
  exceptions: number;
  eval_accuracy: number;
}

export interface RunResult {
  policy: PolicyVersion;
  hygiene: HygieneResult[];
  routing: RoutingResult[];
  hygieneEval: HygieneEval;
  routingEval: RoutingEval;
  cases: CaseResult[];
  funnel: Funnel;
}

export type RunOutcome = { ok: true; run: RunResult } | { ok: false; errors: string[] };

export function runPipeline(dataset: Dataset, org: OrgIndex, policy: PolicyVersion): RunOutcome {
  const hp = parseHygienePolicy(policy.hygieneMd);
  const rp = parseRoutingPolicy(policy.routingMd);
  const errors = [
    ...hp.errors.map((e) => `lead-hygiene: ${e}`),
    ...rp.errors.map((e) => `lead-routing: ${e}`),
  ];
  if (!hp.policy || !rp.policy || errors.length) return { ok: false, errors };

  const hygiene = runHygiene(dataset.leads, org, hp.policy);
  const routing = runRouting(hygiene, org, rp.policy);
  const hygieneEval = evalHygiene(hygiene, dataset.truth, dataset.leads);
  const routingEval = evalRouting(routing, hygiene, dataset.truth, org);

  // Hard cases run as their own batch so they never borrow capacity from the corpus.
  const caseRaws = EVAL_CASES.map((c) => c.raw);
  const caseHygiene = runHygiene(caseRaws, org, hp.policy);
  const caseRouting = runRouting(caseHygiene, org, rp.policy);
  const cases = evalCases(EVAL_CASES, caseHygiene, caseRouting, org);

  const count = (f: (h: HygieneResult) => boolean) => hygiene.filter(f).length;
  const duplicates = count((h) => h.status === "DUPLICATE");
  const funnel: Funnel = {
    imported: hygiene.length,
    duplicates,
    unique: hygiene.length - duplicates,
    dirty: count((h) => h.status !== "CLEAN" && h.status !== "DUPLICATE"),
    repaired: count((h) => h.status === "NORMALIZED" || h.status === "ENRICHED"),
    review: count((h) => h.status === "NEEDS_REVIEW" || h.status === "INSUFFICIENT_DATA"),
    routable: count((h) => ROUTABLE.includes(h.status)),
    auto_routed: routing.filter((r) => r.decision === "auto_route").length,
    exceptions: routing.filter((r) => r.decision === "requires_review").length,
    eval_accuracy: rate(routingEval.accuracy),
  };
  return { ok: true, run: { policy, hygiene, routing, hygieneEval, routingEval, cases, funnel } };
}

// ---------- Comparison ----------

export type ChangeKind = "direct" | "cascade" | "hygiene";

export interface AssignmentChange {
  lead_id: string;
  kind: ChangeKind;
  before: RoutingResult;
  after: RoutingResult;
  explanation: string;
  correct_before: boolean;
  correct_after: boolean;
}

export interface MetricRow {
  key: string;
  label: string;
  before: number;
  after: number;
  format: "pct" | "int";
  better: "up" | "down";
}

const eligibleSet = (r: RoutingResult) =>
  r.candidates.filter((c) => c.eligible).map((c) => c.rep_id).sort().join(",");

const outcome = (r: RoutingResult) =>
  r.decision === "auto_route" ? r.owner! : r.decision === "held" ? "Held at hygiene" : "Review queue";

function stepName(r: RoutingResult) {
  return r.decisive_rule ? r.decisive_rule.replace(/_/g, " ") : "—";
}

export function compareRuns(dataset: Dataset, a: RunResult, b: RunResult): { metrics: MetricRow[]; changes: AssignmentChange[] } {
  const correct = (r: RoutingResult) => {
    const g = dataset.truth.routing[r.lead_id];
    return !!g && g.expected_decision === r.decision && (r.decision !== "auto_route" || g.acceptable_owner_ids.includes(r.owner_id!));
  };
  const hA = new Map(a.hygiene.map((h) => [h.lead_id, h]));
  const hB = new Map(b.hygiene.map((h) => [h.lead_id, h]));
  const rB = new Map(b.routing.map((r) => [r.lead_id, r]));
  const changes: AssignmentChange[] = [];
  for (const before of a.routing) {
    const after = rB.get(before.lead_id)!;
    if (before.decision === after.decision && before.owner_id === after.owner_id) continue;
    const ha = hA.get(before.lead_id)!;
    const hb = hB.get(before.lead_id)!;
    let kind: ChangeKind;
    let explanation: string;
    if (ha.status !== hb.status || JSON.stringify(ha.record) !== JSON.stringify(hb.record)) {
      kind = "hygiene";
      explanation = `Hygiene outcome changed (${ha.status} → ${hb.status}), so routing saw a different record.`;
    } else if (
      before.decisive_rule !== after.decisive_rule ||
      before.rules_applied.filter((x) => !x.startsWith("tiebreak")).join() !==
        after.rules_applied.filter((x) => !x.startsWith("tiebreak")).join() ||
      eligibleSet(before) !== eligibleSet(after)
    ) {
      kind = "direct";
      explanation = `Decided by "${stepName(before)}" before, "${stepName(after)}" now. ${after.reason.join(" · ")}`;
    } else {
      kind = "cascade";
      explanation = `Same rules and same eligible reps — capacity shifted because other leads moved. ${after.tie_broken_by ?? ""}`.trim();
    }
    changes.push({
      lead_id: before.lead_id,
      kind,
      before,
      after,
      explanation: `${outcome(before)} → ${outcome(after)}. ${explanation}`,
      correct_before: correct(before),
      correct_after: correct(after),
    });
  }
  const passRate = (cs: CaseResult[]) => cs.filter((c) => c.hygiene_pass && c.routing_pass).length / cs.length;
  const unsupported = (r: RunResult) => r.hygieneEval.unsupported.length;
  const metrics: MetricRow[] = [
    { key: "routing", label: "Routing accuracy", before: rate(a.routingEval.accuracy), after: rate(b.routingEval.accuracy), format: "pct", better: "up" },
    { key: "violations", label: "Policy violations", before: a.routingEval.violations.length, after: b.routingEval.violations.length, format: "int", better: "down" },
    { key: "exceptions", label: "Routing exceptions", before: a.funnel.exceptions, after: b.funnel.exceptions, format: "int", better: "down" },
    { key: "fields", label: "Field accuracy (hygiene)", before: rate(a.hygieneEval.fields), after: rate(b.hygieneEval.fields), format: "pct", better: "up" },
    { key: "unsupported", label: "Unsupported inferences", before: unsupported(a), after: unsupported(b), format: "int", better: "down" },
    { key: "hard", label: "Hard cases passing", before: passRate(a.cases), after: passRate(b.cases), format: "pct", better: "up" },
  ];
  return { metrics, changes };
}
