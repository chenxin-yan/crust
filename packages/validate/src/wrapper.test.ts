import { describe, expect, it } from "bun:test";
import { CrustError, defineCommand } from "@crustjs/core";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { z } from "zod";
import type { ValidatedContext } from "./wrapper.ts";
import { withValidation } from "./wrapper.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers — minimal Standard Schema stubs for fine-grained control
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a minimal Standard Schema-compatible stub that always succeeds
 * and returns the provided output value.
 */
function successSchema<Output>(
	output: Output,
): StandardSchemaV1<unknown, Output> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: () => ({ value: output }),
		},
	};
}

/**
 * Create a minimal Standard Schema-compatible stub that always fails
 * with the given issues.
 */
function failureSchema(
	issues: StandardSchemaV1.Issue[],
): StandardSchemaV1<unknown, never> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: () => ({ issues }),
		},
	};
}

/**
 * Create a minimal Standard Schema-compatible stub that returns a Promise
 * (async schema — should be rejected by v1).
 */
function asyncSchema(): StandardSchemaV1<unknown, unknown> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: () => Promise.resolve({ value: {} }),
		},
	};
}

/**
 * Create a Standard Schema that passes through input unchanged.
 */
function passthroughSchema<T>(): StandardSchemaV1<T, T> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: (value) => ({ value: value as T }),
		},
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Base command fixtures
// ────────────────────────────────────────────────────────────────────────────

function createBaseCommand() {
	return defineCommand({
		meta: { name: "test-cmd" },
		args: [
			{ name: "port", type: "number" },
			{ name: "host", type: "string" },
		] as const,
		flags: {
			verbose: { type: "boolean" },
			output: { type: "string" },
		},
	});
}

function createMinimalCommand() {
	return defineCommand({
		meta: { name: "minimal" },
	});
}

/** Capture helper: collects the last value set via closure assignment. */
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
// withValidation — successful validation
// ────────────────────────────────────────────────────────────────────────────

