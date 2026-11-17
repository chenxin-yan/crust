import { Crust, defineCommand } from "@crustjs/core";
import { confirm } from "@crustjs/extensions";
import { defineApi } from "@crustjs/openapi";
import { input, select } from "@crustjs/prompts";

//#region cli
const api = defineApi({
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

// Your own command, with the client every handle of `api` shares.
const whoami = defineCommand("whoami", { description: "Print the signed-in user" }, (command) =>
	command.use(api.client).action(async ({ ctx, stdout }) => {
		const client = await ctx.api;
		const user = await client.call("getUser", { path: { id: "me" } });
		stdout(user.name);
	}),
);

const acme = api
	// Every generated command uses `confirm`, which types `ctx` below.
	.use(confirm)
	.onConfirm(async (ctx, message) => (await ctx.confirm)(message))
	// On a terminal, asks for a required value the command was not given.
	.onMissing((field) =>
		field.choices
			? select({ message: field.name, choices: field.choices })
			: input({ message: field.name }),
	)
	// A command per operation, in its first tag's group: `acme users get-user <id>`.
	.each((op) => ({ name: op.id === "getUser" ? "get" : undefined }))
	.override({
		deleteUser: {
			expect: { method: "DELETE", path: "/users/{id}" },
			name: "delete",
			confirm: "Delete this user?",
		},
	})
	// Beside the generated commands: `acme users whoami`.
	.add("users", whoami);

await new Crust("acme")
	.extend(confirm(), acme.extension)
	.add(...acme.commands)
	.execute();
//#endregion

//#region unwrap
// For an API that wraps every result as `{ "result": … }`: `body` is `unknown`, so cast it.
export const unwrapped = api.each(() => ({
	unwrap: (body) => (body as { result: unknown }).result,
}));
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
				deleteUser: {
					parameters: { query?: never; header?: never; path: { id: string }; cookie?: never };
					requestBody?: never;
					responses: { 204: { headers: { [name: string]: unknown }; content?: never } };
				};
			};
		};
	}
}
