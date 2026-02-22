import { describe, expect, it } from "bun:test";
import type { CommandDef } from "@crustjs/core";
import { CrustError, runCommand } from "@crustjs/core";
import * as Schema from "effect/Schema";
import { defineEffectCommand } from "./command.ts";
import { arg, flag } from "./schema.ts";
import type { EffectCommandDef } from "./types.ts";

function capture<T>(): { value: T | undefined; set(v: T): void } {
	const box: { value: T | undefined; set(v: T): void } = {
		value: undefined,
		set(v: T) {
			box.value = v;
		},
	};
	return box;
}

describe("defineEffectCommand", () => {
	it("infers named args and flags types in the run handler", () => {
		defineEffectCommand({
			meta: { name: "types" },
			args: [arg("port", Schema.Number)],
			flags: {
				verbose: flag(Schema.Boolean),
			},
			run({ args, flags }) {
				const port: number = args.port;
				const verbose: boolean = flags.verbose;
				expect(typeof port).toBe("number");
				expect(typeof verbose).toBe("boolean");
			},
		});
	});

	it("uses schemas as source-of-truth for args and flags", async () => {
		const received = capture<{ args: unknown; flags: unknown }>();

		const cmd = defineEffectCommand({
			meta: { name: "serve" },
			args: [arg("port", Schema.Number), arg("host", Schema.String)],
			flags: {
				verbose: flag(Schema.Boolean, {
					alias: "v",
					description: "Verbose logging",
				}),
			},
			run({ args, flags }) {
				received.set({ args, flags });
			},
		});

		await runCommand(cmd, { argv: ["8080", "0.0.0.0", "-v"] });

		expect(received.value).toBeDefined();
		expect(received.value?.args).toEqual({
			port: 8080,
			host: "0.0.0.0",
		});
		expect(received.value?.flags).toEqual({ verbose: true });
	});

	it("preserves original parser output on context.input", async () => {
		const received = capture<unknown>();

		const cmd = defineEffectCommand({
			meta: { name: "demo" },
			args: [arg("name", Schema.String)],
			flags: {
				count: flag(Schema.UndefinedOr(Schema.Number)),
			},
			run({ input, args, flags }) {
				received.set({ input, args, flags });
			},
		});

		await runCommand(cmd, { argv: ["world"] });

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

		const cmd = defineEffectCommand({
			meta: { name: "hooks" },
			args: [arg("port", Schema.Number)],
			flags: {
				count: flag(Schema.UndefinedOr(Schema.Number)),
			},
			preRun({ args, flags }) {
				const rawArgs = args as Record<string, unknown>;
				const rawFlags = flags as Record<string, unknown>;
				phases.push({
					phase: "pre",
					port: rawArgs.port,
					count: rawFlags.count,
				});
			},
			run({ args, flags }) {
				phases.push({ phase: "run", port: args.port, count: flags.count });
			},
			postRun({ args, flags }) {
				const rawArgs = args as Record<string, unknown>;
				const rawFlags = flags as Record<string, unknown>;
				phases.push({
					phase: "post",
					port: rawArgs.port,
					count: rawFlags.count,
				});
			},
		});

		await runCommand(cmd, { argv: ["8080"] });

		expect(phases).toEqual([
			{ phase: "pre", port: 8080, count: undefined },
			{ phase: "run", port: 8080, count: undefined },
			{ phase: "post", port: 8080, count: undefined },
		]);
	});

	it("supports variadic args with named object output", async () => {
		const received = capture<unknown>();

		const cmd = defineEffectCommand({
			meta: { name: "lint" },
			args: [
				arg("mode", Schema.String),
				arg("files", Schema.String, { variadic: true }),
			],
			run({ args }) {
				received.set(args);
			},
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
		const cmd = defineEffectCommand({
			meta: { name: "check" },
			args: [arg("env", Schema.Literal("prod"))],
			flags: {
				mode: flag(Schema.Literal("strict")),
			},
			run() {
				expect.unreachable("handler should not run");
			},
		});

		try {
			await runCommand(cmd, { argv: ["dev", "--mode", "loose"] });
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

	it("generates help-compatible arg and flag definitions", () => {
		const cmd = defineEffectCommand({
			meta: { name: "serve", description: "Start server" },
			args: [
				arg("port", Schema.Number.annotations({ description: "Port number" })),
				arg("host", Schema.UndefinedOr(Schema.String), { description: "Host" }),
			],
			flags: {
				verbose: flag(Schema.Boolean, {
					alias: "v",
					description: "Verbose mode",
				}),
			},
		});

		expect(cmd.args).toEqual([
			{
				name: "port",
				type: "number",
				description: "Port number",
				required: true,
			},
			{ name: "host", type: "string", description: "Host" },
		]);
		expect(cmd.flags).toEqual({
			verbose: {
				type: "boolean",
				alias: "v",
				description: "Verbose mode",
				required: true,
			},
		});
	});

	it("throws DEFINITION for array arg without variadic", () => {
		expect(() =>
			defineEffectCommand({
				meta: { name: "bad" },
				args: [arg("files", Schema.Array(Schema.String))],
			}),
		).toThrow(CrustError);
	});

	it("throws DEFINITION for tuple schemas with fixed elements", () => {
		expect(() =>
			defineEffectCommand({
				meta: { name: "bad-tuple" },
				args: [
					arg("mixed", Schema.Tuple(Schema.String, Schema.Number), {
						variadic: true,
					}),
				],
			}),
		).toThrow(/tuple schemas with fixed elements/);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Type-level validation tests (compile-time only)
// ────────────────────────────────────────────────────────────────────────────

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

type _assertKeysInSync = Expect<
	Equal<keyof CommandDef, keyof EffectCommandDef>
>;

describe("ValidateVariadicArgs (compile-time, via defineEffectCommand)", () => {
	it("accepts variadic as the last arg", () => {
		const cmd = defineEffectCommand({
			meta: { name: "ok" },
			args: [
				arg("mode", Schema.String),
				arg("files", Schema.String, { variadic: true }),
			],
		});
		expect(cmd.meta.name).toBe("ok");
	});

	it("rejects variadic in non-last position (compile-time)", () => {
		expect(() =>
			defineEffectCommand({
				meta: { name: "bad-order" },
				args: [
					// @ts-expect-error — intentionally invalid: variadic is not last
					arg("files", Schema.String, { variadic: true }),
					arg("mode", Schema.String),
				],
			}),
		).toThrow(CrustError);

		expect(true).toBe(true);
	});
});

describe("ValidateFlagAliases (compile-time, via defineEffectCommand)", () => {
	it("accepts non-colliding aliases", () => {
		const cmd = defineEffectCommand({
			meta: { name: "ok" },
			flags: {
				verbose: flag(Schema.Boolean, { alias: "v" }),
				port: flag(Schema.Number, { alias: "p" }),
			},
		});
		expect(cmd.meta.name).toBe("ok");
	});

	it("rejects duplicate aliases across flags (compile-time)", () => {
		defineEffectCommand({
			meta: { name: "bad-alias-dup" },
			flags: {
				// @ts-expect-error — alias "v" collides with alias on other flag
				verbose: flag(Schema.Boolean, { alias: "v" }),
				// @ts-expect-error — alias "v" collides with alias on other flag
				version: flag(Schema.Boolean, { alias: "v" }),
			},
		});

		expect(true).toBe(true);
	});
});

describe("arg() / flag() generic type narrowing", () => {
	it("narrows variadic to literal true on arg() return type", () => {
		const variadicArg = arg("files", Schema.String, { variadic: true });
		type _check = Expect<Equal<typeof variadicArg.variadic, true>>;
		expect(variadicArg.variadic).toBe(true);
	});

	it("narrows alias to literal string on flag() return type", () => {
		const f = flag(Schema.Boolean, { alias: "v" });
		type _check = Expect<Equal<typeof f.alias, "v">>;
		expect(f.alias).toBe("v");
	});
});
