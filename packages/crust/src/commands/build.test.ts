import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Crust } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import type { JsonValue } from "@crustjs/utils/json";

const corePath = fileURLToPath(import.meta.resolve("@crustjs/core"));

import {
	BUN_TARGETS,
	bunBaselineAlias,
	DENO_TARGETS,
	hostTarget,
	resolveTargets,
	type TargetTable,
} from "../utils/build-helpers.ts";
import {
	type BuildFlags,
	buildCommand,
	planBuild,
	readCrustConfig,
	resolveEnvFilePaths,
} from "./build.ts";

const host = hostTarget(BUN_TARGETS);

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
	const baseFlags: BuildFlags = { validate: true };
	const writePackageJson = (pkg: JsonValue) =>
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify(pkg));

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

	it("reads package.json crust.runtime", () => {
		writePackageJson({ crust: { runtime: "deno" } });
		expect(planBuild(baseFlags, tmpDir)).toMatchObject({
			runtime: "deno",
			runtimeSource: "from package.json",
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
		writePackageJson({ crust: { runtime: "python" } });
		expect(() => planBuild(baseFlags, tmpDir)).toThrow(/Invalid package.json crust.runtime/);
	});

	it("reads crust.entry relative to the project and rejects paths outside it", () => {
		expect(planBuild(baseFlags, tmpDir).entryPath).toBe(join(tmpDir, "src", "cli.ts"));
		writeFileSync(join(tmpDir, "src", "main.ts"), "export {};\n");
		writePackageJson({ crust: { entry: "./src/main.ts" } });
		expect(planBuild(baseFlags, tmpDir).entryPath).toBe(join(tmpDir, "src", "main.ts"));
		for (const entry of ["../cli.ts", join(tmpDir, "src", "cli.ts"), ".", "src/.."]) {
			writePackageJson({ crust: { entry } });
			expect(() => planBuild(baseFlags, tmpDir)).toThrow(
				`package.json crust.entry ${JSON.stringify(entry)} must be a file inside the project root`,
			);
		}
		writePackageJson({ crust: { entry: "src/missing.ts" } });
		expect(() => planBuild(baseFlags, tmpDir)).toThrow(
			`Entry file not found: ${join(tmpDir, "src", "missing.ts")}`,
		);
	});

	it("uses one parse-error policy for runtime and output-name resolution", () => {
		writeFileSync(join(tmpDir, "package.json"), "not json");
		expect(() => planBuild(baseFlags, tmpDir)).toThrow(`Failed to parse package.json in ${tmpDir}`);
	});

	const rejectedCases: Array<{
		name: string;
		crust: JsonValue;
		flags: Partial<BuildFlags>;
		error: string;
	}> = [
		{
			name: "Node builds with targets",
			crust: { runtime: "node" },
			flags: { target: ["bun-linux-x64"] },
			error: "--target cannot be used with the node runtime",
		},
		{
			name: "minified Deno builds",
			crust: { runtime: "deno" },
			flags: { minify: true },
			error: "--minify is not supported with the deno runtime",
		},
		{
			name: "Deno builds with env files",
			crust: { runtime: "deno" },
			flags: { "env-file": [".env"] },
			error: "--env-file is not supported with the deno runtime",
		},
		{
			name: "Deno builds with Bun bundler plugins",
			crust: { runtime: "deno", bunPlugins: ["@opentui/solid/bun-plugin"] },
			flags: {},
			error: "package.json crust.bunPlugins is not supported with the deno runtime",
		},
	];
	for (const testCase of rejectedCases) {
		it(`rejects ${testCase.name}`, () => {
			writePackageJson({ crust: testCase.crust });
			expect(() => planBuild({ ...baseFlags, ...testCase.flags }, tmpDir)).toThrow(testCase.error);
		});
	}

	it("keeps crust.bunPlugins specifiers in order and defaults to none", () => {
		expect(planBuild(baseFlags, tmpDir).bunPlugins).toEqual([]);
		writePackageJson({
			crust: { bunPlugins: ["./plugins/second.ts", "@opentui/solid/bun-plugin"] },
		});
		expect(planBuild(baseFlags, tmpDir).bunPlugins).toEqual([
			"./plugins/second.ts",
			"@opentui/solid/bun-plugin",
		]);
		writePackageJson({ crust: { runtime: "node", bunPlugins: ["./plugin.ts"] } });
		expect(planBuild(baseFlags, tmpDir)).toMatchObject({
			runtime: "node",
			bunPlugins: ["./plugin.ts"],
		});
	});

	// Only arm64 hosts hit the self-copy refusal; x64 hosts compile their own
	// target through its -baseline alias, which Bun downloads clean.
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

	it("stages .crust for every runtime", () => {
		const stageDir = resolve(tmpDir, ".crust");
		const outDir = resolve(stageDir, "artifacts");
		expect(planBuild({ ...baseFlags, target: ["bun-linux-x64"] }, tmpDir)).toMatchObject({
			runtime: "bun",
			targets: ["bun-linux-x64"],
			stageDir,
			outDir,
			include: [],
		});
		writePackageJson({ crust: { runtime: "deno" } });
		expect(planBuild(baseFlags, tmpDir)).toMatchObject({
			runtime: "deno",
			targets: [...DENO_TARGETS.targets],
			minify: false,
			stageDir,
		});
		expect(() => planBuild({ ...baseFlags, target: ["linux-x64"] }, tmpDir)).toThrow(
			'Unknown Deno target "linux-x64"',
		);
		mkdirSync(join(tmpDir, "templates"), { recursive: true });
		writePackageJson({
			crust: { runtime: "node", bunPlugins: ["./plugin.ts"], include: ["templates"] },
		});
		const nodePlan = planBuild(baseFlags, tmpDir);
		expect(nodePlan).toMatchObject({
			runtime: "node",
			minify: true,
			bunPlugins: ["./plugin.ts"],
			include: ["templates"],
			stageDir,
		});
		expect(nodePlan).not.toHaveProperty("targets");
	});

	it.skipIf(host === null)("resolves --target host to this machine's target", () => {
		expect(planBuild({ ...baseFlags, target: ["host"] }, tmpDir)).toMatchObject({
			runtime: "bun",
			targets: [host],
		});
		expect(
			planBuild({ ...baseFlags, target: ["host", host!, "bun-linux-x64", "host"] }, tmpDir),
		).toMatchObject({ targets: host === "bun-linux-x64" ? [host] : [host, "bun-linux-x64"] });
		const denoHost = hostTarget(DENO_TARGETS);
		writePackageJson({ crust: { runtime: "deno" } });
		if (denoHost !== null) {
			expect(planBuild({ ...baseFlags, target: ["host"] }, tmpDir)).toMatchObject({
				runtime: "deno",
				targets: [denoHost],
			});
		} else {
			expect(() => planBuild({ ...baseFlags, target: ["host"] }, tmpDir)).toThrow(
				/No Deno target matches this machine \(linux-(x64|arm64)-musl\)/,
			);
		}
	});
});

