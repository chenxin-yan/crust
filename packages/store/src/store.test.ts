import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { CrustStoreError } from "./errors.ts";
import { field } from "./field.ts";
import { createStore } from "./store.ts";
import type { FieldsDef } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

/** Creates a unique temp directory for each test to avoid cross-test pollution. */
function createTempDir(): string {
	return join(tmpdir(), `crust-store-test-${randomUUID()}`);
}

const BASIC_FIELDS = {
	theme: { type: "string", default: "light" },
	verbose: { type: "boolean", default: false },
} as const satisfies FieldsDef;

const MIXED_FIELDS = {
	theme: { type: "string", default: "light" },
	verbose: { type: "boolean", default: false },
	token: { type: "string" },
} as const satisfies FieldsDef;

const ARRAY_FIELDS = {
	tags: { type: "string", array: true, default: [] },
	count: { type: "number", default: 0 },
} as const satisfies FieldsDef;

const VALIDATED_FIELDS = {
	port: {
		type: "number",
		default: 3000,
		validate: (v: number) => {
			if (v < 1 || v > 65535) throw new Error("port must be 1-65535");
		},
	},
	host: { type: "string", default: "localhost" },
} as const satisfies FieldsDef;

// ────────────────────────────────────────────────────────────────────────────
// createStore — factory
// ────────────────────────────────────────────────────────────────────────────

describe("createStore", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should return a store with read, write, update, patch, and reset methods", () => {
		const store = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});

		expect(typeof store.read).toBe("function");
		expect(typeof store.write).toBe("function");
		expect(typeof store.update).toBe("function");
		expect(typeof store.patch).toBe("function");
		expect(typeof store.reset).toBe("function");
	});

	it("should throw CrustStoreError with PATH code for invalid dirPath", () => {
		expect(() =>
			createStore({
				dirPath: "relative/path",
				fields: BASIC_FIELDS,
			}),
		).toThrow(CrustStoreError);
	});

	it("should throw CrustStoreError with PATH code for dirPath ending in .json", () => {
		expect(() =>
			createStore({
				dirPath: "/tmp/config.json",
				fields: BASIC_FIELDS,
			}),
		).toThrow(CrustStoreError);
	});

	it("should throw CrustStoreError with PATH code for invalid name", () => {
		expect(() =>
			createStore({
				dirPath: tempDir,
				name: "my/store",
				fields: BASIC_FIELDS,
			}),
		).toThrow(CrustStoreError);
	});

	it("should throw CrustStoreError with PATH code for name with .json extension", () => {
		expect(() =>
			createStore({
				dirPath: tempDir,
				name: "config.json",
				fields: BASIC_FIELDS,
			}),
		).toThrow(CrustStoreError);
	});

	it("should use custom name for store file", async () => {
		const store = createStore({
			dirPath: tempDir,
			name: "auth",
			fields: BASIC_FIELDS,
		});

		await store.write({ theme: "dark", verbose: true });

		const authPath = join(tempDir, "auth.json");
		expect(existsSync(authPath)).toBe(true);
		const raw = await readFile(authPath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ theme: "dark", verbose: true });
	});

	it("should default to config.json when name is not provided", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});

		await store.write({ theme: "dark", verbose: true });

		const configPath = join(tempDir, "config.json");
		expect(existsSync(configPath)).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// read
// ────────────────────────────────────────────────────────────────────────────

