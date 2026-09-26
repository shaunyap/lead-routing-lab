import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { attentionItems } from "../lib/attention";
import { generateDataset, TITLES } from "../lib/generate";
import { headerMappings, normalizeHeader } from "../lib/headers";
import { applyOverrides } from "../lib/overrides";
import { normalizeTitle } from "../lib/hygiene";
import { parseHygienePolicy, parseRoutingPolicy } from "../lib/policy";
import { compareRuns, runPipeline, type RunResult } from "../lib/pipeline";
import { PRESET_EDITS, applyEdit } from "../lib/presets";
import { salesforceAction } from "../lib/salesforce";
import { companyKey } from "../lib/util";
import { DEFAULT_SEED, ROOT, loadOrg, loadPolicy } from "../scripts/load";

const org = loadOrg();
const v1 = loadPolicy();
const ds = generateDataset(DEFAULT_SEED, org);
const run = (p = v1): RunResult => {
  const r = runPipeline(ds, org, p);
  assert.ok(r.ok, r.ok ? "" : r.errors.join("\n"));
  return r.run;
};

test("committed data/ matches the default seed", () => {
  const leads = JSON.parse(fs.readFileSync(path.join(ROOT, "data/generated-leads.json"), "utf8"));
  const truth = JSON.parse(fs.readFileSync(path.join(ROOT, "data/ground-truth.json"), "utf8"));
  assert.deepEqual(leads.leads, ds.leads);
  assert.deepEqual(truth.routing, ds.truth.routing);
});

test("generation is deterministic per seed", () => {
  assert.deepEqual(generateDataset(7, org), generateDataset(7, org));
  assert.notDeepEqual(generateDataset(7, org).leads, generateDataset(8, org).leads);
});

test("shipped policies parse cleanly", () => {
  assert.deepEqual(parseHygienePolicy(v1.hygieneMd).errors, []);
  assert.deepEqual(parseRoutingPolicy(v1.routingMd).errors, []);
});

test("canonical titles are fixed points of normalization", () => {
  const p = parseHygienePolicy(v1.hygieneMd).policy!.title;
  for (const t of TITLES) assert.equal(normalizeTitle(t.title, p).value, t.title);
});

test("company name keys are unique", () => {
  const seen = new Map<string, string>();
  for (const c of org.data.companies)
    for (const n of [c.name, ...c.aliases]) {
      const k = companyKey(n);
      assert.ok(!seen.has(k) || seen.get(k) === c.id, `${n} collides with ${seen.get(k)}`);
      seen.set(k, c.id);
    }
});

test("funnel reconciles", () => {
  const f = run().funnel;
  assert.equal(f.imported, f.unique + f.duplicates);
  assert.equal(f.unique, f.routable + f.review);
  assert.equal(f.dirty, f.repaired + f.review);
  assert.equal(f.routable, f.auto_routed + f.exceptions);
});

test("v1 never manufactures data", () => {
  assert.equal(run().hygieneEval.unsupported.length, 0);
});

test("records needing review never produce an executable Salesforce update", () => {
  for (const r of run().routing) {
    const a = salesforceAction(r, org);
    assert.equal(a.executable, r.decision === "auto_route");
  }
});

test("v1 fails exactly the hard cases it was designed to fail", () => {
  const failing = run().cases.filter((c) => !(c.hygiene_pass && c.routing_pass)).map((c) => c.case.title);
  assert.deepEqual(failing.sort(), [
    "\"Sr Mgr IT\"",
    "Company field names the parent; email is the subsidiary",
    "Company name resembles two different companies",
    "Subsidiary of an existing customer",
  ].sort());
});

test("preset edits move the metrics in the promised direction", () => {
  const base = run();
  const edit = (id: string) => {
    const e = PRESET_EDITS.find((p) => p.id === id)!;
    const next = { ...v1, version: 2, label: e.label, [e.file === "routing" ? "routingMd" : "hygieneMd"]: applyEdit(e, e.file === "routing" ? v1.routingMd : v1.hygieneMd) };
    return compareRuns(ds, base, run(next)).metrics;
  };
  const get = (m: ReturnType<typeof edit>, k: string) => m.find((x) => x.key === k)!;

  const rollup = edit("parent-rollup");
  assert.ok(get(rollup, "routing").after > get(rollup, "routing").before);
  assert.equal(get(rollup, "violations").after, 0);

  const bad = edit("named-first");
  assert.ok(get(bad, "violations").after > get(bad, "violations").before);

  const hygiene = edit("hygiene-tighten");
  assert.equal(get(hygiene, "fields").after, 1);

  const hq = edit("hq-location");
  assert.ok(get(hq, "unsupported").after > 0);
});

test("every lead that isn't exported shows up in Address Exceptions (except merged duplicates)", () => {
  const r = run();
  const items = attentionItems(r.hygiene, r.routing, org);
  assert.equal(items.length, r.funnel.review + r.funnel.exceptions);
  const exported = new Set(r.routing.filter((x) => x.decision === "auto_route").map((x) => x.lead_id));
  for (const it of items) assert.ok(!exported.has(it.lead_id));
});

test("source column headers normalize onto lead fields", () => {
  for (const m of headerMappings()) assert.ok(m.field, `unmapped header "${m.source}"`);
  assert.equal(normalizeHeader("# of Employees"), "employee_count");
  assert.equal(normalizeHeader("State/Province"), "state");
  assert.equal(normalizeHeader("Work Email"), "email");
  assert.equal(normalizeHeader("Favorite Color"), null);
});

test("a departed account owner sends the lead to review, not to another rep", () => {
  const brazos = run().cases.find((c) => c.case.title === "Account owner has left the company")!;
  assert.equal(brazos.routing.decision, "requires_review");
  assert.match(brazos.routing.review_reason ?? "", /no longer active/);
  assert.ok(!org.data.reps.some((r) => r.active === false), "inactive reps never enter routing pools");
});

test("manual assignments become executable updates without changing the engine's output", () => {
  const r = run();
  const review = r.routing.find((x) => x.decision === "requires_review")!;
  const before = JSON.stringify(r.routing);
  const eff = applyOverrides(r.routing, { [review.lead_id]: org.data.reps[0].id }, org);
  const a = salesforceAction(eff.find((x) => x.lead_id === review.lead_id)!, org);
  assert.equal(a.executable, true);
  assert.equal(a.body.Routing_Status__c, "Manually assigned");
  assert.equal(JSON.stringify(r.routing), before);
});
