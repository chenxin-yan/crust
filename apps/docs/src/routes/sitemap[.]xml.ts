import { createFileRoute } from "@tanstack/react-router";
import { absoluteUrl } from "@/lib/seo";
import { source } from "@/lib/source";

function escapeXml(str: string): string {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&apos;")
    .replaceAll('"', "&quot;");
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const pages = source.getPages();
        const urls = [
          // Homepage
          `  <url>
    <loc>${escapeXml(absoluteUrl("/"))}</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>`,
          // Docs index
          `  <url>
    <loc>${escapeXml(absoluteUrl("/docs"))}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>`,
          // All docs pages
          ...pages.map((page) => {
            const lastmod =
              "lastModified" in page.data &&
              page.data.lastModified instanceof Date
                ? `\n    <lastmod>${formatDate(page.data.lastModified)}</lastmod>`
                : "";
            return `  <url>
    <loc>${escapeXml(absoluteUrl(page.url))}</loc>${lastmod}
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`;
          }),
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
