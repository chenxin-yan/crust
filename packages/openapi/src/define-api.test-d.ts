import { type ContextMap, Crust, defineCommand, defineContext } from "@crustjs/core";
import { confirm, help } from "@crustjs/extensions";

import { type ApiClient, bearerAuth, defineApi } from "./index.ts";
import type { SpecOperationsOf } from "./typed-client.ts";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

interface User {
	id: string;
	name: string;
	email?: string | null;
}
type NoParameters = { query?: never; header?: never; path?: never; cookie?: never };

// The shapes inspex registers: openapi-typescript's `operations`, keyed by operationId.
interface AcmeOperations {
	getUser: {
		parameters: {
			query?: { expand?: boolean };
			header?: { "X-Request-Id"?: string };
			path: { id: string };
			cookie?: never;
		};
		requestBody?: never;
		responses: {
			200: { headers: { [name: string]: unknown }; content: { "application/json": User } };
			404: {
				headers: { [name: string]: unknown };
				content: { "application/json": { message: string } };
			};
		};
	};
	listUsers: {
		parameters: {
			query?: { role?: "admin" | "member" };
			header?: never;
			path?: never;
			cookie?: never;
		};
		requestBody?: never;
		responses: {
			200: { headers: { [name: string]: unknown }; content: { "application/json": User[] } };
		};
	};
	createUser: {
		parameters: NoParameters;
		requestBody: { content: { "application/json": { name: string; email?: string } } };
		responses: {
			201: { headers: { [name: string]: unknown }; content: { "application/json": User } };
		};
	};
	updateUser: {
		parameters: { query?: never; header?: never; path: { id: string }; cookie?: never };
		requestBody?: { content: { "application/merge-patch+json": { name?: string } } };
		responses: {
			200: { headers: { [name: string]: unknown }; content: { "application/json": User } };
			"2XX": {
				headers: { [name: string]: unknown };
				content: { "application/json": { queued: true } };
			};
		};
	};
	deleteUser: {
		parameters: { query?: never; header?: never; path: { id: string }; cookie?: never };
		requestBody?: never;
		responses: { 204: { headers: { [name: string]: unknown }; content?: never } };
	};
	getAvatar: {
		parameters: { query?: never; header?: never; path: { id: string }; cookie?: never };
		requestBody?: never;
		responses: { 200: { headers: { [name: string]: unknown }; content: { "image/png": string } } };
	};
	getReport: {
		parameters: NoParameters;
		requestBody?: never;
		responses: {
			200: {
				headers: { [name: string]: unknown };
				content: { "application/json": { title: string }; "application/xml": string };
			};
		};
	};
	signUser: {
		parameters: {
			query?: never;
			header: { "X-Signature": string };
			path: { id: string };
			cookie?: never;
		};
		requestBody?: never;
		responses: { 204: { headers: { [name: string]: unknown }; content?: never } };
	};
	ping: {
		parameters: NoParameters;
		requestBody?: never;
		responses: {
			default: { headers: { [name: string]: unknown }; content: { "application/json": string } };
		};
	};
}

interface BillingOperations {
	getInvoice: {
		parameters: { query?: never; header?: never; path: { invoice: string }; cookie?: never };
		requestBody?: never;
		responses: {
			200: {
				headers: { [name: string]: unknown };
				content: { "application/json": { total: number } };
			};
		};
	};
}

// Two registered specs, as inspex adds them for acme.openapi.jsonc and billing.openapi.jsonc.
declare module "./typed-client.ts" {
	interface Specs {
		acme: { paths: {}; components: {}; operations: AcmeOperations };
		billing: { paths: {}; components: {}; operations: BillingOperations };
	}
}

const spec = new URL("./acme.openapi.jsonc", import.meta.url);
const baseUrl = "https://api.acme.test";

