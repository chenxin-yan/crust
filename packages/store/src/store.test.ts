import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CrustStoreError } from "./errors.ts";
import { createStore } from "./store.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

/** Creates a unique temp directory for each test to avoid cross-test pollution. */
function createTempDir(): string {
	return join(tmpdir(), `crust-store-test-${randomUUID()}`);
}

const BASIC_DEFAULTS = {
	theme: "light" as string,
	verbose: false as boolean,
};

const NESTED_DEFAULTS = {
	ui: { theme: "light" as string, fontSize: 14 as number },
	verbose: false as boolean,
};

const ARRAY_DEFAULTS = {
	tags: [] as string[],
	count: 0,
};

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
			defaults: BASIC_DEFAULTS,
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
				defaults: BASIC_DEFAULTS,
			}),
		).toThrow(CrustStoreError);
	});

	it("should throw CrustStoreError with PATH code for dirPath ending in .json", () => {
		expect(() =>
			createStore({
				dirPath: "/tmp/config.json",
				defaults: BASIC_DEFAULTS,
			}),
		).toThrow(CrustStoreError);
	});

	it("should throw CrustStoreError with PATH code for invalid name", () => {
		expect(() =>
			createStore({
				dirPath: tempDir,
				name: "my/store",
				defaults: BASIC_DEFAULTS,
			}),
		).toThrow(CrustStoreError);
	});

	it("should throw CrustStoreError with PATH code for name with .json extension", () => {
		expect(() =>
			createStore({
				dirPath: tempDir,
				name: "config.json",
				defaults: BASIC_DEFAULTS,
			}),
		).toThrow(CrustStoreError);
	});

	it("should use custom name for store file", async () => {
		const store = createStore({
			dirPath: tempDir,
			name: "auth",
			defaults: BASIC_DEFAULTS,
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
			defaults: BASIC_DEFAULTS,
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
			defaults: BASIC_DEFAULTS,
		});

		const result = await store.read();

		expect(result.theme).toBe("light");
		expect(result.verbose).toBe(false);
	});

	it("should return persisted values overriding defaults", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
		});

		await store.write({ theme: "dark", verbose: true });
		const result = await store.read();

		expect(result.theme).toBe("dark");
		expect(result.verbose).toBe(true);
	});

	it("should fill missing persisted keys from defaults", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(filePath, JSON.stringify({ theme: "dark" }));

		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
		});

		const result = await store.read();

		expect(result.theme).toBe("dark");
		expect(result.verbose).toBe(false);
	});

	it("should not auto-persist merged defaults back to disk", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
		});

		// Read triggers merge but should not write
		await store.read();

		const filePath = join(tempDir, "config.json");
		expect(existsSync(filePath)).toBe(false);
	});

	it("should drop extra persisted keys not defined in defaults (pruneUnknown=true by default)", async () => {
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
			defaults: BASIC_DEFAULTS,
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
			defaults: BASIC_DEFAULTS,
		});

		try {
			await store.read();
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			expect((err as CrustStoreError).is("PARSE")).toBe(true);
		}
	});

	it("should deep merge nested defaults on read", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(filePath, JSON.stringify({ ui: { theme: "dark" } }));

		const store = createStore({
			dirPath: tempDir,
			defaults: NESTED_DEFAULTS,
		});

		const result = await store.read();

		expect(result.ui.theme).toBe("dark");
		expect(result.ui.fontSize).toBe(14); // filled from defaults
		expect(result.verbose).toBe(false); // filled from defaults
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

	it("should persist state to disk", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
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
			defaults: BASIC_DEFAULTS,
		});

		await store.write({ theme: "light", verbose: false });

		const nestedPath = join(nestedDir, "config.json");
		expect(existsSync(nestedPath)).toBe(true);
		const raw = await readFile(nestedPath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ theme: "light", verbose: false });
	});

	it("should overwrite existing state", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
		});

		await store.write({ theme: "light", verbose: false });
		await store.write({ theme: "dark", verbose: true });

		const filePath = join(tempDir, "config.json");
		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ theme: "dark", verbose: true });
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
			defaults: BASIC_DEFAULTS,
		});

		await store.write({ theme: "light", verbose: false });
		await store.update((current) => ({ ...current, theme: "dark" }));

		const filePath = join(tempDir, "config.json");
		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ theme: "dark", verbose: false });
	});

	it("should use defaults as current when no persisted file", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
		});

		await store.update((current) => ({ ...current, verbose: true }));

		const filePath = join(tempDir, "config.json");
		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ theme: "light", verbose: true });
	});

	it("should merge defaults with partial persisted before applying updater", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(filePath, JSON.stringify({ theme: "dark" }));

		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
		});

		// Update should see merged state (defaults + persisted)
		await store.update((current) => ({
			...current,
			verbose: true,
		}));

		const raw = await readFile(filePath, "utf-8");
		const result = JSON.parse(raw);
		expect(result).toEqual({ theme: "dark", verbose: true });
	});
});

