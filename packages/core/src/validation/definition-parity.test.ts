import { describe, expect, it } from "vite-plus/test";

import { type Equal, type Expect, unwrap } from "../../tests/helpers.ts";
import { Crust, defineCommand } from "../command/crust.ts";
import type { DefinitionErrorReason } from "../errors.ts";
import { defineExtensionId } from "../identity.ts";
import type { TrimWhitespace } from "./shared.ts";

// Core rejects each invalid definition twice: a type brand for literals and a runtime check for
// values the types cannot see. Every case below is written once and pins both: its
// `@ts-expect-error` fails `check:types` if the brand loosens, and its assertion fails the test
// if the runtime check loosens.

function definitionError(reason: DefinitionErrorReason) {
	return expect.objectContaining({
		name: "CrustError",
		code: "DEFINITION",
		details: expect.objectContaining({ reason }),
	});
}

describe("flag spellings", () => {
	it("rejects invalid canonical names", () => {
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- empty name
				"": { type: "string" },
			}),
		).toThrow(definitionError("empty-spelling"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- `no-` is reserved for negation
				"no-x": { type: "boolean" },
			}),
		).toThrow(definitionError("reserved-no-prefix"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- integer-like name
				"1": { type: "string" },
			}),
		).toThrow(definitionError("integer-like-name"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- integer-like name beyond the array-index range
				"4294967295": { type: "string" },
			}),
		).toThrow(definitionError("integer-like-name"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- `__proto__` is reserved
				["__proto__"]: { type: "string" },
			}),
		).toThrow(definitionError("reserved-spelling"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- whitespace in name
				"a b": { type: "string" },
			}),
		).toThrow(definitionError("invalid-spelling"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- tab in name
				"a\tb": { type: "string" },
			}),
		).toThrow(definitionError("invalid-spelling"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- leading dash
				"-a": { type: "string" },
			}),
		).toThrow(definitionError("invalid-spelling"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- `=` in a long spelling
				"a=b": { type: "string" },
			}),
		).toThrow(definitionError("invalid-spelling"));
	});

	it("rejects invalid shorts", () => {
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- empty short
				a: { type: "string", short: "" },
			}),
		).toThrow(definitionError("empty-spelling"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- short longer than one character
				a: { type: "string", short: "ab" },
			}),
		).toThrow(definitionError("invalid-short"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- two code points, one of them astral
				a: { type: "string", short: "\u{1F600}f" },
			}),
		).toThrow(definitionError("invalid-short"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- dash short
				a: { type: "string", short: "-" },
			}),
		).toThrow(definitionError("invalid-spelling"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- whitespace short
				a: { type: "string", short: " " },
			}),
		).toThrow(definitionError("invalid-spelling"));
	});

	it("rejects invalid aliases", () => {
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- `no-` is reserved for negation
				a: { type: "boolean", aliases: ["no-b"] },
			}),
		).toThrow(definitionError("reserved-no-prefix"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- empty alias
				a: { type: "string", aliases: [""] },
			}),
		).toThrow(definitionError("empty-spelling"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- whitespace in alias
				a: { type: "string", aliases: ["b c"] },
			}),
		).toThrow(definitionError("invalid-spelling"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- `=` in alias
				a: { type: "string", aliases: ["b=c"] },
			}),
		).toThrow(definitionError("invalid-spelling"));
	});

	it("rejects spelling collisions", () => {
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- alias repeats the flag's own short
				a: { type: "string", short: "x", aliases: ["x"] },
			}),
		).toThrow(definitionError("flag-collision"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- alias repeats the flag's own name
				a: { type: "string", aliases: ["a"] },
			}),
		).toThrow(definitionError("flag-collision"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- two flags share a short
				a: { type: "string", short: "x" },
				// @ts-expect-error -- two flags share a short
				b: { type: "string", short: "x" },
			}),
		).toThrow(definitionError("flag-collision"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- alias claims another flag's name
				a: { type: "string" },
				// @ts-expect-error -- alias claims another flag's name
				b: { type: "string", aliases: ["a"] },
			}),
		).toThrow(definitionError("flag-collision"));
		expect(() =>
			new Crust("cli")
				.flags({ a: { type: "string" } })
				// @ts-expect-error -- name collides across `.flags()` calls
				.flags({ a: { type: "string" } }),
		).toThrow(definitionError("flag-collision"));
	});
});

