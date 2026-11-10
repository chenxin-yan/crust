import { createRootRoute, createRouter } from "@tanstack/react-router";
import { expect, it } from "vite-plus/test";

import { startInstance } from "../src/start";

const origin = "https://crustjs.com";

/** Run the request middleware like Start does: a thrown redirect is resolved by the request's router. */
async function requestLocation(pathname: string): Promise<string | null> {
	const { requestMiddleware = [] } = await startInstance.getOptions();
	const router = createRouter({ routeTree: createRootRoute(), origin });
	const request = new Request(new URL(pathname, origin));
	for (const middleware of requestMiddleware) {
		try {
			await middleware.options.server?.({ request, next: () => undefined } as never);
		} catch (thrown) {
			return router.resolveRedirect(thrown as never).headers.get("Location");
		}
	}
	return null;
}

it.each([
	["/docs.mdx", "/llms.mdx/docs"],
	["/docs/quick-start.mdx", "/llms.mdx/docs/quick-start"],
	["/docs/modules/extensions/help.mdx", "/llms.mdx/docs/modules/extensions/help"],
])("redirects %s to its Markdown route", async (pathname, location) => {
	expect(await requestLocation(pathname)).toBe(location);
});

it("passes page requests through", async () => {
	expect(await requestLocation("/docs/quick-start")).toBeNull();
});
