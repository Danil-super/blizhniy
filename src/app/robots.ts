import type { MetadataRoute } from "next";
import { getPublicSiteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  const base = getPublicSiteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin", "/auth", "/cabinet", "/oplata", "/api",
          "/rabota/vakansii/sozdat", "/rabota/zakazy/sozdat", "/rabota/specialisty/anketa",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
