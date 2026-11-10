import { redirect } from "@tanstack/react-router";
import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { rewritePath } from "fumadocs-core/negotiation";

const csrfMiddleware = createCsrfMiddleware({
	filter: (ctx) => ctx.handlerType === "serverFn",
});

const llmRewriter = rewritePath("/docs{/*path}.mdx", "/llms.mdx/docs{/*path}");

const llmMiddleware = createMiddleware().server(({ next, request }) => {
	const url = new URL(request.url);
	const path = llmRewriter.rewrite(url.pathname);

	if (path) {
		// The router rewrites `href` on the options it is given, so pass a string, not the `URL`.
		throw redirect({ href: new URL(path, url).href });
	}

	return next();
});

export const startInstance = createStart(() => {
	return {
		requestMiddleware: [csrfMiddleware, llmMiddleware],
	};
});
