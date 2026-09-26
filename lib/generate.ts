// Deterministic generator for event badge-scan attendee exports.
// Builds clean attendees, then corrupts a quota of them the way real badge-scan exports
// are corrupted, recording world truth, recoverable truth and gold routing as it goes.

import type { OrgIndex } from "./org";
import { referenceRoute } from "./reference";
import type {
  CleanLead,
  Company,
  Dataset,
  HygieneStatus,
  HygieneTruth,
  LeadField,
  RawLead,
  RoutingTruth,
} from "./types";
import { mulberry32, pick, shuffle, weightedPick, type Rng } from "./util";

export const DEFAULT_SEED = 2026;

const FIRST = [
  "Aaliyah", "Aarav", "Adrian", "Aisha", "Alejandro", "Amara", "Andre", "Anika", "Anne-Marie", "Beatriz",
  "Caleb", "Camila", "Chen", "Daniel", "Dara", "Elena", "Emeka", "Farah", "Felix", "Gabriel",
  "Grace", "Hana", "Hugo", "Imani", "Isaac", "Jana", "Javier", "Julia", "Kai", "Kenji",
  "Laila", "Leo", "Lina", "Malik", "Maya", "Mateo", "Mei", "Nadia", "Naveen", "Nora",
  "Omar", "Oskar", "Paloma", "Quentin", "Rafael", "Rhea", "Rosa", "Samir", "Sana", "Theo",
  "Uma", "Victor", "Wen", "Yara", "Yusuf", "Zoe", "Ines", "Tariq", "Freya", "Mira",
];
const LAST = [
  "Abara", "Andersen", "Bauer", "Bhatt", "Brennan", "Castillo", "Chowdhury", "Dubois", "Eriksen", "Fontaine",
  "Garcia", "Haddad", "Ito", "Jensen", "Kowalski", "Laurent", "Nakamura", "Novak", "O'Neil", "Okonkwo",
  "Park", "Petrov", "Quinn", "Ramos", "Reyes", "Sato", "Schmidt", "Singh", "Sokolov", "Takahashi",
  "Tran", "Vance", "Varga", "Weiss", "Yilmaz", "Zhang", "Adeyemi", "Bergstrom", "Costa", "Delgado",
  "Ferreira", "Grant", "Hollis", "Iyer", "Kaur", "Lindqvist", "Moreau", "Nguyen", "Ortega", "Pham",
  "Rahman", "Sandoval", "Torres", "Ueda", "Voss", "Walsh", "Xu", "Young", "Zamora", "Boateng",
];

/** Canonical titles and the dirty variants seen in real exports. */
export const TITLES: { title: string; weight: number; variants: string[] }[] = [
  { title: "VP, Marketing", weight: 5, variants: ["VP Mktg", "vp marketing", "V.P. Marketing"] },
  { title: "VP, Engineering", weight: 5, variants: ["VP Eng", "VP Engg"] },
  { title: "VP, Sales", weight: 3, variants: ["VP Sales", "vp, sales"] },
  { title: "Director, IT", weight: 6, variants: ["Dir IT", "Director of IT", "DIRECTOR IT"] },
  { title: "Director, Marketing Operations", weight: 4, variants: ["Dir Mktg Ops", "Director Marketing Ops"] },
  { title: "Director, Data Platform", weight: 4, variants: ["Dir Data Platform"] },
  { title: "Director, Security", weight: 3, variants: ["Dir Security", "Dir. Security"] },
  { title: "Senior Manager, IT", weight: 4, variants: ["Sr Mgr IT", "Sr. Manager IT"] },
  { title: "Manager, Revenue Operations", weight: 4, variants: ["Mgr RevOps", "Mgr, Revenue Ops"] },
  { title: "Manager, Marketing Operations", weight: 4, variants: ["Mgr Mktg Ops", "Manager Mktg Ops"] },
  { title: "Head of Data", weight: 4, variants: ["head of data", "HEAD OF DATA"] },
  { title: "Head of Engineering", weight: 3, variants: ["Head of Eng"] },
  { title: "Senior Data Engineer", weight: 6, variants: ["Sr Data Eng", "Sr. Data Engineer", "senior data engineer"] },
  { title: "Software Engineer", weight: 6, variants: ["Software Eng", "SWE"] },
  { title: "Solutions Architect", weight: 4, variants: ["Solutions Arch", "Sol. Architect"] },
  { title: "Chief Information Officer", weight: 2, variants: ["CIO"] },
  { title: "Chief Technology Officer", weight: 2, variants: ["CTO"] },
  { title: "Chief Marketing Officer", weight: 2, variants: ["CMO"] },
  { title: "Data Scientist", weight: 5, variants: ["data scientist"] },
  { title: "Product Manager", weight: 4, variants: ["Product Mgr"] },
  { title: "Machine Learning Engineer", weight: 4, variants: [] },
];

