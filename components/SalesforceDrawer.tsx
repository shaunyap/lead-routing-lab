"use client";

import { useEffect } from "react";
import type { OrgIndex } from "@/lib/org";
import type { RunResult } from "@/lib/pipeline";
import { campaignMember, salesforceAction } from "@/lib/salesforce";
import type { Dataset } from "@/lib/types";
import { verdictReason } from "./DecisionTrace";
import { DecisionChip, Json } from "./ui";

export default function SalesforceDrawer({
  leadId, run, org, dataset, onClose,
}: {
  leadId: string; run: RunResult; org: OrgIndex; dataset: Dataset; onClose: () => void;
}) {
  const r = run.routing.find((x) => x.lead_id === leadId)!;
  const h = run.hygiene.find((x) => x.lead_id === leadId)!;
  const a = salesforceAction(r, org, h);
  const raw = dataset.leads.find((l) => l.id === leadId);
  const cm = raw ? campaignMember(raw, org) : null;
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Salesforce API preview">
        <div className="drawer-h">
          <div>
            <div style={{ fontWeight: 650 }}>Salesforce API preview</div>
            <div className="faint" style={{ fontSize: 12 }}>
              {h.record.first_name} {h.record.last_name} · {h.record.company ?? "unknown company"} · {leadId}
            </div>
          </div>
          <span className="spacer" />
          <DecisionChip decision={r.decision} />
          <button className="btn small ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="drawer-b">
          <div className="section-title" style={{ marginTop: 0 }}>Routing decision</div>
          <dl className="kv">
            <dt>Owner</dt><dd><b>{r.owner ?? "—"}</b> {r.owner_id && <span className="mono faint">{r.owner_id}</span>}</dd>
            <dt>Why</dt><dd>{verdictReason(r, org)}</dd>
            <dt>Reasons</dt><dd>{r.reason.join(" · ") || "—"}</dd>
            <dt>Rules applied</dt><dd className="mono">{r.rules_applied.join(", ") || "—"}</dd>
          </dl>

          <div className="section-title">Request</div>
          {!a.executable && (
            <div className="blocked">
              <b>Not executable.</b> This lead needs a person, so the pipeline produces a <i>proposed</i> update only.
              A reviewer has to approve it before anything is sent to {org.data.config.review_queue_name}.
            </div>
          )}
          <div className="http" style={{ marginBottom: 8, opacity: a.executable ? 1 : 0.6 }}>
            <span className="m">{a.method}</span>{a.path}
          </div>
          <div style={{ opacity: a.executable ? 1 : 0.6 }}><Json value={a.body} /></div>
          <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>Email consent: {h.consent.reason}.</div>

          {cm && (
            <>
              <div className="section-title">Campaign membership</div>
              <div className="faint" style={{ fontSize: 12.5, marginBottom: 6 }}>Sent for every lead, routed or not, so the campaign gets credit.</div>
              <div className="http" style={{ marginBottom: 8 }}><span className="m">{cm.method}</span>{cm.path}</div>
              <Json value={cm.body} />
            </>
          )}

          <div className="section-title">Safety</div>
          <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            <li>No credentials are configured. v1 only previews requests.</li>
            <li>Only <code>auto_route</code> decisions produce executable updates.</li>
            <li><code>Routing_Reason__c</code> is capped at 255 characters (standard text field).</li>
            <li>Salesforce Lead ID is simulated: <span className="mono">{a.sf_id}</span></li>
          </ul>
        </div>
      </aside>
    </>
  );
}
