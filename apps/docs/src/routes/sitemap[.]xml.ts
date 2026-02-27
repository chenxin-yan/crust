import { createFileRoute } from "@tanstack/react-router";
import { absoluteUrl } from "@/lib/seo";
import { source } from "@/lib/source";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const pages = source.getPages();
        const urls = [
          // Homepage
          `  <url>
    <loc>${absoluteUrl("/")}</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>`,
          // Docs index
          `  <url>
    <loc>${absoluteUrl("/docs")}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>`,
          // All docs pages
          ...pages.map(
            (page) => `  <url>
    <loc>${absoluteUrl(page.url)}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`,
          ),
        ];

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600, s-maxage=86400",
          },
        });
      },
    },
  },
});
