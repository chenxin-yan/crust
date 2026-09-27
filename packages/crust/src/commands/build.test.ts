import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Crust, defineExtensionId } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import type { JsonValue } from "@crustjs/utils/json";
import { which } from "@crustjs/utils/process";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

const corePath = fileURLToPath(import.meta.resolve("@crustjs/core"));

import schema from "../../schema/package.json";
import {
	BUILD_RUNTIMES,
	BUN_TARGETS,
	DENO_TARGETS,
	hostTarget,
	resolveTargets,
	type TargetTable,
} from "../utils/build-helpers.ts";
import { ARTIFACT_KINDS, type DistributionManifest } from "../utils/distribute.ts";
import {
	build,
	type BuildOptions,
	buildCommand,
	CRUST_CONFIG_KEYS,
	planBuild,
	readCrustConfig,
	resolveBinEntries,
	resolveEnvFilePaths,
} from "./build.ts";

const host = hostTarget(BUN_TARGETS);

function readManifest(path: string): DistributionManifest {
	return JSON.parse(readFileSync(path, "utf8")) as DistributionManifest;
}

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
	const baseFlags: BuildOptions = {};
	const binary: BuildOptions = { artifact: "binary" };
	const runtimePackage: BuildOptions = { artifact: "package" };
	// Every plan needs a package name: without an object bin it names the command.
	const writePackageJson = (pkg: Record<string, JsonValue>) =>
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ name: "plan-cli", version: "1.0.0", ...pkg }),
		);

	beforeAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		writeFileSync(join(tmpDir, "src", "cli.ts"), "export {};\n");
		writeFileSync(join(tmpDir, ".env"), "PUBLIC_TEST=1\n");
	});

	afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));
	beforeEach(() => writePackageJson({}));
	afterEach(() => rmSync(join(tmpDir, "package.json"), { force: true }));

	it("defaults to Bun and src/cli.ts without project configuration", () => {
		expect(planBuild(binary, tmpDir)).toMatchObject({
			runtime: "bun",
			runtimeSource: "default",
			artifact: "binary",
			entries: [{ command: "plan-cli", entryPath: join(tmpDir, "src", "cli.ts") }],
		});
	});

	it("requires an explicit artifact kind, with migration guidance naming the old implicit output", () => {
		expect(() => planBuild(baseFlags, tmpDir)).toThrow(
			'crust build needs an artifact kind: pass --artifact package|binary or set package.json "crust": { "artifact": "package" | "binary" }.',
		);
		expect(() => planBuild(baseFlags, tmpDir)).toThrow(
			'Earlier versions built a binary for the bun runtime implicitly; set "artifact": "binary" to keep that output.',
		);
		writePackageJson({ devDependencies: { "@types/node": "^22" } });
		expect(() => planBuild(baseFlags, tmpDir)).toThrow(
			'Earlier versions built a package for the node runtime implicitly; set "artifact": "package"',
		);
		writePackageJson({ crust: { runtime: "deno" } });
		expect(() => planBuild(baseFlags, tmpDir)).toThrow(
			"Earlier versions built a binary for the deno runtime implicitly",
		);
		// Checked before bin entries, so the migration error is what an old project sees first.
		writePackageJson({ bin: { cli: "src/missing.ts" } });
		expect(() => planBuild(baseFlags, tmpDir)).toThrow("crust build needs an artifact kind");
		// Programmatic callers are validated like the CLI's choices.
		// @ts-expect-error an invalid artifact from an untyped caller
		expect(() => planBuild({ artifact: "exe" }, tmpDir)).toThrow(
			'Invalid artifact "exe". Valid artifacts: package, binary',
		);
	});

	it("takes the artifact option over package.json crust.artifact and keeps runtime inference", () => {
		writePackageJson({ crust: { artifact: "package" } });
		expect(planBuild(baseFlags, tmpDir)).toMatchObject({
			runtime: "bun",
			runtimeSource: "default",
			artifact: "package",
		});
		expect(planBuild(binary, tmpDir)).toMatchObject({ runtime: "bun", artifact: "binary" });
		writePackageJson({ crust: { artifact: "binary" } });
		expect(planBuild(runtimePackage, tmpDir)).toMatchObject({ artifact: "package" });
		expect(planBuild(runtimePackage, tmpDir)).not.toHaveProperty("targets");
		// The artifact never selects the runtime: node inference still applies.
		writePackageJson({ devDependencies: { "@types/node": "^22" }, crust: { artifact: "package" } });
		expect(planBuild(baseFlags, tmpDir)).toMatchObject({
			runtime: "node",
			runtimeSource: "inferred from @types/node",
			artifact: "package",
		});
	});

	it("reports runtime/artifact combinations that are not available yet", () => {
		writePackageJson({ crust: { runtime: "node", artifact: "binary" } });
		expect(() => planBuild(baseFlags, tmpDir)).toThrow(
			"Standalone binaries are not available for the node runtime yet.",
		);
		writePackageJson({ crust: { runtime: "node" } });
		expect(() => planBuild(binary, tmpDir)).toThrow(
			"Standalone binaries are not available for the node runtime yet.",
		);
		writePackageJson({ crust: { runtime: "deno" } });
		expect(() => planBuild(runtimePackage, tmpDir)).toThrow(
			"Runtime packages are not available for the deno runtime yet.",
		);
	});

	it("stages package.json crust.targets unless --target is passed", () => {
		writePackageJson({ crust: { targets: ["bun-linux-x64", "bun-darwin-arm64"] } });
		expect(planBuild(binary, tmpDir)).toMatchObject({
			runtime: "bun",
			targets: ["bun-linux-x64", "bun-darwin-arm64"],
		});
		expect(planBuild({ ...binary, targets: ["bun-linux-arm64"] }, tmpDir)).toMatchObject({
			targets: ["bun-linux-arm64"],
		});
		writePackageJson({ crust: { targets: ["linux-x64"] } });
		expect(() => planBuild(binary, tmpDir)).toThrow(
			'Unknown target "linux-x64". Targets must use canonical Bun names. Did you mean "bun-linux-x64"?',
		);
		for (const runtime of ["node", "bun"]) {
			writePackageJson({ crust: { runtime, artifact: "package", targets: ["bun-linux-x64"] } });
			expect(() => planBuild(baseFlags, tmpDir)).toThrow(
				"package.json crust.targets is not supported for runtime packages (artifact package)",
			);
		}
	});

	it("reads package.json crust.runtime", () => {
		writePackageJson({ crust: { runtime: "deno" } });
		expect(planBuild(binary, tmpDir)).toMatchObject({
			runtime: "deno",
			runtimeSource: "from package.json",
		});
	});

	it("infers the runtime from deno.json or @types/node, never from lockfiles", () => {
		const nodeTypes = { devDependencies: { "@types/node": "^22" } };
		writePackageJson(nodeTypes);
		expect(planBuild(runtimePackage, tmpDir)).toMatchObject({
			runtime: "node",
			runtimeSource: "inferred from @types/node",
		});
		writePackageJson({ dependencies: { "@types/node": "^22" } });
		expect(planBuild(runtimePackage, tmpDir).runtime).toBe("node");
		writePackageJson({ devDependencies: { "@types/node": "^22", "@types/bun": "^1" } });
		expect(planBuild(runtimePackage, tmpDir)).toMatchObject({
			runtime: "bun",
			runtimeSource: "default",
		});

		writeFileSync(join(tmpDir, "bun.lock"), "");
		writeFileSync(join(tmpDir, "deno.jsonc"), "{}");
		try {
			// deno.json wins over @types/node; the lockfile is not a signal.
			writePackageJson(nodeTypes);
			expect(planBuild(binary, tmpDir)).toMatchObject({
				runtime: "deno",
				runtimeSource: "inferred from deno.jsonc",
			});
			// Explicit configuration beats inference.
			writePackageJson({ crust: { runtime: "bun" } });
			expect(planBuild(binary, tmpDir)).toMatchObject({
				runtime: "bun",
				runtimeSource: "from package.json",
			});
			writePackageJson({});
			expect(planBuild(binary, tmpDir).runtime).toBe("deno");
		} finally {
			rmSync(join(tmpDir, "bun.lock"));
			rmSync(join(tmpDir, "deno.jsonc"));
		}
	});

	it("rejects an invalid configured runtime", () => {
		writePackageJson({ crust: { runtime: "python" } });
		expect(() => planBuild(baseFlags, tmpDir)).toThrow(/Invalid package.json crust.runtime/);
	});

	it("builds every bin entry under its command name, in declaration order", () => {
		writeFileSync(join(tmpDir, "src", "admin.ts"), "export {};\n");
		writePackageJson({
			name: "@scope/tool",
			bin: { greet: "./src/cli.ts", "admin-tool": "src/admin.ts" },
		});
		expect(planBuild(binary, tmpDir).entries).toEqual([
			{ command: "greet", entryPath: join(tmpDir, "src", "cli.ts") },
			{ command: "admin-tool", entryPath: join(tmpDir, "src", "admin.ts") },
		]);
		// A string bin is the entry of a command named after the unscoped package name.
		writePackageJson({ name: "@scope/tool", bin: "src/admin.ts" });
		expect(planBuild(binary, tmpDir).entries).toEqual([
			{ command: "tool", entryPath: join(tmpDir, "src", "admin.ts") },
		]);
	});

	it("uses one parse-error policy for runtime and output-name resolution", () => {
		writeFileSync(join(tmpDir, "package.json"), "not json");
		expect(() => planBuild(baseFlags, tmpDir)).toThrow(`Failed to parse package.json in ${tmpDir}`);
	});

	const rejectedCases: Array<{
		name: string;
		crust: JsonValue;
		flags: Partial<BuildOptions>;
		error: string;
	}> = [
		{
			name: "Node packages with targets",
			crust: { runtime: "node", artifact: "package" },
			flags: { targets: ["bun-linux-x64"] },
			error: "--target cannot be used with runtime packages (artifact package)",
		},
		{
			name: "Bun packages with targets, including host",
			crust: { runtime: "bun" },
			flags: { artifact: "package", targets: ["host"] },
			error: "--target cannot be used with runtime packages (artifact package)",
		},
		{
			name: "minified Deno builds",
			crust: { runtime: "deno", artifact: "binary" },
			flags: { minify: true },
			error: "--minify is not supported with the deno runtime",
		},
		{
			name: "Deno builds with env files",
			crust: { runtime: "deno", artifact: "binary" },
			flags: { envFiles: [".env"] },
			error: "--env-file is not supported with the deno runtime",
		},
		{
			name: "Deno builds with Bun bundler plugins",
			crust: {
				runtime: "deno",
				artifact: "binary",
				bunPlugins: ["@opentui/solid/bun-plugin"],
			},
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
		expect(planBuild(binary, tmpDir).bunPlugins).toEqual([]);
		writePackageJson({
			crust: { bunPlugins: ["./plugins/second.ts", "@opentui/solid/bun-plugin"] },
		});
		expect(planBuild(binary, tmpDir).bunPlugins).toEqual([
			"./plugins/second.ts",
			"@opentui/solid/bun-plugin",
		]);
		expect(planBuild(runtimePackage, tmpDir).bunPlugins).toEqual([
			"./plugins/second.ts",
			"@opentui/solid/bun-plugin",
		]);
		writePackageJson({ crust: { runtime: "node", bunPlugins: ["./plugin.ts"] } });
		expect(planBuild(runtimePackage, tmpDir)).toMatchObject({
			runtime: "node",
			bunPlugins: ["./plugin.ts"],
		});
	});

	// Planning never looks up a compiler: build() selects it once and judges the
	// host target against that runner (see the build() compiler-selection tests).
	it.skipIf(host === null)("plans every target when bun is not on PATH", () => {
		const path = process.env.PATH;
		process.env.PATH = "";
		try {
			const plan = planBuild(binary, tmpDir);
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
		expect(planBuild({ ...binary, targets: ["bun-linux-x64"] }, tmpDir)).toMatchObject({
			runtime: "bun",
			artifact: "binary",
			targets: ["bun-linux-x64"],
			stageDir,
			outDir,
			include: [],
		});
		expect(planBuild(runtimePackage, tmpDir)).toMatchObject({
			runtime: "bun",
			artifact: "package",
			minify: true,
			stageDir,
		});
		writePackageJson({ crust: { runtime: "deno" } });
		expect(planBuild(binary, tmpDir)).toMatchObject({
			runtime: "deno",
			artifact: "binary",
			targets: [...DENO_TARGETS.targets],
			minify: false,
			stageDir,
		});
		expect(() => planBuild({ ...binary, targets: ["linux-x64"] }, tmpDir)).toThrow(
			'Unknown Deno target "linux-x64"',
		);
		mkdirSync(join(tmpDir, "templates"), { recursive: true });
		writePackageJson({
			crust: {
				runtime: "node",
				artifact: "package",
				bunPlugins: ["./plugin.ts"],
				include: ["templates"],
			},
		});
		const nodePlan = planBuild(baseFlags, tmpDir);
		expect(nodePlan).toMatchObject({
			runtime: "node",
			artifact: "package",
			minify: true,
			bunPlugins: ["./plugin.ts"],
			include: ["templates"],
			stageDir,
		});
		expect(nodePlan).not.toHaveProperty("targets");
	});

	it.skipIf(host === null)("resolves --target host to this machine's target", () => {
		expect(planBuild({ ...binary, targets: ["host"] }, tmpDir)).toMatchObject({
			runtime: "bun",
			targets: [host],
		});
		expect(
			planBuild({ ...binary, targets: ["host", host!, "bun-linux-x64", "host"] }, tmpDir),
		).toMatchObject({ targets: host === "bun-linux-x64" ? [host] : [host, "bun-linux-x64"] });
		const denoHost = hostTarget(DENO_TARGETS);
		writePackageJson({ crust: { runtime: "deno" } });
		if (denoHost !== null) {
			expect(planBuild({ ...binary, targets: ["host"] }, tmpDir)).toMatchObject({
				runtime: "deno",
				targets: [denoHost],
			});
		} else {
			expect(() => planBuild({ ...binary, targets: ["host"] }, tmpDir)).toThrow(
				/No Deno target matches this machine \(linux-(x64|arm64)-musl\)/,
			);
		}
	});
});

