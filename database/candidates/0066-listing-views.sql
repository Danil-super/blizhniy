-- Candidate for installations with listing moderation (0026). Grants are installed separately.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

create schema app_stats;
revoke all on schema app_stats from public;
create table app_stats.listing_views (
 listing_id uuid not null references app.listings(id) on delete cascade,
 viewer_digest bytea not null check (octet_length(viewer_digest) = 32),
 primary key (listing_id, viewer_digest)
);

revoke all on app_stats.listing_views from public;

create function app_stats.record_listing_view(target uuid, viewer bytea, postmoderation boolean)
returns integer language plpgsql security definer strict set search_path = pg_catalog, pg_temp as $$
declare
 total integer;
begin
 if octet_length(viewer) <> 32 then raise exception 'invalid viewer digest'; end if;
 select l.view_count into total
 from app.listings l
 join app.users u on u.id=l.author_id and not u.is_blocked and u.email_verified_at is not null
 join app.categories c on c.id=l.category_id and c.active
 left join app.categories parent on parent.id=c.parent_id
 where l.id=target and l.status='published' and l.is_paid
  and l.published_at<=clock_timestamp() and l.expires_at>clock_timestamp()
  and (c.parent_id is null or parent.active is true)
  and not exists(select 1 from app.listing_blocks b where b.listing_id=l.id)
  and (postmoderation or exists(select 1 from app.listing_moderation m
        where m.listing_id=l.id and m.revision=l.revision and m.state='approved'))
 for no key update of l;
 if not found then return null; end if;
 insert into app_stats.listing_views(listing_id,viewer_digest) values(target,viewer) on conflict do nothing;
 if found and total < 2147483647 then
  update app.listings set view_count=view_count+1 where id=target returning view_count into total;
 end if;
 return total;
end;
$$;
revoke all on function app_stats.record_listing_view(uuid,bytea,boolean) from public;
commit;
