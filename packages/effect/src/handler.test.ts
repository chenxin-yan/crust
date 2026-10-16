import { Crust, CrustError, defineContext } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { Cause, Context, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { CrustDefinitionError } from "./errors.ts";
import { handler, service } from "./handler.ts";
import { type LayerValue, layer } from "./layer.ts";

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

	it("keeps plain Contexts lazy: service() builds once, untouched Contexts never", async () => {
		let configBuilt = 0;
		const db = layer("db", Layer.succeed(Db, { query: (sql) => sql }));
		const config = defineContext("config").setup(() => {
			configBuilt++;
			return { prefix: "cfg" };
		});
		const untouched = defineContext("untouched").setup(() => {
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
		const shared = defineContext("shared").setup(() => {
			throw new Error("must stay lazy");
		});
		const app = new Crust("other").provide(shared()).action(handler(() => Effect.succeed("plain")));

		const outcome = await app.run([]);

		expect(outcome.status === "completed" && outcome.result).toBe("plain");
	});

	it("skips a layer shadowed by a descendant plain Context, keeping the plain Context lazy", async () => {
		const log: string[] = [];
		const shared = layer("shared", resource(log, Db, "layer", { query: (sql) => sql }));
		let plainBuilds = 0;
		const plain = defineContext("shared").setup(() => {
			plainBuilds++;
			return { port: 80 };
		});
		const app = new Crust("cli")
			.provide(shared())
			.command("child", (child) =>
				child.provide(plain()).action(handler(() => Effect.succeed("ok"))),
			);

		const outcome = await app.run(["child"]);

		expect(outcome.status === "completed" && outcome.result).toBe("ok");
		expect(plainBuilds).toBe(0);
		expect(log).toEqual([]);
	});

	it("builds only the effective layer when a descendant layer shadows an ancestor, in provider order", async () => {
		const log: string[] = [];
		const ancestor = layer("shared", resource(log, Db, "ancestor", { query: () => "ancestor" }));
		const second = layer("second", resource(log, Db, "second", { query: () => "second" }));
		const descendant = layer(
			"shared",
			resource(log, Db, "descendant", { query: () => "descendant" }),
		);
		const app = new Crust("cli").provide(ancestor(), second()).command("child", (child) =>
			child.provide(descendant()).action(
				handler(function* () {
					return (yield* Db).query("");
				}),
			),
		);

		const outcome = await app.run(["child"]);

		// The later effective provider wins service conflicts, as Core's last same-name provider does.
		expect(outcome.status === "completed" && outcome.result).toBe("descendant");
		expect(log).toEqual([
			"acquire second",
			"acquire descendant",
			"release descendant",
			"release second",
		]);
	});

	it("provides a descendant same-factory layer .of() double without building the live layer", async () => {
		const log: string[] = [];
		const db = layer("db", resource(log, Db, "live", { query: () => "live" }));
		// SAFETY: LayerValue's brand is type-only; a built Context is the runtime value.
		const double = Context.make(Db, { query: () => "double" }) as LayerValue<Db>;
		const app = new Crust("cli").provide(db()).command("child", (child) =>
			child.provide(db.of(double)).action(
				handler(function* () {
					return (yield* Db).query("");
				}),
			),
		);

		const outcome = await app.run(["child"]);

		expect(outcome.status === "completed" && outcome.result).toBe("double");
		expect(log).toEqual([]);
	});

	it("fails service() with Core's missing-context error when the Context is off the path", async () => {
		const config = defineContext("config").setup(() => ({ limit: 3 }));
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

	it.each([false, true])(
		"rejects a different same-name factory without building it (compatible=%s)",
		async (compatible) => {
			const expected = defineContext("config").setup(() => ({ port: 80 }));
			let builds = 0;
			const actual = defineContext("config").setup(() => {
				builds++;
				return compatible ? { port: 80 } : { label: "wrong" };
			});
			const app = new Crust("cli")
				.provide(actual())
				.action(
					handler(() =>
						service(expected).pipe(
							Effect.catchTag("CrustDefinitionError", (error) => Effect.succeed(error)),
						),
					),
				);
			const outcome = await app.run([]);
			expect(outcome.status === "completed" && outcome.result).toBeInstanceOf(CrustDefinitionError);
			expect(builds).toBe(0);
		},
	);

	it("rejects a matching ancestor factory shadowed by a different descendant factory", async () => {
		const expected = defineContext("config").setup(() => ({ port: 80 }));
		let builds = 0;
		const replacement = defineContext("config").setup(() => {
			builds++;
			return { label: "replacement" };
		});
		const app = new Crust("cli")
			.provide(expected())
			.command("child", (child) =>
				child
					.provide(replacement())
					.action(
						handler(() =>
							service(expected).pipe(
								Effect.catchTag("CrustDefinitionError", (error) => Effect.succeed(error)),
							),
						),
					),
			);
		const outcome = await app.run(["child"]);
		expect(outcome.status === "completed" && outcome.result).toBeInstanceOf(CrustDefinitionError);
		expect(builds).toBe(0);

		const effective = new Crust("cli").provide(expected()).command("child", (child) =>
			child.provide(replacement()).action(
				handler(function* () {
					return (yield* service(replacement)).label;
				}),
			),
		);
		const resolved = await effective.run(["child"]);
		expect(resolved.status === "completed" && resolved.result).toBe("replacement");
		expect(builds).toBe(1);
	});

	it("accepts descendant same-factory .of shadowing", async () => {
		const config = defineContext("config").setup(() => ({ port: 80 }));
		const app = new Crust("cli").provide(config()).command("child", (child) =>
			child.provide(config.of({ port: 123 })).action(
				handler(function* () {
					return (yield* service(config)).port;
				}),
			),
		);
		const outcome = await app.run(["child"]);
		expect(outcome.status === "completed" && outcome.result).toBe(123);
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
	it("renders a failing layer release after the program failure", async () => {
		const db = layer(
			"db",
			Layer.effect(
				Db,
				Effect.acquireRelease(Effect.succeed({ query: () => "row" }), () =>
					Effect.sync(() => {
						throw new Error("db release failed");
					}),
				),
			),
		);
		const app = new Crust("cli")
			.provide(db())
			.action(handler(() => Effect.fail(new Error("boom"))));

		const captured = await captureExecute(app, []);

		expect(captured.exitCode).toBe(1);
		expect(captured.stderr).toContain("Error: boom");
		expect(captured.stderr).toContain("Cleanup failed: ");
		expect(captured.stderr).toContain("db release failed");
	});

	it.each([new DOMException("Caller cancelled.", "AbortError"), new Error("deadline exceeded")])(
		"interrupts the program and finalizers regardless of the caller's abort reason: %s",
		async (reason) => {
			const exits: Exit.Exit<unknown, unknown>[] = [];
			const db = layer(
				"db",
				resource([], Db, "db", { query: (sql) => sql }, (exit) => exits.push(exit)),
			);
			const controller = new AbortController();
			const started = Promise.withResolvers<void>();
			const app = new Crust("cli").provide(db()).action(
				handler(function* () {
					yield* Db;
					started.resolve();
					return yield* Effect.never;
				}),
			);
			const stderr: string[] = [];
			// Direct execute() (captureExecute has no signal option) sets process.exitCode; restore it.
			const previousExitCode = process.exitCode;
			try {
				const exitCode = app.execute({
					argv: [],
					io: { stdout() {}, stderr: (text) => stderr.push(text) },
					signal: controller.signal,
				});

				await started.promise;
				controller.abort(reason);

				expect(await exitCode).toBe(130);
			} finally {
				process.exitCode = previousExitCode;
			}
			expect(stderr).toEqual([]);
			expect(exits).toHaveLength(1);
			expect(Exit.isFailure(exits[0]!) && Cause.hasInterruptsOnly(exits[0].cause)).toBe(true);
		},
	);

	it.each(["separate", "composed"])(
		"interrupts acquisition and releases acquired resources in %s Layers",
		async (arrangement) => {
			const exits: Exit.Exit<unknown, unknown>[] = [];
			const db = resource([], Db, "db", { query: (sql) => sql }, (exit) => exits.push(exit));
			const acquiring = Promise.withResolvers<void>();
			const cache = Layer.effect(
				Cache,
				Effect.gen(function* () {
					acquiring.resolve();
					return yield* Effect.never;
				}),
			);
			const providers =
				arrangement === "composed"
					? [layer("both", Layer.merge(db, cache))()]
					: [layer("db", db)(), layer("cache", cache)()];
			const controller = new AbortController();
			const outcome = new Crust("cli")
				.provide(...providers)
				.action(handler(() => Effect.succeed("unreachable")))
				.run([], {}, { signal: controller.signal });

			await acquiring.promise;
			controller.abort(new DOMException("Caller cancelled.", "AbortError"));

			const result = await outcome;
			expect(result.status === "failed" && (result.error as Error).name).toBe("AbortError");
			expect(exits).toHaveLength(1);
			expect(Exit.isFailure(exits[0]!) && Cause.hasInterruptsOnly(exits[0].cause)).toBe(true);
		},
	);
});
