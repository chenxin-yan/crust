import { describe, expect, it } from "bun:test";

import { Crust, CrustError, defineContext } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { Cause, Context, Effect, Exit, Layer } from "effect";

import { effectAction } from "./action.ts";
import { effectContext } from "./context.ts";
import { tryCrust } from "./errors.ts";

class Db extends Context.Service<Db, { readonly query: (sql: string) => string }>()("test/Db") {}
class Cache extends Context.Service<Cache, { readonly get: (key: string) => string }>()(
	"test/Cache",
) {}

function resource<Self, Shape>(
	log: string[],
	service: Context.Key<Self, Shape>,
	label: string,
	shape: Shape,
	onRelease?: (exit: Exit.Exit<unknown, unknown>) => void,
): Layer.Layer<Self> {
	return Layer.effect(
		service,
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

describe("effectAction with effectContext", () => {
	it("acquires Layers at invocation start and releases them in reverse order after a successful action", async () => {
		const log: string[] = [];
		const db = effectContext("db", resource(log, Db, "db", { query: (sql) => `rows(${sql})` }));
		const cache = effectContext("cache", resource(log, Cache, "cache", { get: (key) => key }));
		const app = new Crust("cli")
			.provide(db(), cache())
			.args({ name: "table", type: "string", required: true })
			.action(
				effectAction([db, cache], ({ args }) =>
					Effect.gen(function* () {
						const database = yield* Db;
						yield* Cache;
						log.push("action");
						return database.query(`select * from ${args.table}`);
					}),
				),
			);

		const outcome = await app.run([], { args: { table: "users" } });

		expect(outcome.status).toBe("completed");
		expect(outcome.status === "completed" && outcome.result).toBe("rows(select * from users)");
		expect(log).toEqual(["acquire db", "acquire cache", "action", "release cache", "release db"]);
	});

	it("releases two Contexts in reverse order after a failing action", async () => {
		const log: string[] = [];
		const db = effectContext("db", resource(log, Db, "db", { query: (sql) => sql }));
		const cache = effectContext("cache", resource(log, Cache, "cache", { get: (key) => key }));
		const boom = new Error("boom");
		const app = new Crust("cli").provide(db(), cache()).action(
			effectAction([db, cache], () =>
				Effect.gen(function* () {
					yield* Db;
					yield* Cache;
					log.push("action");
					return yield* Effect.fail(boom);
				}),
			),
		);

		const outcome = await app.run([]);

		expect(outcome.status).toBe("failed");
		expect(outcome.status === "failed" && outcome.error).toBe(boom);
		expect(log).toEqual(["acquire db", "acquire cache", "action", "release cache", "release db"]);
	});

	it("hands the action's Exit to finalizers", async () => {
		const exits: Exit.Exit<unknown, unknown>[] = [];
		const db = effectContext(
			"db",
			resource([], Db, "db", { query: (sql) => sql }, (exit) => exits.push(exit)),
		);
		const run = (program: Effect.Effect<unknown, unknown, Db>) =>
			new Crust("cli")
				.provide(db())
				.action(effectAction([db], () => program))
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

	it("keeps plain Contexts lazy and reachable from the action input", async () => {
		const log: string[] = [];
		let configBuilt = 0;
		const db = effectContext("db", resource(log, Db, "db", { query: (sql) => sql }));
		const config = defineContext("config", () => {
			configBuilt++;
			return { prefix: "cfg" };
		});
		const untouched = defineContext("untouched", () => {
			throw new Error("must stay lazy");
		});
		const app = new Crust("cli").provide(db(), config(), untouched()).action(
			effectAction([db], ({ ctx }) =>
				Effect.gen(function* () {
					const database = yield* Db;
					const { prefix } = yield* Effect.promise(() => ctx.config);
					return database.query(`${prefix}:select`);
				}),
			),
		);

		const outcome = await app.run([]);

		expect(outcome.status === "completed" && outcome.result).toBe("cfg:select");
		expect(configBuilt).toBe(1);
	});

	it("ignores a plain Context that shares its name with an Effect Context in another app", async () => {
		effectContext("shared", Layer.succeed(Db, { query: (sql) => sql }));
		const shared = defineContext("shared", () => {
			throw new Error("must stay lazy");
		});
		const app = new Crust("other")
			.provide(shared())
			.action(effectAction(() => Effect.succeed("plain")));

		const outcome = await app.run([]);

		expect(outcome.status === "completed" && outcome.result).toBe("plain");
	});

	it("fails with Core's missing-provider error when a listed Context is not on the path", async () => {
		const db = effectContext("db", Layer.succeed(Db, { query: (sql) => sql }));
		const app = new Crust("cli").action(effectAction([db], () => Effect.map(Db, () => "x")));

		const outcome = await app.run([]);

		expect(outcome.status).toBe("failed");
		const error = outcome.status === "failed" ? outcome.error : undefined;
		expect(error).toBeInstanceOf(CrustError);
		expect((error as CrustError).is("DEFINITION")).toBe(true);
		expect((error as CrustError<"DEFINITION">).details).toEqual({
			subject: "context",
			name: "db",
			reason: "missing-context",
		});
	});
});

describe("effectAction under execute()", () => {
	it("renders a failing Effect exactly like a plain thrown error", async () => {
		const plain = new Crust("cli").action(() => {
			throw new Error("boom");
		});
		const effectful = new Crust("cli").action(effectAction(() => Effect.fail(new Error("boom"))));

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
			effectAction(() =>
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
			effectAction(() =>
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
