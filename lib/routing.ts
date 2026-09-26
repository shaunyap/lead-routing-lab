// Routing engine: evaluates clean leads against the sales org using the lead-routing policy.
// The order of steps, filters and thresholds all come from RoutingPolicy.

import type { OrgIndex } from "./org";
import { REGION_LABEL, SEGMENT_LABEL, regionFor, segmentFor } from "./org";
import type { RoutingPolicy, RoutingStep } from "./policy";
import { ROUTABLE } from "./hygiene";
import type {
  CandidateVerdict,
  HygieneResult,
  Rep,
  RoutingResult,
  TraceStep,
} from "./types";
import { stableHash } from "./util";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export const STEP_LABEL: Record<RoutingStep, string> = {
  existing_account_owner: "Existing account?",
  parent_account_owner: "Parent account?",
  named_account: "Named / strategic account?",
  geography: "Geography",
  segment: "Segment",
  specialization: "Industry specialization",
  capacity: "Capacity",
};

interface Load {
  assigned: Map<string, number>;
}

function heldResult(h: HygieneResult, reason: string): RoutingResult {
  return {
    lead_id: h.lead_id,
    owner: null,
    owner_id: null,
    decision: "held",
    reason: [reason],
    rules_applied: [],
    decisive_rule: null,
    requires_review: true,
    review_reason: reason,
    tie_broken_by: null,
    trace: [],
    candidates: [],
    context: { company_id: h.company_id, account_id: null, region: null, segment: null, industry: h.record.industry },
  };
}

