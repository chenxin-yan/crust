import { createFileRoute } from "@tanstack/react-router";
import { absoluteUrl } from "@/lib/seo";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async () => {
        const body = `User-agent: *
Allow: /

# Disallow internal API and LLM mirror endpoints
Disallow: /api/
Disallow: /llms.txt
Disallow: /llms-full.txt
Disallow: /llms.mdx/

Sitemap: ${absoluteUrl("/sitemap.xml")}
`;

        return new Response(body, {
          headers: {
            "Content-Type": "text/plain",
            "Cache-Control": "public, max-age=3600, s-maxage=86400",
          },
        });
      },
    },
  },
});
