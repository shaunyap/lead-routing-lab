"use client";

import { useState } from "react";
import { rate, type Ratio } from "@/lib/evals";
import type { OrgIndex } from "@/lib/org";
import type { RunResult } from "@/lib/pipeline";
import type { Dataset } from "@/lib/types";
import type { Tab } from "./Lab";
import { LoadBar, PassChip, Seg, Tile, pct } from "./ui";

const VIOLATION_LABEL: Record<string, string> = {
  owner_override: "Existing owner overridden",
  account_family_split: "Account family split across owners",
  industry_exclusion: "Rep received an excluded industry",
  strategic_only: "Strategic-only rep got a non-named account",
  territory: "Rep outside their territory",
  capacity: "Rep over capacity",
  routed_without_clean_data: "Routed a record hygiene should have held",
};

const r = (x: Ratio) => `${x.correct}/${x.total}`;

function MetricRow({ name, value, detail, def }: { name: string; value: string; detail?: string; def: string }) {
  return (
    <tr>
      <td>
        <div style={{ fontWeight: 550 }}>{name}</div>
        <div className="faint" style={{ fontSize: 12 }}>{def}</div>
      </td>
      <td className="num" style={{ fontSize: 16, fontWeight: 650 }}>{value}</td>
      <td className="num faint mono">{detail}</td>
    </tr>
  );
}