describe("flag values", () => {
	it("rejects invalid defaults, delimiters and env bindings", () => {
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- default outside choices
				a: { type: "string", choices: ["x", "y"], default: "z" },
			}),
		).toThrow(definitionError("default-outside-choices"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- multiple default outside choices
				a: { type: "string", multiple: true, choices: ["x"], default: ["z"] },
			}),
		).toThrow(definitionError("default-outside-choices"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- delimiter requires multiple
				a: { type: "string", delimiter: "," },
			}),
		).toThrow(definitionError("delimiter-without-multiple"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- empty delimiter
				a: { type: "string", multiple: true, delimiter: "" },
			}),
		).toThrow(definitionError("empty-delimiter"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- empty env name
				a: { type: "string", env: { name: "" } },
			}),
		).toThrow(definitionError("empty-env"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- env.delimiter requires multiple
				a: { type: "string", env: { name: "A", delimiter: "," } },
			}),
		).toThrow(definitionError("delimiter-without-multiple"));
	});

	it("rejects sensitive flags with a default or choices, which are published", () => {
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- a sensitive default is published
				a: { type: "string", sensitive: true, default: "x" },
			}),
		).toThrow(definitionError("sensitive-default"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- a sensitive multiple default is published
				a: { type: "number", multiple: true, sensitive: true, default: [1] },
			}),
		).toThrow(definitionError("sensitive-default"));
		expect(() =>
			new Crust("cli").flags({
				// @ts-expect-error -- sensitive choices are published
				a: { type: "string", sensitive: true, choices: ["x"] },
			}),
		).toThrow(definitionError("sensitive-choices"));
	});

	// Types reject the definition; runtime cannot tell a parser is async until it returns a Promise.
	it("rejects async parse when the flag is parsed, not when it is defined", async () => {
		const app = new Crust("cli")
			.flags({
				// @ts-expect-error -- parse must be synchronous
				a: { type: "string", parse: (raw: string) => Promise.resolve(raw) },
			})
			.action(() => {});
		await expect(unwrap(app.run([], { flags: { a: "x" } }))).rejects.toThrow(
			expect.objectContaining({
				code: "PARSE",
				message: expect.stringContaining("parse must be synchronous"),
			}),
		);
	});
});

