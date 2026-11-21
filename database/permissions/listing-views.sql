begin;
grant usage on schema app_stats to blizhniy_runtime;
grant execute on function app_stats.record_listing_view(uuid,bytea,boolean) to blizhniy_runtime;
commit;
