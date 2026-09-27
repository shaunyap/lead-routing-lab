// Parses the executable ```policy block out of a policy.md file and validates it.

import { parse as parseYaml } from "yaml";

export const INFERENCES = [
  "country_from_us_state",
  "company_from_similar_name",
  "location_from_company_hq",
] as const;
export type InferenceName = (typeof INFERENCES)[number];

export interface HygienePolicy {
  title: {
    level_words: string[];
    abbreviations: Record<string, string>;
    function_abbreviations: Record<string, string>;
    whole_title: Record<string, string>;
    acronyms: string[];
  };
  industry_aliases: Record<string, string>;
  enrichment: {
    source: string;
    allowed_fields: string[];
    company_record_overrides_self_reported: string[];
  };
  inference: {
    allowed: InferenceName[];
    company_from_similar_name: { min_similarity: number; min_margin: number };
  };
  consent: { opt_in_required_in: string[] };
  review: {
    required_for_routing: string[];
    state_required_for: string[];
    possible_duplicate: string | null;
  };
}

export const ROUTING_STEPS = [
  "existing_account_owner",
  "parent_account_owner",
  "named_account",
  "geography",
  "segment",
  "specialization",
  "capacity",
] as const;
export type RoutingStep = (typeof ROUTING_STEPS)[number];
export const ASSIGNING_STEPS: RoutingStep[] = [
  "existing_account_owner",
  "parent_account_owner",
  "named_account",
];

export const ROUTING_FILTERS = ["industry_exclusions", "strategic_only_reps"] as const;

export interface RoutingPolicy {
  segments: { enterprise: number; "mid-market": number; smb: number };
  filters: string[];
  precedence: RoutingStep[];
  existing_owner: { bypass_capacity: boolean; if_owner_excluded: "review" | "skip"; if_owner_inactive: "review" | "skip" };
  tiebreak: string[];
}

export interface ParsedPolicy<T> {
  ok: boolean;
  policy: T | null;
  errors: string[];
  block: string; // raw YAML of the policy block
}

const FENCE = /```policy\s*\n([\s\S]*?)```/;

export function extractPolicyBlock(markdown: string): string | null {
  const m = markdown.match(FENCE);
  return m ? m[1] : null;
}

function load(markdown: string): { data: any; errors: string[]; block: string } {
  const block = extractPolicyBlock(markdown);
  if (block === null) return { data: null, errors: ["No ```policy block found in policy.md"], block: "" };
  try {
    const data = parseYaml(block);
    if (!data || typeof data !== "object") return { data: null, errors: ["Policy block is empty"], block };
    return { data, errors: [], block };
  } catch (e: any) {
    return { data: null, errors: [`YAML error: ${e.message.split("\n")[0]}`], block };
  }
}

const lowerKeys = (o: Record<string, string> | undefined) =>
  Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [String(k).toLowerCase(), String(v)]));

export function parseHygienePolicy(markdown: string): ParsedPolicy<HygienePolicy> {
  const { data, errors, block } = load(markdown);
  if (!data) return { ok: false, policy: null, errors, block };
  const t = data.title ?? {};
  const inf = data.inference ?? {};
  const allowed: string[] = inf.allowed ?? [];
  for (const a of allowed)
    if (!(INFERENCES as readonly string[]).includes(a))
      errors.push(`Unknown inference "${a}". Known: ${INFERENCES.join(", ")}`);
  const sim = inf.company_from_similar_name ?? {};
  const policy: HygienePolicy = {
    title: {
      level_words: t.level_words ?? [],
      abbreviations: lowerKeys(t.abbreviations),
      function_abbreviations: lowerKeys(t.function_abbreviations),
      whole_title: lowerKeys(t.whole_title),
      acronyms: t.acronyms ?? [],
    },
    industry_aliases: lowerKeys(data.industry_aliases),
    enrichment: {
      source: data.enrichment?.source ?? "company_record",
      allowed_fields: data.enrichment?.allowed_fields ?? [],
      company_record_overrides_self_reported: data.enrichment?.company_record_overrides_self_reported ?? [],
    },
    inference: {
      allowed: allowed.filter((a) => (INFERENCES as readonly string[]).includes(a)) as InferenceName[],
      company_from_similar_name: {
        min_similarity: Number(sim.min_similarity ?? 0.9),
        min_margin: Number(sim.min_margin ?? 0.1),
      },
    },
    consent: { opt_in_required_in: data.consent?.opt_in_required_in ?? [] },
    review: {
      required_for_routing: data.review?.required_for_routing ?? ["company_identity", "country", "employee_count"],
      state_required_for: data.review?.state_required_for ?? [],
      possible_duplicate: data.review?.possible_duplicate ?? null,
    },
  };
  return { ok: errors.length === 0, policy, errors, block };
}

export function parseRoutingPolicy(markdown: string): ParsedPolicy<RoutingPolicy> {
  const { data, errors, block } = load(markdown);
  if (!data) return { ok: false, policy: null, errors, block };
  const precedence: string[] = data.precedence ?? [];
  if (precedence.length === 0) errors.push("precedence must list at least one step");
  for (const s of precedence)
    if (!(ROUTING_STEPS as readonly string[]).includes(s))
      errors.push(`Unknown precedence step "${s}". Known: ${ROUTING_STEPS.join(", ")}`);
  if (new Set(precedence).size !== precedence.length) errors.push("precedence lists a step twice");
  const filters: string[] = data.filters ?? [];
  for (const f of filters)
    if (!(ROUTING_FILTERS as readonly string[]).includes(f))
      errors.push(`Unknown filter "${f}". Known: ${ROUTING_FILTERS.join(", ")}`);
  const seg = data.segments ?? {};
  const segments = {
    enterprise: Number(seg.enterprise ?? 2000),
    "mid-market": Number(seg["mid-market"] ?? 200),
    smb: Number(seg.smb ?? 0),
  };
  if (!(segments.enterprise > segments["mid-market"] && segments["mid-market"] > segments.smb))
    errors.push("segments must satisfy enterprise > mid-market > smb");
  const policy: RoutingPolicy = {
    segments,
    filters,
    precedence: precedence.filter((s) => (ROUTING_STEPS as readonly string[]).includes(s)) as RoutingStep[],
    existing_owner: {
      bypass_capacity: data.existing_owner?.bypass_capacity ?? true,
      if_owner_excluded: data.existing_owner?.if_owner_excluded === "skip" ? "skip" : "review",
      if_owner_inactive: data.existing_owner?.if_owner_inactive === "skip" ? "skip" : "review",
    },
    tiebreak: data.tiebreak ?? ["lowest_utilization", "stable_hash"],
  };
  return { ok: errors.length === 0, policy, errors, block };
}