export default function EvalsView({ dataset, run, org, onOpen }: { dataset: Dataset; run: RunResult; org: OrgIndex; onOpen: (t: Tab, id?: string) => void }) {
  const he = run.hygieneEval;
  const re = run.routingEval;
  const [issues, setIssues] = useState<"violations" | "routing" | "hygiene">("violations");
  const hardPass = run.cases.filter((c) => c.hygiene_pass && c.routing_pass).length;
  const prf = (x: { tp: number; fp: number; fn: number }) => ({
    recall: x.tp + x.fn === 0 ? 1 : x.tp / (x.tp + x.fn),
    precision: x.tp + x.fp === 0 ? 1 : x.tp / (x.tp + x.fp),
  });
  const rev = prf(he.review);
  const esc = prf(re.escalation);
  const lucky = he.unsupported.filter((u) => u.lucky).length;
  const extraFieldMisses = he.field_misses.filter((f) => !he.status_misses.some((m) => m.lead_id === f.lead_id));
  const hygieneIssues = he.status_misses.length + he.unsupported.length + extraFieldMisses.length;
  const maxLoad = Math.max(...re.workload.map((w) => Math.max(w.open + w.assigned, w.capacity))) * 1.04;

  return (
    <>
      <p className="intro">
        Evals are part of the product, not a test folder. Every run is scored against <b>hidden ground truth</b> produced by the
        generator, and hygiene and routing are scored separately. Hygiene is judged against what a careful system <i>could</i>{" "}
        know, not against the real answer: filling in a correct value that the evidence didn&rsquo;t support still counts as a failure.
      </p>
      <div className="tiles">
        <Tile label="Routing accuracy" value={pct(rate(re.accuracy))} detail={`${r(re.accuracy)} routable leads`} tone="accent" />
        <Tile label="Policy violations" value={re.violations.length} detail="hard rules broken" tone={re.violations.length ? "critical" : "good"} />
        <Tile label="Escalation recall" value={pct(esc.recall, 0)} detail={`precision ${pct(esc.precision, 0)}`} />
        <Tile label="Hygiene field accuracy" value={pct(rate(he.fields))} detail={`${r(he.fields)} fields`} />
        <Tile label="Unsupported inferences" value={he.unsupported.length} detail={lucky ? `${lucky} happened to be right` : "values the evidence didn’t support"} tone={he.unsupported.length ? "critical" : "good"} />
        <Tile label="Hard cases" value={`${hardPass}/${run.cases.length}`} detail="hand-written, held out" tone={hardPass === run.cases.length ? "good" : undefined} />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-h"><h3>Hygiene</h3><span className="faint">stage 1 · {he.records} records</span></div>
          <table>
            <tbody>
              <MetricRow name="Outcome accuracy" value={pct(rate(he.status))} detail={r(he.status)} def="Status matches the expected NORMALIZED / ENRICHED / NEEDS_REVIEW / …" />
              <MetricRow name="Field normalization" value={pct(rate(he.corrected_fields))} detail={r(he.corrected_fields)} def="Fields the export got wrong that now match recoverable truth" />
              <MetricRow name="Enrichment accuracy" value={pct(rate(he.enrichment))} detail={r(he.enrichment)} def="Lookups that filled the right value" />
              <MetricRow name="Unresolved handling" value={pct(rev.recall, 0)} detail={`${he.review.tp} caught · ${he.review.fn} missed · ${he.review.fp} extra`} def="Records that can’t be completed are escalated, not guessed" />
              <MetricRow name="Duplicate detection" value={`${he.duplicates.tp}/${he.duplicates.tp + he.duplicates.fn}`} detail={`${he.duplicates.fp} false`} def="Repeat scans merged into the original" />
              <MetricRow name="Unsupported inference rate" value={pct(he.unsupported.length / Math.max(1, he.filled_fields + he.unsupported.length))} detail={`${he.unsupported.length} of ${he.filled_fields} fills`} def="Asserted values the evidence didn’t support. Target: 0" />
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="card-h"><h3>Routing</h3><span className="faint">stage 2 · {re.evaluated} leads</span></div>
          <table>
            <tbody>
              <MetricRow name="Correct owner / decision" value={pct(rate(re.accuracy))} detail={r(re.accuracy)} def="Owner is in the acceptable set, or review when review was expected" />
              <MetricRow name="End-to-end" value={pct(rate(re.end_to_end))} detail={r(re.end_to_end)} def="All unique leads, including ones hygiene should hold" />
              <MetricRow name="Policy violations" value={String(re.violations.length)} detail="org facts" def="Checked against org facts, independent of the routing policy" />
              <MetricRow name="Escalation behavior" value={pct(esc.recall, 0)} detail={`${re.escalation.tp} right · ${re.escalation.fn} missed · ${re.escalation.fp} extra`} def="Leads that need a person actually go to review" />
              <MetricRow name="Ambiguous routes" value={String(re.ambiguous)} detail="tie-broken" def="More than one rep was equally qualified; capacity or hash decided" />
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-h">
            <h3>Where it went wrong</h3>
            <span className="spacer" />
            <Seg
              value={issues}
              onChange={setIssues}
              options={[
                { v: "violations", l: `Violations ${re.violations.length}` },
                { v: "routing", l: `Routing ${re.misses.length}` },
                { v: "hygiene", l: `Hygiene ${hygieneIssues}` },
              ]}
            />
          </div>
          <div style={{ maxHeight: 380, overflowY: "auto" }}>
            <table className="compact">
              <tbody>
                {issues === "violations" &&
                  re.violations.map((v, i) => (
                    <tr key={i} className="clickable" onClick={() => onOpen("routing", v.lead_id)}>
                      <td className="mono faint">{v.lead_id}</td>
                      <td><span className="chip critical">{VIOLATION_LABEL[v.kind]}</span><div className="muted" style={{ marginTop: 3 }}>{v.detail}</div></td>
                    </tr>
                  ))}
                {issues === "routing" &&
                  re.misses.map((m) => (
                    <tr key={m.lead_id} className="clickable" onClick={() => onOpen("routing", m.lead_id)}>
                      <td className="mono faint">{m.lead_id}</td>
                      <td>Got <b>{m.actual}</b>, expected <b>{m.expected}</b><div className="faint">{m.basis}</div></td>
                    </tr>
                  ))}
                {issues === "hygiene" && (
                  <>
                    {he.unsupported.map((u, i) => (
                      <tr key={`u${i}`} className="clickable" onClick={() => onOpen("hygiene", u.lead_id)}>
                        <td className="mono faint">{u.lead_id}</td>
                        <td><span className="chip infer">Unsupported inference</span> <span className="mono">{u.field}</span> = “{u.value}”{u.lucky ? " (happened to be right)" : ` (actually “${u.world_value}”)`}</td>
                      </tr>
                    ))}
                    {he.status_misses.map((m) => {
                      const fm = he.field_misses.filter((f) => f.lead_id === m.lead_id);
                      return (
                        <tr key={m.lead_id} className="clickable" onClick={() => onOpen("hygiene", m.lead_id)}>
                          <td className="mono faint">{m.lead_id}</td>
                          <td>Status <b>{m.actual}</b>, expected <b>{m.expected}</b>{fm.map((f) => <div key={f.field} className="faint">{f.field}: “{f.actual}” → should be “{f.expected}”</div>)}</td>
                        </tr>
                      );
                    })}
                    {extraFieldMisses.map((f, i) => (
                      <tr key={`f${i}`} className="clickable" onClick={() => onOpen("hygiene", f.lead_id)}>
                        <td className="mono faint">{f.lead_id}</td>
                        <td><span className="mono">{f.field}</span>: “{f.actual}” → should be “{f.expected}”</td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
            {((issues === "violations" && !re.violations.length) || (issues === "routing" && !re.misses.length) || (issues === "hygiene" && !he.status_misses.length && !he.unsupported.length && !he.field_misses.length)) && (
              <div className="card-b faint">Nothing here.</div>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h3>Workload distribution</h3><span className="faint">open load vs. capacity</span></div>
          <div className="card-b">
            <div className="bars" role="table" aria-label="Leads assigned per rep">
              {re.workload.map((w) => (
                <div key={w.rep_id} className="bar-row" role="row" title={`${w.name}: ${w.open} open + ${w.assigned} new, capacity ${w.capacity}`}>
                  <span role="cell">{w.name}</span>
                  <div role="cell"><LoadBar open={w.open} added={w.assigned} capacity={w.capacity} max={maxLoad} /></div>
                  <span className="val" role="cell">{w.open + w.assigned}/{w.capacity}</span>
                </div>
              ))}
            </div>
            <div className="faint" style={{ fontSize: 12, marginTop: 10 }}>
              Grey = already open · blue = routed from this load · tick = capacity. Existing-owner assignments bypass capacity, so a bar can pass its tick.
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-h">
          <h3>Hard cases</h3>
          <span className="faint">{run.cases.length} hand-written cases that were never used for tuning. Written from business rules, not by running the engine.</span>
          <span className="spacer" />
          <PassChip pass={hardPass === run.cases.length} label={`${hardPass}/${run.cases.length} passing`} />
        </div>
        <div className="table-wrap" style={{ maxHeight: 520 }}>
          <table className="compact">
            <thead><tr><th>Case</th><th>Why it&rsquo;s hard</th><th>Hygiene</th><th>Routing</th></tr></thead>
            <tbody>
              {run.cases.map((c) => (
                <tr key={c.case.id}>
                  <td style={{ width: "26%" }}><b>{c.case.title}</b><div className="faint mono">{c.case.id}</div></td>
                  <td>
                    <span className="muted">{c.case.why_hard}</span>
                    {c.problems.map((p, i) => <div key={i} style={{ color: "var(--critical-ink)", marginTop: 3 }}>✕ {p}</div>)}
                  </td>
                  <td><PassChip pass={c.hygiene_pass} /></td>
                  <td><PassChip pass={c.routing_pass} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="faint" style={{ fontSize: 12, marginTop: 10 }}>Seed {dataset.seed} · {org.data.reps.length} reps · {org.data.companies.length} companies in the reference database</div>
    </>
  );
}
