// Sweeps many seeds to check the engine against ground truth beyond the default dataset.
import { rate } from "../lib/evals";
import { generateDataset } from "../lib/generate";
import { runPipeline } from "../lib/pipeline";
import { loadOrg, loadPolicy } from "./load";

const org = loadOrg();
const policy = loadPolicy();
const miss = new Map<string, number>();
for (let seed = 1; seed <= 60; seed++) {
  const ds = generateDataset(seed, org);
  const res = runPipeline(ds, org, policy);
  if (!res.ok) throw new Error(res.errors.join());
  const { hygieneEval: he, routingEval: re, funnel: f } = res.run;
  for (const m of he.status_misses) {
    const k = `${m.expected}->${m.actual} ${ds.truth.hygiene[m.lead_id].corruptions.join("+")}`;
    miss.set(k, (miss.get(k) ?? 0) + 1);
  }
  for (const m of he.field_misses) {
    if (m.field === "title" && /Mgr/.test(m.actual)) continue;
    const k = `field ${m.field}: exp "${m.expected}" got "${m.actual}" ${ds.truth.hygiene[m.lead_id].corruptions.join("+")}`;
    miss.set(k, (miss.get(k) ?? 0) + 1);
  }
  if (seed <= 8)
    console.log(seed, `dirty ${f.dirty} review ${f.review} routable ${f.routable} exc ${f.exceptions}`,
      `route ${(rate(re.accuracy) * 100).toFixed(1)}% viol ${re.violations.length} unsup ${he.unsupported.length}`);
}
for (const [k, n] of [...miss].sort((a, b) => b[1] - a[1])) if (!/Mgr/.test(k) || !k.includes("title_abbrev")) console.log(n, k);
