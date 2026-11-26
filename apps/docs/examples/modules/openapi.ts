import { setTimeout } from "node:timers/promises";

import { createAuth } from "@crustjs/auth";
import { type ContextMap, Crust, defineCommand, defineContext } from "@crustjs/core";
import { confirm } from "@crustjs/extensions";
import { type ApiClient, type Specs, bearerAuth, defineApi } from "@crustjs/openapi";

//#region cli
const api = defineApi({
	// The pinned OpenAPI document, kept out of the bundle.
	spec: new URL("./acme.openapi.jsonc", import.meta.url),
	baseUrl: "https://api.acme.example/v1",
	// The next page from a `Link: <url>; rel="next"` header; undefined after the last page.
	paginate: (response) => {
		const next = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get("link") ?? "")?.[1];
		return next === undefined ? undefined : { path: next };
	},
}).auth(() => ({ Authorization: `Bearer ${process.env.ACME_TOKEN}` }));

// Your own command, with the client of `api`'s `.auth()`, which the handles after it share.
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

//#region profile
// `--profile <name>` on the commands that send requests picks the login; without it, the current profile.
const profile = defineContext("profile")
	.flags({ profile: { type: "string", description: "The profile to use" } })
	.setup(({ flags }) => flags.profile);

const accounts = createAuth({
	app: "acme",
	issuer: "https://login.acme.example",
	clientId: "acme-cli",
	apiOrigins: ["https://api.acme.example"],
	profiles: {},
});

const profiled = defineApi({
	spec: new URL("./acme.openapi.jsonc", import.meta.url),
	baseUrl: "https://api.acme.example/v1",
})
	.use(profile)
	.auth(
		bearerAuth(async ({ ctx, signal, baseUrl }) =>
			accounts.profile(await ctx.profile).token({ signal, baseUrl }),
		),
	);

// The app provides the Context before the Extension whose client reads it.
export const profiledCli = new Crust("acme")
	.provide(profile())
	.extend(profiled.extension)
	.add(...profiled.commands);
//#endregion

//#region helper
// Generic in the Contexts the client's `auth` reads, so it takes the client of any `.auth()`.
export async function userName<AuthDeps extends ContextMap>(
	client: ApiClient<Specs["acme"]["operations"], AuthDeps>,
): Promise<string> {
	return (await client.call("getUser", { path: { id: "me" } })).name;
}
//#endregion

//#region own-fetch
// The app's own rule: wait out a 429 that gives `Retry-After` in seconds, up to three tries.
// Only a request without a body is sent again, since the first try may have read a streamed one.
const patient = async (input: URL, init: RequestInit): Promise<Response> => {
	for (let attempt = 1; ; attempt++) {
		const response = await fetch(input, init);
		const retryAfter = response.headers.get("retry-after") ?? "";
		const wait = /^\d+$/.test(retryAfter) ? Number(retryAfter) : Infinity;
		if (response.status !== 429 || attempt === 3 || init.body != null || wait > 30) return response;
		await response.body?.cancel();
		await setTimeout(wait * 1000, undefined, { signal: init.signal ?? undefined });
	}
};

export const patientApi = defineApi({
	spec: new URL("./acme.openapi.jsonc", import.meta.url),
	baseUrl: "https://api.acme.example/v1",
	fetch: patient,
	// Credentials stay in `.auth()`, which keeps them on the API's origin.
}).auth(() => ({ Authorization: `Bearer ${process.env.ACME_TOKEN}` }));
//#endregion

//#region unwrap
// For an API that wraps every result as `{ "result": … }`: `body` is `unknown`, so cast it.
export const unwrapped = api.each(() => ({
	unwrap: (body) => (body as { result: unknown }).result,
}));
//#endregion

//#region curated
// Only the listed operations become commands; the others stay reachable with `api <path>`.
const keep = new Set(["getUser", "deleteUser"]);
export const curated = api.each((op) => ({ exclude: !keep.has(op.id) }));
//#endregion

//#region read-only
// No command that writes. `undefined` keeps the default, so deprecated operations stay out.
export const readOnly = api.each((op) => ({ exclude: op.method !== "get" || undefined }));
//#endregion

//#region start-empty
// On a large spec: no command at first, then one operation at a time.
export const grown = api.each(() => ({ exclude: true })).override({ getUser: { exclude: false } });
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