describe("command names", () => {
	it("rejects invalid names and aliases", () => {
		expect(
			() =>
				// @ts-expect-error -- empty root name
				new Crust(""),
		).toThrow(definitionError("empty-name"));
		expect(() =>
			new Crust("cli").add(
				// @ts-expect-error -- empty name
				defineCommand("", (c) => c.action(() => {})),
			),
		).toThrow(definitionError("empty-name"));
		expect(() =>
			new Crust("cli").add(
				// @ts-expect-error -- whitespace-only name
				defineCommand("   ", (c) => c.action(() => {})),
			),
		).toThrow(definitionError("empty-name"));
		expect(() =>
			new Crust("cli").add(
				// @ts-expect-error -- NBSP-only name trims to empty
				defineCommand("\u00a0", (c) => c.action(() => {})),
			),
		).toThrow(definitionError("empty-name"));
		expect(() =>
			new Crust("cli").add(
				// @ts-expect-error -- whitespace in name
				defineCommand("a b", (c) => c.action(() => {})),
			),
		).toThrow(definitionError("invalid-name"));
		expect(() =>
			new Crust("cli").add(
				// @ts-expect-error -- leading dash
				defineCommand("-a", (c) => c.action(() => {})),
			),
		).toThrow(definitionError("invalid-name"));
		expect(() =>
			new Crust("cli").add(
				// @ts-expect-error -- `__proto__` is reserved
				defineCommand("__proto__", (c) => c.action(() => {})),
			),
		).toThrow(definitionError("reserved-name"));
		expect(() =>
			new Crust("cli").add(
				defineCommand(
					"a",
					// @ts-expect-error -- whitespace in alias
					{ aliases: ["b c"] },
					(c) => c.action(() => {}),
				),
			),
		).toThrow(definitionError("invalid-alias"));
		expect(() =>
			new Crust("cli").add(
				defineCommand(
					"a",
					// @ts-expect-error -- empty alias
					{ aliases: [""] },
					(c) => c.action(() => {}),
				),
			),
		).toThrow(definitionError("invalid-alias"));
		expect(() =>
			new Crust("cli").add(
				// @ts-expect-error -- alias repeats the command's own name
				defineCommand("a", { aliases: ["a"] }, (c) => c.action(() => {})),
			),
		).toThrow(definitionError("alias-collision"));
		expect(() =>
			new Crust("cli").add(
				// @ts-expect-error -- `.as()` renames onto the command's own alias
				defineCommand("a", { aliases: ["b"] }, (c) => c.action(() => {})).as("b"),
			),
		).toThrow(definitionError("alias-collision"));
	});

	it("rejects sibling collisions", () => {
		expect(() =>
			new Crust("cli").add(defineCommand("a", (c) => c.action(() => {}))).add(
				// @ts-expect-error -- duplicate sibling name
				defineCommand("a", (c) => c.action(() => {})),
			),
		).toThrow(definitionError("command-collision"));
		expect(() =>
			new Crust("cli").add(defineCommand("a", (c) => c.action(() => {}))).add(
				// @ts-expect-error -- alias claims a sibling's name
				defineCommand("b", { aliases: ["a"] }, (c) => c.action(() => {})),
			),
		).toThrow(definitionError("command-collision"));
	});
});

describe("arguments", () => {
	it("rejects invalid names, order and defaults", () => {
		expect(() =>
			new Crust("cli").args(
				// @ts-expect-error -- empty name
				{ name: "", type: "string" },
			),
		).toThrow(definitionError("empty-name"));
		expect(() =>
			new Crust("cli").args(
				// @ts-expect-error -- duplicate name
				{ name: "a", type: "string" },
				{ name: "a", type: "string" },
			),
		).toThrow(definitionError("duplicate-arg"));
		expect(() =>
			new Crust("cli").args(
				// @ts-expect-error -- variadic must be last
				{ name: "a", type: "string", variadic: true },
				{ name: "b", type: "string" },
			),
		).toThrow(definitionError("variadic-position"));
		expect(() =>
			new Crust("cli").args(
				// @ts-expect-error -- default outside choices
				{ name: "a", type: "string", choices: ["x"], default: "z" },
			),
		).toThrow(definitionError("default-outside-choices"));
		expect(() =>
			new Crust("cli").args(
				// @ts-expect-error -- a sensitive default is published
				{ name: "a", type: "string", sensitive: true, default: "x" },
			),
		).toThrow(definitionError("sensitive-default"));
		expect(() =>
			new Crust("cli").args(
				// @ts-expect-error -- sensitive choices are published
				{ name: "a", type: "string", sensitive: true, choices: ["x"] },
			),
		).toThrow(definitionError("sensitive-choices"));
	});
});

describe("extension ids", () => {
	it("rejects empty and untrimmed ids", () => {
		// @ts-expect-error -- empty id
		expect(() => defineExtensionId("")).toThrow(definitionError("empty-id"));
		// @ts-expect-error -- untrimmed id
		expect(() => defineExtensionId(" x")).toThrow(definitionError("empty-id"));
	});
});

