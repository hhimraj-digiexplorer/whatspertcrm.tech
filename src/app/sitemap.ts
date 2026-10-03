import type { MetadataRoute } from "next";
import { COMPANY } from "@/lib/brand";

const PAGES = ["", "/pricing", "/contact", "/terms", "/privacy", "/refund-policy", "/shipping-policy", "/data-deletion"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((path) => ({
    url: `${COMPANY.siteUrl}${path}`,
    changeFrequency: path === "" || path === "/pricing" ? "weekly" : "yearly",
    priority: path === "" ? 1 : path === "/pricing" ? 0.9 : 0.4,
  }));
}
