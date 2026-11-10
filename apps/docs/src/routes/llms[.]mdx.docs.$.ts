import { createFileRoute } from "@tanstack/react-router";

import { source } from "@/lib/source";

export const Route = createFileRoute("/llms.mdx/docs/$")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const slugs = params._splat?.split("/") ?? [];
				const page = source.getPage(slugs);
				// Start answers a `notFound()` thrown from a server handler with a 500.
				if (!page) return new Response("Not Found", { status: 404 });

				return new Response(await page.data.getText("processed"), {
					headers: {
						"Content-Type": "text/markdown",
					},
				});
			},
		},
	},
});
