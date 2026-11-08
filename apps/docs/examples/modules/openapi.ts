import { Crust, defineCommand } from "@crustjs/core";
import { apiClient, apiCommand } from "@crustjs/openapi";

// Usually the API's OpenAPI document: `import spec from "./openapi.json" with { type: "json" }`.
const spec = {
	openapi: "3.1.0",
	info: { title: "Example API", version: "1.0.0" },
	paths: {
		"/users": { get: { operationId: "listUsers", summary: "List users" } },
	},
};

const app = new Crust("my-cli")
	.extend(
		apiCommand({
			spec,
			baseUrl: "https://api.example.com/v1",
			auth: () => ({ Authorization: `Bearer ${process.env.EXAMPLE_TOKEN}` }),
			// The next page from a `Link: <url>; rel="next"` header; undefined after the last page.
			paginate: (response) => {
				const next = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get("link") ?? "")?.[1];
				return next === undefined ? undefined : { path: next };
			},
		}),
	)
	.add(
		// App commands share the same base URL and auth through the `api` Context.
		defineCommand("whoami", { description: "Print the signed-in user" }, (command) =>
			command.use(apiClient).action(async ({ ctx, stdout }) => {
				const api = await ctx.api;
				const response = await api.fetch("/me");
				stdout(((await response.json()) as { login: string }).login);
			}),
		),
	);

await app.execute();
