# Canonical instrument/dish child breadcrumbs

Functional slice on base `adcec4a5c6e369e72f3ace7fc0c5537793a220d4`, separate from the category-parent worktree. No migration, dependency, auth/payment/state change or production write.

## Cause and narrow contract

The existing read-only browser evidence (`current-public-pages-0dd0058-20261008/child-breadcrumbs-verification.json`) shows valid instrument/dish detail pages at 320 and 1440 px. Their child breadcrumbs incorrectly use lowercase Cyrillic (`слесарно-монтажный-ручной-инструмент`, `кухонная`), and those targets return 404. Dedicated routes instead accept the Latin canonical slugs already defined by `instrument-subcategories.ts` and `posuda-subcategories.ts`.

`slugifySubcategory` now resolves exact display names against these two existing data arrays before its unchanged generic mapping/fallback. `toDemoListing` and actual detail Breadcrumbs consume that resolver without separate URL mappings. There is no manually duplicated table of the 12 slugs and no transliteration guess. Root listings still have an empty child slug/breadcrumb; existing generic mappings and unknown generic fallback remain unchanged. The production diff is only six added lines in `ListingPages.tsx` (two imports and the lookup).

## Verification and limits

The new regression executes the complete actual presentation module and recursively loads application dependencies and real JSON assets. It uses real React server rendering and only adapts Next request/router/host-element edges for Node. No application mapper/component/Auth/store function is replaced, no function source is extracted, and any network fetch fails the harness. Each of all 12 dedicated source-data entries checks:

- exact canonical slug through `slugifySubcategory` and `toDemoListing`;
- the actual rendered detail Breadcrumbs href, with no Cyrillic URL;
- actual dedicated-route metadata and page acceptance rather than `notFound`;
- preservation of hidden address/coordinates.

Three healthy controls cover both root categories, existing generic mappings/unknown generic fallback, and dedicated-route rejection of unsupported slugs. The two pre-existing extraction-based test adapters now receive the actual complete dedicated data modules; those older checks are not the sole proof.

RED on unchanged source: 12 expected canonical-slug failures and 3 healthy controls passed, exit 1. An initial loader error for the real `eyes.json` import was corrected by loading the actual JSON asset; it was a harness setup error, not behavioral RED.

GREEN: 15/15 new cases, 29/29 with the existing catalog SEO and UI regressions. An actual on-disk mutant bypassing the dedicated lookup (`if (false && dedicated)`) restored all 12 wrong-slug failures while all 3 healthy controls passed. The source was then restored exactly to SHA256 `41655d80789cbd97576a94cefac173738e4902ac6cc62d2fe42bc2c6b3222605`, and focused tests reran GREEN.

Focused command:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin /home/danil/.cache/blizhniy-node22-pxyRwP/node --experimental-strip-types --test --test-reporter=spec tests/listing-child-breadcrumb.test.mjs tests/catalog-seo.test.mjs tests/ui-public-browser-regressions.test.mjs
```

Final native Node 22.23.1 suite: 699/699 (=684 existing +15 new), zero failures/skips, exit 0. TypeScript `--noEmit --incremental false`: exit 0. Repository ESLint: exit 0, only the pre-existing unused `targetType` warning in `checkout-prerequisites.test.cjs`. `git diff --check` passes; no index/commit changes.

Root integration independently reproduced RED against the unchanged presentation module: all 12 dedicated slug assertions failed and all 3 healthy controls passed. The exact reviewed source/test bytes were then imported together with the two existing test-adapter updates. The combined focused category/privacy/SEO/UI run passed 85/85. Root physically bypassed the dedicated lookup and again observed 12 failures/3 healthy controls, then restored the source and independently verified the exact SHA256 above before running the combined full suite.

This Node adapter proves the source rendering/route-data contract, not fresh Next HTTP/browser execution. No new browser GREEN/build is claimed here; the fresh combined build and ordinary browser navigation delta remain separately verified integration steps. The separate category-parent tree remains frozen and is not included in the worker's 699-test count.