const SESSIONS = [
  "Keynote: Agents in Production",
  "Workshop: Evaluating LLM Apps",
  "Data Platform Deep Dive",
  "Security for AI Systems",
  "Retail AI Roundtable",
  "Healthcare Data Summit",
  "Observability for Agents",
  "Financial Services AI Forum",
];
const PRODUCTS = ["Agent Platform", "Observability", "Evaluation", "Data Integration"];
const SOURCES = ["Event - Badge Scan", "Event - Session Check-in", "Event - Booth Demo"];

const US_CITIES: [string, string][] = [
  ["Seattle", "Washington"], ["Portland", "Oregon"], ["San Francisco", "California"], ["Los Angeles", "California"],
  ["San Jose", "California"], ["Denver", "Colorado"], ["Phoenix", "Arizona"], ["Austin", "Texas"],
  ["Dallas", "Texas"], ["Chicago", "Illinois"], ["Minneapolis", "Minnesota"], ["Columbus", "Ohio"],
  ["Detroit", "Michigan"], ["Kansas City", "Missouri"], ["New York", "New York"], ["Boston", "Massachusetts"],
  ["Atlanta", "Georgia"], ["Charlotte", "North Carolina"], ["Philadelphia", "Pennsylvania"], ["Raleigh", "North Carolina"],
];

/** Real-looking companies that are NOT in our company database. */
export const UNKNOWN_COMPANIES: Company[] = [
  { id: "u01", name: "Brightpath Robotics", aliases: [], domain: "brightpathrobotics.com", industry: "Manufacturing", employees: 120, hq: { city: "Austin", state: "Texas", country: "United States" } },
  { id: "u02", name: "Oakline Clinics", aliases: [], domain: "oaklineclinics.com", industry: "Healthcare", employees: 450, hq: { city: "Denver", state: "Colorado", country: "United States" } },
  { id: "u03", name: "Parcel & Pine", aliases: [], domain: "parcelandpine.com", industry: "Retail", employees: 35, hq: { city: "Portland", state: "Oregon", country: "United States" } },
  { id: "u04", name: "Velo Payments", aliases: [], domain: "velopay.io", industry: "Financial Services", employees: 90, hq: { city: "New York", state: "New York", country: "United States" } },
  { id: "u05", name: "Nimbus Forge", aliases: [], domain: "nimbusforge.dev", industry: "Technology", employees: 25, hq: { city: "San Francisco", state: "California", country: "United States" } },
  { id: "u06", name: "Fjord Freight", aliases: [], domain: "fjordfreight.eu", industry: "Manufacturing", employees: 600, hq: { city: "Amsterdam", state: "", country: "Netherlands" } },
  { id: "u07", name: "Tanuki Games", aliases: [], domain: "tanukigames.jp", industry: "Media & Entertainment", employees: 70, hq: { city: "Tokyo", state: "", country: "Japan" } },
  { id: "u08", name: "Sable Analytics", aliases: [], domain: "sableanalytics.com", industry: "Technology", employees: 1500, hq: { city: "Chicago", state: "Illinois", country: "United States" } },
];

