const productionSiteUrl = "https://xn----9sbphbgks4a4a.xn--p1ai";

export function getPublicSiteUrl() {
  const env = process.env;
  return (env.NEXT_PUBLIC_SITE_URL?.trim() || env.SITE_URL?.trim() || productionSiteUrl).replace(/\/$/, "");
}
