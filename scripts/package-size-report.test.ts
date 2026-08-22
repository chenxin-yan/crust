import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testRoot = join(tmpdir(), `package-size-report-${process.pid}`);
const fixtureRoot = join(testRoot, "fixture");
const fakeBin = join(testRoot, "bin");
const installArgs = join(testRoot, "install-args.json");
const reportScript = join(import.meta.dir, "package-size-report.mjs");

beforeEach(() => {
	rmSync(testRoot, { recursive: true, force: true });
	mkdirSync(join(fixtureRoot, "packages", "fixture"), { recursive: true });
	mkdirSync(fakeBin, { recursive: true });
	writeFileSync(
		join(fixtureRoot, "packages", "fixture", "package.json"),
		JSON.stringify({ name: "@fixture/package", exports: {} }),
	);
	const npm = join(fakeBin, "npm");
	writeFileSync(
		npm,
		`#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
if (args[0] === "pack") {
	if (process.env.FAKE_NPM_ERROR) {
		console.log(JSON.stringify({ error: { code: process.env.FAKE_NPM_ERROR } }));
		process.exit(1);
	}
	console.log(JSON.stringify([{ size: 1, unpackedSize: 2 }]));
} else if (args[0] === "install") {
	writeFileSync(process.env.NPM_ARGS_FILE, JSON.stringify(args));
	const packageDir = join(process.cwd(), "node_modules", "@fixture", "package");
	mkdirSync(packageDir, { recursive: true });
	writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "@fixture/package", exports: {} }));
}
`,
	);
	chmodSync(npm, 0o755);
});

afterAll(() => rmSync(testRoot, { recursive: true, force: true }));

function run(errorCode?: string) {
	return Bun.spawnSync({
		cmd: [process.execPath, reportScript, "sizes-published", fixtureRoot],
		env: {
			...process.env,
			PATH: `${fakeBin}:${process.env.PATH}`,
			NPM_ARGS_FILE: installArgs,
			FAKE_NPM_ERROR: errorCode,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
}

describe("sizes-published", () => {
	it("only treats npm E404 responses as unpublished", () => {
		const notFound = run("E404");
		expect(notFound.exitCode).toBe(0);
		expect(JSON.parse(notFound.stdout.toString())).toEqual({});
		expect(run("E503").exitCode).not.toBe(0);
	});

	it("disables lifecycle scripts when installing published packages", () => {
		expect(run().exitCode).toBe(0);
		expect(JSON.parse(readFileSync(installArgs, "utf8"))).toContain("--ignore-scripts");
	});
});