// Compile-time regression checks; intentionally never invoked.
function _typecheckRegisteredSpecById() {
	const acme = defineApi({ id: "acme", spec, baseUrl });
	new Crust("acme").extend(acme.extension).add(
		defineCommand("whoami", {}, (command) =>
			command.use(acme.client).action(async ({ ctx }) => {
				const api = await ctx.api;
				const user = await api.call("getUser", { path: { id: "42" }, query: { expand: true } });
				type _User = Expect<Equal<typeof user, User>>;
				// Nothing required: the argument is optional.
				const users = await api.call("listUsers");
				type _Users = Expect<Equal<typeof users, User[]>>;
				await api.call("listUsers", { query: { role: "admin" } });
				const created = await api.call("createUser", { body: { name: "Ada" } });
				type _Created = Expect<Equal<typeof created, User>>;
				// An optional body; several 2xx responses give a union.
				const updated = await api.call("updateUser", { path: { id: "1" } });
				type _Updated = Expect<Equal<typeof updated, User | { queued: true }>>;
				const gone = await api.call("deleteUser", { path: { id: "1" } });
				type _Gone = Expect<Equal<typeof gone, undefined>>;
				// Not JSON: the Response, typed unknown.
				const avatar = await api.call("getAvatar", { path: { id: "1" } });
				type _Avatar = Expect<Equal<typeof avatar, unknown>>;
				// JSON and another media type for one status: the JSON body, which call() asks for.
				const report = await api.call("getReport");
				type _Report = Expect<Equal<typeof report, { title: string }>>;
				// Every operation takes an Accept override, as `Accept` or `accept`, next to its own headers.
				await api.call("getReport", { header: { Accept: "application/xml" } });
				await api.call("getReport", { header: { accept: "application/xml" } });
				await api.call("getUser", {
					path: { id: "1" },
					header: { Accept: "a", "X-Request-Id": "r" },
				});
				await api.call("signUser", {
					path: { id: "1" },
					header: { "X-Signature": "s", Accept: "a" },
				});
				// @ts-expect-error -- a header the operation does not declare
				await api.call("getReport", { header: { "X-Other": "1" } });
				// @ts-expect-error -- a header the operation does not declare, next to its own
				await api.call("getUser", { path: { id: "1" }, header: { "X-Other": "1" } });
				// @ts-expect-error -- Accept does not stand in for a required header
				await api.call("signUser", { path: { id: "1" }, header: { Accept: "a" } });
				// @ts-expect-error -- the override is text
				await api.call("getReport", { header: { Accept: 1 } });
				// No 2xx response: unknown.
				const pong = await api.call("ping");
				type _Pong = Expect<Equal<typeof pong, unknown>>;
				await api.call("ping", {});
				// @ts-expect-error -- no input for an operation that takes none
				await api.call("ping", { body: { unexpected: true } });
				// @ts-expect-error -- not an input object
				await api.call("ping", 1);

				// @ts-expect-error -- not an operationId of acme
				await api.call("getUsr", { path: { id: "42" } });
				// @ts-expect-error -- the path parameter is required
				await api.call("getUser", { query: { expand: true } });
				// @ts-expect-error -- the input is required
				await api.call("getUser");
				// @ts-expect-error -- a parameter the operation does not have
				await api.call("getUser", { path: { id: "42", other: "x" } });
				// @ts-expect-error -- a body field the schema does not have
				await api.call("createUser", { body: { nmae: "Ada" } });
				// @ts-expect-error -- the body is required
				await api.call("createUser");
				// @ts-expect-error -- a query value of the wrong type
				await api.call("listUsers", { query: { role: "owner" } });
				// @ts-expect-error -- not a field of the result
				void user.nickname;
				// The untyped escape hatch stays.
				await api.fetch("/users");
			}),
		),
	);
}

