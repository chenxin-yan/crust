import { Crust, CrustError } from "@crustjs/core";
import { describe, expect, it } from "vite-plus/test";

import { defineEnv, type EnvOptions, type EnvVarsDef } from "./index.ts";

type Schema = NonNullable<EnvVarsDef[string]["schema"]>;
type StandardInput = Parameters<Schema["~standard"]["validate"]>[0];

/** Minimal async Standard Schema (no vendor dependency). */
function schema(
	validate: (value: StandardInput) => { value: unknown } | { issues: { message: string }[] },
): Schema {
	return {
		"~standard": { version: 1, vendor: "crust-test", validate: async (value) => validate(value) },
	};
}

async function read<V extends EnvVarsDef>(vars: V, options?: EnvOptions) {
	const env = defineEnv("env", vars, options);
	const outcome = await new Crust("cli")
		.provide(env())
		.action(async ({ ctx }) => ctx.env)
		.run([]);
	if (outcome.status === "failed") throw outcome.error;
	if (outcome.status !== "completed") throw new Error(`unexpected ${outcome.status}`);
	return outcome.result;
}

async function failure(vars: EnvVarsDef, options?: EnvOptions): Promise<CrustError<"ENV">> {
	try {
		await read(vars, options);
	} catch (error) {
		if (error instanceof CrustError && error.is("ENV")) return error;
		throw error;
	}
	throw new Error("expected ENV error");
}

const vars = {
	DATABASE_URL: { type: "url", required: true, description: "Postgres connection" },
	PORT: { type: "number", default: 3000 },
	LOG_LEVEL: { type: "string", choices: ["debug", "info", "warn"], default: "info" },
	TAGS: { type: "string", multiple: true, delimiter: "," },
} as const;

describe("defineEnv", () => {
	it("coerces, splits, and defaults through the flag pipeline", async () => {
		const value = await read(vars, {
			source: { DATABASE_URL: "postgres://db/app", TAGS: "a,,b," },
		});
		expect(value).toEqual({
			DATABASE_URL: new URL("postgres://db/app"),
			PORT: 3000,
			LOG_LEVEL: "info",
			TAGS: ["a", "b"],
		});
	});

	it("defaults the source to process.env, read at first access", async () => {
		const env = defineEnv("env", { CRUST_ENV_TEST_PORT: { type: "number" } });
		const app = new Crust("cli").provide(env()).action(async ({ ctx }) => ctx.env);
		process.env.CRUST_ENV_TEST_PORT = "42";
		try {
			await expect(app.run([])).resolves.toMatchObject({ result: { CRUST_ENV_TEST_PORT: 42 } });
		} finally {
			delete process.env.CRUST_ENV_TEST_PORT;
		}
	});

	it("never fails a command that does not read the Context", async () => {
		const env = defineEnv("env", { KEY: { type: "string", required: true } }, { source: {} });
		const outcome = await new Crust("cli")
			.provide(env())
			.action(() => "ok")
			.run([]);
		expect(outcome).toMatchObject({ status: "completed", result: "ok" });
	});

	it("aggregates every missing and invalid variable without values", async () => {
		const secret = "hunter2-secret";
		const error = await failure(
			{
				...vars,
				JSON_CFG: { type: "json" },
				CUSTOM: {
					type: "string",
					parse: (raw: string) => {
						throw new Error(`bad ${raw}`);
					},
				},
				MODE: { type: "string", schema: schema(() => ({ issues: [{ message: `no ${secret}` }] })) },
			},
			{
				source: {
					DATABASE_URL: secret,
					PORT: secret,
					LOG_LEVEL: secret,
					JSON_CFG: secret,
					CUSTOM: secret,
					MODE: secret,
				},
			},
		);
		expect(error.details.issues).toEqual([
			{ name: "DATABASE_URL", expected: "url", received: "invalid" },
			{ name: "PORT", expected: "number", received: "invalid" },
			{ name: "LOG_LEVEL", expected: "one of: debug, info, warn", received: "invalid" },
			{ name: "JSON_CFG", expected: "json", received: "invalid" },
			{ name: "CUSTOM", expected: "value accepted by parse", received: "invalid" },
			{ name: "MODE", expected: "value accepted by schema", received: "invalid" },
		]);
		expect(error.cause).toBeUndefined();
		expect(error.message).toContain("PORT: invalid (expected number)");
		expect(`${error.message}${JSON.stringify(error)}${String(error.stack)}`).not.toContain(secret);
	});

	it("reports required and zero-occurrence variables as missing", async () => {
		const error = await failure(
			{
				KEY: { type: "string", required: true },
				LIST: { type: "string", multiple: true, delimiter: ",", required: true },
				OPTIONAL: { type: "string" },
			},
			{ source: { LIST: ",," } },
		);
		expect(error.details.issues).toEqual([
			{ name: "KEY", expected: "string", received: "missing" },
			{ name: "LIST", expected: "list of string", received: "missing" },
		]);
	});

	it("keeps empty strings unless emptyStringAsUndefined", async () => {
		const defs = { NAME: { type: "string", default: "anon" } } as const;
		await expect(read(defs, { source: { NAME: "" } })).resolves.toEqual({ NAME: "" });
		await expect(
			read(defs, { source: { NAME: "" }, emptyStringAsUndefined: true }),
		).resolves.toEqual({ NAME: "anon" });
		const error = await failure(
			{ KEY: { type: "string", required: true } },
			{ source: { KEY: "" }, emptyStringAsUndefined: true },
		);
		expect(error.details.issues).toEqual([
			{ name: "KEY", expected: "string", received: "missing" },
		]);
	});

	it("awaits async schemas; boolean schemas receive coerced booleans", async () => {
		const seen: StandardInput[] = [];
		const port = schema((raw) => {
			const value = Number(raw);
			return Number.isInteger(value) ? { value } : { issues: [{ message: "integer" }] };
		});
		const flag = schema((raw) => {
			seen.push(raw);
			return { value: raw === true ? "on" : "off" };
		});
		await expect(
			read(
				{ PORT: { type: "string", schema: port }, DEBUG: { type: "boolean", schema: flag } },
				{ source: { PORT: "8080", DEBUG: "1" } },
			),
		).resolves.toEqual({ PORT: 8080, DEBUG: "on" });
		expect(seen).toEqual([true]);
	});

	it("parses booleans like flag environment fallbacks", async () => {
		await expect(
			read(
				{ A: { type: "boolean" }, B: { type: "boolean" }, C: { type: "boolean" } },
				{ source: { A: "true", B: "0" } },
			),
		).resolves.toEqual({ A: true, B: false, C: undefined });
	});

	it("reads only own source properties, including prototype-like names", async () => {
		const source = Object.defineProperty({}, "__proto__", { value: "7", enumerable: true });
		const value = await read(
			{ ["__proto__"]: { type: "number" }, constructor: { type: "string" } } as const,
			{ source },
		);
		expect(Object.hasOwn(value, "__proto__")).toBe(true);
		expect(value).toEqual(
			Object.defineProperty({ constructor: undefined }, "__proto__", {
				value: 7,
				enumerable: true,
			}),
		);
	});

	it("skipValidation returns declared raw values without defaults or coercion", async () => {
		await expect(
			read(vars, {
				skipValidation: true,
				emptyStringAsUndefined: true,
				source: { PORT: "not-a-number", TAGS: "", EXTRA: "x" },
			}),
		).resolves.toEqual({
			DATABASE_URL: undefined,
			PORT: "not-a-number",
			LOG_LEVEL: undefined,
			TAGS: undefined,
		});
	});
});

