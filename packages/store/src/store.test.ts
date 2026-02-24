import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CrustStoreError } from "./errors.ts";
import { createStore } from "./store.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

interface TestConfig {
	theme: "light" | "dark";
	verbose: boolean;
}

interface NestedConfig {
	ui: {
		theme: string;
		fontSize: number;
	};
	logging: {
		level: string;
	};
}

const TEST_CONFIG_DEFAULTS: TestConfig = { theme: "light", verbose: false };

function validateTestConfig(input: unknown): TestConfig {
	return input as TestConfig;
}

/** Creates a unique temp directory for each test to avoid cross-test pollution. */
function createTempDir(): string {
	return join(tmpdir(), `crust-store-test-${randomUUID()}`);
}

// ────────────────────────────────────────────────────────────────────────────
// createStore — factory
// ────────────────────────────────────────────────────────────────────────────

describe("createStore", () => {
	let tempDir: string;
	let filePath: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
		filePath = join(tempDir, "config.json");
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should return a store with read, write, update, and reset methods", () => {
		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			validate: validateTestConfig,
		});

		expect(typeof store.read).toBe("function");
		expect(typeof store.write).toBe("function");
		expect(typeof store.update).toBe("function");
		expect(typeof store.reset).toBe("function");
	});

	it("should throw CrustStoreError with PATH code for invalid appName", () => {
		expect(() =>
			createStore<TestConfig>({
				appName: "",
				filePath,
				validate: validateTestConfig,
			}),
		).toThrow(CrustStoreError);
	});

	it("should throw CrustStoreError with PATH code for invalid filePath", () => {
		expect(() =>
			createStore<TestConfig>({
				appName: "test-app",
				filePath: "relative/path.json",
				validate: validateTestConfig,
			}),
		).toThrow(CrustStoreError);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// read
// ────────────────────────────────────────────────────────────────────────────

describe("store.read", () => {
	let tempDir: string;
	let filePath: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
		filePath = join(tempDir, "config.json");
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should return undefined when no persisted file and no defaults", async () => {
		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			validate: validateTestConfig,
		});

		const result = await store.read();

		expect(result).toBeUndefined();
	});

	it("should return defaults when no persisted file exists", async () => {
		const defaults: TestConfig = { theme: "light", verbose: false };
		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			defaults,
		});

		const result = await store.read();

		expect(result).toEqual({ theme: "light", verbose: false });
	});

	it("should return persisted config when no defaults", async () => {
		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			validate: validateTestConfig,
		});

		await store.write({ theme: "dark", verbose: true });
		const result = await store.read();

		expect(result).toEqual({ theme: "dark", verbose: true });
	});

	it("should deep-merge persisted config with defaults", async () => {
		const defaults: NestedConfig = {
			ui: { theme: "light", fontSize: 14 },
			logging: { level: "info" },
		};
		const store = createStore<NestedConfig>({
			appName: "test-app",
			filePath,
			defaults,
		});

		// Write partial config (missing ui.fontSize and logging)
		await store.write({
			ui: { theme: "dark", fontSize: 16 },
			logging: { level: "debug" },
		});

		// Manually overwrite to simulate partial persisted state
		const { writeFile } = await import("node:fs/promises");
		await writeFile(filePath, JSON.stringify({ ui: { theme: "dark" } }));

		const result = await store.read();

		// fontSize should come from defaults, logging should come from defaults
		expect(result).toEqual({
			ui: { theme: "dark", fontSize: 14 },
			logging: { level: "info" },
		});
	});

	it("should not auto-persist merged defaults back to disk", async () => {
		const defaults: TestConfig = { theme: "light", verbose: false };
		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			defaults,
		});

		// Read triggers merge but should not write
		await store.read();

		// No file should have been created
		expect(existsSync(filePath)).toBe(false);
	});

	it("should run validator on read result", async () => {
		const defaults: TestConfig = { theme: "light", verbose: false };
		const validate = (input: unknown): TestConfig => {
			const obj = input as TestConfig;
			if (obj.theme !== "light" && obj.theme !== "dark") {
				throw new Error(`Invalid theme: ${obj.theme}`);
			}
			return obj;
		};

		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			defaults,
			validate,
		});

		// Valid defaults should pass
		const result = await store.read();
		expect(result).toEqual({ theme: "light", verbose: false });
	});

	it("should throw VALIDATION error when validator rejects read result", async () => {
		const { writeFile } = await import("node:fs/promises");
		await writeFile(
			filePath,
			JSON.stringify({ theme: "neon", verbose: false }),
		);

		const validate = (input: unknown): TestConfig => {
			const obj = input as TestConfig;
			if (obj.theme !== "light" && obj.theme !== "dark") {
				throw new Error(`Invalid theme: ${obj.theme}`);
			}
			return obj;
		};

		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			validate,
		});

		try {
			await store.read();
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			expect((err as CrustStoreError).is("VALIDATION")).toBe(true);
			expect((err as CrustStoreError).message).toContain("Invalid theme: neon");
		}
	});

	it("should throw PARSE error on malformed JSON", async () => {
		const { writeFile } = await import("node:fs/promises");
		await writeFile(filePath, "{ broken json }}}");

		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			validate: validateTestConfig,
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
	let filePath: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
		filePath = join(tempDir, "config.json");
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should persist config to disk", async () => {
		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			validate: validateTestConfig,
		});

		await store.write({ theme: "dark", verbose: true });

		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ theme: "dark", verbose: true });
	});

	it("should create parent directories when missing", async () => {
		const nestedPath = join(tempDir, "deep", "nested", "config.json");
		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath: nestedPath,
			validate: validateTestConfig,
		});

		await store.write({ theme: "light", verbose: false });

		expect(existsSync(nestedPath)).toBe(true);
		const raw = await readFile(nestedPath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ theme: "light", verbose: false });
	});

	it("should overwrite existing config", async () => {
		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			validate: validateTestConfig,
		});

		await store.write({ theme: "light", verbose: false });
		await store.write({ theme: "dark", verbose: true });

		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ theme: "dark", verbose: true });
	});

	it("should run validator before writing", async () => {
		const validate = (input: unknown): TestConfig => {
			const obj = input as TestConfig;
			if (obj.theme !== "light" && obj.theme !== "dark") {
				throw new Error(`Invalid theme: ${obj.theme}`);
			}
			return obj;
		};

		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			validate,
		});

		// Valid write should succeed
		await store.write({ theme: "dark", verbose: true });
		expect(existsSync(filePath)).toBe(true);
	});

	it("should throw VALIDATION error and not write when validator rejects", async () => {
		const validate = (input: unknown): TestConfig => {
			const obj = input as TestConfig;
			if (obj.theme !== "light" && obj.theme !== "dark") {
				throw new Error(`Invalid theme: ${obj.theme}`);
			}
			return obj;
		};

		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			validate,
		});

		try {
			// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
			await store.write({ theme: "neon" as any, verbose: false });
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			expect((err as CrustStoreError).is("VALIDATION")).toBe(true);
		}

		// File should not have been created
		expect(existsSync(filePath)).toBe(false);
	});

	it("should persist validator-transformed config", async () => {
		const validate = (input: unknown): TestConfig => {
			const obj = input as Record<string, unknown>;
			return {
				theme: (obj.theme as string) === "dark" ? "dark" : "light",
				verbose: Boolean(obj.verbose),
			};
		};

		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			validate,
		});

		// biome-ignore lint/suspicious/noExplicitAny: testing validator transformation
		await store.write({ theme: "unknown" as any, verbose: false });

		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ theme: "light", verbose: false });
	});
});

