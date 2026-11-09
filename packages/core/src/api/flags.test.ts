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
	});
});

describe("checked attachments", () => {
	it("checks destination relations and owns definition collections", async () => {
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
