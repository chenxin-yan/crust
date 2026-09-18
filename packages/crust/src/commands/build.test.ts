import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Crust } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";

const corePath = fileURLToPath(import.meta.resolve("@crustjs/core"));

import {
	BUN_TARGETS,
	bunBaselineAlias,
	DENO_TARGETS,
	hostTarget,
	resolveTargets,
} from "../utils/build-helpers.ts";
import { type BuildFlags, buildCommand, planBuild, resolveEnvFilePaths } from "./build.ts";

describe("env file helpers", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "crust-env-files-"));

	beforeAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
		mkdirSync(tmpDir, { recursive: true });
		writeFileSync(join(tmpDir, ".env"), "PUBLIC_FOO=bar\n");
		writeFileSync(join(tmpDir, ".env.local"), "PUBLIC_BAR=baz\n");
	});

	afterAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("resolves env-file paths relative to cwd", () => {
		expect(resolveEnvFilePaths(tmpDir, [".env", ".env.local"])).toEqual([
			join(tmpDir, ".env"),
			join(tmpDir, ".env.local"),
		]);
	});

	it("throws when an env-file is missing", () => {
		expect(() => resolveEnvFilePaths(tmpDir, [".env.missing"])).toThrow(/Env file not found/);
	});
});

describe("planBuild", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "crust-build-plan-"));
	const baseFlags: BuildFlags = { entry: "src/cli.ts", validate: true };

	beforeAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		writeFileSync(join(tmpDir, "src", "cli.ts"), "export {};\n");
		writeFileSync(join(tmpDir, ".env"), "PUBLIC_TEST=1\n");
	});

	afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));
	afterEach(() => rmSync(join(tmpDir, "package.json"), { force: true }));

	it("defaults to Bun without project configuration", () => {
		expect(planBuild(baseFlags, tmpDir)).toMatchObject({
			runtime: "bun",
			runtimeSource: "default",
		});
	});

	it("reads package.json crust.runtime and lets --runtime override it", () => {
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ crust: { runtime: "deno" } }));
		expect(planBuild(baseFlags, tmpDir)).toMatchObject({
			runtime: "deno",
			runtimeSource: "from package.json",
		});
		expect(planBuild({ ...baseFlags, runtime: "node" }, tmpDir)).toMatchObject({
			runtime: "node",
			runtimeSource: "from --runtime",
		});
	});

	it("infers the runtime from deno.json or @types/node, never from lockfiles", () => {
		const nodeTypes = { devDependencies: { "@types/node": "^22" } };
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify(nodeTypes));
		expect(planBuild(baseFlags, tmpDir)).toMatchObject({
			runtime: "node",
			runtimeSource: "inferred from @types/node",
		});
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ dependencies: { "@types/node": "^22" } }),
		);
		expect(planBuild(baseFlags, tmpDir).runtime).toBe("node");
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ devDependencies: { "@types/node": "^22", "@types/bun": "^1" } }),
		);
		expect(planBuild(baseFlags, tmpDir)).toMatchObject({
			runtime: "bun",
			runtimeSource: "default",
		});

		writeFileSync(join(tmpDir, "bun.lock"), "");
		writeFileSync(join(tmpDir, "deno.jsonc"), "{}");
		try {
			// deno.json wins over @types/node; the lockfile is not a signal.
			writeFileSync(join(tmpDir, "package.json"), JSON.stringify(nodeTypes));
			expect(planBuild(baseFlags, tmpDir)).toMatchObject({
				runtime: "deno",
				runtimeSource: "inferred from deno.jsonc",
			});
			// Explicit configuration beats inference.
			writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ crust: { runtime: "bun" } }));
			expect(planBuild(baseFlags, tmpDir)).toMatchObject({
				runtime: "bun",
				runtimeSource: "from package.json",
			});
			rmSync(join(tmpDir, "package.json"));
			expect(planBuild(baseFlags, tmpDir).runtime).toBe("deno");
		} finally {
			rmSync(join(tmpDir, "bun.lock"));
			rmSync(join(tmpDir, "deno.jsonc"));
		}
	});

	it("rejects an invalid configured runtime", () => {
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ crust: { runtime: "python" } }));
		expect(() => planBuild(baseFlags, tmpDir)).toThrow(/Invalid package.json crust.runtime/);
	});

	it("uses one parse-error policy for runtime and output-name resolution", () => {
		writeFileSync(join(tmpDir, "package.json"), "not json");
		expect(() => planBuild(baseFlags, tmpDir)).toThrow(`Failed to parse package.json in ${tmpDir}`);
	});

	for (const testCase of [
		{
			name: "Node builds with targets",
			flags: { runtime: "node", target: ["bun-linux-x64"] },
			error: "--target cannot be used with --runtime node",
		},
		{
			name: "minified Deno builds",
			flags: { runtime: "deno", minify: true },
			error: "--minify is not supported with --runtime deno",
		},
		{
			name: "Deno builds with env files",
			flags: { runtime: "deno", "env-file": [".env"] },
			error: "--env-file is not supported with --runtime deno",
		},
		{
			name: "multi-target builds with outfile",
			flags: { outfile: "out/cli", target: ["bun-linux-x64", "bun-darwin-arm64"] },
			error: "--outfile builds exactly one target",
		},
		{
			name: "Deno builds with Bun bundler plugins",
			flags: { runtime: "deno", "bun-plugin": ["@opentui/solid/bun-plugin"] },
			error: "--bun-plugin is not supported with --runtime deno",
		},
	] as const) {
		it(`rejects ${testCase.name}`, () => {
			expect(() => planBuild({ ...baseFlags, ...testCase.flags } as BuildFlags, tmpDir)).toThrow(
				testCase.error,
			);
		});
	}

	it("keeps --bun-plugin specifiers in order and defaults to none", () => {
		expect(planBuild(baseFlags, tmpDir).bunPlugins).toEqual([]);
		expect(
			planBuild(
				{ ...baseFlags, "bun-plugin": ["./plugins/second.ts", "@opentui/solid/bun-plugin"] },
				tmpDir,
			).bunPlugins,
		).toEqual(["./plugins/second.ts", "@opentui/solid/bun-plugin"]);
		expect(
			planBuild({ ...baseFlags, runtime: "node", "bun-plugin": ["./plugin.ts"] }, tmpDir),
		).toMatchObject({ runtime: "node", bunPlugins: ["./plugin.ts"] });
	});

	// Only arm64 hosts hit the self-copy refusal; x64 hosts compile their own
	// target through its -baseline alias, which Bun downloads clean.
	const host = hostTarget(BUN_TARGETS);
	const hostHasAlias = host !== null && bunBaselineAlias(host) !== null;

	it.skipIf(host === null || hostHasAlias)(
		"refuses the host target before planning outputs when bun is not on PATH",
		() => {
			const path = process.env.PATH;
			process.env.PATH = "";
			try {
				expect(() => planBuild(baseFlags, tmpDir)).toThrow(
					`Cannot build ${host} without a separate bun executable on PATH`,
				);
				expect(planBuild({ ...baseFlags, target: ["bun-linux-x64"] }, tmpDir).runtime).toBe("bun");
			} finally {
				process.env.PATH = path;
			}
		},
	);

	it.skipIf(!hostHasAlias)("plans every target when bun is not on PATH on an x64 host", () => {
		const path = process.env.PATH;
		process.env.PATH = "";
		try {
			const plan = planBuild(baseFlags, tmpDir);
			expect(plan.runtime === "bun" && "targets" in plan && plan.targets.length).toBe(
				BUN_TARGETS.targets.length,
			);
		} finally {
			process.env.PATH = path;
		}
	});

	it("stages .crust for every runtime by default", () => {
		const stageDir = resolve(tmpDir, ".crust");
		const outDir = resolve(stageDir, "artifacts");
		expect(planBuild({ ...baseFlags, target: ["bun-linux-x64"] }, tmpDir)).toMatchObject({
			runtime: "bun",
			targets: ["bun-linux-x64"],
			stageDir,
			outDir,
		});
		expect(planBuild({ ...baseFlags, runtime: "deno" }, tmpDir)).toMatchObject({
			runtime: "deno",
			targets: [...DENO_TARGETS.targets],
			minify: false,
			stageDir,
		});
		expect(() =>
			planBuild({ ...baseFlags, runtime: "deno", target: ["linux-x64"] }, tmpDir),
		).toThrow('Unknown Deno target "linux-x64"');
		const nodePlan = planBuild(
			{ ...baseFlags, runtime: "node", "bun-plugin": ["./plugin.ts"] },
			tmpDir,
		);
		expect(nodePlan).toMatchObject({
			runtime: "node",
			minify: true,
			bunPlugins: ["./plugin.ts"],
			stageDir,
		});
		expect(nodePlan).not.toHaveProperty("targets");
		expect(nodePlan).not.toHaveProperty("outfilePath");
	});

	it("plans one exact --outfile artifact without staging", () => {
		const outDir = resolve(tmpDir, ".crust", "artifacts");
		const nodePlan = planBuild({ ...baseFlags, runtime: "node", outfile: "out/cli.js" }, tmpDir);
		expect(nodePlan).toMatchObject({
			runtime: "node",
			outfilePath: resolve(tmpDir, "out", "cli.js"),
			outDir,
		});
		expect(nodePlan).not.toHaveProperty("stageDir");

		expect(
			planBuild({ ...baseFlags, outfile: "out/cli", target: ["bun-windows-x64"] }, tmpDir),
		).toMatchObject({
			runtime: "bun",
			target: "bun-windows-x64",
			outfilePath: resolve(tmpDir, "out", "cli.exe"),
		});
		expect(
			planBuild({ ...baseFlags, outfile: "out/cli.exe", target: ["bun-windows-x64"] }, tmpDir),
		).toMatchObject({ outfilePath: resolve(tmpDir, "out", "cli.exe") });
		expect(
			planBuild(
				{ ...baseFlags, runtime: "deno", outfile: "out/cli", target: ["aarch64-apple-darwin"] },
				tmpDir,
			),
		).toMatchObject({ runtime: "deno", target: "aarch64-apple-darwin", minify: false });
	});

	it.skipIf(host === null)("defaults --outfile to the host target", () => {
		expect(planBuild({ ...baseFlags, outfile: "out/cli" }, tmpDir)).toMatchObject({
			runtime: "bun",
			target: host,
		});
		const denoHost = hostTarget(DENO_TARGETS);
		if (denoHost !== null) {
			expect(
				planBuild({ ...baseFlags, runtime: "deno", outfile: "out/cli" }, tmpDir),
			).toMatchObject({ runtime: "deno", target: denoHost });
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Unit tests for resolveTarget
// ────────────────────────────────────────────────────────────────────────────

describe("resolveTarget", () => {
	it("accepts full Bun target names directly", () => {
		for (const target of BUN_TARGETS.targets) {
			expect(resolveTargets(BUN_TARGETS, [target])[0]).toBe(target);
		}
	});

	it("rejects every short alias with canonical-name guidance and a did-you-mean hint", () => {
		for (const target of BUN_TARGETS.targets) {
			const alias = BUN_TARGETS.info[target].alias;
			expect(() => resolveTargets(BUN_TARGETS, [alias])).toThrow(
				`Unknown target "${alias}". Targets must use canonical Bun names. Did you mean "${target}"?`,
			);
			expect(() => resolveTargets(BUN_TARGETS, [alias])).toThrow(/Valid targets: bun-linux-x64/);
		}
	});

	it("throws on unknown target", () => {
		expect(() => resolveTargets(BUN_TARGETS, ["linux-arm32"])).toThrow(/Unknown target/);
	});
});

describe("resolveDenoTarget", () => {
	it("accepts exactly the targets supported by deno compile", () => {
		for (const target of DENO_TARGETS.targets)
			expect(resolveTargets(DENO_TARGETS, [target])[0]).toBe(target);
		expect(resolveTargets(DENO_TARGETS, undefined)).toEqual([...DENO_TARGETS.targets]);
	});

	it("guides aliases to canonical Deno target names", () => {
		for (const target of DENO_TARGETS.targets) {
			expect(() => resolveTargets(DENO_TARGETS, [DENO_TARGETS.info[target].alias])).toThrow(
				`Did you mean "${target}"?`,
			);
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Error handling tests
// ────────────────────────────────────────────────────────────────────────────

async function executeBuildError(name: string, argv: string[]): Promise<string> {
	const originalCwd = process.cwd;
	const tmpDir = mkdtempSync(join(tmpdir(), `crust-${name}-`));
	rmSync(tmpDir, { recursive: true, force: true });
	mkdirSync(join(tmpDir, "src"), { recursive: true });
	writeFileSync(join(tmpDir, "src", "cli.ts"), "console.log('hi');");
	process.cwd = () => tmpDir;
	try {
		return (await captureExecute(new Crust("test").add(buildCommand), ["build", ...argv])).stderr;
	} finally {
		process.cwd = originalCwd;
		rmSync(tmpDir, { recursive: true, force: true });
	}
}

describe("buildCommand error handling", () => {
	it("rejects unsupported runtime and flag combinations before compiling", async () => {
		expect(
			await executeBuildError("node-target", [
				"--runtime",
				"node",
				"--target",
				"bun-linux-x64",
				"--no-validate",
			]),
		).toContain("--target cannot be used with --runtime node");
		expect(
			await executeBuildError("deno-minify", ["--runtime", "deno", "--minify", "--no-validate"]),
		).toContain("--minify is not supported with --runtime deno");
		const envDir = mkdtempSync(join(tmpdir(), "crust-deno-env-file-"));
		const envFile = join(envDir, ".env");
		writeFileSync(envFile, "SECRET=x\n");
		try {
			expect(
				await executeBuildError("deno-env-file", [
					"--runtime",
					"deno",
					"--env-file",
					envFile,
					"--no-validate",
				]),
			).toContain("--env-file is not supported with --runtime deno");
		} finally {
			rmSync(envDir, { recursive: true, force: true });
		}
		expect(
			await executeBuildError("deno-bun-plugin", [
				"--runtime",
				"deno",
				"--bun-plugin",
				"@opentui/solid/bun-plugin",
				"--no-validate",
			]),
		).toContain("--bun-plugin is not supported with --runtime deno");
	});
	it("sets exitCode and logs error when entry file is missing", async () => {
		const originalCwd = process.cwd;
		const tmpDir = mkdtempSync(join(tmpdir(), "crust-missing-entry-"));
		mkdirSync(tmpDir, { recursive: true });

		process.cwd = () => tmpDir;

		try {
			const result = await captureExecute(new Crust("test").add(buildCommand), [
				"build",
				"--entry",
				"nonexistent.ts",
				"--target",
				"bun-linux-x64",
			]);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("Entry file not found");
		} finally {
			process.cwd = originalCwd;
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("rejects --outfile with more than one --target", async () => {
		expect(
			await executeBuildError("outfile-multi-target", [
				"--outfile",
				"./out",
				"--target",
				"bun-linux-x64",
				"--target",
				"bun-darwin-arm64",
				"--no-validate",
			]),
		).toContain("--outfile builds exactly one target");
	});

	it("writes Extension build artifacts to .crust/artifacts for an --outfile build", async () => {
		const originalCwd = process.cwd;
		const tmpDir = mkdtempSync(join(tmpdir(), "crust-outfile-artifacts-"));
		rmSync(tmpDir, { recursive: true, force: true });
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		writeFileSync(
			join(tmpDir, "src", "cli.ts"),
			`import { Crust, defineExtension, defineExtensionId } from ${JSON.stringify(corePath)};\n` +
				`const artifact = defineExtension(defineExtensionId("artifact"), { build: async ({ outDir }) => { await Bun.write(outDir + "/artifact.txt", "built"); return ["artifact.txt", "second.txt", "third.txt", "fourth.txt"]; } });\n` +
				`const unknown = defineExtension(defineExtensionId("unknown-extension"), { build() {} });\n` +
				`await new Crust("fixture").extend(artifact, unknown).action(() => {}).execute();\n`,
		);

		process.cwd = () => tmpDir;

		try {
			const result = await captureExecute(new Crust("test").add(buildCommand), [
				"build",
				"--entry",
				"src/cli.ts",
				"--target",
				"bun-darwin-arm64",
				"--outfile",
				"./out/custom/cli",
			]);

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain(
				"Preparing Command Snapshot...\n" +
					"  artifact           4 files  artifact.txt, second.txt, third.txt, +1 more\n" +
					"  unknown-extension  ran (artifacts not reported)",
			);
			expect(readFileSync(join(tmpDir, ".crust", "artifacts", "artifact.txt"), "utf-8")).toBe(
				"built",
			);
			expect(existsSync(join(tmpDir, ".crust", "manifest.json"))).toBe(false);
		} finally {
			process.cwd = originalCwd;
			rmSync(tmpDir, { recursive: true, force: true });
		}
	}, 30_000);
});
