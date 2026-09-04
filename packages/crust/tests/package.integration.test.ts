import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust } from "@crustjs/core";
import { runProcess } from "@crustjs/utils/process";

import { buildCommand } from "../src/commands/build.ts";
import { TARGET_INFO } from "../src/utils/build-helpers.ts";
import { hostTarget } from "./helpers.ts";

const tmpDir = mkdtempSync(join(tmpdir(), "crust-package-integration-"));
const originalCwd = process.cwd;

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf-8")) as T;
}

async function runBuild(argv: string[]) {
	const app = new Crust("test").add(buildCommand);
	process.cwd = () => tmpDir;
	await app.execute({ argv: ["build", ...argv] });
}

beforeAll(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	mkdirSync(join(tmpDir, "src"), { recursive: true });
	writeFileSync(join(tmpDir, "src", "cli.ts"), 'console.log("hello from packaged test");\n');
	writeFileSync(
		join(tmpDir, "package.json"),
		JSON.stringify(
			{
				name: "@scope/test-cli",
				version: "0.1.0",
				bin: {
					"test-cli": "dist/cli",
				},
			},
			null,
			2,
		),
	);
});

afterAll(() => {
	process.cwd = originalCwd;
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("crust build --package integration", () => {
	it("stages root and platform packages with a JS resolver", async () => {
		await runBuild([
			"--package",
			"--target",
			"bun-linux-x64-baseline",
			"--target",
			"bun-darwin-arm64",
			"--stage-dir",
			".stage",
			"--no-validate",
		]);

		expect(existsSync(join(tmpDir, ".stage", "root", "bin", "test-cli.js"))).toBe(true);
		expect(existsSync(join(tmpDir, ".stage", "root", "bin", "test-cli"))).toBe(false);
		expect(existsSync(join(tmpDir, ".stage", "root", "bin", "test-cli.cmd"))).toBe(false);
		expect(existsSync(join(tmpDir, ".stage", "linux-x64", "bin"))).toBe(true);
		expect(existsSync(join(tmpDir, ".stage", "darwin-arm64", "bin"))).toBe(true);

		const rootPackageJson = readJson<{ bin: Record<string, string> }>(
			join(tmpDir, ".stage", "root", "package.json"),
		);
		expect(rootPackageJson.bin["test-cli"]).toBe("bin/test-cli.js");

		const manifest = readJson<{
			version: string;
			publishOrder: string[];
			packages: Array<{ target: string; dir: string }>;
		}>(join(tmpDir, ".stage", "manifest.json"));
		expect(manifest.version).toBe("0.1.0");
		expect(manifest.publishOrder).toEqual(["linux-x64", "darwin-arm64", "root"]);
		expect(manifest.packages.map((pkg) => pkg.target)).toEqual(["linux-x64", "darwin-arm64"]);
	}, 15_000);

	it("stages only the selected target directories", async () => {
		await runBuild([
			"--package",
			"--target",
			"bun-linux-x64-baseline",
			"--stage-dir",
			".subset",
			"--no-validate",
		]);

		expect(existsSync(join(tmpDir, ".subset", "root"))).toBe(true);
		expect(existsSync(join(tmpDir, ".subset", "linux-x64"))).toBe(true);
		expect(existsSync(join(tmpDir, ".subset", "darwin-arm64"))).toBe(false);
	});

	it.skipIf(hostTarget() === null || !Bun.which("node"))(
		"executes the staged JS resolver through Node on the host platform",
		async () => {
			const hostBunTarget = hostTarget();
			const nodePath = Bun.which("node");
			if (!hostBunTarget || !nodePath) return;
			const hostAlias = TARGET_INFO[hostBunTarget].alias;

			await runBuild([
				"--package",
				"--target",
				hostBunTarget,
				"--stage-dir",
				".host",
				"--no-validate",
			]);

			cpSync(
				join(tmpDir, ".host", hostAlias),
				join(
					tmpDir,
					".host",
					"root",
					"node_modules",
					// Scoped package names split into @scope/name path segments here,
					// matching resolver candidateTwo's resolve(..., target.packageName, ...).
					"@scope",
					`test-cli-${hostAlias}`,
				),
				{ recursive: true },
			);

			const resolverPath = join(tmpDir, ".host", "root", "bin", "test-cli.js");
			const { exitCode, stdout, stderr } = await runProcess(nodePath, [resolverPath], {
				cwd: tmpDir,
			});

			expect(exitCode).toBe(0);
			expect(stderr.trim()).toBe("");
			expect(stdout.trim()).toBe("hello from packaged test");
		},
	);
});
