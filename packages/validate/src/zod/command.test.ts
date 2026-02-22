import { describe, expect, it } from "bun:test";
import { CrustError, runCommand } from "@crustjs/core";
import { z } from "zod";
import { defineZodCommand } from "./command.ts";
import { arg, flag } from "./schema.ts";

function capture<T>(): { value: T | undefined; set(v: T): void } {
	const box: { value: T | undefined; set(v: T): void } = {
		value: undefined,
		set(v: T) {
			box.value = v;
		},
	};
	return box;
}

describe("defineZodCommand", () => {
	it("infers named args and flags types in the run handler", () => {
		defineZodCommand({
			meta: { name: "types" },
			args: [arg("port", z.number())],
			flags: {
				verbose: flag(z.boolean().default(false)),
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

		const cmd = defineZodCommand({
			meta: { name: "serve" },
			args: [
				arg("port", z.number().int().min(1)),
				arg("host", z.string().default("localhost")),
			],
			flags: {
				verbose: flag(z.boolean().default(false), {
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

	it("applies schema defaults and transforms", async () => {
		const received = capture<{ args: unknown; flags: unknown }>();

		const cmd = defineZodCommand({
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
						.transform((value) => value.toUpperCase()),
				),
			},
			run({ args, flags }) {
				received.set({ args, flags });
			},
		});

		await runCommand(cmd, { argv: ["alice"] });

		expect(received.value?.args).toEqual({ name: "ALICE" });
		expect(received.value?.flags).toEqual({ format: "TEXT" });
	});

	it("supports async transforms in args and flags", async () => {
		const received = capture<{ args: unknown; flags: unknown }>();

		const cmd = defineZodCommand({
			meta: { name: "async-transform" },
			args: [
				arg(
					"name",
					z.string().transform(async (value) => value.toUpperCase()),
				),
			],
			flags: {
				count: flag(
					z
						.number()
						.default(1)
						.transform(async (value) => value + 1),
				),
			},
			run({ args, flags }) {
				received.set({ args, flags });
			},
		});

		await runCommand(cmd, { argv: ["alice"] });

		expect(received.value?.args).toEqual({ name: "ALICE" });
		expect(received.value?.flags).toEqual({ count: 2 });
	});

	it("preserves original parser output on context.input", async () => {
		const received = capture<unknown>();

		const cmd = defineZodCommand({
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

		const cmd = defineZodCommand({
			meta: { name: "hooks" },
			args: [
				arg(
					"port",
					z.string().transform(async (value) => Number(value)),
				),
			],
			flags: {
				count: flag(
					z
						.string()
						.default("1")
						.transform(async (value) => Number(value)),
				),
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
			{ phase: "pre", port: "8080", count: undefined },
			{ phase: "run", port: 8080, count: 1 },
			{ phase: "post", port: "8080", count: undefined },
		]);
	});

	it("supports variadic args with named object output", async () => {
		const received = capture<unknown>();

		const cmd = defineZodCommand({
			meta: { name: "lint" },
			args: [
				arg("mode", z.string()),
				arg("files", z.string().min(1), { variadic: true }),
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
		const cmd = defineZodCommand({
			meta: { name: "check" },
			args: [arg("port", z.number().min(1))],
			flags: {
				count: flag(z.number().min(1)),
			},
			run() {
				expect.unreachable("handler should not run");
			},
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
		const cmd = defineZodCommand({
			meta: { name: "check-async" },
			flags: {
				token: flag(
					z
						.string()
						.refine(async (value) => value === "secret", "Invalid token"),
				),
			},
			run() {
				expect.unreachable("handler should not run");
			},
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

	it("generates help-compatible arg and flag definitions", () => {
		const cmd = defineZodCommand({
			meta: { name: "serve", description: "Start server" },
			args: [
				arg("port", z.number(), { description: "Port number" }),
				arg("host", z.string().optional(), { description: "Host" }),
			],
			flags: {
				verbose: flag(z.boolean().default(false), {
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
			},
		});
	});

	it("throws DEFINITION for array arg without variadic", () => {
		expect(() =>
			defineZodCommand({
				meta: { name: "bad" },
				args: [arg("files", z.array(z.string()))],
			}),
		).toThrow(CrustError);
	});

	it("throws DEFINITION when a variadic arg is not last", () => {
		expect(() =>
			defineZodCommand({
				meta: { name: "bad-order" },
				args: [
					arg("files", z.string(), { variadic: true }),
					arg("mode", z.string()),
				],
			}),
		).toThrow(CrustError);
	});
});
