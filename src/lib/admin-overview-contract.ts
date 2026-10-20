export type AdminOverview = {
  users: {total: number; blocked: number};
  publications: {total: number; awaitingReview: number};
  tariffs: {total: number; active: number};
  adMarquee: {total: number; awaitingReview: number};
};
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) throw Error('Invalid overview');
  return value as Record<string, unknown>;
}
export function parseAdminOverview(value: unknown): AdminOverview {
  const row = exact(value, ['users', 'publications', 'tariffs', 'adMarquee']);
  function metric(value: unknown, subset: string) {
    const result = exact(value, ['total', subset]);
    if (!Object.values(result).every(count => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) ||
      (result[subset] as number) > (result.total as number)) throw Error('Invalid overview');
    return result as Record<string, number>;
  }
  const users = metric(row.users, 'blocked'), publications = metric(row.publications, 'awaitingReview');
  const tariffs = metric(row.tariffs, 'active'), adMarquee = metric(row.adMarquee, 'awaitingReview');
  return {users: {total: users.total, blocked: users.blocked}, publications: {total: publications.total, awaitingReview: publications.awaitingReview},
    tariffs: {total: tariffs.total, active: tariffs.active}, adMarquee: {total: adMarquee.total, awaitingReview: adMarquee.awaitingReview}};
}