const INDUSTRY_VARIANTS: Record<string, string[]> = {
  "Financial Services": ["FinServ", "Fin Svcs", "Banking"],
  Healthcare: ["Health Care", "healthcare & life sciences"],
  Retail: ["Retail & eCommerce"],
  Technology: ["Tech", "Software"],
  Manufacturing: ["Mfg", "Industrial"],
  "Media & Entertainment": ["Media"],
  "Public Sector": ["Government"],
};
const PERSONAL = ["gmail.com", "outlook.com", "yahoo.com"];

interface Person {
  pid: string;
  company: Company;
  known: boolean; // company in our database
  world: CleanLead;
  raw: RawLead;
  expected: CleanLead;
  unknowable: Set<LeadField>;
  enriched: Set<LeadField>;
  effects: Set<"change" | "enrich" | "review" | "insufficient">;
  corruptions: string[];
}

const slugName = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z-]/g, "");

type Corruption = { name: string; group: string; apply: (p: Person, rng: Rng, org: OrgIndex) => boolean };

const CORRUPTIONS: Record<string, Corruption> = {
  title_abbrev: {
    name: "title_abbrev", group: "title",
    apply: (p, rng) => {
      const t = TITLES.find((t) => t.title === p.world.title)!;
      if (!t.variants.length) return false;
      p.raw.title = pick(rng, t.variants);
      p.effects.add("change");
      return true;
    },
  },
  state_abbrev: {
    name: "state_abbrev", group: "state",
    apply: (p, _rng, org) => {
      if (!p.raw.state) return false;
      const code =
        Object.entries(org.data.config.us_states).find(([, n]) => n === p.raw.state)?.[0] ??
        Object.entries(org.data.config.provinces).find(([, n]) => n === p.raw.state)?.[0];
      if (!code) return false;
      p.raw.state = code;
      p.effects.add("change");
      return true;
    },
  },
  country_alias: {
    name: "country_alias", group: "country",
    apply: (p, rng) => {
      const opts: Record<string, string[]> = {
        "United States": ["USA", "U.S.", "US", "United States of America"],
        "United Kingdom": ["UK", "U.K."],
        Germany: ["Deutschland"],
        Netherlands: ["The Netherlands"],
      };
      const o = p.raw.country ? opts[p.raw.country] : undefined;
      if (!o) return false;
      p.raw.country = pick(rng, o);
      p.effects.add("change");
      return true;
    },
  },
  personal_email: {
    name: "personal_email", group: "identity",
    apply: (p, rng) => {
      if (!p.known || !p.raw.company) return false;
      p.raw.email = personalEmail(p, rng);
      p.raw.company_domain = "";
      p.expected.email = p.raw.email;
      p.enriched.add("company_domain");
      p.effects.add("enrich");
      return true;
    },
  },
  personal_email_no_company: {
    name: "personal_email_no_company", group: "identity",
    apply: (p, rng) => {
      p.raw.email = personalEmail(p, rng);
      p.raw.company = "";
      p.raw.company_domain = "";
      p.expected.email = p.raw.email;
      p.expected.company = null;
      p.expected.company_domain = null;
      p.unknowable.add("company").add("company_domain");
      p.effects.add("insufficient");
      return true;
    },
  },
  missing_company: {
    name: "missing_company", group: "identity",
    apply: (p) => {
      if (!p.known) return false;
      p.raw.company = "";
      p.enriched.add("company");
      p.effects.add("enrich");
      return true;
    },
  },
  company_variant: {
    name: "company_variant", group: "identity",
    apply: (p, rng) => {
      if (!p.known) return false;
      const c = p.company;
      p.raw.company = pick(rng, [...c.aliases, c.name.toUpperCase(), `${c.name}, Inc.`, c.name.toLowerCase()]);
      p.effects.add("change");
      return true;
    },
  },
  company_typo: {
    name: "company_typo", group: "identity",
    apply: (p, rng) => {
      if (!p.known) return false;
      const n = p.company.name;
      const i = 2 + Math.floor(rng() * (n.length - 4));
      if (n[i] === " " || n[i + 1] === " ") return false;
      p.raw.company = n.slice(0, i) + n[i + 1] + n[i] + n.slice(i + 2);
      if (p.raw.company === n) return false;
      p.effects.add("change");
      return true;
    },
  },
  conflict: {
    name: "conflict", group: "identity",
    apply: (p, rng, org) => {
      if (!p.known) return false;
      const others = org.data.companies.filter(
        (c) => c.id !== p.company.id && c.parent_id !== p.company.id && p.company.parent_id !== c.id,
      );
      const other = pick(rng, others);
      p.raw.company = other.name;
      p.expected.company = other.name;
      p.effects.add("review");
      return true;
    },
  },
  caps: {
    name: "caps", group: "caps",
    apply: (p, rng) => {
      const f = rng() < 0.5 ? (s: string) => s.toUpperCase() : (s: string) => s.toLowerCase();
      p.raw.first_name = f(p.raw.first_name);
      p.raw.last_name = f(p.raw.last_name);
      if (rng() < 0.4 && p.raw.city) p.raw.city = f(p.raw.city);
      p.effects.add("change");
      return true;
    },
  },
  email_case: {
    name: "email_case", group: "email",
    apply: (p) => {
      const [u, d] = p.raw.email.split("@");
      p.raw.email = ` ${u.charAt(0).toUpperCase()}${u.slice(1)}@${d.charAt(0).toUpperCase()}${d.slice(1)} `;
      p.effects.add("change");
      return true;
    },
  },
  malformed_domain: {
    name: "malformed_domain", group: "domain",
    apply: (p, rng) => {
      const d = p.raw.company_domain;
      if (!d) return false;
      const [host, ...rest] = d.split(".");
      p.raw.company_domain = pick(rng, [
        `www.${d}`, `https://${d}/`, d.toUpperCase(), `${host}..${rest.join(".")}`, `${d}.`, `http://www.${d}/contact`,
      ]);
      p.effects.add("change");
      return true;
    },
  },
  employee_format: {
    name: "employee_format", group: "employees",
    apply: (p, rng) => {
      const n = p.world.employee_count!;
      if (!p.raw.employee_count || n < 1000) return false;
      p.raw.employee_count = n % 100 === 0 && rng() < 0.5 ? `${n / 1000}k` : n.toLocaleString("en-US");
      p.effects.add("change");
      return true;
    },
  },
  missing_employees: {
    name: "missing_employees", group: "employees",
    apply: (p) => {
      p.raw.employee_count = "";
      if (p.known) {
        p.enriched.add("employee_count");
        p.effects.add("enrich");
      } else {
        p.expected.employee_count = null;
        p.unknowable.add("employee_count");
        p.effects.add("review");
      }
      return true;
    },
  },
  missing_industry: {
    name: "missing_industry", group: "industry",
    apply: (p) => {
      p.raw.industry = "";
      if (p.known) {
        p.enriched.add("industry");
        p.effects.add("enrich");
      } else {
        p.expected.industry = null;
        p.unknowable.add("industry");
      }
      return true;
    },
  },
  industry_variant: {
    name: "industry_variant", group: "industry",
    apply: (p, rng) => {
      const v = INDUSTRY_VARIANTS[p.world.industry!];
      if (!v || !p.raw.industry) return false;
      p.raw.industry = pick(rng, v);
      p.effects.add("change");
      return true;
    },
  },
  self_reported_industry: {
    name: "self_reported_industry", group: "industry",
    apply: (p, rng) => {
      if (!p.known) return false;
      p.raw.industry = pick(rng, Object.keys(INDUSTRY_VARIANTS).filter((i) => i !== p.world.industry));
      p.effects.add("change");
      return true;
    },
  },
  missing_location: {
    name: "missing_location", group: "location",
    apply: (p) => {
      p.raw.city = p.raw.state = p.raw.country = "";
      p.expected.city = p.expected.state = p.expected.country = null;
      p.unknowable.add("city").add("state").add("country");
      p.effects.add("review");
      return true;
    },
  },
};