describe("store.read", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should return defaults when no persisted file exists", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});

		const result = await store.read();

		expect(result.theme).toBe("light");
		expect(result.verbose).toBe(false);
	});

	it("should omit optional fields (no default) when no persisted file exists", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: MIXED_FIELDS,
		});

		const result = await store.read();

		expect(result.theme).toBe("light");
		expect(result.verbose).toBe(false);
		expect(result.token).toBeUndefined();
	});

	it("should return persisted values overriding defaults", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});

		await store.write({ theme: "dark", verbose: true });
		const result = await store.read();

		expect(result.theme).toBe("dark");
		expect(result.verbose).toBe(true);
	});

	it("should fill missing persisted keys from field defaults", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(filePath, JSON.stringify({ theme: "dark" }));

		const store = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});

		const result = await store.read();

		expect(result.theme).toBe("dark");
		expect(result.verbose).toBe(false);
	});

	it("should include optional fields when persisted", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(filePath, JSON.stringify({ theme: "dark", verbose: true, token: "abc123" }));

		const store = createStore({
			dirPath: tempDir,
			fields: MIXED_FIELDS,
		});

		const result = await store.read();

		expect(result.theme).toBe("dark");
		expect(result.verbose).toBe(true);
		expect(result.token).toBe("abc123");
	});

	it("should not auto-persist merged defaults back to disk", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});

		// Read triggers merge but should not write
		await store.read();

		const filePath = join(tempDir, "config.json");
		expect(existsSync(filePath)).toBe(false);
	});

	it("should drop extra persisted keys not defined in fields", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(
			filePath,
			JSON.stringify({
				theme: "dark",
				verbose: true,
				unknown: "extra",
			}),
		);

		const store = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});

		const result = await store.read();

		expect(result.theme).toBe("dark");
		expect(result.verbose).toBe(true);
		expect("unknown" in result).toBe(false);
	});

	it("should throw PARSE error on malformed JSON", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(filePath, "{ broken json }}}");

		const store = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});

		try {
			await store.read();
			expect.unreachable("should have thrown");
		} catch (__err) {
			const e = __err as CrustStoreError;
			expect(e).toBeInstanceOf(CrustStoreError);
			expect(e.is("PARSE")).toBe(true);
		}
	});

	it("should run field validators on read", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(filePath, JSON.stringify({ port: 0, host: "localhost" }));

		const store = createStore({
			dirPath: tempDir,
			fields: VALIDATED_FIELDS,
		});

		try {
			await store.read();
			expect.unreachable("should have thrown");
		} catch (__err) {
			const e = __err as CrustStoreError;
			expect(e).toBeInstanceOf(CrustStoreError);
			expect(e.is("VALIDATION")).toBe(true);
			if (e.is("VALIDATION")) {
				expect(e.details.operation).toBe("read");
				expect(e.details.issues).toHaveLength(1);
				expect(e.details.issues[0]?.path).toBe("port");
			}
		}
	});

	it("should skip validation for undefined optional fields", async () => {
		const fields = {
			token: {
				type: "string",
				validate: () => {
					throw new Error("should not be called");
				},
			},
		} as const satisfies FieldsDef;

		const store = createStore({
			dirPath: tempDir,
			fields,
		});

		// Should not throw — token is undefined, validation is skipped
		const result = await store.read();
		expect(result.token).toBeUndefined();
	});

	it("should coerce persisted number and boolean strings on read", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(filePath, JSON.stringify({ retries: "42", enabled: "true" }));

		const fields = {
			retries: { type: "number", default: 0 },
			enabled: { type: "boolean", default: false },
		} as const satisfies FieldsDef;

		const store = createStore({
			dirPath: tempDir,
			fields,
		});

		const result = await store.read();
		expect(result.retries).toBe(42);
		expect(result.enabled).toBe(true);
	});

	it("should coerce persisted array element strings on read", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(filePath, JSON.stringify({ ports: ["3000", "8080"] }));

		const fields = {
			ports: { type: "number", array: true, default: [] },
		} as const satisfies FieldsDef;

		const store = createStore({
			dirPath: tempDir,
			fields,
		});

		const result = await store.read();
		expect(result.ports).toEqual([3000, 8080]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// write
// ────────────────────────────────────────────────────────────────────────────

describe("store.write", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should persist config to disk", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});

		await store.write({ theme: "dark", verbose: true });

		const filePath = join(tempDir, "config.json");
		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ theme: "dark", verbose: true });
	});

	it("should create parent directories when missing", async () => {
		const nestedDir = join(tempDir, "deep", "nested");
		const store = createStore({
			dirPath: nestedDir,
			fields: BASIC_FIELDS,
		});

		await store.write({ theme: "light", verbose: false });

		const nestedPath = join(nestedDir, "config.json");
		expect(existsSync(nestedPath)).toBe(true);
		const raw = await readFile(nestedPath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ theme: "light", verbose: false });
	});

	it("should overwrite existing config", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});

		await store.write({ theme: "light", verbose: false });
		await store.write({ theme: "dark", verbose: true });

		const filePath = join(tempDir, "config.json");
		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ theme: "dark", verbose: true });
	});

	it("should persist optional fields when provided", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: MIXED_FIELDS,
		});

		await store.write({
			theme: "dark",
			verbose: true,
			token: "abc123",
		});

		const filePath = join(tempDir, "config.json");
		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual({
			theme: "dark",
			verbose: true,
			token: "abc123",
		});
	});

	it("should run field validators on write", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: VALIDATED_FIELDS,
		});

		try {
			await store.write({ port: 99999, host: "localhost" });
			expect.unreachable("should have thrown");
		} catch (__err) {
			const e = __err as CrustStoreError;
			expect(e).toBeInstanceOf(CrustStoreError);
			expect(e.is("VALIDATION")).toBe(true);
			if (e.is("VALIDATION")) {
				expect(e.details.operation).toBe("write");
				expect(e.details.issues[0]?.path).toBe("port");
			}
		}
	});

	it("should not persist when validation fails", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: VALIDATED_FIELDS,
		});

		try {
			await store.write({ port: 0, host: "localhost" });
		} catch {
			// expected
		}

		const filePath = join(tempDir, "config.json");
		expect(existsSync(filePath)).toBe(false);
	});

	it("should coerce values before running field validators on write", async () => {
		const fields = {
			port: {
				type: "number",
				default: 3000,
				validate: (v: number) => {
					expect(typeof v).toBe("number");
					if (v < 1 || v > 65535) throw new Error("invalid port");
				},
			},
		} as const satisfies FieldsDef;

		const store = createStore({
			dirPath: tempDir,
			fields,
		});

		await store.write({ port: "8080" as unknown as number });

		const raw = await readFile(join(tempDir, "config.json"), "utf-8");
		expect(JSON.parse(raw)).toEqual({ port: 8080 });
	});
});

