# SEO release — 27.10.2026

The Search Console exports identified missing requisites canonical, indistinguishable
listing-kind headings, two obsolete category addresses and a sitemap still using
the retired publication backend. This release changes only public SEO behavior.

- Add `/rekvizity` canonical and sitemap entry.
- Distinguish listing-kind titles, descriptions and H1 while retaining filtered canonicals.
- Redirect two exact legacy category addresses with 308, including encoded Cyrillic.
- Replace testing instructions in public animal category descriptions.
- Populate PostgreSQL sitemap from existing public eligibility and DTO validation
  for listings, vacancies, orders and specialist catalogue records. Preserve SQL
  pagination across rejected DTOs; propagate failures without legacy fallback.

No changes to auth, cabinet editing, payments, publication policy, schema, grants,
environment or dependencies. Deleted old publications retain 404 as confirmed by
the owner. Existing noindex/robots exclusions remain. Pending local migration/UI
changes in the main workspace are excluded from this branch.

Validation: 1661 native tests, focused SEO tests, types, lint and Next build passed.
The existing unused `targetType` lint warning remains. PR CI/security gates must
pass before merge; deployment uses the existing health/readiness/watchdog rollback.
After deployment check public canonical, redirects, sitemap and Search Console.
Google indexing and its canonical selection require subsequent observation.
