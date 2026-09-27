"use client";

import { useMemo, useState } from "react";
import { ATTENTION_META, ATTENTION_ORDER, attentionItems, type AttentionItem, type AttentionKind } from "@/lib/attention";
import type { OrgIndex } from "@/lib/org";
import type { Overrides } from "@/lib/overrides";
import type { RunResult } from "@/lib/pipeline";
import type { Dataset } from "@/lib/types";
import type { Tab } from "./Lab";
import { AssignSelect, Empty, Tile } from "./ui";

export default function AttentionView({
  dataset, run, org, onOpen, overrides, onAssign, loads,
}: {
  dataset: Dataset; run: RunResult; org: OrgIndex; onOpen: (t: Tab, id?: string) => void;
  overrides: Overrides; onAssign: (leadId: string, repId: string | null) => void; loads: Map<string, number>;
}) {
  // Leads that share one decision (a departed account owner) are handled once per account.
  const rowsFor = (k: AttentionKind, group: AttentionItem[]) => {
    if (k !== "owner_inactive") return group.map((it) => ({ key: it.lead_id, items: [it] }));
    const byAccount = new Map<string, AttentionItem[]>();
    for (const it of group) {
      const key = hById.get(it.lead_id)?.company_id ?? it.lead_id;
      byAccount.set(key, [...(byAccount.get(key) ?? []), it]);
    }
    return [...byAccount].map(([key, items]) => ({ key, items }));
  };
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
            {rowsFor(k, group).map(({ key, items }) => {
              const ids = items.map((it) => it.lead_id);
              const first = items[0];
              const h = hById.get(first.lead_id)!;
              const raw = rawById.get(first.lead_id)!;
              const nameOf = (id: string) => {
                const hh = hById.get(id)!;
                const rr = rawById.get(id)!;
                return `${hh.record.first_name ?? rr.first_name} ${hh.record.last_name ?? rr.last_name}`.trim() || "Unknown";
              };
              const assigned = ids.every((id) => overrides[id]);
              const common = ids.every((id) => overrides[id] === overrides[ids[0]]) ? overrides[ids[0]] : undefined;
              const assignAll = (repId: string | null) => ids.forEach((id) => onAssign(id, repId));
              const many = items.length > 1;
              return (
                <div key={key} className={`attn-item ${assigned ? "resolved" : ""}`}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{many ? `${h.record.company} · ${items.length} leads` : nameOf(first.lead_id)}</div>
                    <div className="faint" style={{ fontSize: 12.5 }}>
                      {many
                        ? `${ids.slice(0, 3).map(nameOf).join(", ")}${ids.length > 3 ? ` +${ids.length - 3} more` : ""}`
                        : <>{h.record.company ?? raw.company ?? "no company"}{raw.email ? ` · ${raw.email.trim()}` : ""} · <span className="mono">{first.lead_id}</span></>}
                    </div>
                  </div>
                  <div>
                    {assigned ? (
                      <div className="attn-done">
                        ✓ {many ? `All ${items.length} leads assigned` : "Assigned"} to {org.repById.get(common ?? overrides[ids[0]])?.name} by hand
                      </div>
                    ) : (
                      first.blocking.map((b, i) => <div key={i} className="attn-block">{b}</div>)
                    )}
                    {!assigned && first.options.length > 0 && (
                      <div className="attn-options">
                        <span className="faint">{k === "coverage_gap" ? "Closest reps:" : many ? "New owner for all:" : "Could go to:"}</span>
                        {first.options.slice(0, 4).map((o) => {
                          const note = k === "coverage_gap"
                            ? o.note
                            : [o.note, `${(loads.get(o.rep.id) ?? o.rep.open_leads) + (many ? items.length : 1)}/${o.rep.capacity} if assigned`].filter(Boolean).join(" · ");
                          return (
                            <button key={o.rep.id} className="chip outline pick" title={`Assign to ${o.rep.name}`} onClick={() => assignAll(o.rep.id)}>
                              {o.rep.name} <span className="faint" style={{ fontWeight: 400 }}>· {note}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="row" style={{ justifyContent: "flex-end" }}>
                    <AssignSelect org={org} value={common} onChange={assignAll} loads={loads} />
                    <button className="btn small" onClick={() => onOpen(meta.stage === "Routing" ? "routing" : "hygiene", first.lead_id)}>
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
