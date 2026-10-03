import type { MetadataRoute } from "next";
import { COMPANY } from "@/lib/brand";

// The public site is indexable; the app, auth screens and API are not.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/pricing", "/contact", "/terms", "/privacy", "/refund-policy", "/shipping-policy", "/data-deletion"],
      disallow: [
        "/api/",
        "/admin",
        "/dashboard",
        "/inbox",
        "/contacts",
        "/pipelines",
        "/broadcasts",
        "/automations",
        "/flows",
        "/agents",
        "/notifications",
        "/whatsapp",
        "/integrations",
        "/settings",
        "/join/",
        "/login",
        "/signup",
        "/forgot-password",
      ],
    },
    sitemap: `${COMPANY.siteUrl}/sitemap.xml`,
  };
}
