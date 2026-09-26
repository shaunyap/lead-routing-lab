// Indexes over the fictional sales org and company database.

import type { Account, Company, OrgData, Region, Rep, Segment } from "./types";
import { companyKey } from "./util";

export interface OrgIndex {
  data: OrgData;
  companyById: Map<string, Company>;
  companyByDomain: Map<string, Company>;
  companyByKey: Map<string, Company>;
  accountByCompany: Map<string, Account>;
  repById: Map<string, Rep>;
  personalDomains: Set<string>;
}

export function indexOrg(all: OrgData): OrgIndex {
  // Deactivated users stay visible as account owners but never receive leads.
  const data: OrgData = { ...all, reps: all.reps.filter((r) => r.active !== false) };
  const companyById = new Map(data.companies.map((c) => [c.id, c]));
  const companyByDomain = new Map(data.companies.map((c) => [c.domain, c]));
  const companyByKey = new Map<string, Company>();
  for (const c of data.companies)
    for (const n of [c.name, ...c.aliases]) companyByKey.set(companyKey(n), c);
  return {
    data,
    companyById,
    companyByDomain,
    companyByKey,
    accountByCompany: new Map(data.accounts.map((a) => [a.company_id, a])),
    repById: new Map(all.reps.map((r) => [r.id, r])),
    personalDomains: new Set(data.config.personal_email_domains),
  };
}

export function related(org: OrgIndex, a: Company, b: Company): boolean {
  return a.id === b.id || a.parent_id === b.id || b.parent_id === a.id;
}

export function regionFor(org: OrgIndex, state: string | null, country: string | null): Region | null {
  if (!country) return null;
  const byCountry = org.data.config.region_by_country[country];
  if (byCountry) return byCountry;
  if (!state) return null;
  return org.data.config.region_by_state[state] ?? null;
}

export function segmentFor(
  employees: number | null,
  thresholds: { enterprise: number; "mid-market": number },
): Segment | null {
  if (employees === null) return null;
  if (employees >= thresholds.enterprise) return "enterprise";
  if (employees >= thresholds["mid-market"]) return "mid-market";
  return "smb";
}

export const REGION_LABEL: Record<Region, string> = {
  "us-west": "US West",
  "us-central": "US Central",
  "us-east": "US East",
  emea: "EMEA",
  apac: "APAC",
};

export const SEGMENT_LABEL: Record<Segment, string> = {
  enterprise: "Enterprise",
  "mid-market": "Mid-Market",
  smb: "SMB",
};
