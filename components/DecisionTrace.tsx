"use client";

import type { OrgIndex } from "@/lib/org";
import type { HygieneResult, RoutingResult } from "@/lib/types";
import { DecisionChip } from "./ui";

const DOT: Record<string, string> = { pass: "✓", match: "●", fail: "✕", skip: "–" };

export function verdictReason(r: RoutingResult, org: OrgIndex): string {
  if (r.decision === "held") return r.review_reason ?? "Held at hygiene";
  if (r.decision === "requires_review") return `${r.review_reason}. No update will be sent until a person decides.`;
  switch (r.decisive_rule) {
    case "existing_account_owner": return "Existing customer. The account owner keeps the relationship.";
    case "parent_account_owner": return "Subsidiary of a customer. The parent account's owner takes it.";
    case "named_account": return "Named account. It goes straight to the named rep.";
    case "specialization": return `${r.context.industry} specialization breaks the tie.`;
    case "tiebreak": return `Tie between equally qualified reps. ${r.tie_broken_by}.`;
    case "manual": {
      const m = r.manual!;
      if (m.previous_decision === "auto_route") return `Assigned by hand. The router had picked ${m.previous_owner}.`;
      return `Assigned by hand. The router had sent it to review: ${m.previous_reason ?? "no safe owner"}.`;
    }
    case "capacity": return "Other candidates are at capacity.";
    default: {
      const rep = r.owner_id ? org.repById.get(r.owner_id) : null;
      return `Only ${rep?.name ?? "one rep"} covers this ${r.decisive_rule ?? "lead"}.`;
    }
  }
}

export default function DecisionTrace({
  r, h, org, onSalesforce, compact,
}: {
  r: RoutingResult; h: HygieneResult; org: OrgIndex; onSalesforce?: (id: string) => void; compact?: boolean;
}) {
  const person = `${h.record.first_name ?? ""} ${h.record.last_name ?? ""}`.trim();
  const filtered = r.candidates.filter((c) => c.eliminated_by === "industry_exclusions" || c.eliminated_by === "strategic_only_reps");
  const winner = r.candidates.find((c) => c.rep_id === r.owner_id);
  const others = r.candidates.filter((c) => c.rep_id !== r.owner_id);
  const ordered = [...(winner ? [winner] : []), ...others.filter((c) => c.eligible), ...others.filter((c) => !c.eligible)];
  const shown = compact ? ordered.filter((c, i) => c.eligible || c.rep_id === r.owner_id || i < 6) : ordered;
  // If routing stopped at an assigning step (e.g. a departed account owner), reps were never compared.
  const compared = r.trace.some((s) => ["geography", "segment", "specialization", "capacity"].includes(s.step)) || (!!r.decisive_rule && r.decisive_rule !== "manual" && !!r.owner_id);
  const heldThenManual = r.manual?.previous_decision === "held";

  return (
    <div key={r.lead_id + r.owner_id + r.decision}>
      <div className="trace-head" style={{ marginBottom: 14 }}>
        <h2>{h.record.company ?? "Unknown company"} — {person || "Unknown"}</h2>
        <span className="mono faint">{r.lead_id}</span>
        {r.manual ? <span className="chip accent"><span className="ic">✎</span>Manually assigned</span> : <DecisionChip decision={r.decision} />}
      </div>

      {heldThenManual ? (
        <div className="verdict auto">
          <div style={{ flex: 1 }}>
            <div className="who">→ {r.owner!.toUpperCase()}</div>
            <div className="why">Assigned by hand. Hygiene had held this lead: {r.manual!.previous_reason?.replace(/^Held at hygiene: /, "")}.</div>
          </div>
          {onSalesforce && <button className="btn small" onClick={() => onSalesforce(r.lead_id)}>Salesforce request ↗</button>}
        </div>
      ) : r.decision === "held" ? (
        <div className="verdict held">
          <div>
            <div className="who">Not routed</div>
            <div className="why">{r.review_reason}. Routing only sees records that hygiene cleared.</div>
          </div>
        </div>
      ) : (
        <>
          <div className={`trace ${compact ? "compact" : ""}`}>
            <div>
              <div className="section-title" style={{ marginTop: 0 }}>Decision path</div>
              <ol className="steps">
                <li className={filtered.length ? "pass" : "skip"} style={{ animationDelay: "0ms" }}>
                  <span className="dot">{filtered.length ? "✓" : "–"}</span>
                  <span className="lbl">Policy rules</span>
                  <span className="out">
                    {filtered.length ? `${filtered.length} rep${filtered.length > 1 ? "s" : ""} ruled out` : "No one ruled out"}
                    <span className="rule">industry exclusions · strategic-only reps</span>
                  </span>
                </li>
                {r.trace.map((s, i) => (
                  <li key={s.step} className={s.status} style={{ animationDelay: `${(i + 1) * 55}ms` }}>
                    <span className="dot">{DOT[s.status]}</span>
                    <span className="lbl">{s.label}</span>
                    <span className="out">
                      {s.outcome}
                      <span className="rule">{s.step}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <div className="section-title" style={{ marginTop: 0 }}>Reps considered</div>
              {!compared ? (
                <div className="not-compared">
                  Routing stopped at <b>{r.trace.at(-1)?.label.replace("?", "") ?? "the first step"}</b>, before any reps were compared.
                  {r.manual ? " The owner was then picked by hand." : " A person needs to choose the owner."}
                </div>
              ) : (
              <div className="reps">
                {shown.map((c, i) => {
                  const win = c.rep_id === r.owner_id;
                  // Qualified but not chosen: neutral, so only the winner reads as green.
                  const runnerUp = c.eligible && !win && !!r.owner_id;
                  const cls = win ? "win" : runnerUp ? "runner" : c.eligible ? "yes" : "no";
                  return (
                    <div key={c.rep_id} className={`rep ${cls}`} style={{ animationDelay: `${i * 30}ms` }}>
                      <span className="mk">{win ? "→" : runnerUp ? "–" : c.eligible ? "✓" : "✕"}</span>
                      <span className="nm">{c.name}</span>
                      <span className="notes">{c.notes.join(" / ") || (c.eligible ? "Eligible" : "")}</span>
                    </div>
                  );
                })}
                {compact && shown.length < ordered.length && (
                  <div className="faint" style={{ fontSize: 12, paddingLeft: 10 }}>+{ordered.length - shown.length} more not eligible</div>
                )}
              </div>
              )}
            </div>
          </div>
          <div className={`verdict ${r.decision === "auto_route" ? "auto" : "review"}`}>
            <div style={{ flex: 1 }}>
              <div className="who">{r.decision === "auto_route" ? `→ ${r.owner!.toUpperCase()}` : "→ REVIEW QUEUE"}{r.manual && <span className="chip accent" style={{ marginLeft: 10, verticalAlign: 3 }}>✎ Manual</span>}</div>
              <div className="why">{verdictReason(r, org)}</div>
            </div>
            {onSalesforce && (
              <button className="btn small" onClick={() => onSalesforce(r.lead_id)}>
                {r.decision === "auto_route" ? "Salesforce request" : "Proposed update"} ↗
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
