import { describe, expect, it } from "bun:test";

import { Crust, CrustError, defineContext } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { Cause, Context, Effect, Exit, Layer } from "effect";

import { CrustDefinitionError, tryCrust } from "./errors.ts";
import { handler, service } from "./handler.ts";
import { layer } from "./layer.ts";

class Db extends Context.Service<Db, { readonly query: (sql: string) => string }>()("test/Db") {}
class Cache extends Context.Service<Cache, { readonly get: (key: string) => string }>()(
	"test/Cache",
) {}

function resource<Self, Shape>(
	log: string[],
	key: Context.Key<Self, Shape>,
	label: string,
	shape: Shape,
	onRelease?: (exit: Exit.Exit<unknown, unknown>) => void,
): Layer.Layer<Self> {
	return Layer.effect(
		key,
		Effect.acquireRelease(
			Effect.sync(() => {
				log.push(`acquire ${label}`);
				return shape;
			}),
			(_, exit) =>
				Effect.sync(() => {
					log.push(`release ${label}`);
					onRelease?.(exit);
				}),
		),
	);
}

describe("handler with layer", () => {
	it("builds every layer on the path at handler start and releases them in reverse order after success", async () => {
		const log: string[] = [];
		const db = layer("db", resource(log, Db, "db", { query: (sql) => `rows(${sql})` }));
		const cache = layer("cache", resource(log, Cache, "cache", { get: (key) => key }));
		const app = new Crust("cli")
			.provide(db(), cache())
			.args({ name: "table", type: "string", required: true })
			.action(
				handler(({ args }) => {
					// Runs when handler() calls fn: both layers must already be built.
					log.push("action");
					return Effect.gen(function* () {
						const database = yield* Db;
						yield* Cache;
						return database.query(`select * from ${args.table}`);
					});
				}),
			);

		const outcome = await app.run([], { args: { table: "users" } });

		expect(outcome.status).toBe("completed");
		expect(outcome.status === "completed" && outcome.result).toBe("rows(select * from users)");
		expect(log).toEqual(["acquire db", "acquire cache", "action", "release cache", "release db"]);
	});

	it("releases both layers in reverse order after a failing program", async () => {
		const log: string[] = [];
		const db = layer("db", resource(log, Db, "db", { query: (sql) => sql }));
		const cache = layer("cache", resource(log, Cache, "cache", { get: (key) => key }));
		const boom = new Error("boom");
		const app = new Crust("cli").provide(db(), cache()).action(
			handler(function* () {
				yield* Db;
				yield* Cache;
				log.push("action");
				return yield* Effect.fail(boom);
			}),
		);

		const outcome = await app.run([]);

		expect(outcome.status).toBe("failed");
		expect(outcome.status === "failed" && outcome.error).toBe(boom);
		expect(log).toEqual(["acquire db", "acquire cache", "action", "release cache", "release db"]);
	});

	it("builds a layer on the path even when the program never uses it", async () => {
		const log: string[] = [];
		const cache = layer("cache", resource(log, Cache, "cache", { get: (key) => key }));
		const app = new Crust("cli")
			.provide(cache())
			.action(handler(() => Effect.succeed("no cache needed")));

		const outcome = await app.run([]);

		expect(outcome.status === "completed" && outcome.result).toBe("no cache needed");
		expect(log).toEqual(["acquire cache", "release cache"]);
	});

	it("hands the program's Exit to finalizers", async () => {
		const exits: Exit.Exit<unknown, unknown>[] = [];
		const db = layer(
			"db",
			resource([], Db, "db", { query: (sql) => sql }, (exit) => exits.push(exit)),
		);
		const run = (program: Effect.Effect<unknown, unknown, Db>) =>
			new Crust("cli")
				.provide(db())
				.action(handler(() => program))
				.run([]);
		const boom = new Error("boom");

		await run(Effect.map(Db, () => "ok"));
		await run(Effect.flatMap(Db, () => Effect.fail(boom)));
		await run(Effect.flatMap(Db, () => Effect.interrupt));

		expect(exits).toHaveLength(3);
		const [success, failure, interruption] = exits as [
			Exit.Exit<unknown, unknown>,
			Exit.Exit<unknown, unknown>,
			Exit.Exit<unknown, unknown>,
		];
		expect(Exit.isSuccess(success) && success.value).toBe("ok");
		expect(Exit.isFailure(failure) && Cause.squash(failure.cause)).toBe(boom);
		expect(Exit.isFailure(interruption) && Cause.hasInterruptsOnly(interruption.cause)).toBe(true);
	});

	it("closes already-built layers with a failure Exit when a sibling layer fails to build", async () => {
		const exits: Exit.Exit<unknown, unknown>[] = [];
		const db = layer(
			"db",
			resource([], Db, "db", { query: (sql) => sql }, (exit) => exits.push(exit)),
		);
		const broken = new Error("cache is down");
		const cache = layer("cache", Layer.effect(Cache, Effect.die(broken)));
		const app = new Crust("cli")
			.provide(db(), cache())
			.action(handler(() => Effect.map(Db, () => "unreachable")));

		const outcome = await app.run([]);

		expect(outcome.status === "failed" && outcome.error).toBe(broken);
		const [exit] = exits as [Exit.Exit<unknown, unknown>];
		expect(exits).toHaveLength(1);
		expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe(broken);
	});

	it("closes a layer's own partial acquisitions with the build failure Exit", async () => {
		const exits: Exit.Exit<unknown, unknown>[] = [];
		const broken = new Error("second half failed");
		const partial = Layer.merge(
			resource([], Db, "db", { query: (sql) => sql }, (exit) => exits.push(exit)),
			Layer.effect(Cache, Effect.die(broken)),
		);
		const both = layer("both", partial);
		const app = new Crust("cli")
			.provide(both())
			.action(handler(() => Effect.map(Db, () => "unreachable")));

		const outcome = await app.run([]);

		expect(outcome.status === "failed" && outcome.error).toBe(broken);
		const [exit] = exits as [Exit.Exit<unknown, unknown>];
		expect(exits).toHaveLength(1);
		expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe(broken);
	});

	it("treats a synchronous throw from the program factory as the program's failure", async () => {
		const exits: Exit.Exit<unknown, unknown>[] = [];
		const db = layer(
			"db",
			resource([], Db, "db", { query: (sql) => sql }, (exit) => exits.push(exit)),
		);
		const boom = new Error("boom before any Effect");
		const app = new Crust("cli").provide(db()).action(
			handler((): Effect.Effect<never, never, Db> => {
				throw boom;
			}),
		);

		const outcome = await app.run([]);

		expect(outcome.status === "failed" && outcome.error).toBe(boom);
		const [exit] = exits as [Exit.Exit<unknown, unknown>];
		expect(exits).toHaveLength(1);
		expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe(boom);
	});

	it("produces identical results from the generator and Effect forms", async () => {
		const db = layer("db", Layer.succeed(Db, { query: (sql) => `rows(${sql})` }));
		const config = defineContext("config", () => ({ limit: 3 }));
		const base = new Crust("cli")
			.provide(db(), config())
			.args({ name: "table", type: "string", required: true });
		const generatorForm = base.action(
			handler(function* ({ args }) {
				const database = yield* Db;
				const { limit } = yield* service(config);
				return database.query(`select * from ${args.table} limit ${limit}`);
			}),
		);
		const effectForm = base.action(
			handler(({ args }) =>
				Effect.gen(function* () {
					const database = yield* Db;
					const { limit } = yield* service(config);
					return database.query(`select * from ${args.table} limit ${limit}`);
				}),
			),
		);

		const fromGenerator = await generatorForm.run([], { args: { table: "users" } });
		const fromEffect = await effectForm.run([], { args: { table: "users" } });

		expect(fromGenerator.status === "completed" && fromGenerator.result).toBe(
			"rows(select * from users limit 3)",
		);
		expect(fromEffect).toEqual(fromGenerator);
	});

	it("keeps plain Contexts lazy: service() builds once, untouched Contexts never", async () => {
		let configBuilt = 0;
		const db = layer("db", Layer.succeed(Db, { query: (sql) => sql }));
		const config = defineContext("config", () => {
			configBuilt++;
			return { prefix: "cfg" };
		});
		const untouched = defineContext("untouched", () => {
			throw new Error("must stay lazy");
		});
		const app = new Crust("cli").provide(db(), config(), untouched()).action(
			handler(function* () {
				const database = yield* Db;
				const first = yield* service(config);
				const second = yield* service(config);
				return database.query(`${first.prefix}:${second.prefix}`);
			}),
		);

		const outcome = await app.run([]);

		expect(outcome.status === "completed" && outcome.result).toBe("cfg:cfg");
		expect(configBuilt).toBe(1);
	});

	it("ignores a plain Context that shares its name with a layer in another app", async () => {
		layer("shared", Layer.succeed(Db, { query: (sql) => sql }));
		const shared = defineContext("shared", () => {
			throw new Error("must stay lazy");
		});
		const app = new Crust("other").provide(shared()).action(handler(() => Effect.succeed("plain")));

		const outcome = await app.run([]);

		expect(outcome.status === "completed" && outcome.result).toBe("plain");
	});

	it("fails service() with Core's missing-context error when the Context is off the path", async () => {
		const config = defineContext("config", () => ({ limit: 3 }));
		const app = new Crust("cli").action(
			handler(() =>
				service(config).pipe(
					Effect.map(() => "unreachable"),
					Effect.catchTag("CrustDefinitionError", (error) => Effect.succeed(error)),
				),
			),
		);

		const outcome = await app.run([]);

		expect(outcome.status).toBe("completed");
		const caught = outcome.status === "completed" ? outcome.result : undefined;
		expect(caught).toBeInstanceOf(CrustDefinitionError);
		const { cause, details } = caught as CrustDefinitionError;
		expect(cause).toBeInstanceOf(CrustError);
		expect(details).toEqual({ subject: "context", name: "config", reason: "missing-context" });
	});

	it("lets a plain action read a layer value with Context.get", async () => {
		const db = layer("db", Layer.succeed(Db, { query: (sql) => `rows(${sql})` }));
		const app = new Crust("cli").provide(db()).action(async ({ ctx }) => {
			return Context.get(await ctx.db, Db).query("select 1");
		});

		const outcome = await app.run([]);

		expect(outcome.status === "completed" && outcome.result).toBe("rows(select 1)");
	});
});

