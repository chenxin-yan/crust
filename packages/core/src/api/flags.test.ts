import { describe, expect, it } from "vite-plus/test";

import { type Equal, type Expect, unwrap } from "../../tests/helpers.ts";
import { Crust } from "../command/crust.ts";
import { defineArg, defineFlag } from "./flags.ts";

describe("defineFlag", () => {
	it("rejects a malformed env hidden by a structural view", () => {
		const options = { description: "Token", env: "TOKEN" };
		function token(def: { description: string }) {
			return defineFlag({ ...def, type: "string" });
		}

		expect(() => token(options)).toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				details: { subject: "flag", reason: "invalid-env" },
			}),
		);
	});

	it("rejects an env delimiter hidden by a structural view on a scalar flag", () => {
		const binding = { name: "TAGS", delimiter: "," };
		function scalar(env: { name: string }) {
			return defineFlag({ type: "string", env });
		}

		expect(() => scalar(binding)).toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				details: { subject: "flag", reason: "delimiter-without-multiple" },
			}),
		);
	});

	it("rejects a delimiter hidden by a structural view on a scalar flag", () => {
		const options = { description: "Tags", delimiter: "," };
		function scalar(def: { description: string }) {
			return defineFlag({ ...def, type: "string" });
		}

		expect(() => scalar(options)).toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				details: { subject: "flag", reason: "delimiter-without-multiple" },
			}),
		);
	});

	it("returns the definition with literal types preserved", () => {
		const verbose = defineFlag({ type: "boolean", short: "v" });

		expect(verbose).toEqual({ type: "boolean", short: "v" });
		type _Flag = Expect<Equal<typeof verbose, { readonly type: "boolean"; readonly short: "v" }>>;
	});

	it("rejects the removed name argument from untyped callers", () => {
		// SAFETY: models an untyped JavaScript caller; the runtime guard owns this input.
		const untyped = defineFlag as unknown as (...input: unknown[]) => unknown;
		expect(() => untyped("verbose", { type: "boolean" })).toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				details: { subject: "flag", reason: "invalid-flags" },
			}),
		);
	});

	it("feeds .flags() with the same record typing as an inline literal", async () => {
		const verbose = defineFlag({ type: "boolean" });
		const app = new Crust("cli").flags({ verbose, output: { type: "string", short: "o" } });

		type Flags = (typeof app)["_types"]["flags"];
		type _Verbose = Expect<Equal<Flags["verbose"], { readonly type: "boolean" }>>;
		type _Output = Expect<Equal<Flags["output"], { readonly type: "string"; readonly short: "o" }>>;
		expect((await app.snapshot()).flags).toEqual({
			verbose: { type: "boolean", negatable: true },
			output: { type: "string", short: "o", negatable: false },
		});
	});
});

describe("defineFlag(def)", () => {
	it("returns a frozen definition that takes its name from the key it is attached under", async () => {
		const format = defineFlag({ type: "string", choices: ["json", "yaml"], default: "json" });
		type _Format = Expect<
			Equal<
				typeof format,
				{
					readonly type: "string";
					readonly choices: readonly ["json", "yaml"];
					readonly default: "json";
				}
			>
		>;
		expect(Object.isFrozen(format)).toBe(true);
		expect(Object.isFrozen(format.choices)).toBe(true);

		const app = new Crust("cli").flags({ format, output: format });
		expect(Object.keys((await app.snapshot()).flags)).toEqual(["format", "output"]);
		const outcome = await unwrap(app.run([], { flags: { output: "yaml" } }));
		expect(outcome.status).toBe("completed");
	});

	it("checks the definition eagerly without a name", () => {
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises helper validation.
		expect(() => defineFlag({ type: "boolean", short: "xx" })).toThrow(
			expect.objectContaining({
				message: 'Flag short "xx" must be one character',
				details: { subject: "flag", reason: "invalid-short" },
			}),
		);
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises helper validation.
		expect(() => defineFlag({ type: "string", choices: ["a"], default: "b" })).toThrow(
			expect.objectContaining({
				message: "Flag default must be one of choices",
				details: { subject: "flag", reason: "default-outside-choices" },
			}),
		);
	});
});

