import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CrustStoreError } from "./errors.ts";
import { deleteJson, readJson, writeJson } from "./persistence.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

/** Creates a unique temp directory for each test to avoid cross-test pollution. */
function createTempDir(): string {
	return join(tmpdir(), `crust-store-test-${randomUUID()}`);
}

// ────────────────────────────────────────────────────────────────────────────
// readJson
// ────────────────────────────────────────────────────────────────────────────

describe("readJson", () => {
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

	it("should return parsed JSON object from file", async () => {
		await writeFile(filePath, JSON.stringify({ theme: "dark", verbose: true }));

		const result = await readJson(filePath);

		expect(result).toEqual({ theme: "dark", verbose: true });
	});

	it("should return parsed JSON array from file", async () => {
		await writeFile(filePath, JSON.stringify([1, 2, 3]));

		const result = await readJson(filePath);

		expect(result).toEqual([1, 2, 3]);
	});

	it("should return parsed JSON string from file", async () => {
		await writeFile(filePath, JSON.stringify("hello"));

		const result = await readJson(filePath);

		expect(result).toBe("hello");
	});

	it("should return undefined when file does not exist", async () => {
		const result = await readJson(join(tempDir, "nonexistent.json"));

		expect(result).toBeUndefined();
	});

	it("should throw CrustStoreError PARSE on malformed JSON", async () => {
		await writeFile(filePath, "{ invalid json }}}");

		try {
			await readJson(filePath);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			const storeErr = err as CrustStoreError;
			expect(storeErr.is("PARSE")).toBe(true);
			if (storeErr.is("PARSE")) {
				expect(storeErr.details.path).toBe(filePath);
			}
			expect(storeErr.message).toContain("Malformed JSON");
			expect(storeErr.cause).toBeDefined();
		}
	});

	it("should throw CrustStoreError PARSE on empty file", async () => {
		await writeFile(filePath, "");

		try {
			await readJson(filePath);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			const storeErr = err as CrustStoreError;
			expect(storeErr.is("PARSE")).toBe(true);
		}
	});

	it("should throw CrustStoreError PARSE on truncated JSON", async () => {
		await writeFile(filePath, '{ "theme": "da');

		try {
			await readJson(filePath);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			const storeErr = err as CrustStoreError;
			expect(storeErr.is("PARSE")).toBe(true);
			expect(storeErr.cause).toBeInstanceOf(SyntaxError);
		}
	});

	it("should throw CrustStoreError IO on permission denied", async () => {
		await writeFile(filePath, JSON.stringify({ ok: true }));
		await chmod(filePath, 0o000);

		try {
			await readJson(filePath);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			const storeErr = err as CrustStoreError;
			expect(storeErr.is("IO")).toBe(true);
			if (storeErr.is("IO")) {
				expect(storeErr.details.path).toBe(filePath);
				expect(storeErr.details.operation).toBe("read");
			}
			expect(storeErr.cause).toBeDefined();
		} finally {
			// Restore permissions for cleanup
			await chmod(filePath, 0o644);
		}
	});

	it("should preserve cause from original parse error", async () => {
		await writeFile(filePath, "not json at all");

		try {
			await readJson(filePath);
			expect.unreachable("should have thrown");
		} catch (err) {
			const storeErr = err as CrustStoreError;
			expect(storeErr.cause).toBeInstanceOf(SyntaxError);
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// writeJson
// ────────────────────────────────────────────────────────────────────────────

describe("writeJson", () => {
	let tempDir: string;
	let filePath: string;

	beforeEach(() => {
		tempDir = createTempDir();
		filePath = join(tempDir, "config.json");
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should write JSON object to file", async () => {
		await writeJson(filePath, { theme: "dark", verbose: true });

		const raw = await readFile(filePath, "utf-8");
		const parsed = JSON.parse(raw);
		expect(parsed).toEqual({ theme: "dark", verbose: true });
	});

	it("should create parent directory if missing", async () => {
		const nested = join(tempDir, "deep", "nested", "config.json");

		await writeJson(nested, { created: true });

		expect(existsSync(nested)).toBe(true);
		const raw = await readFile(nested, "utf-8");
		expect(JSON.parse(raw)).toEqual({ created: true });
	});

	it("should overwrite existing file atomically", async () => {
		await mkdir(tempDir, { recursive: true });
		await writeFile(filePath, JSON.stringify({ old: true }));

		await writeJson(filePath, { new: true });

		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ new: true });
	});

	it("should produce tab-indented JSON", async () => {
		await writeJson(filePath, { theme: "dark" });

		const raw = await readFile(filePath, "utf-8");
		expect(raw).toContain("\t");
		expect(raw).toBe(JSON.stringify({ theme: "dark" }, null, "\t"));
	});

	it("should not leave temp files on successful write", async () => {
		await writeJson(filePath, { clean: true });

		const { readdir } = await import("node:fs/promises");
		const files = await readdir(tempDir);
		// Only the config file should remain, no .tmp files
		expect(files.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
	});

	it("should handle repeated writes without corruption", async () => {
		for (let i = 0; i < 5; i++) {
			await writeJson(filePath, { iteration: i });
		}

		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual({ iteration: 4 });
	});

	it("should handle complex nested data", async () => {
		const data = {
			user: { name: "test", preferences: { theme: "dark", font: 14 } },
			flags: [true, false, true],
			count: 42,
			nullable: null,
		};

		await writeJson(filePath, data);

		const raw = await readFile(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual(data);
	});

	it("should throw CrustStoreError IO when directory creation fails", async () => {
		// Use /dev/null (not a directory) as parent to force mkdir failure
		const badPath = "/dev/null/impossible/config.json";

		try {
			await writeJson(badPath, { data: true });
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			const storeErr = err as CrustStoreError;
			expect(storeErr.is("IO")).toBe(true);
			if (storeErr.is("IO")) {
				expect(storeErr.details.operation).toBe("write");
			}
			expect(storeErr.cause).toBeDefined();
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// deleteJson
// ────────────────────────────────────────────────────────────────────────────

describe("deleteJson", () => {
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

	it("should delete existing file", async () => {
		await writeFile(filePath, JSON.stringify({ data: true }));
		expect(existsSync(filePath)).toBe(true);

		await deleteJson(filePath);

		expect(existsSync(filePath)).toBe(false);
	});

	it("should succeed silently when file does not exist", async () => {
		const nonexistent = join(tempDir, "nonexistent.json");

		// Should not throw
		await deleteJson(nonexistent);
	});

	it("should throw CrustStoreError IO on permission denied", async () => {
		await writeFile(filePath, JSON.stringify({ data: true }));
		// Remove write permission from the directory to prevent deletion
		await chmod(tempDir, 0o444);

		try {
			await deleteJson(filePath);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustStoreError);
			const storeErr = err as CrustStoreError;
			expect(storeErr.is("IO")).toBe(true);
			if (storeErr.is("IO")) {
				expect(storeErr.details.path).toBe(filePath);
				expect(storeErr.details.operation).toBe("delete");
			}
			expect(storeErr.cause).toBeDefined();
		} finally {
			// Restore permissions for cleanup
			await chmod(tempDir, 0o755);
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Integration: read ↔ write round-trip
// ────────────────────────────────────────────────────────────────────────────

describe("readJson + writeJson round-trip", () => {
	let tempDir: string;
	let filePath: string;

	beforeEach(() => {
		tempDir = createTempDir();
		filePath = join(tempDir, "config.json");
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should round-trip a config object through write then read", async () => {
		const config = { theme: "dark", verbose: true, retries: 3 };

		await writeJson(filePath, config);
		const result = await readJson(filePath);

		expect(result).toEqual(config);
	});

	it("should return undefined after write then delete then read", async () => {
		await writeJson(filePath, { data: true });
		await deleteJson(filePath);
		const result = await readJson(filePath);

		expect(result).toBeUndefined();
	});

	it("should handle write-read-overwrite-read cycle", async () => {
		await writeJson(filePath, { version: 1 });
		const v1 = await readJson(filePath);
		expect(v1).toEqual({ version: 1 });

		await writeJson(filePath, { version: 2 });
		const v2 = await readJson(filePath);
		expect(v2).toEqual({ version: 2 });
	});
});