function _typecheckSecondRegisteredSpecById() {
	const billing = defineApi({ id: "billing", spec, baseUrl });
	defineCommand("invoice", {}, (command) =>
		command.use(billing.client).action(async ({ ctx }) => {
			const api = await ctx.api;
			const invoice = await api.call("getInvoice", { path: { invoice: "in_1" } });
			type _Invoice = Expect<Equal<typeof invoice, { total: number }>>;
			// @ts-expect-error -- an operationId of the other spec
			await api.call("getUser", { path: { id: "42" } });
			// A spec with one operation checks its input too.
			// @ts-expect-error -- the input is required
			await api.call("getInvoice");
			// @ts-expect-error -- a parameter the operation does not have
			await api.call("getInvoice", { path: { invoce: "in_1" } });
			// @ts-expect-error -- a parameter value of the wrong type
			await api.call("getInvoice", { path: { invoice: 1 } });
			// @ts-expect-error -- a body the operation does not take
			await api.call("getInvoice", { path: { invoice: "in_1" }, body: { wrong: true } });
		}),
	);
}

function _typecheckUntyped() {
	// Two registered specs and no `id`, or an `id` nobody registered: untyped.
	for (const handle of [
		defineApi({ spec, baseUrl }),
		defineApi({ id: "unregistered", spec: { openapi: "3.1.0", paths: {} }, baseUrl }),
	]) {
		defineCommand("any", {}, (command) =>
			command.use(handle.client).action(async ({ ctx }) => {
				const api = await ctx.api;
				const data = await api.call("anything", { path: { id: 1 }, query: { tags: ["a", "b"] } });
				type _Data = Expect<Equal<typeof data, unknown>>;
				await api.call("anything");
				type _Client = Expect<Equal<typeof api, ApiClient>>;
				// @ts-expect-error -- the input's locations are still checked
				await api.call("anything", { cookie: {} });
			}),
		);
	}
}

function _typecheckRegistrySelection() {
	type One = { acme: { paths: {}; components: {}; operations: AcmeOperations } };
	type Two = One & { billing: { paths: {}; components: {}; operations: BillingOperations } };
	// The only registered spec types a handle without an `id`; `Specs[never]` is not `never`.
	type _Sole = Expect<Equal<SpecOperationsOf<One, never>, AcmeOperations>>;
	type _Empty = Expect<Equal<SpecOperationsOf<{}, never>, unknown>>;
	type _Ambiguous = Expect<Equal<SpecOperationsOf<Two, never>, unknown>>;
	type _ById = Expect<Equal<SpecOperationsOf<Two, "billing">, BillingOperations>>;
	type _Unregistered = Expect<Equal<SpecOperationsOf<Two, "other">, unknown>>;
}

function _typecheckSpecIsAUrlOrAnObject() {
	// @ts-expect-error -- a loader: specs are pinned, never fetched
	defineApi({ spec: async () => ({ paths: {} }), baseUrl });
	// @ts-expect-error -- a path, not a URL
	defineApi({ spec: "./acme.openapi.jsonc", baseUrl });
}

const account = defineContext("account").setup(() => ({ id: "acc_1" }));
const region = defineContext("region").setup(() => "eu");
const purge = defineCommand("purge", (command) =>
	command.use(region).action(async ({ ctx }) => {
		await ctx.region;
	}),
);