// ────────────────────────────────────────────────────────────────────────────
// update
// ────────────────────────────────────────────────────────────────────────────

describe("store.update", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should read, apply updater, and persist", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});

		await store.write({ theme: "light", verbose: false });
		await store.update((current) => ({ ...current, theme: "dark" }));

		const filePath = join(tempDir, "config.json");
		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ theme: "dark", verbose: false });
	});

	it("should use field defaults as current when no persisted file", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});

		await store.update((current) => ({ ...current, verbose: true }));

		const filePath = join(tempDir, "config.json");
		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ theme: "light", verbose: true });
	});

	it("should merge field defaults with partial persisted before applying updater", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(filePath, JSON.stringify({ theme: "dark" }));

		const store = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});

		await store.update((current) => ({
			...current,
			verbose: true,
		}));

		const raw = await readFile(filePath, "utf-8");
		const result = JSON.parse(raw);
		expect(result).toEqual({ theme: "dark", verbose: true });
	});

	it("should work with optional fields", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: MIXED_FIELDS,
		});

		await store.update((current) => ({
			...current,
			token: "my-token",
		}));

		const filePath = join(tempDir, "config.json");
		const raw = await readFile(filePath, "utf-8");
		const result = JSON.parse(raw);
		expect(result.token).toBe("my-token");
		expect(result.theme).toBe("light");
		expect(result.verbose).toBe(false);
	});

	it("should run field validators on update", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: VALIDATED_FIELDS,
		});

		try {
			await store.update((current) => ({ ...current, port: -1 }));
			expect.unreachable("should have thrown");
		} catch (__err) {
			const e = __err as CrustStoreError;
			expect(e).toBeInstanceOf(CrustStoreError);
			expect(e.is("VALIDATION")).toBe(true);
			if (e.is("VALIDATION")) {
				expect(e.details.operation).toBe("update");
			}
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// patch
// ────────────────────────────────────────────────────────────────────────────

describe("store.patch", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should apply partial update to current config", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});

		await store.write({ theme: "light", verbose: false });
		await store.patch({ theme: "dark" });

		const result = await store.read();
		expect(result.theme).toBe("dark");
		expect(result.verbose).toBe(false);
	});

	it("should preserve existing keys not in the partial", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});

		await store.write({ theme: "dark", verbose: true });
		await store.patch({ verbose: false });

		const result = await store.read();
		expect(result.theme).toBe("dark");
		expect(result.verbose).toBe(false);
	});

	it("should run field validators on patch", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: VALIDATED_FIELDS,
		});

		try {
			await store.patch({ port: 0 });
			expect.unreachable("should have thrown");
		} catch (__err) {
			const e = __err as CrustStoreError;
			expect(e).toBeInstanceOf(CrustStoreError);
			expect(e.is("VALIDATION")).toBe(true);
			if (e.is("VALIDATION")) {
				expect(e.details.operation).toBe("patch");
			}
		}
	});

	it("should work when no persisted file exists (patches defaults)", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});

		await store.patch({ theme: "dark" });

		const result = await store.read();
		expect(result.theme).toBe("dark");
		expect(result.verbose).toBe(false);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// reset
