// ────────────────────────────────────────────────────────────────────────────
// arg() / flag() / commandValidator() — merged test suite
// ────────────────────────────────────────────────────────────────────────────
//
// Exercises both Zod (schemas are Standard Schemas natively in v4) and
// Effect (schemas wrapped via `Schema.standardSchemaV1(...)`) through the
// single root API. Vendor-specific quirks are kept inline; the shared
// invariants run via parameterized `describe.each`-style blocks below.

import { describe, expect, it } from "bun:test";
import type { InheritableFlags } from "@crustjs/core";
import { Crust, CrustError, parseArgs } from "@crustjs/core";
import * as Schema from "effect/Schema";
import { z } from "zod";
import { commandValidator } from "./command.ts";
import { arg, flag } from "./schema.ts";
import type {
	InferValidatedArgs,
	InferValidatedFlags,
} from "./schema-types.ts";
import type { StandardSchema } from "./types.ts";

function capture<T>(): { value: T | undefined; set(v: T): void } {
	const box: { value: T | undefined; set(v: T): void } = {
		value: undefined,
		set(v: T) {
			box.value = v;
		},
	};
	return box;
}

// ────────────────────────────────────────────────────────────────────────────
// Type-level checks (infrastructure for compile-time tests)
// ────────────────────────────────────────────────────────────────────────────

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

// ────────────────────────────────────────────────────────────────────────────
// Vendor fixtures — encapsulate schema construction so the same suite of
// behavior tests runs against both Zod and Effect-wrapped schemas.
// ────────────────────────────────────────────────────────────────────────────

interface VendorFixtures {
	name: "zod" | "effect";
	str: () => StandardSchema<string>;
	strOptional: () => StandardSchema<string | undefined, string | undefined>;
	num: () => StandardSchema<number>;
	numMin1: () => StandardSchema<number>;
	numOptional: () => StandardSchema<number | undefined, number | undefined>;
	bool: () => StandardSchema<boolean>;
	boolDefaultFalse: () => StandardSchema<
		boolean | undefined,
		boolean | undefined
	>;
	stringArray: () => StandardSchema<readonly string[], readonly string[]>;
	literalProd: () => StandardSchema<string>;
	literalStrict: () => StandardSchema<string>;
	enumJsonText: () => StandardSchema<
		"json" | "text" | undefined,
		"json" | "text"
	>;
	stringWithDescription: (text: string) => StandardSchema<string>;
	numberWithDescription: (text: string) => StandardSchema<number>;
	upperTransform: () => StandardSchema<string>;
	asyncUpperTransform: () => StandardSchema<string>;
	asyncRefinedToken: () => StandardSchema<string>;
	stringToNumber: () => StandardSchema<string, number>;
	asyncStringToNumber: () => StandardSchema<string, number>;
	stringPlus1Transform: (
		defaultValue: number,
	) => StandardSchema<number | undefined, number>;
}

function wrapEffect<A, I>(s: Schema.Schema<A, I, never>): StandardSchema<I, A> {
	return Schema.standardSchemaV1(s) as unknown as StandardSchema<I, A>;
}

const zodFixtures: VendorFixtures = {
	name: "zod",
	str: () => z.string(),
	strOptional: () => z.string().optional(),
	num: () => z.number(),
	numMin1: () => z.number().min(1),
	numOptional: () => z.number().optional(),
	bool: () => z.boolean(),
	boolDefaultFalse: () => z.boolean().default(false),
	stringArray: () =>
		z.array(z.string()) as unknown as StandardSchema<
			readonly string[],
			readonly string[]
		>,
	literalProd: () => z.literal("prod"),
	literalStrict: () => z.literal("strict"),
	enumJsonText: () => z.enum(["json", "text"]).default("text"),
	stringWithDescription: (text) => z.string().describe(text),
	numberWithDescription: (text) => z.number().describe(text),
	upperTransform: () => z.string().transform((s) => s.toUpperCase()),
	asyncUpperTransform: () => z.string().transform(async (s) => s.toUpperCase()),
	asyncRefinedToken: () =>
		z.string().refine(async (v) => v === "secret", "Invalid token"),
	stringToNumber: () => z.string().transform((v) => Number(v)),
	asyncStringToNumber: () => z.string().transform(async (v) => Number(v)),
	stringPlus1Transform: (defaultValue) =>
		z
			.number()
			.default(defaultValue)
			.transform(async (v) => v + 1),
};

