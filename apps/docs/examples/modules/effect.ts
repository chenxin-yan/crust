//#region quick-example
import { Crust, defineContext } from "@crustjs/core";
import { handler, layer, service } from "@crustjs/effect";
import { Context, Effect, Layer } from "effect";

class Db extends Context.Service<Db, { readonly query: (sql: string) => Promise<string> }>()(
	"app/Db",
) {}

const DbLive = Layer.effect(
	Db,
	Effect.acquireRelease(
		Effect.sync(() => ({ query: async (sql) => `rows for ${sql}` })),
		() => Effect.sync(() => console.log("db closed")),
	),
);

const db = layer("db", DbLive);
const config = defineContext("config", () => ({ limit: 10 }));

const app = new Crust("app")
	.provide(db(), config())
	.args({ name: "table", type: "string", required: true })
	.action(
		handler(function* ({ args }) {
			const d = yield* Db;
			const cfg = yield* service(config);
			return yield* Effect.promise(() => d.query(`select * from ${args.table} limit ${cfg.limit}`));
		}),
	);

await app.execute();
//#endregion

//#region handler
class Store extends Context.Service<Store, { readonly query: (sql: string) => string }>()(
	"app/Store",
) {}
const store = layer("store", Layer.succeed(Store, { query: (sql) => `rows for ${sql}` }));

const base = new Crust("app")
	.provide(store())
	.args({ name: "table", type: "string", required: true });

// Generator form, like `Effect.fn`.
base.action(
	handler(function* ({ args }) {
		const s = yield* Store;
		return s.query(`select * from ${args.table}`);
	}),
);

// Effect form.
base.action(
	handler(({ args }) => Effect.map(Store, (s) => s.query(`select * from ${args.table}`))),
);
//#endregion

//#region service
const limits = defineContext("limits", () => ({ limit: 10 }));

new Crust("app").provide(limits()).action(
	handler(function* () {
		const { limit } = yield* service(limits); // { limit: number }
		return limit;
	}),
);

// Not provided on this path: fails with CrustDefinitionError, catchable by tag.
new Crust("app").action(
	handler(() =>
		service(limits).pipe(
			Effect.map(({ limit }) => limit),
			Effect.catchTag("CrustDefinitionError", () => Effect.succeed(0)),
		),
	),
);
//#endregion

//#region tagged-errors
import { CrustError } from "@crustjs/core";
import { tryCrust } from "@crustjs/effect";

const program = tryCrust(() => {
	throw new CrustError("PARSE", 'Unknown flag "--bogus"', {
		flag: "bogus",
		reason: "unknown-flag",
	});
}).pipe(Effect.catchTag("CrustParseError", (error) => Effect.succeed(error.details?.flag)));
//#endregion

export { program };
