"use client";

import { useEffect, useMemo, useState } from "react";
import type { RunResult } from "@/lib/pipeline";
import type { Dataset, HygieneResult, HygieneStatus, LeadField } from "@/lib/types";
import { LEAD_FIELDS } from "@/lib/types";
import { Empty, HYGIENE_ORDER, Json, PassChip, StatusChip, Tile, statusLabel } from "./ui";

const FIELD_LABEL: Record<LeadField, string> = {
  first_name: "first_name", last_name: "last_name", email: "email", company: "company",
  company_domain: "company_domain", title: "title", city: "city", state: "state", country: "country",
  industry: "industry", employee_count: "employee_count",
};

const DESCRIBE: Record<HygieneStatus, string> = {
  CLEAN: "Nothing to fix",
  NORMALIZED: "Same facts, canonical form",
  ENRICHED: "Filled from company record",
  NEEDS_REVIEW: "Missing or conflicting",
  INSUFFICIENT_DATA: "Employer unknown",
  DUPLICATE: "Merged into original",
};

export default function HygieneView({
  dataset, run, focus, setFocus, onRoute,
}: {
  dataset: Dataset; run: RunResult; focus: string | null; setFocus: (id: string) => void; onRoute: (id: string) => void;
}) {
  const [status, setStatus] = useState<HygieneStatus | "ALL" | "DIRTY">("DIRTY");
  const [q, setQ] = useState("");
  const counts = useMemo(() => {
    const c = Object.fromEntries(HYGIENE_ORDER.map((s) => [s, 0])) as Record<HygieneStatus, number>;
    for (const h of run.hygiene) c[h.status]++;
    return c;
  }, [run]);
  const rawById = useMemo(() => new Map(dataset.leads.map((l) => [l.id, l])), [dataset]);

  const rows = run.hygiene.filter((h) => {
    if (status === "DIRTY" ? h.status === "CLEAN" : status !== "ALL" && h.status !== status) return false;
    if (!q) return true;
    const r = rawById.get(h.lead_id)!;
    return `${r.first_name} ${r.last_name} ${r.company} ${r.email} ${h.lead_id}`.toLowerCase().includes(q.toLowerCase());
  });

  useEffect(() => {
    if (focus && !rows.some((r) => r.lead_id === focus)) {
      const h = run.hygiene.find((x) => x.lead_id === focus);
      if (h) setStatus("ALL");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const selected = run.hygiene.find((h) => h.lead_id === focus) ?? rows[0] ?? null;

  return (
    <>
      <p className="intro">
        Hygiene sorts every change into one of three kinds. <b>Normalization</b> rewrites what the record already says.{" "}
        <b>Enrichment</b> fills a field by exact lookup in the company record. <b>Inference</b> is only allowed where the
        hygiene policy explicitly names it. When a value can&rsquo;t be known, the field stays empty and the record is escalated.
      </p>
      <div className="tiles">
        {HYGIENE_ORDER.map((s) => (
          <Tile
            key={s}
            label={<StatusChip status={s} />}
            value={counts[s]}
            detail={DESCRIBE[s]}
            selected={status === s}
            onClick={() => setStatus(status === s ? "DIRTY" : s)}
          />
        ))}
      </div>
      <div className="split">
        <div className="card">
          <div className="filters">
            <select className="btn small" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Filter by status">
              <option value="DIRTY">Everything but clean</option>
              <option value="ALL">All records</option>
              {HYGIENE_ORDER.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
            <input type="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="list">
            {rows.map((h) => {
              const r = rawById.get(h.lead_id)!;
              return (
                <button key={h.lead_id} className={`list-item ${selected?.lead_id === h.lead_id ? "active" : ""}`} onClick={() => setFocus(h.lead_id)}>
                  <span className="t">{r.first_name || "—"} {r.last_name} <span className="faint mono">{h.lead_id}</span></span>
                  <StatusChip status={h.status} />
                  <span className="s">{h.record.company ?? r.company ?? "no company"} · {h.changes.length + h.enrichments.length} changes</span>
                </button>
              );
            })}
            {rows.length === 0 && <Empty>No records match.</Empty>}
          </div>
        </div>
        {selected ? <Detail h={selected} dataset={dataset} onRoute={onRoute} onOpen={setFocus} /> : <div className="card"><Empty>Select a record.</Empty></div>}
      </div>
    </>
  );
}

function Detail({ h, dataset, onRoute, onOpen }: { h: HygieneResult; dataset: Dataset; onRoute: (id: string) => void; onOpen: (id: string) => void }) {
  const raw = dataset.leads.find((l) => l.id === h.lead_id)!;
  const truth = dataset.truth.hygiene[h.lead_id];
  const unresolvedFields = new Set(h.unresolved.map((u) => (u.field === "company_identity" ? "company" : u.field)));
  const output = {
    status: h.status,
    changes: h.changes.map(({ field, from, to, reason }) => ({ field, from, to, reason })),
    enrichments: h.enrichments.map(({ field, value, source }) => ({ field, value, source })),
    unresolved: h.unresolved,
    consent: { status: h.consent.status, emailable: h.consent.emailable },
    requires_review: h.requires_review,
    ...(h.duplicate_of ? { duplicate_of: h.duplicate_of } : {}),
  };

  return (
    <div className="card" key={h.lead_id}>
      <div className="card-h">
        <h2>
          {h.record.first_name ?? raw.first_name} {h.record.last_name ?? raw.last_name}
          <span className="faint" style={{ fontWeight: 400 }}> · {h.record.company ?? "employer unknown"}</span>
        </h2>
        <StatusChip status={h.status} />
        <span className="spacer" />
        {truth && (
          <span className="faint" style={{ fontSize: 12 }}>
            Ground truth: {statusLabel(truth.expected_status)}{" "}
            <PassChip pass={truth.expected_status === h.status} label={truth.expected_status === h.status ? "match" : "mismatch"} />
          </span>
        )}
      </div>
      <div className="card-b">
        {h.status === "DUPLICATE" && (
          <div className="callout" style={{ marginBottom: 12 }}>
            Same email as <button className="linkish" onClick={() => onOpen(h.duplicate_of!)}>{h.duplicate_of}</button>. This
            row is merged into the original and won&rsquo;t be routed a second time.
          </div>
        )}
        <div className="row" style={{ marginBottom: 10 }}>
          <div className="legend">
            <span className="l-norm">Normalized</span>
            <span className="l-enr">Enriched (lookup)</span>
            <span className="l-inf">Inferred (policy-allowed)</span>
            <span className="l-unr">Unresolved</span>
          </div>
        </div>
        <table className="diff">
          <thead>
            <tr><th>Field</th><th>Raw export</th><th>After hygiene</th></tr>
          </thead>
          <tbody>
            {LEAD_FIELDS.map((f) => {
              const ch = h.changes.find((c) => c.field === f);
              const en = h.enrichments.find((e) => e.field === f);
              const un = unresolvedFields.has(f) ? h.unresolved.find((u) => (u.field === "company_identity" ? "company" : u.field) === f) : undefined;
              const cls = un ? "unresolved" : en?.kind === "inference" ? "inferred" : en ? "enriched" : ch ? "changed" : "";
              const v = h.record[f];
              return (
                <tr key={f} className={cls}>
                  <td className="field">{FIELD_LABEL[f]}</td>
                  <td className="raw">{raw[f] === "" ? <span className="empty-val">empty</span> : raw[f]}</td>
                  <td className="clean">
                    {v === null ? <span className="empty-val">unknown</span> : String(v)}
                    {(un || en || ch) && (
                      <span className="why">
                        {un ? `⚠ ${un.reason}` : en ? `${en.kind === "inference" ? "Inferred" : "Enriched"} · ${en.source} · ${en.reason}` : ch!.reason}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="consent-line">
          <span className={`chip ${h.consent.emailable ? "good" : "warn"}`}>
            <span className="ic">{h.consent.emailable ? "✓" : "✕"}</span>
            {h.consent.emailable ? "Can receive email" : "No email"}
          </span>
          <span className="muted">
            Email opt-in: {raw.email_opt_in.trim() ? `“${raw.email_opt_in.trim()}”` : <span className="empty-val">empty</span>} · {h.consent.reason}.
            Consent never affects routing.
          </span>
        </div>

        {h.unresolved.length > 0 && (
          <>
            <div className="section-title">Why a person needs to look</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {h.unresolved.map((u, i) => (
                <li key={i}><span className="mono faint">{u.field}</span> — {u.reason}</li>
              ))}
            </ul>
          </>
        )}

        <div className="row" style={{ marginTop: 16 }}>
          <div className="section-title" style={{ margin: 0 }}>Structured output</div>
          <span className="spacer" />
          {h.status !== "DUPLICATE" && (
            <button className="btn small" onClick={() => onRoute(h.lead_id)}>See routing decision →</button>
          )}
        </div>
        <div style={{ marginTop: 8 }}><Json value={output} /></div>
      </div>
    </div>
  );
}