/** How many attendees receive each primary corruption. Quotas keep the story stable across seeds. */
const PRIMARY_QUOTA: [string, number][] = [
  ["personal_email_no_company", 4],
  ["conflict", 3],
  ["missing_location", 4],
  ["personal_email", 6],
  ["missing_company", 4],
  ["company_typo", 3],
  ["company_variant", 6],
  ["self_reported_industry", 3],
  ["missing_employees", 5],
  ["missing_industry", 4],
  ["industry_variant", 3],
  ["title_abbrev", 8],
  ["state_abbrev", 8],
  ["country_alias", 3],
  ["caps", 4],
  ["email_case", 3],
  ["malformed_domain", 4],
  ["employee_format", 2],
];
const SECONDARY = ["title_abbrev", "caps", "email_case", "state_abbrev", "malformed_domain", "country_alias", "employee_format"];
const SECONDARY_COUNT = 16;
const UNIQUE_ATTENDEES = 238;
const DUPLICATES = 12;

function personalEmail(p: Person, rng: Rng): string {
  const f = slugName(p.world.first_name!);
  const l = slugName(p.world.last_name!);
  const d = pick(rng, PERSONAL);
  return pick(rng, [`${f}.${l}@${d}`, `${f}${l}${10 + Math.floor(rng() * 89)}@${d}`, `${f}${l.charAt(0)}@${d}`]);
}

