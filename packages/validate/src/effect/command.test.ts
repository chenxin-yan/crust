import { describe, expect, it } from "bun:test";
import { Crust, CrustError, parseArgs } from "@crustjs/core";
import * as Schema from "effect/Schema";
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
		const portArg = arg("port", Schema.Number);
		expect(portArg.name).toBe("port");
		expect(portArg.type).toBe("number");
		expect(portArg.required).toBe(true);
	});

	it("marks optional schema as not required", () => {
		const hostArg = arg("host", Schema.UndefinedOr(Schema.String));
		expect(hostArg.type).toBe("string");
		expect(hostArg.required).toBeUndefined();
	});

	it("extracts description from schema annotations", () => {
		const a = arg(
			"port",
			Schema.Number.annotations({ description: "Port to listen on" }),
		);
		expect(a.description).toBe("Port to listen on");
	});

	it("supports variadic option", () => {
		const a = arg("files", Schema.String, { variadic: true });
		expect(a.variadic).toBe(true);
	});

	it("throws DEFINITION for empty name", () => {
		expect(() => arg("", Schema.String)).toThrow(CrustError);
	});

	it("throws DEFINITION for array schema without variadic", () => {
		expect(() => arg("files", Schema.Array(Schema.String))).toThrow(CrustError);
	});

	it("throws DEFINITION for variadic with array schema", () => {
		expect(() =>
			arg("files", Schema.Array(Schema.String), { variadic: true }),
		).toThrow(CrustError);
	});

	it("throws DEFINITION for tuple schemas with fixed elements", () => {
		expect(() =>
			arg("mixed", Schema.Tuple(Schema.String, Schema.Number), {
				variadic: true,
			}),
		).toThrow(/tuple schemas with fixed elements/);
	});
});