describe("withValidation", () => {
	describe("successful validation", () => {
		it("calls the run handler on successful validation", async () => {
			let called = false;
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					args: passthroughSchema(),
					flags: passthroughSchema(),
				},
				run() {
					called = true;
				},
			});

			await cmd.run?.({
				args: { port: 3000, host: "localhost" },
				flags: { verbose: true, output: "json" },
				rawArgs: [],
				command: cmd,
			});

			expect(called).toBe(true);
		});

		it("passes transformed args from schema output to handler", async () => {
			const received = capture<unknown>();
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					args: successSchema({ port: 8080, host: "0.0.0.0" }),
				},
				run(ctx) {
					received.set(ctx.args);
				},
			});

			await cmd.run?.({
				args: { port: 3000, host: "localhost" },
				flags: { verbose: undefined, output: undefined },
				rawArgs: [],
				command: cmd,
			});

			expect(received.value).toEqual({ port: 8080, host: "0.0.0.0" });
		});

		it("passes transformed flags from schema output to handler", async () => {
			const received = capture<unknown>();
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					flags: successSchema({ verbose: false, output: "table" }),
				},
				run(ctx) {
					received.set(ctx.flags);
				},
			});

			await cmd.run?.({
				args: { port: undefined, host: undefined },
				flags: { verbose: undefined, output: undefined },
				rawArgs: [],
				command: cmd,
			});

			expect(received.value).toEqual({ verbose: false, output: "table" });
		});

		it("transforms both args and flags simultaneously", async () => {
			const received = capture<ValidatedContext<unknown, unknown>>();
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					args: successSchema({ port: 9090, host: "example.com" }),
					flags: successSchema({ verbose: true, output: "csv" }),
				},
				run(ctx) {
					received.set(ctx);
				},
			});

			await cmd.run?.({
				args: { port: 3000, host: "localhost" },
				flags: { verbose: undefined, output: undefined },
				rawArgs: ["--", "extra"],
				command: cmd,
			});

			expect(received.value).toBeDefined();
			expect(received.value?.args).toEqual({
				port: 9090,
				host: "example.com",
			});
			expect(received.value?.flags).toEqual({
				verbose: true,
				output: "csv",
			});
		});

		it("preserves rawArgs in the validated context", async () => {
			const received = capture<unknown>();
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					args: passthroughSchema(),
				},
				run(ctx) {
					received.set(ctx.rawArgs);
				},
			});

			await cmd.run?.({
				args: { port: undefined, host: undefined },
				flags: { verbose: undefined, output: undefined },
				rawArgs: ["extra1", "extra2"],
				command: cmd,
			});

			expect(received.value).toEqual(["extra1", "extra2"]);
		});

		it("preserves command reference in the validated context", async () => {
			const received = capture<unknown>();
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					args: passthroughSchema(),
				},
				run(ctx) {
					received.set(ctx.command);
				},
			});

			await cmd.run?.({
				args: { port: undefined, host: undefined },
				flags: { verbose: undefined, output: undefined },
				rawArgs: [],
				command: cmd,
			});

			expect(received.value).toBe(cmd);
		});

		it("supports async run handlers", async () => {
			let completed = false;
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					args: passthroughSchema(),
				},
				async run() {
					await new Promise((resolve) => setTimeout(resolve, 1));
					completed = true;
				},
			});

			await cmd.run?.({
				args: { port: undefined, host: undefined },
				flags: { verbose: undefined, output: undefined },
				rawArgs: [],
				command: cmd,
			});

			expect(completed).toBe(true);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Original input preservation
	// ────────────────────────────────────────────────────────────────────────

	describe("original input preservation", () => {
		it("preserves original args on context.input when args schema transforms values", async () => {
			const received = capture<ValidatedContext<unknown, unknown>["input"]>();
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					args: successSchema({ port: 9999, host: "transformed" }),
				},
				run(ctx) {
					received.set(ctx.input);
				},
			});

			const originalArgs = { port: 3000, host: "localhost" };
			const originalFlags = { verbose: true, output: "json" };

			await cmd.run?.({
				args: originalArgs,
				flags: originalFlags,
				rawArgs: [],
				command: cmd,
			});

			expect(received.value).toBeDefined();
			expect(received.value?.args).toEqual(originalArgs);
		});

		it("preserves original flags on context.input when flags schema transforms values", async () => {
			const received = capture<ValidatedContext<unknown, unknown>["input"]>();
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					flags: successSchema({ verbose: true, output: "transformed" }),
				},
				run(ctx) {
					received.set(ctx.input);
				},
			});

			const originalArgs = { port: 3000, host: "localhost" };
			const originalFlags = { verbose: false, output: "original" };

			await cmd.run?.({
				args: originalArgs,
				flags: originalFlags,
				rawArgs: [],
				command: cmd,
			});

			expect(received.value).toBeDefined();
			expect(received.value?.flags).toEqual(originalFlags);
		});

		it("preserves both original args and flags on context.input", async () => {
			const received = capture<ValidatedContext<unknown, unknown>["input"]>();
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					args: successSchema({ port: 1111, host: "new-host" }),
					flags: successSchema({ verbose: false, output: "new-output" }),
				},
				run(ctx) {
					received.set(ctx.input);
				},
			});

			const originalArgs = { port: 5000, host: "old-host" };
			const originalFlags = { verbose: true, output: "old-output" };

			await cmd.run?.({
				args: originalArgs,
				flags: originalFlags,
				rawArgs: [],
				command: cmd,
			});

			expect(received.value?.args).toEqual(originalArgs);
			expect(received.value?.flags).toEqual(originalFlags);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Validation failure paths
	// ────────────────────────────────────────────────────────────────────────

	describe("validation failures", () => {
		it("throws CrustError(VALIDATION) when args schema fails", () => {
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					args: failureSchema([{ message: "Expected number", path: ["port"] }]),
				},
				run() {
					expect.unreachable("should not be called");
				},
			});

			expect(() =>
				cmd.run?.({
					args: { port: undefined, host: undefined },
					flags: { verbose: undefined, output: undefined },
					rawArgs: [],
					command: cmd,
				}),
			).toThrow(CrustError);
		});

		it("throws CrustError(VALIDATION) when flags schema fails", () => {
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					flags: failureSchema([{ message: "Required", path: ["output"] }]),
				},
				run() {
					expect.unreachable("should not be called");
				},
			});

			expect(() =>
				cmd.run?.({
					args: { port: undefined, host: undefined },
					flags: { verbose: undefined, output: undefined },
					rawArgs: [],
					command: cmd,
				}),
			).toThrow(CrustError);
		});

		it("includes error code VALIDATION on thrown error", () => {
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					args: failureSchema([{ message: "bad value" }]),
				},
				run() {
					expect.unreachable("should not be called");
				},
			});

			try {
				cmd.run?.({
					args: { port: undefined, host: undefined },
					flags: { verbose: undefined, output: undefined },
					rawArgs: [],
					command: cmd,
				});
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustError);
				const crustErr = err as CrustError;
				expect(crustErr.code).toBe("VALIDATION");
			}
		});

		it("prefixes args issues with 'args' in error paths", () => {
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					args: failureSchema([{ message: "Expected number", path: ["port"] }]),
				},
				run() {
					expect.unreachable("should not be called");
				},
			});

			try {
				cmd.run?.({
					args: { port: undefined, host: undefined },
					flags: { verbose: undefined, output: undefined },
					rawArgs: [],
					command: cmd,
				});
				expect.unreachable("should have thrown");
			} catch (err) {
				const crustErr = err as CrustError;
				expect(crustErr.message).toContain("args.port");
			}
		});

		it("prefixes flags issues with 'flags' in error paths", () => {
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					flags: failureSchema([{ message: "Required", path: ["output"] }]),
				},
				run() {
					expect.unreachable("should not be called");
				},
			});

			try {
				cmd.run?.({
					args: { port: undefined, host: undefined },
					flags: { verbose: undefined, output: undefined },
					rawArgs: [],
					command: cmd,
				});
				expect.unreachable("should have thrown");
			} catch (err) {
				const crustErr = err as CrustError;
				expect(crustErr.message).toContain("flags.output");
			}
		});

		it("aggregates issues from both args and flags schemas", () => {
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					args: failureSchema([{ message: "Expected number", path: ["port"] }]),
					flags: failureSchema([{ message: "Required", path: ["output"] }]),
				},
				run() {
					expect.unreachable("should not be called");
				},
			});

			try {
				cmd.run?.({
					args: { port: undefined, host: undefined },
					flags: { verbose: undefined, output: undefined },
					rawArgs: [],
					command: cmd,
				});
				expect.unreachable("should have thrown");
			} catch (err) {
				const crustErr = err as CrustError;
				expect(crustErr.message).toContain("args.port");
				expect(crustErr.message).toContain("flags.output");
			}
		});

		it("attaches normalized issues as error.cause", () => {
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					args: failureSchema([{ message: "Expected number", path: ["port"] }]),
					flags: failureSchema([{ message: "Required", path: ["output"] }]),
				},
				run() {
					expect.unreachable("should not be called");
				},
			});

			try {
				cmd.run?.({
					args: { port: undefined, host: undefined },
					flags: { verbose: undefined, output: undefined },
					rawArgs: [],
					command: cmd,
				});
				expect.unreachable("should have thrown");
			} catch (err) {
				const crustErr = err as CrustError;
				expect(crustErr.cause).toEqual([
					{ message: "Expected number", path: "args.port" },
					{ message: "Required", path: "flags.output" },
				]);
			}
		});

		it("handles schema issues without path", () => {
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					args: failureSchema([{ message: "Invalid input" }]),
				},
				run() {
					expect.unreachable("should not be called");
				},
			});

			try {
				cmd.run?.({
					args: { port: undefined, host: undefined },
					flags: { verbose: undefined, output: undefined },
					rawArgs: [],
					command: cmd,
				});
				expect.unreachable("should have thrown");
			} catch (err) {
				const crustErr = err as CrustError;
				// Issue without path gets just the "args" prefix
				expect(crustErr.message).toContain("args");
				expect(crustErr.message).toContain("Invalid input");
			}
		});

		it("does not call the run handler on validation failure", () => {
			let handlerCalled = false;
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					args: failureSchema([{ message: "fail" }]),
				},
				run() {
					handlerCalled = true;
				},
			});

			try {
				cmd.run?.({
					args: { port: undefined, host: undefined },
					flags: { verbose: undefined, output: undefined },
					rawArgs: [],
					command: cmd,
				});
			} catch {
				// expected
			}

			expect(handlerCalled).toBe(false);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Async schema rejection
	// ────────────────────────────────────────────────────────────────────────

	describe("async schema rejection", () => {
		it("throws CrustError(VALIDATION) for async args schema", () => {
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					args: asyncSchema(),
				},
				run() {
					expect.unreachable("should not be called");
				},
			});

			expect(() =>
				cmd.run?.({
					args: { port: undefined, host: undefined },
					flags: { verbose: undefined, output: undefined },
					rawArgs: [],
					command: cmd,
				}),
			).toThrow(CrustError);
		});

		it("throws CrustError(VALIDATION) for async flags schema", () => {
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					flags: asyncSchema(),
				},
				run() {
					expect.unreachable("should not be called");
				},
			});

			expect(() =>
				cmd.run?.({
					args: { port: undefined, host: undefined },
					flags: { verbose: undefined, output: undefined },
					rawArgs: [],
					command: cmd,
				}),
			).toThrow(CrustError);
		});

		it("includes async guidance in error message", () => {
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					args: asyncSchema(),
				},
				run() {
					expect.unreachable("should not be called");
				},
			});

			try {
				cmd.run?.({
					args: { port: undefined, host: undefined },
					flags: { verbose: undefined, output: undefined },
					rawArgs: [],
					command: cmd,
				});
				expect.unreachable("should have thrown");
			} catch (err) {
				const crustErr = err as CrustError;
				expect(crustErr.message).toContain("Async validation is not supported");
			}
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Command structure preservation
	// ────────────────────────────────────────────────────────────────────────

	describe("command structure", () => {
		it("preserves meta from the original command", () => {
			const base = defineCommand({
				meta: { name: "my-cmd", description: "A test command" },
			});

			const cmd = withValidation({
				command: base,
				schemas: {},
				run() {},
			});

			expect(cmd.meta.name).toBe("my-cmd");
			expect(cmd.meta.description).toBe("A test command");
		});

		it("preserves args definition from the original command", () => {
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {},
				run() {},
			});

			expect(cmd.args).toEqual(base.args);
		});

		it("preserves flags definition from the original command", () => {
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {},
				run() {},
			});

			expect(cmd.flags).toEqual(base.flags);
		});

		it("preserves subCommands from the original command", () => {
			const sub = defineCommand({ meta: { name: "sub" } });
			const base = defineCommand({
				meta: { name: "parent" },
				subCommands: { sub },
			});

			const cmd = withValidation({
				command: base,
				schemas: {},
				run() {},
			});

			expect(cmd.subCommands).toEqual({ sub });
		});

		it("returns a frozen command object", () => {
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {},
				run() {},
			});

			expect(Object.isFrozen(cmd)).toBe(true);
		});

		it("has a run handler even if original command had none", () => {
			const base = createMinimalCommand();

			const cmd = withValidation({
				command: base,
				schemas: {},
				run() {},
			});

			expect(cmd.run).toBeDefined();
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Partial schema usage
	// ────────────────────────────────────────────────────────────────────────

	describe("partial schema usage", () => {
		it("validates only args when only args schema is provided", async () => {
			const received = capture<ValidatedContext<unknown, unknown>>();
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					args: successSchema({ port: 8080, host: "validated" }),
				},
				run(ctx) {
					received.set(ctx);
				},
			});

			await cmd.run?.({
				args: { port: 3000, host: "localhost" },
				flags: { verbose: true, output: "json" },
				rawArgs: [],
				command: cmd,
			});

			expect(received.value?.args).toEqual({
				port: 8080,
				host: "validated",
			});
			// Flags should pass through unchanged
			expect(received.value?.flags).toEqual({
				verbose: true,
				output: "json",
			});
		});

		it("validates only flags when only flags schema is provided", async () => {
			const received = capture<ValidatedContext<unknown, unknown>>();
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					flags: successSchema({ verbose: false, output: "validated" }),
				},
				run(ctx) {
					received.set(ctx);
				},
			});

			await cmd.run?.({
				args: { port: 3000, host: "localhost" },
				flags: { verbose: true, output: "json" },
				rawArgs: [],
				command: cmd,
			});

			// Args should pass through unchanged
			expect(received.value?.args).toEqual({
				port: 3000,
				host: "localhost",
			});
			expect(received.value?.flags).toEqual({
				verbose: false,
				output: "validated",
			});
		});

		it("passes through both args and flags when no schemas provided", async () => {
			const received = capture<ValidatedContext<unknown, unknown>>();
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {},
				run(ctx) {
					received.set(ctx);
				},
			});

			const originalArgs = { port: 3000, host: "localhost" };
			const originalFlags = { verbose: true, output: "json" };

			await cmd.run?.({
				args: originalArgs,
				flags: originalFlags,
				rawArgs: [],
				command: cmd,
			});

			expect(received.value?.args).toEqual(originalArgs);
			expect(received.value?.flags).toEqual(originalFlags);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Integration with real Zod schemas (Standard Schema provider)
	// ────────────────────────────────────────────────────────────────────────

	describe("integration with Zod schemas", () => {
		it("validates and transforms args with a Zod schema", async () => {
			const received = capture<unknown>();
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					args: z.object({
						port: z.number().min(1).max(65535),
						host: z.string().min(1),
					}),
				},
				run(ctx) {
					received.set(ctx.args);
				},
			});

			await cmd.run?.({
				args: { port: 3000, host: "localhost" },
				flags: { verbose: undefined, output: undefined },
				rawArgs: [],
				command: cmd,
			});

			expect(received.value).toEqual({ port: 3000, host: "localhost" });
		});

		it("throws VALIDATION error when Zod schema rejects args", () => {
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					args: z.object({
						port: z.number().min(1).max(65535),
						host: z.string().min(1),
					}),
				},
				run() {
					expect.unreachable("should not be called");
				},
			});

			try {
				cmd.run?.({
					args: { port: 99999, host: "" },
					flags: { verbose: undefined, output: undefined },
					rawArgs: [],
					command: cmd,
				});
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustError);
				const crustErr = err as CrustError;
				expect(crustErr.code).toBe("VALIDATION");
			}
		});

		it("applies Zod transforms and defaults in flags schema", async () => {
			const received = capture<unknown>();
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					flags: z.object({
						verbose: z.boolean().default(false),
						output: z
							.string()
							.default("text")
							.transform((s) => s.toUpperCase()),
					}),
				},
				run(ctx) {
					received.set(ctx.flags);
				},
			});

			await cmd.run?.({
				args: { port: undefined, host: undefined },
				flags: { verbose: undefined, output: undefined },
				rawArgs: [],
				command: cmd,
			});

			expect(received.value).toEqual({ verbose: false, output: "TEXT" });
		});

		it("preserves original input when Zod transforms values", async () => {
			const received = capture<ValidatedContext<unknown, unknown>["input"]>();
			const base = createBaseCommand();

			const cmd = withValidation({
				command: base,
				schemas: {
					args: z.object({
						port: z.number(),
						host: z.string().transform((s) => s.toUpperCase()),
					}),
				},
				run(ctx) {
					received.set(ctx.input);
				},
			});

			await cmd.run?.({
				args: { port: 3000, host: "localhost" },
				flags: { verbose: undefined, output: undefined },
				rawArgs: [],
				command: cmd,
			});

			expect(received.value?.args).toEqual({
				port: 3000,
				host: "localhost",
			});
		});
	});
});
