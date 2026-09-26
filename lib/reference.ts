// Reference routing: "what the business actually wants", written independently of the
// policy engine. Gold labels come from here, never from lib/routing.ts.
//
// It knows one thing the shipped v1 routing policy does not: leads from a subsidiary of an
// existing customer belong to the parent account's owner.

import type { OrgIndex } from "./org";
import type { CleanLead, HygieneStatus, Region, RoutingTruth, Segment } from "./types";

const ENTERPRISE = 2000;
const MID_MARKET = 200;

function region(org: OrgIndex, rec: CleanLead): Region | null {
  if (!rec.country) return null;
  return org.data.config.region_by_country[rec.country] ?? (rec.state ? org.data.config.region_by_state[rec.state] ?? null : null);
}

function segment(n: number | null): Segment | null {
  if (n === null) return null;
  return n >= ENTERPRISE ? "enterprise" : n >= MID_MARKET ? "mid-market" : "smb";
}

export function referenceRoute(
  org: OrgIndex,
  leadId: string,
  status: HygieneStatus,
  rec: CleanLead,
  companyId: string | null,
): RoutingTruth {
  if (!["CLEAN", "NORMALIZED", "ENRICHED"].includes(status)) {
    return { lead_id: leadId, expected_decision: "held", acceptable_owner_ids: [], basis: `Hygiene outcome ${status}` };
  }
  const company = companyId ? org.companyById.get(companyId) ?? null : null;
  const industry = rec.industry;
  const acct = company
    ? org.accountByCompany.get(company.id) ?? (company.parent_id ? org.accountByCompany.get(company.parent_id) : undefined)
    : undefined;
  if (acct) {
    const owner = org.repById.get(acct.owner_id)!;
    if (owner.active === false)
      return { lead_id: leadId, expected_decision: "requires_review", acceptable_owner_ids: [], basis: `Owner ${owner.name} has left — a manager picks the new owner` };
    if (industry && owner.exclusions.includes(industry))
      return { lead_id: leadId, expected_decision: "requires_review", acceptable_owner_ids: [], basis: `Owner ${owner.name} excluded from ${industry}` };
    const viaParent = acct.company_id !== company!.id;
    return {
      lead_id: leadId,
      expected_decision: "auto_route",
      acceptable_owner_ids: [owner.id],
      basis: viaParent ? `Subsidiary — parent account owner ${owner.name}` : `Existing account owner ${owner.name}`,
    };
  }
  if (company) {
    const named = org.data.reps.find((r) => r.named_accounts.includes(company.id));
    if (named) return { lead_id: leadId, expected_decision: "auto_route", acceptable_owner_ids: [named.id], basis: `Named account of ${named.name}` };
  }
  const reg = region(org, rec);
  const seg = segment(rec.employee_count);
  if (!reg || !seg) return { lead_id: leadId, expected_decision: "requires_review", acceptable_owner_ids: [], basis: "Region or segment unknown" };
  const pool = org.data.reps.filter(
    (r) => !r.strategic_only && r.regions.includes(reg) && r.segments.includes(seg) && !(industry && r.exclusions.includes(industry)),
  );
  if (!pool.length) return { lead_id: leadId, expected_decision: "requires_review", acceptable_owner_ids: [], basis: `No rep covers ${reg} ${seg}${industry ? ` ${industry}` : ""}` };
  const specialists = industry ? pool.filter((r) => r.industries.includes(industry)) : [];
  const final = specialists.length ? specialists : pool;
  return {
    lead_id: leadId,
    expected_decision: "auto_route",
    acceptable_owner_ids: final.map((r) => r.id),
    basis: `${reg} / ${seg}${specialists.length ? ` / ${industry} specialist` : ""}: ${final.map((r) => r.name).join(" or ")}`,
  };
}