describe("handler under execute()", () => {
	it("renders a failing Effect exactly like a plain thrown error", async () => {
		const plain = new Crust("cli").action(() => {
			throw new Error("boom");
		});
		const effectful = new Crust("cli").action(handler(() => Effect.fail(new Error("boom"))));

		const expected = await captureExecute(plain, []);
		const actual = await captureExecute(effectful, []);

		expect(expected.exitCode).toBe(1);
		expect(actual).toEqual(expected);
	});

	it("renders a tagged Crust failure exactly like the original CrustError", async () => {
		const original = new CrustError("PARSE", 'Unknown flag "--bogus"', { flag: "bogus" });
		const plain = new Crust("cli").action(() => {
			throw original;
		});
		const effectful = new Crust("cli").action(
			handler(() =>
				tryCrust(() => {
					throw original;
				}),
			),
		);

		const expected = await captureExecute(plain, []);
		const actual = await captureExecute(effectful, []);

		expect(expected.stderr).toBe('Error: Unknown flag "--bogus"');
		expect(actual).toEqual(expected);
	});

	it("exits 130 silently when the Effect is interrupted", async () => {
		const app = new Crust("cli").action(
			handler(() =>
				tryCrust(() => {
					throw new DOMException("Prompt was cancelled.", "AbortError");
				}),
			),
		);

		const captured = await captureExecute(app, []);

		expect(captured.exitCode).toBe(130);
		expect(captured.stderr).toBe("");
	});
});
