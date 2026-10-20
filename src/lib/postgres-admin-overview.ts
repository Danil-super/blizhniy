import {withAppSessionTransaction} from './app-session-transaction';
import {AdminAccessError} from './admin-authorization';
import {parseListingDraftId} from './listing-draft-contract.ts';
import {parseAdminOverview} from './admin-overview-contract.ts';
import type {PostgresDatabase} from './postgres';

/** Inventory includes blocked owners; actionable queues use the exact current revision and live owner policy. */
export class PostgresAdminOverviewStore {
  private readonly db: Pick<PostgresDatabase, 'transaction'>;
  constructor(db: Pick<PostgresDatabase, 'transaction'>) {this.db = db;}
  async read(token: string, expectedAdminId: string) {
    const expected = parseListingDraftId(expectedAdminId);
    return withAppSessionTransaction(this.db, token, async (tx, principal) => {
      if (principal.id !== expected) throw new AdminAccessError();
      const {rows: [row]} = await tx.query<Record<string, string>>(`select
        (select count(*) from app.users)::text as users_total,
        (select count(*) from app.users where is_blocked)::text as users_blocked,
        ((select count(*) from app.listings)+(select count(*) from app.work_publications where deleted_at is null)
          +(select count(*) from app.service_publications where kind<>'marquee' and deleted_at is null))::text as publications_total,
        ((select count(*) from app.listings l join app.listing_moderation m on m.listing_id=l.id and m.revision=l.revision
            join app.users u on u.id=l.author_id where m.state='pending' and l.status='draft' and not u.is_blocked and u.email_verified_at is not null)
          +(select count(*) from app.work_publications p join app.work_moderation m on m.publication_id=p.id and m.revision=p.revision
            join app.users u on u.id=p.author_id where m.state='pending' and p.deleted_at is null and p.author_id<>$1
            and not u.is_blocked and u.email_verified_at is not null)
          +(select count(*) from app.service_publications p join app.service_moderation m on m.publication_id=p.id and m.revision=p.revision
            join app.users u on u.id=p.author_id where m.state='pending' and p.deleted_at is null and p.kind<>'marquee' and p.author_id<>$1
            and not u.is_blocked and u.email_verified_at is not null))::text as publications_awaiting,
        (select count(*) from app.tariffs)::text as tariffs_total,
        (select count(*) from app.tariffs where active)::text as tariffs_active,
        (select count(*) from app.service_publications where kind='marquee' and deleted_at is null)::text as marquee_total,
        (select count(*) from app.service_publications p join app.service_moderation m on m.publication_id=p.id and m.revision=p.revision
          join app.users u on u.id=p.author_id where p.kind='marquee' and p.deleted_at is null and m.state='pending' and p.author_id<>$1
          and not u.is_blocked and u.email_verified_at is not null)::text as marquee_awaiting`, [principal.id]);
      if (!row) throw Error('Overview unavailable');
      return parseAdminOverview({users: {total: Number(row.users_total), blocked: Number(row.users_blocked)},
        publications: {total: Number(row.publications_total), awaitingReview: Number(row.publications_awaiting)},
        tariffs: {total: Number(row.tariffs_total), active: Number(row.tariffs_active)},
        adMarquee: {total: Number(row.marquee_total), awaitingReview: Number(row.marquee_awaiting)}});
    }, {requireAdmin: true, denied: () => new AdminAccessError()});
  }
}