// ────────────────────────────────────────────────────────────────────────────
// patch — deep partial updates
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

	it("should update only specified keys, preserving others", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
		});

		await store.write({ theme: "dark", verbose: true });
		await store.patch({ theme: "light" });

		const result = await store.read();
		expect(result.theme).toBe("light");
		expect(result.verbose).toBe(true); // unchanged
	});

	it("should deep merge nested objects", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: NESTED_DEFAULTS,
		});

		await store.write({
			ui: { theme: "light", fontSize: 14 },
			verbose: false,
		});
		await store.patch({ ui: { theme: "dark" } });

		const result = await store.read();
		expect(result.ui.theme).toBe("dark");
		expect(result.ui.fontSize).toBe(14); // preserved from current
		expect(result.verbose).toBe(false); // preserved from current
	});

	it("should replace arrays wholesale", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: ARRAY_DEFAULTS,
		});

		await store.write({ tags: ["a", "b"], count: 5 });
		await store.patch({ tags: ["x"] });

		const result = await store.read();
		expect(result.tags).toEqual(["x"]); // replaced, not merged
		expect(result.count).toBe(5); // preserved
	});

	it("should work against defaults when no persisted file exists", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
		});

		await store.patch({ verbose: true });

		const result = await store.read();
		expect(result.theme).toBe("light"); // from defaults
		expect(result.verbose).toBe(true); // patched
	});

	it("should handle deeply nested partial updates", async () => {
		const defaults = {
			a: { b: { c: "original" as string, d: 1 as number }, e: true as boolean },
		};

		const store = createStore({
			dirPath: tempDir,
			defaults,
		});

		await store.write({
			a: { b: { c: "original", d: 1 }, e: true },
		});
		await store.patch({ a: { b: { c: "updated" } } });

		const result = await store.read();
		expect(result.a.b.c).toBe("updated");
		expect(result.a.b.d).toBe(1); // preserved
		expect(result.a.e).toBe(true); // preserved
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

	it("should delete persisted state file", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
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
			defaults: BASIC_DEFAULTS,
		});

		// Should not throw
		await store.reset();
	});

	it("should return to defaults-on-read behavior after reset", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
		});

		// Write custom state
		await store.write({ theme: "dark", verbose: true });
		const before = await store.read();
		expect(before.theme).toBe("dark");
		expect(before.verbose).toBe(true);

		// Reset
		await store.reset();

		// Should return defaults again
		const after = await store.read();
		expect(after.theme).toBe("light");
		expect(after.verbose).toBe(false);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// validate option
// ────────────────────────────────────────────────────────────────────────────

