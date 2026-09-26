// Prints funnel + eval metrics for the shipped policy (and optional edited policy files).
import fs from "node:fs";
import { rate } from "../lib/evals";
import { generateDataset } from "../lib/generate";
import { compareRuns, runPipeline } from "../lib/pipeline";
import { DEFAULT_SEED, loadOrg, loadPolicy } from "./load";

const org = loadOrg();
const seed = Number(process.env.SEED ?? DEFAULT_SEED);
const ds = generateDataset(seed, org);
const v1 = loadPolicy();
const res = runPipeline(ds, org, v1);
if (!res.ok) throw new Error(res.errors.join("\n"));
const run = res.run;
const p = (x: number) => (x * 100).toFixed(1) + "%";
console.log("FUNNEL", run.funnel);
const he = run.hygieneEval;
console.log("HYGIENE status", p(rate(he.status)), "fields", p(rate(he.fields)), "corrected", p(rate(he.corrected_fields)),
  "enrich", p(rate(he.enrichment)), "review", he.review, "dups", he.duplicates, "unsupported", he.unsupported.length);
for (const m of he.status_misses) console.log("  status miss", JSON.stringify(m), ds.truth.hygiene[m.lead_id].corruptions);
for (const m of he.field_misses.slice(0, 40)) console.log("  field miss", JSON.stringify(m), ds.truth.hygiene[m.lead_id].corruptions);
const re = run.routingEval;
console.log("ROUTING acc", p(rate(re.accuracy)), re.accuracy, "e2e", p(rate(re.end_to_end)), "esc", re.escalation, "ambiguous", re.ambiguous);
for (const v of re.violations) console.log("  violation", v);
for (const m of re.misses) console.log("  miss", m);
console.log("WORKLOAD", re.workload.map((w) => `${w.name.split(" ")[0]} ${w.assigned}/${w.capacity}`).join(", "));
console.log("HARD CASES", run.cases.filter((c) => c.hygiene_pass && c.routing_pass).length, "/", run.cases.length);
for (const c of run.cases.filter((c) => !(c.hygiene_pass && c.routing_pass))) console.log("  fail", c.case.id, c.case.title, c.problems);

const alt = process.env.ROUTING || process.env.HYGIENE;
if (alt) {
  const v2 = {
    ...v1, version: 2, label: "v2",
    routingMd: process.env.ROUTING ? fs.readFileSync(process.env.ROUTING, "utf8") : v1.routingMd,
    hygieneMd: process.env.HYGIENE ? fs.readFileSync(process.env.HYGIENE, "utf8") : v1.hygieneMd,
  };
  const r2 = runPipeline(ds, org, v2);
  if (!r2.ok) throw new Error(r2.errors.join("\n"));
  const cmp = compareRuns(ds, run, r2.run);
  console.log("\nCOMPARE");
  for (const m of cmp.metrics) console.log(" ", m.label, m.before, "→", m.after);
  console.log(" changes", cmp.changes.length, cmp.changes.reduce((a: any, c) => ((a[c.kind] = (a[c.kind] ?? 0) + 1), a), {}));
  for (const c of cmp.changes) console.log("  ", c.lead_id, c.kind, c.correct_before ? "✓" : "✗", "→", c.correct_after ? "✓" : "✗", c.explanation);
}
