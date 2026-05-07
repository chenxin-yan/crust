import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	CRUST_MANIFEST,
	checkVersion,
	readInstalledManifest,
	readInstalledVersion,
} from "./version.ts";

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
	it("reads version from crust.json", async () => {
		await writeFile(
			join(tmpDir, CRUST_MANIFEST),
			JSON.stringify({ name: "test", version: "1.2.3" }),
		);

		const version = await readInstalledVersion(tmpDir);
		expect(version).toBe("1.2.3");
	});

	it("returns null when crust.json does not exist", async () => {
		const version = await readInstalledVersion(tmpDir);
		expect(version).toBeNull();
	});

	it("returns null when crust.json is malformed JSON", async () => {
		await writeFile(join(tmpDir, CRUST_MANIFEST), "not json {{{");

		const version = await readInstalledVersion(tmpDir);
		expect(version).toBeNull();
	});

	it("returns null when crust.json has no version field", async () => {
		await writeFile(
			join(tmpDir, CRUST_MANIFEST),
			JSON.stringify({ name: "test" }),
		);

		const version = await readInstalledVersion(tmpDir);
		expect(version).toBeNull();
	});

	it("returns null when version is not a string", async () => {
		await writeFile(
			join(tmpDir, CRUST_MANIFEST),
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
// readInstalledManifest
// ────────────────────────────────────────────────────────────────────────────

describe("readInstalledManifest", () => {
	it("reads version + kind from new-format crust.json", async () => {
		await writeFile(
			join(tmpDir, CRUST_MANIFEST),
			JSON.stringify({
				name: "test",
				description: "test",
				version: "1.2.3",
				kind: "bundle",
			}),
		);

		const manifest = await readInstalledManifest(tmpDir);
		expect(manifest).toEqual({ version: "1.2.3", kind: "bundle" });
	});

	it("defaults missing kind to 'generated' (legacy crust.json)", async () => {
		await writeFile(
			join(tmpDir, CRUST_MANIFEST),
			JSON.stringify({ name: "test", version: "1.2.3" }),
		);

		const manifest = await readInstalledManifest(tmpDir);
		expect(manifest).toEqual({ version: "1.2.3", kind: "generated" });
	});

	it("defaults unrecognized kind to 'generated'", async () => {
		await writeFile(
			join(tmpDir, CRUST_MANIFEST),
			JSON.stringify({ name: "test", version: "1.2.3", kind: "weird" }),
		);

		const manifest = await readInstalledManifest(tmpDir);
		expect(manifest).toEqual({ version: "1.2.3", kind: "generated" });
	});

	it("returns null when crust.json does not exist", async () => {
		expect(await readInstalledManifest(tmpDir)).toBeNull();
	});

	it("returns null when crust.json is malformed JSON", async () => {
		await writeFile(join(tmpDir, CRUST_MANIFEST), "not json {{{");
		expect(await readInstalledManifest(tmpDir)).toBeNull();
	});

	it("returns null when crust.json has no version field", async () => {
		await writeFile(
			join(tmpDir, CRUST_MANIFEST),
			JSON.stringify({ name: "test" }),
		);
		expect(await readInstalledManifest(tmpDir)).toBeNull();
	});

	it("reads kind: 'bundle' verbatim", async () => {
		await writeFile(
			join(tmpDir, CRUST_MANIFEST),
			JSON.stringify({ name: "test", version: "1.0.0", kind: "bundle" }),
		);
		const manifest = await readInstalledManifest(tmpDir);
		expect(manifest?.kind).toBe("bundle");
	});

	it("reads kind: 'generated' verbatim", async () => {
		await writeFile(
			join(tmpDir, CRUST_MANIFEST),
			JSON.stringify({ name: "test", version: "1.0.0", kind: "generated" }),
		);
		const manifest = await readInstalledManifest(tmpDir);
		expect(manifest?.kind).toBe("generated");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// checkVersion
// ────────────────────────────────────────────────────────────────────────────

describe("checkVersion", () => {
	it("returns 'installed' with null version when no crust.json exists", async () => {
		const result = await checkVersion(tmpDir, "1.0.0");
		expect(result.status).toBe("installed");
		expect(result.installedVersion).toBeNull();
	});

	it("returns 'up-to-date' with version when versions match exactly", async () => {
		await writeFile(
			join(tmpDir, CRUST_MANIFEST),
			JSON.stringify({ name: "test", version: "1.0.0" }),
		);

		const result = await checkVersion(tmpDir, "1.0.0");
		expect(result.status).toBe("up-to-date");
		expect(result.installedVersion).toBe("1.0.0");
	});

	it("returns 'updated' with previous version when versions differ", async () => {
		await writeFile(
			join(tmpDir, CRUST_MANIFEST),
			JSON.stringify({ name: "test", version: "1.0.0" }),
		);

		const result = await checkVersion(tmpDir, "2.0.0");
		expect(result.status).toBe("updated");
		expect(result.installedVersion).toBe("1.0.0");
	});

	it("returns 'installed' with null version when crust.json is malformed", async () => {
		await writeFile(join(tmpDir, CRUST_MANIFEST), "invalid json");

		const result = await checkVersion(tmpDir, "1.0.0");
		expect(result.status).toBe("installed");
		expect(result.installedVersion).toBeNull();
	});

	it("uses exact string comparison", async () => {
		await writeFile(
			join(tmpDir, CRUST_MANIFEST),
			JSON.stringify({ name: "test", version: "1.0.0" }),
		);

		// "1.0.0" !== "v1.0.0"
		const result = await checkVersion(tmpDir, "v1.0.0");
		expect(result.status).toBe("updated");
		expect(result.installedVersion).toBe("1.0.0");
	});
});
