# Stored listing category parent identity

Scope: functional remediation on base `adcec4a5c6e369e72f3ace7fc0c5537793a220d4`, not a new security scan. Only `listing-store.ts`, its focused regression test and this document change. No database migration, dependency, owner/auth/payment logic or production write.

## Cause and contract

The public browser baseline at `0dd0058` failed `/katalog/raznoe` at four widths. Its synthetic listing `00001399-1111-4111-8111-000000005017` correctly references the DB child whose parent is the `raznoe` root. `resolveCategoryInfo` instead chose the first static category containing the child's display name `Разное`: clothing. The page's category filter consequently removed the valid listing. Repeated display names are legitimate and remain unchanged.

`supabase/schema.sql` defines `categories.parent_id` as a foreign key to `categories(id)`. Mapping now resolves that exact ID, including parents absent from the static catalogue. Top-level rows retain their own slug. Missing category metadata retains the existing listing-kind fallback. An unavailable parent keeps the stored child's slug; it never guesses a root from a display name. A failed lookup may therefore prevent a correctly-root-filtered category page from including the row until the lookup recovers, but does not erase readable listing/detail data or misclassify it into an unrelated root.

The proposed recursive self-embed was rejected before any implementation: [PostgREST recursive-relationships documentation](https://docs.postgrest.org/en/stable/references/api/resource_embedding.html#recursive-relationships) requires computed relationships. This slice uses ordinary filtered category reads and adds no DDL.

## Bounded transport

After the existing listing read (including its existing `view_count` compatibility fallback), the store deduplicates referenced parent IDs. Canonical 8-4-4-4-12 UUID structure is checked without restricting UUID version/variant: the listing-ID validator would wrongly discard valid PostgreSQL UUID values. Malformed legacy metadata issues no lookup. The store requests only `id,slug` for valid IDs in fixed chunks of 100, with `limit` equal to each chunk's actual size and one transport attempt per chunk. No IDs are sliced away; 201 distinct parents use 100/100/1 requests. A normal page with repeated parent IDs adds one GET; rows without parents add none. URLs remain roughly 4 KB per chunk rather than 37 KB for 1,000 UUIDs. Existing listing pagination/owner filters remain unchanged; work scales with distinct parents in that result, not an unrestricted taxonomy read or one lookup per listing.

Parent failures are caught separately, logged and do not trigger a `view_count` fallback/retry. Successful other chunks remain usable. The internal parent field is only mapping context, not a new public DTO field. The existing map/privacy/media logic is unchanged. Reusable draft/payment readers keep their original no-view-count selection; raw create/update/save response fallback mapping resolves the parent lazily only when the normal detail re-read is unavailable.

## Verification

Tests execute the entire actual listing-store and recursively loaded source dependencies, including the real REST helper, media and booking modules. Only `fetch` is replaced by a synthetic, query-filtered transport; its default mode permits GET only. Three explicitly opt-in raw-response cases capture precisely scoped synthetic listing POST/PATCH and the update path's existing listing-images DELETE, assert owner/target/body and return fixture responses without any network or persistence. There is no source-function extraction, copied mapper, live Supabase access, credential reading or database write.

- Original RED on unchanged source: 17 tests, 13 expected wrong-parent failures and 4 healthy controls. The subsequently added exact browser-slug case also failed (18 tests: 14 failures/4 controls).
- Batch-contract RED on still-unchanged source: 21 tests, 16 failures and 5 healthy controls, including complete 201-parent coverage and readable lookup-failure fallback.
- Additional UUID-edge RED before the one-filter correction: valid UUID v7/nonstandard variant lost its parent (1 failure), invalid metadata and three raw-response fallback controls passed. GREEN now includes both original browser slug and root independently verified DB child slugs `raznoe-raznoe` and `odezhda-obuv-aksessuary-raznoe`.
- Final GREEN: 28/28 focused new cases; 58/58 combined with category scope/query and public listing/work privacy tests. Healthy controls include clothing, top-level and missing metadata, owner location and public opted-in location. The missing-view-count path preserves parent mapping, image order/URL encoding and hidden public coordinates. Parent error controls include HTTP 500 and an error mentioning `view_count`: neither produces extra listing reads or parent retries. A failure specifically in the first 100-parent chunk retains all 201 rows/media/location policy and permits the later 100/1 chunks to resolve correctly, for both public and owner reads.
- Actual on-disk first-static-name mapper mutant: initially 16 failures/5 controls passed; repeated on the expanded 27-case suite, 22 failures/5 controls passed, exit 1. Actual first-chunk-only mutant: final-row assertion failed (`child-200` instead of `custom-root-200`) while the clothing control passed, exit 1. The final partial-failure control was added afterward; all tests then reran on the restored source.
- Both mutants restored exactly; final source SHA256 `4a43086d1faba2fe80746b6199d10d83ef96189fa9b7a35711b6ffb3fbe469da`.
- Final full Node 22.23.1 isolated suite: 712/712 (=684 existing +28 new), zero failures/skips, exit 0. TypeScript `--noEmit --incremental false`: exit 0. Repository ESLint: exit 0, only the pre-existing unused `targetType` warning in `checkout-prerequisites.test.cjs`.

Command for the focused source-graph regression:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin /home/danil/.cache/blizhniy-node22-pxyRwP/node --experimental-strip-types --test --test-reporter=spec tests/listing-category-parent.test.mjs
```

Root integration independently reproduced RED against unchanged `adcec4a`: 23 wrong-parent/batch-contract failures and 5 healthy controls across all 28 final cases. The exact reviewed source/test/document bytes were then imported. A combined focused run with the separate breadcrumb correction and existing category/privacy/UI checks passed 85/85. Root physically restricted the parent loop to its first 100-ID chunk: the 201st-row assertion failed (`child-200` instead of `custom-root-200`), while the clothing control passed. The loop was restored and source SHA256 rechecked against the value above before the combined full-suite run.

Limits: this synthetic transport validates the module/query contract, not a live PostgREST deployment. No app build/server or browser GREEN is claimed here. The fresh combined build and four-width `/katalog/raznoe` delta remain separately verified integration steps; the earlier browser failure remains the RED evidence.
