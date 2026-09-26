"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { OrgIndex } from "@/lib/org";
import { compareRuns, type AssignmentChange, type ChangeKind, type PolicyVersion, type RunResult } from "@/lib/pipeline";
import { extractPolicyBlock, parseHygienePolicy, parseRoutingPolicy } from "@/lib/policy";
import { PRESET_EDITS, applyEdit, canApply, type PresetEdit } from "@/lib/presets";
import type { Dataset } from "@/lib/types";
import DecisionTrace from "./DecisionTrace";
import { Empty, PassChip, Seg, pct } from "./ui";

type PolicyFile = "routing" | "hygiene";

/** Line diff via LCS — small inputs, so O(n·m) is fine. */
function lineDiff(a: string, b: string): { t: "same" | "add" | "del"; s: string }[] {
  const A = a.split("\n");
  const B = b.split("\n");
  const dp = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { t: "same" | "add" | "del"; s: string }[] = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { out.push({ t: "same", s: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: "del", s: A[i++] });
    else out.push({ t: "add", s: B[j++] });
  }
  while (i < A.length) out.push({ t: "del", s: A[i++] });
  while (j < B.length) out.push({ t: "add", s: B[j++] });
  return out;
}

const KIND_META: Record<ChangeKind, { label: string; tone: string; help: string }> = {
  direct: { label: "Direct", tone: "accent", help: "A different rule decided it" },
  cascade: { label: "Cascade", tone: "neutral", help: "Same rules; capacity shifted because other leads moved" },
  hygiene: { label: "Hygiene", tone: "infer", help: "Hygiene produced a different record" },
};