const effectFixtures: VendorFixtures = {
	name: "effect",
	str: () => wrapEffect(Schema.String),
	strOptional: () => wrapEffect(Schema.UndefinedOr(Schema.String)),
	num: () => wrapEffect(Schema.Number),
	numMin1: () => wrapEffect(Schema.Number),
	numOptional: () => wrapEffect(Schema.UndefinedOr(Schema.Number)),
	bool: () => wrapEffect(Schema.Boolean),
	boolDefaultFalse: () => wrapEffect(Schema.UndefinedOr(Schema.Boolean)),
	stringArray: () => wrapEffect(Schema.Array(Schema.String)),
	literalProd: () => wrapEffect(Schema.Literal("prod")),
	literalStrict: () => wrapEffect(Schema.Literal("strict")),
	enumJsonText: () => wrapEffect(Schema.Literal("json", "text")),
	stringWithDescription: (text) =>
		wrapEffect(Schema.String.annotations({ description: text })),
	numberWithDescription: (text) =>
		wrapEffect(Schema.Number.annotations({ description: text })),
	upperTransform: () =>
		wrapEffect(
			Schema.transform(Schema.String, Schema.String, {
				strict: false,
				decode: (v) => v.toUpperCase(),
				encode: (v) => v,
			}),
		),
	asyncUpperTransform: () =>
		// Effect transforms run synchronously; tag this fixture identical to
		// the sync upper-transform so the async-transform behavior test
		// becomes a parity check rather than a vendor-only no-op.
		wrapEffect(
			Schema.transform(Schema.String, Schema.String, {
				strict: false,
				decode: (v) => v.toUpperCase(),
				encode: (v) => v,
			}),
		),
	asyncRefinedToken: () =>
		// Effect refinement equivalent — run sync.
		wrapEffect(Schema.Literal("secret")),
	stringToNumber: () =>
		wrapEffect(
			Schema.transform(Schema.String, Schema.Number, {
				strict: false,
				decode: (v) => Number(v),
				encode: (v) => String(v),
			}),
		),
	asyncStringToNumber: () =>
		wrapEffect(
			Schema.transform(Schema.String, Schema.Number, {
				strict: false,
				decode: (v) => Number(v),
				encode: (v) => String(v),
			}),
		),
	stringPlus1Transform: (defaultValue) =>
		wrapEffect(
			Schema.transform(Schema.UndefinedOr(Schema.Number), Schema.Number, {
				strict: false,
				decode: (v) => (v ?? defaultValue) + 1,
				encode: (v) => v - 1,
			}),
		),
};

// ────────────────────────────────────────────────────────────────────────────
// Vendor-parameterized behavior — runs once per vendor
// ────────────────────────────────────────────────────────────────────────────

