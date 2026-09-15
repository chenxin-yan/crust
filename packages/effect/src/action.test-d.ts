import { Crust, defineContext } from "@crustjs/core";
import { Context, Effect, Layer } from "effect";

import { effectAction, type ServicesOf } from "./action.ts";
import { effectContext } from "./context.ts";
import { type CrustTaggedError, tryCrust } from "./errors.ts";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

class Db extends Context.Service<Db, { readonly query: (sql: string) => string }>()("d/Db") {}
class Cache extends Context.Service<Cache, { readonly get: (key: string) => string }>()(
	"d/Cache",
) {}

const db = effectContext("db", Layer.succeed(Db, { query: (sql) => sql }));
const cache = effectContext("cache", Layer.succeed(Cache, { get: (key) => key }));
const config = defineContext("config", () => ({ prefix: "cfg" }));

// args / flags / ctx inference is unchanged versus a plain action.
new Crust("cli")
	.provide(db(), config())
	.args({ name: "table", type: "string", required: true })
	.flags({ name: "limit", type: "number" })
	.action(
		effectAction([db], ({ args, flags, ctx }) =>
			Effect.gen(function* () {
				type _Args = Expect<Equal<typeof args.table, string>>;
				type _Flags = Expect<Equal<typeof flags.limit, number | undefined>>;
				type _Db = Expect<Equal<Awaited<typeof ctx.db>, Context.Context<Db>>>;
				type _Config = Expect<Equal<Awaited<typeof ctx.config>, { prefix: string }>>;
				const database = yield* Db;
				return database.query(args.table);
			}),
		),
	);

// Without listed Contexts the Effect must have no requirements; inference still holds.
new Crust("cli").args({ name: "table", type: "string", required: true }).action(
	effectAction(({ args }) => {
		type _Args = Expect<Equal<typeof args.table, string>>;
		return Effect.succeed(args.table);
	}),
);

// The adapted action resolves to the Effect's success value.
const adapted = effectAction(() => Effect.succeed(42));
type _Result = Expect<Equal<ReturnType<typeof adapted>, Promise<number>>>;

// Services are the union of the listed Effect Contexts' built services.
type _Services = Expect<Equal<ServicesOf<[typeof db, typeof cache]>, Db | Cache>>;
type _NoServices = Expect<Equal<ServicesOf<[]>, never>>;

// An Effect requiring a service outside the listed Contexts is rejected.
new Crust("cli").provide(db()).action(
	effectAction([db], () =>
		// @ts-expect-error -- Cache is not among the listed Effect Contexts.
		Effect.gen(function* () {
			return yield* Cache;
		}),
	),
);
new Crust("cli").provide(db()).action(
	effectAction(() =>
		// @ts-expect-error -- no Effect Contexts are listed, so Db is not provided.
		Effect.gen(function* () {
			return yield* Db;
		}),
	),
);

// A fully composed Layer is required: unmet requirements are rejected.
const needsCache = Layer.effect(
	Db,
	Effect.map(Cache, (c) => ({ query: c.get })),
);
// @ts-expect-error -- Layer still requires Cache.
effectContext("needsCache", needsCache);

// tryCrust unwraps sync and async thunks and fails with the tagged union.
type _Sync = Expect<
	Equal<ReturnType<typeof tryCrust<number>>, Effect.Effect<number, CrustTaggedError>>
>;
const asyncLifted = tryCrust(async () => "text");
type _Async = Expect<Equal<typeof asyncLifted, Effect.Effect<string, CrustTaggedError>>>;
