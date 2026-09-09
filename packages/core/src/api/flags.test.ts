import { describe, expect, it } from "bun:test";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { Crust } from "../command/crust.ts";
import { runtime } from "../runtime.ts";
import { defineArg, defineFlag } from "./flags.ts";

describe("defineFlag", () => {
	it("returns the named definition with literal types preserved", () => {
		const verbose = defineFlag("verbose", { type: "boolean", short: "v" });

		expect(verbose).toEqual({ name: "verbose", type: "boolean", short: "v" });
		type _Flag = Expect<
			Equal<
				typeof verbose,
				{
					readonly name: "verbose";
					readonly type: "boolean";
					readonly short: "v";
				}
			>
		>;

		// @ts-expect-error -- boolean flags cannot have string defaults
		defineFlag("bad", { type: "boolean", default: "true" });
		// @ts-expect-error -- every definition must be a FlagDef
		defineFlag("bad", { type: "not-a-flag" });
	});

	it("feeds .flags() with the same record typing as an inline literal", async () => {
		const verbose = defineFlag("verbose", { type: "boolean" });
		const app = new Crust("cli").flags(verbose, { name: "output", type: "string", short: "o" });

		type Flags = (typeof app)["_types"]["flags"];
		type _Verbose = Expect<Equal<Flags["verbose"], { readonly type: "boolean" }>>;
		type _Output = Expect<Equal<Flags["output"], { readonly type: "string"; readonly short: "o" }>>;
		expect((await app.snapshot()).flags).toEqual({
			verbose: { type: "boolean", negatable: true },
			output: { type: "string", short: "o", negatable: false },
		});
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

		// @ts-expect-error -- number args cannot have string defaults
		defineArg("bad", { type: "number", default: "1" });
		// @ts-expect-error -- every definition must be an ArgDef
		defineArg("bad", { type: "not-an-arg" });
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
		const input = runtime({ type: "string" as const, aliases, choices: ["a"], default: "a" });
		aliases.push("v");
		expect(() => defineFlag("value", input)).toThrow("repeats");
		aliases.pop();
		const flag = defineFlag("value", input);
		aliases.push("later");
		expect(flag.aliases).toEqual(["v"]);
		expect(() => defineFlag(runtime(""), { type: "boolean" })).toThrow("non-empty");
		expect(() => defineFlag("value", runtime({ type: "boolean", short: "xx" }))).toThrow(
			"one character",
		);
		expect(() => defineArg(runtime(""), { type: "string" })).toThrow("non-empty");
		expect(() =>
			defineArg("mode", runtime({ type: "string", choices: ["a"], default: "b" })),
		).toThrow("choices");
	});
});

describe("checked attachments", () => {
	it("checks destination relations and owns definition collections", async () => {
		const local = defineFlag("value", runtime({ type: "string", aliases: ["v"] }));
		const app = new Crust("cli").flags(runtime([local]));
		expect(() => app.flags(runtime([local]))).toThrow("collides");
		expect(() =>
			new Crust("cli").args(
				runtime([
					{ name: "files", type: "string", variadic: true },
					{ name: "later", type: "string" },
				]),
			),
		).toThrow("last positional");
		expect(() =>
			new Crust("cli")
				.args({ name: "a", type: "string" })
				.args(runtime([{ name: "a", type: "number" }])),
		).toThrow("already defined");
		const choices = ["a"];
		const defaults = ["a"];
		const attached = new Crust("cli")
			.flags(
				runtime([{ name: "mode", type: "string", multiple: true, choices, default: defaults }]),
			)
			.action(({ flags }) => flags.mode);
		choices.length = 0;
		defaults[0] = "b";
		expect(await attached.run([], {})).toMatchObject({ result: ["a"] });
	});
});

it("defers checked parsers until binding and preserves payload identity", async () => {
	let calls = 0;
	const flag = defineFlag(
		"value",
		runtime({
			type: "string",
			parse: (raw: string) => {
				calls++;
				return Promise.resolve(raw);
			},
		}),
	);
	const app = new Crust("cli").flags(runtime([flag]));
	expect(calls).toBe(0);
	await expect(app.run([], runtime({ flags: { value: "input" } }))).rejects.toThrow("synchronous");
	expect(calls).toBe(1);
	const payload = { key: "value" };
	const endpoint = new URL("https://example.com");
	const defaults = new Crust("cli")
		.flags(
			runtime([
				{ name: "json", type: "json", default: payload },
				{ name: "url", type: "url", multiple: true, default: [endpoint] },
			]),
		)
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
		.flags(runtime([{ name: "mode", type: "string", multiple: true, default: ["a"] }]))
		.action(({ flags }) => {
			flags.mode.push("b");
			return flags.mode;
		});
	expect(await app.run([])).toMatchObject({ result: ["a", "b"] });
	expect(await app.run([])).toMatchObject({ result: ["a", "b"] });
});
