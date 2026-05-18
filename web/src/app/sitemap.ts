import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/constants";

export default function sitemap(): MetadataRoute.Sitemap {
  const today = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: today, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/login`, lastModified: today, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/politica-privacidade`, lastModified: today, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/termos`, lastModified: today, changeFrequency: "yearly", priority: 0.3 },
  ];
}