export function routeLead(h: HygieneResult, org: OrgIndex, policy: RoutingPolicy, load: Load): RoutingResult {
  const rec = h.record;
  const company = h.company_id ? org.companyById.get(h.company_id) ?? null : null;
  const account = company ? org.accountByCompany.get(company.id) ?? null : null;
  const parent = company?.parent_id ? org.companyById.get(company.parent_id) ?? null : null;
  const parentAccount = parent ? org.accountByCompany.get(parent.id) ?? null : null;
  const region = regionFor(org, rec.state, rec.country);
  const segment = segmentFor(rec.employee_count, policy.segments);
  const industry = rec.industry;

  const trace: TraceStep[] = [];
  const reason: string[] = [];
  const rules: string[] = [];
  const verdicts = new Map<string, CandidateVerdict>(
    org.data.reps.map((r) => [r.id, { rep_id: r.id, name: r.name, eligible: true, notes: [] }]),
  );
  const eliminate = (r: Rep, by: string, note: string) => {
    const v = verdicts.get(r.id)!;
    if (!v.eligible) return;
    v.eligible = false;
    v.eliminated_by = by;
    v.notes = [note];
  };
  const assigned = (r: Rep) => load.assigned.get(r.id) ?? 0;
  const used = (r: Rep) => r.open_leads + assigned(r); // total open load after this batch so far
  const excluded = (r: Rep) =>
    policy.filters.includes("industry_exclusions") && !!industry && r.exclusions.includes(industry);

  const base = {
    lead_id: h.lead_id,
    context: { company_id: company?.id ?? null, account_id: account?.account_id ?? null, region, segment, industry },
  };
  const finish = (
    rep: Rep | null,
    decisive: string | null,
    extra: { review?: string; tie?: string | null } = {},
  ): RoutingResult => {
    if (rep) load.assigned.set(rep.id, assigned(rep) + 1);
    const candidates = [...verdicts.values()].sort((a, b) => Number(b.eligible) - Number(a.eligible));
    if (rep) {
      const v = verdicts.get(rep.id)!;
      v.eligible = true;
    }
    return {
      ...base,
      owner: rep?.name ?? null,
      owner_id: rep?.id ?? null,
      decision: rep ? "auto_route" : "requires_review",
      reason: extra.review ? [...reason, extra.review] : reason,
      rules_applied: rules,
      decisive_rule: decisive,
      requires_review: !rep,
      review_reason: extra.review ?? null,
      tie_broken_by: extra.tie ?? null,
      trace,
      candidates,
    };
  };
  const onlyWinner = (rep: Rep, note: string) => {
    for (const r of org.data.reps) if (r.id !== rep.id) eliminate(r, "assignment", `Not the ${note.toLowerCase()}`);
    verdicts.get(rep.id)!.notes.push(note);
  };

  // Filters apply to everyone, everywhere.
  for (const r of org.data.reps) if (excluded(r)) eliminate(r, "industry_exclusions", `Excludes ${industry}`);
  const strategicFilter = policy.filters.includes("strategic_only_reps");

  let pool: Rep[] = org.data.reps.filter((r) => verdicts.get(r.id)!.eligible);
  let setAside: Rep[] = []; // non-specialists held back by the specialization preference
  const passed: string[] = []; // labels of steps passed so far, for notes on revived reps
  const pass = (label: string) => {
    for (const r of pool) verdicts.get(r.id)!.notes.push(label);
    passed.push(label);
  };
  /** Apply a hard filter. If it would leave no one after a specialization preference, fall back. */
  const narrow = (by: string, keep: (r: Rep) => boolean, note: (r: Rep) => string): boolean => {
    for (const r of pool) if (!keep(r)) eliminate(r, by, note(r));
    const next = pool.filter(keep);
    const revived = setAside.filter(keep);
    if (next.length === 0 && revived.length > 0) {
      for (const r of revived) {
        const v = verdicts.get(r.id)!;
        v.eligible = true;
        v.eliminated_by = undefined;
        v.notes = [...passed.filter((p) => p !== industry)];
      }
      for (const r of setAside) if (!keep(r)) verdicts.get(r.id)!.notes = [note(r)];
      pool = revived;
      setAside = [];
      return true;
    }
    pool = next;
    setAside = revived;
    return false;
  };

  for (const step of policy.precedence) {
    const label = STEP_LABEL[step];
    if (step === "existing_account_owner" || step === "parent_account_owner") {
      const acct = step === "existing_account_owner" ? account : parentAccount;
      if (!acct) {
        trace.push({ step, label, outcome: "No", status: "skip" });
        continue;
      }
      const owner = org.repById.get(acct.owner_id)!;
      const via = step === "parent_account_owner" ? ` via parent ${parent!.name}` : "";
      if (owner.active === false) {
        trace.push({ step, label, outcome: `Yes — but owner ${owner.name} has left`, status: "fail" });
        if (policy.existing_owner.if_owner_inactive === "review") {
          rules.push(`${step}.owner_inactive`);
          return finish(null, step, { review: `Account owner ${owner.name} is no longer active` });
        }
        continue;
      }
      if (excluded(owner)) {
        trace.push({ step, label, outcome: `Yes — owner ${owner.name} excludes ${industry}`, status: "fail" });
        if (policy.existing_owner.if_owner_excluded === "review") {
          rules.push(`${step}.owner_excluded`);
          return finish(null, step, { review: `Account owner ${owner.name} is excluded from ${industry}` });
        }
        continue;
      }
      if (!policy.existing_owner.bypass_capacity && used(owner) >= owner.capacity) {
        trace.push({ step, label, outcome: `Yes — owner ${owner.name} at capacity`, status: "fail" });
        continue;
      }
      trace.push({ step, label, outcome: `Yes — owned by ${owner.name}${via}`, status: "match" });
      reason.push(step === "existing_account_owner" ? "Existing customer" : `Subsidiary of ${parent!.name}`, `Account owner ${owner.name}`);
      rules.push(step === "existing_account_owner" ? "account.existing_owner" : "account.parent_owner");
      onlyWinner(owner, step === "existing_account_owner" ? "Account owner" : "Parent account owner");
      return finish(owner, step);
    }
    if (step === "named_account") {
      const named = company ? org.data.reps.find((r) => r.named_accounts.includes(company.id) && !excluded(r)) : undefined;
      if (!named) {
        trace.push({ step, label, outcome: company?.strategic ? "Strategic, but on no rep's named list" : "No", status: "skip" });
        continue;
      }
      trace.push({ step, label, outcome: `Yes — named account of ${named.name}`, status: "match" });
      reason.push(company!.strategic ? "Strategic named account" : "Named account", `Named to ${named.name}`);
      rules.push(`named_account.${slug(named.name)}`);
      onlyWinner(named, "Named account owner");
      return finish(named, step);
    }
    // Narrowing steps: strategic-only reps leave the general pool here.
    if (strategicFilter) {
      for (const r of pool) if (r.strategic_only) eliminate(r, "strategic_only_reps", "Strategic accounts only");
      pool = pool.filter((r) => !r.strategic_only);
      setAside = setAside.filter((r) => !r.strategic_only);
    }
    let fellBack = false;
    if (step === "geography") {
      if (!region) {
        trace.push({ step, label, outcome: "Unknown", status: "fail" });
        return finish(null, step, { review: "Lead region could not be determined" });
      }
      const rl = REGION_LABEL[region];
      fellBack = narrow(step, (r) => r.regions.includes(region), () => `Not ${rl}`);
      pass(rl);
      trace.push({ step, label, outcome: fellBack ? `${rl} — no specialist here, using all ${rl} reps` : rl, status: "pass" });
      reason.push(`${rl} territory`);
      rules.push(`geo.${region}`);
    } else if (step === "segment") {
      if (!segment) {
        trace.push({ step, label, outcome: "Unknown", status: "fail" });
        return finish(null, step, { review: "Segment could not be determined" });
      }
      const sl = SEGMENT_LABEL[segment];
      fellBack = narrow(step, (r) => r.segments.includes(segment), () => `Not ${sl}`);
      pass(sl);
      const emp = `${sl} (${rec.employee_count?.toLocaleString("en-US")} employees)`;
      trace.push({ step, label, outcome: fellBack ? `${emp} — no specialist covers it, using all ${sl} reps` : emp, status: "pass" });
      reason.push(`${sl} account`);
      rules.push(`segment.${segment}`);
    } else if (step === "specialization") {
      if (!industry) {
        trace.push({ step, label, outcome: "Industry unknown — skipped", status: "skip" });
        continue;
      }
      const specialists = pool.filter((r) => r.industries.includes(industry));
      if (specialists.length > 0 && specialists.length < pool.length) {
        // A preference, not a filter: set the others aside so a later step can fall back to them.
        setAside = pool.filter((r) => !r.industries.includes(industry));
        for (const r of setAside) eliminate(r, step, `No ${industry} specialization`);
        pool = specialists;
      }
      if (specialists.length > 0) {
        pass(industry);
        trace.push({ step, label, outcome: `${industry} — ${specialists.length} specialist${specialists.length > 1 ? "s" : ""}`, status: "pass" });
        reason.push(`${industry} specialization`);
        rules.push(`specialization.${slug(industry)}`);
      } else {
        trace.push({ step, label, outcome: `${industry} — no specialist, kept all`, status: "skip" });
      }
    } else if (step === "capacity") {
      const before = pool.length;
      fellBack = narrow(step, (r) => used(r) < r.capacity, (r) => `At capacity (${used(r)}/${r.capacity})`);
      trace.push({
        step,
        label,
        outcome: fellBack ? "Specialists at capacity — using other eligible reps" : before === pool.length ? "All candidates have room" : `${before - pool.length} at capacity`,
        status: pool.length ? "pass" : "fail",
      });
      rules.push("capacity.check");
    }
    if (fellBack && industry) {
      // The specialization preference couldn't be met, so it no longer explains the decision.
      const i = reason.indexOf(`${industry} specialization`);
      if (i >= 0) reason.splice(i, 1);
      const j = rules.indexOf(`specialization.${slug(industry)}`);
      if (j >= 0) rules.splice(j, 1);
      rules.push("specialization.fallback");
      const st = trace.find((t) => t.step === "specialization");
      if (st) st.status = "skip";
    }
    if (pool.length === 0) {
      return finish(null, step, {
        review: step === "capacity" ? "Every eligible rep is at capacity" : "No rep matches this lead",
      });
    }
  }

  if (pool.length === 0) return finish(null, null, { review: "No rep matches this lead" });
  if (pool.length === 1) {
    const last = [...rules].reverse().find((r) => !r.startsWith("capacity") && r !== "specialization.fallback") ?? null;
    return finish(pool[0], last?.split(".")[0] ?? null);
  }
  // Tie-break: least utilized, then a stable hash so reruns are reproducible.
  const util = (r: Rep) => used(r) / r.capacity;
  const ranked = [...pool].sort(
    (a, b) => util(a) - util(b) || stableHash(h.lead_id + a.id) - stableHash(h.lead_id + b.id),
  );
  const winner = ranked[0];
  const runnerUp = ranked[1];
  const byUtil = util(winner) < util(runnerUp);
  const tie = byUtil
    ? `Least loaded: ${used(winner)}/${winner.capacity} vs ${runnerUp.name} ${used(runnerUp)}/${runnerUp.capacity}`
    : `Equal load — stable hash of lead ID`;
  for (const r of ranked.slice(1)) {
    const v = verdicts.get(r.id)!;
    v.notes.push(`Lost tie-break (${used(r)}/${r.capacity})`);
  }
  rules.push(byUtil ? "tiebreak.lowest_utilization" : "tiebreak.stable_hash");
  return finish(winner, "tiebreak", { tie });
}

export function runRouting(hygiene: HygieneResult[], org: OrgIndex, policy: RoutingPolicy): RoutingResult[] {
  const load: Load = { assigned: new Map() };
  const sorted = [...hygiene].sort((a, b) => a.lead_id.localeCompare(b.lead_id));
  const out = new Map<string, RoutingResult>();
  for (const h of sorted) {
    if (h.status === "DUPLICATE") out.set(h.lead_id, heldResult(h, `Duplicate of ${h.duplicate_of}`));
    else if (!ROUTABLE.includes(h.status))
      out.set(h.lead_id, heldResult(h, `Held at hygiene: ${h.status.replace("_", " ").toLowerCase()}`));
    else out.set(h.lead_id, routeLead(h, org, policy, load));
  }
  return hygiene.map((h) => out.get(h.lead_id)!);
}

/** "Enterprise > US West > Retail" — short enough for a Salesforce text field. */
export function routingSummary(r: RoutingResult): string {
  const parts = r.reason.filter((x) => !x.startsWith("Account owner") && !x.startsWith("Named to"));
  return parts.join(" > ").slice(0, 255);
}
