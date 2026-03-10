import { afterAll, describe, expect, it } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Crust } from "@crustjs/core";
import { buildCommand } from "../src/commands/build.ts";

const packageManager = process.env.CRUST_SMOKE_PM;
const testRoot = join(
	tmpdir(),
	`crust-smoke-${packageManager ?? "skip"}-${Date.now()}`,
);
const sampleDir = join(testRoot, "sample");
const stageDir = join(sampleDir, "dist", "npm");
const installDir = join(testRoot, `install-${packageManager ?? "skip"}`);
const packDir = join(testRoot, "packs");

function resolveHostTarget(): string {
	if (process.platform === "darwin" && process.arch === "arm64") {
		return "darwin-arm64";
	}
	if (process.platform === "darwin" && process.arch === "x64") {
		return "darwin-x64";
	}
	if (process.platform === "linux" && process.arch === "arm64") {
		return "linux-arm64";
	}
	if (process.platform === "linux" && process.arch === "x64") {
		return "linux-x64";
	}
	if (process.platform === "win32" && process.arch === "arm64") {
		return "windows-arm64";
	}
	if (process.platform === "win32" && process.arch === "x64") {
		return "windows-x64";
	}

	throw new Error(
		`Unsupported smoke-test host: ${process.platform}-${process.arch}`,
	);
}

function hasCommand(command: string): boolean {
	return Bun.which(command) !== null;
}

async function run(
	command: string[],
	cwd: string,
	env?: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(command, {
		cwd,
		env: {
			...process.env,
			...env,
		},
		stdout: "pipe",
		stderr: "pipe",
	});

	return {
		exitCode: await proc.exited,
		stdout: await new Response(proc.stdout).text(),
		stderr: await new Response(proc.stderr).text(),
	};
}

async function stageSampleCli() {
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

	const app = new Crust("test").command(buildCommand);
	const originalCwd = process.cwd;
	process.cwd = () => sampleDir;
	try {
		await app.execute({
			argv: [
				"build",
				"--package",
				"--target",
				resolveHostTarget(),
				"--stage-dir",
				"dist/npm",
				"--no-validate",
			],
		});
	} finally {
		process.cwd = originalCwd;
	}
}

async function packStageDir(dir: string): Promise<string> {
	mkdirSync(packDir, { recursive: true });
	const packed = await run(["npm", "pack", dir], packDir);
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

describe("package manager smoke", () => {
	it("installs and runs the staged CLI through node_modules/.bin", async () => {
		if (!packageManager) {
			return;
		}

		if (!hasCommand(packageManager)) {
			throw new Error(`${packageManager} is required for this smoke test.`);
		}
		if (!hasCommand("npm")) {
			throw new Error(
				"npm is required to pack staged directories for smoke tests.",
			);
		}

		await stageSampleCli();
		const manifest = JSON.parse(
			readFileSync(join(stageDir, "manifest.json"), "utf-8"),
		) as {
			root: { name: string };
			packages: Array<{ name: string; dir: string }>;
		};
		const platformPackage = manifest.packages[0];
		if (!platformPackage) {
			throw new Error("Expected exactly one staged platform package.");
		}
		const rootTarball = await packStageDir(resolve(stageDir, "root"));
		const platformTarball = await packStageDir(
			resolve(stageDir, platformPackage.dir),
		);

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

		const installCommand =
			packageManager === "bun"
				? ["bun", "install"]
				: packageManager === "pnpm"
					? ["pnpm", "install"]
					: ["npm", "install"];

		const install = await run(installCommand, installDir);
		expect(install.exitCode).toBe(0);

		const launcherPath = join(
			installDir,
			"node_modules",
			"@scope",
			"resolver-smoke",
			"bin",
			"resolver-smoke",
		);
		const launcherSource = readFileSync(launcherPath, "utf-8");
		expect(launcherSource).not.toContain("usr/bin/env node");
		expect(launcherSource).not.toContain("require.resolve");

		const binPath = join(installDir, "node_modules", ".bin", "resolver-smoke");
		chmodSync(binPath, 0o755);
		const exec = await run([binPath, "smoke-ok"], installDir);
		expect(exec.exitCode).toBe(0);
		expect(exec.stdout.trim()).toContain("smoke-ok");
	}, 30000);
});
