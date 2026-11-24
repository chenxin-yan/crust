import { Crust, type CrustCommandContext, defineContext } from "@crustjs/core";
import { defineEnv } from "@crustjs/env";
import { Context, Effect, Layer } from "effect";

import { type CrustEnvError, type CrustTaggedError, tryCrust } from "./errors.ts";
import { type ContextService, handler, type ServicesOf, service } from "./handler.ts";
import type { HandlerInput } from "./index.ts";
import { layer, type LayerValue } from "./layer.ts";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

class Db extends Context.Service<Db, { readonly query: (sql: string) => string }>()("d/Db") {}
class Cache extends Context.Service<Cache, { readonly get: (key: string) => string }>()(
	"d/Cache",
) {}

const db = layer("db", Layer.succeed(Db, { query: (sql) => sql }));
const config = defineContext("config").setup(() => ({ prefix: "cfg" }));

// args / flags / ctx inference is unchanged versus a plain action, in both forms.
new Crust("cli")
	.provide(db(), config())
	.args({ name: "table", type: "string", required: true })
	.flags({ limit: { type: "number" } })
	.action(
		handler(function* ({ args, flags, ctx }) {
			type _Args = Expect<Equal<typeof args.table, string>>;
			type _Flags = Expect<Equal<typeof flags.limit, number | undefined>>;
			type _Db = Expect<Equal<Awaited<typeof ctx.db>, LayerValue<Db>>>;
			type _Config = Expect<Equal<Awaited<typeof ctx.config>, { prefix: string }>>;
			const database = yield* Db;
			const { prefix } = yield* service(config);
			return database.query(`${prefix}:${args.table}`);
		}),
	);
new Crust("cli")
	.provide(db(), config())
	.args({ name: "table", type: "string", required: true })
	.flags({ limit: { type: "number" } })
	.action(
		handler(({ args, flags, ctx }) =>
			Effect.gen(function* () {
				type _Args = Expect<Equal<typeof args.table, string>>;
				type _Flags = Expect<Equal<typeof flags.limit, number | undefined>>;
				type _Db = Expect<Equal<Awaited<typeof ctx.db>, LayerValue<Db>>>;
				type _Config = Expect<Equal<Awaited<typeof ctx.config>, { prefix: string }>>;
				const database = yield* Db;
				return database.query(args.table);
			}),
		),
	);

// The adapted action resolves to the program's success value in both forms.
const adaptedEffect = handler(() => Effect.succeed(42));
type _EffectResult = Expect<Equal<ReturnType<typeof adaptedEffect>, Promise<number>>>;
const adaptedGenerator = handler(function* () {
	yield* Effect.void;
	return 42;
});
type _GeneratorResult = Expect<Equal<ReturnType<typeof adaptedGenerator>, Promise<number>>>;

// ServicesOf provides the services of branded layer() values, and each Context in ctx by name.
type _Services = Expect<
	Equal<
		ServicesOf<{
			ctx: { db: Promise<LayerValue<Db>>; unbranded: Promise<Context.Context<Cache>> };
		}>,
		Db | ContextService<"db", LayerValue<Db>> | ContextService<"unbranded", Context.Context<Cache>>
	>
>;

// A layer() with a non-literal name provides nothing: its entry cannot be tied to the path.
declare const dynamicName: string;
const dynamic = layer(dynamicName, Layer.succeed(Db, { query: (sql) => sql }));
new Crust("cli").provide(dynamic()).action(
	// @ts-expect-error -- open-name layer does not provide Db.
	handler(function* () {
		return yield* Db;
	}),
);

// A service without a layer() on the path is rejected, in both forms.
new Crust("cli").provide(db()).action(
	// @ts-expect-error -- no cache layer on the path.
	handler(function* () {
		return yield* Cache;
	}),
);
new Crust("cli").provide(db()).action(
	handler(() =>
		// @ts-expect-error -- no cache layer on the path.
		Effect.gen(function* () {
			return yield* Cache;
		}),
	),
);

// A fully composed Layer is required: unmet requirements are rejected.
const needsCache = Layer.effect(
	Db,
	Effect.map(Cache, (c) => ({ query: c.get })),
);
// @ts-expect-error -- Layer still requires Cache.
layer("needsCache", needsCache);

// service() is typed by the factory's value.
type ConfigService = ReturnType<typeof service<typeof config>>;
type _ServiceValue = Expect<Equal<Effect.Success<ConfigService>, { prefix: string }>>;
// Its requirement is nameable, so reusable programs can be annotated.
type _ServiceRequirement = Expect<
	Equal<Effect.Services<ConfigService>, HandlerInput | ContextService<"config", { prefix: string }>>
>;

// service() of a Context the command's ctx does not hold is rejected, in both forms.
new Crust("cli").provide(db()).action(
	// @ts-expect-error -- no config Context on the path.
	handler(function* () {
		return yield* service(config);
	}),
);
new Crust("cli").provide(db()).action(
	handler(() =>
		// @ts-expect-error -- no config Context on the path.
		Effect.gen(function* () {
			return yield* service(config);
		}),
	),
);
// A Context of the same name with another value type is rejected too.
const otherConfig = defineContext("config").setup(() => ({ prefix: 1 }));
new Crust("cli").provide(config()).action(
	// @ts-expect-error -- ctx.config holds { prefix: string }.
	handler(function* () {
		return yield* service(otherConfig);
	}),
);
// A same-name factory with a wider value is rejected too: the brand is invariant.
const widerConfig = defineContext("config").setup(() => ({ prefix: "cfg", extra: 1 }));
new Crust("cli").provide(config()).action(
	// @ts-expect-error -- ctx.config holds { prefix: string }.
	handler(function* () {
		return (yield* service(widerConfig)).extra;
	}),
);
// A handler defined outside .action() annotates its input with the Contexts it pulls.
const standalone = handler(function* (
	_input: CrustCommandContext<any, any, { config: { prefix: string } }>,
) {
	return (yield* service(config)).prefix;
});
new Crust("cli").provide(config()).action(standalone);
// @ts-expect-error -- no config Context on the path.
new Crust("cli").provide(db()).action(standalone);
// A Context the command uses (not only provides) satisfies service().
new Crust("cli").provide(config()).command("show", (cmd) =>
	cmd.use(config).action(
		handler(function* () {
			return (yield* service(config)).prefix;
		}),
	),
);

const env = defineEnv("env", {
	PORT: { type: "number", default: 3000 },
	API_TOKEN: { type: "string", required: true },
});
service(env).pipe(
	Effect.catchTag("CrustEnvError", (error) => {
		type _CaughtEnvError = Expect<Equal<typeof error, CrustEnvError>>;
		return Effect.succeed({ PORT: 3000, API_TOKEN: "test" });
	}),
);

// tryCrust unwraps async thunks and fails with the tagged union.
const asyncLifted = tryCrust(async () => "text");
type _Async = Expect<Equal<typeof asyncLifted, Effect.Effect<string, CrustTaggedError>>>;
