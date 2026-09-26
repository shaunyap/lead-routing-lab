// Writes the default-seed dataset to data/ so it can be inspected and diffed.
import fs from "node:fs";
import path from "node:path";
import { EVAL_CASES } from "../lib/evalCases";
import { generateDataset } from "../lib/generate";
import { DEFAULT_SEED, ROOT, loadOrg } from "./load";

const seed = Number(process.argv[2] ?? DEFAULT_SEED);
const ds = generateDataset(seed, loadOrg());
const out = (f: string, v: unknown) => fs.writeFileSync(path.join(ROOT, "data", f), JSON.stringify(v, null, 2) + "\n");
out("generated-leads.json", { seed, leads: ds.leads });
out("ground-truth.json", { seed, ...ds.truth });
out("eval-cases.json", EVAL_CASES);
console.log(`seed ${seed}: ${ds.leads.length} leads, ${EVAL_CASES.length} eval cases written to data/`);
