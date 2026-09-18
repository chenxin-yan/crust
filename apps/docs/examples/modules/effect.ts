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
