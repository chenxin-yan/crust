import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Crust } from "@crustjs/core";
import { buildCommand } from "../src/commands/build.ts";

const tmpDir = join(import.meta.dir, ".tmp-stage");
const originalCwd = process.cwd;

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function getHostTarget(): string | null {
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

	return null;
}

async function runBuild(argv: string[]) {
	const app = new Crust("test").command(buildCommand);
	process.cwd = () => tmpDir;
	await app.execute({ argv: ["build", ...argv] });
}

beforeAll(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	mkdirSync(join(tmpDir, "src"), { recursive: true });
	writeFileSync(
		join(tmpDir, "src", "cli.ts"),
		'console.log("hello from packaged test");\n',
	);
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
			"linux-x64",
			"--target",
			"darwin-arm64",
			"--stage-dir",
			".stage",
			"--no-validate",
		]);

		expect(
			existsSync(join(tmpDir, ".stage", "root", "bin", "test-cli.js")),
		).toBe(true);
		expect(existsSync(join(tmpDir, ".stage", "root", "bin", "test-cli"))).toBe(
			false,
		);
		expect(
			existsSync(join(tmpDir, ".stage", "root", "bin", "test-cli.cmd")),
		).toBe(false);
		expect(existsSync(join(tmpDir, ".stage", "linux-x64", "bin"))).toBe(true);
		expect(existsSync(join(tmpDir, ".stage", "darwin-arm64", "bin"))).toBe(
			true,
		);

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
		expect(manifest.publishOrder).toEqual([
			"linux-x64",
			"darwin-arm64",
			"root",
		]);
		expect(manifest.packages.map((pkg) => pkg.target)).toEqual([
			"linux-x64",
			"darwin-arm64",
		]);
	});

	it("stages only the selected target directories", async () => {
		await runBuild([
			"--package",
			"--target",
			"linux-x64",
			"--stage-dir",
			".subset",
			"--no-validate",
		]);

		expect(existsSync(join(tmpDir, ".subset", "root"))).toBe(true);
		expect(existsSync(join(tmpDir, ".subset", "linux-x64"))).toBe(true);
		expect(existsSync(join(tmpDir, ".subset", "darwin-arm64"))).toBe(false);
	});

	it.skipIf(getHostTarget() === null || !Bun.which("node"))(
		"executes the staged JS resolver through Node on the host platform",
		async () => {
			const hostTarget = getHostTarget();
			const nodePath = Bun.which("node");
			if (!hostTarget || !nodePath) return;

			await runBuild([
				"--package",
				"--target",
				hostTarget,
				"--stage-dir",
				".host",
				"--no-validate",
			]);

			cpSync(
				join(tmpDir, ".host", hostTarget),
				join(
					tmpDir,
					".host",
					"root",
					"node_modules",
					"@scope",
					`test-cli-${hostTarget}`,
				),
				{ recursive: true },
			);

			const resolverPath = join(tmpDir, ".host", "root", "bin", "test-cli.js");
			const proc = Bun.spawn([nodePath, resolverPath], {
				cwd: tmpDir,
				stdout: "pipe",
				stderr: "pipe",
			});

			const [exitCode, stdout, stderr] = await Promise.all([
				proc.exited,
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
			]);

			expect(exitCode).toBe(0);
			expect(stderr.trim()).toBe("");
			expect(stdout.trim()).toBe("hello from packaged test");
		},
	);
});
