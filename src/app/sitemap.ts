import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://blizhniy.example";

  return [
    "",
    "/krasnodarskiy-kray",
    "/krasnodar",
    "/krasnodar/rabota",
    "/krasnodar/rabota/vakansii",
    "/krasnodar/rabota/specialisty",
  ].map((path) => ({
    url: `${base}${path}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: path === "" ? 1 : 0.7,
  }));
}
