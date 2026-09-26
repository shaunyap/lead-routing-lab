"use client";

import type { Tab } from "./Lab";

export interface WalkStep {
  tab: Tab;
  lead?: string;
  title: string;
  body: string;
}

/** The suggested path through the demo, for people exploring it without a presenter. */
export function walkthroughSteps(exampleLead: string | null): WalkStep[] {
  return [
    { tab: "leads", title: "See the mess", body: "Click the summary boxes (Personal emails, Abbreviated titles…) to filter the raw list." },
    { tab: "hygiene", title: "Watch it get cleaned", body: "Open an Enriched record, then an Insufficient data one. The system won't guess an employer." },
    {
      tab: "routing",
      lead: exampleLead ?? undefined,
      title: "Follow one decision",
      body: exampleLead
        ? `Open ${exampleLead}. The router explains its pick, but ground truth says ✕: it's a subsidiary of another rep's customer.`
        : "Open any lead to see each step of the decision and why that rep won.",
    },
    { tab: "attention", title: "Handle what it won't guess", body: "Each exception says why the policy stopped. Click a suggested rep to assign one by hand." },
    { tab: "policy", title: "Change one rule", body: "Apply “Subsidiaries follow the parent account”, then Save & rerun. Accuracy and violations move, and every change is explained." },
    { tab: "salesforce", title: "See the result", body: "Each AE's new load against capacity, and the Salesforce API calls that would be sent." },
  ];
}

export default function Walkthrough({
  steps, visited, open, setOpen, onGo,
}: {
  steps: WalkStep[]; visited: Set<number>; open: boolean; setOpen: (v: boolean) => void; onGo: (i: number) => void;
}) {
  const done = visited.size;
  if (!open) {
    return (
      <button className="walk-collapsed" onClick={() => setOpen(true)}>
        Suggested walkthrough · {done}/{steps.length} ▸
      </button>
    );
  }
  return (
    <section className="walk" aria-label="Suggested walkthrough">
      <div className="walk-h">
        <b>Suggested walkthrough</b>
        <span className="faint">about 3 minutes · {done}/{steps.length} done</span>
        <span className="spacer" />
        <button className="btn small ghost" onClick={() => setOpen(false)}>Hide</button>
      </div>
      <ol className="walk-steps">
        {steps.map((s, i) => (
          <li key={i}>
            <button className={visited.has(i) ? "done" : ""} onClick={() => onGo(i)}>
              <span className="n">{visited.has(i) ? "✓" : i + 1}</span>
              <span>
                <span className="t">{s.title}</span>
                <span className="d">{s.body}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