function _typecheckChainContexts() {
	const acme = defineApi({ spec, baseUrl })
		.use(confirm, account)
		.onConfirm(async (ctx, message) => (await ctx.confirm)(message))
		.each((op) => ({
			bind: { id: async (ctx) => (await ctx.account).id },
			confirm: op.method === "delete" ? `Delete ${op.path}?` : undefined,
		}))
		.add("users", purge);
	// Every Context the generated and the added commands use is provided.
	new Crust("acme")
		.extend(help(), confirm(), acme.extension)
		.provide(account(), region())
		.add(...acme.commands);
	new Crust("acme")
		.extend(help(), confirm(), acme.extension)
		.provide(account())
		// @ts-expect-error -- FIX_MISSING_DEPENDENCY: `region`, which the added `purge` uses
		.add(...acme.commands);
	new Crust("acme")
		.extend(help(), confirm(), acme.extension)
		.provide(region())
		// @ts-expect-error -- FIX_MISSING_DEPENDENCY: `account`, which `.use()` declared
		.add(...acme.commands);
	new Crust("acme")
		.extend(help(), confirm())
		.provide(account(), region())
		// @ts-expect-error -- FIX_MISSING_DEPENDENCY: `api`, which acme.extension provides
		.add(...acme.commands);

	defineApi({ spec, baseUrl })
		.use(account)
		// @ts-expect-error -- `confirm` was not `.use()`d before
		.onConfirm(async (ctx, message) => (await ctx.confirm)(message));
	defineApi({ spec, baseUrl })
		.use(confirm)
		// @ts-expect-error -- a binding resolves to a string
		.each(() => ({ bind: { id: async (ctx) => (await ctx.confirm)("x") } }));
	// An added command's Contexts are not the generated commands': `.use()` them for a callback.
	defineApi({ spec, baseUrl })
		.add("users", purge)
		// @ts-expect-error -- `region` is only used by the added `purge`
		.onConfirm(async (ctx) => void (await ctx.region));
	defineApi({ spec, baseUrl })
		.add("users", purge)
		// @ts-expect-error -- `region` is only used by the added `purge`
		.each(() => ({ bind: { id: async (ctx) => await ctx.region } }));
	// A handler may also resolve to a boolean, as a prompt does: `false` declines.
	defineApi({ spec, baseUrl }).onConfirm(async () => false);
	defineApi({ spec, baseUrl })
		// @ts-expect-error -- a confirmation is nothing, a boolean, or a throw
		.onConfirm(async () => "yes");
	// A missing required value is a VALIDATION error: nothing asks for it.
	// @ts-expect-error -- the handle has no `onMissing`
	void defineApi({ spec, baseUrl }).onMissing;
	// The client is in `ctx` from the start.
	defineApi({ spec, baseUrl }).each(() => ({
		bind: { id: async (ctx) => (await ctx.api).baseUrl },
	}));
}

const profile = defineContext("profile")
	.flags({ profile: { type: "string", description: "Account to use" } })
	.setup(({ flags }) => flags.profile);
declare const login: {
	profile(name: string | undefined): {
		token(options: { signal: AbortSignal; baseUrl: string }): Promise<{ value: string }>;
	};
	token(options: { signal: AbortSignal; baseUrl: string }): Promise<{ value: string }>;
};

