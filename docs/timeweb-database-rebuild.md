# Database rebuild on a separate Timeweb test environment

This is an inventory and a release gate, **not** an approved migration replay. The inventory pins repository commit `f8c906e` and the connected database's 59 migration rows on 27 September 2026. The connected database was only queried; this change does not modify it. Never point these commands at the existing live database.

## What blocks a clean replay today

Run `node scripts/check-migration-history.mjs`. It deliberately exits nonzero:

- Of 59 applied versions, 8 have no SQL file in that repository snapshot. Four are historical marker queries; three belong to pending auth PRs (#38, #39 and #43); `20260927082317_add_ad_marquee_payment_fk_index_20260927` is also absent.
- 22 corresponding files differ from `supabase_migrations.schema_migrations.statements[1]` beyond a trailing newline. 23 differ only by the trailing newline, and 6 match exactly. For example, the **first** applied `security_and_fk_indexes` used `public.has_role`/`public.is_admin`; its current eight-digit file uses `private.*`, which did not exist until a later migration. The same security migration name occurs twice with different versions, both pointing to that one repository file.
- Two SQL files have no history row: `20260710_clean_catalog_categories.sql` (updates and deletes category rows) and `20260926074500_restrict_raw_vacancy_reads.sql`. Do not silently insert either into the historical replay or mark it applied.
- Eight-digit source filenames and their lexicographic order do not encode the 14-digit execution versions. The archived `docs/SUPABASE_SETUP.md` and `README.md` base SQL list are insufficient to recreate current Auth, Storage, roles, RLS and later changes.

`docs/migration-history-snapshot.json` records each actual version and name in order, the mapped source file and its Git blob SHA, and MD5 of the SQL actually applied. A `missing` or `divergent` entry requires investigation, not a blind rename or `migration repair` command. New merges require a fresh inventory and review.

## Exact applied SQL archive

`docs/applied-migrations-2026-09-27.json` separately preserves the exact SQL text, order, names and MD5 hashes of **64** migration rows queried from the connected database on 27 September 2026 at 09:15 UTC, with repository commit `fbdb88184aa6aad0664917b2bd5bb46b296b38a2` recorded as the source snapshot. It includes five rows added after the 59-row source comparison above. The archive contains SQL and therefore belongs in `docs/`, never in `supabase/migrations/`: neither Supabase CLI nor an operator should execute it as a migration. It was checked for URLs, email addresses and common credential strings before committing. That screening is not a guarantee that arbitrary historical SQL is safe to execute.

`node scripts/verify-applied-migration-archive.mjs` checks ordering and every archived statement's MD5. Given a fresh metadata-only export from the connected project, it also detects subsequent migration rows or changed statements:

```sh
psql "$DATABASE_URL" -X -A -t -F '|' -c \
  'select version,name,md5(statements[1]) from supabase_migrations.schema_migrations order by version' \
  > /tmp/blizhniy-applied-migration-hashes.txt
node scripts/verify-applied-migration-archive.mjs --history /tmp/blizhniy-applied-migration-hashes.txt
```

The first archived statement modifies tables and RLS policies that already existed before the first recorded migration. Consequently, even this exact history cannot build an empty database. Obtain a reviewed baseline schema and platform configuration, then test a coherent bootstrap plus later migrations in a disposable instance. Keep the 59-row source comparison as a historical record of repository drift at commit `f8c906e`; do not treat it as the current row count.

## Safe path to a reproducible deployment

1. Provision an **isolated** Supabase-compatible test environment on Timeweb. Deploy Auth, PostgREST/Data API, Storage, database roles and the application as a coherent stack. Confirm its region, resource plan, supported versions, backups and logs with the operator. Keep its keys and network endpoints separate from the connected project.
2. Freeze a repository commit and obtain a schema-only backup, global roles/grants and platform configuration from the existing project through approved administrative export tooling. A schema-only `pg_dump` does **not** contain Supabase Auth settings, Storage objects, roles, all platform services or uploaded files. Never infer the missing historical SQL from filenames. Review the exact applied statements in the archive before considering an immutable, versioned replay. Alternatively generate an audited baseline from a known good schema, with an explicit cutoff and migration-history strategy; test it from empty state. Do not apply both the baseline and its included historical migrations.
3. On a newly provisioned, disposable test database only, rehearse either the corrected **ordered** historical migrations after a compatible bootstrap, or the reviewed baseline followed exclusively by migrations newer than its cutoff. Capture commands, input hashes, failures and schema diffs. Restore again into a second empty instance to prove repeatability. Do not set `supabase_migrations.schema_migrations` rows by hand merely to satisfy a CLI check.
4. Run `scripts/smoke-schema-grants.sql` through `psql -X -v ON_ERROR_STOP=1 -f scripts/smoke-schema-grants.sql` on that **test** database. It checks core RLS, browser write privileges on paid publication, payment, specialist, booking and organization profile tables, browser `MAINTAIN` and unsafe table privileges, the specialist publication guard and the view RPC. It is read-only and was run against the connected schema on 27 September without error. It cannot prove that each RLS `WITH CHECK` expression is correct.
5. Use synthetic Auth users and actual anon/authenticated Data API keys to test direct INSERT/UPDATE attempts setting `published`, `is_paid`, `payment_status=succeeded` and future `expires_at` for listings, vacancies, orders, fair applications and specialists. Test ownership separation, private location/contacts, Storage policies, registration and deletion flows, booking concurrency, then payment idempotency and provider sandbox/webhooks. Confirm ordinary service-role draft writes still work. Negative results must be independently recorded before release.
6. Only after a clean, repeatable staging rebuild and a reviewed backup/rollback procedure, plan the production cutover. Stop old payment workers/routes before applying PR #40's atomic payment migration and deploying matching code; a mixed old-worker/new-schema rollout is unsafe. Keep `#40` and any post-snapshot SQL **out** of the historical inventory until their own migration order is verified.

To compare a database's ordered history with the snapshot (metadata only), run on an **isolated test environment**:

```sh
psql "$TEST_DATABASE_URL" -X -A -t -F '|' -c \
  'select version,name from supabase_migrations.schema_migrations order by version' \
  > /tmp/blizhniy-migration-history.txt
node scripts/check-migration-history.mjs --history /tmp/blizhniy-migration-history.txt
```

The validator should remain blocked until the gaps are resolved and a clean rebuild has been demonstrated. A green local Next.js build or a green structural smoke check alone is not a release approval.
