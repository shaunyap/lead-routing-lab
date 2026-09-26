// Node-only loaders for config/ and policies/ (the browser receives the same files from the server).
import fs from "node:fs";
import path from "node:path";
import { indexOrg } from "../lib/org";
import type { PolicyVersion } from "../lib/pipeline";
import type { OrgData } from "../lib/types";

export const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const json = (p: string) => JSON.parse(read(p));

export function loadOrg() {
  const data: OrgData = {
    companies: json("config/companies.json"),
    accounts: json("config/accounts.json"),
    reps: json("config/reps.json"),
    config: json("config/routing-config.json"),
  };
  return indexOrg(data);
}

export function loadPolicy(): PolicyVersion {
  return {
    version: 1,
    label: "v1 — shipped policy",
    hygieneMd: read("policies/lead-hygiene/policy.md"),
    routingMd: read("policies/lead-routing/policy.md"),
  };
}

export { DEFAULT_SEED } from "../lib/generate";
