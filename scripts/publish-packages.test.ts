import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
	reapBoundedProcesses,
	runBoundedProcess,
} from "../packages/crust/tests/bounded-process.ts";

let root: string;
let artifacts: string;
let script: string;
const names = ["@fixture/library", "@fixture/platform-a", "@fixture/platform-b", "@fixture/cli"];

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "crust-publisher-test-"));
	artifacts = join(root, "artifacts");
	mkdirSync(artifacts);
	mkdirSync(join(root, "bin"));
	script = join(root, "publish-packages.mjs");
	// Upload must work without workspace source, staging trees, or node_modules.
	copyFileSync(join(import.meta.dirname, "publish-packages.mjs"), script);
	writeFileSync(join(root, "registry.json"), "[]");
	writeFileSync(join(root, "calls.jsonl"), "");
	const packages = names.map((name, index) => {
		const file = `${index}.tgz`;
		writeFileSync(join(artifacts, file), name);
		return { name, version: "1.0.0", file };
	});
	writeFileSync(join(artifacts, "packages.json"), JSON.stringify(packages));
	const npm = join(root, "bin", "npm");
	writeFileSync(
		npm,
		`#!/usr/bin/env bun
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.CALLS, JSON.stringify(args) + "\\n");
const published = JSON.parse(readFileSync(process.env.REGISTRY, "utf8"));
if (args[0] === "view") {
	if (process.env.VIEW_ERROR) {
		console.log(JSON.stringify({ error: { code: process.env.VIEW_ERROR } }));
		process.exit(1);
	}
	if (process.env.EMPTY_VIEW) process.exit(0);
	if (published.includes(args[1].replace(/@1\\.0\\.0$/, ""))) {
		console.log(JSON.stringify("1.0.0"));
	} else {
		console.log(JSON.stringify({ error: { code: "E404" } }));
		process.exit(1);
	}
} else if (args[0] === "publish") {
	const name = readFileSync(args[1], "utf8");
	if (name === process.env.FAIL_PACKAGE) {
		console.error("Upload failed: " + name);
		process.exit(1);
	}
	published.push(name);
	writeFileSync(process.env.REGISTRY, JSON.stringify(published));
} else {
	throw new Error("Unexpected npm operation: " + args[0]);
}
`,
	);
	chmodSync(npm, 0o755);
});

afterEach(async () => {
	await reapBoundedProcesses();
	rmSync(root, { recursive: true, force: true });
});

function run(env: Record<string, string> = {}, flags: string[] = []) {
	return runBoundedProcess("bun", [script, "--publish-dir", artifacts, ...flags], {
		cwd: root,
		env: {
			...process.env,
			PATH: `${join(root, "bin")}:${process.env.PATH}`,
			REGISTRY: join(root, "registry.json"),
			CALLS: join(root, "calls.jsonl"),
			...env,
		},
		timeout: 4_000,
	});
}