function _typecheckAuthChain() {
	// `auth` reads exactly the Contexts of the factories `.use()`d before it.
	const api = defineApi({ spec, baseUrl })
		.use(profile, account)
		.auth(async ({ ctx }) => {
			type _Profile = Expect<Equal<Awaited<typeof ctx.profile>, string | undefined>>;
			type _Account = Expect<Equal<Awaited<typeof ctx.account>, { id: string }>>;
			// @ts-expect-error -- nor the client itself
			void ctx.api;
			return { authorization: `Bearer ${await ctx.profile}` };
		});
	const whoami = defineCommand("whoami", (command) =>
		command.use(api.client).action(async ({ ctx }) => {
			// A command that declares the client declares the Contexts its `auth` reads.
			type _Profile = Expect<Equal<Awaited<typeof ctx.profile>, string | undefined>>;
			// A helper generic in the Contexts `auth` reads takes it; one typed with the plain client does not.
			const helper = <AuthDeps extends ContextMap>(client: ApiClient<unknown, AuthDeps>) =>
				client.baseUrl;
			helper(await ctx.api);
			// @ts-expect-error -- the plain client's `auth` reads no Contexts
			const _plain: ApiClient = await ctx.api;
		}),
	);
	// Contexts `.use()`d after `.auth()` are the callbacks', not the client's.
	const acme = api
		.use(confirm, region)
		.onConfirm(async (ctx, message) => (await ctx.confirm)(message))
		.each(() => ({ bind: { id: async (ctx) => `${await ctx.profile}-${await ctx.region}` } }))
		.add("users", whoami);
	new Crust("acme")
		.provide(profile(), account(), region())
		.extend(confirm(), acme.extension)
		.add(...acme.commands);
	new Crust("acme")
		.provide(account(), region())
		// @ts-expect-error -- FIX_MISSING_DEPENDENCY: `profile`, which `auth` reads
		.extend(confirm(), acme.extension);
	// An app command uses the client of the handle the app extends, or of one before it after the same `.auth()`.
	new Crust("acme")
		.provide(profile(), account())
		.extend(acme.extension)
		.add(whoami)
		.add(
			defineCommand("me", (command) =>
				command.use(acme.client).action(async ({ ctx }) => void (await ctx.profile)),
			),
		);

	// The client of another `.auth()`, whose `auth` reads Contexts the app's client does not.
	const plain = defineApi({ spec, baseUrl });
	new Crust("acme")
		.provide(profile(), account())
		.extend(plain.extension)
		// @ts-expect-error -- FIX_DEPENDENCY_TYPE: `api`, a client whose `auth` reads `profile` and `account`
		.add(whoami);
	new Crust("acme")
		.provide(profile(), account())
		.extend(plain.use(profile).auth(async () => undefined).extension)
		// @ts-expect-error -- FIX_DEPENDENCY_TYPE: the same, also when the extended `auth` reads some of them
		.add(whoami);
	// Commands of one handle with the Extension of another, as before.
	new Crust("acme")
		.provide(profile(), account(), region())
		.extend(confirm(), plain.extension)
		// @ts-expect-error -- FIX_DEPENDENCY_TYPE: `api`
		.add(...acme.commands);
	// An app command added to the group of a handle after another `.auth()`.
	new Crust("acme")
		.provide(profile(), account())
		.extend(plain.add("users", whoami).extension)
		// @ts-expect-error -- FIX_DEPENDENCY_TYPE: `api`
		.add(...plain.add("users", whoami).commands);
	// The reverse: the client of a handle before `.auth()`, in an app that extends one after it.
	const before = defineCommand("before", (command) =>
		command.use(plain.client).action(async ({ ctx }) => void (await ctx.api)),
	);
	new Crust("acme")
		.provide(profile(), account(), region())
		.extend(confirm(), acme.extension)
		// @ts-expect-error -- FIX_DEPENDENCY_TYPE: `api`, a client whose `auth` reads no Contexts
		.add(before);
	// The same command `.add()`ed to the handle before its `.auth()`.
	const late = plain
		.add("users", before)
		.use(profile)
		.auth(async () => undefined);
	new Crust("acme")
		.provide(profile())
		.extend(late.extension)
		// @ts-expect-error -- FIX_DEPENDENCY_TYPE: `api`
		.add(...late.commands);
	// Commands `.add()`ed from a named array count as its element type, in both directions.
	const befores = [before];
	const authedWithBefores = api.add("users", ...befores);
	new Crust("acme")
		.provide(profile(), account())
		.extend(authedWithBefores.extension)
		// @ts-expect-error -- FIX_DEPENDENCY_TYPE: `api`, a client whose `auth` reads no Contexts
		.add(...authedWithBefores.commands);
	const whoamis = [whoami];
	const plainWithWhoamis = plain.add("users", ...whoamis);
	new Crust("acme")
		.provide(profile(), account())
		.extend(plainWithWhoamis.extension)
		// @ts-expect-error -- FIX_DEPENDENCY_TYPE: `api`, a client whose `auth` reads `profile` and `account`
		.add(...plainWithWhoamis.commands);

	// The flags of the Contexts `auth` reads: a command that uses the client parses them, and so does `api`.
	const flagged = new Crust("acme")
		.provide(profile(), account())
		.extend(api.extension)
		.add(
			defineCommand("me", (command) =>
				command.use(api.client).action(({ flags }) => {
					type _Flag = Expect<Equal<typeof flags.profile, string | undefined>>;
				}),
			),
		);
	void flagged.run(["api"], { args: { path: "/x" }, flags: { profile: "work" } });
	void flagged.run(["me"], { flags: { profile: "work" } });
	// `api preview` sets up no Context, so it does not.
	void flagged.run(
		["api", "preview"],
		// @ts-expect-error -- `api preview` has no `--profile`
		{ args: { target: ["/x"] }, flags: { profile: "work" } },
	);

	// The factories of a named array `.use()`d before `.auth()` count too.
	const head = defineContext("head").setup(() => 1);
	const more = [profile];
	const spread = plain.use(head, ...more).auth(async ({ ctx }) => void (await ctx.profile));
	new Crust("acme").provide(head(), profile()).extend(spread.extension);
	new Crust("acme")
		.provide(head())
		// @ts-expect-error -- FIX_MISSING_DEPENDENCY: `profile`, of the spread array
		.extend(spread.extension);

	defineApi({ spec, baseUrl })
		.use(profile)
		.use(region)
		.auth(async ({ ctx }) => ({ authorization: `${await ctx.profile}-${await ctx.region}` }));
	// Only Context factories: an Extension's Contexts are not readable in `auth`.
	defineApi({ spec, baseUrl })
		.use(confirm)
		// @ts-expect-error -- `confirm` comes from an Extension
		.auth(async ({ ctx }) => void (await ctx.confirm));
	// Each `.auth()` reads the `.use()`s before it, not those after it.
	defineApi({ spec, baseUrl })
		// @ts-expect-error -- `profile` is `.use()`d after this `.auth()`
		.auth(async ({ ctx }) => void (await ctx.profile))
		.use(profile)
		.auth(async ({ ctx }) => void (await ctx.profile));

	// `bearerAuth()`'s resolver reads them too; the plain case needs no `.use()` nor `.provide()`.
	defineApi({ spec, baseUrl })
		.use(profile)
		.auth(
			bearerAuth(async ({ ctx, signal, baseUrl }) =>
				login.profile(await ctx.profile).token({ signal, baseUrl }),
			),
		);
	const simple = defineApi({ spec, baseUrl }).auth(bearerAuth(login.token));
	new Crust("acme").extend(simple.extension).add(...simple.commands);
	defineApi({ spec, baseUrl }).auth(
		// @ts-expect-error -- `profile` is not `.use()`d before
		bearerAuth(async ({ ctx }) => ({ value: String(await ctx.profile) })),
	);
	// @ts-expect-error -- `auth` is not an option: `.auth()` is
	defineApi({ spec, baseUrl, auth: bearerAuth(login.token) });
}

