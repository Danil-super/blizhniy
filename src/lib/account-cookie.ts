export const accountSessionCookieName = "__Host-blizhniy_session";

export function createAccountSessionCookie(token: string, maxAge: number): string {
  if (typeof window !== "undefined" || !Number.isInteger(maxAge) || maxAge < 0 || maxAge > 8*3600 ||
      (maxAge === 0 ? token !== "" : !/^[a-f0-9]{64}$/.test(token))) throw new Error("Invalid session cookie");
  const expiry = maxAge === 0 ? new Date(0) : new Date(Date.now()+maxAge*1000);
  return `${accountSessionCookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}; Expires=${expiry.toUTCString()}`;
}

/** One canonical HttpOnly cookie only; body/query/Bearer are never authority. */
export function readAccountSessionToken(request: Request): string | null {
  const header = request.headers.get("cookie") ?? "";
  if (header.length > 4096) return null;
  const matches = header.split(";").map(part => part.trim()).filter(part => part.startsWith(`${accountSessionCookieName}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(accountSessionCookieName.length+1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