describe("store validate option", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should call validate on write and allow valid state", async () => {
		let validated = false;
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
			validate: (_state) => {
				validated = true;
			},
		});

		await store.write({ theme: "dark", verbose: true });
		expect(validated).toBe(true);
	});

	it("should throw VALIDATION error on write when validate rejects", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
			validate: (state) => {
				if (state.theme === "invalid") {
					throw new Error("theme must be light or dark");
				}
			},
		});

		try {
			await store.write({ theme: "invalid", verbose: false });
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			const storeErr = err as CrustStoreError;
			expect(storeErr.is("VALIDATION")).toBe(true);
			if (storeErr.is("VALIDATION")) {
				expect(storeErr.details.operation).toBe("write");
			}
			expect(storeErr.message).toBe("theme must be light or dark");
			expect(storeErr.cause).toBeInstanceOf(Error);
		}
	});

	it("should not persist state when write validation fails", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
			validate: (state) => {
				if (state.theme === "invalid") throw new Error("bad theme");
			},
		});

		try {
			await store.write({ theme: "invalid", verbose: false });
		} catch {
			// expected
		}

		const filePath = join(tempDir, "config.json");
		expect(existsSync(filePath)).toBe(false);
	});

	it("should throw VALIDATION error on update when validate rejects", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
			validate: (state) => {
				if (state.theme === "invalid") {
					throw new Error("bad theme");
				}
			},
		});

		await store.write({ theme: "dark", verbose: true });

		try {
			await store.update(() => ({ theme: "invalid", verbose: false }));
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			const storeErr = err as CrustStoreError;
			expect(storeErr.is("VALIDATION")).toBe(true);
			if (storeErr.is("VALIDATION")) {
				expect(storeErr.details.operation).toBe("update");
			}
		}
	});

	it("should not persist state when update validation fails", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
			validate: (state) => {
				if (state.theme === "invalid") throw new Error("bad");
			},
		});

		await store.write({ theme: "dark", verbose: true });

		try {
			await store.update(() => ({ theme: "invalid", verbose: false }));
		} catch {
			// expected
		}

		// Original state should be preserved
		const result = await store.read();
		expect(result.theme).toBe("dark");
	});

	it("should throw VALIDATION error on patch when validate rejects", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
			validate: (state) => {
				if (state.theme === "invalid") {
					throw new Error("bad theme");
				}
			},
		});

		await store.write({ theme: "dark", verbose: true });

		try {
			await store.patch({ theme: "invalid" });
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			const storeErr = err as CrustStoreError;
			expect(storeErr.is("VALIDATION")).toBe(true);
			if (storeErr.is("VALIDATION")) {
				expect(storeErr.details.operation).toBe("patch");
			}
		}
	});

	it("should not persist state when patch validation fails", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
			validate: (state) => {
				if (state.theme === "invalid") throw new Error("bad");
			},
		});

		await store.write({ theme: "dark", verbose: true });

		try {
			await store.patch({ theme: "invalid" });
		} catch {
			// expected
		}

		// Original state should be preserved
		const result = await store.read();
		expect(result.theme).toBe("dark");
	});

	it("should support async validate functions", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
			validate: async (state) => {
				await Promise.resolve(); // simulate async
				if (state.theme === "invalid") {
					throw new Error("async validation failed");
				}
			},
		});

		// Valid write should succeed
		await store.write({ theme: "dark", verbose: true });

		// Invalid write should fail
		try {
			await store.write({ theme: "invalid", verbose: false });
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			expect((err as CrustStoreError).is("VALIDATION")).toBe(true);
		}
	});

	it("should handle non-Error thrown values from validate", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
			validate: () => {
				throw "string error"; // non-Error value
			},
		});

		try {
			await store.write({ theme: "dark", verbose: false });
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			const storeErr = err as CrustStoreError;
			expect(storeErr.is("VALIDATION")).toBe(true);
			expect(storeErr.message).toBe("Validation failed");
			expect(storeErr.cause).toBe("string error");
		}
	});

	it("should not call validate on read", async () => {
		let validateCalled = false;
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
			validate: () => {
				validateCalled = true;
			},
		});

		await store.read();
		expect(validateCalled).toBe(false);
	});

	it("should not call validate on reset", async () => {
		let validateCalled = false;
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
			validate: () => {
				validateCalled = true;
			},
		});

		await store.reset();
		expect(validateCalled).toBe(false);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// pruneUnknown option
// ────────────────────────────────────────────────────────────────────────────

