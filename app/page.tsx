import fs from "node:fs";
import path from "node:path";
import Lab from "@/components/Lab";
import type { OrgData } from "@/lib/types";

// The harness reads policy and org data from disk; the browser runs the pipeline.
export const dynamic = "force-dynamic";

const text = (p: string) => fs.readFileSync(p, "utf8");

export default function Page() {
  const org: OrgData = {
    companies: JSON.parse(text(path.join(process.cwd(), "config", "companies.json"))),
    accounts: JSON.parse(text(path.join(process.cwd(), "config", "accounts.json"))),
    reps: JSON.parse(text(path.join(process.cwd(), "config", "reps.json"))),
    config: JSON.parse(text(path.join(process.cwd(), "config", "routing-config.json"))),
  };
  return (
    <Lab
      org={org}
      hygieneMd={text(path.join(process.cwd(), "policies", "lead-hygiene", "policy.md"))}
      routingMd={text(path.join(process.cwd(), "policies", "lead-routing", "policy.md"))}
    />
  );
}