// ────────────────────────────────────────────────────────────────────────────

describe("store.reset", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should delete persisted config file", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});

		await store.write({ theme: "dark", verbose: true });
		const filePath = join(tempDir, "config.json");
		expect(existsSync(filePath)).toBe(true);

		await store.reset();
		expect(existsSync(filePath)).toBe(false);
	});

	it("should not throw when no persisted file exists", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});

		// Should not throw
		await store.reset();
	});

	it("should return to defaults-on-read behavior after reset", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});

		await store.write({ theme: "dark", verbose: true });
		const before = await store.read();
		expect(before.theme).toBe("dark");
		expect(before.verbose).toBe(true);

		await store.reset();

		const after = await store.read();
		expect(after.theme).toBe("light");
		expect(after.verbose).toBe(false);
	});

	it("should return field defaults after reset (optional fields undefined)", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: MIXED_FIELDS,
		});

		await store.write({
			theme: "dark",
			verbose: true,
			token: "abc123",
		});
		await store.reset();

		const result = await store.read();
		expect(result.theme).toBe("light");
		expect(result.verbose).toBe(false);
		expect(result.token).toBeUndefined();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Full lifecycle integration
// ────────────────────────────────────────────────────────────────────────────

describe("store lifecycle", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should support full read → write → update → patch → reset cycle", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});

		// 1. Read returns defaults
		const step1 = await store.read();
		expect(step1.theme).toBe("light");
		expect(step1.verbose).toBe(false);

		// 2. Write persists new config
		await store.write({ theme: "dark", verbose: true });
		const step2 = await store.read();
		expect(step2.theme).toBe("dark");
		expect(step2.verbose).toBe(true);

		// 3. Update modifies persisted config
		await store.update((c) => ({ ...c, verbose: false }));
		const step3 = await store.read();
		expect(step3.theme).toBe("dark");
		expect(step3.verbose).toBe(false);

		// 4. Patch modifies a single field
		await store.patch({ theme: "solarized" });
		const step4 = await store.read();
		expect(step4.theme).toBe("solarized");
		expect(step4.verbose).toBe(false);

		// 5. Reset returns to defaults
		await store.reset();
		const step5 = await store.read();
		expect(step5.theme).toBe("light");
		expect(step5.verbose).toBe(false);
		const filePath = join(tempDir, "config.json");
		expect(existsSync(filePath)).toBe(false);
	});

	it("should support multiple write → read cycles", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});

		for (const theme of ["light", "dark", "light", "dark"] as const) {
			await store.write({ theme, verbose: theme === "dark" });
			const result = await store.read();
			expect(result.theme).toBe(theme);
			expect(result.verbose).toBe(theme === "dark");
		}
	});

	it("should handle array fields across lifecycle", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: ARRAY_FIELDS,
		});

		// Defaults
		const step1 = await store.read();
		expect(step1.tags).toEqual([]);
		expect(step1.count).toBe(0);

		// Write with array data
		await store.write({ tags: ["a", "b"], count: 5 });
		const step2 = await store.read();
		expect(step2.tags).toEqual(["a", "b"]);
		expect(step2.count).toBe(5);

		// Update array
		await store.update((c) => ({ ...c, tags: [...c.tags, "c"] }));
		const step3 = await store.read();
		expect(step3.tags).toEqual(["a", "b", "c"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Multiple stores (name option)
// ────────────────────────────────────────────────────────────────────────────

describe("multiple stores with name option", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should support multiple independent stores under the same directory", async () => {
		const configStore = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});

		const authFields = {
			token: { type: "string", default: "" },
		} as const satisfies FieldsDef;

		const authStore = createStore({
			dirPath: tempDir,
			name: "auth",
			fields: authFields,
		});

		// Write to both stores independently
		await configStore.write({ theme: "dark", verbose: true });
		await authStore.write({ token: "abc123" });

		// Read from both stores independently
		const config = await configStore.read();
		const auth = await authStore.read();

		expect(config.theme).toBe("dark");
		expect(config.verbose).toBe(true);
		expect(auth.token).toBe("abc123");

		// Reset one should not affect the other
		await configStore.reset();
		const configAfterReset = await configStore.read();
		const authAfterReset = await authStore.read();

		expect(configAfterReset.theme).toBe("light");
		expect(configAfterReset.verbose).toBe(false);
		expect(authAfterReset.token).toBe("abc123");
	});

	it("should write to different JSON files based on name", async () => {
		const defaultStore = createStore({
			dirPath: tempDir,
			fields: BASIC_FIELDS,
		});
		await defaultStore.write({ theme: "dark", verbose: true });

		const authStore = createStore({
			dirPath: tempDir,
			name: "auth",
			fields: {
				token: { type: "string", default: "" },
			} as const satisfies FieldsDef,
		});
		await authStore.write({ token: "secret" });

		expect(existsSync(join(tempDir, "config.json"))).toBe(true);
		expect(existsSync(join(tempDir, "auth.json"))).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Field validation
// ────────────────────────────────────────────────────────────────────────────

describe("field validation", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should pass when all field validators succeed", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: VALIDATED_FIELDS,
		});

		// Should not throw — default port 3000 is valid
		const result = await store.read();
		expect(result.port).toBe(3000);
	});

	it("should collect multiple validation issues", async () => {
		const fields = {
			port: {
				type: "number",
				default: 3000,
				validate: (v: number) => {
					if (v < 1) throw new Error("port too low");
				},
			},
			host: {
				type: "string",
				default: "localhost",
				validate: (v: string) => {
					if (v === "") throw new Error("host required");
				},
			},
		} as const satisfies FieldsDef;

		const store = createStore({
			dirPath: tempDir,
			fields,
		});

		try {
			await store.write({ port: 0, host: "" });
			expect.unreachable("should have thrown");
		} catch (__err) {
			const e = __err as CrustStoreError;
			expect(e).toBeInstanceOf(CrustStoreError);
			if (e.is("VALIDATION")) {
				expect(e.details.issues).toHaveLength(2);
				const paths = e.details.issues.map((i: { path: string }) => i.path);
				expect(paths).toContain("port");
				expect(paths).toContain("host");
			}
		}
	});

	it("should support async field validators", async () => {
		const fields = {
			token: {
				type: "string",
				default: "valid",
				validate: async (v: string) => {
					// Simulate async validation
					await new Promise((r) => setTimeout(r, 1));
					if (v.length < 3) throw new Error("token too short");
				},
			},
		} as const satisfies FieldsDef;

		const store = createStore({
			dirPath: tempDir,
			fields,
		});

		try {
			await store.write({ token: "ab" });
			expect.unreachable("should have thrown");
		} catch (__err) {
			const e = __err as CrustStoreError;
			expect(e).toBeInstanceOf(CrustStoreError);
			expect(e.is("VALIDATION")).toBe(true);
		}
	});

	it("should include field path in validation error details", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: VALIDATED_FIELDS,
		});

		try {
			await store.write({ port: 99999, host: "localhost" });
			expect.unreachable("should have thrown");
		} catch (__err) {
			const e = __err as CrustStoreError;
			if (e.is("VALIDATION")) {
				expect(e.details.issues[0]?.path).toBe("port");
				expect(e.details.issues[0]?.message).toBe("port must be 1-65535");
			}
		}
	});

	it("should include operation in validation error details", async () => {
		const store = createStore({
			dirPath: tempDir,
			fields: VALIDATED_FIELDS,
		});

		// Test write operation
		try {
			await store.write({ port: 0, host: "localhost" });
		} catch (__err) {
			const e = __err as CrustStoreError;
			if (e.is("VALIDATION")) {
				expect(e.details.operation).toBe("write");
			}
		}

		// Test update operation
		try {
			await store.update((c) => ({ ...c, port: 0 }));
		} catch (__err) {
			const e = __err as CrustStoreError;
			if (e.is("VALIDATION")) {
				expect(e.details.operation).toBe("update");
			}
		}

		// Test patch operation
		try {
			await store.patch({ port: 0 });
		} catch (__err) {
			const e = __err as CrustStoreError;
			if (e.is("VALIDATION")) {
				expect(e.details.operation).toBe("patch");
			}
		}
	});
});

