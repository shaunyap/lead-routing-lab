"use client";

import { Fragment, useMemo, useState } from "react";
import { ASSIGNMENT_LABEL, assignmentType, type AssignmentType } from "@/lib/attention";
import type { OrgIndex } from "@/lib/org";
import type { RunResult } from "@/lib/pipeline";
import { routingSummary } from "@/lib/routing";
import { compositeRequest, salesforceAction } from "@/lib/salesforce";
import type { Rep, RoutingResult } from "@/lib/types";
import type { Tab } from "./Lab";
import { Json, LoadBar, Tile } from "./ui";

const TYPES: AssignmentType[] = ["existing", "subsidiary", "named", "territory", "manual"];
const SHORT: Record<AssignmentType, string> = { existing: "Existing", subsidiary: "Subsidiary", named: "Named", territory: "New logo", manual: "Manual" };

interface Row {
  rep: Rep;
  leads: RoutingResult[];
  byType: Record<AssignmentType, number>;
  total: number;
}

export default function SalesforceView({ run, org, onOpen, onNav }: { run: RunResult; org: OrgIndex; onOpen: (id: string) => void; onNav: (t: Tab) => void }) {
  const [openRep, setOpenRep] = useState<string | null>(null);
  const [showApi, setShowApi] = useState(false);
  const hById = useMemo(() => new Map(run.hygiene.map((h) => [h.lead_id, h])), [run]);
  const routed = run.routing.filter((r) => r.decision === "auto_route" && r.owner_id);
  const blocked = run.routing.filter((r) => r.decision !== "auto_route" && hById.get(r.lead_id)!.status !== "DUPLICATE").length;
  const actions = useMemo(() => run.routing.map((r) => salesforceAction(r, org)), [run, org]);
  const batches = useMemo(() => compositeRequest(actions, org), [actions, org]);

  const rows: Row[] = useMemo(
    () =>
      org.data.reps.map((rep) => {
        const leads = routed.filter((r) => r.owner_id === rep.id);
        const byType: Record<AssignmentType, number> = { existing: 0, subsidiary: 0, named: 0, territory: 0, manual: 0 };
        for (const l of leads) byType[assignmentType(l)]++;
        return { rep, leads, byType, total: rep.open_leads + leads.length };
      }),
    [routed, org],
  );
  const max = Math.max(...rows.map((r) => Math.max(r.total, r.rep.capacity))) * 1.04;
  const sum = (f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0);
  const overCap = rows.filter((r) => r.total > r.rep.capacity);
  const nearCap = rows.filter((r) => r.total <= r.rep.capacity && r.total / r.rep.capacity >= 0.9);

  return (
    <>
      <p className="intro">
        What the export would do to each AE&rsquo;s queue. <b>{routed.length} leads</b> are ready to assign.{" "}
        {blocked > 0 && (
          <>
            {blocked} more are waiting in <button className="linkish" onClick={() => onNav("attention")}>Address Exceptions</button> and won&rsquo;t be sent.
          </>
        )}{" "}
        Nothing is sent in this demo; there are no Salesforce credentials. The demo also treats every lead as new to
        Salesforce: it doesn&rsquo;t check whether a lead or contact with the same email already exists. A production version
        would upsert by email, and the routing policy would decide whether an existing owner keeps the lead.
      </p>
      <div className="tiles">
        <Tile label="Leads to assign" value={routed.length} detail={`across ${rows.filter((r) => r.leads.length).length} AEs`} tone="good" />
        <Tile label="Held back" value={blocked} detail="need a person first" tone={blocked ? "warn" : undefined} />
        <Tile label="Over capacity after export" value={overCap.length} detail={overCap.length ? overCap.map((r) => r.rep.name.split(" ")[0]).join(", ") : "no one"} tone={overCap.length ? "critical" : "good"} />
        <Tile label="At 90%+ of capacity" value={nearCap.length} detail={nearCap.length ? nearCap.map((r) => r.rep.name.split(" ")[0]).join(", ") : "no one"} />
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Assignments by AE</h3>
          <span className="faint">click a row to see the leads</span>
          <span className="spacer" />
          <div className="legend">
            <span className="l-open">Current open</span>
            <span className="l-new">From this load</span>
            <span className="l-cap">Capacity</span>
          </div>
        </div>
        <div className="table-wrap" style={{ maxHeight: "none" }}>
          <table className="export-table">
            <thead>
              <tr>
                <th>AE</th>
                <th className="num">Open now</th>
                {TYPES.map((t) => <th key={t} className="num" title={ASSIGNMENT_LABEL[t]}>+ {SHORT[t]}</th>)}
                <th className="num">New total</th>
                <th style={{ width: "26%" }}>Load vs. capacity</th>
                <th className="num">Capacity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const pctLoad = row.total / row.rep.capacity;
                const isOpen = openRep === row.rep.id;
                return (
                  <Fragment key={row.rep.id}>
                    <tr className="clickable" onClick={() => setOpenRep(isOpen ? null : row.rep.id)}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{isOpen ? "▾" : "▸"} {row.rep.name}</div>
                        <div className="faint" style={{ fontSize: 12 }}>{row.rep.title}</div>
                      </td>
                      <td className="num muted">{row.rep.open_leads}</td>
                      {TYPES.map((t) => <td key={t} className={`num ${row.byType[t] ? "" : "faint"}`}>{row.byType[t] || "–"}</td>)}
                      <td className="num" style={{ fontWeight: 650 }}>{row.total}</td>
                      <td><LoadBar open={row.rep.open_leads} added={row.leads.length} capacity={row.rep.capacity} max={max} /></td>
                      <td className="num">
                        <span className={pctLoad > 1 ? "delta bad" : pctLoad >= 0.9 ? "warn-ink" : "muted"}>{row.rep.capacity}</span>
                        <div className="faint" style={{ fontSize: 11.5 }}>{Math.round(pctLoad * 100)}%{pctLoad > 1 ? " · over" : ""}</div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={TYPES.length + 5} style={{ background: "var(--surface-2)", padding: 0 }}>
                          {row.leads.length === 0 ? (
                            <div className="card-b faint">No leads from this load.</div>
                          ) : (
                            <table className="compact">
                              <tbody>
                                {row.leads.map((l) => {
                                  const h = hById.get(l.lead_id)!;
                                  return (
                                    <tr key={l.lead_id} className="clickable" onClick={() => onOpen(l.lead_id)}>
                                      <td className="mono faint" style={{ width: 80 }}>{l.lead_id}</td>
                                      <td style={{ width: "28%" }}><b>{h.record.company}</b> — {h.record.first_name} {h.record.last_name}</td>
                                      <td style={{ width: 170 }}><span className="chip neutral">{ASSIGNMENT_LABEL[assignmentType(l)]}</span></td>
                                      <td className="muted">{routingSummary(l)}</td>
                                      <td className="faint" style={{ width: 90 }}>API ↗</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              <tr className="total-row">
                <td><b>Total</b></td>
                <td className="num">{sum((r) => r.rep.open_leads)}</td>
                {TYPES.map((t) => <td key={t} className="num">{sum((r) => r.byType[t])}</td>)}
                <td className="num">{sum((r) => r.total)}</td>
                <td />
                <td className="num">{sum((r) => r.rep.capacity)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="card-b faint" style={{ fontSize: 12, borderTop: "1px solid var(--border)" }}>
          Existing-customer leads go to the account owner even when they are full; the relationship wins over capacity. That is how
          a rep can end up past 100%.
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-h">
          <h3>Salesforce API</h3>
          <span className="faint">
            {routed.length} <code>PATCH Lead.OwnerId</code> updates in {batches.length} composite batches · API {org.data.config.salesforce_api_version}
          </span>
          <span className="spacer" />
          <button className="btn small" onClick={() => setShowApi(!showApi)}>{showApi ? "Hide" : "Show"} payload</button>
          <button className="btn small primary" disabled title="No Salesforce credentials are configured in this demo">Send to Salesforce</button>
        </div>
        {showApi && batches[0] && (
          <div className="card-b">
            <div className="faint" style={{ marginBottom: 8, fontSize: 12.5 }}>
              Batch 1 of {batches.length}. <code>allOrNone: false</code>, so one bad record can&rsquo;t block the rest. Held-back leads are never included.
            </div>
            <div className="http" style={{ marginBottom: 8 }}><span className="m">POST</span>{batches[0].path}</div>
            <Json value={batches[0].body} />
          </div>
        )}
      </div>
    </>
  );
}
