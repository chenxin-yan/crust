import { describe, expect, it } from "bun:test";
import { CrustError, defineCommand, runCommand } from "@crustjs/core";
import { z } from "zod";
import { arg, flag } from "./schema.ts";
import type { InferValidatedArgs, InferValidatedFlags } from "./types.ts";
import { withZod } from "./withZod.ts";

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

	it("passes through alias", () => {
		const f = flag(z.boolean().default(false), { alias: "v" });
		expect(f.alias).toBe("v");
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
// defineCommand + withZod composability
// ────────────────────────────────────────────────────────────────────────────

describe("defineCommand + withZod", () => {
	it("validates and transforms args and flags", async () => {
		const received = capture<{ args: unknown; flags: unknown }>();

		const cmd = defineCommand({
			meta: { name: "serve" },
			args: [
				arg("port", z.number().int().min(1)),
				arg("host", z.string().default("localhost")),
			],
			flags: {
				verbose: flag(z.boolean().default(false), { alias: "v" }),
			},
			run: withZod(({ args, flags }) => {
				received.set({ args, flags });
			}),
		});

		await runCommand(cmd, { argv: ["8080", "0.0.0.0", "-v"] });

		expect(received.value).toBeDefined();
		expect(received.value?.args).toEqual({
			port: 8080,
			host: "0.0.0.0",
		});
		expect(received.value?.flags).toEqual({ verbose: true });
	});

	it("applies schema defaults", async () => {
		const received = capture<{ args: unknown; flags: unknown }>();

		const cmd = defineCommand({
			meta: { name: "greet" },
			args: [arg("name", z.string())],
			flags: {
				format: flag(z.string().default("text")),
			},
			run: withZod(({ args, flags }) => {
				received.set({ args, flags });
			}),
		});

		await runCommand(cmd, { argv: ["alice"] });

		expect(received.value?.args).toEqual({ name: "alice" });
		expect(received.value?.flags).toEqual({ format: "text" });
	});

	it("applies schema transforms", async () => {
		const received = capture<{ args: unknown; flags: unknown }>();

		const cmd = defineCommand({
			meta: { name: "greet" },
			args: [
				arg(
					"name",
					z.string().transform((s) => s.toUpperCase()),
				),
			],
			flags: {
				format: flag(
					z
						.string()
						.default("text")
						.transform((v) => v.toUpperCase()),
				),
			},
			run: withZod(({ args, flags }) => {
				received.set({ args, flags });
			}),
		});

		await runCommand(cmd, { argv: ["alice"] });

		expect(received.value?.args).toEqual({ name: "ALICE" });
		expect(received.value?.flags).toEqual({ format: "TEXT" });
	});

	it("supports async transforms", async () => {
		const received = capture<{ args: unknown; flags: unknown }>();

		const cmd = defineCommand({
			meta: { name: "async" },
			args: [
				arg(
					"name",
					z.string().transform(async (v) => v.toUpperCase()),
				),
			],
			flags: {
				count: flag(
					z
						.number()
						.default(1)
						.transform(async (v) => v + 1),
				),
			},
			run: withZod(({ args, flags }) => {
				received.set({ args, flags });
			}),
		});

		await runCommand(cmd, { argv: ["alice"] });

		expect(received.value?.args).toEqual({ name: "ALICE" });
		expect(received.value?.flags).toEqual({ count: 2 });
	});

	it("preserves original parser output on context.input", async () => {
		const received = capture<unknown>();

		const cmd = defineCommand({
			meta: { name: "demo" },
			args: [
				arg(
					"name",
					z.string().transform((s) => s.toUpperCase()),
				),
			],
			flags: {
				count: flag(
					z
						.number()
						.default(2)
						.transform((n) => n + 1),
				),
			},
			run: withZod(({ input, args, flags }) => {
				received.set({ input, args, flags });
			}),
		});

		await runCommand(cmd, { argv: ["world"] });

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

		const cmd = defineCommand({
			meta: { name: "hooks" },
			args: [
				arg(
					"port",
					z.string().transform(async (v) => Number(v)),
				),
			],
			flags: {
				count: flag(
					z
						.string()
						.default("1")
						.transform(async (v) => Number(v)),
				),
			},
			preRun({ args, flags }) {
				phases.push({
					phase: "pre",
					port: args.port,
					count: flags.count,
				});
			},
			run: withZod(({ args, flags }) => {
				phases.push({ phase: "run", port: args.port, count: flags.count });
			}),
			postRun({ args, flags }) {
				phases.push({
					phase: "post",
					port: args.port,
					count: flags.count,
				});
			},
		});

		await runCommand(cmd, { argv: ["8080"] });

		expect(phases).toEqual([
			{ phase: "pre", port: "8080", count: undefined },
			{ phase: "run", port: 8080, count: 1 },
			{ phase: "post", port: "8080", count: undefined },
		]);
	});

	it("supports variadic args", async () => {
		const received = capture<unknown>();

		const cmd = defineCommand({
			meta: { name: "lint" },
			args: [
				arg("mode", z.string()),
				arg("files", z.string().min(1), { variadic: true }),
			],
			run: withZod(({ args }) => {
				received.set(args);
			}),
		});

		await runCommand(cmd, {
			argv: ["strict", "src/a.ts", "src/b.ts"],
		});

		expect(received.value).toEqual({
			mode: "strict",
			files: ["src/a.ts", "src/b.ts"],
		});
	});

	it("maps schema failures to CrustError(VALIDATION) with dot-paths", async () => {
		const cmd = defineCommand({
			meta: { name: "check" },
			args: [arg("port", z.number().min(1))],
			flags: {
				count: flag(z.number().min(1)),
			},
			run: withZod(() => {
				expect.unreachable("handler should not run");
			}),
		});

		try {
			await runCommand(cmd, { argv: ["0", "--count", "0"] });
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
		const cmd = defineCommand({
			meta: { name: "check-async" },
			flags: {
				token: flag(
					z.string().refine(async (v) => v === "secret", "Invalid token"),
				),
			},
			run: withZod(() => {
				expect.unreachable("handler should not run");
			}),
		});

		try {
			await runCommand(cmd, { argv: ["--token", "nope"] });
			expect.unreachable("should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(CrustError);
			const crustErr = error as CrustError;
			expect(crustErr.is("VALIDATION")).toBe(true);
			expect(crustErr.message).toContain("flags.token");
		}
	});

	it("generates help-compatible definitions", () => {
		const cmd = defineCommand({
			meta: { name: "serve", description: "Start server" },
			args: [
				arg("port", z.number().describe("Port number")),
				arg("host", z.string().optional().describe("Host")),
			],
			flags: {
				verbose: flag(z.boolean().default(false).describe("Verbose mode"), {
					alias: "v",
				}),
			},
		});

		expect(cmd.args).toEqual(
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
		expect(cmd.flags).toEqual(
			expect.objectContaining({
				verbose: expect.objectContaining({
					type: "boolean",
					alias: "v",
					description: "Verbose mode",
				}),
			}),
		);
	});

	it("resolves description through Zod wrappers", () => {
		const cmd = defineCommand({
			meta: { name: "unwrap" },
			args: [
				arg("name", z.string().describe("Inner desc").optional()),
				arg("count", z.number().describe("Count desc").default(1)),
			],
			flags: {
				mode: flag(
					z
						.string()
						.describe("Mode desc")
						.transform((v) => v.toUpperCase()),
				),
			},
		});

		expect(cmd.args?.[0]?.description).toBe("Inner desc");
		expect(cmd.args?.[1]?.description).toBe("Count desc");
		expect(cmd.flags?.mode?.description).toBe("Mode desc");
	});

	it("works with subcommands", async () => {
		const received = capture<unknown>();

		const deploy = defineCommand({
			meta: { name: "deploy", description: "Deploy app" },
			flags: {
				env: flag(z.string().default("staging"), { alias: "e" }),
			},
			run: withZod(({ flags }) => {
				received.set(flags);
			}),
		});

		const root = defineCommand({
			meta: { name: "app" },
			subCommands: { deploy },
		});

		await runCommand(root, { argv: ["deploy", "-e", "production"] });

		expect(received.value).toEqual({ env: "production" });
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Compile-time validation — ValidateVariadicArgs / ValidateFlagAliases
// ────────────────────────────────────────────────────────────────────────────

describe("ValidateVariadicArgs (compile-time, via defineCommand)", () => {
	it("accepts variadic as the last arg", () => {
		const cmd = defineCommand({
			meta: { name: "ok" },
			args: [
				arg("mode", z.string()),
				arg("files", z.string(), { variadic: true }),
			],
		});
		expect(cmd.meta.name).toBe("ok");
	});

	it("accepts no variadic args", () => {
		const cmd = defineCommand({
			meta: { name: "ok2" },
			args: [arg("port", z.number()), arg("host", z.string())],
		});
		expect(cmd.meta.name).toBe("ok2");
	});

	it("rejects variadic in non-last position (compile-time)", () => {
		defineCommand({
			meta: { name: "bad-order" },
			args: [
				// @ts-expect-error — variadic is not last, caught at compile time
				arg("files", z.string(), { variadic: true }),
				arg("mode", z.string()),
			],
		});
		expect(true).toBe(true);
	});
});

describe("ValidateFlagAliases (compile-time, via defineCommand)", () => {
	it("accepts non-colliding aliases", () => {
		const cmd = defineCommand({
			meta: { name: "ok" },
			flags: {
				verbose: flag(z.boolean().default(false), { alias: "v" }),
				port: flag(z.number().default(3000), { alias: "p" }),
			},
		});
		expect(cmd.meta.name).toBe("ok");
	});

	it("accepts flags without aliases", () => {
		const cmd = defineCommand({
			meta: { name: "ok2" },
			flags: {
				verbose: flag(z.boolean().default(false)),
				port: flag(z.number().default(3000)),
			},
		});
		expect(cmd.meta.name).toBe("ok2");
	});

	it("rejects alias that collides with a flag name (compile-time)", () => {
		defineCommand({
			meta: { name: "bad-alias" },
			flags: {
				out: flag(z.string().optional()),
				// @ts-expect-error — alias "out" collides with flag name "--out"
				output: flag(z.string().optional(), { alias: "out" }),
			},
		});
		expect(true).toBe(true);
	});

	it("rejects duplicate aliases across flags (compile-time)", () => {
		defineCommand({
			meta: { name: "bad-alias-dup" },
			flags: {
				// @ts-expect-error — alias "v" collides with alias on other flag
				verbose: flag(z.boolean().default(false), { alias: "v" }),
				// @ts-expect-error — alias "v" collides with alias on other flag
				version: flag(z.boolean().default(false), { alias: "v" }),
			},
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

	it("narrows alias to literal string on flag() return type", () => {
		const f = flag(z.boolean(), { alias: "v" });
		type _check = Expect<Equal<typeof f.alias, "v">>;
		expect(f.alias).toBe("v");
	});

	it("narrows alias to literal tuple on flag() return type", () => {
		const f = flag(z.boolean(), { alias: ["v", "V"] });
		type _check = Expect<Equal<typeof f.alias, readonly ["v", "V"]>>;
		expect(f.alias).toEqual(["v", "V"]);
	});

	it("narrows alias to undefined when not specified", () => {
		const f = flag(z.boolean());
		type _check = Expect<Equal<typeof f.alias, undefined>>;
		expect(f.alias).toBeUndefined();
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
