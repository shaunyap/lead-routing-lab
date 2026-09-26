---
policy: lead-hygiene
description: How dirty event leads are normalized, enriched, and escalated before routing.
version: 1
---

# Lead Hygiene Policy

Event exports are messy. This policy decides what the system may fix on its own,
what it may look up, and when it must stop and ask a human.

## Three kinds of change

1. **Normalization** rewrites information the record already contains into a
   canonical form. `VP Mktg` → `VP, Marketing`. `WA` → `Washington`.
   `HALCYON RETAIL GRP` → `Halcyon Retail Group`. Nothing new is asserted.
2. **Enrichment** fills a field from a trusted source using an exact key.
   The only trusted source is the company record, keyed by a work email
   domain, a company domain, or an exact company name/alias.
3. **Inference** derives a value from indirect evidence. Inference is
   allowed **only** when it is named in `inference.allowed` below. Anything
   else is a guess, and guesses are not allowed.

## Never manufacture data

- A personal email address (Gmail, Outlook, Yahoo…) says nothing about where
  someone works. It is never used to identify a company.
- A person's location is not the company's headquarters. Attendees travel and
  work remotely, so location is never copied from the company record.
- If a field cannot be known, it stays empty and is listed as `unresolved`.
  An empty field is honest; a plausible wrong one is expensive.

## When to stop

- **INSUFFICIENT_DATA** — we cannot say which company the person works for.
- **NEEDS_REVIEW** — a field that routing depends on is missing, or two
  signals disagree (for example, the email domain belongs to one company and
  the company field names an unrelated one). Parent/subsidiary pairs are not a
  conflict.
- Exact duplicate emails are merged into the first record. Same name and same
  company with different emails is a *possible* duplicate and goes to review.

## Outcomes

`CLEAN` · `NORMALIZED` · `ENRICHED` · `NEEDS_REVIEW` · `INSUFFICIENT_DATA` · `DUPLICATE`

## Executable policy

Only the block below changes behavior. Edits to the prose above are
documentation.

```policy
title:
  level_words: [VP, Senior Director, Director, Senior Manager, Manager, Head]
  abbreviations:
    sr: Senior
    dir: Director
    vp: VP
    eng: Engineer
    arch: Architect
    sol: Solutions
  function_abbreviations:
    mktg: Marketing
    ops: Operations
    eng: Engineering
    engg: Engineering
    revops: Revenue Operations
  whole_title:
    cio: Chief Information Officer
    cto: Chief Technology Officer
    cmo: Chief Marketing Officer
    swe: Software Engineer
  acronyms: [IT, VP, AI, ML, CRM, HR]

industry_aliases:
  finserv: Financial Services
  fin svcs: Financial Services
  banking: Financial Services
  health care: Healthcare
  healthcare & life sciences: Healthcare
  retail & ecommerce: Retail
  tech: Technology
  software: Technology
  mfg: Manufacturing
  industrial: Manufacturing
  media: Media & Entertainment
  government: Public Sector
  gov: Public Sector

enrichment:
  source: company_record
  allowed_fields: [company, company_domain, industry, employee_count]
  company_record_overrides_self_reported: [industry]

inference:
  allowed: [country_from_us_state, company_from_similar_name]
  company_from_similar_name:
    min_similarity: 0.7
    min_margin: 0.0

review:
  required_for_routing: [company_identity, country, employee_count]
  state_required_for: [United States, Canada]
  possible_duplicate: same_name_and_company
```
