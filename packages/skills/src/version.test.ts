import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkVersion, readInstalledVersion } from "./version.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
	const base = join(import.meta.dirname ?? ".", ".tmp-test");
	const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	tmpDir = join(base, id);
	await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
	try {
		await rm(tmpDir, { recursive: true });
	} catch {
		// Ignore cleanup errors
	}
});

// ────────────────────────────────────────────────────────────────────────────
// readInstalledVersion
// ────────────────────────────────────────────────────────────────────────────

describe("readInstalledVersion", () => {
	it("reads version from manifest.json", async () => {
		await writeFile(
			join(tmpDir, "manifest.json"),
			JSON.stringify({ name: "test", version: "1.2.3" }),
		);

		const version = await readInstalledVersion(tmpDir);
		expect(version).toBe("1.2.3");
	});

	it("returns null when manifest.json does not exist", async () => {
		const version = await readInstalledVersion(tmpDir);
		expect(version).toBeNull();
	});

	it("returns null when manifest.json is malformed JSON", async () => {
		await writeFile(join(tmpDir, "manifest.json"), "not json {{{");

		const version = await readInstalledVersion(tmpDir);
		expect(version).toBeNull();
	});

	it("returns null when manifest.json has no version field", async () => {
		await writeFile(
			join(tmpDir, "manifest.json"),
			JSON.stringify({ name: "test" }),
		);

		const version = await readInstalledVersion(tmpDir);
		expect(version).toBeNull();
	});

	it("returns null when version is not a string", async () => {
		await writeFile(
			join(tmpDir, "manifest.json"),
			JSON.stringify({ name: "test", version: 123 }),
		);

		const version = await readInstalledVersion(tmpDir);
		expect(version).toBeNull();
	});

	it("returns null for nonexistent directory", async () => {
		const version = await readInstalledVersion("/nonexistent/path/xyz");
		expect(version).toBeNull();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// checkVersion
// ────────────────────────────────────────────────────────────────────────────

describe("checkVersion", () => {
	it("returns 'installed' with null version when no manifest exists", async () => {
		const result = await checkVersion(tmpDir, "1.0.0");
		expect(result.status).toBe("installed");
		expect(result.installedVersion).toBeNull();
	});

	it("returns 'up-to-date' with version when versions match exactly", async () => {
		await writeFile(
			join(tmpDir, "manifest.json"),
			JSON.stringify({ name: "test", version: "1.0.0" }),
		);

		const result = await checkVersion(tmpDir, "1.0.0");
		expect(result.status).toBe("up-to-date");
		expect(result.installedVersion).toBe("1.0.0");
	});

	it("returns 'updated' with previous version when versions differ", async () => {
		await writeFile(
			join(tmpDir, "manifest.json"),
			JSON.stringify({ name: "test", version: "1.0.0" }),
		);

		const result = await checkVersion(tmpDir, "2.0.0");
		expect(result.status).toBe("updated");
		expect(result.installedVersion).toBe("1.0.0");
	});

	it("returns 'installed' with null version when manifest is malformed", async () => {
		await writeFile(join(tmpDir, "manifest.json"), "invalid json");

		const result = await checkVersion(tmpDir, "1.0.0");
		expect(result.status).toBe("installed");
		expect(result.installedVersion).toBeNull();
	});

	it("uses exact string comparison", async () => {
		await writeFile(
			join(tmpDir, "manifest.json"),
			JSON.stringify({ name: "test", version: "1.0.0" }),
		);

		// "1.0.0" !== "v1.0.0"
		const result = await checkVersion(tmpDir, "v1.0.0");
		expect(result.status).toBe("updated");
		expect(result.installedVersion).toBe("1.0.0");
	});
});
