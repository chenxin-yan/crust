import { expect, it } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import changesetConfig from "../../../.changeset/config.json";

const repoRoot = resolve(import.meta.dir, "../../..");
const corePeers = ["extensions", "man", "skills", "testing"];

function assertVersion(manifest: unknown): asserts manifest is { version: string } {
	assert(manifest && typeof manifest === "object" && "version" in manifest);
	assert(typeof manifest.version === "string");
}

function readVersion(path: string): string {
	const manifest: unknown = JSON.parse(readFileSync(path, "utf8"));
	assertVersion(manifest);
	return manifest.version;
}

function assertCorePeer(
	manifest: unknown,
): asserts manifest is { peerDependencies: { "@crustjs/core": string } } {
	assert(manifest && typeof manifest === "object" && "peerDependencies" in manifest);
	const peers = manifest.peerDependencies;
	assert(peers && typeof peers === "object" && "@crustjs/core" in peers);
	assert(typeof peers["@crustjs/core"] === "string");
}

it("packs core peers that accept the computed release and reject incompatible core versions", () => {
	const workspace = mkdtempSync(join(tmpdir(), "crust-core-peers-"));
	try {
		// Copy manifests, not source or node_modules. Versioning and pack hooks must never touch the checkout.
		const manifests = [
			"package.json",
			"tools/package.json",
			...new Bun.Glob("{apps,packages}/*/package.json").scanSync(repoRoot),
		];
		for (const path of [...manifests, "bun.lock", "LICENSE"]) {
			mkdirSync(dirname(join(workspace, path)), { recursive: true });
			copyFileSync(join(repoRoot, path), join(workspace, path));
		}
		mkdirSync(join(workspace, ".changeset"));
		// Keep the real release policy, but avoid GitHub changelog requests.
		writeFileSync(
			join(workspace, ".changeset/config.json"),
			JSON.stringify({ ...changesetConfig, changelog: false }),
		);
		// A fresh minor change still exercises versioning after the repository's pending changesets ship.
		writeFileSync(
			join(workspace, ".changeset/core-minor.md"),
			'---\n"@crustjs/core": minor\n---\n\nCore compatibility test.\n',
		);
		const previousCore = readVersion(join(workspace, "packages/core/package.json"));
		execFileSync(
			process.execPath,
			[fileURLToPath(import.meta.resolve("@changesets/cli/bin.js")), "version"],
			{
				cwd: workspace,
				stdio: "inherit",
			},
		);
		// Like packages:version, refresh Bun's workspace versions before packing.
		execFileSync(process.execPath, ["install", "--lockfile-only", "--ignore-scripts"], {
			cwd: workspace,
			stdio: "inherit",
		});
		const releasedCore = readVersion(join(workspace, "packages/core/package.json"));
		expect(releasedCore).not.toBe(previousCore);

		for (const name of corePeers) {
			const tarball = join(workspace, `${name}.tgz`);
			execFileSync(process.execPath, ["pm", "pack", "--filename", tarball], {
				cwd: join(workspace, "packages", name),
				stdio: "inherit",
			});
			const manifest: unknown = JSON.parse(
				execFileSync("tar", ["-xOf", tarball, "package/package.json"], { encoding: "utf8" }),
			);
			assertCorePeer(manifest);
			const range = manifest.peerDependencies["@crustjs/core"];
			expect(
				Bun.semver.satisfies(releasedCore, range),
				`${name}: ${range} accepts ${releasedCore}`,
			).toBe(true);
			for (const incompatibleCore of new Set([previousCore, "0.0.19"])) {
				expect(
					Bun.semver.satisfies(incompatibleCore, range),
					`${name}: ${range} rejects ${incompatibleCore}`,
				).toBe(false);
			}
		}
	} finally {
		rmSync(workspace, { recursive: true, force: true });
	}
}, 30000);
