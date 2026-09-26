# Lead Routing Lab

A local demo of a lead-routing *decision system*: a messy lead list load → visible hygiene →
declarative policy → explainable routing → measurable evals → safe CRM action.

Everything is fictional and deterministic. No external services, no credentials.

```bash
npm install
npm run dev        # http://localhost:3100
npm test           # engine + eval invariants
npm run report     # funnel + eval metrics for the shipped policy, in the terminal
npm run generate   # rewrite data/*.json from the default seed (2026)
```

## How it fits together

```
policies/lead-hygiene/policy.md   what may be normalized, enriched, inferred; when to stop
policies/lead-routing/policy.md   filters, precedence, capacity, when to ask for review
config/                        fictional sales org: reps (open load + capacity), CRM accounts, company database, geo tables
lib/                           the harness — reads policy, never hard-codes it
  generate.ts                  dirty attendee export + world truth + recoverable truth
  reference.ts                 gold routing labels, written independently of the engine
  hygiene.ts / routing.ts      engines driven by the parsed ```policy blocks
  evals.ts                     scoring; policy violations are checked against org facts
  evalCases.ts                 32 hand-written hard cases, scored separately
  pipeline.ts                  run + compare two policy versions (direct / cascade / hygiene changes)
  headers.ts                   maps a file's column headers onto standard lead fields
  attention.ts                 turns held / review leads into a work queue with the reason the policy stopped
data/                          committed output of the default seed, for inspection
```

Only the fenced ```` ```policy ```` block in each policy.md changes behavior; the prose around it
is documentation. Policy versions saved in the UI live in the browser session, so **Reset**
always returns to the v1 files on disk.

### Why the evals aren't circular

- **Gold routing labels** come from `lib/reference.ts`, not from the routing engine. The reference
  knows one business rule the shipped v1 policy leaves out: subsidiaries of customers belong to
  the parent account's owner.
- **Hygiene is scored against recoverable truth**, meaning what a careful system could know from
  the dirty row plus the company database. It is not scored against the real answer. A Gmail
  lead with no company is correct when it comes out `INSUFFICIENT_DATA`. Filling in a value the
  evidence didn't support counts as an *unsupported inference*, even when the value happens to
  be right.
- **Policy violations** such as owner overrides, split account families, excluded industries,
  territory, capacity, and routing unclean data are checked against org facts, independent of
  any routing policy.

## Three-minute demo script

The main flow runs left to right: **Leads → Hygiene → Routing → Address Exceptions → Export to
Salesforce**. **Evals** and **Policy Lab** sit on the right, outside the flow.

1. **Load leads.** The stage bar reads 250 imported → 12 duplicates → 77 dirty →
   66 repaired → 11 review → 227 routable → 220 auto-routed → 7 exceptions → 93.4% eval.
2. **Leads.** Point at the column headers, which were normalized from the file's own names ("Email Address" → `email`, "# of Employees" → `employee_count`). Then point at the highlighted cells: Gmail addresses, `VP Mktg`, `WA`, empty
   employee counts. This is the file exactly as it arrived.
3. **Hygiene.** Open an *Enriched* record: the domain was filled by exact lookup. Then open an
   *Insufficient data* record: it has a personal email and no company, so the system refuses to guess.
4. **Routing.** The priority order is listed at the top. Open **L-0002** (Halcyon Outlet): the
   trace ends at Rachel Kim by tie-break, and ground truth says ✕, because Halcyon Outlet is a
   subsidiary of Alice Chen's customer.
5. **Address Exceptions.** 18 leads, grouped by *why* the policy stopped. For example, Brazos Health
   is a customer whose owner has left the company, and some leads have no employer or an ambiguous
   location. Click a suggested rep, or use the dropdown, to assign one by hand. It goes to Salesforce
   as a manual assignment, and the evals keep scoring the router's own decision.
6. **Export to Salesforce.** Each AE's current open load, what this load adds (existing customers,
   subsidiaries, named accounts, new logos), and the new total against capacity. Tom ends up over
   capacity because existing customers bypass the cap.
7. **Policy Lab.** Choose **Subsidiaries follow the parent account**. It adds one line to
   `precedence`. Save & rerun: accuracy goes from 93.4% to 99.6%, violations from 13 to 0, and
   22 assignments change (16 direct, 6 cascade), each with before/after traces. Go back to
   **Export**: the Subsidiaries column now has leads going to Alice and Hannah.
8. **Second act (optional).** Apply **Named lists beat existing owners**, which sounds
   reasonable. Violations rise because existing customers get taken from their owners. **Evals**
   catches the regression.

## Changing the scenario

- Different dataset: change the seed and press **Regenerate**. Quotas keep the dirty/review mix
  stable while the people, companies and assignments change.
- Different org: edit `config/reps.json` or `config/accounts.json`. Territories are meant to overlap.
- Different policy: edit a policy.md `policy` block, in the UI or on disk.