export default function PolicyLab({
  dataset, org, versions, active, setActive, run, prevRun, prevVersion, onSave, onOpenLead,
}: {
  dataset: Dataset; org: OrgIndex; versions: PolicyVersion[]; active: number; setActive: (v: number) => void;
  run: RunResult | null; prevRun: RunResult | null; prevVersion: PolicyVersion | null;
  onSave: (v: Omit<PolicyVersion, "version">) => number; onOpenLead: (id: string) => void;
}) {
  const current = versions.find((v) => v.version === active)!;
  const [file, setFile] = useState<PolicyFile>("routing");
  const [drafts, setDrafts] = useState({ routing: current.routingMd, hygiene: current.hygieneMd });
  const [label, setLabel] = useState("");
  const [kindFilter, setKindFilter] = useState<ChangeKind | "all">("all");
  const [openChange, setOpenChange] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(true);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // Jump the editor to the executable block — that is the part that matters.
  const scrollToPolicy = () => {
    requestAnimationFrame(() => {
      const ta = editorRef.current;
      if (!ta) return;
      const line = ta.value.slice(0, ta.value.indexOf("```policy")).split("\n").length - 1;
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 19;
      ta.scrollTop = Math.max(0, line * lh - 8);
    });
  };
  useEffect(() => { scrollToPolicy(); }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDrafts({ routing: current.routingMd, hygiene: current.hygieneMd });
    setLabel("");
  }, [current]);

  const base = file === "routing" ? current.routingMd : current.hygieneMd;
  const draft = drafts[file];
  const parsed = file === "routing" ? parseRoutingPolicy(draft) : parseHygienePolicy(draft);
  const otherParsed = file === "routing" ? parseHygienePolicy(drafts.hygiene) : parseRoutingPolicy(drafts.routing);
  const dirty = drafts.routing !== current.routingMd || drafts.hygiene !== current.hygieneMd;
  const blockChanged =
    extractPolicyBlock(drafts.routing) !== extractPolicyBlock(current.routingMd) ||
    extractPolicyBlock(drafts.hygiene) !== extractPolicyBlock(current.hygieneMd);
  const diff = useMemo(() => lineDiff(extractPolicyBlock(base) ?? "", extractPolicyBlock(draft) ?? ""), [base, draft]);
  const hasDiff = diff.some((d) => d.t !== "same");

  const applyPreset = (p: PresetEdit) => {
    setFile(p.file);
    setDrafts((d) => ({ ...d, [p.file]: applyEdit(p, d[p.file]) }));
    setLabel(p.label);
    scrollToPolicy();
  };
  const save = () => {
    onSave({ label: label.trim() || "Edited policy", routingMd: drafts.routing, hygieneMd: drafts.hygiene });
    setShowChanges(true);
    setOpenChange(null);
  };

  const comparison = useMemo(
    () => (run && prevRun ? compareRuns(dataset, prevRun, run) : null),
    [dataset, run, prevRun],
  );
  const changes = comparison?.changes.filter((c) => kindFilter === "all" || c.kind === kindFilter) ?? [];
  const kinds = comparison
    ? (["direct", "cascade", "hygiene"] as ChangeKind[]).map((k) => [k, comparison.changes.filter((c) => c.kind === k).length] as const)
    : [];
  const fixed = comparison?.changes.filter((c) => !c.correct_before && c.correct_after).length ?? 0;
  const broke = comparison?.changes.filter((c) => c.correct_before && !c.correct_after).length ?? 0;

  return (
    <>
      <div className="explainer">
        <div>
          <div className="attn-k">Policy &amp; configuration</div>
          The business rules live in two plain-text <b>policy.md</b> files: who gets which leads, in what order, and what
          hygiene may fix. You can edit them here and save your own versions.
        </div>
        <div>
          <div className="attn-k">Logic</div>
          How those rules are carried out lives in the <b>skill files</b>. They stay fixed, so a policy edit can change{" "}
          <i>what</i> the system decides but never break <i>how</i> it decides.
        </div>
        <div>
          <div className="attn-k">Try it</div>
          Save a new version and the same {dataset.leads.length} leads run again. The results are compared with the previous
          version, and every lead that changes owner shows why.
        </div>
      </div>

      {comparison && prevVersion && run && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-h">
            <h2>
              v{prevVersion.version} {prevVersion.label} <span className="faint">→</span> v{current.version} {current.label}
            </h2>
            <span className="spacer" />
            <span className="faint" style={{ fontSize: 12 }}>same seed · same corpus</span>
          </div>
          <div className="grid-2" style={{ gap: 0 }}>
            <div className="card-b" style={{ borderRight: "1px solid var(--border)" }}>
              <table className="metric-table">
                <thead>
                  <tr><th>Metric</th><th className="num">Previous</th><th className="num">New</th><th className="num">Δ</th></tr>
                </thead>
                <tbody>
                  {comparison.metrics.map((m) => {
                    const d = m.after - m.before;
                    const good = m.better === "up" ? d > 0 : d < 0;
                    const fmt = (x: number) => (m.format === "pct" ? pct(x) : String(x));
                    return (
                      <tr key={m.key}>
                        <td>{m.label}</td>
                        <td className="num muted">{fmt(m.before)}</td>
                        <td className="num" style={{ fontWeight: 650 }}>{fmt(m.after)}</td>
                        <td className="num">
                          {Math.abs(d) < 1e-9 ? (
                            <span className="delta same">—</span>
                          ) : (
                            <span className={`delta ${good ? "good" : "bad"}`}>
                              {d > 0 ? "↑" : "↓"} {m.format === "pct" ? `${(Math.abs(d) * 100).toFixed(1)} pts` : Math.abs(d)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="card-b">
              <button className="tile" style={{ width: "100%", marginBottom: 12 }} onClick={() => setShowChanges(!showChanges)}>
                <div className="k">Changed assignments {showChanges ? "▾" : "▸"}</div>
                <div className="v" style={{ fontSize: 34 }}>{comparison.changes.length}</div>
                <div className="d">
                  {fixed} fixed · {broke} broken · {comparison.changes.length - fixed - broke} still correct (or still wrong), different rep
                </div>
              </button>
              <div className="row">
                {kinds.filter(([, n]) => n > 0).map(([k, n]) => (
                  <span key={k} className={`chip ${KIND_META[k].tone}`} title={KIND_META[k].help}>{KIND_META[k].label} {n}</span>
                ))}
              </div>
              <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
                <b>Direct</b>: a different rule decided the lead. <b>Cascade</b>: same rules and same eligible reps, but capacity
                moved because other leads changed hands. <b>Hygiene</b>: the cleaned record itself changed.
              </div>
            </div>
          </div>
          {showChanges && comparison.changes.length > 0 && (
            <>
              <div className="filters">
                <Seg
                  value={kindFilter}
                  onChange={setKindFilter}
                  options={[{ v: "all", l: "All" }, ...kinds.filter(([, n]) => n).map(([k, n]) => ({ v: k, l: `${KIND_META[k].label} ${n}` }))]}
                />
              </div>
              <div>
                {changes.map((c) => (
                  <ChangeRow key={c.lead_id} c={c} open={openChange === c.lead_id} onToggle={() => setOpenChange(openChange === c.lead_id ? null : c.lead_id)} prevRun={prevRun!} run={run} org={org} onOpenLead={onOpenLead} />
                ))}
              </div>
            </>
          )}
          {comparison.changes.length === 0 && <Empty>No assignments changed. Look at the metrics above: hygiene-only edits can improve data quality without moving any owner.</Empty>}
        </div>
      )}

      <div className="grid-2" style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)" }}>
        <div className="card">
          <div className="card-h">
            <Seg<PolicyFile>
              value={file}
              onChange={setFile}
              options={[
                { v: "routing", l: "policies/lead-routing/policy.md" },
                { v: "hygiene", l: "policies/lead-hygiene/policy.md" },
              ]}
            />
            <span className="spacer" />
            <span className="faint" style={{ fontSize: 12 }}>editing from v{current.version}</span>
          </div>
          <div className="card-b">
            <textarea
              ref={editorRef}
              className="editor"
              spellCheck={false}
              wrap="off"
              value={draft}
              onChange={(e) => setDrafts({ ...drafts, [file]: e.target.value })}
              aria-label={`${file} policy`}
            />
            <div style={{ marginTop: 10 }}>
              {parsed.errors.length || otherParsed.errors.length ? (
                <div className="errors">{[...parsed.errors, ...otherParsed.errors].map((e, i) => <div key={i}>✕ {e}</div>)}</div>
              ) : (
                <div className="ok-note">✓ Policy block parses. {file === "routing" && parsed.policy && "precedence" in parsed.policy ? `Precedence: ${parsed.policy.precedence.join(" → ")}` : ""}</div>
              )}
            </div>
            {hasDiff && (
              <>
                <div className="section-title">Policy block change</div>
                <div className="pdiff">
                  {diff.filter((d, i, a) => d.t !== "same" || a.slice(Math.max(0, i - 2), i + 3).some((x) => x.t !== "same")).map((d, i) => (
                    <div key={i} className={d.t === "add" ? "add" : d.t === "del" ? "del" : ""}>{d.t === "add" ? "+ " : d.t === "del" ? "- " : "  "}{d.s}</div>
                  ))}
                </div>
              </>
            )}
            {dirty && !blockChanged && (
              <div className="callout" style={{ marginTop: 10 }}>Only the prose changed. Saving creates a new version, but behavior will be identical.</div>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <input
                className="btn"
                style={{ flex: 1, minWidth: 160, cursor: "text", textAlign: "left" }}
                placeholder="Name this version (e.g. “Subsidiaries follow parent”)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <button className="btn" disabled={!dirty} onClick={() => setDrafts({ routing: current.routingMd, hygiene: current.hygieneMd })}>Revert</button>
              <button className="btn primary" disabled={!dirty || !!parsed.errors.length || !!otherParsed.errors.length} onClick={save}>
                Save policy &amp; rerun
              </button>
            </div>
          </div>
        </div>
        <div>
          <div className="card">
            <div className="card-h"><h3>Suggested edits</h3><span className="faint">each is one small text change</span></div>
            <div className="card-b">
              <div className="callout" style={{ marginBottom: 10, fontSize: 12.5 }}>
                These suggestions are hard-coded for the demo. In a real deployment, an LLM could read the eval failures and
                Address Exceptions queue and propose policy improvements here, and the evals would check each one before anyone adopts it.
              </div>
              {PRESET_EDITS.map((p) => {
                const ok = canApply(p, drafts[p.file]);
                return (
                  <button key={p.id} className="preset" onClick={() => applyPreset(p)} disabled={!ok} style={ok ? undefined : { opacity: 0.5 }}>
                    <div className="pt">
                      {p.label}
                      <span className={`chip ${p.tone === "improve" ? "good" : "warn"}`}>{p.tone === "improve" ? "↑ expected to help" : "⚠ tempting"}</span>
                    </div>
                    <div className="pd">{p.intent}</div>
                    <div className="pd faint mono">{p.file === "routing" ? "lead-routing" : "lead-hygiene"}{ok ? "" : " · already applied or not applicable"}</div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-h"><h3>Versions</h3></div>
            <div>
              {versions.map((v) => (
                <button key={v.version} className={`list-item ${v.version === active ? "active" : ""}`} onClick={() => setActive(v.version)}>
                  <span className="t">v{v.version} — {v.label}</span>
                  {v.version === active ? <span className="chip accent">active</span> : <span />}
                </button>
              ))}
            </div>
            <div className="card-b faint" style={{ fontSize: 12 }}>
              Versions exist only in this session. The files on disk stay at v1, so Reset always goes back to the same starting point.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function ChangeRow({
  c, open, onToggle, prevRun, run, org, onOpenLead,
}: {
  c: AssignmentChange; open: boolean; onToggle: () => void; prevRun: RunResult; run: RunResult; org: OrgIndex; onOpenLead: (id: string) => void;
}) {
  const hBefore = prevRun.hygiene.find((h) => h.lead_id === c.lead_id)!;
  const hAfter = run.hygiene.find((h) => h.lead_id === c.lead_id)!;
  const meta = KIND_META[c.kind];
  const who = (r: typeof c.before) => (r.decision === "auto_route" ? r.owner : r.decision === "held" ? "Held" : "Review queue");
  return (
    <div style={{ borderTop: "1px solid var(--border)" }}>
      <button className="list-item" style={{ gridTemplateColumns: "70px 90px minmax(0, 1fr) auto", alignItems: "center", borderBottom: 0 }} onClick={onToggle}>
        <span className="mono faint">{c.lead_id}</span>
        <span className={`chip ${meta.tone}`}>{meta.label}</span>
        <span>
          <span className="t" style={{ display: "block" }}>
            {hAfter.record.company ?? "Unknown"}: <span className="muted">{who(c.before)}</span> → <b>{who(c.after)}</b>
          </span>
          <span className="s" style={{ display: "block", whiteSpace: "normal" }}>{c.explanation.split(". ").slice(1).join(". ")}</span>
        </span>
        <span className="row" style={{ gap: 4 }}>
          <PassChip pass={c.correct_before} label="was" />
          <PassChip pass={c.correct_after} label="now" />
        </span>
      </button>
      {open && (
        <div className="card-b" style={{ background: "var(--surface-2)" }}>
          <div className="grid-2">
            <div className="card"><div className="card-b"><div className="section-title" style={{ marginTop: 0 }}>Previous policy</div><DecisionTrace r={c.before} h={hBefore} org={org} compact /></div></div>
            <div className="card"><div className="card-b"><div className="section-title" style={{ marginTop: 0 }}>New policy</div><DecisionTrace r={c.after} h={hAfter} org={org} compact /></div></div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <span className="spacer" />
            <button className="btn small" onClick={() => onOpenLead(c.lead_id)}>Open in Routing →</button>
          </div>
        </div>
      )}
    </div>
  );
}
