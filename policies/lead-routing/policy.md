---
policy: lead-routing
description: Who owns a clean event lead, and why.
version: 1
---

# Lead Routing Policy

Routing takes a lead that passed hygiene and picks one owner from the sales
team, or sends it to review. Every decision carries its reasons.

## How a decision is made

**Filters apply everywhere.** A rep who excludes an industry never receives
it, whatever else matches. Strategic-only reps receive only their named
accounts.

**Precedence is ordered.** Steps run top to bottom. Some steps *assign*
(an existing owner, a named account); the rest *narrow* the pool of eligible
reps:

- `existing_account_owner` — if the company is already a customer, its owner
  keeps it. Relationships beat territory.
- `named_account` — companies on a rep's named list go to that rep.
- `geography` — the lead's own location (not the company HQ) picks the region.
- `segment` — employee count picks Enterprise, Mid-Market, or SMB.
- `specialization` — if any remaining rep specializes in the lead's industry,
  prefer them. This narrows but never empties the pool.
- `capacity` — reps at their event cap drop out. Among equals, the least
  loaded rep wins, then a stable hash of the lead ID.

Other steps the engine understands: `parent_account_owner` (a subsidiary of a
customer goes to the parent account's owner).

## When to ask for help

Don't force an assignment. Send the lead to the review queue when:

- the existing owner has left the company (inactive in the CRM),
- the existing owner is excluded from the lead's industry,
- no rep survives the filters, or
- every eligible rep is at capacity.

Review records never produce an executable Salesforce update.

## Executable policy

Only the block below changes behavior.

```policy
segments:
  enterprise: 2000
  mid-market: 200
  smb: 0

filters: [industry_exclusions, strategic_only_reps]

precedence:
  - existing_account_owner
  - named_account
  - geography
  - segment
  - specialization
  - capacity

existing_owner:
  bypass_capacity: true
  if_owner_excluded: review
  if_owner_inactive: review

tiebreak: [lowest_utilization, stable_hash]
```