// A recipe runs only when the tree is materialized, so its runtime checks fire on `snapshot()`.
describe("lazy recipes", () => {
	it("rejects invalid definitions when materialized", async () => {
		await expect(
			new Crust("cli")
				.add(
					defineCommand("a", (c) =>
						c
							.flags({
								// @ts-expect-error -- whitespace in name
								"x y": { type: "string" },
							})
							.action(() => {}),
					),
				)
				.snapshot(),
		).rejects.toThrow(definitionError("invalid-spelling"));
		await expect(
			new Crust("cli")
				.add(
					defineCommand("a", (c) =>
						c
							.args(
								// @ts-expect-error -- duplicate name
								{ name: "x", type: "string" },
								{ name: "x", type: "string" },
							)
							.action(() => {}),
					),
				)
				.snapshot(),
		).rejects.toThrow(definitionError("duplicate-arg"));
	});
});

describe("valid controls", () => {
	it("compiles and materializes definitions near the rules", async () => {
		// Leading zero: not a canonical integer, so JavaScript keeps its insertion order.
		await expect(
			new Crust("cli").flags({ "01": { type: "string" } }).snapshot(),
		).resolves.toBeTruthy();
		// One character is one code point, though an astral one is two UTF-16 units.
		await expect(
			new Crust("cli").flags({ a: { type: "string", short: "\u{1F600}" } }).snapshot(),
		).resolves.toBeTruthy();
		// `-=` still reaches a short; only long spellings split at `=`.
		await expect(
			new Crust("cli").flags({ a: { type: "string", short: "=" } }).snapshot(),
		).resolves.toBeTruthy();
		// Only ASCII whitespace splits an argv token, so both sides accept NBSP inside a name.
		await expect(
			new Crust("cli").flags({ "a\u00a0b": { type: "string" } }).snapshot(),
		).resolves.toBeTruthy();
		// Aliases are never record keys, so key order does not apply.
		await expect(
			new Crust("cli").flags({ a: { type: "string", aliases: ["7"] } }).snapshot(),
		).resolves.toBeTruthy();
		// Flags and arguments live in separate namespaces.
		await expect(
			new Crust("cli")
				.flags({ a: { type: "string" } })
				.args({ name: "a", type: "string" })
				.snapshot(),
		).resolves.toBeTruthy();
		await expect(
			new Crust("cli").add(defineCommand("1", (c) => c.action(() => {}))).snapshot(),
		).resolves.toBeTruthy();
	});
});

// Values typed as plain `string` carry no literal for a brand to check.
describe("runtime-only values", () => {
	it("rejects dynamic names the types cannot see", () => {
		const name: string = "a b";
		expect(() => new Crust("cli").flags({ [name]: { type: "string" } })).toThrow(
			definitionError("invalid-spelling"),
		);
		expect(() => new Crust("cli").add(defineCommand(name, (c) => c.action(() => {})))).toThrow(
			definitionError("invalid-name"),
		);
	});
});

describe("TrimWhitespace", () => {
	// Runtime checks call `String#trim`; the type must list exactly what it removes (in code-point order).
	it("matches the characters String#trim removes", () => {
		const listed = [
			"\t",
			"\n",
			"\v",
			"\f",
			"\r",
			" ",
			"\u00a0",
			"\u1680",
			"\u2000",
			"\u2001",
			"\u2002",
			"\u2003",
			"\u2004",
			"\u2005",
			"\u2006",
			"\u2007",
			"\u2008",
			"\u2009",
			"\u200a",
			"\u2028",
			"\u2029",
			"\u202f",
			"\u205f",
			"\u3000",
			"\ufeff",
		] as const;
		type _listed = Expect<Equal<(typeof listed)[number], TrimWhitespace>>;
		const trimmed: string[] = [];
		for (let code = 0; code <= 0xffff; code++) {
			const char = String.fromCharCode(code);
			if (char.trim() === "") trimmed.push(char);
		}
		expect(trimmed).toEqual(listed);
	});
});
