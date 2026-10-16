import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { which } from "@crustjs/utils/process";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
	assertCompilerSatisfiesEngines,
	assertTargetsBuildableWithoutBun,
	type BuildCompiler,
	bunCompileTarget,
	DENO_PACKAGE_MIN_VERSION,
	resolveBinaryCompiler,
	resolveBunBuildRunner,
	resolveDenoPackageBundler,
} from "./compilers.ts";
import { BUN_TARGETS } from "./targets.ts";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("resolveBunBuildRunner", () => {
	it("prefers bun on PATH and falls back to this executable as bun", () => {
		const bun = which("bun")!;
		expect(resolveBunBuildRunner().command).toBe(bun);
		// Only a Bun process can stand in for bun, so observe the fallback inside real Bun with no PATH.
		const helpers = JSON.stringify(new URL("./compilers.ts", import.meta.url).href);
		const probe = spawnSync(
			bun,
			[
				"--eval",
				`import { resolveBunBuildRunner } from ${helpers};
const runner = resolveBunBuildRunner();
console.log(JSON.stringify({ command: runner.command, execPath: process.execPath, bunBeBun: runner.env.BUN_BE_BUN }));`,
			],
			{ env: { ...process.env, PATH: "" }, encoding: "utf8", timeout: 10_000 },
		);
		expect(probe.stderr).toBe("");
		expect(probe.status).toBe(0);
		const fallback = JSON.parse(probe.stdout) as Record<string, string>;
		expect(fallback.command).toBe(fallback.execPath);
		expect(fallback.bunBeBun).toBe("1");
	});

	it("refuses to stand in for bun from a non-Bun process such as Node running the library", () => {
		expect(resolveBunBuildRunner(false).command).toBe(which("bun")!);
		vi.stubEnv("PATH", "");
		expect(() => resolveBunBuildRunner(false)).toThrow("bun was not found on PATH");
	});
});

const bunVersion = spawnSync(which("bun")!, ["--version"], {
	encoding: "utf8",
	timeout: 10_000,
}).stdout.trim();

describe("assertCompilerSatisfiesEngines", () => {
	const compiler: BuildCompiler = {
		runtime: "bun",
		runner: { command: "/opt/bun/bin/bun", env: {} },
		version: "1.4.2",
	};
	const check = (userPackageJson: Parameters<typeof assertCompilerSatisfiesEngines>[1]) => () =>
		assertCompilerSatisfiesEngines(compiler, userPackageJson);

	it.each([
		["no engines", { name: "cli" }],
		["another runtime's engines only", { engines: { node: ">=99", deno: "not a range" } }],
		["a satisfied range", { engines: { bun: ">=1.4.0 <2" } }],
	])("accepts %s", (_label, userPackageJson) => {
		expect(check(userPackageJson)).not.toThrow();
	});

	it.each([["an unsatisfied range", ">=1.5.0"]])(
		"rejects %s without substituting another compiler",
		(_label, constraint) => {
			expect(check({ engines: { bun: constraint } })).toThrow(
				`Bun 1.4.2 (/opt/bun/bin/bun) does not satisfy package.json engines.bun "${constraint}".\n` +
					"  Binaries embed the selected compiler's Bun version; crust does not install or upgrade it.\n" +
					"  Put a matching bun first on PATH (e.g. with your version manager), or update package.json engines.bun.",
			);
		},
	);

	it.each(["latest", 1.4])("rejects the malformed constraint %j", (constraint) => {
		expect(check({ engines: { bun: constraint } })).toThrow(
			`package.json engines.bun is not a valid semver range: ${JSON.stringify(constraint)}.`,
		);
	});

	it("rejects engines that is not an object", () => {
		expect(check({ engines: "bun 1.4.2" })).toThrow(
			"package.json engines must be an object of runtime version ranges.",
		);
	});
});

describe("resolveBinaryCompiler", () => {
	it("selects bun on PATH and validates its actual version", async () => {
		const compiler = await resolveBinaryCompiler(
			"bun",
			{ engines: { bun: bunVersion } },
			process.cwd(),
		);
		expect(compiler).toMatchObject({ runtime: "bun", version: bunVersion });
		expect(compiler.runner.command).toBe(which("bun"));
		await expect(
			resolveBinaryCompiler("bun", { engines: { bun: "0.0.1" } }, process.cwd()),
		).rejects.toThrow(
			`Bun ${bunVersion} (${which("bun")}) does not satisfy package.json engines.bun "0.0.1".`,
		);
	});

	it("reports a missing deno instead of falling back to another compiler", async () => {
		vi.stubEnv("PATH", "");
		await expect(resolveBinaryCompiler("deno", {}, process.cwd())).rejects.toThrow(
			"Deno is required for the deno runtime but was not found on PATH.",
		);
	});
});

