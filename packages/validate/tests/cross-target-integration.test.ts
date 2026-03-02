/**
 * Cross-package integration tests — verify consistent validation semantics
 * across command, prompt, and store targets using shared schemas.
 *
 * These tests exercise one schema definition across all three validation
 * surfaces (command handler, prompt validator, store field validator) and assert:
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

import { Crust, CrustError, parseArgs } from "@crustjs/core";
import { CrustStoreError, createStore } from "@crustjs/store";
import * as Schema from "effect/Schema";
import { z } from "zod";

import {
	arg as effectArg,
	commandValidator as effectCommandValidator,
	field as effectFieldValidator,
	flag as effectFlag,
	parsePromptValue as effectParsePromptValue,
	promptValidator as effectPromptValidator,
} from "../src/effect/index.ts";
import {
	field,
	fieldSync,
	parsePromptValue,
	parsePromptValueSync,
	promptValidator,
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
	// Per-field schemas for field-level validation
	const themeFieldSchema = z.enum(["light", "dark"]);
	const verboseFieldSchema = z.boolean();

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
		const app = new Crust("config")
			.args([zodArg("theme", z.enum(["light", "dark"]))])
			.flags({
				verbose: zodFlag(z.boolean().default(false), { alias: "v" }),
			})
			.run(
				zodCommandValidator(({ args, flags }) => {
					received.set({ args, flags });
				}),
			);

		await app.execute({ argv: ["dark", "-v"] });
		expect(received.value).toEqual({
			args: { theme: "dark" },
			flags: { verbose: true },
		});
	});

	it("command: rejects invalid input with VALIDATION error and path-formatted issues", async () => {
		const app = new Crust("config")
			.args([zodArg("theme", z.enum(["light", "dark"]))])
			.flags({
				verbose: zodFlag(z.boolean().default(false)),
			})
			.run(zodCommandValidator(() => {}));

		const node = app._node;
		const parsed = parseArgs(node, ["invalid-theme"]);
		const ctx = {
			args: parsed.args,
			flags: parsed.flags,
			rawArgs: parsed.rawArgs,
			command: node,
		};

		try {
			await node.run?.(ctx);
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
		const store = createStore({
			dirPath: tempDir,
			fields: {
				theme: {
					type: "string",
					default: "light",
					validate: field(themeFieldSchema),
				},
				verbose: {
					type: "boolean",
					default: false,
					validate: field(verboseFieldSchema),
				},
			},
		});

		await store.write({ theme: "dark", verbose: true });
		const config = await store.read();
		expect(config.theme).toBe("dark");
		expect(config.verbose).toBe(true);
	});

	it("store: rejects invalid config on write with VALIDATION error", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: {
				theme: {
					type: "string",
					default: "light",
					validate: field(themeFieldSchema),
				},
				verbose: {
					type: "boolean",
					default: false,
					validate: field(verboseFieldSchema),
				},
			},
		});

		try {
			// "blue" is not a valid theme
			await store.write({
				theme: "blue" as unknown as string,
				verbose: false,
			});
			expect.unreachable("Should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			const storeErr = err as CrustStoreError<"VALIDATION">;
			expect(storeErr.is("VALIDATION")).toBe(true);
			expect(storeErr.details.operation).toBe("write");
			expect(storeErr.details.issues.length).toBeGreaterThan(0);
		}
	});

	it("store: fieldSync works for sync schemas", () => {
		const validate = fieldSync(themeFieldSchema);
		// Valid — should not throw
		expect(() => validate("dark")).not.toThrow();
	});

	it("store: fieldSync rejects invalid values", () => {
		const validate = fieldSync(themeFieldSchema);
		// Invalid — should throw
		expect(() => validate("invalid")).toThrow();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// 2. Effect: shared schema across all targets
// ────────────────────────────────────────────────────────────────────────────

describe("Effect: shared schema across command, prompt, and store", () => {
	// ── Shared schema ─────────────────────────────────────────────────────
	const ThemeSchema = Schema.Literal("light", "dark");
	// Standard Schema wrappers for prompt/store adapters
	const themeStandard = Schema.standardSchemaV1(ThemeSchema);
	const verboseStandard = Schema.standardSchemaV1(Schema.Boolean);

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
		const app = new Crust("config")
			.args([effectArg("theme", Schema.Literal("light", "dark"))])
			.flags({
				verbose: effectFlag(Schema.UndefinedOr(Schema.Boolean)),
			})
			.run(
				effectCommandValidator(({ args, flags }) => {
					received.set({ args, flags });
				}),
			);

		await app.execute({ argv: ["dark", "--verbose"] });
		expect(received.value).toBeDefined();
		expect(received.value?.args).toEqual({ theme: "dark" });
		expect(received.value?.flags).toEqual({ verbose: true });
	});

	it("command: rejects invalid input with VALIDATION error and path-formatted issues", async () => {
		const app = new Crust("config")
			.args([effectArg("theme", Schema.Literal("light", "dark"))])
			.flags({
				verbose: effectFlag(Schema.UndefinedOr(Schema.Boolean)),
			})
			.run(effectCommandValidator(() => {}));

		const node = app._node;
		const parsed = parseArgs(node, ["invalid-theme"]);
		const ctx = {
			args: parsed.args,
			flags: parsed.flags,
			rawArgs: parsed.rawArgs,
			command: node,
		};

		try {
			await node.run?.(ctx);
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
		const validate = effectPromptValidator(themeStandard);
		const result = await validate("light");
		expect(result).toBe(true);
	});

	it("prompt: validator returns error message for invalid input", async () => {
		const validate = effectPromptValidator(themeStandard);
		const result = await validate("blue" as "light");
		expect(typeof result).toBe("string");
		expect(result).not.toBe(true);
	});

	it("prompt: parsePromptValue returns typed output on valid input", async () => {
		const result = await effectParsePromptValue(themeStandard, "dark");
		expect(result).toBe("dark");
	});

	it("prompt: parsePromptValue throws VALIDATION error on invalid input", async () => {
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
		const store = createStore({
			dirPath: tempDir,
			fields: {
				theme: {
					type: "string",
					default: "light",
					validate: effectFieldValidator(themeStandard),
				},
				verbose: {
					type: "boolean",
					default: false,
					validate: effectFieldValidator(verboseStandard),
				},
			},
		});

		await store.write({ theme: "dark", verbose: true });
		const config = await store.read();
		expect(config.theme).toBe("dark");
		expect(config.verbose).toBe(true);
	});

	it("store: rejects invalid config on write with VALIDATION error", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: {
				theme: {
					type: "string",
					default: "light",
					validate: effectFieldValidator(themeStandard),
				},
				verbose: {
					type: "boolean",
					default: false,
					validate: effectFieldValidator(verboseStandard),
				},
			},
		});

		try {
			await store.write({
				theme: "blue" as unknown as string,
				verbose: false,
			});
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

		it("store: per-field validation catches invalid values", async () => {
			// Per-field validation only validates at the field level (flat keys).
			// For nested object validation, use a field-level schema that covers the nested shape.
			const store = createStore({
				dirPath: tempDir,
				fields: {
					host: {
						type: "string",
						default: "localhost",
						validate: field(z.string().min(1, "host is required")),
					},
					port: {
						type: "number",
						default: 5432,
						validate: field(z.number().int().positive("port must be positive")),
					},
				},
			});

			try {
				await store.write({ host: "", port: -1 });
				expect.unreachable("Should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				const storeErr = err as CrustStoreError<"VALIDATION">;
				expect(storeErr.is("VALIDATION")).toBe(true);
				const paths = storeErr.details.issues.map(
					(i: { message: string; path: string }) => i.path,
				);
				expect(paths).toContain("host");
				expect(paths).toContain("port");
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

		it("store: field-level array validation catches invalid arrays", async () => {
			const itemsSchema = z
				.array(z.string().min(1, "item cannot be empty"))
				.min(1);

			const store = createStore({
				dirPath: tempDir,
				fields: {
					items: {
						type: "string",
						array: true,
						default: [] as string[],
						validate: field(itemsSchema),
					},
				},
			});

			try {
				await store.write({ items: ["valid", ""] });
				expect.unreachable("Should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				const storeErr = err as CrustStoreError<"VALIDATION">;
				expect(storeErr.is("VALIDATION")).toBe(true);
			}
		});
	});

	// ── Command variadic args use bracket notation ────────────────────────

	describe("command variadic args use bracket notation (Zod)", () => {
		it("variadic arg issues include array indices in path", async () => {
			const app = new Crust("process")
				.args([
					zodArg("files", z.string().min(1, "file path required"), {
						variadic: true,
					}),
				])
				.run(zodCommandValidator(() => {}));

			const node = app._node;
			const parsed = parseArgs(node, ["good.ts", "", "also-good.ts", ""]);
			const ctx = {
				args: parsed.args,
				flags: parsed.flags,
				rawArgs: parsed.rawArgs,
				command: node,
			};

			try {
				// Empty strings should fail the min(1) validation
				await node.run?.(ctx);
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

		it("store: field-level validation produces per-field path in error", async () => {
			const store = createStore({
				dirPath: tempDir,
				fields: {
					name: {
						type: "string",
						default: "",
						validate: fieldSync(z.string().min(1, "Value is required")),
					},
				},
			});

			try {
				await store.write({ name: "" });
				expect.unreachable("Should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CrustStoreError);
				const storeErr = err as CrustStoreError<"VALIDATION">;
				expect(storeErr.is("VALIDATION")).toBe(true);
				// Per-field validation uses the field name as path
				expect(storeErr.details.issues[0]?.path).toBe("name");
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
			const app = new Crust("theme")
				.args([zodArg("theme", normalizedTheme, { type: "string" })])
				.run(
					zodCommandValidator(({ args }) => {
						received.set({ args });
					}),
				);

			await app.execute({ argv: ["  DARK  "] });
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

		it("store: field does not throw for valid value", async () => {
			const themeSchema = z.enum(["light", "dark"]);
			const validate = field(themeSchema);
			await expect(validate("dark")).resolves.toBeUndefined();
		});

		it("store: validates fields on write and read", async () => {
			const store = createStore({
				dirPath: tempDir,
				fields: {
					theme: {
						type: "string",
						default: "light",
						validate: field(z.enum(["light", "dark"])),
					},
					retries: {
						type: "number",
						default: 3,
						validate: field(z.number()),
					},
				},
			});

			await store.write({ theme: "dark", retries: 5 });
			const config = await store.read();
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

			const app = new Crust("theme")
				.args([effectArg("theme", TrimmedString, { type: "string" })])
				.run(
					effectCommandValidator(({ args }) => {
						received.set({ args });
					}),
				);

			await app.execute({ argv: ["  DARK  "] });
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

		it("store: field does not throw for valid value (Effect)", async () => {
			const wrapped = Schema.standardSchemaV1(Schema.Literal("light", "dark"));
			const validate = effectFieldValidator(wrapped);
			await expect(validate("dark")).resolves.toBeUndefined();
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

	const nameSchema = z.string().min(1, "name is required");
	const ageSchema = z.number().int().positive("age must be positive");

	const objectSchema = z.object({
		name: z.string().min(1, "name is required"),
		age: z.number().int().positive("age must be positive"),
	});

	it("all targets produce the same issue shape: { message, path }", async () => {
		const invalidInput = { name: "", age: -5 };

		// Standard core
		const coreResult = await validateStandard(objectSchema, invalidInput);
		expect(coreResult.ok).toBe(false);
		if (!coreResult.ok) {
			for (const issue of coreResult.issues) {
				expect(typeof issue.message).toBe("string");
				expect(typeof issue.path).toBe("string");
			}
		}

		// Prompt parsePromptValue
		try {
			await parsePromptValue(objectSchema, invalidInput);
			expect.unreachable("Should have thrown");
		} catch (err) {
			const crustErr = err as CrustError<"VALIDATION">;
			const issues = crustErr.details?.issues ?? [];
			for (const issue of issues) {
				expect(typeof issue.message).toBe("string");
				expect(typeof issue.path).toBe("string");
			}
		}

		// Store — per-field validation produces issues with field-name paths
		const store = createStore({
			dirPath: tempDir,
			fields: {
				name: {
					type: "string",
					default: "",
					validate: field(nameSchema),
				},
				age: {
					type: "number",
					default: 0,
					validate: field(ageSchema),
				},
			},
		});

		try {
			await store.write({ name: "", age: -5 });
			expect.unreachable("Should have thrown");
		} catch (err) {
			const storeErr = err as CrustStoreError<"VALIDATION">;
			for (const issue of storeErr.details.issues) {
				expect(typeof issue.message).toBe("string");
				expect(typeof issue.path).toBe("string");
			}
		}
	});

	it("standard core and prompt targets produce matching issue paths for the same invalid input", async () => {
		const invalidInput = { name: "", age: -5 };

		// Standard core
		const coreResult = await validateStandard(objectSchema, invalidInput);
		const corePaths = !coreResult.ok
			? coreResult.issues.map((i) => i.path)
			: [];

		// Prompt parsePromptValue
		let promptPaths: string[] = [];
		try {
			await parsePromptValue(objectSchema, invalidInput);
		} catch (err) {
			const crustErr = err as CrustError<"VALIDATION">;
			promptPaths = [...extractIssues(crustErr).map((i) => i.path)];
		}

		// Core and prompt should produce identical paths
		expect(corePaths).toEqual(promptPaths);
		expect(corePaths).toContain("name");
		expect(corePaths).toContain("age");
	});

	it("standard core and prompt targets produce matching issue messages for the same invalid input", async () => {
		const invalidInput = { name: "", age: -5 };

		// Standard core
		const coreResult = await validateStandard(objectSchema, invalidInput);
		const coreMessages = !coreResult.ok
			? coreResult.issues.map((i) => i.message)
			: [];

		// Prompt parsePromptValue
		let promptMessages: string[] = [];
		try {
			await parsePromptValue(objectSchema, invalidInput);
		} catch (err) {
			const crustErr = err as CrustError<"VALIDATION">;
			promptMessages = [...extractIssues(crustErr).map((i) => i.message)];
		}

		// Core and prompt should produce identical messages
		expect(coreMessages).toEqual(promptMessages);
	});

	it("command and parsePromptValue throw same error code for validation failures", async () => {
		const stringSchema = z.string().min(3, "too short");

		// Command target
		const app = new Crust("test")
			.args([zodArg("input", stringSchema)])
			.run(zodCommandValidator(() => {}));

		const node = app._node;
		const parsed = parseArgs(node, ["ab"]);
		const ctx = {
			args: parsed.args,
			flags: parsed.flags,
			rawArgs: parsed.rawArgs,
			command: node,
		};

		let commandErrorCode: string | undefined;
		try {
			await node.run?.(ctx);
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

	it("store VALIDATION error carries structured issues", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: {
				name: {
					type: "string",
					default: "",
					validate: field(nameSchema),
				},
				age: {
					type: "number",
					default: 0,
					validate: field(ageSchema),
				},
			},
		});

		try {
			await store.write({ name: "", age: -5 });
			expect.unreachable("Should have thrown");
		} catch (err) {
			const storeErr = err as CrustStoreError<"VALIDATION">;
			expect(storeErr.is("VALIDATION")).toBe(true);
			const paths = storeErr.details.issues.map(
				(i: { message: string; path: string }) => i.path,
			);
			expect(paths).toContain("name");
			expect(paths).toContain("age");
		}
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

	it("field and fieldSync produce identical behavior for valid input", async () => {
		const hostSchema = z.string().min(1);
		const asyncValidate = field(hostSchema);
		const syncValidate = fieldSync(hostSchema);

		// Both should succeed (not throw)
		await expect(asyncValidate("localhost")).resolves.toBeUndefined();
		expect(syncValidate("localhost")).toBeUndefined();
	});

	it("field and fieldSync produce identical behavior for invalid input", async () => {
		const hostSchema = z.string().min(1);
		const asyncValidate = field(hostSchema);
		const syncValidate = fieldSync(hostSchema);

		// Both should throw
		await expect(asyncValidate("")).rejects.toThrow();
		expect(() => syncValidate("")).toThrow();
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
		// Shared schemas
		const themeSchema = z.enum(["light", "dark"]);

		// 1. Command validation: theme arrives as a CLI arg
		const received = capture<{ args: unknown }>();
		const app = new Crust("init").args([zodArg("theme", themeSchema)]).run(
			zodCommandValidator(({ args }) => {
				received.set({ args });
			}),
		);
		await app.execute({ argv: ["dark"] });
		const commandTheme = (received.value?.args as { theme: string }).theme;
		expect(commandTheme).toBe("dark");

		// 2. Prompt validation: retries arrives as a prompted value
		const retries = await parsePromptValue(
			z.coerce.number().int().positive(),
			"5",
		);
		expect(retries).toBe(5);

		// 3. Store validation: combine and persist with per-field validators
		const store = createStore({
			dirPath: tempDir,
			fields: {
				theme: {
					type: "string",
					default: "light",
					validate: field(themeSchema),
				},
				retries: {
					type: "number",
					default: 3,
					validate: field(z.number().int().positive()),
				},
			},
		});

		await store.write({ theme: commandTheme, retries });
		const config = await store.read();
		expect(config.theme).toBe("dark");
		expect(config.retries).toBe(5);
	});

	it("rejects invalid data at each stage consistently", async () => {
		const themeSchema = z.enum(["light", "dark"]);

		// 1. Command rejects invalid theme
		const app = new Crust("init")
			.args([zodArg("theme", themeSchema)])
			.run(zodCommandValidator(() => {}));

		const node = app._node;
		const parsed = parseArgs(node, ["blue"]);
		const ctx = {
			args: parsed.args,
			flags: parsed.flags,
			rawArgs: parsed.rawArgs,
			command: node,
		};
		try {
			await node.run?.(ctx);
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
		const store = createStore({
			dirPath: tempDir,
			fields: {
				theme: {
					type: "string",
					default: "light",
					validate: field(themeSchema),
				},
				retries: {
					type: "number",
					default: 3,
					validate: field(z.number().int().positive()),
				},
			},
		});

		try {
			await store.write({
				theme: "blue" as unknown as string,
				retries: -1,
			});
			expect.unreachable("Store should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			expect((err as CrustStoreError).is("VALIDATION")).toBe(true);
		}
	});
});
