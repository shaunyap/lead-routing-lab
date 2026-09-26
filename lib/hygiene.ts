// Hygiene engine: normalizes, enriches and escalates raw event leads according to the
// lead-hygiene policy. All policy comes from HygienePolicy; this file is the harness.

import type { OrgIndex } from "./org";
import { related } from "./org";
import type { HygienePolicy, InferenceName } from "./policy";
import type {
  CleanLead,
  Company,
  Enrichment,
  FieldChange,
  HygieneResult,
  HygieneStatus,
  LeadField,
  RawLead,
  Unresolved,
} from "./types";
import { companyKey, isOddCase, properCase, similarity } from "./util";

const blank = (s: string | undefined | null) => (s ?? "").trim() === "";
const val = (s: string) => (blank(s) ? null : s.trim().replace(/\s+/g, " "));

const SMALL_WORDS = new Set(["of", "and", "&", "for"]);

function caseWord(w: string, acronyms: Set<string>): string {
  if (acronyms.has(w.toUpperCase())) return w.toUpperCase();
  if (SMALL_WORDS.has(w.toLowerCase())) return w.toLowerCase();
  const hasInnerCaps = /[a-z]/.test(w) && /[A-Z]/.test(w.slice(1));
  if (hasInnerCaps) return w; // DevOps, RevOps
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

export function normalizeTitle(raw: string, p: HygienePolicy["title"]): { value: string; expanded: boolean } {
  const acr = new Set(p.acronyms.map((a) => a.toUpperCase()));
  const s = raw.trim().replace(/\s+/g, " ");
  const whole = p.whole_title[s.toLowerCase().replace(/\./g, "")];
  if (whole) return { value: whole, expanded: true };

  const tokens = s.replace(/\./g, "").split(/[\s,]+/).filter(Boolean);
  let expanded = false;
  const role = (t: string) => {
    const v = p.abbreviations[t.toLowerCase()];
    if (v) expanded = true;
    return v ? v.split(" ") : [t];
  };
  const fn = (t: string) => {
    const v = p.function_abbreviations[t.toLowerCase()] ?? p.abbreviations[t.toLowerCase()];
    if (v) expanded = true;
    return v ? v.split(" ") : [t];
  };

  // Level detection: longest level phrase at the start, after expanding role abbreviations.
  const levels = [...p.level_words].sort((a, b) => b.split(" ").length - a.split(" ").length);
  const head = tokens.slice(0, 3).flatMap((t) => (p.abbreviations[t.toLowerCase()] ?? t).split(" "));
  for (const level of levels) {
    const lw = level.split(" ");
    if (lw.every((w, i) => head[i]?.toLowerCase() === w.toLowerCase())) {
      // how many raw tokens did the level consume?
      let consumed = 0;
      let words = 0;
      while (words < lw.length) {
        words += (p.abbreviations[tokens[consumed].toLowerCase()] ?? tokens[consumed]).split(" ").length;
        consumed++;
      }
      if (tokens.slice(0, consumed).some((t) => p.abbreviations[t.toLowerCase()])) expanded = true;
      let rest = tokens.slice(consumed);
      if (rest[0]?.toLowerCase() === "of") rest = rest.slice(1);
      const fnWords = rest.flatMap(fn).map((w) => caseWord(w, acr));
      if (fnWords.length === 0) return { value: level, expanded };
      if (level === "Head") return { value: `Head of ${fnWords.join(" ")}`, expanded };
      return { value: `${level}, ${fnWords.join(" ")}`, expanded };
    }
  }
  const words = tokens
    .flatMap((t) => (p.abbreviations[t.toLowerCase()] ? role(t) : fn(t)))
    .map((w) => caseWord(w, acr));
  return { value: words.join(" "), expanded };
}

export function normalizeDomain(raw: string): string | null {
  let d = raw.trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  d = d.split(/[/?#]/)[0];
  d = d.replace(/,/g, ".").replace(/\.{2,}/g, ".").replace(/^\.|\.$/g, "").replace(/\s+/g, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : null;
}

export function parseEmployees(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/,/g, "").replace(/\s+/g, "");
  if (!s) return null;
  const k = s.match(/^(\d+(?:\.\d+)?)k\+?$/);
  if (k) return Math.round(parseFloat(k[1]) * 1000);
  const n = s.match(/^(\d+)\+?$/);
  return n ? parseInt(n[1], 10) : null;
}

interface Ctx {
  changes: FieldChange[];
  enrichments: Enrichment[];
  unresolved: Unresolved[];
  rec: CleanLead;
}

function change(ctx: Ctx, field: LeadField, from: string, to: string | number | null, reason: string) {
  const toS = to === null ? "" : String(to);
  if (from !== toS) ctx.changes.push({ field, from, to: toS, reason });
}

function enrich(
  ctx: Ctx,
  policy: HygienePolicy,
  field: LeadField,
  value: string | number,
  reason: string,
  inference?: InferenceName,
): boolean {
  if (!inference && !policy.enrichment.allowed_fields.includes(field)) return false;
  ctx.enrichments.push({
    field,
    value,
    source: inference ? `policy_inference:${inference}` : policy.enrichment.source,
    kind: inference ? "inference" : "lookup",
    reason,
  });
  (ctx.rec as any)[field] = value;
  return true;
}

export function cleanLead(raw: RawLead, org: OrgIndex, policy: HygienePolicy): Omit<HygieneResult, "status" | "duplicate_of" | "requires_review"> {
  const cfg = org.data.config;
  const ctx: Ctx = {
    changes: [],
    enrichments: [],
    unresolved: [],
    rec: {
      first_name: null, last_name: null, email: null, company: null, company_domain: null, title: null,
      city: null, state: null, country: null, industry: null, employee_count: null,
    },
  };
  const { rec } = ctx;
  const allow = (i: InferenceName) => policy.inference.allowed.includes(i);

  // ---- Names
  // First names: fix any all-lowercase word ("Michael john"). Last names stay cautious,
  // because lowercase particles are real ("van der Berg", "de la Cruz").
  const lowerWord = (v: string) => v.split(/[\s-]+/).some((w) => w.length > 1 && w === w.toLowerCase() && /[a-z]/.test(w));
  for (const f of ["first_name", "last_name"] as const) {
    const v = val(raw[f]);
    const fix = !!v && (isOddCase(v) || (f === "first_name" && lowerWord(v)));
    rec[f] = fix ? properCase(v!) : v;
    if (v) change(ctx, f, raw[f], rec[f], raw[f].trim() !== raw[f] || /\s{2,}/.test(raw[f]) ? "Trimmed whitespace and fixed capitalization" : "Fixed capitalization");
  }

  // ---- Email
  const email = val(raw.email)?.toLowerCase().replace(/\s+/g, "") ?? null;
  rec.email = email && /^[^@]+@[^@]+\.[^@]+$/.test(email) ? email : null;
  if (raw.email && rec.email) change(ctx, "email", raw.email, rec.email, "Lowercased and trimmed email");
  if (!rec.email && !blank(raw.email)) ctx.unresolved.push({ field: "email", reason: "Email address is malformed" });
  const emailDomain = rec.email ? rec.email.split("@")[1] : null;
  const personal = emailDomain ? org.personalDomains.has(emailDomain) : false;
  const workDomain = emailDomain && !personal ? emailDomain : null;

  // ---- Company domain
  const domainField = blank(raw.company_domain) ? null : normalizeDomain(raw.company_domain);
  rec.company_domain = domainField;
  if (!blank(raw.company_domain)) {
    if (domainField) change(ctx, "company_domain", raw.company_domain, domainField, "Cleaned malformed domain");
    else change(ctx, "company_domain", raw.company_domain, null, "Domain could not be parsed");
  }

  // ---- Title
  const rawTitle = val(raw.title);
  if (rawTitle) {
    const t = normalizeTitle(rawTitle, policy.title);
    rec.title = t.value;
    const reason =
      t.value.toLowerCase() === rawTitle.toLowerCase() ? "Fixed capitalization"
      : t.expanded ? "Standardized title abbreviation"
      : "Standardized title format";
    change(ctx, "title", raw.title, t.value, reason);
  }

  // ---- Location
  const rawCountry = val(raw.country);
  let country: string | null = null;
  if (rawCountry) {
    const alias = cfg.country_aliases[rawCountry.toLowerCase()];
    const known = [...Object.keys(cfg.region_by_country), "United States", "Canada"];
    const canon = alias ?? known.find((k) => k.toLowerCase() === rawCountry.toLowerCase()) ?? rawCountry;
    country = canon;
    change(ctx, "country", raw.country, canon, "Standardized country name");
  }
  const rawState = val(raw.state);
  let state: string | null = null;
  let stateIsUS = false;
  if (rawState) {
    const code = rawState.replace(/\./g, "").toUpperCase();
    const usName = cfg.us_states[code] ?? Object.values(cfg.us_states).find((n) => n.toLowerCase() === rawState.toLowerCase());
    const provName = cfg.provinces[code] ?? Object.values(cfg.provinces).find((n) => n.toLowerCase() === rawState.toLowerCase());
    const stateCode = Object.entries(cfg.us_states).find(([, n]) => n === usName)?.[0];
    if (country === "Canada" && provName) state = provName;
    else if (country === "United States" && usName) state = usName;
    else if (!country && usName) {
      const ambiguous = stateCode ? cfg.ambiguous_state_codes[stateCode] : undefined;
      if (ambiguous) {
        state = rawState;
        ctx.unresolved.push({ field: "country", reason: `Country missing and state is ambiguous: ${ambiguous}` });
      } else {
        state = usName;
        stateIsUS = true;
      }
    } else if (!country && provName) state = provName;
    else state = rawState;
    if (state !== rawState) change(ctx, "state", raw.state, state, "Expanded state abbreviation");
  }
  rec.state = state;
  rec.country = country;
  if (!country && stateIsUS) {
    if (allow("country_from_us_state"))
      enrich(ctx, policy, "country", "United States", `${state} is unambiguously a US state`, "country_from_us_state");
    else ctx.unresolved.push({ field: "country", reason: "Country missing" });
  }
  const rawCity = val(raw.city);
  rec.city = rawCity && isOddCase(rawCity) ? properCase(rawCity) : rawCity;
  if (rawCity) change(ctx, "city", raw.city, rec.city, "Fixed capitalization");

  // ---- Company resolution
  let company: Company | null = null;
  let conflict: string | null = null;
  const rawCompany = val(raw.company);
  const byEmail = workDomain ? org.companyByDomain.get(workDomain) : undefined;
  const byField = domainField ? org.companyByDomain.get(domainField) : undefined;
  if (byEmail && byField && !related(org, byEmail, byField)) {
    conflict = `Email domain belongs to ${byEmail.name} but company domain is ${byField.name}`;
  }
  const domainCompany = byEmail ?? byField ?? null;
  const exact = rawCompany ? org.companyByKey.get(companyKey(rawCompany)) ?? null : null;

  if (!conflict && domainCompany) {
    if (!rawCompany || !exact) {
      if (rawCompany && similarity(companyKey(rawCompany), companyKey(domainCompany.name)) < 0.5) {
        conflict = `Email domain belongs to ${domainCompany.name} but company field says "${rawCompany}"`;
      } else company = domainCompany;
    } else if (exact.id === domainCompany.id) company = domainCompany;
    else if (related(org, exact, domainCompany)) company = domainCompany;
    else conflict = `Email domain belongs to ${domainCompany.name} but company field says ${exact.name}`;
  } else if (!conflict && exact) {
    company = exact;
  }

  let ambiguousName: string | null = null;
  let inferredCompany = false;
  if (!conflict && !company && rawCompany && !workDomain) {
    // Only a typed name to go on (personal email or no email). Fuzzy match is an inference.
    const key = companyKey(rawCompany);
    const scored = org.data.companies
      .map((c) => ({ c, s: Math.max(...[c.name, ...c.aliases].map((n) => similarity(key, companyKey(n)))) }))
      .sort((a, b) => b.s - a.s);
    const { min_similarity, min_margin } = policy.inference.company_from_similar_name;
    const [best, second] = scored;
    if (best && best.s >= min_similarity) {
      const margin = best.s - (second?.s ?? 0);
      if (allow("company_from_similar_name") && margin >= min_margin) {
        company = best.c;
        inferredCompany = true;
      } else {
        ambiguousName =
          second && second.s >= min_similarity
            ? `"${rawCompany}" resembles ${best.c.name} and ${second.c.name}`
            : `"${rawCompany}" resembles ${best.c.name} but is not an exact match`;
      }
    }
  }

  if (conflict) {
    rec.company = rawCompany;
    ctx.unresolved.push({ field: "company_identity", reason: conflict });
  } else if (company) {
    if (!rawCompany) {
      enrich(ctx, policy, "company", company.name, `Matched company record by ${byEmail ? "email" : "company"} domain`);
    } else if (inferredCompany) {
      rec.company = rawCompany;
      ctx.enrichments.push({
        field: "company",
        value: company.name,
        source: "policy_inference:company_from_similar_name",
        kind: "inference",
        reason: `"${rawCompany}" is similar to ${company.name}`,
      });
      rec.company = company.name;
      ctx.changes.push({ field: "company", from: raw.company, to: company.name, reason: "Inferred from similar company name" });
    } else {
      rec.company = company.name;
      const reason =
        exact && exact.id !== company.id ? `Email domain identifies ${company.name}, a subsidiary/parent of ${exact.name}`
        : exact ? "Matched company name/alias to canonical record"
        : "Corrected company name to match email-domain record";
      change(ctx, "company", raw.company, company.name, reason);
    }
    if (!rec.company_domain) enrich(ctx, policy, "company_domain", company.domain, "From company record");
    else if (rec.company_domain !== company.domain && !byField) {
      change(ctx, "company_domain", raw.company_domain, company.domain, "Replaced unknown domain with company record domain");
      rec.company_domain = company.domain;
    }
  } else if (rawCompany) {
    rec.company = isOddCase(rawCompany) ? properCase(rawCompany) : rawCompany;
    change(ctx, "company", raw.company, rec.company, "Fixed capitalization");
    if (ambiguousName) ctx.unresolved.push({ field: "company_identity", reason: `Ambiguous company: ${ambiguousName}` });
    else if (!workDomain && !domainField)
      ctx.unresolved.push({ field: "company_identity", reason: `"${rawCompany}" is not in the company database and there is no work domain to confirm it` });
  } else {
    ctx.unresolved.push({
      field: "company_identity",
      reason: personal
        ? `Personal email (${emailDomain}) and no company name — employer cannot be determined`
        : "No company name and email domain is not in the company database",
    });
  }

  // ---- Industry
  const rawIndustry = val(raw.industry);
  const canonIndustries = new Set([
    ...org.data.companies.map((c) => c.industry),
    ...Object.values(policy.industry_aliases),
  ]);
  let industry: string | null = null;
  if (rawIndustry) {
    const canon = [...canonIndustries].find((i) => i.toLowerCase() === rawIndustry.toLowerCase());
    industry = canon ?? policy.industry_aliases[rawIndustry.toLowerCase()] ?? null;
    if (industry) change(ctx, "industry", raw.industry, industry, canon ? "Fixed capitalization" : "Mapped industry alias");
  }
  if (company) {
    if (industry && industry !== company.industry && policy.enrichment.company_record_overrides_self_reported.includes("industry")) {
      ctx.changes = ctx.changes.filter((c) => c.field !== "industry");
      ctx.changes.push({ field: "industry", from: raw.industry, to: company.industry, reason: "Company record overrides self-reported industry" });
      industry = company.industry;
    } else if (!industry) {
      rec.industry = null;
      if (enrich(ctx, policy, "industry", company.industry, rawIndustry ? `Unrecognized industry "${rawIndustry}"; used company record` : "From company record"))
        industry = company.industry;
    }
  } else if (!industry) {
    ctx.unresolved.push({ field: "industry", reason: rawIndustry ? `Unrecognized industry "${rawIndustry}"` : "Industry missing and company is not in the database" });
  }
  rec.industry = industry;

  // ---- Employee count
  const emp = blank(raw.employee_count) ? null : parseEmployees(raw.employee_count);
  rec.employee_count = emp;
  if (emp !== null) change(ctx, "employee_count", raw.employee_count, emp, "Parsed employee count");
  if (emp === null && company) enrich(ctx, policy, "employee_count", company.employees, "From company record");
  if (rec.employee_count === null)
    ctx.unresolved.push({ field: "employee_count", reason: company ? "Enrichment not permitted by policy" : "Employee count missing and company is not in the database" });

  // ---- Location inference (only if policy allows it)
  if (!rec.city && !rec.state && !rec.country) {
    if (company && allow("location_from_company_hq")) {
      enrich(ctx, policy, "city", company.hq.city, "Assumed attendee works at company HQ", "location_from_company_hq");
      if (company.hq.state) enrich(ctx, policy, "state", company.hq.state, "Assumed attendee works at company HQ", "location_from_company_hq");
      enrich(ctx, policy, "country", company.hq.country, "Assumed attendee works at company HQ", "location_from_company_hq");
    } else ctx.unresolved.push({ field: "country", reason: "Location missing — attendee location is not the company HQ" });
  } else if (!rec.country && !ctx.unresolved.some((u) => u.field === "country")) {
    ctx.unresolved.push({ field: "country", reason: "Country missing" });
  }
  if (rec.country && policy.review.state_required_for.includes(rec.country) && !rec.state)
    ctx.unresolved.push({ field: "state", reason: `State/province required for ${rec.country} routing` });

  return {
    lead_id: raw.id,
    changes: ctx.changes,
    enrichments: ctx.enrichments,
    unresolved: ctx.unresolved,
    company_id: company?.id ?? null,
    personal_email: personal,
    record: rec,
  };
}

function statusFor(r: Omit<HygieneResult, "status" | "duplicate_of" | "requires_review">, blocking: boolean): HygieneStatus {
  if (r.unresolved.some((u) => u.field === "company_identity") && !r.record.company) return "INSUFFICIENT_DATA";
  if (blocking) return "NEEDS_REVIEW";
  if (r.enrichments.length) return "ENRICHED";
  if (r.changes.length) return "NORMALIZED";
  return "CLEAN";
}

export function runHygiene(leads: RawLead[], org: OrgIndex, policy: HygienePolicy): HygieneResult[] {
  const byEmail = new Map<string, string>();
  const byNameCompany = new Map<string, string>();
  const required = new Set(policy.review.required_for_routing);
  return leads.map((raw) => {
    const r = cleanLead(raw, org, policy);
    const email = r.record.email;
    if (email && byEmail.has(email)) {
      return { ...r, status: "DUPLICATE", duplicate_of: byEmail.get(email)!, requires_review: false };
    }
    if (email) byEmail.set(email, raw.id);
    const ncKey =
      r.record.first_name && r.record.last_name && r.record.company
        ? `${r.record.first_name} ${r.record.last_name}|${r.company_id ?? companyKey(r.record.company)}`.toLowerCase()
        : null;
    if (ncKey && policy.review.possible_duplicate === "same_name_and_company") {
      const prior = byNameCompany.get(ncKey);
      if (prior) r.unresolved.push({ field: "duplicate", reason: `Same name and company as ${prior} with a different email` });
      else byNameCompany.set(ncKey, raw.id);
    }
    const blocking = r.unresolved.some(
      (u) =>
        u.field === "duplicate" ||
        required.has(u.field) ||
        (u.field === "state" && required.has("country")),
    );
    const status = statusFor(r, blocking);
    return {
      ...r,
      status,
      duplicate_of: null,
      requires_review: status === "NEEDS_REVIEW" || status === "INSUFFICIENT_DATA",
    };
  });
}

export const ROUTABLE: HygieneStatus[] = ["CLEAN", "NORMALIZED", "ENRICHED"];
