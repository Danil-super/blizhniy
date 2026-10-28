# SEO release — 27.10.2026

The Search Console exports identified missing requisites canonical, indistinguishable
listing-kind headings, two obsolete category addresses and a sitemap still using
the retired publication backend. This release changes only public SEO behavior.

- Add `/rekvizity` canonical and sitemap entry.
- Redirect the exact `www` alias to the primary HTTPS host, retaining path/query.
  Live URL Inspection identified the `www` requisites page as Google's canonical;
  both hosts previously served HTTP 200. Preserve older path-redirect precedence.
- Distinguish listing-kind titles, descriptions and H1 while retaining filtered canonicals.
- Redirect two exact legacy category addresses with 308, including encoded Cyrillic.
- Replace testing instructions in public animal category descriptions.
- Populate PostgreSQL sitemap from existing public eligibility and DTO validation
  for listings, vacancies, orders and specialist catalogue records. Preserve SQL
  pagination across rejected DTOs; propagate failures without legacy fallback.

No changes to auth, cabinet editing, payments, publication policy, schema, grants
or environment. Deleted old publications retain 404 as confirmed by
the owner. Existing noindex/robots exclusions remain. Pending local migration/UI
changes in the main workspace are excluded from this branch.

Validation: 1662 native tests, 349 disposable PostgreSQL tests, focused SEO tests,
types/lint, Next 15.5.28 build and actual HTTP checks of www/path/query redirects.
The existing unused `targetType` lint warning remains. PR CI/security gates must
pass before merge; deployment uses the existing health/readiness/watchdog rollback.
After deployment check public canonical, redirects, sitemap and Search Console.
Google indexing and its canonical selection require subsequent observation.

## Required framework security patch

The release audit found critical GHSA-2464-fhr4-w9xw and high
GHSA-p3m5-59mp-jv5r in Next.js 15.5.27. Upgrade Next and its matching ESLint config
to 15.5.28, the patched version confirmed by the upstream advisories and
[release notes](https://github.com/vercel/next.js/releases/tag/v15.5.28).
Production audit then reports no high/critical findings. One moderate Nodemailer
finding remains outside this change; the audit gate is unchanged.
