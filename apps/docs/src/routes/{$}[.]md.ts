import { createFileRoute } from "@tanstack/react-router";

import { docsLlms } from "@/lib/source";

// `/docs/{$}.md` only matches below `/docs/`; this serves `/docs.md`, the docs index page.
export const Route = createFileRoute("/{$}.md")({
	server: {
		handlers: {
			GET: async ({ request }) =>
				(await docsLlms.serve(new URL(request.url).pathname)) ??
				new Response(null, { status: 404 }),
		},
	},
});
