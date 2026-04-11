import { describe, expect, it } from "bun:test";
import type { InheritableFlags } from "@crustjs/core";
import { Crust, CrustError, parseArgs } from "@crustjs/core";
import { z } from "zod";
import { commandValidator } from "./command.ts";
import { arg, flag } from "./schema.ts";
import type { InferValidatedArgs, InferValidatedFlags } from "./types.ts";

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
// arg() / flag() produce valid core definitions
// ────────────────────────────────────────────────────────────────────────────

describe("arg() produces core-compatible ArgDef", () => {
	it("derives type and required from schema", () => {
		const portArg = arg("port", z.number());
		expect(portArg.name).toBe("port");
		expect(portArg.type).toBe("number");
		expect(portArg.required).toBe(true);
	});

	it("marks optional schema as not required", () => {
		const hostArg = arg("host", z.string().default("localhost"));
		expect(hostArg.type).toBe("string");
		expect(hostArg.required).toBeUndefined();
	});

	it("extracts description from schema", () => {
		const a = arg("port", z.number().describe("Port to listen on"));
		expect(a.description).toBe("Port to listen on");
	});

	it("supports variadic option", () => {
		const a = arg("files", z.string(), { variadic: true });
		expect(a.variadic).toBe(true);
	});

	it("throws DEFINITION for empty name", () => {
		expect(() => arg("", z.string())).toThrow(CrustError);
	});

	it("throws DEFINITION for array schema without variadic", () => {
		expect(() => arg("files", z.array(z.string()))).toThrow(CrustError);
	});

	it("throws DEFINITION for variadic with array schema", () => {
		expect(() => arg("files", z.array(z.string()), { variadic: true })).toThrow(
			CrustError,
		);
	});
});

