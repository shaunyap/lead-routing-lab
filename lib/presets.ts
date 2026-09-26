// Suggested one-line policy edits for the Policy Lab. Each is a plain text edit to a
// policy.md policy block — the same edit a person could type by hand.

export interface PresetEdit {
  id: string;
  file: "routing" | "hygiene";
  label: string;
  intent: string;
  find: string;
  replace: string;
  tone: "improve" | "regress";
}

export const PRESET_EDITS: PresetEdit[] = [
  {
    id: "parent-rollup",
    file: "routing",
    label: "Subsidiaries follow the parent account",
    intent: "Add parent_account_owner right after existing_account_owner, so a subsidiary of a customer goes to the parent's owner.",
    find: "  - existing_account_owner\n  - named_account",
    replace: "  - existing_account_owner\n  - parent_account_owner\n  - named_account",
    tone: "improve",
  },
  {
    id: "named-first",
    file: "routing",
    label: "Named lists beat existing owners",
    intent: "Move named_account above existing_account_owner. Sounds reasonable; it isn't — named lists are stale.",
    find: "  - existing_account_owner\n  - named_account",
    replace: "  - named_account\n  - existing_account_owner",
    tone: "regress",
  },
  {
    id: "hygiene-tighten",
    file: "hygiene",
    label: "Teach \"Mgr\" and require a margin for fuzzy company matches",
    intent: "Add mgr: Manager, and only infer a company from a similar name when it clearly beats the runner-up.",
    find: "    dir: Director\n",
    replace: "    dir: Director\n    mgr: Manager\n",
    tone: "improve",
  },
  {
    id: "hq-location",
    file: "hygiene",
    label: "Fill missing location from company HQ",
    intent: "Allow location_from_company_hq. More records become routable — by asserting where people work.",
    find: "allowed: [country_from_us_state, company_from_similar_name]",
    replace: "allowed: [country_from_us_state, company_from_similar_name, location_from_company_hq]",
    tone: "regress",
  },
];

export function applyEdit(e: PresetEdit, md: string): string {
  let out = md.replace(e.find, e.replace);
  if (e.id === "hygiene-tighten") out = out.replace("min_margin: 0.0", "min_margin: 0.1");
  return out;
}

export function canApply(e: PresetEdit, md: string): boolean {
  return md.includes(e.find) && !md.includes(e.replace);
}