describe("readCrustConfig", () => {
	it("accepts the four documented keys and nothing else", () => {
		expect(readCrustConfig(undefined)).toEqual({});
		expect(readCrustConfig({ name: "x" })).toEqual({});
		expect(
			readCrustConfig({
				crust: { runtime: "node", entry: "src/index.ts", bunPlugins: ["./p.ts"], include: ["t"] },
			}),
		).toEqual({ runtime: "node", entry: "src/index.ts", bunPlugins: ["./p.ts"], include: ["t"] });
		expect(() => readCrustConfig({ crust: { bunPlugin: [] } })).toThrow(
			'Unknown package.json crust key "bunPlugin". Allowed keys: runtime, entry, bunPlugins, include',
		);
		expect(() => readCrustConfig({ crust: "bun" })).toThrow("crust must be an object");
		expect(() => readCrustConfig({ crust: { entry: 1 } })).toThrow("crust.entry must be");
		expect(() => readCrustConfig({ crust: { bunPlugins: "./p.ts" } })).toThrow(
			"crust.bunPlugins must be an array",
		);
		expect(() => readCrustConfig({ crust: { include: "templates" } })).toThrow(
			"crust.include must be an array",
		);
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

	it("dedupes repeated targets in input order", () => {
		expect(
			resolveTargets(BUN_TARGETS, ["bun-darwin-arm64", "bun-linux-x64", "bun-darwin-arm64"]),
		).toEqual(["bun-darwin-arm64", "bun-linux-x64"]);
	});

	it("rejects host when the table has no target for this machine", () => {
		// A table with no entries for this platform reproduces the unsupported-host case deterministically.
		const empty: TargetTable<never> = { runtime: "Bun", targets: [], info: {} };
		expect(() => resolveTargets(empty, ["host"])).toThrow(
			/No Bun target matches this machine \(\w+-\w+(-musl)?\)/,
		);
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

async function executeBuildError(name: string, crust: JsonValue, argv: string[]): Promise<string> {
	const originalCwd = process.cwd;
	const tmpDir = mkdtempSync(join(tmpdir(), `crust-${name}-`));
	rmSync(tmpDir, { recursive: true, force: true });
	mkdirSync(join(tmpDir, "src"), { recursive: true });
	writeFileSync(join(tmpDir, "src", "cli.ts"), "console.log('hi');");
	writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ crust }));
	process.cwd = () => tmpDir;
	try {
		const result = await captureExecute(new Crust("test").add(buildCommand), ["build", ...argv]);
		expect(result.exitCode).toBe(1);
		return result.stderr;
	} finally {
		process.cwd = originalCwd;
		rmSync(tmpDir, { recursive: true, force: true });
	}
}

describe("buildCommand error handling", () => {
	it("rejects unsupported runtime and flag combinations before compiling", async () => {
		expect(
			await executeBuildError("node-target", { runtime: "node" }, [
				"--target",
				"bun-linux-x64",
				"--no-validate",
			]),
		).toContain("--target cannot be used with the node runtime");
		expect(
			await executeBuildError("deno-minify", { runtime: "deno" }, ["--minify", "--no-validate"]),
		).toContain("--minify is not supported with the deno runtime");
		const envDir = mkdtempSync(join(tmpdir(), "crust-deno-env-file-"));
		const envFile = join(envDir, ".env");
		writeFileSync(envFile, "SECRET=x\n");
		try {
			expect(
				await executeBuildError("deno-env-file", { runtime: "deno" }, [
					"--env-file",
					envFile,
					"--no-validate",
				]),
			).toContain("--env-file is not supported with the deno runtime");
		} finally {
			rmSync(envDir, { recursive: true, force: true });
		}
		expect(
			await executeBuildError(
				"deno-bun-plugin",
				{ runtime: "deno", bunPlugins: ["@opentui/solid/bun-plugin"] },
				["--no-validate"],
			),
		).toContain("package.json crust.bunPlugins is not supported with the deno runtime");
		expect(await executeBuildError("unknown-key", { bunPlugin: [] }, ["--no-validate"])).toContain(
			'Unknown package.json crust key "bunPlugin". Allowed keys: runtime, entry, bunPlugins, include',
		);
	});
	it("sets exitCode and logs error when entry file is missing", async () => {
		expect(
			await executeBuildError("missing-entry", { entry: "nonexistent.ts" }, [
				"--target",
				"bun-linux-x64",
			]),
		).toContain("Entry file not found");
	});

	it.skipIf(host === null)(
		"writes Extension build artifacts to .crust/artifacts",
		async () => {
			const originalCwd = process.cwd;
			const tmpDir = mkdtempSync(join(tmpdir(), "crust-artifacts-"));
			rmSync(tmpDir, { recursive: true, force: true });
			mkdirSync(join(tmpDir, "src"), { recursive: true });
			writeFileSync(
				join(tmpDir, "package.json"),
				JSON.stringify({ name: "artifact-cli", version: "0.1.0" }),
			);
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
					"--target",
					"host",
				]);

				expect(result.exitCode, result.stderr).toBe(0);
				expect(result.stdout).toContain(
					"Preparing Command Snapshot...\n" +
						"  artifact           4 files  artifact.txt, second.txt, third.txt, +1 more\n" +
						"  unknown-extension  ran (artifacts not reported)",
				);
				expect(readFileSync(join(tmpDir, ".crust", "artifacts", "artifact.txt"), "utf-8")).toBe(
					"built",
				);
				expect(existsSync(join(tmpDir, ".crust", "manifest.json"))).toBe(true);
				expect(existsSync(join(tmpDir, ".crust", BUN_TARGETS.info[host!].alias, "bin"))).toBe(true);
			} finally {
				process.cwd = originalCwd;
				rmSync(tmpDir, { recursive: true, force: true });
			}
		},
		30_000,
	);
});
