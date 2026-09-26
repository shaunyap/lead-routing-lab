// Builds the Salesforce REST requests that routing *would* send. Nothing is executed.

import type { OrgIndex } from "./org";
import { routingSummary } from "./routing";
import type { RoutingResult } from "./types";

export function salesforceLeadId(leadId: string): string {
  const n = parseInt(leadId.replace(/\D/g, ""), 10) + (leadId.startsWith("H") ? 90000 : 0);
  return `00QDn00000${n.toString(36).toUpperCase().padStart(5, "0")}`;
}

export interface SalesforceAction {
  lead_id: string;
  sf_id: string;
  executable: boolean;
  method: "PATCH";
  path: string;
  body: Record<string, string>;
  note: string;
}

export function salesforceAction(r: RoutingResult, org: OrgIndex): SalesforceAction {
  const cfg = org.data.config;
  const sf_id = salesforceLeadId(r.lead_id);
  const path = `/services/data/${cfg.salesforce_api_version}/sobjects/Lead/${sf_id}`;
  if (r.decision === "auto_route" && r.owner_id) {
    return {
      lead_id: r.lead_id,
      sf_id,
      executable: true,
      method: "PATCH",
      path,
      body: {
        OwnerId: r.owner_id,
        Routing_Status__c: r.manual ? "Manually assigned" : "Auto-routed",
        Routing_Reason__c: r.manual
          ? `Manual override${r.manual.previous_reason ? ` (router: ${r.manual.previous_reason})` : r.manual.previous_owner ? ` (router picked ${r.manual.previous_owner})` : ""}`.slice(0, 255)
          : routingSummary(r),
        Routing_Rules__c: r.rules_applied.join(";").slice(0, 255),
      },
      note: `Assign to ${r.owner}${r.manual ? " (manual)" : ""}`,
    };
  }
  return {
    lead_id: r.lead_id,
    sf_id,
    executable: false,
    method: "PATCH",
    path,
    body: {
      OwnerId: cfg.review_queue_id,
      Routing_Status__c: r.decision === "held" ? "Held - Data Quality" : "Needs Review",
      Routing_Reason__c: (r.review_reason ?? "").slice(0, 255),
    },
    note: `Proposed only — a person must approve before this is sent to ${cfg.review_queue_name}`,
  };
}

export function compositeRequest(actions: SalesforceAction[], org: OrgIndex, batchSize = 25) {
  const v = org.data.config.salesforce_api_version;
  const executable = actions.filter((a) => a.executable);
  const batches: { method: "POST"; path: string; body: object }[] = [];
  for (let i = 0; i < executable.length; i += batchSize) {
    batches.push({
      method: "POST",
      path: `/services/data/${v}/composite`,
      body: {
        allOrNone: false,
        compositeRequest: executable.slice(i, i + batchSize).map((a) => ({
          method: a.method,
          url: a.path,
          referenceId: a.lead_id.replace(/-/g, "_"),
          body: a.body,
        })),
      },
    });
  }
  return batches;
}
