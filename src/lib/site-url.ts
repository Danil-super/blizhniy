const productionSiteUrl = "https://xn----9sbphbgks4a4a.xn--p1ai";

export function getPublicSiteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.SITE_URL?.trim() || productionSiteUrl).replace(/\/$/, "");
}