function calls(): string[][] {
	return readFileSync(join(root, "calls.jsonl"), "utf8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

describe("repository release upload", () => {
	it("preflights the full cohort, resumes partial uploads, and succeeds when nothing remains", async () => {
		const first = await run({ FAIL_PACKAGE: "@fixture/platform-b" });
		expect(first.exitCode).not.toBe(0);
		expect(first.stderr).toContain("Upload failed: @fixture/platform-b");
		expect(calls().map((args) => args[0])).toEqual([
			"view",
			"view",
			"view",
			"view",
			"publish",
			"publish",
			"publish",
		]);
		expect(JSON.parse(readFileSync(join(root, "registry.json"), "utf8"))).toEqual(
			names.slice(0, 2),
		);

		writeFileSync(join(root, "calls.jsonl"), "");
		const retry = await run();
		expect(retry.exitCode).toBe(0);
		const uploads = calls().filter((args) => args[0] === "publish");
		expect(uploads.map((args) => args[1])).toEqual([
			join(artifacts, "2.tgz"),
			join(artifacts, "3.tgz"),
		]);
		for (const args of uploads) {
			expect(args).toContain("--ignore-scripts");
			expect(args).toContain("--registry=https://registry.npmjs.org");
			expect(args).toContain("--@fixture:registry=https://registry.npmjs.org");
		}
		expect(JSON.parse(readFileSync(join(root, "registry.json"), "utf8"))).toEqual(names);

		writeFileSync(join(root, "calls.jsonl"), "");
		expect((await run()).exitCode).toBe(0);
		expect(calls().map((args) => args[0])).toEqual(["view", "view", "view", "view"]);
	});

	it.each(["E401", "ETIMEDOUT"])("aborts before upload when preflight returns %s", async (code) => {
		const result = await run({ VIEW_ERROR: code });
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("Could not check @fixture/library@1.0.0");
		expect(calls().map((args) => args[0])).toEqual(["view"]);
	});

	it("rejects ambiguous successful preflight output", async () => {
		const result = await run({ EMPTY_VIEW: "1" });
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("Inconclusive npm lookup");
		expect(calls().map((args) => args[0])).toEqual(["view"]);
	});

	it("preflights a dry run without uploading", async () => {
		expect((await run({}, ["--dry-run"])).exitCode).toBe(0);
		expect(calls().map((args) => args[0])).toEqual(["view", "view", "view", "view"]);
	});

	it("validates every artifact before any registry request", async () => {
		rmSync(join(artifacts, "3.tgz"));
		symlinkSync(join(artifacts, "0.tgz"), join(artifacts, "3.tgz"));
		const result = await run();
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("Release artifact must be a regular file");
		expect(calls()).toEqual([]);
	});

	it("rejects escaped artifact paths and conflicting modes", async () => {
		writeFileSync(
			join(artifacts, "packages.json"),
			JSON.stringify([{ name: "@fixture/library", version: "1.0.0", file: "../outside.tgz" }]),
		);
		const escaped = await run();
		expect(escaped.exitCode).not.toBe(0);
		expect(escaped.stderr).toContain("Invalid release inventory");
		const conflicting = await run({}, ["--pack-dir", artifacts]);
		expect(conflicting.exitCode).not.toBe(0);
		expect(conflicting.stderr).toContain("Choose --pack-dir");
		expect(calls()).toEqual([]);
	});
});

type PackageManifest = {
	name: string;
	version?: string;
	private?: boolean;
	dependencies?: Record<string, string>;
	scripts?: Record<string, string>;
};

describe("repository release pack", () => {
	it("packs public pnpm workspace packages in dependency order with lifecycle LICENSE files", async () => {
		const workspace = join(root, "workspace");
		const pack = join(root, "pack");
		const writeJson = (path: string, manifest: PackageManifest) => {
			mkdirSync(join(path, ".."), { recursive: true });
			writeFileSync(path, JSON.stringify(manifest));
		};
		mkdirSync(join(workspace, "scripts"), { recursive: true });
		copyFileSync(script, join(workspace, "scripts", "publish-packages.mjs"));
		mkdirSync(join(workspace, "packages", "crust", "src", "commands"), { recursive: true });
		writeFileSync(join(workspace, "packages", "crust", "src", "commands", "publish.ts"), "");
		writeFileSync(join(workspace, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
		writeFileSync(join(workspace, "LICENSE"), "fixture license");
		writeJson(join(workspace, "package.json"), { name: "fixture-root", private: true });
		const scripts = { prepack: "cp ../../LICENSE LICENSE", postpack: "rm -f LICENSE" };
		writeJson(join(workspace, "packages", "lib", "package.json"), {
			name: "@fixture/lib",
			version: "1.0.0",
			scripts,
		});
		writeJson(join(workspace, "packages", "app", "package.json"), {
			name: "@fixture/app",
			version: "1.0.0",
			dependencies: { "@fixture/lib": "workspace:^" },
			scripts,
		});
		writeJson(join(workspace, "packages", "private", "package.json"), {
			name: "@fixture/private",
			private: true,
		});

		// pnpm pack resolves workspace: ranges from the installed workspace.
		const install = await runBoundedProcess("pnpm", ["install"], {
			cwd: workspace,
			timeout: 4_000,
		});
		expect(install.exitCode, install.stderr).toBe(0);
		const result = await runBoundedProcess(
			"bun",
			[join(workspace, "scripts", "publish-packages.mjs"), "--pack-dir", pack],
			{ cwd: workspace, timeout: 4_000 },
		);
		expect(result.exitCode, result.stderr).toBe(0);
		expect(JSON.parse(readFileSync(join(pack, "packages.json"), "utf8"))).toEqual([
			{ name: "@fixture/lib", version: "1.0.0", file: "0.tgz" },
			{ name: "@fixture/app", version: "1.0.0", file: "1.tgz" },
		]);
		const extracted = join(root, "extracted");
		mkdirSync(extracted);
		const untar = await runBoundedProcess("tar", ["-xzf", join(pack, "1.tgz"), "-C", extracted], {
			timeout: 4_000,
		});
		expect(untar.exitCode).toBe(0);
		expect(readFileSync(join(extracted, "package", "LICENSE"), "utf8")).toBe("fixture license");
		// pnpm strips publish-lifecycle scripts from packed manifests by default.
		expect(JSON.parse(readFileSync(join(extracted, "package", "package.json"), "utf8"))).toEqual({
			name: "@fixture/app",
			version: "1.0.0",
			dependencies: { "@fixture/lib": "^1.0.0" },
			scripts: {},
		});
		expect(existsSync(join(workspace, "packages", "app", "LICENSE"))).toBe(false);
	});
});
