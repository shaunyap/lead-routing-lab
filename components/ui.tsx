"use client";

import type { ReactNode } from "react";
import type { OrgIndex } from "@/lib/org";
import type { HygieneStatus, RoutingDecision } from "@/lib/types";

export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;

const STATUS_META: Record<HygieneStatus, { tone: string; icon: string; label: string }> = {
  CLEAN: { tone: "neutral", icon: "○", label: "Clean" },
  NORMALIZED: { tone: "accent", icon: "✎", label: "Normalized" },
  ENRICHED: { tone: "enrich", icon: "+", label: "Enriched" },
  NEEDS_REVIEW: { tone: "warn", icon: "!", label: "Needs review" },
  INSUFFICIENT_DATA: { tone: "critical", icon: "✕", label: "Insufficient data" },
  DUPLICATE: { tone: "outline", icon: "⧉", label: "Duplicate" },
};
export const HYGIENE_ORDER: HygieneStatus[] = ["CLEAN", "NORMALIZED", "ENRICHED", "NEEDS_REVIEW", "INSUFFICIENT_DATA", "DUPLICATE"];

export function StatusChip({ status }: { status: HygieneStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`chip ${m.tone}`}>
      <span className="ic">{m.icon}</span>
      {m.label}
    </span>
  );
}
export const statusLabel = (s: HygieneStatus) => STATUS_META[s].label;

const DECISION_META: Record<RoutingDecision, { tone: string; icon: string; label: string }> = {
  auto_route: { tone: "good", icon: "✓", label: "Auto-routed" },
  requires_review: { tone: "warn", icon: "!", label: "Requires review" },
  held: { tone: "neutral", icon: "‖", label: "Held at hygiene" },
};

export function DecisionChip({ decision }: { decision: RoutingDecision }) {
  const m = DECISION_META[decision];
  return (
    <span className={`chip ${m.tone}`}>
      <span className="ic">{m.icon}</span>
      {m.label}
    </span>
  );
}

export function PassChip({ pass, label }: { pass: boolean; label?: string }) {
  return (
    <span className={`chip ${pass ? "good" : "critical"}`}>
      <span className="ic">{pass ? "✓" : "✕"}</span>
      {label ?? (pass ? "Pass" : "Fail")}
    </span>
  );
}

/** Minimal JSON syntax highlighting without dangerouslySetInnerHTML. */
export function Json({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  const parts: ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1] && m[2]) parts.push(<span key={i++} className="k">{m[1]}</span>, m[2]);
    else if (m[1]) parts.push(<span key={i++} className="s">{m[1]}</span>);
    else if (m[3]) parts.push(<span key={i++} className="b">{m[3]}</span>);
    else parts.push(<span key={i++} className="n">{m[4]}</span>);
    last = re.lastIndex;
  }
  parts.push(text.slice(last));
  return <pre className="json">{parts}</pre>;
}

export function Tile({
  label, value, detail, onClick, selected, tone,
}: {
  label: ReactNode; value: ReactNode; detail?: ReactNode; onClick?: () => void; selected?: boolean; tone?: string;
}) {
  const body = (
    <>
      <div className="k">{label}</div>
      <div className="v" style={tone ? { color: `var(--${tone}-ink)` } : undefined}>{value}</div>
      {detail && <div className="d">{detail}</div>}
    </>
  );
  return onClick ? (
    <button className={`tile ${selected ? "selected" : ""}`} onClick={onClick}>{body}</button>
  ) : (
    <div className="tile">{body}</div>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; l: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.v} className={o.v === value ? "on" : ""} onClick={() => onChange(o.v)}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card-b faint" style={{ padding: 40, textAlign: "center" }}>{children}</div>;
}

/** Current open load, then the new leads from this load (2px gap), with a capacity tick. */
export function LoadBar({ open, added, capacity, max }: { open: number; added: number; capacity: number; max: number }) {
  const w = (n: number) => `${(n / max) * 100}%`;
  const over = open + added > capacity;
  return (
    <div className="load" title={`${open} open + ${added} new = ${open + added} of ${capacity}`}>
      <div className="load-open" style={{ width: w(open) }} />
      {added > 0 && <div className={`load-new ${over ? "over" : ""}`} style={{ left: `calc(${w(open)} + 2px)`, width: `calc(${w(added)} - 2px)` }} />}
      <div className="bar-cap" style={{ left: w(capacity) }} />
    </div>
  );
}

/** Pick an AE by hand. The empty option undoes a manual assignment. */
export function AssignSelect({
  org, value, onChange, loads,
}: {
  org: OrgIndex; value: string | undefined; onChange: (repId: string | null) => void; loads?: Map<string, number>;
}) {
  return (
    <select
      className={`btn small assign ${value ? "set" : ""}`}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      onClick={(e) => e.stopPropagation()}
      aria-label="Assign to an AE"
    >
      <option value="">{value ? "↺ Undo: use the router's decision" : "Assign to an AE…"}</option>
      {org.data.reps.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}: {r.title} ({loads?.get(r.id) ?? r.open_leads}/{r.capacity}{loads ? " after this list" : ""})
        </option>
      ))}
    </select>
  );
}