describe("flag() produces core-compatible FlagDef", () => {
	it("derives type from schema", () => {
		const f = flag(z.boolean().default(false));
		expect(f.type).toBe("boolean");
		expect(f.required).toBeUndefined();
	});

	it("passes through short", () => {
		const f = flag(z.boolean().default(false), { short: "v" });
		expect(f.short).toBe("v");
	});

	it("passes through inherit", () => {
		const f = flag(z.boolean().default(false), { inherit: true });
		expect(f.inherit).toBe(true);
	});

	it("extracts description from schema", () => {
		const f = flag(z.string().describe("Output dir"));
		expect(f.description).toBe("Output dir");
	});

	it("resolves description through wrappers", () => {
		const f = flag(z.number().describe("Count").default(1));
		expect(f.description).toBe("Count");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Crust builder + commandValidator composability
// ────────────────────────────────────────────────────────────────────────────

describe("Crust builder + commandValidator", () => {
	it("validates and transforms args and flags", async () => {
		const received = capture<{ args: unknown; flags: unknown }>();

		const app = new Crust("serve")
			.args([
				arg("port", z.number().int().min(1)),
				arg("host", z.string().default("localhost")),
			])
			.flags({
				verbose: flag(z.boolean().default(false), { short: "v" }),
			})
			.run(
				commandValidator(({ args, flags }) => {
					received.set({ args, flags });
				}),
			);

		await app.execute({ argv: ["8080", "0.0.0.0", "-v"] });

		expect(received.value).toBeDefined();
		expect(received.value?.args).toEqual({
			port: 8080,
			host: "0.0.0.0",
		});
		expect(received.value?.flags).toEqual({ verbose: true });
	});

	it("applies schema defaults", async () => {
		const received = capture<{ args: unknown; flags: unknown }>();

		const app = new Crust("greet")
			.args([arg("name", z.string())])
			.flags({
				format: flag(z.string().default("text")),
			})
			.run(
				commandValidator(({ args, flags }) => {
					received.set({ args, flags });
				}),
			);

		await app.execute({ argv: ["alice"] });

		expect(received.value?.args).toEqual({ name: "alice" });
		expect(received.value?.flags).toEqual({ format: "text" });
	});

	it("applies schema transforms", async () => {
		const received = capture<{ args: unknown; flags: unknown }>();

		const app = new Crust("greet")
			.args([
				arg(
					"name",
					z.string().transform((s) => s.toUpperCase()),
				),
			])
			.flags({
				format: flag(
					z
						.string()
						.default("text")
						.transform((v) => v.toUpperCase()),
				),
			})
			.run(
				commandValidator(({ args, flags }) => {
					received.set({ args, flags });
				}),
			);

		await app.execute({ argv: ["alice"] });

		expect(received.value?.args).toEqual({ name: "ALICE" });
		expect(received.value?.flags).toEqual({ format: "TEXT" });
	});

	it("supports async transforms", async () => {
		const received = capture<{ args: unknown; flags: unknown }>();

		const app = new Crust("async")
			.args([
				arg(
					"name",
					z.string().transform(async (v) => v.toUpperCase()),
				),
			])
			.flags({
				count: flag(
					z
						.number()
						.default(1)
						.transform(async (v) => v + 1),
				),
			})
			.run(
				commandValidator(({ args, flags }) => {
					received.set({ args, flags });
				}),
			);

		await app.execute({ argv: ["alice"] });

		expect(received.value?.args).toEqual({ name: "ALICE" });
		expect(received.value?.flags).toEqual({ count: 2 });
	});

	it("preserves original parser output on context.input", async () => {
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

	it("passes through preRun/postRun with raw parser context", async () => {
		const phases: Array<{
			phase: "pre" | "run" | "post";
			port: unknown;
			count: unknown;
		}> = [];

		const app = new Crust("hooks")
			.args([
				arg(
					"port",
					z.string().transform(async (v) => Number(v)),
				),
			])
			.flags({
				count: flag(
					z
						.string()
						.default("1")
						.transform(async (v) => Number(v)),
				),
			})
			.preRun(({ args, flags }) => {
				phases.push({
					phase: "pre",
					port: args.port,
					count: flags.count,
				});
			})
			.run(
				commandValidator(({ args, flags }) => {
					phases.push({ phase: "run", port: args.port, count: flags.count });
				}),
			)
			.postRun(({ args, flags }) => {
				phases.push({
					phase: "post",
					port: args.port,
					count: flags.count,
				});
			});

		await app.execute({ argv: ["8080"] });

		expect(phases).toEqual([
			{ phase: "pre", port: "8080", count: undefined },
			{ phase: "run", port: 8080, count: 1 },
			{ phase: "post", port: "8080", count: undefined },
		]);
	});

	it("supports variadic args", async () => {
		const received = capture<unknown>();

		const app = new Crust("lint")
			.args([
				arg("mode", z.string()),
				arg("files", z.string().min(1), { variadic: true }),
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

	it("maps schema failures to CrustError(VALIDATION) with dot-paths", async () => {
		const app = new Crust("check")
			.args([arg("port", z.number().min(1))])
			.flags({
				count: flag(z.number().min(1)),
			})
			.run(
				commandValidator(() => {
					expect.unreachable("handler should not run");
				}),
			);

		const node = app._node;
		const parsed = parseArgs(node, ["0", "--count", "0"]);
		const context = {
			args: parsed.args,
			flags: parsed.flags,
			rawArgs: parsed.rawArgs,
			command: node,
		};
		const run = node.run;
		expect(run).toBeDefined();

		try {
			await run?.(context);
			expect.unreachable("should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(CrustError);
			const crustErr = error as CrustError;
			expect(crustErr.is("VALIDATION")).toBe(true);
			expect(crustErr.message).toContain("args.port");
			expect(crustErr.message).toContain("flags.count");
			expect(crustErr.cause).toEqual(
				expect.arrayContaining([
					{ path: "args.port", message: expect.any(String) },
					{ path: "flags.count", message: expect.any(String) },
				]),
			);
		}
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
		const run = node.run;
		expect(run).toBeDefined();

		try {
			await run?.(context);
			expect.unreachable("should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(CrustError);
			const crustErr = error as CrustError;
			expect(crustErr.is("VALIDATION")).toBe(true);
			expect(crustErr.message).toContain("flags.token");
		}
	});

	it("generates help-compatible definitions", () => {
		const app = new Crust("serve")
			.meta({ description: "Start server" })
			.args([
				arg("port", z.number().describe("Port number")),
				arg("host", z.string().optional().describe("Host")),
			])
			.flags({
				verbose: flag(z.boolean().default(false).describe("Verbose mode"), {
					short: "v",
				}),
			});

		expect(app._node.args).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "port",
					type: "number",
					description: "Port number",
					required: true,
				}),
				expect.objectContaining({
					name: "host",
					type: "string",
					description: "Host",
				}),
			]),
		);
		expect(app._node.effectiveFlags).toEqual(
			expect.objectContaining({
				verbose: expect.objectContaining({
					type: "boolean",
					short: "v",
					description: "Verbose mode",
				}),
			}),
		);
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

	it("works with subcommands", async () => {
		const received = capture<unknown>();

		const app = new Crust("app").command("deploy", (cmd) =>
			cmd
				.flags({
					env: flag(z.string().default("staging"), { short: "e" }),
				})
				.run(
					commandValidator(({ flags }) => {
						received.set(flags);
					}),
				),
		);

		await app.execute({ argv: ["deploy", "-e", "production"] });

		expect(received.value).toEqual({ env: "production" });
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

	it("accepts no variadic args", () => {
		const app = new Crust("ok2").args([
			arg("port", z.number()),
			arg("host", z.string()),
		]);
		expect(app._node.meta.name).toBe("ok2");
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
	it("accepts non-colliding aliases", () => {
		const app = new Crust("ok").flags({
			verbose: flag(z.boolean().default(false), { short: "v" }),
			port: flag(z.number().default(3000), { short: "p" }),
		});
		expect(app._node.meta.name).toBe("ok");
	});

	it("accepts flags without aliases", () => {
		const app = new Crust("ok2").flags({
			verbose: flag(z.boolean().default(false)),
			port: flag(z.number().default(3000)),
		});
		expect(app._node.meta.name).toBe("ok2");
	});

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
// Type-level inference tests (compile-time only)
// ────────────────────────────────────────────────────────────────────────────

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

describe("arg() / flag() generic type narrowing", () => {
	it("narrows variadic to literal true on arg() return type", () => {
		const variadicArg = arg("files", z.string(), { variadic: true });
		type _check = Expect<Equal<typeof variadicArg.variadic, true>>;
		expect(variadicArg.variadic).toBe(true);
	});

	it("narrows variadic to undefined when not specified", () => {
		const plainArg = arg("port", z.number());
		type _check = Expect<Equal<typeof plainArg.variadic, undefined>>;
		expect(plainArg.variadic).toBeUndefined();
	});

	it("narrows short to literal string on flag() return type", () => {
		const f = flag(z.boolean(), { short: "v" });
		type _check = Expect<Equal<typeof f.short, "v">>;
		expect(f.short).toBe("v");
	});

	it("narrows aliases to literal tuple on flag() return type", () => {
		const f = flag(z.boolean(), { aliases: ["verbose", "verb"] });
		type _check = Expect<Equal<typeof f.aliases, readonly ["verbose", "verb"]>>;
		expect(f.aliases).toEqual(["verbose", "verb"]);
	});

	it("narrows short to undefined when not specified", () => {
		const f = flag(z.boolean());
		type _check = Expect<Equal<typeof f.short, undefined>>;
		expect(f.short).toBeUndefined();
	});

	it("narrows aliases to undefined when not specified", () => {
		const f = flag(z.boolean());
		type _check = Expect<Equal<typeof f.aliases, undefined>>;
		expect(f.aliases).toBeUndefined();
	});

	it("narrows inherit to true so core can detect inheritable flags", () => {
		const inherited = flag(z.boolean(), { inherit: true });
		type Flags = { verbose: typeof inherited };
		type Result = InheritableFlags<Flags>;
		type _checkInherit = Expect<Equal<typeof inherited.inherit, true>>;
		type _checkResult = Expect<Equal<Result, Flags>>;
		expect(inherited.inherit).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Explicit parser metadata overrides
// ────────────────────────────────────────────────────────────────────────────

describe("arg() explicit metadata overrides", () => {
	it("uses explicit description over schema description", () => {
		const a = arg("port", z.number().describe("From schema"), {
			description: "Explicit desc",
		});
		expect(a.description).toBe("Explicit desc");
	});

	it("uses schema description when explicit description is not provided", () => {
		const a = arg("port", z.number().describe("From schema"));
		expect(a.description).toBe("From schema");
	});

	it("uses explicit type that matches inferred type without conflict", () => {
		const a = arg("port", z.number(), { type: "number" });
		expect(a.type).toBe("number");
	});

	it("throws when explicit type conflicts with inferred type", () => {
		expect(() => arg("port", z.number(), { type: "string" })).toThrow(
			/explicit type "string" conflicts with schema-inferred type "number"/,
		);
	});

	it("throws when explicit required: true conflicts with optional schema", () => {
		expect(() =>
			arg("host", z.string().optional(), { required: true }),
		).toThrow(
			/explicit required: true conflicts with schema that accepts undefined/,
		);
	});

	it("throws when explicit required: false conflicts with required schema", () => {
		expect(() => arg("port", z.number(), { required: false })).toThrow(
			/explicit required: false conflicts with schema that does not accept undefined/,
		);
	});

	it("accepts explicit required: true that matches required schema", () => {
		const a = arg("port", z.number(), { required: true });
		expect(a.required).toBe(true);
	});

	it("accepts explicit required: false that matches optional schema", () => {
		const a = arg("host", z.string().optional(), { required: false });
		expect(a.required).toBeUndefined();
	});

	it("combines explicit type and description", () => {
		const a = arg("port", z.number(), {
			type: "number",
			description: "Port number",
		});
		expect(a.type).toBe("number");
		expect(a.description).toBe("Port number");
	});

	it("uses explicit description when schema has no description", () => {
		const a = arg("port", z.number(), {
			description: "Explicit only",
		});
		expect(a.description).toBe("Explicit only");
	});

	it("omits description when neither schema nor explicit provides one", () => {
		const a = arg("port", z.number());
		expect(a.description).toBeUndefined();
	});
});

describe("flag() explicit metadata overrides", () => {
	it("uses explicit description over schema description", () => {
		const f = flag(z.boolean().describe("From schema"), {
			description: "Explicit desc",
		});
		expect(f.description).toBe("Explicit desc");
	});

	it("uses explicit type that matches inferred type without conflict", () => {
		const f = flag(z.boolean(), { type: "boolean" });
		expect(f.type).toBe("boolean");
	});

	it("throws when explicit type conflicts with inferred type", () => {
		expect(() => flag(z.boolean(), { type: "string" })).toThrow(
			/explicit type "string" conflicts with schema-inferred type "boolean"/,
		);
	});

	it("throws when explicit required: true conflicts with optional schema", () => {
		expect(() => flag(z.boolean().default(false), { required: true })).toThrow(
			/explicit required: true conflicts/,
		);
	});

	it("throws when explicit required: false conflicts with required schema", () => {
		expect(() => flag(z.string(), { required: false })).toThrow(
			/explicit required: false conflicts/,
		);
	});

	it("accepts explicit required: true that matches required schema", () => {
		const f = flag(z.string(), { required: true });
		expect(f.required).toBe(true);
	});

	it("accepts explicit required: false that matches optional schema", () => {
		const f = flag(z.string().optional(), { required: false });
		expect(f.required).toBeUndefined();
	});

	it("can combine explicit metadata with short alias", () => {
		const f = flag(z.number(), {
			type: "number",
			short: "p",
			description: "Port number",
		});
		expect(f.type).toBe("number");
		expect(f.short).toBe("p");
		expect(f.description).toBe("Port number");
	});

	it("uses explicit description when schema has no description", () => {
		const f = flag(z.boolean(), {
			description: "Enable verbose output",
		});
		expect(f.description).toBe("Enable verbose output");
	});
});

describe("explicit metadata precedence documented in code comments/tests", () => {
	// Precedence rules:
	// 1. Explicit type > schema-inferred type (conflict → DEFINITION error)
	// 2. Explicit description > schema description (no conflict check — additive)
	// 3. Explicit required > schema required (conflict → DEFINITION error)

	it("explicit type takes priority when it matches inferred", () => {
		const a = arg("name", z.string(), { type: "string" });
		expect(a.type).toBe("string");
	});

	it("explicit description always wins over schema description", () => {
		const a = arg("name", z.string().describe("schema desc"), {
			description: "explicit desc",
		});
		expect(a.description).toBe("explicit desc");
	});

	it("explicit required matches schema — no error", () => {
		const a1 = arg("name", z.string(), { required: true });
		expect(a1.required).toBe(true);
		const a2 = arg("name2", z.string().optional(), { required: false });
		expect(a2.required).toBeUndefined();
	});

	it("type conflict is detected even when description override is present", () => {
		expect(() =>
			arg("name", z.string(), { type: "number", description: "Name" }),
		).toThrow(/explicit type "number" conflicts/);
	});
});

describe("type-level InferValidatedArgs / InferValidatedFlags", () => {
	it("infers correct validated types", () => {
		const args = [
			arg("port", z.number()),
			arg("host", z.string().default("localhost")),
		] as const;
		type Args = InferValidatedArgs<typeof args>;
		type _checkPort = Expect<Equal<Args["port"], number>>;
		type _checkHost = Expect<Equal<Args["host"], string>>;
	});

	it("infers variadic as array", () => {
		const args = [arg("files", z.string(), { variadic: true })] as const;
		type Args = InferValidatedArgs<typeof args>;
		type _check = Expect<Equal<Args["files"], string[]>>;
	});

	it("infers flag output types", () => {
		const flags = {
			verbose: flag(z.boolean().default(false)),
			format: flag(z.enum(["json", "text"]).default("text")),
		} as const;
		type Flags = InferValidatedFlags<typeof flags>;
		type _checkVerbose = Expect<Equal<Flags["verbose"], boolean>>;
		type _checkFormat = Expect<Equal<Flags["format"], "json" | "text">>;
	});
});
