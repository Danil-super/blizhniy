export const accountSessionCookieName = "__Host-blizhniy_session";

/** One canonical HttpOnly cookie only; body/query/Bearer are never authority. */
export function readAccountSessionToken(request: Request): string | null {
  const header = request.headers.get("cookie") ?? "";
  if (header.length > 4096) return null;
  const matches = header.split(";").map(part => part.trim()).filter(part => part.startsWith(`${accountSessionCookieName}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(accountSessionCookieName.length+1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
