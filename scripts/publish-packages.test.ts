import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	chmodSync,
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
	copyFileSync(join(import.meta.dir, "publish-packages.mjs"), script);
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
		`#!${process.execPath}
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

afterEach(() => rmSync(root, { recursive: true, force: true }));

function run(env: Record<string, string> = {}, flags: string[] = []) {
	return Bun.spawnSync([process.execPath, script, "--publish-dir", artifacts, ...flags], {
		cwd: root,
		env: {
			...process.env,
			PATH: `${join(root, "bin")}:${process.env.PATH}`,
			REGISTRY: join(root, "registry.json"),
			CALLS: join(root, "calls.jsonl"),
			...env,
		},
		stdout: "pipe",
		stderr: "pipe",
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
	it("preflights the full cohort, resumes partial uploads, and succeeds when nothing remains", () => {
		const first = run({ FAIL_PACKAGE: "@fixture/platform-b" });
		expect(first.exitCode).not.toBe(0);
		expect(first.stderr.toString()).toContain("Upload failed: @fixture/platform-b");
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
		const retry = run();
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
		expect(run().exitCode).toBe(0);
		expect(calls().map((args) => args[0])).toEqual(["view", "view", "view", "view"]);
	});

	it.each(["E401", "ETIMEDOUT"])("aborts before upload when preflight returns %s", (code) => {
		const result = run({ VIEW_ERROR: code });
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain("Could not check @fixture/library@1.0.0");
		expect(calls().map((args) => args[0])).toEqual(["view"]);
	});

	it("rejects ambiguous successful preflight output", () => {
		const result = run({ EMPTY_VIEW: "1" });
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain("Inconclusive npm lookup");
		expect(calls().map((args) => args[0])).toEqual(["view"]);
	});

	it("preflights a dry run without uploading", () => {
		expect(run({}, ["--dry-run"]).exitCode).toBe(0);
		expect(calls().map((args) => args[0])).toEqual(["view", "view", "view", "view"]);
	});

	it("validates every artifact before any registry request", () => {
		rmSync(join(artifacts, "3.tgz"));
		symlinkSync(join(artifacts, "0.tgz"), join(artifacts, "3.tgz"));
		const result = run();
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain("Release artifact must be a regular file");
		expect(calls()).toEqual([]);
	});

	it("rejects escaped artifact paths and conflicting modes", () => {
		writeFileSync(
			join(artifacts, "packages.json"),
			JSON.stringify([{ name: "@fixture/library", version: "1.0.0", file: "../outside.tgz" }]),
		);
		const escaped = run();
		expect(escaped.exitCode).not.toBe(0);
		expect(escaped.stderr.toString()).toContain("Invalid release inventory");
		const conflicting = run({}, ["--pack-dir", artifacts]);
		expect(conflicting.exitCode).not.toBe(0);
		expect(conflicting.stderr.toString()).toContain("Choose --pack-dir");
		expect(calls()).toEqual([]);
	});
});
