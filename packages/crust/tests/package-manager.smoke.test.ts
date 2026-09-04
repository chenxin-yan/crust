import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Crust } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { runProcess } from "@crustjs/utils/process";

import { buildCommand } from "../src/commands/build.ts";
import { hostTarget } from "./helpers.ts";

const packageManager = process.env.CRUST_SMOKE_PM;
const testRoot = mkdtempSync(join(tmpdir(), `crust-smoke-${packageManager ?? "skip"}-`));
const sampleDir = join(testRoot, "sample");
const stageDir = join(sampleDir, "dist", "npm");
const installDir = join(testRoot, `install-${packageManager ?? "skip"}`);
const packDir = join(testRoot, "packs");

function hasCommand(command: string): boolean {
	return Bun.which(command) !== null;
}

async function stageSampleCli() {
	const target = hostTarget();
	if (!target) throw new Error(`Unsupported smoke-test host: ${process.platform}-${process.arch}`);
	rmSync(testRoot, { recursive: true, force: true });
	mkdirSync(join(sampleDir, "src"), { recursive: true });
	writeFileSync(
		join(sampleDir, "src", "cli.ts"),
		`const args = process.argv.slice(2);
console.log(args.join(" ") || "resolver-ok");
`,
	);
	writeFileSync(
		join(sampleDir, "package.json"),
		JSON.stringify(
			{
				name: "@scope/resolver-smoke",
				version: "0.0.1",
				bin: {
					"resolver-smoke": "dist/cli",
				},
			},
			null,
			2,
		),
	);

	const app = new Crust("test").add(buildCommand);
	const originalCwd = process.cwd;
	process.cwd = () => sampleDir;
	try {
		const result = await captureExecute(app, [
			"build",
			"--package",
			"--target",
			target,
			"--stage-dir",
			"dist/npm",
			"--no-validate",
		]);
		if (result.exitCode !== 0) throw new Error(result.stderr);
	} finally {
		process.cwd = originalCwd;
	}
}

async function packStageDir(dir: string): Promise<string> {
	mkdirSync(packDir, { recursive: true });
	const packed = await runProcess("npm", ["pack", dir], { cwd: packDir });
	if (packed.exitCode !== 0) {
		throw new Error(`npm pack failed for ${dir}\n${packed.stderr}`);
	}

	const filename = packed.stdout.trim().split("\n").at(-1);
	if (!filename) {
		throw new Error(`npm pack did not return a tarball name for ${dir}`);
	}

	return join(packDir, filename);
}

afterAll(() => {
	rmSync(testRoot, { recursive: true, force: true });
});

describe.skipIf(!packageManager)("package manager smoke", () => {
	it("installs and runs the staged CLI through node_modules/.bin", async () => {
		if (!hasCommand(packageManager!)) {
			throw new Error(`${packageManager} is required for this smoke test.`);
		}
		if (!hasCommand("npm")) {
			throw new Error("npm is required to pack staged directories for smoke tests.");
		}

		await stageSampleCli();
		const manifest = JSON.parse(readFileSync(join(stageDir, "manifest.json"), "utf-8")) as {
			root: { name: string };
			packages: Array<{ name: string; dir: string }>;
		};
		const platformPackage = manifest.packages[0];
		if (!platformPackage) {
			throw new Error("Expected exactly one staged platform package.");
		}
		const rootTarball = await packStageDir(resolve(stageDir, "root"));
		const platformTarball = await packStageDir(resolve(stageDir, platformPackage.dir));

		mkdirSync(installDir, { recursive: true });
		writeFileSync(
			join(installDir, "package.json"),
			JSON.stringify(
				{
					name: `install-${packageManager}`,
					private: true,
					dependencies: {
						[manifest.root.name]: `file:${rootTarball}`,
						[platformPackage.name]: `file:${platformTarball}`,
					},
				},
				null,
				2,
			),
		);

		// Audit/funding lookups hit registry endpoints the smoke test does not need;
		// when they degrade, npm blocks on them and the test times out.
		const auditFlags = packageManager === "npm" ? ["--no-audit", "--no-fund"] : [];
		const install = await runProcess(packageManager!, ["install", ...auditFlags], {
			cwd: installDir,
		});
		expect(install.exitCode).toBe(0);

		const binPath = join(installDir, "node_modules", ".bin", "resolver-smoke");
		chmodSync(binPath, 0o755);
		const exec = await runProcess(binPath, ["smoke-ok"], { cwd: installDir });
		expect(exec.exitCode).toBe(0);
		expect(exec.stdout.trim()).toContain("smoke-ok");
	}, 30000);
});