describe("resolveBinEntries", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "crust-bin-entries-"));
	const entries = (pkg: JsonValue | undefined) => resolveBinEntries(tmpDir, pkg);

	beforeAll(() => {
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		writeFileSync(join(tmpDir, "src", "cli.ts"), "export {};\n");
		writeFileSync(join(tmpDir, "src", "admin.ts"), "export {};\n");
	});
	afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

	it("requires a package name when bin is absent or a string", () => {
		const nameless: Array<JsonValue | undefined> = [
			undefined,
			{},
			{ name: "" },
			{ name: 1 },
			{ bin: "src/cli.ts" },
		];
		for (const pkg of nameless) {
			expect(() => entries(pkg)).toThrow("package.json is missing a name field");
		}
		expect(entries({ name: "@scope/my-cli" })).toEqual([
			{ command: "my-cli", entryPath: join(tmpDir, "src", "cli.ts") },
		]);
	});

	it("rejects malformed bin fields instead of guessing", () => {
		for (const bin of [{}, [], 1, null, ["src/cli.ts"]]) {
			expect(() => entries({ name: "x", bin })).toThrow(
				"package.json bin must be a source entry path or a non-empty object",
			);
		}
		expect(() => entries({ name: "x", bin: { cli: 1 } })).toThrow(
			'package.json bin "cli" must be a project-relative source entry path',
		);
	});

	it("rejects command names that could escape bin/ or break generated launchers", () => {
		for (const key of [
			"",
			".",
			"..",
			"-x",
			".hidden",
			"a/b",
			"a\\b",
			"a b",
			'a"b',
			"a$b",
			"café",
		]) {
			expect(() => entries({ name: "x", bin: { [key]: "src/cli.ts" } })).toThrow(
				`package.json bin key ${JSON.stringify(key)} is not a valid command name`,
			);
		}
		for (const key of ["my-cli", "MyCli2", "a.b_c~d", "1up"]) {
			expect(entries({ name: "x", bin: { [key]: "src/cli.ts" } })[0]?.command).toBe(key);
		}
	});

	it("keeps every entry inside the project and requires it to exist", () => {
		for (const source of ["../cli.ts", join(tmpDir, "src", "cli.ts"), ".", "src/..", ""]) {
			expect(() => entries({ name: "x", bin: { cli: source } })).toThrow(
				`package.json bin "cli" entry ${JSON.stringify(source)} must be a file inside the project root`,
			);
		}
		expect(() => entries({ name: "x", bin: { cli: "src/missing.ts" } })).toThrow(
			`Entry file not found: ${join(tmpDir, "src", "missing.ts")}\n  Point package.json bin "cli"`,
		);
		expect(() => entries({ name: "x", bin: "src/missing.ts" })).toThrow(
			'Point package.json bin "x" at your CLI source entry',
		);
	});

	it("rejects two commands that build the same entry, however it is spelled", () => {
		const cli = realpathSync(join(tmpDir, "src", "cli.ts"));
		for (const alias of ["src/cli.ts", "./src/cli.ts", "src/../src/cli.ts", "src//cli.ts"]) {
			expect(() => entries({ name: "x", bin: { one: "src/cli.ts", two: alias } })).toThrow(
				`package.json bin "one" and "two" both build ${cli}`,
			);
		}
		// Symlinked spellings collide too, whether the link is the file or a directory above it.
		symlinkSync(join(tmpDir, "src", "cli.ts"), join(tmpDir, "src", "cli-link.ts"), "file");
		symlinkSync(join(tmpDir, "src"), join(tmpDir, "source"), "dir");
		for (const alias of ["src/cli-link.ts", "source/cli.ts"]) {
			expect(() => entries({ name: "x", bin: { one: "src/cli.ts", two: alias } })).toThrow(
				`package.json bin "one" and "two" both build ${cli}`,
			);
		}
		// The plan keeps the spelling the user wrote; only the collision check uses the real path.
		expect(entries({ name: "x", bin: { two: "source/cli.ts" } })).toEqual([
			{ command: "two", entryPath: join(tmpDir, "source", "cli.ts") },
		]);
		expect(entries({ name: "x", bin: { one: "src/cli.ts", two: "src/admin.ts" } })).toHaveLength(2);
	});

	it("requires each entry to be a file", () => {
		expect(() => entries({ name: "x", bin: { cli: "src" } })).toThrow(
			`package.json bin "cli" entry "src" is not a file: ${join(tmpDir, "src")}`,
		);
	});

	it("rejects command names that differ only by case", () => {
		expect(() => entries({ name: "x", bin: { Tool: "src/cli.ts", tool: "src/admin.ts" } })).toThrow(
			'package.json bin keys "Tool" and "tool" differ only by case.',
		);
	});
});