function statusFrom(effects: Set<string>): HygieneStatus {
  if (effects.has("insufficient")) return "INSUFFICIENT_DATA";
  if (effects.has("review")) return "NEEDS_REVIEW";
  if (effects.has("enrich")) return "ENRICHED";
  if (effects.has("change")) return "NORMALIZED";
  return "CLEAN";
}

export function generateDataset(seed: number, org: OrgIndex): Dataset {
  const rng = mulberry32(seed);
  const companies = org.data.companies;
  const subsidiary = (c: Company) => !!c.parent_id;

  // --- Clean attendees
  const usedNames = new Set<string>();
  const people: Person[] = [];
  for (let i = 0; i < UNIQUE_ATTENDEES; i++) {
    const known = i % 24 !== 5; // ~10 attendees from companies we have never heard of
    const company = known
      ? weightedPick(rng, companies, (c) => Math.pow(c.employees, 0.3) * (subsidiary(c) ? 1.1 : 1))
      : UNKNOWN_COMPANIES[Math.floor(i / 24) % UNKNOWN_COMPANIES.length];
    let first: string, last: string;
    do {
      first = pick(rng, FIRST);
      last = pick(rng, LAST);
    } while (usedNames.has(`${first} ${last}`));
    usedNames.add(`${first} ${last}`);
    const title = weightedPick(rng, TITLES, (t) => t.weight).title;
    let { city, state, country } = company.hq;
    if (country === "United States" && rng() < 0.22) [city, state] = pick(rng, US_CITIES);
    const world: CleanLead = {
      first_name: first,
      last_name: last,
      email: `${slugName(first)}.${slugName(last)}@${company.domain}`,
      company: company.name,
      company_domain: company.domain,
      title,
      city,
      state: state || null,
      country,
      industry: company.industry,
      employee_count: company.employees,
    };
    const raw: RawLead = {
      id: "",
      first_name: first,
      last_name: last,
      email: world.email!,
      company: company.name,
      company_domain: company.domain,
      title,
      city,
      state: state || "",
      country,
      industry: company.industry,
      employee_count: String(company.employees),
      product_interest: pick(rng, PRODUCTS),
      session: pick(rng, SESSIONS),
      lead_source: pick(rng, SOURCES),
    };
    people.push({
      pid: `P${String(i + 1).padStart(3, "0")}`,
      company,
      known,
      world,
      raw,
      expected: { ...world },
      unknowable: new Set(),
      enriched: new Set(),
      effects: new Set(),
      corruptions: [],
    });
  }

  // --- Corrupt a quota of attendees
  const order = shuffle(rng, people);
  const touched = new Set<Person>();
  let cursor = 0;
  for (const [name, count] of PRIMARY_QUOTA) {
    let done = 0;
    for (let scan = 0; scan < order.length && done < count; scan++) {
      const p = order[(cursor + scan) % order.length];
      if (touched.has(p)) continue;
      if (CORRUPTIONS[name].apply(p, rng, org)) {
        p.corruptions.push(name);
        touched.add(p);
        done++;
      }
    }
    cursor = (cursor + 17) % order.length;
  }
  const dirty = [...touched];
  for (let k = 0, guard = 0; k < SECONDARY_COUNT && guard < 500; guard++) {
    const p = pick(rng, dirty);
    const c = CORRUPTIONS[pick(rng, SECONDARY)];
    if (p.corruptions.some((x) => CORRUPTIONS[x].group === c.group)) continue;
    if (p.effects.has("insufficient") && c.group === "domain") continue;
    if (c.apply(p, rng, org)) {
      p.corruptions.push(c.name);
      k++;
    }
  }

  // --- Order rows and insert duplicates after their originals
  const rows: { p: Person; raw: RawLead; dupOf?: Person }[] = people.map((p) => ({ p, raw: p.raw }));
  const dupSources = shuffle(rng, people.filter((p) => !p.effects.has("insufficient"))).slice(0, DUPLICATES);
  for (const src of dupSources) {
    const at = rows.findIndex((r) => r.p === src && !r.dupOf);
    const pos = at + 1 + Math.floor(rng() * (rows.length - at));
    const [u, d] = src.raw.email.trim().split("@");
    const raw: RawLead = {
      ...src.raw,
      email: rng() < 0.6 ? `${u.charAt(0).toUpperCase()}${u.slice(1)}@${d}` : src.raw.email,
      session: pick(rng, SESSIONS.filter((s) => s !== src.raw.session)),
      lead_source: "Event - Session Check-in",
    };
    rows.splice(pos, 0, { p: src, raw, dupOf: src });
  }
  const idOf = new Map<Person, string>();
  rows.forEach((r, i) => {
    r.raw.id = `L-${String(i + 1).padStart(4, "0")}`;
    if (!r.dupOf) idOf.set(r.p, r.raw.id);
  });

  // --- Ground truth
  const hygiene: Record<string, HygieneTruth> = {};
  const routing: Record<string, RoutingTruth> = {};
  for (const r of rows) {
    const p = r.p;
    const id = r.raw.id;
    const status: HygieneStatus = r.dupOf ? "DUPLICATE" : statusFrom(p.effects);
    hygiene[id] = {
      lead_id: id,
      person_id: p.pid,
      corruptions: r.dupOf ? ["duplicate"] : p.corruptions,
      expected_status: status,
      expected_record: { ...p.expected, email: (r.dupOf ? r.raw.email : p.expected.email)!.trim().toLowerCase() },
      world_record: p.world,
      expected_enrichments: [...p.enriched],
      unknowable_fields: [...p.unknowable],
      duplicate_of: r.dupOf ? idOf.get(r.dupOf)! : null,
      company_id: p.known ? p.company.id : null,
    };
    routing[id] = r.dupOf
      ? { lead_id: id, expected_decision: "held", acceptable_owner_ids: [], basis: "Duplicate" }
      : referenceRoute(org, id, status, p.expected, p.known ? p.company.id : null);
  }

  return { seed, leads: rows.map((r) => r.raw), truth: { hygiene, routing } };
}