// ─────────────────────────────────────────────────────────────────────────
// FieldDef.validate contract — fail-fast migration guard
// ─────────────────────────────────────────────────────────────────────────

describe("FieldDef.validate contract", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	// Regression: previously the migration guard accepted any object with
	// a `"value" in result` key, so `{ ok: false, value: "bad" }` was
	// silently persisted as `"bad"` instead of throwing TypeError. The
	// guard now rejects any return shape carrying an `ok` key.
	it("surfaces legacy { ok, value } validator return as TypeError", async () => {
		const fields = {
			name: {
				type: "string",
				default: "ok",
				validate: ((_v: string) => ({ ok: false, value: "bad" }) as never) as (v: string) => void,
			},
		} as const satisfies FieldsDef;

		const store = createStore({ dirPath: tempDir, fields });

		let caught: unknown;
		try {
			await store.write({ name: "input" });
			expect.unreachable("should have thrown");
		} catch (err) {
			caught = err;
		}

		expect(caught).toBeInstanceOf(TypeError);
		expect(caught).not.toBeInstanceOf(CrustStoreError);
		// Critically: the legacy `value: "bad"` was NOT persisted.
		const filePath = join(tempDir, "config.json");
		expect(existsSync(filePath)).toBe(false);
	});

	it("surfaces a buggy validator (returns a value) as TypeError, not CrustStoreError", async () => {
		// Regression: previously the migration guard `throw new TypeError`
		// ran inside the same try/catch that captures legitimate validation
		// rejections, so consumers branching on `err.code === "VALIDATION"`
		// silently misclassified a caller bug as a bad config value.
		const fields = {
			legacy: {
				type: "string",
				default: "x",
				// Legacy `{ ok, issues }` return shape — a caller bug.
				validate: ((_v: string) =>
					({ ok: false, issues: [{ message: "bad", path: "" }] }) as never) as (v: string) => void,
			},
		} as const satisfies FieldsDef;

		const store = createStore({ dirPath: tempDir, fields });

		let caught: unknown;
		try {
			await store.write({ legacy: "anything" });
			expect.unreachable("should have thrown");
		} catch (err) {
			caught = err;
		}

		expect(caught).toBeInstanceOf(TypeError);
		expect((caught as TypeError).message).toContain("FieldDef.validate must return void");
		// Critically: it is NOT a CrustStoreError("VALIDATION").
		expect(caught).not.toBeInstanceOf(CrustStoreError);
	});

	it("collects user-thrown TypeError as a regular validation issue", async () => {
		// Counterpart guarantee: a user that legitimately throws TypeError
		// from their validator (e.g. `throw new TypeError("expected string")`)
		// must still be captured as a normal validation rejection — not
		// confused with the migration guard’s TypeError.
		const fields = {
			name: {
				type: "string",
				default: "ok",
				validate: (v: string) => {
					if (v === "bad") throw new TypeError("name rejected by user code");
				},
			},
		} as const satisfies FieldsDef;

		const store = createStore({ dirPath: tempDir, fields });

		try {
			await store.write({ name: "bad" });
			expect.unreachable("should have thrown");
		} catch (__err) {
			const e = __err as CrustStoreError;
			expect(e).toBeInstanceOf(CrustStoreError);
			expect(e.is("VALIDATION")).toBe(true);
			if (e.is("VALIDATION")) {
				expect(e.details.issues).toHaveLength(1);
				expect(e.details.issues[0]?.path).toBe("name");
				expect(e.details.issues[0]?.message).toBe("name rejected by user code");
			}
		}
	});
});