function definitionError(define: () => void): CrustError<"DEFINITION"> {
	try {
		define();
	} catch (error) {
		if (error instanceof CrustError && error.is("DEFINITION")) return error;
		throw error;
	}
	throw new Error("expected DEFINITION error");
}

describe("defineEnv definitions", () => {
	it("rejects a default outside choices and an empty delimiter when defined", () => {
		expect(
			definitionError(() =>
				defineEnv("env", { LEVEL: { type: "string", choices: ["ok"], default: "bad" } }),
			).message,
		).toContain('"LEVEL"');
		expect(
			definitionError(() =>
				defineEnv("env", { TAGS: { type: "string", multiple: true, delimiter: "" } }),
			).details,
		).toMatchObject({ name: "TAGS", reason: "empty-delimiter" });
	});

	it("rejects flag-only keys when defined, as untyped callers could pass them", () => {
		function expectFlagOnly(key: string, vars: EnvVarsDef): void {
			const error = definitionError(() => defineEnv("env", vars));
			expect(error.details).toMatchObject({ name: "DEBUG", reason: "flag-only-key" });
			expect(error.message).toContain(`"${key}"`);
		}
		// @ts-expect-error -- flag-only key under test
		expectFlagOnly("short", { DEBUG: { type: "boolean", short: "s" } });
		// @ts-expect-error -- flag-only key under test
		expectFlagOnly("aliases", { DEBUG: { type: "boolean", aliases: ["x"] } });
		// @ts-expect-error -- flag-only key under test
		expectFlagOnly("negatable", { DEBUG: { type: "boolean", negatable: true } });
		// @ts-expect-error -- flag-only key under test
		expectFlagOnly("noNegate", { DEBUG: { type: "boolean", noNegate: true } });
		// @ts-expect-error -- flag-only key under test
		expectFlagOnly("hidden", { DEBUG: { type: "boolean", hidden: true } });
		// @ts-expect-error -- flag-only key under test
		expectFlagOnly("env", { DEBUG: { type: "boolean", env: { name: "OTHER" } } });
	});

	it("owns definitions and option settings at definition; source values stay live", async () => {
		const defs = {
			PORT: { type: "number", default: 3000 },
			LEVEL: { type: "string", choices: ["debug", "info"], default: "info" },
			TAGS: { type: "string", multiple: true, default: ["a"] },
		} satisfies EnvVarsDef;
		const source: Record<string, string | undefined> = {};
		const options = { source, skipValidation: false };
		const env = defineEnv("env", defs, options);
		defs.PORT.default = 1;
		defs.LEVEL.choices.push("bad");
		defs.TAGS.default.push("b");
		options.skipValidation = true;
		source.LEVEL = "debug";
		const app = new Crust("cli").provide(env()).action(async ({ ctx }) => ctx.env);
		await expect(app.run([])).resolves.toMatchObject({
			result: { PORT: 3000, LEVEL: "debug", TAGS: ["a"] },
		});
		const snapshot = await app.snapshot();
		expect(snapshot.meta.sections?.[0]?.body).toContain("[default: 3000]");
		expect(snapshot.meta.sections?.[0]?.body).not.toContain("bad");
	});
});

describe("Environment section", () => {
	it("documents names and declared metadata on the providing command only", async () => {
		const env = defineEnv("env", vars, { source: { DATABASE_URL: "postgres://secret@db" } });
		const app = new Crust("cli").command("db", (db) => db.provide(env()).action(() => {}));
		const snapshot = await app.snapshot();
		expect(snapshot.meta.sections ?? []).toEqual([]);
		expect(snapshot.subCommands.db?.meta.sections).toEqual([
			{
				title: "Environment",
				body: [
					"DATABASE_URL  Postgres connection",
					"PORT          [default: 3000]",
					'LOG_LEVEL     [default: "info"] [choices: debug, info, warn]',
					"TAGS",
				].join("\n"),
			},
		]);
	});
});
