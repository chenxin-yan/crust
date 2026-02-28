/**
 * Cross-package integration tests — verify consistent validation semantics
 * across command, prompt, and store targets using shared schemas.
 *
 * These tests exercise one schema definition across all three validation
 * surfaces (command handler, prompt validator, store validator) and assert:
 *
 * - Consistent issue path formatting (dot-paths, bracket-notation)
 * - Consistent message rendering (bullet lists, single-issue messages)
 * - Consistent handling of root-level issues, nested objects, arrays, transforms
 * - Sync and async behavior parity where applicable
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CrustError, defineCommand, runCommand } from "@crustjs/core";
import { CrustStoreError, createStore } from "@crustjs/store";
import * as Schema from "effect/Schema";
import { z } from "zod";

import {
	arg as effectArg,
	commandValidator as effectCommandValidator,
	flag as effectFlag,
	parsePromptValue as effectParsePromptValue,
	promptValidator as effectPromptValidator,
	storeValidator as effectStoreValidator,
} from "../src/effect/index.ts";
import {
	parsePromptValue,
	parsePromptValueSync,
	promptValidator,
	storeValidator,
	storeValidatorSync,
} from "../src/standard/index.ts";
import {
	validateStandard,
	validateStandardSync,
} from "../src/standard/validate.ts";
import {
	arg as zodArg,
	commandValidator as zodCommandValidator,
	flag as zodFlag,
} from "../src/zod/index.ts";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function capture<T>(): { value: T | undefined; set(v: T): void } {
	const box: { value: T | undefined; set(v: T): void } = {
		value: undefined,
		set(v: T) {
			box.value = v;
		},
	};
	return box;
}

function createTempDir(): string {
	return join(tmpdir(), `crust-integration-test-${randomUUID()}`);
}

/** Extract issues from a CrustError<"VALIDATION">, falling back to empty array. */
function extractIssues(
	err: CrustError<"VALIDATION">,
): readonly { readonly message: string; readonly path: string }[] {
	return err.details?.issues ?? [];
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Shared Zod schema across all targets
// ────────────────────────────────────────────────────────────────────────────

describe("Zod: shared schema across command, prompt, and store", () => {
	// ── Shared schema ─────────────────────────────────────────────────────
	// Config-level schema for store validation
	const configSchema = z.object({
		theme: z.enum(["light", "dark"]),
		verbose: z.boolean(),
	});

	// ── Store setup ───────────────────────────────────────────────────────
	let tempDir: string;
	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
	});
	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	// ── Command target ────────────────────────────────────────────────────

	it("command: validates valid args and flags", async () => {
		const received = capture<{ args: unknown; flags: unknown }>();
		const cmd = defineCommand({
			meta: { name: "config" },
			args: [zodArg("theme", z.enum(["light", "dark"]))],
			flags: {
				verbose: zodFlag(z.boolean().default(false), { alias: "v" }),
			},
			run: zodCommandValidator(({ args, flags }) => {
				received.set({ args, flags });
			}),
		});

		await runCommand(cmd, { argv: ["dark", "-v"] });
		expect(received.value).toEqual({
			args: { theme: "dark" },
			flags: { verbose: true },
		});
	});

	it("command: rejects invalid input with VALIDATION error and path-formatted issues", async () => {
		const cmd = defineCommand({
			meta: { name: "config" },
			args: [zodArg("theme", z.enum(["light", "dark"]))],
			flags: {
				verbose: zodFlag(z.boolean().default(false)),
			},
			run: zodCommandValidator(() => {}),
		});

		try {
			await runCommand(cmd, { argv: ["invalid-theme"] });
			expect.unreachable("Should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			const crustErr = err as CrustError<"VALIDATION">;
			expect(crustErr.code).toBe("VALIDATION");
			const issues = extractIssues(crustErr);
			expect(issues.length).toBeGreaterThan(0);
			// Issue path should be formatted as dot-path: "args.theme"
			expect(issues[0]?.path).toBe("args.theme");
		}
	});

	// ── Prompt target ─────────────────────────────────────────────────────

	it("prompt: validator returns true for valid input", async () => {
		const validate = promptValidator(z.enum(["light", "dark"]));
		const result = await validate("light");
		expect(result).toBe(true);
	});

	it("prompt: validator returns error message for invalid input", async () => {
		const validate = promptValidator(z.enum(["light", "dark"]));
		const result = await validate("blue" as "light");
		expect(typeof result).toBe("string");
		expect(result).not.toBe(true);
	});

	it("prompt: parsePromptValue returns typed output on valid input", async () => {
		const schema = z.enum(["light", "dark"]);
		const result = await parsePromptValue(schema, "dark");
		expect(result).toBe("dark");
	});

	it("prompt: parsePromptValue throws VALIDATION error on invalid input", async () => {
		const schema = z.enum(["light", "dark"]);
		try {
			await parsePromptValue(schema, "blue" as "light");
			expect.unreachable("Should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			const crustErr = err as CrustError<"VALIDATION">;
			expect(crustErr.code).toBe("VALIDATION");
			expect(extractIssues(crustErr).length).toBeGreaterThan(0);
		}
	});

	it("prompt: parsePromptValueSync works for sync schemas", () => {
		const schema = z.enum(["light", "dark"]);
		const result = parsePromptValueSync(schema, "dark");
		expect(result).toBe("dark");
	});

	// ── Store target ──────────────────────────────────────────────────────

	it("store: validates valid config on write and read", async () => {
		const defaults = {
			theme: "light" as string,
			verbose: false,
		};

		const store = createStore({
			dirPath: tempDir,
			defaults,
			validator: storeValidator(configSchema),
		});

		await store.write({ theme: "dark", verbose: true });
		const config = await store.read();
		expect(config.theme).toBe("dark");
		expect(config.verbose).toBe(true);
	});

	it("store: rejects invalid config on write with VALIDATION error", async () => {
		const defaults = {
			theme: "light" as string,
			verbose: false,
		};

		const store = createStore({
			dirPath: tempDir,
			defaults,
			validator: storeValidator(configSchema),
		});

		try {
			// "blue" is not a valid theme
			await store.write({ theme: "blue" as "light", verbose: false });
			expect.unreachable("Should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			const storeErr = err as CrustStoreError<"VALIDATION">;
			expect(storeErr.is("VALIDATION")).toBe(true);
			expect(storeErr.details.operation).toBe("write");
			expect(storeErr.details.issues.length).toBeGreaterThan(0);
		}
	});

	it("store: storeValidatorSync works for sync schemas", () => {
		const validator = storeValidatorSync(configSchema);
		const result = validator({ theme: "dark", verbose: true });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ theme: "dark", verbose: true });
		}
	});

	it("store: storeValidatorSync rejects invalid config", () => {
		const validator = storeValidatorSync(configSchema);
		const result = validator({ theme: "invalid", verbose: "not-a-bool" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues.length).toBeGreaterThan(0);
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// 2. Effect: shared schema across all targets
// ────────────────────────────────────────────────────────────────────────────

describe("Effect: shared schema across command, prompt, and store", () => {
	// ── Shared schema ─────────────────────────────────────────────────────
	const ThemeSchema = Schema.Literal("light", "dark");
	const ConfigSchema = Schema.Struct({
		theme: ThemeSchema,
		verbose: Schema.Boolean,
	});
	// Standard Schema wrapper for prompt/store adapters
	const configStandard = Schema.standardSchemaV1(ConfigSchema);

	// ── Store setup ───────────────────────────────────────────────────────
	let tempDir: string;
	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
	});
	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	// ── Command target ────────────────────────────────────────────────────

	it("command: validates valid args and flags", async () => {
		const received = capture<{ args: unknown; flags: unknown }>();
		const cmd = defineCommand({
			meta: { name: "config" },
			args: [effectArg("theme", Schema.Literal("light", "dark"))],
			flags: {
				verbose: effectFlag(Schema.UndefinedOr(Schema.Boolean)),
			},
			run: effectCommandValidator(({ args, flags }) => {
				received.set({ args, flags });
			}),
		});

		await runCommand(cmd, { argv: ["dark", "--verbose"] });
		expect(received.value).toBeDefined();
		expect(received.value?.args).toEqual({ theme: "dark" });
		expect(received.value?.flags).toEqual({ verbose: true });
	});

	it("command: rejects invalid input with VALIDATION error and path-formatted issues", async () => {
		const cmd = defineCommand({
			meta: { name: "config" },
			args: [effectArg("theme", Schema.Literal("light", "dark"))],
			flags: {
				verbose: effectFlag(Schema.UndefinedOr(Schema.Boolean)),
			},
			run: effectCommandValidator(() => {}),
		});

		try {
			await runCommand(cmd, { argv: ["invalid-theme"] });
			expect.unreachable("Should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			const crustErr = err as CrustError<"VALIDATION">;
			expect(crustErr.code).toBe("VALIDATION");
			const issues = extractIssues(crustErr);
			expect(issues.length).toBeGreaterThan(0);
			expect(issues[0]?.path).toBe("args.theme");
		}
	});

	// ── Prompt target ─────────────────────────────────────────────────────

	it("prompt: validator returns true for valid input", async () => {
		const themeStandard = Schema.standardSchemaV1(ThemeSchema);
		const validate = effectPromptValidator(themeStandard);
		const result = await validate("light");
		expect(result).toBe(true);
	});

	it("prompt: validator returns error message for invalid input", async () => {
		const themeStandard = Schema.standardSchemaV1(ThemeSchema);
		const validate = effectPromptValidator(themeStandard);
		const result = await validate("blue" as "light");
		expect(typeof result).toBe("string");
		expect(result).not.toBe(true);
	});

	it("prompt: parsePromptValue returns typed output on valid input", async () => {
		const themeStandard = Schema.standardSchemaV1(ThemeSchema);
		const result = await effectParsePromptValue(themeStandard, "dark");
		expect(result).toBe("dark");
	});

	it("prompt: parsePromptValue throws VALIDATION error on invalid input", async () => {
		const themeStandard = Schema.standardSchemaV1(ThemeSchema);
		try {
			await effectParsePromptValue(themeStandard, "blue" as "light");
			expect.unreachable("Should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			const crustErr = err as CrustError<"VALIDATION">;
			expect(crustErr.code).toBe("VALIDATION");
		}
	});

	// ── Store target ──────────────────────────────────────────────────────

	it("store: validates valid config on write and read", async () => {
		const defaults = {
			theme: "light" as string,
			verbose: false,
		};

		const store = createStore({
			dirPath: tempDir,
			defaults,
			validator: effectStoreValidator(configStandard),
		});

		await store.write({ theme: "dark", verbose: true });
		const config = await store.read();
		expect(config.theme).toBe("dark");
		expect(config.verbose).toBe(true);
	});

	it("store: rejects invalid config on write with VALIDATION error", async () => {
		const defaults = {
			theme: "light" as string,
			verbose: false,
		};

		const store = createStore({
			dirPath: tempDir,
			defaults,
			validator: effectStoreValidator(configStandard),
		});

		try {
			await store.write({ theme: "blue" as "light", verbose: false });
			expect.unreachable("Should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			const storeErr = err as CrustStoreError<"VALIDATION">;
			expect(storeErr.is("VALIDATION")).toBe(true);
			expect(storeErr.details.operation).toBe("write");
			expect(storeErr.details.issues.length).toBeGreaterThan(0);
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// 3. Consistent issue path formatting across all targets
// ────────────────────────────────────────────────────────────────────────────

describe("consistent issue path formatting across targets", () => {
	let tempDir: string;
	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
	});
	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	// ── Nested object schema (Zod) ────────────────────────────────────────

	describe("nested object paths (Zod)", () => {
		const nestedSchema = z.object({
			database: z.object({
				host: z.string().min(1, "host is required"),
				port: z.number().int().positive("port must be positive"),
			}),
			logging: z.object({
				level: z.enum(["debug", "info", "warn", "error"]),
			}),
		});

		it("standard core: nested path uses dot-notation", async () => {
			const result = await validateStandard(nestedSchema, {
				database: { host: "", port: -1 },
				logging: { level: "invalid" },
			});
			expect(result.ok).toBe(false);
			if (!result.ok) {
				const paths = result.issues.map((i) => i.path);
				expect(paths).toContain("database.host");
				expect(paths).toContain("database.port");
				expect(paths).toContain("logging.level");
			}
		});

		it("prompt: nested path appears in error message", async () => {
			const validate = promptValidator(nestedSchema);
			const result = await validate({
				database: { host: "", port: -1 },
				logging: { level: "invalid" as "debug" },
			});
			expect(typeof result).toBe("string");
			// "first" strategy: first issue path should appear in message
			expect(result as string).toContain("database.host");
		});

		it("prompt: 'all' strategy renders all nested paths", async () => {
			const validate = promptValidator(nestedSchema, {
				errorStrategy: "all",
			});
			const result = await validate({
				database: { host: "", port: -1 },
				logging: { level: "invalid" as "debug" },
			});
			expect(typeof result).toBe("string");
			const msg = result as string;
			expect(msg).toContain("database.host");
			expect(msg).toContain("database.port");
			expect(msg).toContain("logging.level");
		});

		it("store: nested paths in VALIDATION error issues", async () => {
			// Use the storeValidator directly to check issue paths
			const validator = storeValidatorSync(nestedSchema);
			const result = validator({
				database: { host: "", port: -1 },
				logging: { level: "invalid" },
			});
			expect(result.ok).toBe(false);
			if (!result.ok) {
				const paths = result.issues.map((i) => i.path);
				expect(paths).toContain("database.host");
				expect(paths).toContain("database.port");
				expect(paths).toContain("logging.level");
			}
		});
	});

	// ── Array index paths ─────────────────────────────────────────────────

	describe("array index paths (Zod)", () => {
		const arraySchema = z.object({
			items: z.array(z.string().min(1, "item cannot be empty")),
		});

		it("standard core: array paths use bracket notation", async () => {
			const result = await validateStandard(arraySchema, {
				items: ["valid", "", "also-valid", ""],
			});
			expect(result.ok).toBe(false);
			if (!result.ok) {
				const paths = result.issues.map((i) => i.path);
				expect(paths).toContain("items[1]");
				expect(paths).toContain("items[3]");
			}
		});

		it("prompt: array paths appear in error messages", async () => {
			const validate = promptValidator(arraySchema, {
				errorStrategy: "all",
			});
			const result = await validate({ items: ["valid", ""] });
			expect(typeof result).toBe("string");
			expect(result as string).toContain("items[1]");
		});

		it("store: array paths in validator result", () => {
			const validator = storeValidatorSync(arraySchema);
			const result = validator({ items: ["valid", ""] });
			expect(result.ok).toBe(false);
			if (!result.ok) {
				const paths = result.issues.map((i) => i.path);
				expect(paths).toContain("items[1]");
			}
		});
	});

	// ── Command variadic args use bracket notation ────────────────────────

	describe("command variadic args use bracket notation (Zod)", () => {
		it("variadic arg issues include array indices in path", async () => {
			const cmd = defineCommand({
				meta: { name: "process" },
				args: [
					zodArg("files", z.string().min(1, "file path required"), {
						variadic: true,
					}),
				],
				run: zodCommandValidator(() => {}),
			});

			try {
				// Empty strings should fail the min(1) validation
				await runCommand(cmd, { argv: ["good.ts", "", "also-good.ts", ""] });
				expect.unreachable("Should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustError);
				const crustErr = err as CrustError<"VALIDATION">;
				const issues = extractIssues(crustErr);
				const paths = issues.map((i) => i.path);
				// Variadic args have paths like "args.files[1]", "args.files[3]"
				expect(paths).toContain("args.files[1]");
				expect(paths).toContain("args.files[3]");
			}
		});
	});

	// ── Root-level issues ─────────────────────────────────────────────────

	describe("root-level issues (Zod)", () => {
		const rootSchema = z.string().min(1, "Value is required");

		it("standard core: root-level issues have empty path", async () => {
			const result = await validateStandard(rootSchema, "");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.issues[0]?.path).toBe("");
				expect(result.issues[0]?.message).toBe("Value is required");
			}
		});

		it("prompt: root-level issue message has no path prefix", async () => {
			const validate = promptValidator(rootSchema);
			const result = await validate("");
			expect(result).toBe("Value is required");
		});

		it("store: root-level issues in validator result", () => {
			const validator = storeValidatorSync(rootSchema);
			const result = validator("");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.issues[0]?.path).toBe("");
				expect(result.issues[0]?.message).toBe("Value is required");
			}
		});

		it("prompt: parsePromptValue throws with root-level issue details", async () => {
			try {
				await parsePromptValue(rootSchema, "");
				expect.unreachable("Should have thrown");
			} catch (err) {
				const crustErr = err as CrustError<"VALIDATION">;
				expect(crustErr.code).toBe("VALIDATION");
				const issues = extractIssues(crustErr);
				expect(issues[0]?.path).toBe("");
				expect(issues[0]?.message).toBe("Value is required");
			}
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// 4. Transformed output consistency across targets
// ────────────────────────────────────────────────────────────────────────────

describe("transformed output consistency across targets", () => {
	let tempDir: string;
	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
	});
	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe("Zod transforms", () => {
		// Schema that trims and lowercases strings
		const normalizedTheme = z.string().transform((s) => s.trim().toLowerCase());

		it("command: receives transformed output values", async () => {
			const received = capture<{ args: unknown }>();
			const cmd = defineCommand({
				meta: { name: "theme" },
				args: [zodArg("theme", normalizedTheme, { type: "string" })],
				run: zodCommandValidator(({ args }) => {
					received.set({ args });
				}),
			});

			await runCommand(cmd, { argv: ["  DARK  "] });
			expect(received.value?.args).toEqual({ theme: "dark" });
		});

		it("prompt: parsePromptValue returns transformed output", async () => {
			const result = await parsePromptValue(normalizedTheme, "  DARK  ");
			expect(result).toBe("dark");
		});

		it("prompt: parsePromptValueSync returns transformed output", () => {
			const result = parsePromptValueSync(normalizedTheme, "  LIGHT  ");
			expect(result).toBe("light");
		});

		it("store: storeValidator returns transformed output", async () => {
			const validator = storeValidator(normalizedTheme);
			const result = await validator("  DARK  ");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBe("dark");
			}
		});

		it("store: persists and reads transformed values", async () => {
			const transformedConfig = z.object({
				theme: z.string().transform((s) => s.toLowerCase()),
				retries: z.number(),
			});

			const defaults = {
				theme: "light" as string,
				retries: 3,
			};

			const store = createStore({
				dirPath: tempDir,
				defaults,
				validator: storeValidator(transformedConfig),
			});

			await store.write({ theme: "DARK", retries: 5 });
			const config = await store.read();
			// Read-path also validates and transforms
			expect(config.theme).toBe("dark");
			expect(config.retries).toBe(5);
		});
	});

	describe("Effect transforms", () => {
		it("command: receives transformed output values", async () => {
			const received = capture<{ args: unknown }>();
			const TrimmedString = Schema.transform(Schema.String, Schema.String, {
				decode: (s) => s.trim().toLowerCase(),
				encode: (s) => s,
			});

			const cmd = defineCommand({
				meta: { name: "theme" },
				args: [effectArg("theme", TrimmedString, { type: "string" })],
				run: effectCommandValidator(({ args }) => {
					received.set({ args });
				}),
			});

			await runCommand(cmd, { argv: ["  DARK  "] });
			expect(received.value?.args).toEqual({ theme: "dark" });
		});

		it("prompt: parsePromptValue returns transformed output (Effect)", async () => {
			const TrimmedString = Schema.transform(Schema.String, Schema.String, {
				decode: (s) => s.trim().toLowerCase(),
				encode: (s) => s,
			});
			const wrapped = Schema.standardSchemaV1(TrimmedString);
			const result = await effectParsePromptValue(wrapped, "  DARK  ");
			expect(result).toBe("dark");
		});

		it("store: storeValidator returns transformed output (Effect)", async () => {
			const TrimmedString = Schema.transform(Schema.String, Schema.String, {
				decode: (s) => s.trim().toLowerCase(),
				encode: (s) => s,
			});
			const wrapped = Schema.standardSchemaV1(TrimmedString);
			const validator = effectStoreValidator(wrapped);
			const result = await validator("  DARK  ");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBe("dark");
			}
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// 5. Error shape consistency across targets
// ────────────────────────────────────────────────────────────────────────────

describe("error shape consistency across targets", () => {
	let tempDir: string;
	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
	});
	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	const schema = z.object({
		name: z.string().min(1, "name is required"),
		age: z.number().int().positive("age must be positive"),
	});

	it("all targets produce the same issue shape: { message, path }", async () => {
		const invalidInput = { name: "", age: -5 };

		// Standard core
		const coreResult = await validateStandard(schema, invalidInput);
		expect(coreResult.ok).toBe(false);
		if (!coreResult.ok) {
			for (const issue of coreResult.issues) {
				expect(typeof issue.message).toBe("string");
				expect(typeof issue.path).toBe("string");
			}
		}

		// Prompt parsePromptValue
		try {
			await parsePromptValue(schema, invalidInput);
			expect.unreachable("Should have thrown");
		} catch (err) {
			const crustErr = err as CrustError<"VALIDATION">;
			const issues = crustErr.details?.issues ?? [];
			for (const issue of issues) {
				expect(typeof issue.message).toBe("string");
				expect(typeof issue.path).toBe("string");
			}
		}

		// Store validator
		const storeResult = storeValidatorSync(schema)(invalidInput);
		expect(storeResult.ok).toBe(false);
		if (!storeResult.ok) {
			for (const issue of storeResult.issues) {
				expect(typeof issue.message).toBe("string");
				expect(typeof issue.path).toBe("string");
			}
		}
	});

	it("all targets produce matching issue paths for the same invalid input", async () => {
		const invalidInput = { name: "", age: -5 };

		// Standard core
		const coreResult = await validateStandard(schema, invalidInput);
		const corePaths = !coreResult.ok
			? coreResult.issues.map((i) => i.path)
			: [];

		// Prompt parsePromptValue
		let promptPaths: string[] = [];
		try {
			await parsePromptValue(schema, invalidInput);
		} catch (err) {
			const crustErr = err as CrustError<"VALIDATION">;
			promptPaths = [...extractIssues(crustErr).map((i) => i.path)];
		}

		// Store validator
		const storeResult = storeValidatorSync(schema)(invalidInput);
		const storePaths = !storeResult.ok
			? storeResult.issues.map((i) => i.path)
			: [];

		// All three should produce identical paths
		expect(corePaths).toEqual(promptPaths);
		expect(corePaths).toEqual(storePaths);
		expect(corePaths).toContain("name");
		expect(corePaths).toContain("age");
	});

	it("all targets produce matching issue messages for the same invalid input", async () => {
		const invalidInput = { name: "", age: -5 };

		// Standard core
		const coreResult = await validateStandard(schema, invalidInput);
		const coreMessages = !coreResult.ok
			? coreResult.issues.map((i) => i.message)
			: [];

		// Prompt parsePromptValue
		let promptMessages: string[] = [];
		try {
			await parsePromptValue(schema, invalidInput);
		} catch (err) {
			const crustErr = err as CrustError<"VALIDATION">;
			promptMessages = [...extractIssues(crustErr).map((i) => i.message)];
		}

		// Store validator
		const storeResult = storeValidatorSync(schema)(invalidInput);
		const storeMessages = !storeResult.ok
			? storeResult.issues.map((i) => i.message)
			: [];

		// All three should produce identical messages
		expect(coreMessages).toEqual(promptMessages);
		expect(coreMessages).toEqual(storeMessages);
	});

	it("command and parsePromptValue throw same error code for validation failures", async () => {
		const stringSchema = z.string().min(3, "too short");

		// Command target
		const cmd = defineCommand({
			meta: { name: "test" },
			args: [zodArg("input", stringSchema)],
			run: zodCommandValidator(() => {}),
		});

		let commandErrorCode: string | undefined;
		try {
			await runCommand(cmd, { argv: ["ab"] });
		} catch (err) {
			commandErrorCode = (err as CrustError).code;
		}

		// Prompt target
		let promptErrorCode: string | undefined;
		try {
			await parsePromptValue(stringSchema, "ab");
		} catch (err) {
			promptErrorCode = (err as CrustError).code;
		}

		expect(commandErrorCode).toBe("VALIDATION");
		expect(promptErrorCode).toBe("VALIDATION");
		expect(commandErrorCode).toBe(promptErrorCode);
	});

	it("store VALIDATION error carries structured issues matching validator result", async () => {
		const defaults = {
			name: "" as string,
			age: 0,
		};

		const store = createStore({
			dirPath: tempDir,
			defaults,
			validator: storeValidator(schema),
		});

		// Get raw validator issues
		const validatorResult = storeValidatorSync(schema)({
			name: "",
			age: -5,
		});
		const validatorPaths = !validatorResult.ok
			? validatorResult.issues.map((i) => i.path)
			: [];

		// Get store error issues
		let storePaths: string[] = [];
		try {
			await store.write({ name: "", age: -5 });
		} catch (err) {
			const storeErr = err as CrustStoreError<"VALIDATION">;
			storePaths = [
				...storeErr.details.issues.map(
					(i: { message: string; path: string }) => i.path,
				),
			];
		}

		expect(storePaths).toEqual(validatorPaths);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// 6. Sync and async parity
// ────────────────────────────────────────────────────────────────────────────

describe("sync and async parity", () => {
	const schema = z.object({
		host: z.string().min(1),
		port: z.number().int().positive(),
	});

	const validInput = { host: "localhost", port: 8080 };
	const invalidInput = { host: "", port: -1 };

	it("validateStandard and validateStandardSync produce identical success results", async () => {
		const asyncResult = await validateStandard(schema, validInput);
		const syncResult = validateStandardSync(schema, validInput);

		expect(asyncResult.ok).toBe(true);
		expect(syncResult.ok).toBe(true);
		if (asyncResult.ok && syncResult.ok) {
			expect(asyncResult.value).toEqual(syncResult.value);
		}
	});

	it("validateStandard and validateStandardSync produce identical failure results", async () => {
		const asyncResult = await validateStandard(schema, invalidInput);
		const syncResult = validateStandardSync(schema, invalidInput);

		expect(asyncResult.ok).toBe(false);
		expect(syncResult.ok).toBe(false);
		if (!asyncResult.ok && !syncResult.ok) {
			expect(asyncResult.issues).toEqual(syncResult.issues);
		}
	});

	it("storeValidator and storeValidatorSync produce identical success results", async () => {
		const asyncResult = await storeValidator(schema)(validInput);
		const syncResult = storeValidatorSync(schema)(validInput);

		expect(asyncResult.ok).toBe(true);
		expect(syncResult.ok).toBe(true);
		if (asyncResult.ok && syncResult.ok) {
			expect(asyncResult.value).toEqual(syncResult.value);
		}
	});

	it("storeValidator and storeValidatorSync produce identical failure results", async () => {
		const asyncResult = await storeValidator(schema)(invalidInput);
		const syncResult = storeValidatorSync(schema)(invalidInput);

		expect(asyncResult.ok).toBe(false);
		expect(syncResult.ok).toBe(false);
		if (!asyncResult.ok && !syncResult.ok) {
			expect(asyncResult.issues).toEqual(syncResult.issues);
		}
	});

	it("parsePromptValue and parsePromptValueSync produce identical success values", async () => {
		const asyncValue = await parsePromptValue(schema, validInput);
		const syncValue = parsePromptValueSync(schema, validInput);

		expect(asyncValue).toEqual(syncValue);
	});

	it("parsePromptValue and parsePromptValueSync throw matching errors on failure", async () => {
		let asyncIssues: readonly { message: string; path: string }[] = [];
		let syncIssues: readonly { message: string; path: string }[] = [];

		try {
			await parsePromptValue(schema, invalidInput);
		} catch (err) {
			asyncIssues = extractIssues(err as CrustError<"VALIDATION">);
		}

		try {
			parsePromptValueSync(schema, invalidInput);
		} catch (err) {
			syncIssues = extractIssues(err as CrustError<"VALIDATION">);
		}

		expect(asyncIssues).toEqual(syncIssues);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// 7. Zod and Effect produce consistent issue shapes for equivalent schemas
// ────────────────────────────────────────────────────────────────────────────

describe("Zod and Effect produce consistent issue shapes for equivalent schemas", () => {
	it("both providers generate issues with { message, path } for nested objects", async () => {
		// Equivalent schemas
		const zodSchema = z.object({
			name: z.string().min(1),
		});
		const effectSchema = Schema.standardSchemaV1(
			Schema.Struct({
				name: Schema.String.pipe(Schema.minLength(1)),
			}),
		);

		const invalidInput = { name: "" };

		const zodResult = await validateStandard(zodSchema, invalidInput);
		const effectResult = await validateStandard(effectSchema, invalidInput);

		expect(zodResult.ok).toBe(false);
		expect(effectResult.ok).toBe(false);

		if (!zodResult.ok && !effectResult.ok) {
			// Both have at least one issue
			expect(zodResult.issues.length).toBeGreaterThan(0);
			expect(effectResult.issues.length).toBeGreaterThan(0);

			// Both issues point to the "name" path
			expect(zodResult.issues[0]?.path).toBe("name");
			expect(effectResult.issues[0]?.path).toBe("name");

			// Both have string messages
			expect(typeof zodResult.issues[0]?.message).toBe("string");
			expect(typeof effectResult.issues[0]?.message).toBe("string");
		}
	});

	it("both providers return consistent success results", async () => {
		const zodSchema = z.string();
		const effectSchema = Schema.standardSchemaV1(Schema.String);

		const zodResult = await validateStandard(zodSchema, "hello");
		const effectResult = await validateStandard(effectSchema, "hello");

		expect(zodResult.ok).toBe(true);
		expect(effectResult.ok).toBe(true);
		if (zodResult.ok && effectResult.ok) {
			expect(zodResult.value).toBe("hello");
			expect(effectResult.value).toBe("hello");
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// 8. Full lifecycle: command → prompt → store with shared schema
// ────────────────────────────────────────────────────────────────────────────

describe("full lifecycle: command + prompt + store with shared Zod schema", () => {
	let tempDir: string;
	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
	});
	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("validates same data through command → prompt parse → store persist", async () => {
		// Shared schema: a theme configuration
		const themeSchema = z.enum(["light", "dark"]);
		const configSchema = z.object({
			theme: z.enum(["light", "dark"]),
			retries: z.number().int().positive(),
		});

		// 1. Command validation: theme arrives as a CLI arg
		const received = capture<{ args: unknown }>();
		const cmd = defineCommand({
			meta: { name: "init" },
			args: [zodArg("theme", themeSchema)],
			run: zodCommandValidator(({ args }) => {
				received.set({ args });
			}),
		});
		await runCommand(cmd, { argv: ["dark"] });
		const commandTheme = (received.value?.args as { theme: string }).theme;
		expect(commandTheme).toBe("dark");

		// 2. Prompt validation: retries arrives as a prompted value
		const retries = await parsePromptValue(
			z.coerce.number().int().positive(),
			"5",
		);
		expect(retries).toBe(5);

		// 3. Store validation: combine and persist
		const defaults = {
			theme: "light" as string,
			retries: 3,
		};

		const store = createStore({
			dirPath: tempDir,
			defaults,
			validator: storeValidator(configSchema),
		});

		await store.write({ theme: commandTheme, retries });
		const config = await store.read();
		expect(config.theme).toBe("dark");
		expect(config.retries).toBe(5);
	});

	it("rejects invalid data at each stage consistently", async () => {
		const themeSchema = z.enum(["light", "dark"]);
		const configSchema = z.object({
			theme: z.enum(["light", "dark"]),
			retries: z.number().int().positive(),
		});

		// 1. Command rejects invalid theme
		const cmd = defineCommand({
			meta: { name: "init" },
			args: [zodArg("theme", themeSchema)],
			run: zodCommandValidator(() => {}),
		});
		try {
			await runCommand(cmd, { argv: ["blue"] });
			expect.unreachable("Command should have thrown");
		} catch (err) {
			expect((err as CrustError).code).toBe("VALIDATION");
		}

		// 2. Prompt rejects invalid retries
		try {
			await parsePromptValue(
				z.number().int().positive("retries must be positive"),
				-1,
			);
			expect.unreachable("Prompt should have thrown");
		} catch (err) {
			expect((err as CrustError).code).toBe("VALIDATION");
		}

		// 3. Store rejects invalid config
		const defaults = {
			theme: "light" as string,
			retries: 3,
		};

		const store = createStore({
			dirPath: tempDir,
			defaults,
			validator: storeValidator(configSchema),
		});

		try {
			await store.write({
				theme: "blue" as "light",
				retries: -1,
			});
			expect.unreachable("Store should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			expect((err as CrustStoreError).is("VALIDATION")).toBe(true);
		}
	});
});
