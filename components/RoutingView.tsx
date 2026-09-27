"use client";

import { useMemo, useState } from "react";
import type { OrgIndex } from "@/lib/org";
import type { Overrides } from "@/lib/overrides";
import type { RunResult } from "@/lib/pipeline";
import { parseRoutingPolicy, type RoutingStep } from "@/lib/policy";
import type { Dataset, RoutingDecision } from "@/lib/types";
import DecisionTrace from "./DecisionTrace";
import { AssignSelect, DecisionChip, Empty, Json, PassChip, Tile } from "./ui";

type Filter = RoutingDecision | "all" | "tie";

const PRIORITY_LABEL: Record<RoutingStep, string> = {
  existing_account_owner: "Existing account owner",
  parent_account_owner: "Parent account owner",
  named_account: "Named / strategic account",
  geography: "Geography",
  segment: "Segment",
  specialization: "Industry specialization",
  capacity: "Capacity",
};

export default function RoutingView({
  dataset, run, org, focus, setFocus, onSalesforce, onHygiene, overrides, onAssign, loads,
}: {
  dataset: Dataset; run: RunResult; org: OrgIndex; focus: string | null; setFocus: (id: string) => void;
  overrides: Overrides; onAssign: (leadId: string, repId: string | null) => void; loads: Map<string, number>;
  onSalesforce: (id: string) => void; onHygiene: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [rep, setRep] = useState("");
  const [q, setQ] = useState("");
  const [showJson, setShowJson] = useState(false);
  const hById = useMemo(() => new Map(run.hygiene.map((h) => [h.lead_id, h])), [run]);
  const routed = run.routing.filter((r) => hById.get(r.lead_id)!.status !== "DUPLICATE");
  const count = (f: (r: (typeof routed)[number]) => boolean) => routed.filter(f).length;

  const rows = routed.filter((r) => {
    if (filter === "tie" ? !r.tie_broken_by : filter !== "all" && r.decision !== filter) return false;
    if (rep && r.owner_id !== rep) return false;
    if (q) {
      const h = hById.get(r.lead_id)!;
      return `${h.record.first_name} ${h.record.last_name} ${h.record.company} ${r.owner} ${r.lead_id}`.toLowerCase().includes(q.toLowerCase());
    }
    return true;
  });
  const selected = routed.find((r) => r.lead_id === focus) ?? rows[0] ?? null;
  const truth = selected ? dataset.truth.routing[selected.lead_id] : null;
  const correct =
    selected && truth
      ? truth.expected_decision === selected.decision &&
        (selected.decision !== "auto_route" || truth.acceptable_owner_ids.includes(selected.owner_id!))
      : null;
  const showTruth = !!selected && !selected.manual;

  const precedence = useMemo(() => parseRoutingPolicy(run.policy.routingMd).policy?.precedence ?? [], [run]);

  return (
    <>
      <div className="priority">
        <span className="faint">Priority order</span>
        <ol>
          {precedence.map((step) => <li key={step}>{PRIORITY_LABEL[step]}</li>)}
        </ol>
      </div>
      <div className="tiles">
        <Tile label={<DecisionChip decision="auto_route" />} value={count((r) => r.decision === "auto_route")} detail="owner assigned" selected={filter === "auto_route"} onClick={() => setFilter(filter === "auto_route" ? "all" : "auto_route")} />
        <Tile label={<DecisionChip decision="requires_review" />} value={count((r) => r.decision === "requires_review")} detail="routing exceptions" selected={filter === "requires_review"} onClick={() => setFilter(filter === "requires_review" ? "all" : "requires_review")} />
        <Tile label={<DecisionChip decision="held" />} value={count((r) => r.decision === "held")} detail="never reached routing" selected={filter === "held"} onClick={() => setFilter(filter === "held" ? "all" : "held")} />
        <Tile label={<span className="chip neutral"><span className="ic">⚖</span>Tie-broken</span>} value={count((r) => !!r.tie_broken_by)} detail="several reps equally qualified" selected={filter === "tie"} onClick={() => setFilter(filter === "tie" ? "all" : "tie")} />
      </div>
      <div className="split">
        <div className="card">
          <div className="filters">
            <select className="btn small" value={rep} onChange={(e) => setRep(e.target.value)} aria-label="Filter by rep">
              <option value="">All reps</option>
              {org.data.reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <input type="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="list">
            {rows.map((r) => {
              const h = hById.get(r.lead_id)!;
              return (
                <button key={r.lead_id} className={`list-item ${selected?.lead_id === r.lead_id ? "active" : ""}`} onClick={() => setFocus(r.lead_id)}>
                  <span className="t">{h.record.company ?? "Unknown"} — {h.record.first_name} {h.record.last_name}</span>
                  {r.manual ? <span className="chip accent"><span className="ic">✎</span>Manual</span> : <DecisionChip decision={r.decision} />}
                  <span className="s">{r.owner ?? r.review_reason}</span>
                </button>
              );
            })}
            {rows.length === 0 && <Empty>No leads match.</Empty>}
          </div>
        </div>
        {selected ? (
          <div className="card">
            <div className="card-b">
              <DecisionTrace r={selected} h={hById.get(selected.lead_id)!} org={org} onSalesforce={onSalesforce} />
              <div className="row" style={{ marginTop: 16 }}>
                {showTruth && truth && correct !== null && (
                  <span className="faint" style={{ fontSize: 12.5 }}>
                    Ground truth: <PassChip pass={correct} label={correct ? "correct" : "incorrect"} /> <span style={{ marginLeft: 4 }}>{truth.basis}</span>
                  </span>
                )}
                <span className="spacer" />
                <AssignSelect org={org} value={overrides[selected.lead_id]} onChange={(id) => onAssign(selected.lead_id, id)} loads={loads} />
                <button className="btn small ghost" onClick={() => onHygiene(selected.lead_id)}>← Hygiene</button>
                <button className="btn small" onClick={() => setShowJson(!showJson)}>{showJson ? "Hide" : "Show"} JSON</button>
              </div>
              {showJson && (
                <div style={{ marginTop: 10 }}>
                  <Json
                    value={{
                      owner: selected.owner,
                      owner_id: selected.owner_id,
                      decision: selected.decision,
                      reason: selected.reason,
                      rules_applied: selected.rules_applied,
                      requires_review: selected.requires_review,
                      ...(selected.tie_broken_by ? { tie_broken_by: selected.tie_broken_by } : {}),
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="card"><Empty>Select a lead.</Empty></div>
        )}
      </div>
    </>
  );
}