describe("flag() produces core-compatible FlagDef", () => {
	it("derives type from schema", () => {
		const f = flag(Schema.UndefinedOr(Schema.Boolean));
		expect(f.type).toBe("boolean");
		expect(f.required).toBeUndefined();
	});

	it("passes through alias", () => {
		const f = flag(Schema.UndefinedOr(Schema.Boolean), { alias: "v" });
		expect(f.alias).toBe("v");
	});

	it("extracts description from schema annotations", () => {
		const f = flag(Schema.String.annotations({ description: "Output dir" }));
		expect(f.description).toBe("Output dir");
	});

	it("resolves description through wrappers", () => {
		const f = flag(
			Schema.UndefinedOr(Schema.Number.annotations({ description: "Count" })),
		);
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
			.args([arg("port", Schema.Number), arg("host", Schema.String)])
			.flags({
				verbose: flag(Schema.Boolean, { alias: "v" }),
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

	it("applies schema defaults via UndefinedOr", async () => {
		const received = capture<{ args: unknown; flags: unknown }>();

		const app = new Crust("greet")
			.args([arg("name", Schema.String)])
			.flags({
				format: flag(Schema.UndefinedOr(Schema.String)),
			})
			.run(
				commandValidator(({ args, flags }) => {
					received.set({ args, flags });
				}),
			);

		await app.execute({ argv: ["alice"] });

		expect(received.value?.args).toEqual({ name: "alice" });
		expect(received.value?.flags).toEqual({ format: undefined });
	});

	it("applies schema transforms", async () => {
		const received = capture<{ args: unknown; flags: unknown }>();

		const UpperString = Schema.transform(Schema.String, Schema.String, {
			strict: false,
			decode: (s) => s.toUpperCase(),
			encode: (s) => s,
		});

		const app = new Crust("greet")
			.args([arg("name", UpperString)])
			.flags({
				format: flag(
					Schema.UndefinedOr(
						Schema.transform(Schema.String, Schema.String, {
							strict: false,
							decode: (v) => v.toUpperCase(),
							encode: (v) => v,
						}),
					),
				),
			})
			.run(
				commandValidator(({ args, flags }) => {
					received.set({ args, flags });
				}),
			);

		await app.execute({ argv: ["alice", "--format", "text"] });

		expect(received.value?.args).toEqual({ name: "ALICE" });
		expect(received.value?.flags).toEqual({ format: "TEXT" });
	});

	it("preserves original parser output on context.input", async () => {
		const received = capture<unknown>();

		const app = new Crust("demo")
			.args([arg("name", Schema.String)])
			.flags({
				count: flag(Schema.UndefinedOr(Schema.Number)),
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
			args: { name: "world" },
			flags: { count: undefined },
		});
	});

	it("passes through preRun/postRun with raw parser context", async () => {
		const phases: Array<{
			phase: "pre" | "run" | "post";
			port: unknown;
			count: unknown;
		}> = [];

		const app = new Crust("hooks")
			.args([arg("port", Schema.Number)])
			.flags({
				count: flag(Schema.UndefinedOr(Schema.Number)),
			})
			.preRun(({ args, flags }) => {
				const rawArgs = args as Record<string, unknown>;
				const rawFlags = flags as Record<string, unknown>;
				phases.push({
					phase: "pre",
					port: rawArgs.port,
					count: rawFlags.count,
				});
			})
			.run(
				commandValidator(({ args, flags }) => {
					phases.push({ phase: "run", port: args.port, count: flags.count });
				}),
			)
			.postRun(({ args, flags }) => {
				const rawArgs = args as Record<string, unknown>;
				const rawFlags = flags as Record<string, unknown>;
				phases.push({
					phase: "post",
					port: rawArgs.port,
					count: rawFlags.count,
				});
			});

		await app.execute({ argv: ["8080"] });

		expect(phases).toEqual([
			{ phase: "pre", port: 8080, count: undefined },
			{ phase: "run", port: 8080, count: undefined },
			{ phase: "post", port: 8080, count: undefined },
		]);
	});

	it("supports variadic args", async () => {
		const received = capture<unknown>();

		const app = new Crust("lint")
			.args([
				arg("mode", Schema.String),
				arg("files", Schema.String, { variadic: true }),
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
			.args([arg("env", Schema.Literal("prod"))])
			.flags({
				mode: flag(Schema.Literal("strict")),
			})
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
		const run = node.run;
		expect(run).toBeDefined();

		try {
			await run?.(context);
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

	it("generates help-compatible definitions", () => {
		const app = new Crust({ name: "serve", description: "Start server" })
			.args([
				arg("port", Schema.Number.annotations({ description: "Port number" })),
				arg(
					"host",
					Schema.UndefinedOr(
						Schema.String.annotations({ description: "Host" }),
					),
				),
			])
			.flags({
				verbose: flag(
					Schema.Boolean.annotations({ description: "Verbose mode" }),
					{ alias: "v" },
				),
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
					alias: "v",
					description: "Verbose mode",
				}),
			}),
		);
	});

	it("resolves description through Effect wrappers", () => {
		const app = new Crust("unwrap")
			.args([
				arg(
					"name",
					Schema.UndefinedOr(
						Schema.String.annotations({ description: "Inner desc" }),
					),
				),
			])
			.flags({
				mode: flag(
					Schema.transform(
						Schema.String.annotations({ description: "Mode desc" }),
						Schema.String,
						{ strict: false, decode: (v) => v, encode: (v) => v },
					),
				),
			});

		expect(app._node.args?.[0]?.description).toBe("Inner desc");
		expect(app._node.effectiveFlags?.mode?.description).toBe("Mode desc");
	});

	it("works with subcommands", async () => {
		const received = capture<unknown>();

		const app = new Crust("app").command("deploy", (cmd) =>
			cmd
				.flags({
					env: flag(Schema.UndefinedOr(Schema.String), { alias: "e" }),
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
			arg("mode", Schema.String),
			arg("files", Schema.String, { variadic: true }),
		]);
		expect(app._node.meta.name).toBe("ok");
	});

	it("accepts no variadic args", () => {
		const app = new Crust("ok2").args([
			arg("port", Schema.Number),
			arg("host", Schema.String),
		]);
		expect(app._node.meta.name).toBe("ok2");
	});

	it("rejects variadic in non-last position (compile-time)", () => {
		new Crust("bad-order").args([
			// @ts-expect-error — variadic is not last, caught at compile time
			arg("files", Schema.String, { variadic: true }),
			arg("mode", Schema.String),
		]);
		expect(true).toBe(true);
	});
});

describe("ValidateFlagAliases (compile-time, via Crust builder)", () => {
	it("accepts non-colliding aliases", () => {
		const app = new Crust("ok").flags({
			verbose: flag(Schema.Boolean, { alias: "v" }),
			port: flag(Schema.Number, { alias: "p" }),
		});
		expect(app._node.meta.name).toBe("ok");
	});

	it("accepts flags without aliases", () => {
		const app = new Crust("ok2").flags({
			verbose: flag(Schema.Boolean),
			port: flag(Schema.Number),
		});
		expect(app._node.meta.name).toBe("ok2");
	});

	it("rejects alias that collides with a flag name (compile-time)", () => {
		new Crust("bad-alias").flags({
			out: flag(Schema.UndefinedOr(Schema.String)),
			// @ts-expect-error — alias "out" collides with flag name "--out"
			output: flag(Schema.UndefinedOr(Schema.String), { alias: "out" }),
		});
		expect(true).toBe(true);
	});

	it("rejects duplicate aliases across flags (compile-time)", () => {
		new Crust("bad-alias-dup").flags({
			// @ts-expect-error — alias "v" collides with alias on other flag
			verbose: flag(Schema.Boolean, { alias: "v" }),
			// @ts-expect-error — alias "v" collides with alias on other flag
			version: flag(Schema.Boolean, { alias: "v" }),
		});
		expect(true).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Type-level generic narrowing and inference
// ────────────────────────────────────────────────────────────────────────────

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

describe("arg() / flag() generic type narrowing", () => {
	it("narrows variadic to literal true on arg() return type", () => {
		const variadicArg = arg("files", Schema.String, { variadic: true });
		type _check = Expect<Equal<typeof variadicArg.variadic, true>>;
		expect(variadicArg.variadic).toBe(true);
	});

	it("narrows variadic to undefined when not specified", () => {
		const plainArg = arg("port", Schema.Number);
		type _check = Expect<Equal<typeof plainArg.variadic, undefined>>;
		expect(plainArg.variadic).toBeUndefined();
	});

	it("narrows alias to literal string on flag() return type", () => {
		const f = flag(Schema.Boolean, { alias: "v" });
		type _check = Expect<Equal<typeof f.alias, "v">>;
		expect(f.alias).toBe("v");
	});

	it("narrows alias to literal tuple on flag() return type", () => {
		const f = flag(Schema.Boolean, { alias: ["v", "V"] });
		type _check = Expect<Equal<typeof f.alias, readonly ["v", "V"]>>;
		expect(f.alias).toEqual(["v", "V"]);
	});

	it("narrows alias to undefined when not specified", () => {
		const f = flag(Schema.Boolean);
		type _check = Expect<Equal<typeof f.alias, undefined>>;
		expect(f.alias).toBeUndefined();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Explicit parser metadata overrides
// ────────────────────────────────────────────────────────────────────────────

describe("arg() explicit metadata overrides", () => {
	it("uses explicit description over schema annotation", () => {
		const a = arg(
			"port",
			Schema.Number.annotations({ description: "From schema" }),
			{ description: "Explicit desc" },
		);
		expect(a.description).toBe("Explicit desc");
	});

	it("uses schema description when explicit description is not provided", () => {
		const a = arg(
			"port",
			Schema.Number.annotations({ description: "From schema" }),
		);
		expect(a.description).toBe("From schema");
	});

	it("uses explicit type that matches inferred type without conflict", () => {
		const a = arg("port", Schema.Number, { type: "number" });
		expect(a.type).toBe("number");
	});

	it("throws when explicit type conflicts with inferred type", () => {
		expect(() => arg("port", Schema.Number, { type: "string" })).toThrow(
			/explicit type "string" conflicts with schema-inferred type "number"/,
		);
	});

	it("throws when explicit required: true conflicts with optional schema", () => {
		expect(() =>
			arg("host", Schema.UndefinedOr(Schema.String), { required: true }),
		).toThrow(
			/explicit required: true conflicts with schema that accepts undefined/,
		);
	});

	it("throws when explicit required: false conflicts with required schema", () => {
		expect(() => arg("port", Schema.Number, { required: false })).toThrow(
			/explicit required: false conflicts with schema that does not accept undefined/,
		);
	});

	it("accepts explicit required: true that matches required schema", () => {
		const a = arg("port", Schema.Number, { required: true });
		expect(a.required).toBe(true);
	});

	it("accepts explicit required: false that matches optional schema", () => {
		const a = arg("host", Schema.UndefinedOr(Schema.String), {
			required: false,
		});
		expect(a.required).toBeUndefined();
	});

	it("combines explicit type and description", () => {
		const a = arg("port", Schema.Number, {
			type: "number",
			description: "Port number",
		});
		expect(a.type).toBe("number");
		expect(a.description).toBe("Port number");
	});

	it("uses explicit description when schema has no annotation", () => {
		const a = arg("port", Schema.Number, {
			description: "Explicit only",
		});
		expect(a.description).toBe("Explicit only");
	});

	it("falls back to schema annotation when no explicit description", () => {
		// Effect's Schema.Number already has a built-in description annotation ("a number")
		const a = arg("port", Schema.Number);
		expect(a.description).toBe("a number");
	});
});

describe("flag() explicit metadata overrides", () => {
	it("uses explicit description over schema annotation", () => {
		const f = flag(Schema.Boolean.annotations({ description: "From schema" }), {
			description: "Explicit desc",
		});
		expect(f.description).toBe("Explicit desc");
	});

	it("uses explicit type that matches inferred type without conflict", () => {
		const f = flag(Schema.Boolean, { type: "boolean" });
		expect(f.type).toBe("boolean");
	});

	it("throws when explicit type conflicts with inferred type", () => {
		expect(() => flag(Schema.Boolean, { type: "string" })).toThrow(
			/explicit type "string" conflicts with schema-inferred type "boolean"/,
		);
	});

	it("throws when explicit required: true conflicts with optional schema", () => {
		expect(() =>
			flag(Schema.UndefinedOr(Schema.Boolean), { required: true }),
		).toThrow(/explicit required: true conflicts/);
	});

	it("throws when explicit required: false conflicts with required schema", () => {
		expect(() => flag(Schema.String, { required: false })).toThrow(
			/explicit required: false conflicts/,
		);
	});

	it("accepts explicit required: true that matches required schema", () => {
		const f = flag(Schema.String, { required: true });
		expect(f.required).toBe(true);
	});

	it("accepts explicit required: false that matches optional schema", () => {
		const f = flag(Schema.UndefinedOr(Schema.String), { required: false });
		expect(f.required).toBeUndefined();
	});

	it("can combine explicit metadata with alias", () => {
		const f = flag(Schema.Number, {
			type: "number",
			alias: "p",
			description: "Port number",
		});
		expect(f.type).toBe("number");
		expect(f.alias).toBe("p");
		expect(f.description).toBe("Port number");
	});

	it("uses explicit description when schema has no annotation", () => {
		const f = flag(Schema.Boolean, {
			description: "Enable verbose output",
		});
		expect(f.description).toBe("Enable verbose output");
	});
});

describe("explicit metadata precedence rules", () => {
	it("explicit type takes priority when it matches inferred", () => {
		const a = arg("name", Schema.String, { type: "string" });
		expect(a.type).toBe("string");
	});

	it("explicit description always wins over schema description", () => {
		const a = arg(
			"name",
			Schema.String.annotations({ description: "schema desc" }),
			{ description: "explicit desc" },
		);
		expect(a.description).toBe("explicit desc");
	});

	it("explicit required matches schema — no error", () => {
		const a1 = arg("name", Schema.String, { required: true });
		expect(a1.required).toBe(true);
		const a2 = arg("name2", Schema.UndefinedOr(Schema.String), {
			required: false,
		});
		expect(a2.required).toBeUndefined();
	});

	it("type conflict is detected even when description override is present", () => {
		expect(() =>
			arg("name", Schema.String, { type: "number", description: "Name" }),
		).toThrow(/explicit type "number" conflicts/);
	});
});

describe("type-level InferValidatedArgs / InferValidatedFlags", () => {
	it("infers correct validated types", () => {
		const args = [
			arg("port", Schema.Number),
			arg("host", Schema.UndefinedOr(Schema.String)),
		] as const;
		type Args = InferValidatedArgs<typeof args>;
		type _checkPort = Expect<Equal<Args["port"], number>>;
		type _checkHost = Expect<Equal<Args["host"], string | undefined>>;
	});

	it("infers variadic as array", () => {
		const args = [arg("files", Schema.String, { variadic: true })] as const;
		type Args = InferValidatedArgs<typeof args>;
		type _check = Expect<Equal<Args["files"], string[]>>;
	});

	it("infers flag output types", () => {
		const flags = {
			verbose: flag(Schema.Boolean),
			format: flag(Schema.Literal("json", "text")),
		} as const;
		type Flags = InferValidatedFlags<typeof flags>;
		type _checkVerbose = Expect<Equal<Flags["verbose"], boolean>>;
		type _checkFormat = Expect<Equal<Flags["format"], "json" | "text">>;
	});
});
