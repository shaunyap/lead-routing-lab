import fs from "node:fs";
import path from "node:path";
import Lab from "@/components/Lab";
import type { OrgData } from "@/lib/types";

// Policy and org files are read at build time, so the page ships as static HTML.
// The whole pipeline then runs in the browser.

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
