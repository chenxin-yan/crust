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

	it("should drop extra persisted keys not defined in defaults", async () => {
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

	it("should support full read → write → update → reset cycle", async () => {
		const store = createStore({
			dirPath: tempDir,
			defaults: BASIC_DEFAULTS,
		});

		// 1. Read returns defaults
		const step1 = await store.read();
		expect(step1.theme).toBe("light");
		expect(step1.verbose).toBe(false);

		// 2. Write persists new state
		await store.write({ theme: "dark", verbose: true });
		const step2 = await store.read();
		expect(step2.theme).toBe("dark");
		expect(step2.verbose).toBe(true);

		// 3. Update modifies persisted state
		await store.update((c) => ({ ...c, verbose: false }));
		const step3 = await store.read();
		expect(step3.theme).toBe("dark");
		expect(step3.verbose).toBe(false);

		// 4. Reset returns to defaults
		await store.reset();
		const step4 = await store.read();
		expect(step4.theme).toBe("light");
		expect(step4.verbose).toBe(false);
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
