-- Keep extension objects out of the API-facing public schema.
alter extension btree_gist set schema extensions;