"use client";

import { useMemo, useState } from "react";
import type { RunResult } from "@/lib/pipeline";
import { headerMappings } from "@/lib/headers";
import type { Dataset, HygieneResult, RawLead } from "@/lib/types";
import { Seg, StatusChip, Tile } from "./ui";

const COLS: { f: keyof RawLead; l: string; w?: number }[] = [
  { f: "id", l: "ID", w: 70 },
  { f: "first_name", l: "First" },
  { f: "last_name", l: "Last" },
  { f: "email", l: "Email" },
  { f: "company", l: "Company" },
  { f: "company_domain", l: "Domain" },
  { f: "title", l: "Title" },
  { f: "city", l: "City" },
  { f: "state", l: "State" },
  { f: "country", l: "Country" },
  { f: "industry", l: "Industry" },
  { f: "employee_count", l: "Employees" },
  { f: "email_opt_in", l: "Opt-in" },
  { f: "session", l: "Session" },
];

type Filter = "all" | "dirty" | "clean" | "dupes";
type Issue = "personal" | "missing" | "titles" | "geo";
type Mark = (l: RawLead, h: HygieneResult, f: keyof RawLead) => boolean;

const FIRMOGRAPHICS: (keyof RawLead)[] = ["company", "employee_count", "industry", "country"];
const changedField = (h: HygieneResult, f: string) => h.changes.some((c) => c.field === f);

/** Each summary tile is a filter: which rows it matches, and which cells to highlight in them. */
const ISSUES: Record<Issue, { label: string; detail: string; match: (l: RawLead, h: HygieneResult) => boolean; mark: Mark }> = {
  personal: {
    label: "Personal emails", detail: "Gmail, Outlook, Yahoo",
    match: (_l, h) => h.personal_email && h.status !== "DUPLICATE",
    mark: (_l, _h, f) => f === "email",
  },
  missing: {
    label: "Missing firmographics", detail: "company, size, industry or country",
    match: (l) => FIRMOGRAPHICS.some((f) => !l[f].trim()),
    mark: (l, _h, f) => FIRMOGRAPHICS.includes(f) && !l[f].trim(),
  },
  titles: {
    label: "Abbreviated titles", detail: "“VP Mktg”, “Sr Data Eng”",
    match: (_l, h) => changedField(h, "title"),
    mark: (_l, _h, f) => f === "title",
  },
  geo: {
    label: "State / country variants", detail: "“WA”, “USA”, “UK”",
    match: (_l, h) => changedField(h, "state") || changedField(h, "country"),
    mark: (_l, h, f) => (f === "state" || f === "country") && changedField(h, f),
  },
};

