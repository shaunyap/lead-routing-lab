"use client";

import { useMemo, useState } from "react";
import { ATTENTION_META, ATTENTION_ORDER, attentionItems, type AttentionKind } from "@/lib/attention";
import type { OrgIndex } from "@/lib/org";
import type { Overrides } from "@/lib/overrides";
import type { RunResult } from "@/lib/pipeline";
import type { Dataset } from "@/lib/types";
import type { Tab } from "./Lab";
import { AssignSelect, Empty, Tile } from "./ui";

export default function AttentionView({
  dataset, run, org, onOpen, overrides, onAssign,
}: {
  dataset: Dataset; run: RunResult; org: OrgIndex; onOpen: (t: Tab, id?: string) => void;
  overrides: Overrides; onAssign: (leadId: string, repId: string | null) => void;
}) {
  const items = useMemo(() => attentionItems(run.hygiene, run.routing, org), [run, org]);
  const [kind, setKind] = useState<AttentionKind | "all">("all");
  const hById = useMemo(() => new Map(run.hygiene.map((h) => [h.lead_id, h])), [run]);
  const rawById = useMemo(() => new Map(dataset.leads.map((l) => [l.id, l])), [dataset]);
  const kinds = ATTENTION_ORDER.filter((k) => items.some((i) => i.kind === k));
  const shown = kinds.filter((k) => kind === "all" || kind === k);
  const open = items.filter((i) => !overrides[i.lead_id]);
  const byStage = (s: "Hygiene" | "Routing") => open.filter((i) => ATTENTION_META[i.kind].stage === s).length;

  return (
    <>
      <p className="intro">
        <b>{open.length === 0 ? "Every exception has been handled." : `${open.length} of ${items.length} leads still need a person.`}</b> Each one stopped because the policy deliberately won&rsquo;t guess. Here&rsquo;s what
        is blocked, why the rules stop there, and the decision you need to make. Assigning an AE here sends the lead to
        Salesforce as a manual assignment; the evals keep scoring the router&rsquo;s own decision. Exact duplicate rows ({run.funnel.duplicates}) were
        merged automatically and aren&rsquo;t listed.
      </p>
      <div className="callout" style={{ marginBottom: 14 }}>
        <b>Where an LLM could help:</b> it could research missing fields, such as an employer or location, but only
        for inferences the hygiene policy explicitly allows. Each value would be labelled as an inference with its source, and
        the evals would measure how often those inferences turn out to be unsupported.
      </div>
      <div className="tiles">
        <Tile label="Blocked at hygiene" value={byStage("Hygiene")} detail="data can't be trusted yet" tone="warn" />
        <Tile label="Blocked at routing" value={byStage("Routing")} detail="clean data, no safe owner" tone="warn" />
        <Tile label="Assigned by hand" value={items.length - open.length} detail="resolved on this screen" tone="accent" />
        <Tile label="Ready for Salesforce" value={run.funnel.auto_routed + items.length - open.length} detail="not waiting on anyone" tone="good" />
      </div>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className={`chip ${kind === "all" ? "accent" : "outline"}`} style={{ cursor: "pointer" }} onClick={() => setKind("all")}>All {items.length}</button>
        {kinds.map((k) => (
          <button key={k} className={`chip ${kind === k ? "accent" : "outline"}`} style={{ cursor: "pointer" }} onClick={() => setKind(kind === k ? "all" : k)}>
            {ATTENTION_META[k].title} {items.filter((i) => i.kind === k && !overrides[i.lead_id]).length}
          </button>
        ))}
      </div>
      {items.length === 0 && <div className="card"><Empty>Nothing needs attention. Every lead was cleaned and routed.</Empty></div>}
      {shown.map((k) => {
        const meta = ATTENTION_META[k];
        const group = items.filter((i) => i.kind === k);
        return (
          <section key={k} className="card attn-group">
            <div className="card-h">
              <span className={`chip ${meta.stage === "Routing" ? "warn" : "neutral"}`}>{meta.stage}</span>
              <h3>{meta.title}</h3>
              <span className="faint">{group.filter((i) => !overrides[i.lead_id]).length} open{group.some((i) => overrides[i.lead_id]) ? ` · ${group.filter((i) => overrides[i.lead_id]).length} assigned` : ""}</span>
            </div>
            <div className="attn-explain">
              <div><div className="attn-k">Why the policy stops</div>{meta.why}</div>
              <div><div className="attn-k">Decision needed</div><b>{meta.decide}</b></div>
            </div>
            {group.map((it) => {
              const h = hById.get(it.lead_id)!;
              const raw = rawById.get(it.lead_id)!;
              const name = `${h.record.first_name ?? raw.first_name} ${h.record.last_name ?? raw.last_name}`.trim();
              return (
                <div key={it.lead_id} className={`attn-item ${overrides[it.lead_id] ? "resolved" : ""}`}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{name || "Unknown"}</div>
                    <div className="faint" style={{ fontSize: 12.5 }}>
                      {h.record.company ?? raw.company ?? "no company"}{raw.email ? ` · ${raw.email.trim()}` : ""} · <span className="mono">{it.lead_id}</span>
                    </div>
                  </div>
                  <div>
                    {overrides[it.lead_id] ? (
                      <div className="attn-done">✓ Assigned to {org.repById.get(overrides[it.lead_id])?.name} by hand</div>
                    ) : (
                      it.blocking.map((b, i) => <div key={i} className="attn-block">{b}</div>)
                    )}
                    {!overrides[it.lead_id] && it.options.length > 0 && (
                      <div className="attn-options">
                        <span className="faint">{k === "coverage_gap" ? "Closest reps:" : "Could go to:"}</span>
                        {it.options.slice(0, 4).map((o) => (
                          <button key={o.rep.id} className="chip outline pick" title={`Assign to ${o.rep.name}`} onClick={() => onAssign(it.lead_id, o.rep.id)}>
                            {o.rep.name} <span className="faint" style={{ fontWeight: 400 }}>· {o.note}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="row" style={{ justifyContent: "flex-end" }}>
                    <AssignSelect org={org} value={overrides[it.lead_id]} onChange={(id) => onAssign(it.lead_id, id)} />
                    <button className="btn small" onClick={() => onOpen(meta.stage === "Routing" ? "routing" : "hygiene", it.lead_id)}>
                      Open in {meta.stage} →
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </>
  );
}