// ────────────────────────────────────────────────────────────────────────────
// update
// ────────────────────────────────────────────────────────────────────────────

describe("store.update", () => {
	let tempDir: string;
	let filePath: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
		filePath = join(tempDir, "config.json");
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should read, apply updater, and persist", async () => {
		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			validate: validateTestConfig,
		});

		await store.write({ theme: "light", verbose: false });
		await store.update((current) => ({ ...current, theme: "dark" }));

		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ theme: "dark", verbose: false });
	});

	it("should use defaults as current when no persisted file", async () => {
		const defaults: TestConfig = { theme: "light", verbose: false };
		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			defaults,
		});

		await store.update((current) => ({ ...current, verbose: true }));

		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ theme: "light", verbose: true });
	});

	it("should throw IO error when no persisted config and no defaults", async () => {
		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			validate: validateTestConfig,
		});

		try {
			await store.update((current) => ({ ...current, theme: "dark" }));
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			expect((err as CrustStoreError).is("IO")).toBe(true);
			expect((err as CrustStoreError).message).toContain("Cannot update store");
		}
	});

	it("should run validator on updated value", async () => {
		const validate = (input: unknown): TestConfig => {
			const obj = input as TestConfig;
			if (obj.theme !== "light" && obj.theme !== "dark") {
				throw new Error(`Invalid theme: ${obj.theme}`);
			}
			return obj;
		};

		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			validate,
		});

		await store.write({ theme: "light", verbose: false });

		try {
			// biome-ignore lint/suspicious/noExplicitAny: testing invalid update
			await store.update(() => ({ theme: "neon" as any, verbose: false }));
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			expect((err as CrustStoreError).is("VALIDATION")).toBe(true);
		}
	});

	it("should deep-merge defaults with persisted before applying updater", async () => {
		const defaults: NestedConfig = {
			ui: { theme: "light", fontSize: 14 },
			logging: { level: "info" },
		};
		const store = createStore<NestedConfig>({
			appName: "test-app",
			filePath,
			defaults,
		});

		// Write partial persisted config
		const { writeFile } = await import("node:fs/promises");
		await writeFile(filePath, JSON.stringify({ ui: { theme: "dark" } }));

		// Update should see merged config (defaults + persisted)
		await store.update((current) => ({
			...current,
			logging: { level: "debug" },
		}));

		const raw = await readFile(filePath, "utf-8");
		const result = JSON.parse(raw);

		expect(result).toEqual({
			ui: { theme: "dark", fontSize: 14 },
			logging: { level: "debug" },
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// reset
// ────────────────────────────────────────────────────────────────────────────

describe("store.reset", () => {
	let tempDir: string;
	let filePath: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
		filePath = join(tempDir, "config.json");
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should delete persisted config file", async () => {
		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			validate: validateTestConfig,
		});

		await store.write({ theme: "dark", verbose: true });
		expect(existsSync(filePath)).toBe(true);

		await store.reset();
		expect(existsSync(filePath)).toBe(false);
	});

	it("should not throw when no persisted file exists", async () => {
		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			validate: validateTestConfig,
		});

		// Should not throw
		await store.reset();
	});

	it("should return to defaults-on-read behavior after reset", async () => {
		const defaults: TestConfig = { theme: "light", verbose: false };
		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			defaults,
		});

		// Write custom config
		await store.write({ theme: "dark", verbose: true });
		const before = await store.read();
		expect(before).toEqual({ theme: "dark", verbose: true });

		// Reset
		await store.reset();

		// Should return defaults again
		const after = await store.read();
		expect(after).toEqual({ theme: "light", verbose: false });
	});

	it("should return undefined after reset when no defaults", async () => {
		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			validate: validateTestConfig,
		});

		await store.write({ theme: "dark", verbose: true });
		await store.reset();

		const result = await store.read();
		expect(result).toBeUndefined();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Full lifecycle integration