describe("defineArg", () => {
	it("returns the named definition with literal types preserved", () => {
		const target = defineArg("target", { type: "string", required: true });

		expect(target).toEqual({ name: "target", type: "string", required: true });
		type _Arg = Expect<
			Equal<
				typeof target,
				{ readonly name: "target"; readonly type: "string"; readonly required: true }
			>
		>;
	});

	it("feeds .args() with the same tuple typing as an inline literal", async () => {
		const target = defineArg("target", { type: "string", required: true });
		const app = new Crust("cli").args(target, { name: "count", type: "number", default: 1 });

		type Args = (typeof app)["_types"]["args"];
		type _Args = Expect<
			Equal<
				Args,
				readonly [
					{ readonly name: "target"; readonly type: "string"; readonly required: true },
					{ readonly name: "count"; readonly type: "number"; readonly default: 1 },
				]
			>
		>;
		expect((await app.snapshot()).args.map((def) => def.name)).toEqual(["target", "count"]);
	});
});

describe("checked local definitions", () => {
	it("checks at consumption and snapshots only structural collections", () => {
		const aliases = ["v"];
		const input = { type: "string" as const, aliases, choices: ["a"], default: "a" };
		aliases.push("v");
		expect(() => defineFlag(input)).toThrow("repeats");
		aliases.pop();
		const flag = defineFlag(input);
		aliases.push("later");
		expect(flag.aliases).toEqual(["v"]);
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		expect(() => new Crust("cli").flags({ "": { type: "boolean" } })).toThrow("non-empty");
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		expect(() => defineFlag({ type: "boolean", short: "xx" })).toThrow("one character");
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		expect(() => defineArg("", { type: "string" })).toThrow("non-empty");
		expect(() =>
			// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises helper validation.
			defineArg("mode", { type: "string", choices: ["a"], default: "b" }),
		).toThrow("choices");
	});
});

describe("checked attachments", () => {
	it("checks destination relations and owns definition collections", async () => {
		const local = defineFlag({ type: "string", aliases: ["v"] });
		const app = new Crust("cli").flags({ value: local });
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		expect(() => app.flags({ value: local })).toThrow("collides");
		expect(() =>
			new Crust("cli").args(
				// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
				{ name: "files", type: "string", variadic: true },
				{ name: "later", type: "string" },
			),
		).toThrow("last positional");
		expect(() =>
			new Crust("cli")
				.args({ name: "a", type: "string" })
				// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
				.args({ name: "a", type: "number" }),
		).toThrow("already defined");
		const choices = ["a"];
		const defaults = ["a"];
		const attached = new Crust("cli")
			.flags({ mode: { type: "string", multiple: true, choices, default: defaults } })
			.action(({ flags }) => flags.mode);
		choices.length = 0;
		defaults[0] = "b";
		expect(await attached.run([], {})).toMatchObject({ result: ["a"] });
	});
});

it("defers helper parsers until invocation and calls them once", async () => {
	let calls = 0;
	// @ts-expect-error -- runtime regression deliberately exercises Promise rejection.
	const flag = defineFlag({
		type: "string",
		parse: (raw: string) => {
			calls++;
			return Promise.resolve(raw);
		},
	});
	// @ts-expect-error -- runtime regression deliberately consumes the invalid helper.
	const app = new Crust("cli").flags({ value: flag });
	expect(calls).toBe(0);
	await expect(unwrap(app.run([], { flags: { value: "input" } }))).rejects.toThrow("synchronous");
	expect(calls).toBe(1);
});

it("preserves default payload identity", async () => {
	const payload = { key: "value" };
	const endpoint = new URL("https://example.com");
	const defaults = new Crust("cli")
		.flags({
			json: { type: "json", default: payload },
			url: { type: "url", multiple: true, default: [endpoint] },
		})
		.action(({ flags }) => flags);
	const outcome = await defaults.run([]);
	if (outcome.status !== "completed") throw new Error("Expected completed invocation");
	expect(outcome.result.json).toBe(payload);
	expect(outcome.result.url[0]).toBe(endpoint);
	expect(Object.isFrozen(payload)).toBe(false);
	expect(Object.isFrozen(endpoint)).toBe(false);
});

it("keeps occurrence results mutable without exposing stored defaults", async () => {
	const app = new Crust("cli")
		.flags({ mode: { type: "string", multiple: true, default: ["a"] } })
		.action(({ flags }) => {
			flags.mode.push("b");
			return flags.mode;
		});
	expect(await app.run([])).toMatchObject({ result: ["a", "b"] });
	expect(await app.run([])).toMatchObject({ result: ["a", "b"] });
});