for (const fx of [zodFixtures, effectFixtures]) {
	describe(`[vendor=${fx.name}] arg() produces core-compatible ArgDef`, () => {
		it("derives type and required from schema", () => {
			const portArg = arg("port", fx.num());
			expect(portArg.name).toBe("port");
			expect(portArg.type).toBe("number");
			expect(portArg.required).toBe(true);
		});

		it("marks optional schema as not required", () => {
			const hostArg = arg("host", fx.strOptional());
			expect(hostArg.type).toBe("string");
			expect(hostArg.required).toBeUndefined();
		});

		it("extracts description from schema", () => {
			const a = arg("port", fx.numberWithDescription("Port to listen on"));
			expect(a.description).toBe("Port to listen on");
		});

		it("supports variadic option", () => {
			const a = arg("files", fx.str(), { variadic: true });
			expect(a.variadic).toBe(true);
		});

		it("throws DEFINITION for empty name", () => {
			expect(() => arg("", fx.str())).toThrow(CrustError);
		});

		it("throws DEFINITION for array schema without variadic", () => {
			expect(() => arg("files", fx.stringArray())).toThrow(CrustError);
		});

		it("throws DEFINITION for variadic with array schema", () => {
			expect(() => arg("files", fx.stringArray(), { variadic: true })).toThrow(
				CrustError,
			);
		});
	});

	describe(`[vendor=${fx.name}] flag() produces core-compatible FlagDef`, () => {
		it("derives type from schema", () => {
			const f = flag(fx.boolDefaultFalse());
			expect(f.type).toBe("boolean");
			expect(f.required).toBeUndefined();
		});

		it("passes through short", () => {
			const f = flag(fx.boolDefaultFalse(), { short: "v" });
			expect(f.short).toBe("v");
		});

		it("passes through inherit", () => {
			const f = flag(fx.boolDefaultFalse(), { inherit: true });
			expect(f.inherit).toBe(true);
		});

		it("extracts description from schema", () => {
			const f = flag(fx.stringWithDescription("Output dir"));
			expect(f.description).toBe("Output dir");
		});
	});

	describe(`[vendor=${fx.name}] Crust builder + commandValidator`, () => {
		it("validates and transforms args and flags", async () => {
			const received = capture<{ args: unknown; flags: unknown }>();

			const app = new Crust("serve")
				.args([arg("port", fx.numMin1()), arg("host", fx.str())])
				.flags({ verbose: flag(fx.bool(), { short: "v" }) })
				.run(
					commandValidator(({ args, flags }) => {
						received.set({ args, flags });
					}),
				);

			await app.execute({ argv: ["8080", "0.0.0.0", "-v"] });

			expect(received.value).toBeDefined();
			expect(received.value?.args).toEqual({ port: 8080, host: "0.0.0.0" });
			expect(received.value?.flags).toEqual({ verbose: true });
		});

		it("supports variadic args", async () => {
			const received = capture<unknown>();

			const app = new Crust("lint")
				.args([
					arg("mode", fx.str()),
					arg("files", fx.str(), { variadic: true }),
				])
				.run(
					commandValidator(({ args }) => {
						received.set(args);
					}),
				);

			await app.execute({
				argv: ["strict", "src/a.ts", "src/b.ts"],
			});

			expect(received.value).toEqual({
				mode: "strict",
				files: ["src/a.ts", "src/b.ts"],
			});
		});

		it("applies schema transforms", async () => {
			const received = capture<{ args: unknown; flags: unknown }>();

			const app = new Crust("greet")
				.args([arg("name", fx.upperTransform())])
				.run(
					commandValidator(({ args, flags }) => {
						received.set({ args, flags });
					}),
				);

			await app.execute({ argv: ["alice"] });

			expect(received.value?.args).toEqual({ name: "ALICE" });
		});

		it("applies schema transforms on flags (sync)", async () => {
			const received = capture<{ flags: unknown }>();

			const app = new Crust("build")
				.flags({ port: flag(fx.stringToNumber(), { short: "p" }) })
				.run(
					commandValidator(({ flags }) => {
						received.set({ flags });
					}),
				);

			await app.execute({ argv: ["-p", "8080"] });

			expect(received.value?.flags).toEqual({ port: 8080 });
		});

		it("applies async schema transforms on flags", async () => {
			const received = capture<{ flags: unknown }>();

			const app = new Crust("build")
				.flags({ port: flag(fx.asyncStringToNumber(), { short: "p" }) })
				.run(
					commandValidator(({ flags }) => {
						received.set({ flags });
					}),
				);

			await app.execute({ argv: ["-p", "443"] });

			expect(received.value?.flags).toEqual({ port: 443 });
		});

		it("applies default + transform on flags (default value flows through transform)", async () => {
			const received = capture<{ flags: unknown }>();

			const app = new Crust("build")
				.flags({
					count: flag(fx.stringPlus1Transform(10), { short: "c" }),
				})
				.run(
					commandValidator(({ flags }) => {
						received.set({ flags });
					}),
				);

			await app.execute({ argv: [] });

			// Default 10 → transform adds 1 → 11.
			expect(received.value?.flags).toEqual({ count: 11 });
		});

		it("preRun/postRun see raw parser context; commandValidator handler sees validated values", async () => {
			const phases: Array<{
				phase: "pre" | "run" | "post";
				name: unknown;
			}> = [];

			const app = new Crust("hooks")
				.args([arg("name", fx.upperTransform())])
				.preRun(({ args }) => {
					phases.push({ phase: "pre", name: args.name });
				})
				.run(
					commandValidator(({ args }) => {
						phases.push({ phase: "run", name: args.name });
					}),
				)
				.postRun(({ args }) => {
					phases.push({ phase: "post", name: args.name });
				});

			await app.execute({ argv: ["alice"] });

			// preRun/postRun receive the raw parsed value ("alice"); only the
			// commandValidator-wrapped handler sees the schema-transformed value
			// ("ALICE").
			expect(phases).toEqual([
				{ phase: "pre", name: "alice" },
				{ phase: "run", name: "ALICE" },
				{ phase: "post", name: "alice" },
			]);
		});

		it("supports async transforms", async () => {
			const received = capture<{ args: unknown; flags: unknown }>();

			const app = new Crust("async")
				.args([arg("name", fx.asyncUpperTransform())])
				.run(
					commandValidator(({ args, flags }) => {
						received.set({ args, flags });
					}),
				);

			await app.execute({ argv: ["alice"] });

			expect(received.value?.args).toEqual({ name: "ALICE" });
		});

		it("maps schema failures to CrustError(VALIDATION) with dot-paths", async () => {
			const app = new Crust("check")
				.args([arg("env", fx.literalProd())])
				.flags({ mode: flag(fx.literalStrict()) })
				.run(
					commandValidator(() => {
						expect.unreachable("handler should not run");
					}),
				);

			const node = app._node;
			const parsed = parseArgs(node, ["dev", "--mode", "loose"]);
			const context = {
				args: parsed.args,
				flags: parsed.flags,
				rawArgs: parsed.rawArgs,
				command: node,
			};

			try {
				await node.run?.(context);
				expect.unreachable("should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(CrustError);
				const crustErr = error as CrustError;
				expect(crustErr.is("VALIDATION")).toBe(true);
				expect(crustErr.message).toContain("args.env");
				expect(crustErr.message).toContain("flags.mode");
				expect(crustErr.cause).toEqual(
					expect.arrayContaining([
						{ path: "args.env", message: expect.any(String) },
						{ path: "flags.mode", message: expect.any(String) },
					]),
				);
			}
		});

		it("works with subcommands", async () => {
			const received = capture<unknown>();

			const app = new Crust("app").command("deploy", (cmd) =>
				cmd.flags({ env: flag(fx.strOptional(), { short: "e" }) }).run(
					commandValidator(({ flags }) => {
						received.set(flags);
					}),
				),
			);

			await app.execute({ argv: ["deploy", "-e", "production"] });

			expect(received.value).toEqual({ env: "production" });
		});

		it("plugin-injected flags without schemas pass through unchanged", async () => {
			const received = capture<{ flags: unknown }>();

			const app = new Crust("demo")
				.flags({ verbose: flag(fx.boolDefaultFalse()) })
				.run(
					commandValidator(({ flags }) => {
						received.set({ flags });
					}),
				);

			// Manually inject a non-validated flag onto the command node to
			// emulate a plugin-injected flag (mirrors how `helpPlugin` works).
			const node = app._node;
			const injected = {
				type: "boolean" as const,
				short: "h",
				inherit: undefined,
				aliases: undefined,
			};
			(node.effectiveFlags as Record<string, unknown>).help = injected;

			const parsed = parseArgs(node, []);
			await node.run?.({
				args: parsed.args,
				flags: { ...parsed.flags, help: false },
				rawArgs: parsed.rawArgs,
				command: node,
			});

			// Injected flag passes through verbatim because it carries no
			// [VALIDATED_SCHEMA] brand. Validated flag goes through its schema
			// (Zod applies the default, Effect's UndefinedOr returns undefined).
			const flags = received.value?.flags as Record<string, unknown>;
			expect(flags.help).toBe(false);
			expect("verbose" in flags).toBe(true);
			// Vendor-specific shape: Zod's `.default(false)` resolves to `false`;
			// Effect's `Schema.UndefinedOr(...)` resolves to `undefined`. Either
			// way, the validated value must NOT spuriously become a different
			// non-default truthy value.
			const expectedVerbose = fx.name === "zod" ? false : undefined;
			expect(flags.verbose).toBe(expectedVerbose);
		});
	});

	describe(`[vendor=${fx.name}] explicit metadata overrides`, () => {
		it("explicit description always wins over schema description", () => {
			const a = arg("name", fx.stringWithDescription("schema desc"), {
				description: "explicit desc",
			});
			expect(a.description).toBe("explicit desc");
		});

		it("explicit type with the same value as inferred is accepted silently", () => {
			const a = arg("port", fx.num(), { type: "number" });
			expect(a.type).toBe("number");
		});

		it("explicit type that disagrees with inferred wins silently (no conflict error)", () => {
			// Behavior change in 0.1.0: explicit options always win, no conflict-checking.
			const a = arg("port", fx.num(), { type: "string" });
			// `a.type` is statically narrowed to `"number"` from the schema's value-type
			// resolution; runtime value is the explicit override ("string").
			expect(a.type as string).toBe("string");
		});

		it("explicit required: true on optional schema wins silently", () => {
			const a = arg("host", fx.strOptional(), { required: true });
			expect(a.required).toBe(true);
		});

		it("explicit required: false on required schema wins silently", () => {
			const a = arg("port", fx.num(), { required: false });
			expect(a.required).toBeUndefined();
		});

		// flag() parity for the three removed conflict checks
		it("flag(): explicit type that disagrees with inferred wins silently", () => {
			const f = flag(fx.num(), { type: "string" });
			expect(f.type as string).toBe("string");
		});

		it("flag(): explicit required: true on optional schema wins silently", () => {
			const f = flag(fx.numOptional(), { required: true });
			expect(f.required).toBe(true);
		});

		it("flag(): explicit required: false on required schema wins silently", () => {
			const f = flag(fx.num(), { required: false });
			expect(f.required).toBeUndefined();
		});
	});

	describe(`[vendor=${fx.name}] generic type narrowing`, () => {
		it("narrows variadic to literal true on arg() return type", () => {
			const variadicArg = arg("files", fx.str(), { variadic: true });
			type _check = Expect<Equal<typeof variadicArg.variadic, true>>;
			expect(variadicArg.variadic).toBe(true);
		});

		it("narrows variadic to undefined when not specified", () => {
			const plainArg = arg("port", fx.num());
			type _check = Expect<Equal<typeof plainArg.variadic, undefined>>;
			expect(plainArg.variadic).toBeUndefined();
		});

		it("narrows short to literal string on flag() return type", () => {
			const f = flag(fx.bool(), { short: "v" });
			type _check = Expect<Equal<typeof f.short, "v">>;
			expect(f.short).toBe("v");
		});

		it("narrows aliases to literal tuple on flag() return type", () => {
			const f = flag(fx.bool(), { aliases: ["verbose", "verb"] });
			type _check = Expect<
				Equal<typeof f.aliases, readonly ["verbose", "verb"]>
			>;
			expect(f.aliases).toEqual(["verbose", "verb"]);
		});

		it("narrows inherit to true so core can detect inheritable flags", () => {
			const inherited = flag(fx.bool(), { inherit: true });
			type Flags = { verbose: typeof inherited };
			type Result = InheritableFlags<Flags>;
			type _checkInherit = Expect<Equal<typeof inherited.inherit, true>>;
			type _checkResult = Expect<Equal<Result, Flags>>;
			expect(inherited.inherit).toBe(true);
		});
	});
}

// ────────────────────────────────────────────────────────────────────────────
// Vendor-specific tests — quirks that don't generalize cleanly
// ────────────────────────────────────────────────────────────────────────────

describe("[zod] applies schema defaults", () => {
	it("applies schema defaults", async () => {
		const received = capture<{ args: unknown; flags: unknown }>();

		const app = new Crust("greet")
			.args([arg("name", z.string())])
			.flags({ format: flag(z.string().default("text")) })
			.run(
				commandValidator(({ args, flags }) => {
					received.set({ args, flags });
				}),
			);

		await app.execute({ argv: ["alice"] });

		expect(received.value?.args).toEqual({ name: "alice" });
		expect(received.value?.flags).toEqual({ format: "text" });
	});

	it("preserves original parser output on context.input through transforms", async () => {
		const received = capture<unknown>();

		const app = new Crust("demo")
			.args([
				arg(
					"name",
					z.string().transform((s) => s.toUpperCase()),
				),
			])
			.flags({
				count: flag(
					z
						.number()
						.default(2)
						.transform((n) => n + 1),
				),
			})
			.run(
				commandValidator(({ input, args, flags }) => {
					received.set({ input, args, flags });
				}),
			);

		await app.execute({ argv: ["world"] });

		expect(received.value).toEqual({
			input: {
				args: { name: "world" },
				flags: { count: undefined },
			},
			args: { name: "WORLD" },
			flags: { count: 3 },
		});
	});

	it("maps async schema failures to CrustError(VALIDATION)", async () => {
		const app = new Crust("check-async")
			.flags({
				token: flag(
					z.string().refine(async (v) => v === "secret", "Invalid token"),
				),
			})
			.run(
				commandValidator(() => {
					expect.unreachable("handler should not run");
				}),
			);

		const node = app._node;
		const parsed = parseArgs(node, ["--token", "nope"]);
		const context = {
			args: parsed.args,
			flags: parsed.flags,
			rawArgs: parsed.rawArgs,
			command: node,
		};

		try {
			await node.run?.(context);
			expect.unreachable("should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(CrustError);
			const crustErr = error as CrustError;
			expect(crustErr.is("VALIDATION")).toBe(true);
			expect(crustErr.message).toContain("flags.token");
		}
	});

	it("resolves description through Zod wrappers", () => {
		const app = new Crust("unwrap")
			.args([
				arg("name", z.string().describe("Inner desc").optional()),
				arg("count", z.number().describe("Count desc").default(1)),
			])
			.flags({
				mode: flag(
					z
						.string()
						.describe("Mode desc")
						.transform((v) => v.toUpperCase()),
				),
			});

		expect(app._node.args?.[0]?.description).toBe("Inner desc");
		expect(app._node.args?.[1]?.description).toBe("Count desc");
		expect(app._node.effectiveFlags?.mode?.description).toBe("Mode desc");
	});
});

describe("[effect] vendor-specific behavior", () => {
	it("falls back to Schema.Number's built-in description annotation", () => {
		const a = arg("port", wrapEffect(Schema.Number));
		expect(a.description).toBe("a number");
	});

	it("throws DEFINITION for tuple schemas with fixed elements", () => {
		expect(() =>
			arg("mixed", wrapEffect(Schema.Tuple(Schema.String, Schema.Number)), {
				variadic: true,
			}),
		).toThrow(/tuple schemas with fixed elements/);
	});

	it("resolves description through Effect wrappers", () => {
		const app = new Crust("unwrap")
			.args([
				arg(
					"name",
					wrapEffect(
						Schema.UndefinedOr(
							Schema.String.annotations({ description: "Inner desc" }),
						),
					),
				),
			])
			.flags({
				mode: flag(
					wrapEffect(
						Schema.transform(
							Schema.String.annotations({ description: "Mode desc" }),
							Schema.String,
							{ strict: false, decode: (v) => v, encode: (v) => v },
						),
					),
				),
			});

		expect(app._node.args?.[0]?.description).toBe("Inner desc");
		expect(app._node.effectiveFlags?.mode?.description).toBe("Mode desc");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Compile-time validation — ValidateVariadicArgs / ValidateFlagAliases
// ────────────────────────────────────────────────────────────────────────────

describe("ValidateVariadicArgs (compile-time, via Crust builder)", () => {
	it("accepts variadic as the last arg", () => {
		const app = new Crust("ok").args([
			arg("mode", z.string()),
			arg("files", z.string(), { variadic: true }),
		]);
		expect(app._node.meta.name).toBe("ok");
	});

	it("rejects variadic in non-last position (compile-time)", () => {
		new Crust("bad-order").args([
			// @ts-expect-error — variadic is not last, caught at compile time
			arg("files", z.string(), { variadic: true }),
			arg("mode", z.string()),
		]);
		expect(true).toBe(true);
	});
});

describe("ValidateFlagAliases (compile-time, via Crust builder)", () => {
	it("rejects alias that collides with a flag name (compile-time)", () => {
		new Crust("bad-alias").flags({
			out: flag(z.string().optional()),
			// @ts-expect-error — alias "out" collides with flag name "--out"
			output: flag(z.string().optional(), { aliases: ["out"] }),
		});
		expect(true).toBe(true);
	});

	it("rejects duplicate aliases across flags (compile-time)", () => {
		new Crust("bad-alias-dup").flags({
			// @ts-expect-error — alias "v" collides with alias on other flag
			verbose: flag(z.boolean().default(false), { short: "v" }),
			// @ts-expect-error — alias "v" collides with alias on other flag
			version: flag(z.boolean().default(false), { short: "v" }),
		});
		expect(true).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Strict-mode `never` brand check (compile-time)
// ────────────────────────────────────────────────────────────────────────────

describe("strict mode — commandValidator handler resolves to never with plain defs", () => {
	it("compile-time: a plain core ArgDef makes the handler param resolve to `never`", () => {
		const app = new Crust("strict").args([
			// Plain core def (no [VALIDATED_SCHEMA] brand) — not produced by `arg()`.
			{ name: "port", type: "number" } as const,
		]);

		// @ts-expect-error — handler param resolves to `never`, so even an
		// arrow accepting `void` fails to satisfy the signature.
		app.run(commandValidator(() => {}));

		expect(true).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Type-level inference tests (compile-time only)
// ────────────────────────────────────────────────────────────────────────────

describe("type-level InferValidatedArgs / InferValidatedFlags", () => {
	it("infers correct validated types — Zod", () => {
		const args = [
			arg("port", z.number()),
			arg("host", z.string().default("localhost")),
		] as const;
		type Args = InferValidatedArgs<typeof args>;
		type _checkPort = Expect<Equal<Args["port"], number>>;
		type _checkHost = Expect<Equal<Args["host"], string>>;
	});

	it("infers correct validated types — Effect", () => {
		const args = [
			arg("port", wrapEffect(Schema.Number)),
			arg("host", wrapEffect(Schema.UndefinedOr(Schema.String))),
		] as const;
		type Args = InferValidatedArgs<typeof args>;
		type _checkPort = Expect<Equal<Args["port"], number>>;
		type _checkHost = Expect<Equal<Args["host"], string | undefined>>;
	});

	it("infers variadic as array — Zod", () => {
		const args = [arg("files", z.string(), { variadic: true })] as const;
		type Args = InferValidatedArgs<typeof args>;
		type _check = Expect<Equal<Args["files"], string[]>>;
	});

	it("infers flag output types — Zod", () => {
		const flags = {
			verbose: flag(z.boolean().default(false)),
			format: flag(z.enum(["json", "text"]).default("text")),
		} as const;
		type Flags = InferValidatedFlags<typeof flags>;
		type _checkVerbose = Expect<Equal<Flags["verbose"], boolean>>;
		type _checkFormat = Expect<Equal<Flags["format"], "json" | "text">>;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Unknown-vendor / explicit-type-required path
// ────────────────────────────────────────────────────────────────────────────

describe("unknown vendor (Valibot/ArkType/etc.) requires explicit type", () => {
	const fakeStringSchema: StandardSchema = {
		"~standard": {
			version: 1,
			vendor: "valibot",
			validate: (value) =>
				typeof value === "string"
					? { value }
					: { issues: [{ message: "Expected string" }] },
		},
	};

	it("throws DEFINITION when type cannot be inferred and no explicit option", () => {
		expect(() => arg("name", fakeStringSchema)).toThrow(/unable to infer/);
	});

	it("accepts explicit { type } and uses it", () => {
		const a = arg("name", fakeStringSchema, { type: "string" });
		expect(a.type).toBe("string");
	});

	it("error message names the failing arg and the detected vendor", () => {
		try {
			arg("name", fakeStringSchema);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(CrustError);
			expect((error as Error).message).toContain('arg "name"');
			expect((error as Error).message).toContain('vendor: "valibot"');
		}
	});

	it("flag() emits the same message", () => {
		try {
			flag(fakeStringSchema);
			expect.unreachable();
		} catch (error) {
			expect((error as Error).message).toContain('vendor: "valibot"');
		}
	});

	it("end-to-end: unknown-vendor schema validates, transforms, and rejects through commandValidator", async () => {
		// Hand-rolled Standard Schema with a transform: the encoded input is a
		// string, the parsed output is a number with +1 applied.
		const stringToNumberPlusOne: StandardSchema<string, number> = {
			"~standard": {
				version: 1,
				vendor: "valibot",
				validate: (value) => {
					if (typeof value !== "string") {
						return { issues: [{ message: "Expected string input" }] };
					}
					const n = Number(value);
					if (Number.isNaN(n)) {
						return { issues: [{ message: "Not a valid number" }] };
					}
					return { value: n + 1 };
				},
			},
		};

		const received = capture<{ args: unknown }>();

		const app = new Crust("unknown-vendor")
			.args([arg("port", stringToNumberPlusOne, { type: "string" })])
			.run(
				commandValidator(({ args }) => {
					received.set({ args });
				}),
			);

		// Success: transform fires — "42" → 43.
		await app.execute({ argv: ["42"] });
		expect(received.value?.args).toEqual({ port: 43 });

		// Failure: schema rejects non-numeric input through CrustError(VALIDATION).
		const node = app._node;
		const parsed = parseArgs(node, ["abc"]);
		let caught: unknown;
		try {
			await node.run?.({
				args: parsed.args,
				flags: parsed.flags,
				rawArgs: parsed.rawArgs,
				command: node,
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(CrustError);
		expect((caught as CrustError).is("VALIDATION")).toBe(true);
		expect((caught as CrustError).message).toContain("args.port");
	});
});