describe("resolveDenoPackageBundler", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	/** A deno stand-in that only answers `--version`, reporting `version`. */
	async function fakeDeno(version: string): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), "crust-fake-deno-"));
		tempDirs.push(directory);
		const line = `deno ${version} (stable, release, x86_64-unknown-linux-gnu)`;
		if (process.platform === "win32") {
			const command = join(directory, "deno.cmd");
			await writeFile(command, `@echo ${line}\r\n`);
			return command;
		}
		const command = join(directory, "deno");
		await writeFile(command, `#!/bin/sh\necho "${line}"\n`, { mode: 0o755 });
		return command;
	}

	it("accepts deno 2.5.0 and rejects the 2.4 bundler, reading the version in the project directory", async () => {
		const accepted = await fakeDeno("2.5.0");
		expect(
			await resolveDenoPackageBundler(process.cwd(), { command: accepted, env: process.env }),
		).toEqual({
			runtime: "deno",
			runner: { command: accepted, env: process.env },
			version: "2.5.0",
		});

		const old = await fakeDeno("2.4.5");
		await expect(
			resolveDenoPackageBundler(process.cwd(), { command: old, env: process.env }),
		).rejects.toThrow(
			`Deno 2.4.5 (${old}) cannot bundle a Deno runtime package; deno ${DENO_PACKAGE_MIN_VERSION} or newer is required.`,
		);
	});

	it("rejects a runner that does not report a Deno version", async () => {
		await expect(resolveDenoPackageBundler(process.cwd(), resolveBunBuildRunner())).rejects.toThrow(
			`Could not read the Deno version from ${which("bun")} --version (exit 0):\n${bunVersion}`,
		);
	});
});

const fallbackRunner = { command: process.execPath, env: { BUN_BE_BUN: "1" } };
const realBunRunner = { command: "/usr/local/bin/bun", env: {} };

describe("bunCompileTarget", () => {
	it("substitutes the -baseline alias only for the self-copy target under the fallback runner", () => {
		expect(bunCompileTarget("bun-linux-x64", fallbackRunner, "bun-linux-x64")).toBe(
			"bun-linux-x64-baseline",
		);
		expect(bunCompileTarget("bun-windows-x64", fallbackRunner, "bun-windows-x64")).toBe(
			"bun-windows-x64-baseline",
		);
		expect(bunCompileTarget("bun-darwin-arm64", fallbackRunner, "bun-linux-x64")).toBe(
			"bun-darwin-arm64",
		);
		expect(bunCompileTarget("bun-linux-x64", fallbackRunner, null)).toBe("bun-linux-x64");
	});

	it("passes the canonical target to a real bun", () => {
		expect(bunCompileTarget("bun-linux-x64", realBunRunner, "bun-linux-x64")).toBe("bun-linux-x64");
	});

	it("leaves an arm64 self-copy target alone; the guard refuses it earlier", () => {
		expect(bunCompileTarget("bun-darwin-arm64", fallbackRunner, "bun-darwin-arm64")).toBe(
			"bun-darwin-arm64",
		);
	});
});

describe("assertTargetsBuildableWithoutBun", () => {
	it("refuses the self-copying target and lists the remaining targets under the fallback runner", () => {
		expect(() =>
			assertTargetsBuildableWithoutBun(BUN_TARGETS.targets, fallbackRunner, "bun-darwin-arm64"),
		).toThrow(
			"Cannot build bun-darwin-arm64 without a separate bun executable on PATH.\n" +
				"  Bun reuses the running crust executable as the base for its own platform, which yields a binary that crashes on start.\n" +
				"  Install Bun (https://bun.sh), or pass --target with the other targets (e.g. --target bun-linux-x64 --target bun-linux-arm64 --target bun-linux-x64-musl --target bun-linux-arm64-musl --target bun-darwin-x64 --target bun-windows-x64 --target bun-windows-arm64).",
		);
		expect(() =>
			assertTargetsBuildableWithoutBun(
				["bun-linux-arm64-musl"],
				fallbackRunner,
				"bun-linux-arm64-musl",
			),
		).toThrow("Install Bun (https://bun.sh), or build a different target.");
	});

	it("keeps every other target buildable under the fallback runner", () => {
		expect(() =>
			assertTargetsBuildableWithoutBun(
				["bun-linux-x64", "bun-darwin-x64", "bun-windows-arm64"],
				fallbackRunner,
				"bun-darwin-arm64",
			),
		).not.toThrow();
		expect(() =>
			assertTargetsBuildableWithoutBun(BUN_TARGETS.targets, fallbackRunner, null),
		).not.toThrow();
	});

	it("allows an x64 self-copy target under the fallback runner because its -baseline alias is downloaded clean", () => {
		for (const host of [
			"bun-linux-x64",
			"bun-linux-x64-musl",
			"bun-darwin-x64",
			"bun-windows-x64",
		] as const) {
			expect(() =>
				assertTargetsBuildableWithoutBun(BUN_TARGETS.targets, fallbackRunner, host),
			).not.toThrow();
		}
	});

	it("judges the selected runner rather than looking up bun on PATH", () => {
		expect(which("bun")).not.toBeNull();
		expect(() =>
			assertTargetsBuildableWithoutBun(["bun-darwin-arm64"], fallbackRunner, "bun-darwin-arm64"),
		).toThrow("Cannot build bun-darwin-arm64 without a separate bun executable on PATH.");
		vi.stubEnv("PATH", "");
		expect(() =>
			assertTargetsBuildableWithoutBun(["bun-darwin-arm64"], realBunRunner, "bun-darwin-arm64"),
		).not.toThrow();
	});
});
