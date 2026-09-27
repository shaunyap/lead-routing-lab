"use client";

import { useEffect, useRef, useState } from "react";

export const THESIS =
  "The point isn’t perfect routing rules; it’s making business logic explicit, testable, and safe to change.";

/** Policy lives in files; skills execute it; evals check it; Salesforce only sees safe actions. */
export function ArchStrip() {
  return (
    <div className="arch" aria-label="How it's built">
      <div className="arch-policies">
        <span />
        <span className="arch-policy" title="policies/lead-hygiene/policy.md">policy.md</span>
        <span className="arch-policy" title="policies/lead-routing/policy.md">policy.md</span>
        <span />
        <span />
      </div>
      <div className="arch-row">
        <span className="arch-box">Lead list (CSV)</span>
        <span className="arch-box skill">Hygiene skill</span>
        <span className="arch-box skill">Routing skill</span>
        <span className="arch-box">Evals</span>
        <span className="arch-box">Salesforce API</span>
      </div>
      <div className="arch-caption">Business rules live in editable policy files. The skills that carry them out stay fixed.</div>
    </div>
  );
}

export function DemoBoundaries({ label = "Demo boundaries" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <span className="bounds" ref={ref}>
      <button className="linkish-quiet" onClick={() => setOpen(!open)} aria-expanded={open}>
        {label}
      </button>
      {open && (
        <span className="bounds-pop" role="dialog" aria-label="Demo boundaries">
          <b>What&rsquo;s real and what&rsquo;s mocked</b>
          <span className="bounds-list">
            <span>• <b>Synthetic data.</b> Leads, companies and reps are fictional, generated from a seed.</span>
            <span>• <b>Deterministic evals.</b> Ground truth and 32 hard cases are fixed, so every rerun is comparable.</span>
            <span>• <b>Mocked Salesforce.</b> API requests are built and shown, never sent.</span>
            <span>• <b>No CRM matching.</b> Every lead is treated as new. In practice, leads are matched to existing leads, contacts and accounts first, then upserted.</span>
            <span>• <b>No LLM calls.</b> Policies are executed by deterministic code.</span>
            <span>• <b>Session only.</b> Policy versions and manual assignments reset on refresh.</span>
          </span>
        </span>
      )}
    </span>
  );
}

export interface GuideStep {
  title: string;
  body: string;
}

export function GuideCard({
  steps, index, onBack, onNext, onExit,
}: {
  steps: GuideStep[]; index: number; onBack: () => void; onNext: () => void; onExit: () => void;
}) {
  const s = steps[index];
  const last = index === steps.length - 1;
  return (
    <aside className="guide" role="dialog" aria-label="Guided demo">
      <div className="guide-top">
        <span className="guide-k">Guided demo · {index + 1} of {steps.length}</span>
        <button className="btn small ghost" onClick={onExit} aria-label="Exit guided demo">✕</button>
      </div>
      <div className="guide-dots">
        {steps.map((_, i) => <span key={i} className={i <= index ? "on" : ""} />)}
      </div>
      <h3>{s.title}</h3>
      <p>{s.body}</p>
      {last && <p className="guide-thesis">{THESIS}</p>}
      <div className="guide-nav">
        <button className="btn small" onClick={onBack} disabled={index === 0}>← Back</button>
        <span className="spacer" />
        <button className="btn small primary" onClick={last ? onExit : onNext}>{last ? "Finish" : "Next →"}</button>
      </div>
    </aside>
  );
}