// ────────────────────────────────────────────────────────────────────────────

describe("store lifecycle", () => {
	let tempDir: string;
	let filePath: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		await mkdir(tempDir, { recursive: true });
		filePath = join(tempDir, "config.json");
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should support full read → write → update → reset cycle", async () => {
		const defaults: TestConfig = { theme: "light", verbose: false };
		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			defaults,
		});

		// 1. Read returns defaults
		const step1 = await store.read();
		expect(step1).toEqual({ theme: "light", verbose: false });

		// 2. Write persists new config
		await store.write({ theme: "dark", verbose: true });
		const step2 = await store.read();
		expect(step2).toEqual({ theme: "dark", verbose: true });

		// 3. Update modifies persisted config
		await store.update((c) => ({ ...c, verbose: false }));
		const step3 = await store.read();
		expect(step3).toEqual({ theme: "dark", verbose: false });

		// 4. Reset returns to defaults
		await store.reset();
		const step4 = await store.read();
		expect(step4).toEqual({ theme: "light", verbose: false });
		expect(existsSync(filePath)).toBe(false);
	});

	it("should support multiple write → read cycles", async () => {
		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			validate: validateTestConfig,
		});

		for (const theme of ["light", "dark", "light", "dark"] as const) {
			await store.write({ theme, verbose: theme === "dark" });
			const result = await store.read();
			expect(result).toEqual({ theme, verbose: theme === "dark" });
		}
	});

	it("should support write → reset → write cycle", async () => {
		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			validate: validateTestConfig,
		});

		await store.write({ theme: "dark", verbose: true });
		await store.reset();
		expect(existsSync(filePath)).toBe(false);

		await store.write({ theme: "light", verbose: false });
		const result = await store.read();
		expect(result).toEqual({ theme: "light", verbose: false });
	});

	it("should preserve validator across all operations", async () => {
		let validationCount = 0;
		const validate = (input: unknown): TestConfig => {
			validationCount++;
			return input as TestConfig;
		};

		const defaults: TestConfig = { theme: "light", verbose: false };
		const store = createStore<TestConfig>({
			appName: "test-app",
			filePath,
			defaults,
			validate,
		});

		await store.read(); // validates defaults
		expect(validationCount).toBe(1);

		await store.write({ theme: "dark", verbose: true }); // validates write
		expect(validationCount).toBe(2);

		await store.update((c) => ({ ...c, verbose: false })); // validates read + write
		expect(validationCount).toBe(4);
	});
});