describe("readCrustConfig", () => {
	it("accepts the five documented keys and nothing else", () => {
		expect(readCrustConfig(undefined)).toEqual({});
		expect(readCrustConfig({ name: "x" })).toEqual({});
		expect(
			readCrustConfig({
				crust: {
					runtime: "node",
					artifact: "package",
					targets: ["bun-linux-x64"],
					bunPlugins: ["./p.ts"],
					include: ["t"],
				},
			}),
		).toEqual({
			runtime: "node",
			artifact: "package",
			targets: ["bun-linux-x64"],
			bunPlugins: ["./p.ts"],
			include: ["t"],
		});
		for (const key of ["bunPlugin", "entry", "target"]) {
			expect(() => readCrustConfig({ crust: { [key]: [] } })).toThrow(
				`Unknown package.json crust key "${key}". Allowed keys: runtime, artifact, targets, bunPlugins, include`,
			);
		}
		for (const artifact of ["exe", "standalone", "", 1, null]) {
			expect(() => readCrustConfig({ crust: { artifact } })).toThrow(
				`Invalid package.json crust.artifact ${JSON.stringify(artifact)}. Valid artifacts: package, binary`,
			);
		}
		for (const targets of ["bun-linux-x64", []]) {
			expect(() => readCrustConfig({ crust: { targets } })).toThrow(
				"crust.targets must be a non-empty array",
			);
		}
		expect(() => readCrustConfig({ crust: "bun" })).toThrow("crust must be an object");
		expect(() => readCrustConfig({ crust: { bunPlugins: "./p.ts" } })).toThrow(
			"crust.bunPlugins must be an array",
		);
		expect(() => readCrustConfig({ crust: { include: "templates" } })).toThrow(
			"crust.include must be an array",
		);
	});

	it("matches the published JSON schema (schema/package.json)", () => {
		const crust = schema.properties.crust;
		expect(crust.additionalProperties).toBe(false);
		expect(Object.keys(crust.properties)).toEqual([...CRUST_CONFIG_KEYS]);
		expect(crust.properties.runtime.enum).toEqual([...BUILD_RUNTIMES]);
		expect(crust.properties.artifact.enum).toEqual([...ARTIFACT_KINDS]);
		expect(crust.description).toContain("`bin` field");
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

async function executeBuildError(
	name: string,
	pkg: Record<string, JsonValue>,
	argv: string[],
): Promise<string> {
	const originalCwd = process.cwd;
	const tmpDir = mkdtempSync(join(tmpdir(), `crust-${name}-`));
	rmSync(tmpDir, { recursive: true, force: true });
	mkdirSync(join(tmpDir, "src"), { recursive: true });
	writeFileSync(join(tmpDir, "src", "cli.ts"), "console.log('hi');");
	writeFileSync(
		join(tmpDir, "package.json"),
		JSON.stringify({ name: "error-cli", version: "1.0.0", ...pkg }),
	);
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

describe("build", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "crust-build-api-"));
	const stageDir = join(tmpDir, ".crust");
	const writeProject = (pkg: Record<string, JsonValue>, entry: string) => {
		rmSync(tmpDir, { recursive: true, force: true });
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ version: "0.1.0", ...pkg }));
		writeFileSync(join(tmpDir, "src", "cli.ts"), entry);
	};

	afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

	it.skipIf(host === null)(
		"returns the staged artifacts and Build Reports of a validated build, logging only through onLog",
		async () => {
			writeProject(
				{ name: "api-cli" },
				`import { Crust, defineExtension, defineExtensionId } from ${JSON.stringify(corePath)};\n` +
					`const hook = defineExtension(defineExtensionId("hook")).build(() => [{ path: "man/api-cli.1", content: ".Dd" }]);\n` +
					`await new Crust("api-cli").extend(hook).action(() => {}).execute();\n`,
			);
			const logged: Array<[string, string]> = [];
			const result = await build({
				cwd: tmpDir,
				artifact: "binary",
				targets: ["host"],
				onLog: (line, stream) => logged.push([line, stream]),
			});
			const bunPath = which("bun")!;
			const bunVersion = execFileSync(bunPath, ["--version"], { encoding: "utf8" }).trim();

			const alias = BUN_TARGETS.info[host!].alias;
			const root = join(stageDir, "root");
			expect(result.stageDir).toBe(stageDir);
			expect(result.artifacts).toEqual([
				{ kind: "package-json", path: join(root, "package.json") },
				{ kind: "package-json", path: join(stageDir, alias, "package.json"), target: host! },
				{ kind: "launcher", path: join(root, "bin", "api-cli.js"), command: "api-cli" },
				{
					kind: "executable",
					path: join(
						stageDir,
						alias,
						"bin",
						`api-cli-${host}${host!.includes("windows") ? ".exe" : ""}`,
					),
					command: "api-cli",
					target: host!,
				},
			]);
			for (const { path } of result.artifacts) expect(existsSync(path), path).toBe(true);
			expect(result.reports).toEqual({
				"api-cli": { extensions: [{ id: defineExtensionId("hook"), files: ["man/api-cli.1"] }] },
			});
			expect(readManifest(join(stageDir, "manifest.json"))).toMatchObject({
				runtime: "bun",
				artifact: "binary",
				// The external bun on PATH is the selected compiler, so its version is embedded.
				embeddedRuntimeVersion: bunVersion,
				build: result.reports,
			});
			expect(existsSync(join(root, "man", "api-cli.1"))).toBe(true);
			expect(logged.map(([line]) => line)).toEqual(
				expect.arrayContaining([
					expect.stringContaining("Artifact: binary"),
					expect.stringContaining(`Compiler: bun ${bunVersion}`),
				]),
			);
			// Every CLI progress line arrives through the callback, on the stream the CLI would use.
			expect(logged.map(([line]) => line).join("\n")).toContain(
				"Preparing Command Snapshot for api-cli...\n  hook  1 file  man/api-cli.1",
			);
			expect(logged.map(([line]) => line).join("\n")).toContain("Staged");
			expect(logged.every(([, stream]) => stream === "stdout")).toBe(true);
		},
		60_000,
	);

	it("rejects overlapping builds of one project and releases the guard after success or failure", async () => {
		writeProject(
			{ name: "node-cli", crust: { runtime: "node", artifact: "package" } },
			'console.log("hi");\n',
		);
		const alias = join(tmpDir, "alias");
		symlinkSync(tmpDir, alias, "junction");
		const results = await Promise.allSettled([
			build({ cwd: tmpDir, validate: false }),
			build({ cwd: alias, validate: false }),
		]);
		expect(results[0]?.status).toBe("fulfilled");
		expect(results[1]).toMatchObject({
			status: "rejected",
			reason: expect.objectContaining({ message: expect.stringContaining("already building") }),
		});
		await expect(
			build({
				cwd: tmpDir,
				onLog: () => {
					throw new Error("log failure");
				},
			}),
		).rejects.toThrow("log failure");
		await expect(build({ cwd: tmpDir, validate: false })).resolves.toHaveProperty(
			"stageDir",
			stageDir,
		);
	}, 30_000);

	it("stages a node bundle without reports when validate is false and rejects bad options", async () => {
		writeProject(
			{ name: "node-cli", crust: { runtime: "node", artifact: "package" } },
			'console.log("hi");\n',
		);
		mkdirSync(stageDir);
		writeFileSync(join(stageDir, "stale.txt"), "from a previous build\n");

		const result = await build({ cwd: tmpDir, validate: false });
		const bundlePath = join(stageDir, "root", "bin", "node-cli.js");
		expect(result).toEqual({
			stageDir,
			artifacts: [
				{ kind: "package-json", path: join(stageDir, "root", "package.json") },
				{ kind: "bundle", path: bundlePath, command: "node-cli" },
			],
		});
		expect(readFileSync(bundlePath, "utf8")).toMatch(/^#!\/usr\/bin\/env node\n/);
		expect(existsSync(join(stageDir, "stale.txt"))).toBe(false);
		const manifest = readManifest(join(stageDir, "manifest.json"));
		expect(manifest).toMatchObject({ runtime: "node", artifact: "package" });
		expect(manifest).not.toHaveProperty("build");
		expect(manifest).not.toHaveProperty("embeddedRuntimeVersion");

		// Option validation fails before the stage is wiped, with the CLI's messages.
		writeFileSync(join(stageDir, "kept.txt"), "kept\n");
		await expect(
			build({ cwd: tmpDir, targets: ["bun-linux-x64"], validate: false }),
		).rejects.toThrow("--target cannot be used with runtime packages");
		await expect(build({ cwd: tmpDir, artifact: "binary", validate: false })).rejects.toThrow(
			"Standalone binaries are not available for the node runtime yet",
		);
		await expect(
			build({ cwd: tmpDir, envFiles: [".env.missing"], validate: false }),
		).rejects.toThrow("Env file not found");
		expect(existsSync(join(stageDir, "kept.txt"))).toBe(true);
		writeProject({ name: "bun-cli" }, 'console.log("hi");\n');
		mkdirSync(stageDir);
		writeFileSync(join(stageDir, "kept.txt"), "kept\n");
		await expect(build({ cwd: tmpDir, validate: false })).rejects.toThrow(
			"crust build needs an artifact kind",
		);
		await expect(
			build({ cwd: tmpDir, artifact: "binary", targets: ["linux-x64"], validate: false }),
		).rejects.toThrow(
			'Unknown target "linux-x64". Targets must use canonical Bun names. Did you mean "bun-linux-x64"?',
		);
		expect(existsSync(join(stageDir, "kept.txt"))).toBe(true);
	}, 30_000);

	it("stages a root-only Bun runtime package that runs under Bun", async () => {
		writeProject(
			{ name: "bun-pkg", crust: { artifact: "package" }, engines: { bun: ">=99" } },
			"console.log(JSON.stringify({ bun: process.versions.bun ?? null, marker: process.env.CRUST_INTERNAL_BUILD ?? null }));\n",
		);
		const logged: string[] = [];
		const result = await build({
			cwd: tmpDir,
			validate: false,
			onLog: (line) => logged.push(line),
		});
		const bundlePath = join(stageDir, "root", "bin", "bun-pkg.js");
		expect(result.artifacts).toEqual([
			{ kind: "package-json", path: join(stageDir, "root", "package.json") },
			{ kind: "bundle", path: bundlePath, command: "bun-pkg" },
		]);
		expect(readFileSync(bundlePath, "utf8")).toMatch(/^#!\/usr\/bin\/env bun\n/);
		const manifest = readManifest(join(stageDir, "manifest.json"));
		expect(manifest).toMatchObject({
			runtime: "bun",
			artifact: "package",
			packages: [],
			publishOrder: ["root"],
		});
		expect(manifest).not.toHaveProperty("embeddedRuntimeVersion");
		// engines describes the consumer's Bun for a runtime package; the bundler is not checked against it.
		expect(JSON.parse(readFileSync(join(stageDir, "root", "package.json"), "utf8"))).toMatchObject({
			engines: { bun: ">=99" },
			bin: { "bun-pkg": "bin/bun-pkg.js" },
		});
		expect(logged).toContain("Artifact: package");
		expect(logged.some((line) => line.includes("Compiler:"))).toBe(false);

		const bunPath = which("bun")!;
		const run = execFileSync(bunPath, [bundlePath], { encoding: "utf8", timeout: 10_000 });
		expect(JSON.parse(run)).toEqual({
			bun: execFileSync(bunPath, ["--version"], { encoding: "utf8" }).trim(),
			marker: "1",
		});
	}, 30_000);

	it("selects and validates the binary compiler before wiping the previous stage", async () => {
		writeProject({ name: "engine-cli", engines: { bun: "0.0.1" } }, 'console.log("hi");\n');
		mkdirSync(stageDir);
		writeFileSync(join(stageDir, "kept.txt"), "kept\n");
		const bunPath = which("bun")!;
		await expect(
			build({ cwd: tmpDir, artifact: "binary", targets: ["bun-linux-x64"], validate: false }),
		).rejects.toThrow(`(${bunPath}) does not satisfy package.json engines.bun "0.0.1"`);
		writeProject({ name: "engine-cli", engines: { bun: "latest" } }, 'console.log("hi");\n');
		mkdirSync(stageDir);
		writeFileSync(join(stageDir, "kept.txt"), "kept\n");
		await expect(
			build({ cwd: tmpDir, artifact: "binary", targets: ["bun-linux-x64"], validate: false }),
		).rejects.toThrow('package.json engines.bun is not a valid semver range: "latest"');
		expect(existsSync(join(stageDir, "kept.txt"))).toBe(true);

		// Under Node there is no embedded Bun to fall back to: a missing bun fails before the wipe too.
		writeProject({ name: "engine-cli" }, 'console.log("hi");\n');
		mkdirSync(stageDir);
		writeFileSync(join(stageDir, "kept.txt"), "kept\n");
		const path = process.env.PATH;
		process.env.PATH = "";
		try {
			for (const artifact of ["binary", "package"] as const) {
				await expect(
					build({
						cwd: tmpDir,
						artifact,
						...(artifact === "binary" ? { targets: ["bun-linux-x64"] } : {}),
						validate: false,
					}),
				).rejects.toThrow("bun was not found on PATH");
			}
		} finally {
			process.env.PATH = path;
		}
		expect(existsSync(join(stageDir, "kept.txt"))).toBe(true);
		expect(existsSync(join(stageDir, "manifest.json"))).toBe(false);
	}, 30_000);

	// A version-manager shim picks the runtime from its working directory, so the
	// version probe must run in the project, where compilation runs, not in the caller's cwd.
	it.skipIf(host === null || process.platform === "win32")(
		"reads the compiler version in the project directory, like compilation",
		async () => {
			const bunPath = which("bun")!;
			const bunVersion = execFileSync(bunPath, ["--version"], { encoding: "utf8" }).trim();
			writeProject(
				{ name: "shim-cli", engines: { bun: bunVersion } },
				"console.log(process.versions.bun);\n",
			);
			const shimDir = mkdtempSync(join(tmpdir(), "crust-bun-shim-"));
			const project = realpathSync(tmpDir);
			const log = join(shimDir, "calls.log");
			// The real bun inside the project; a different (fake) runtime anywhere else.
			writeFileSync(
				join(shimDir, "bun"),
				`#!/bin/sh\ncwd=$(pwd -P)\necho "$cwd $1" >> '${log}'\n` +
					`if [ "$cwd" = '${project}' ]; then exec '${bunPath}' "$@"; fi\n` +
					`if [ "$1" = --version ]; then echo 0.0.1; exit 0; fi\nexit 1\n`,
				{ mode: 0o755 },
			);
			const path = process.env.PATH;
			process.env.PATH = `${shimDir}:${path}`;
			try {
				expect(process.cwd()).not.toBe(tmpDir);
				const logged: string[] = [];
				const result = await build({
					cwd: tmpDir,
					artifact: "binary",
					targets: ["host"],
					validate: false,
					onLog: (line) => logged.push(line),
				});
				expect(logged).toContain(`Compiler: bun ${bunVersion} (${join(shimDir, "bun")})`);
				const calls = readFileSync(log, "utf8").trim().split("\n");
				expect(calls).toEqual([`${project} --version`, `${project} build`]);
				expect(readManifest(join(stageDir, "manifest.json")).embeddedRuntimeVersion).toBe(
					bunVersion,
				);
				const executable = result.artifacts.find((artifact) => artifact.kind === "executable")!;
				const embedded = execFileSync(executable.path, [], { encoding: "utf8", timeout: 10_000 });
				expect(embedded.trim()).toBe(bunVersion);
			} finally {
				process.env.PATH = path;
				rmSync(shimDir, { recursive: true, force: true });
			}
		},
		30_000,
	);
});

describe("buildCommand error handling", () => {
	it("rejects unsupported runtime and flag combinations before compiling", async () => {
		expect(
			await executeBuildError("node-target", { crust: { runtime: "node", artifact: "package" } }, [
				"--target",
				"bun-linux-x64",
				"--no-validate",
			]),
		).toContain("--target cannot be used with runtime packages");
		expect(
			await executeBuildError("deno-minify", { crust: { runtime: "deno" } }, [
				"--artifact",
				"binary",
				"--minify",
				"--no-validate",
			]),
		).toContain("--minify is not supported with the deno runtime");
		const envDir = mkdtempSync(join(tmpdir(), "crust-deno-env-file-"));
		const envFile = join(envDir, ".env");
		writeFileSync(envFile, "SECRET=x\n");
		try {
			expect(
				await executeBuildError("deno-env-file", { crust: { runtime: "deno" } }, [
					"--artifact",
					"binary",
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
				{ crust: { runtime: "deno", bunPlugins: ["@opentui/solid/bun-plugin"] } },
				["--artifact", "binary", "--no-validate"],
			),
		).toContain("package.json crust.bunPlugins is not supported with the deno runtime");
		expect(
			await executeBuildError("unknown-key", { crust: { bunPlugin: [] } }, ["--no-validate"]),
		).toContain(
			'Unknown package.json crust key "bunPlugin". Allowed keys: runtime, artifact, targets, bunPlugins, include',
		);
	});

	it("requires --artifact or crust.artifact, validates it, and lets the flag win", async () => {
		expect(await executeBuildError("no-artifact", {}, ["--no-validate"])).toContain(
			"crust build needs an artifact kind: pass --artifact package|binary",
		);
		expect(
			await executeBuildError("bad-artifact", {}, ["--artifact", "exe", "--no-validate"]),
		).toContain('Invalid value "exe" for --artifact. Expected one of: package, binary');
		expect(
			await executeBuildError(
				"artifact-precedence",
				{ crust: { runtime: "node", artifact: "package" } },
				["--artifact", "binary", "--no-validate"],
			),
		).toContain("Standalone binaries are not available for the node runtime yet");
		expect(
			await executeBuildError("deno-package", { crust: { runtime: "deno", artifact: "binary" } }, [
				"--artifact",
				"package",
				"--no-validate",
			]),
		).toContain("Runtime packages are not available for the deno runtime yet");
	});

	it("rejects invalid identity before wiping the previous stage, even with --no-validate", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "crust-identity-guard-"));
		mkdirSync(join(tmpDir, ".crust"));
		writeFileSync(join(tmpDir, ".crust", "previous.txt"), "kept");
		writeFileSync(join(tmpDir, "cli.ts"), "export {};");
		const originalCwd = process.cwd;
		process.cwd = () => tmpDir;
		try {
			for (const identity of [
				{ name: 42, version: "1" },
				{ name: "tool", version: {} },
				{ name: "tool", version: " " },
				{ name: "", version: "1" },
			]) {
				writeFileSync(
					join(tmpDir, "package.json"),
					JSON.stringify({
						...identity,
						bin: { tool: "cli.ts" },
						crust: { runtime: "node", artifact: "package" },
					}),
				);
				const result = await captureExecute(new Crust("test").add(buildCommand), [
					"build",
					"--no-validate",
				]);
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain("non-empty string");
				expect(readFileSync(join(tmpDir, ".crust", "previous.txt"), "utf8")).toBe("kept");
			}
		} finally {
			process.cwd = originalCwd;
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("rejects a synthetic legacy report before producing a completed manifest", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "crust-legacy-report-"));
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				name: "legacy",
				version: "1",
				bin: { legacy: "cli.ts" },
				crust: { runtime: "node", artifact: "package" },
			}),
		);
		writeFileSync(
			join(tmpDir, "cli.ts"),
			`import { dirname, join } from "node:path";
			await Bun.write(process.env.CRUST_INTERNAL_SNAPSHOT_PATH!, JSON.stringify({ meta: { name: "legacy" } }));
			await Bun.write(join(dirname(process.env.CRUST_INTERNAL_SNAPSHOT_PATH!), "build-report.json"), JSON.stringify({ extensions: [{ id: "legacy", files: "unknown" }] }));`,
		);
		const originalCwd = process.cwd;
		process.cwd = () => tmpDir;
		try {
			const result = await captureExecute(new Crust("test").add(buildCommand), ["build"]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("invalid Build Report");
			expect(existsSync(join(tmpDir, ".crust", "manifest.json"))).toBe(false);
		} finally {
			process.cwd = originalCwd;
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("rejects bad bin entries before wiping .crust, even with --no-validate", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "crust-bin-guard-"));
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		mkdirSync(join(tmpDir, ".crust"), { recursive: true });
		writeFileSync(join(tmpDir, ".crust", "previous.txt"), "kept\n");
		writeFileSync(join(tmpDir, "src", "cli.ts"), "export {};\n");
		const originalCwd = process.cwd;
		process.cwd = () => tmpDir;
		try {
			symlinkSync(join(tmpDir, "src", "cli.ts"), join(tmpDir, "src", "alias.ts"), "file");
			symlinkSync(join(tmpDir, "src"), join(tmpDir, "source"), "dir");
			for (const [bin, error] of [
				[{ one: "src/cli.ts", two: "./src/cli.ts" }, 'bin "one" and "two" both build'],
				[{ one: "src/cli.ts", two: "src/alias.ts" }, 'bin "one" and "two" both build'],
				[{ one: "src/cli.ts", two: "source/cli.ts" }, 'bin "one" and "two" both build'],
				[{ Tool: "src/cli.ts", tool: "src/alias.ts" }, "differ only by case"],
				[{ cli: "src" }, "is not a file"],
				[{ "../up": "src/cli.ts" }, "is not a valid command name"],
				[{ cli: "nonexistent.ts" }, "Entry file not found"],
				[{}, "non-empty object"],
			] as const) {
				writeFileSync(
					join(tmpDir, "package.json"),
					JSON.stringify({ name: "guard", version: "1.0.0", bin }),
				);
				const result = await captureExecute(new Crust("test").add(buildCommand), [
					"build",
					"--artifact",
					"binary",
					"--no-validate",
					"--target",
					"bun-linux-x64",
				]);
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain(error);
			}
			expect(existsSync(join(tmpDir, ".crust", "previous.txt"))).toBe(true);
		} finally {
			process.cwd = originalCwd;
			rmSync(tmpDir, { recursive: true, force: true });
		}
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
					`const artifact = defineExtension(defineExtensionId("artifact")).build(() => ["artifact.txt", "second.txt", "third.txt", "fourth.txt"].map((path) => ({ path, content: "built" })));\n` +
					`const empty = defineExtension(defineExtensionId("empty-extension")).build(() => []);\n` +
					`await new Crust("artifact-cli").extend(artifact, empty).action(() => {}).execute();\n`,
			);

			process.cwd = () => tmpDir;

			try {
				const result = await captureExecute(new Crust("test").add(buildCommand), [
					"build",
					"--artifact",
					"binary",
					"--target",
					"host",
				]);

				expect(result.exitCode, result.stderr).toBe(0);
				expect(result.stdout).toContain(
					"Preparing Command Snapshot for artifact-cli...\n" +
						"  artifact         4 files  artifact.txt, second.txt, third.txt, +1 more\n" +
						"  empty-extension  0 files",
				);
				expect(result.stdout).not.toContain("not reported");
				expect(readFileSync(join(tmpDir, ".crust", "artifacts", "artifact.txt"), "utf-8")).toBe(
					"built",
				);
				// The manifest records the same report the summary printed, per bin.
				expect(readManifest(join(tmpDir, ".crust", "manifest.json")).build).toEqual({
					"artifact-cli": {
						extensions: [
							{
								id: defineExtensionId("artifact"),
								files: ["artifact.txt", "second.txt", "third.txt", "fourth.txt"],
							},
							{ id: defineExtensionId("empty-extension"), files: [] },
						],
					},
				});
				expect(existsSync(join(tmpDir, ".crust", BUN_TARGETS.info[host!].alias, "bin"))).toBe(true);
			} finally {
				process.cwd = originalCwd;
				rmSync(tmpDir, { recursive: true, force: true });
			}
		},
		30_000,
	);

	describe.skipIf(host === null)("validated multi-entry builds", () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "crust-multi-entry-"));
		const originalCwd = process.cwd;
		/** An entry whose one Extension build hook returns `files`. */
		const writeEntry = (file: string, name: string, files: Record<string, string>) =>
			writeFileSync(
				join(tmpDir, "src", file),
				`import { Crust, defineExtension, defineExtensionId } from ${JSON.stringify(corePath)};\n` +
					`const hook = defineExtension(defineExtensionId("hook")).build(() => Object.entries(${JSON.stringify(files)}).map(([path, content]) => ({ path, content })));\n` +
					`await new Crust(${JSON.stringify(name)}).extend(hook).action(() => {}).execute();\n`,
			);
		const build = (argv: string[]) =>
			captureExecute(new Crust("test").add(buildCommand), [
				"build",
				"--artifact",
				"binary",
				"--target",
				"host",
				...argv,
			]);

		beforeAll(() => {
			mkdirSync(join(tmpDir, "src"), { recursive: true });
			writeFileSync(
				join(tmpDir, "package.json"),
				JSON.stringify({
					name: "multi",
					version: "0.1.0",
					bin: { greet: "src/greet.ts", admin: "src/admin.ts" },
				}),
			);
			process.cwd = () => tmpDir;
		});
		afterAll(() => {
			process.cwd = originalCwd;
			rmSync(tmpDir, { recursive: true, force: true });
		});

		it("fails when a root command is not named after its bin key, unless --no-validate", async () => {
			writeEntry("greet.ts", "greet", {});
			writeEntry("admin.ts", "greet", {});
			const result = await build([]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain(
				`package.json bin "admin" builds ${join(tmpDir, "src", "admin.ts")}, whose root command is named "greet".`,
			);
			expect(existsSync(join(tmpDir, ".crust", "manifest.json"))).toBe(false);

			// --no-validate skips the snapshots, and with them this check and the hooks;
			// the manifest then carries no `build` rather than claiming hooks ran.
			const unchecked = await build(["--no-validate"]);
			expect(unchecked.exitCode, unchecked.stderr).toBe(0);
			expect(readManifest(join(tmpDir, ".crust", "manifest.json"))).not.toHaveProperty("build");
			expect(existsSync(join(tmpDir, ".crust", "artifacts"))).toBe(false);
		}, 60_000);

		it("records one Build Report per bin in the manifest", async () => {
			writeEntry("greet.ts", "greet", { "man/greet.1": ".Dd" });
			writeEntry("admin.ts", "admin", { "man/admin.1": ".Dd", "skills/admin/SKILL.md": "---" });
			const result = await build([]);
			expect(result.exitCode, result.stderr).toBe(0);
			expect(readManifest(join(tmpDir, ".crust", "manifest.json")).build).toEqual({
				greet: { extensions: [{ id: defineExtensionId("hook"), files: ["man/greet.1"] }] },
				admin: {
					extensions: [
						{ id: defineExtensionId("hook"), files: ["man/admin.1", "skills/admin/SKILL.md"] },
					],
				},
			});
		}, 60_000);

		it("rejects case-insensitive cross-entry output before completing the manifest", async () => {
			writeEntry("greet.ts", "greet", { "shared/Config.json": "first" });
			writeEntry("admin.ts", "admin", { "shared/config.json": "second" });
			const result = await build([]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain('both bin "greet" and "admin"');
			expect(readFileSync(join(tmpDir, ".crust/artifacts/shared/Config.json"), "utf8")).toBe(
				"first",
			);
			expect(existsSync(join(tmpDir, ".crust", "manifest.json"))).toBe(false);
		});

		it("rejects colliding hook output across entries", async () => {
			writeEntry("greet.ts", "greet", { "shared/config.json": "{}" });
			writeEntry("admin.ts", "admin", { "shared/config.json": "{}", "man/admin.1": ".Dd" });
			const result = await build([]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain(
				'Build artifact "shared/config.json" is written by both bin "greet" and "admin".',
			);
			expect(existsSync(join(tmpDir, ".crust", "manifest.json"))).toBe(false);
		}, 60_000);
	});
});
