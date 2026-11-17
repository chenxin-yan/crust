import { Crust, defineCommand } from "@crustjs/core";

import { type ApiClient, defineApi } from "./index.ts";
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
				// No 2xx response: unknown.
				const pong = await api.call("ping");
				type _Pong = Expect<Equal<typeof pong, unknown>>;

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

void [
	_typecheckRegisteredSpecById,
	_typecheckSecondRegisteredSpecById,
	_typecheckUntyped,
	_typecheckRegistrySelection,
	_typecheckSpecIsAUrlOrAnObject,
];
