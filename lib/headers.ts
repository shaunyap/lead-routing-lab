// Column-header normalization for list loads. Every source (event platform, webinar tool,
// purchased list) names its columns differently; this maps them onto standard lead fields.

import type { RawLead } from "./types";

export type SourceField = Exclude<keyof RawLead, "id">;

/** The column headers exactly as they appear in the loaded file. */
export const SOURCE_HEADERS: Record<SourceField, string> = {
  first_name: "First Name",
  last_name: "Last Name",
  email: "Email Address",
  company: "Company Name",
  company_domain: "Website",
  title: "Job Title",
  city: "City",
  state: "State/Province",
  country: "Country/Region",
  industry: "Industry",
  employee_count: "# of Employees",
  product_interest: "Interested In",
  session: "Session Attended",
  lead_source: "Lead Source",
};

/** Known spellings for each standard field, compared after lowercasing and stripping punctuation. */
const ALIASES: Record<SourceField, string[]> = {
  first_name: ["first name", "firstname", "first", "given name", "fname"],
  last_name: ["last name", "lastname", "last", "surname", "family name", "lname"],
  email: ["email", "email address", "e mail", "work email", "business email"],
  company: ["company", "company name", "organization", "organisation", "account name", "employer"],
  company_domain: ["website", "company website", "domain", "company domain", "url", "web site"],
  title: ["title", "job title", "jobtitle", "position", "role"],
  city: ["city", "town"],
  state: ["state", "state province", "province", "region", "state region"],
  country: ["country", "country region", "nation"],
  industry: ["industry", "vertical", "sector"],
  employee_count: ["employees", "of employees", "employee count", "company size", "headcount", "no of employees", "num employees"],
  product_interest: ["interested in", "product interest", "interest", "products"],
  session: ["session", "session attended", "event session", "track"],
  lead_source: ["lead source", "source", "channel"],
};

const clean = (h: string) => h.toLowerCase().replace(/[#/_\-.]+/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

export function normalizeHeader(header: string): SourceField | null {
  const h = clean(header);
  for (const [field, aliases] of Object.entries(ALIASES) as [SourceField, string[]][])
    if (aliases.includes(h) || clean(field.replace(/_/g, " ")) === h) return field;
  return null;
}

export interface HeaderMapping {
  source: string;
  field: SourceField | null;
  changed: boolean;
}

export function headerMappings(headers: string[] = Object.values(SOURCE_HEADERS)): HeaderMapping[] {
  return headers.map((source) => {
    const field = normalizeHeader(source);
    return { source, field, changed: field !== null && field !== source };
  });
}