export default function LeadsView({
  dataset, run, onOpen, onShowcase, highlightShowcase,
}: {
  dataset: Dataset; run: RunResult; onOpen: (id: string) => void; onShowcase: () => void; highlightShowcase: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [issue, setIssue] = useState<Issue | null>(null);
  const [q, setQ] = useState("");
  const hById = useMemo(() => new Map(run.hygiene.map((h) => [h.lead_id, h])), [run]);

  const touched = (id: string) => {
    const h = hById.get(id)!;
    return new Set<string>([
      ...h.changes.map((c) => c.field),
      ...h.enrichments.map((e) => e.field),
      ...h.unresolved.map((u) => (u.field === "company_identity" ? "company" : u.field)),
    ]);
  };

  const mappings = useMemo(() => headerMappings(), []);
  const mapped = mappings.filter((m) => m.field).length;
  const fieldFor = (f: keyof RawLead) => mappings.find((m) => m.field === f);

  const counts = useMemo(() => {
    const c = Object.fromEntries(
      (Object.keys(ISSUES) as Issue[]).map((k) => [k, dataset.leads.filter((l) => ISSUES[k].match(l, hById.get(l.id)!)).length]),
    ) as Record<Issue, number>;
    return { ...c, dupes: run.hygiene.filter((h) => h.status === "DUPLICATE").length };
  }, [run, dataset, hById]);
  const pickIssue = (k: Issue) => {
    setIssue(issue === k ? null : k);
    setFilter("all");
  };
  const pickFilter = (f: Filter) => {
    setFilter(f);
    setIssue(null);
  };

  const rows = dataset.leads.filter((l) => {
    const h = hById.get(l.id)!;
    if (issue && !ISSUES[issue].match(l, h)) return false;
    if (filter === "dirty" && (h.status === "CLEAN" || h.status === "DUPLICATE")) return false;
    if (filter === "clean" && h.status !== "CLEAN") return false;
    if (filter === "dupes" && h.status !== "DUPLICATE") return false;
    if (q) {
      const s = q.toLowerCase();
      return Object.values(l).some((v) => v.toLowerCase().includes(s));
    }
    return true;
  });

  // Pin the showcase lead at the top so the story has an obvious starting point.
  // Only during the guided demo; people exploring on their own get the plain list.
  const showcase = highlightShowcase ? dataset.leads.find((l) => l.id === dataset.showcase_id) : undefined;
  const pinned = showcase && rows.some((r) => r.id === showcase.id) ? [showcase, ...rows.filter((r) => r.id !== showcase.id)] : rows;

  return (
    <>
      <p className="intro">
        The lead list as loaded: <b>{dataset.leads.length} rows, exactly as received</b>. First, the file&rsquo;s column headers
        are normalized, so &ldquo;Email Address&rdquo; or &ldquo;# of Employees&rdquo; map onto standard lead fields; every source names
        them differently. The values themselves haven&rsquo;t been touched yet. Highlighted cells are the ones hygiene will
        have to deal with. Click a row to see what it does.
      </p>
      <div className="tiles">
        <Tile label="Headers normalized" value={`${mapped}/${mappings.length}`} detail="source columns → lead fields" tone="accent" />
        {(Object.keys(ISSUES) as Issue[]).map((k) => (
          <Tile key={k} label={ISSUES[k].label} value={counts[k]} detail={ISSUES[k].detail} selected={issue === k} onClick={() => pickIssue(k)} />
        ))}
        <Tile label="Duplicate rows" value={counts.dupes} detail="same person, loaded twice" selected={filter === "dupes"} onClick={() => pickFilter(filter === "dupes" ? "all" : "dupes")} />
      </div>
      {showcase && (
        <div className="showcase-card">
          <div>
            <div className="attn-k">Start here · {showcase.id}</div>
            <b>{showcase.first_name} {showcase.last_name}</b> signed up with <b>{showcase.email}</b>, no company website,{" "}
            <b>&ldquo;{showcase.title}&rdquo;</b>, <b>&ldquo;{showcase.state}&rdquo;</b>, no employee count, and says their company is in{" "}
            <b>{showcase.industry}</b>. It&rsquo;s pinned at the top of the table.
          </div>
          <button className="btn small" onClick={onShowcase}>See what hygiene does →</button>
        </div>
      )}
      <div className="card">
        <div className="filters">
          <Seg<Filter>
            value={issue ? ("" as Filter) : filter}
            onChange={pickFilter}
            options={[
              { v: "all", l: `All ${dataset.leads.length}` },
              { v: "dirty", l: "Needs work" },
              { v: "clean", l: "Clean" },
              { v: "dupes", l: "Duplicates" },
            ]}
          />
          <input type="search" placeholder="Search name, company, email…" value={q} onChange={(e) => setQ(e.target.value)} />
          {issue && (
            <button className="chip accent" style={{ cursor: "pointer" }} onClick={() => setIssue(null)} title="Clear filter">
              {ISSUES[issue].label} ✕
            </button>
          )}
          <span className="faint">{rows.length} rows</span>
        </div>
        <div className="table-wrap">
          <table className="compact nowrap">
            <thead>
              <tr>
                {COLS.map((c) => {
                  const m = c.f === "id" ? null : fieldFor(c.f);
                  return (
                    <th key={c.f} title={m ? `Source column "${m.source}" → ${m.field}` : undefined}>
                      {m ? m.source : c.l}
                      {m && <span className="hdr-map">→ {m.field}</span>}
                    </th>
                  );
                })}
                <th>Hygiene</th>
              </tr>
            </thead>
            <tbody>
              {pinned.map((l) => {
                const t = touched(l.id);
                return (
                  <tr key={l.id} className={`clickable ${showcase && l.id === showcase.id ? "showcase" : ""}`} onClick={() => onOpen(l.id)}>
                    {COLS.map((c) => (
                      <td key={c.f} className={(issue ? ISSUES[issue].mark(l, hById.get(l.id)!, c.f) : filter === "dupes" ? c.f === "email" : t.has(c.f)) ? "dirty" : c.f === "id" ? "mono faint" : ""}>
                        {l[c.f] === "" ? <span className="empty-val">empty</span> : l[c.f]}
                        {c.f === "id" && showcase && l.id === showcase.id && <span className="pin">start here</span>}
                      </td>
                    ))}
                    <td><StatusChip status={hById.get(l.id)!.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
