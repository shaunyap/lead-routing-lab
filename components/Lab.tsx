"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_SEED, generateDataset } from "@/lib/generate";
import { indexOrg } from "@/lib/org";
import { applyOverrides, type Overrides } from "@/lib/overrides";
import { runPipeline, type PolicyVersion, type RunOutcome } from "@/lib/pipeline";
import type { OrgData } from "@/lib/types";
import AttentionView from "./AttentionView";
import EvalsView from "./EvalsView";
import HygieneView from "./HygieneView";
import LeadsView from "./LeadsView";
import PolicyLab from "./PolicyLab";
import RoutingView from "./RoutingView";
import SalesforceDrawer from "./SalesforceDrawer";
import SalesforceView from "./SalesforceView";
import { pct } from "./ui";

export type Tab = "leads" | "hygiene" | "routing" | "attention" | "salesforce" | "evals" | "policy";
const FLOW: { id: Tab; label: string }[] = [
  { id: "leads", label: "Leads" },
  { id: "hygiene", label: "Hygiene" },
  { id: "routing", label: "Routing" },
  { id: "attention", label: "Address Exceptions" },
  { id: "salesforce", label: "Export to Salesforce" },
];
const TOOLS: { id: Tab; label: string }[] = [
  { id: "evals", label: "Evals" },
  { id: "policy", label: "Policy Lab" },
];

function useCountUp(target: number, key: string, ms = 700) {
  const [v, setV] = useState(target);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      setV(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, key, ms]);
  return v;
}

function Stage({ n, label, tone, onClick, isPct, animKey, last }: {
  n: number; label: string; tone?: string; onClick: () => void; isPct?: boolean; animKey: string; last?: boolean;
}) {
  const v = useCountUp(n, animKey);
  return (
    <button className={`stage ${tone ? `tone-${tone}` : ""}`} onClick={onClick} title={`Go to ${label}`}>
      <div className="n">{isPct ? pct(v) : Math.round(v)}</div>
      <div className="l">{label}</div>
      {!last && <span className="arrow">▸</span>}
    </button>
  );
}

