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
import { ArchStrip, DemoBoundaries, GuideCard, THESIS, type GuideStep } from "./Story";
import { parseRoutingPolicy } from "@/lib/policy";
import { PRESET_EDITS, applyEdit } from "@/lib/presets";

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
  const [guide, setGuide] = useState<number | null>(null);
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
    setGuide(null);
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

  // A lead that shows the demo's point: a confident, explained pick that ground truth marks wrong.
  const exampleLead = useMemo(() => {
    if (!run) return null;
    const v1Run = outcomes.get(1);
    const base = v1Run?.ok ? v1Run.run : run;
    const hit = base.routing.find((r) => {
      const g = dataset.truth.routing[r.lead_id];
      return g?.basis.startsWith("Subsidiary") && r.decision === "auto_route" && !g.acceptable_owner_ids.includes(r.owner_id!);
    });
    return hit?.lead_id ?? null;
  }, [run, outcomes, dataset]);

  // ---- Pre-baked policy change: subsidiaries follow the parent account.
  const rollupPreset = PRESET_EDITS.find((p) => p.id === "parent-rollup")!;
  const rollupVersion = versions.find((v) => parseRoutingPolicy(v.routingMd).policy?.precedence.includes("parent_account_owner"));
  const tryPolicyChange = () => {
    if (rollupVersion) setActive(rollupVersion.version);
    else savePolicy({ label: rollupPreset.label, routingMd: applyEdit(rollupPreset, v1.routingMd), hygieneMd: v1.hygieneMd });
    go("policy");
  };

  // ---- Guided demo: five steps, each of which drives the app to the right place.
  const v1Out = outcomes.get(1);
  const v1Run = v1Out?.ok ? v1Out.run : null;
  const rollOut = rollupVersion ? outcomes.get(rollupVersion.version) : undefined;
  const rollRun = rollOut?.ok ? rollOut.run : null;
  const showRaw = dataset.leads.find((l) => l.id === dataset.showcase_id);
  const showH = v1Run?.hygiene.find((h) => h.lead_id === dataset.showcase_id);
  const showR = v1Run?.routing.find((r) => r.lead_id === dataset.showcase_id);
  const exR = exampleLead ? v1Run?.routing.find((r) => r.lead_id === exampleLead) : undefined;
  const exH = exampleLead ? v1Run?.hygiene.find((h) => h.lead_id === exampleLead) : undefined;
  const pctS = (x: number) => `${(x * 100).toFixed(1)}%`;
  const guideSteps: GuideStep[] = [
    {
      title: "Meet one messy lead",
      body: showRaw
        ? `${showRaw.first_name} ${showRaw.last_name} signed up with ${showRaw.email}, no company website, “${showRaw.title}”, “${showRaw.state}”, no employee count, and says their company is in ${showRaw.industry}. It's pinned at the top of the list.`
        : "A deliberately messy lead is pinned at the top of the list.",
    },
    {
      title: "Hygiene cleans it, without guessing",
      body: `Formats are normalized, the website and headcount come from the company record, and the record's industry (${showH?.record.industry ?? "Retail"}) beats the self-reported one. Each change says why.`,
    },
    {
      title: "Routing explains every decision",
      body: exR && exH
        ? `Most picks are right: that lead went to ${showR?.owner ?? "a Retail specialist"}. But here the router confidently chose ${exR.owner} for ${exH.record.company}, and ground truth says ✕: it's a subsidiary of another rep's customer.`
        : "Each step of the decision is shown, along with the reps who were ruled out and why.",
    },
    {
      title: "Change one rule, measure the effect",
      body: rollRun && v1Run
        ? `One line added to the routing policy: subsidiaries follow the parent account. Same leads, rerun: accuracy ${pctS(v1Run.funnel.eval_accuracy)} → ${pctS(rollRun.funnel.eval_accuracy)}, policy violations ${v1Run.routingEval.violations.length} → ${rollRun.routingEval.violations.length}. Every changed assignment is explained below.`
        : "One line is added to the routing policy and the same leads run again.",
    },
    {
      title: "Only safe actions reach Salesforce",
      body: `Each AE's new load against capacity, and the API calls that would be sent. ${rollRun ? rollRun.funnel.review + rollRun.funnel.exceptions : "Some"} leads still wait in Address Exceptions, because the policy won't guess.`,
    },
  ];
  const enterStep = (i: number) => {
    setGuide(i);
    if (i <= 2) setActive(1);
    if (i === 0) go("leads");
    if (i === 1) go("hygiene", dataset.showcase_id);
    if (i === 2) go("routing", exampleLead ?? dataset.showcase_id);
    if (i === 3) tryPolicyChange();
    if (i === 4) {
      if (rollupVersion) setActive(rollupVersion.version);
      go("salesforce");
    }
  };
  const startGuided = () => {
    generate();
    setActive(1);
    setGuide(0);
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
            <div className="sub">
              Built by{" "}
              <a href="https://www.linkedin.com/in/shaunyap" target="_blank" rel="noopener noreferrer">Shaun Yap</a>
              {" · "}
              <a href="https://github.com/shaunyap/lead-routing-lab" target="_blank" rel="noopener noreferrer">View source</a>
              {" · "}
              <DemoBoundaries />
            </div>
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
              {guide === null && <button className="btn" onClick={() => enterStep(0)}>▶ Guided demo</button>}
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
          <p className="hero-lede">
            A realistic lead list goes through hygiene, routing, exceptions and evals, and comes out as Salesforce-ready actions.
          </p>
          <p className="hero-detail">
            About 250 leads with the usual mess: mismatched headers, Gmail addresses, &ldquo;VP Mktg&rdquo;, &ldquo;WA&rdquo;, duplicates and
            missing firmographics. Every rule lives in two policy files you can edit.
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
          <div className="hero-actions">
            <button className="btn primary big" onClick={startGuided}>▶ Start the guided demo</button>
            <button className="btn big" onClick={generate}>Explore on my own</button>
          </div>
          <div className="faint" style={{ marginTop: 8, fontSize: 12.5 }}>The guided demo takes about 3 minutes: 5 steps with a Next button.</div>
          <div className="flow-label">From list to CRM</div>
          <div className="flow">
            <span>Leads</span><i>→</i><span>Hygiene</span><i>→</i><span>Routing</span><i>→</i>
            <span>Address Exceptions</span><i>→</i><span>Export to Salesforce</span>
          </div>
          <div className="flow-label">How it&rsquo;s built</div>
          <ArchStrip />
          <p className="thesis">{THESIS}</p>
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
              onTryChange={tryPolicyChange}
            />
          )}
          {run && tab === "attention" && <AttentionView dataset={dataset} run={run} org={org} onOpen={go} overrides={overrides} onAssign={assign} />}
          {effRun && tab === "salesforce" && <SalesforceView run={effRun} org={org} onOpen={setDrawer} onNav={go} />}
          {!run && tab !== "policy" && (
            <div className="errors">This policy version does not parse: {activeOutcome.ok ? "" : activeOutcome.errors.join(" · ")}</div>
          )}
        </>
      )}

      {guide !== null && generated && (
        <GuideCard
          steps={guideSteps}
          index={guide}
          onBack={() => enterStep(Math.max(0, guide - 1))}
          onNext={() => enterStep(guide + 1)}
          onExit={() => setGuide(null)}
        />
      )}

      {drawer && effRun && (
        <SalesforceDrawer leadId={drawer} run={effRun} org={org} dataset={dataset} onClose={() => setDrawer(null)} />
      )}
    </div>
  );
}
