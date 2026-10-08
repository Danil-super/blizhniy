# Stored subcategory identity survives presentation

This is a narrow follow-up to `af46f32582bb965c013818dc95e7f6c318f383c5`, not a new security scan or a deployment. No schema, category names, dependencies, payment logic or authentication policy changes.

## Observed defect and contract

The frozen browser delta at that revision passes 128/132 page checks and 48/48 dedicated instrument/dish breadcrumb clicks. Four real failures remain: `/katalog/raznoe/raznoe` loses the exact published synthetic listing `00001399-1111-4111-8111-000000005017` at 320, 768, 1024 and 1440 px, although its root category shows it. The raw title-selector helper errors and 13 unexplained cancelled RSC requests are retained separately; the browser run is not declared entirely green.

The stored category parent is now correct, but `toDemoListing` still inferred root/child identity from display-name equality. Both the root and child are named `Разное`. That heuristic discards the child slug and the real category page's final filter removes the listing.

The read DTO adds optional `isSubcategory`: true/false comes from actual stored category parent presence; missing category metadata leaves it undefined. Presentation uses that flag, falling back to the existing name heuristic only for legacy/demo DTOs without it. This is additive and does not expose raw parent identifiers or create a second slug table. Dedicated canonical slug resolution remains unchanged.

## Verification

Four added native cases bring `listing-child-breadcrumb.test.mjs` to 19. Two run the actual listing store, REST client, category store, presentation, detail breadcrumbs and category pages, loading complete source modules and real React rendering. The synthetic transport accepts only GET at a non-listening loopback origin and explicitly supported category/listing/marquee reads; unexpected requests remain recorded even when application fallback catches them. No application mapper or component is replaced. Streaming rendering supports the real async `HomeHero` without substituting it.

The child graph verifies visibility on both root and child pages; the same-name root control verifies visibility only on the root. Both preserve hidden address/coordinates. Additional controls retain legacy behavior and accept explicit child identity under a non-static parent.

Before the production change, the child graph fails with empty slug instead of `raznoe`; the root graph reaches the explicit DTO contract assertion. An earlier synchronous-render adapter error was a harness setup error, not evidence of an application defect. Initial 19-case RED had 3 expected missing-identity failures and 16 healthy passes.

After the change, all 19 cases pass. A physical on-disk mutant reverting presentation to name equality produces 2 semantic failures and 17 healthy passes, including the real root graph; the production source is restored exactly afterward.

The fresh complete native CI command passes 731/731, zero failures/skips/cancellations (Node 22.23.1, 44,766 ms). TypeScript `--noEmit --incremental false` passes. Seven actual provider/store graph cases also pass against the unchanged combined SQL bootstrap in isolated PostgreSQL 17, zero failures/skips/cancellations (43,284 ms). The owned container is removed; no live provider/database operation was performed. The wider 71-case PostgreSQL suite previously passed on `af46f325`; that previous run is not relabelled as a fresh 71-case run on this patch.

An accidentally overbroad ESLint invocation without the project's existing vendored-code exclusion fails against unchanged vendor code. Its raw diagnostic is retained. The unchanged project-defined lint command passes, with only the pre-existing unused `targetType` warning in `checkout-prerequisites.test.cjs`; configuration and the quality gate are unchanged. Fresh bounded Next/browser verification is recorded separately once actually executed. This document does not claim a new all-pages sweep, a real merchant payment or any production change.