export default function Lab(props: { org: OrgData; hygieneMd: string; routingMd: string }) {
  const org = useMemo(() => indexOrg(props.org), [props.org]);
  const v1: PolicyVersion = useMemo(
    () => ({ version: 1, label: "Shipped policy", hygieneMd: props.hygieneMd, routingMd: props.routingMd }),
    [props.hygieneMd, props.routingMd],
  );
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [seedInput, setSeedInput] = useState(String(DEFAULT_SEED));
  const [generated, setGenerated] = useState(false);
  const [genCount, setGenCount] = useState(0);
  const [versions, setVersions] = useState<PolicyVersion[]>([v1]);
  const [active, setActive] = useState(1);
  const [tab, setTab] = useState<Tab>("leads");
  const [focus, setFocus] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Overrides>({});
  const assign = (leadId: string, repId: string | null) =>
    setOverrides((o) => {
      const next = { ...o };
      if (repId) next[leadId] = repId;
      else delete next[leadId];
      return next;
    });

  const dataset = useMemo(() => generateDataset(seed, org), [seed, org]);
  const outcomes = useMemo(() => {
    const m = new Map<number, RunOutcome>();
    for (const v of versions) m.set(v.version, runPipeline(dataset, org, v));
    return m;
  }, [dataset, org, versions]);

  const activeOutcome = outcomes.get(active)!;
  const run = activeOutcome.ok ? activeOutcome.run : null;
  // What a person sees and exports: engine output plus any manual assignments.
  const effRun = useMemo(
    () => (run ? { ...run, routing: applyOverrides(run.routing, overrides, org) } : null),
    [run, overrides, org],
  );
  const prevVersion = versions.filter((v) => v.version < active).at(-1) ?? null;
  const prevOutcome = prevVersion ? outcomes.get(prevVersion.version)! : null;
  const prevRun = prevOutcome?.ok ? prevOutcome.run : null;

  const generate = () => {
    const s = Number(seedInput) || DEFAULT_SEED;
    setSeed(s);
    setGenerated(true);
    setGenCount((c) => c + 1);
    setFocus(null);
    setOverrides({});
    setTab("leads");
  };
  const reset = () => {
    setSeed(DEFAULT_SEED);
    setSeedInput(String(DEFAULT_SEED));
    setVersions([v1]);
    setActive(1);
    setGenerated(false);
    setFocus(null);
    setDrawer(null);
    setOverrides({});
    setTab("leads");
  };
  const go = (t: Tab, lead?: string) => {
    if (lead) setFocus(lead);
    setTab(t);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const savePolicy = (next: Omit<PolicyVersion, "version">) => {
    const version = Math.max(...versions.map((v) => v.version)) + 1;
    setVersions([...versions, { ...next, version }]);
    setActive(version);
    return version;
  };

  const animKey = `${genCount}-${seed}-${active}`;
  const f = run?.funnel;
  const resolvedByHand = run ? run.routing.filter((r) => r.decision !== "auto_route" && overrides[r.lead_id] && !run.hygiene.some((h) => h.lead_id === r.lead_id && h.status === "DUPLICATE")).length : 0;
  const attentionCount = f ? f.review + f.exceptions - resolvedByHand : 0;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">⇢</div>
          <div>
            <h1>Lead Routing Lab</h1>
            <div className="sub">Prepared for LangChain by Shaun Yap (shaunyap@gmail.com)</div>
          </div>
        </div>
        <div className="top-actions">
          {generated && (
            <label className="seed">
              Policy
              <select
                className="btn small"
                value={active}
                onChange={(e) => setActive(Number(e.target.value))}
                aria-label="Active policy version"
              >
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    v{v.version} — {v.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {generated && (
            <>
              <label className="seed">
                Seed
                <input value={seedInput} onChange={(e) => setSeedInput(e.target.value.replace(/\D/g, ""))} aria-label="Dataset seed" />
              </label>
              <button className="btn primary" onClick={generate}>Regenerate</button>
              <button className="btn" onClick={reset}>Reset demo</button>
            </>
          )}
        </div>
      </header>

      {!generated || !f ? (
        <div className="hero">
          <div className="eyebrow">Lead list load</div>
          <h2>Messy lead data in, safe CRM actions out</h2>
          <p>
            About 250 leads, loaded the way lists always arrive: mismatched column headers, Gmail addresses, &ldquo;VP Mktg&rdquo;, &ldquo;WA&rdquo;,
            duplicates and missing firmographics. Watch the leads get cleaned, routed with written-out reasons,
            checked against ground truth and turned into Salesforce updates, all driven by two policy files you can edit.
          </p>
          <div className="hero-seed">
            <label htmlFor="hero-seed">Seed</label>
            <input
              id="hero-seed"
              value={seedInput}
              onChange={(e) => setSeedInput(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && generate()}
            />
            <span className="faint">Same seed, same dataset. Change it for a different set of leads.</span>
          </div>
          <button className="btn primary big" onClick={generate}>Load leads</button>
          <div className="flow-label">From list to CRM</div>
          <div className="flow">
            <span>Leads</span><i>→</i><span>Hygiene</span><i>→</i><span>Routing</span><i>→</i>
            <span>Address Exceptions</span><i>→</i><span>Export to Salesforce</span>
          </div>
          {!activeOutcome.ok && <div className="errors" style={{ marginTop: 20 }}>{activeOutcome.errors.join(" · ")}</div>}
        </div>
      ) : (
        <>
          <nav className="stagebar" aria-label="Pipeline summary">
            <Stage animKey={animKey} n={f.imported} label="Imported" onClick={() => go("leads")} />
            <Stage animKey={animKey} n={f.duplicates} label="Duplicates" onClick={() => go("hygiene")} />
            <Stage animKey={animKey} n={f.dirty} label="Dirty" tone="warn" onClick={() => go("hygiene")} />
            <Stage animKey={animKey} n={f.repaired} label="Repaired" tone="accent" onClick={() => go("hygiene")} />
            <Stage animKey={animKey} n={f.review} label="Hygiene review" tone="warn" onClick={() => go("attention")} />
            <Stage animKey={animKey} n={f.routable} label="Routable" onClick={() => go("routing")} />
            <Stage animKey={animKey} n={f.auto_routed} label="Auto-routed" tone="good" onClick={() => go("routing")} />
            <Stage animKey={animKey} n={f.exceptions} label="Exceptions" tone="warn" onClick={() => go("attention")} />
            <Stage animKey={animKey} n={f.eval_accuracy} isPct label="Routing eval" tone="accent" onClick={() => go("evals")} last />
          </nav>

          <nav className="tabs">
            {FLOW.map((t, i) => (
              <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => go(t.id)}>
                <span className="step">{i + 1}</span>
                {t.label}
                {t.id === "attention" && attentionCount > 0 && <span className="count">{attentionCount}</span>}
              </button>
            ))}
            <span className="tabs-gap" />
            {TOOLS.map((t) => (
              <button key={t.id} className={`tab tool ${tab === t.id ? "active" : ""}`} onClick={() => go(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>

          {run && tab === "leads" && <LeadsView dataset={dataset} run={run} onOpen={(id) => go("hygiene", id)} />}
          {run && tab === "hygiene" && <HygieneView dataset={dataset} run={run} focus={focus} setFocus={setFocus} onRoute={(id) => go("routing", id)} />}
          {effRun && tab === "routing" && (
            <RoutingView dataset={dataset} run={effRun} org={org} overrides={overrides} onAssign={assign} focus={focus} setFocus={setFocus} onSalesforce={setDrawer} onHygiene={(id) => go("hygiene", id)} />
          )}
          {run && tab === "evals" && <EvalsView dataset={dataset} run={run} org={org} onOpen={go} />}
          {tab === "policy" && (
            <PolicyLab
              dataset={dataset}
              org={org}
              versions={versions}
              active={active}
              setActive={setActive}
              run={run}
              prevRun={prevRun}
              prevVersion={prevVersion}
              onSave={savePolicy}
              onOpenLead={(id) => go("routing", id)}
            />
          )}
          {run && tab === "attention" && <AttentionView dataset={dataset} run={run} org={org} onOpen={go} overrides={overrides} onAssign={assign} />}
          {effRun && tab === "salesforce" && <SalesforceView run={effRun} org={org} onOpen={setDrawer} onNav={go} />}
          {!run && tab !== "policy" && (
            <div className="errors">This policy version does not parse: {activeOutcome.ok ? "" : activeOutcome.errors.join(" · ")}</div>
          )}
        </>
      )}

      {drawer && effRun && (
        <SalesforceDrawer leadId={drawer} run={effRun} org={org} dataset={dataset} onClose={() => setDrawer(null)} />
      )}
    </div>
  );
}
