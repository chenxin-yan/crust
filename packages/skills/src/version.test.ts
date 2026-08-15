import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CRUST_MANIFEST, inspectInstalledManifest, readInstalledManifest } from "./version.ts";

let tempRoot: string;

beforeEach(async () => {
	tempRoot = await mkdtemp(join(tmpdir(), "crust-manifest-"));
});

afterEach(async () => {
	await rm(tempRoot, { recursive: true, force: true });
});

const valid = {
	name: "demo",
	description: "Demo skill",
	version: "1.2.3",
	kind: "generated",
} as const;

describe("skill ownership manifests", () => {
	it("reads the full self-describing manifest", async () => {
		await writeFile(join(tempRoot, CRUST_MANIFEST), JSON.stringify(valid));
		expect(await readInstalledManifest(tempRoot)).toEqual(valid);
	});

	it("distinguishes absent and malformed manifests", async () => {
		expect(await inspectInstalledManifest(join(tempRoot, "missing"))).toEqual({ status: "absent" });
		await writeFile(join(tempRoot, CRUST_MANIFEST), "not json");
		expect(await inspectInstalledManifest(tempRoot)).toEqual({
			status: "malformed",
			reason: "parse-error",
		});
	});

	it("rejects an array-root manifest", async () => {
		await writeFile(join(tempRoot, CRUST_MANIFEST), "[]");
		expect(await inspectInstalledManifest(tempRoot)).toEqual({
			status: "malformed",
			reason: "not-an-object",
		});
	});

	it("requires ownership name and description", async () => {
		await writeFile(
			join(tempRoot, CRUST_MANIFEST),
			JSON.stringify({ version: "1.0.0", kind: "bundle" }),
		);
		expect(await inspectInstalledManifest(tempRoot)).toEqual({
			status: "malformed",
			reason: "missing-name",
		});

		await writeFile(
			join(tempRoot, CRUST_MANIFEST),
			JSON.stringify({ name: "demo", version: "1.0.0", kind: "bundle" }),
		);
		expect(await inspectInstalledManifest(tempRoot)).toEqual({
			status: "malformed",
			reason: "missing-description",
		});
	});

	it("reports unknown kinds", async () => {
		await writeFile(join(tempRoot, CRUST_MANIFEST), JSON.stringify({ ...valid, kind: "bundel" }));
		expect(await inspectInstalledManifest(tempRoot)).toEqual({
			status: "malformed",
			reason: "unknown-kind",
			rawKind: "bundel",
		});
	});

	it("returns null for incomplete manifests", async () => {
		await mkdir(join(tempRoot, "empty"));
		expect(await readInstalledManifest(join(tempRoot, "empty"))).toBeNull();
	});
});
