// Manual assignments made by a person. They sit on top of the engine's output and never
// change it, so evals always measure the policy, not the humans correcting it.

import type { OrgIndex } from "./org";
import type { RoutingResult } from "./types";

export type Overrides = Record<string, string>; // lead_id -> rep id

export function applyOverrides(routing: RoutingResult[], overrides: Overrides, org: OrgIndex): RoutingResult[] {
  return routing.map((r) => {
    const repId = overrides[r.lead_id];
    const rep = repId ? org.repById.get(repId) : undefined;
    if (!rep) return r;
    return {
      ...r,
      owner: rep.name,
      owner_id: rep.id,
      decision: "auto_route",
      requires_review: false,
      review_reason: null,
      reason: ["Manually assigned"],
      rules_applied: ["manual.override"],
      decisive_rule: "manual",
      tie_broken_by: null,
      manual: { previous_owner: r.owner, previous_decision: r.decision, previous_reason: r.review_reason },
    };
  });
}
