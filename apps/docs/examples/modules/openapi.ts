import { Crust, defineCommand } from "@crustjs/core";
import { defineApi } from "@crustjs/openapi";

//#region cli
const acme = defineApi({
	// The pinned OpenAPI document, kept out of the bundle.
	spec: new URL("./acme.openapi.jsonc", import.meta.url),
	baseUrl: "https://api.acme.example/v1",
	auth: () => ({ Authorization: `Bearer ${process.env.ACME_TOKEN}` }),
	// The next page from a `Link: <url>; rel="next"` header; undefined after the last page.
	paginate: (response) => {
		const next = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get("link") ?? "")?.[1];
		return next === undefined ? undefined : { path: next };
	},
});

const whoami = defineCommand("whoami", { description: "Print the signed-in user" }, (command) =>
	command.use(acme.client).action(async ({ ctx, stdout }) => {
		const api = await ctx.api;
		const user = await api.call("getUser", { path: { id: "me" } });
		stdout(user.name);
	}),
);

await new Crust("acme").extend(acme.extension).add(whoami).execute();
//#endregion

// What inspex registers from acme.openapi.jsonc, for this docs site, which runs no content mapper.
declare module "@crustjs/openapi" {
	interface Specs {
		acme: {
			paths: {};
			components: {};
			operations: {
				getUser: {
					parameters: { query?: never; header?: never; path: { id: string }; cookie?: never };
					requestBody?: never;
					responses: {
						200: {
							headers: { [name: string]: unknown };
							content: { "application/json": { id: string; name: string } };
						};
					};
				};
			};
		};
	}
}