function _typecheckTypedNames() {
	defineApi({ id: "acme", spec, baseUrl })
		.each((op) => {
			type _Id = Expect<Equal<typeof op.id, keyof AcmeOperations>>;
			// A rule names parameters of any operation; those an operation lacks are ignored.
			return { flagName: { anything: "x" } };
		})
		.override({
			getUser: {
				expect: { method: "GET", path: "/users/{id}" },
				flagName: { expand: "full", "X-Request-Id": "request-id" },
				positional: ["id"],
				bind: { "X-Request-Id": () => "r1" },
			},
			// A top-level body property is named like a parameter.
			createUser: { flagName: { email: "mail" }, bind: { name: () => "Ada" } },
		})
		.override({
			// @ts-expect-error -- not an operationId of acme
			getUsr: { name: "get" },
		})
		// @ts-expect-error -- not a parameter of getUser
		.override({ getUser: { flagName: { nope: "x" } } })
		// @ts-expect-error -- a body property is not positional
		.override({ createUser: { positional: ["name"] } })
		// @ts-expect-error -- not a parameter of listUsers
		.override({ listUsers: { bind: { id: () => "1" } } });
}

function _typecheckUntypedNames() {
	defineApi({ spec, baseUrl })
		.each((op) => {
			type _Id = Expect<Equal<typeof op.id, string>>;
			return undefined;
		})
		.override({ anything: { flagName: { any: "x" }, positional: ["id"], bind: { x: () => "1" } } });
}

void [
	_typecheckAuthChain,
	_typecheckChainContexts,
	_typecheckTypedNames,
	_typecheckUntypedNames,
	_typecheckRegisteredSpecById,
	_typecheckSecondRegisteredSpecById,
	_typecheckUntyped,
	_typecheckRegistrySelection,
	_typecheckSpecIsAUrlOrAnObject,
];

// @ts-expect-error -- `MissingField` is not exported
type _NoMissingField = import("./index.ts").MissingField;
