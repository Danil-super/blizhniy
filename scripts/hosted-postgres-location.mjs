export function matchesHostedPostgresLocation(env) {
  const placement = env.BLIZHNIY_DB_PLACEMENT;
  if (placement !== undefined && placement !== "same-host") return false;
  const host = placement === "same-host" ? "127.0.0.1" : "17e86f80f26733d39ef4b84d.twc1.net";
  return env.BLIZHNIY_DB_HOST === host && env.BLIZHNIY_DB_PORT === "5432";
}
