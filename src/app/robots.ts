import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/cabinet", "/oplata", "/api"],
      },
    ],
    sitemap: "https://blizhniy.example/sitemap.xml",
  };
}