// ─────────────────────────────────────────────────────────────────────────
// Schema-driven transform persistence + read-stability guard
// ─────────────────────────────────────────────────────────────────────────
//
// Closes the command/store asymmetry: schema transforms (e.g.
// `z.string().transform(s => s.trim())`) MUST persist on write/update/
// patch operations. Reads return on-disk values verbatim (no transform on
// read). A write-time read-stability guard rejects cross-type transforms
// whose output would fail the schema's own re-validation on the next
// read.

describe("schema transform persistence", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("persists Zod transform output on write (trim example)", async () => {
		const fields = {
			name: field(z.string().transform((s) => s.trim())),
		} as const satisfies FieldsDef;

		const store = createStore({ dirPath: tempDir, fields });

		await store.write({ name: "  hi  " });

		const filePath = join(tempDir, "config.json");
		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ name: "hi" });
	});

	it("persists Zod transform output on update", async () => {
		const fields = {
			name: field(z.string().transform((s) => s.trim())),
		} as const satisfies FieldsDef;

		const store = createStore({ dirPath: tempDir, fields });

		await store.update(() => ({ name: "  spaced  " }));

		const filePath = join(tempDir, "config.json");
		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ name: "spaced" });
	});

	it("persists Zod transform output on patch", async () => {
		const fields = {
			name: field(z.string().transform((s) => s.trim())),
		} as const satisfies FieldsDef;

		const store = createStore({ dirPath: tempDir, fields });

		await store.patch({ name: "  patched  " });

		const filePath = join(tempDir, "config.json");
		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ name: "patched" });
	});

	// Pin: reads MUST NOT mutate on-disk state, even when the schema would
	// transform the persisted value. Existing on-disk values survive
	// untouched until the next write canonicalizes them.
	it("read does NOT transform — pre-seeded file survives unchanged", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(filePath, JSON.stringify({ name: "  hi  " }));

		const fields = {
			name: field(z.string().transform((s) => s.trim())),
		} as const satisfies FieldsDef;

		const store = createStore({ dirPath: tempDir, fields });

		const result = await store.read();
		expect(result.name).toBe("  hi  ");

		const rawAfter = await readFile(filePath, "utf-8");
		expect(JSON.parse(rawAfter)).toEqual({ name: "  hi  " });
	});

	// Cross-type transform (string → number) succeeds the first
	// validation but its output fails the schema on re-validation — must
	// surface as `read-unstable transform` at write time and never touch
	// disk.
	it("rejects read-unstable cross-type transform at write time", async () => {
		const fields = {
			x: field(z.string().transform((s) => s.length)),
		} as const satisfies FieldsDef;

		const store = createStore({ dirPath: tempDir, fields });

		let caught: unknown;
		try {
			await store.write({ x: "hello" as unknown as number });
			expect.unreachable("should have thrown");
		} catch (err) {
			caught = err;
		}

		expect(caught).toBeInstanceOf(CrustStoreError);
		const e = caught as CrustStoreError;
		expect(e.is("VALIDATION")).toBe(true);
		if (e.is("VALIDATION")) {
			expect(e.details.operation).toBe("write");
			expect(e.details.issues).toHaveLength(1);
			expect(e.details.issues[0]?.path).toBe("x");
			expect(e.details.issues[0]?.message).toContain("read-unstable transform");
		}

		// Nothing should have been persisted.
		const filePath = join(tempDir, "config.json");
		expect(existsSync(filePath)).toBe(false);
	});

	// Pin: literal fields with the discriminated-union shape are
	// unaffected by transform persistence. The written JSON matches the
	// input value byte-for-byte (after coercion, which is unchanged).
	// Regression: the read-stability guard previously used reference
	// identity (`Object.is`), so Standard Schema parsers that return fresh
	// references for identical content (Zod arrays/objects) tripped the
	// guard and made `field(z.array(...))` unwritable.
	it("writes array field without tripping read-stability guard", async () => {
		const fields = {
			tags: field(z.array(z.string())),
		} as const satisfies FieldsDef;

		const store = createStore({ dirPath: tempDir, fields });

		await store.write({ tags: ["a", "b"] });

		const filePath = join(tempDir, "config.json");
		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ tags: ["a", "b"] });
	});

	// Regression: an array schema whose elements transform (e.g.
	// `z.array(z.string().transform(s => s.trim()))`) must still persist
	// the transformed array — the structural compare must accept the
	// recheck output as stable when contents match by value.
	it("persists Zod array-of-transforms output on write", async () => {
		const fields = {
			tags: field(z.array(z.string().transform((s) => s.trim()))),
		} as const satisfies FieldsDef;

		const store = createStore({ dirPath: tempDir, fields });

		await store.write({ tags: ["  a  ", "b "] });

		const filePath = join(tempDir, "config.json");
		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ tags: ["a", "b"] });
	});

	it("plain literal FieldDef is unaffected (end-to-end pin)", async () => {
		const fields = {
			theme: { type: "string", default: "x" },
		} as const satisfies FieldsDef;

		const store = createStore({ dirPath: tempDir, fields });

		await store.write({ theme: "dark" });

		const filePath = join(tempDir, "config.json");
		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ theme: "dark" });

		const result = await store.read();
		expect(result.theme).toBe("dark");
	});

	// Pin: hand-rolled void-returning `validate` callbacks keep their
	// current contract — accept on no-throw, reject on throw. The widened
	// FieldDef.validate signature must remain backward-compatible.
	it("hand-rolled void-return validate keeps current contract", async () => {
		const fields = {
			port: {
				type: "number",
				default: 3000,
				validate: (v: number) => {
					if (v < 1 || v > 65535) throw new Error("invalid port");
				},
			},
		} as const satisfies FieldsDef;

		const store = createStore({ dirPath: tempDir, fields });

		// Accept on no-throw: writes 8080 successfully.
		await store.write({ port: 8080 });
		const filePath = join(tempDir, "config.json");
		expect(JSON.parse(await readFile(filePath, "utf-8"))).toEqual({
			port: 8080,
		});

		// Reject on throw: 0 is out of range → CrustStoreError(VALIDATION).
		try {
			await store.write({ port: 0 });
			expect.unreachable("should have thrown");
		} catch (__err) {
			const e = __err as CrustStoreError;
			expect(e).toBeInstanceOf(CrustStoreError);
			expect(e.is("VALIDATION")).toBe(true);
			if (e.is("VALIDATION")) {
				expect(e.details.issues[0]?.message).toBe("invalid port");
			}
		}
	});
});