describe("store pruneUnknown option", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should drop unknown keys by default (pruneUnknown=true)", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(
			filePath,
			JSON.stringify({ theme: "dark", verbose: true, extra: "unknown" }),
		);

		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
		});

		const result = await store.read();
		expect("extra" in result).toBe(false);
		expect(result.theme).toBe("dark");
	});

	it("should drop unknown keys when pruneUnknown is explicitly true", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(
			filePath,
			JSON.stringify({ theme: "dark", verbose: true, extra: "unknown" }),
		);

		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
			pruneUnknown: true,
		});

		const result = await store.read();
		expect("extra" in result).toBe(false);
	});

	it("should preserve unknown keys when pruneUnknown is false", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(
			filePath,
			JSON.stringify({ theme: "dark", verbose: true, extra: "kept" }),
		);

		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
			pruneUnknown: false,
		});

		const result = await store.read();
		expect(result.theme).toBe("dark");
		expect(result.verbose).toBe(true);
		expect((result as Record<string, unknown>).extra).toBe("kept");
	});

	it("should preserve unknown nested keys when pruneUnknown is false", async () => {
		const filePath = join(tempDir, "config.json");
		await writeFile(
			filePath,
			JSON.stringify({
				ui: { theme: "dark", fontSize: 14, custom: "extra" },
				verbose: true,
				topExtra: 42,
			}),
		);

		const store = createStore({
			dirPath: tempDir,
			defaults: NESTED_DEFAULTS,
			pruneUnknown: false,
		});

		const result = await store.read();
		expect(result.ui.theme).toBe("dark");
		expect((result.ui as Record<string, unknown>).custom).toBe("extra");
		expect((result as Record<string, unknown>).topExtra).toBe(42);
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
			defaults: NESTED_DEFAULTS,
		});

		// 1. Read returns defaults
		const step1 = await store.read();
		expect(step1.ui.theme).toBe("light");
		expect(step1.ui.fontSize).toBe(14);
		expect(step1.verbose).toBe(false);

		// 2. Write persists new state
		await store.write({
			ui: { theme: "dark", fontSize: 16 },
			verbose: true,
		});
		const step2 = await store.read();
		expect(step2.ui.theme).toBe("dark");
		expect(step2.ui.fontSize).toBe(16);
		expect(step2.verbose).toBe(true);

		// 3. Update modifies persisted state
		await store.update((c) => ({
			...c,
			ui: { ...c.ui, fontSize: 18 },
		}));
		const step3 = await store.read();
		expect(step3.ui.theme).toBe("dark");
		expect(step3.ui.fontSize).toBe(18);

		// 4. Patch applies deep partial
		await store.patch({ ui: { theme: "light" } });
		const step4 = await store.read();
		expect(step4.ui.theme).toBe("light");
		expect(step4.ui.fontSize).toBe(18); // preserved

		// 5. Reset returns to defaults
		await store.reset();
		const step5 = await store.read();
		expect(step5.ui.theme).toBe("light");
		expect(step5.ui.fontSize).toBe(14);
		expect(step5.verbose).toBe(false);
		const filePath = join(tempDir, "config.json");
		expect(existsSync(filePath)).toBe(false);
	});

	it("should support multiple write → read cycles", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
		});

		for (const theme of ["light", "dark", "light", "dark"] as const) {
			await store.write({ theme, verbose: theme === "dark" });
			const result = await store.read();
			expect(result.theme).toBe(theme);
			expect(result.verbose).toBe(theme === "dark");
		}
	});

	it("should support write → reset → write cycle", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
		});

		await store.write({ theme: "dark", verbose: true });
		await store.reset();
		const filePath = join(tempDir, "config.json");
		expect(existsSync(filePath)).toBe(false);

		await store.write({ theme: "light", verbose: false });
		const result = await store.read();
		expect(result.theme).toBe("light");
		expect(result.verbose).toBe(false);
	});

	it("should handle array defaults across lifecycle", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: ARRAY_DEFAULTS,
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

		// Patch replaces array wholesale
		await store.patch({ tags: ["x"] });
		const step4 = await store.read();
		expect(step4.tags).toEqual(["x"]);
		expect(step4.count).toBe(5); // preserved by patch
	});

	it("should support lifecycle with validation", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
			validate: (state) => {
				if (state.theme !== "light" && state.theme !== "dark") {
					throw new Error("invalid theme");
				}
			},
		});

		// Valid operations succeed
		await store.write({ theme: "dark", verbose: true });
		await store.update((c) => ({ ...c, verbose: false }));
		await store.patch({ theme: "light" });

		const result = await store.read();
		expect(result.theme).toBe("light");
		expect(result.verbose).toBe(false);

		// Invalid operation is rejected
		try {
			await store.write({ theme: "neon", verbose: true });
			expect.unreachable("should have thrown");
		} catch (err) {
			expect((err as CrustStoreError).is("VALIDATION")).toBe(true);
		}

		// State is unchanged after failed write
		const after = await store.read();
		expect(after.theme).toBe("light");
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
			defaults: BASIC_DEFAULTS,
		});

		const authStore = createStore({
			dirPath: tempDir,
			name: "auth",
			defaults: { token: "" as string },
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
			defaults: BASIC_DEFAULTS,
		});
		await defaultStore.write({ theme: "dark", verbose: true });

		const authStore = createStore({
			dirPath: tempDir,
			name: "auth",
			defaults: { token: "" as string },
		});
		await authStore.write({ token: "secret" });

		// Verify different files exist
		expect(existsSync(join(tempDir, "config.json"))).toBe(true);
		expect(existsSync(join(tempDir, "auth.json"))).toBe(true);
	});
});
