import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
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

const corePath = fileURLToPath(import.meta.resolve("@crustjs/core"));

import schema from "../../schema/package.json";
import {
	BUILD_RUNTIMES,
	BUN_TARGETS,
	bunBaselineAlias,
	DENO_TARGETS,
	hostTarget,
	resolveTargets,
	type TargetTable,
} from "../utils/build-helpers.ts";
import type { DistributionManifest } from "../utils/distribute.ts";
import {
	type BuildFlags,
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
	const baseFlags: BuildFlags = { validate: true };
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
		expect(planBuild(baseFlags, tmpDir)).toMatchObject({
			runtime: "bun",
			runtimeSource: "default",
			entries: [{ command: "plan-cli", entryPath: join(tmpDir, "src", "cli.ts") }],
		});
	});

	it("stages package.json crust.targets unless --target is passed", () => {
		writePackageJson({ crust: { targets: ["bun-linux-x64", "bun-darwin-arm64"] } });
		expect(planBuild(baseFlags, tmpDir)).toMatchObject({
			runtime: "bun",
			targets: ["bun-linux-x64", "bun-darwin-arm64"],
		});
		expect(planBuild({ ...baseFlags, target: ["bun-linux-arm64"] }, tmpDir)).toMatchObject({
			targets: ["bun-linux-arm64"],
		});
		writePackageJson({ crust: { targets: ["linux-x64"] } });
		expect(() => planBuild(baseFlags, tmpDir)).toThrow(
			'Unknown target "linux-x64". Targets must use canonical Bun names. Did you mean "bun-linux-x64"?',
		);
		writePackageJson({ crust: { runtime: "node", targets: ["bun-linux-x64"] } });
		expect(() => planBuild(baseFlags, tmpDir)).toThrow(
			"package.json crust.targets is not supported with the node runtime",
		);
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
		writePackageJson(nodeTypes);
		expect(planBuild(baseFlags, tmpDir)).toMatchObject({
			runtime: "node",
			runtimeSource: "inferred from @types/node",
		});
		writePackageJson({ dependencies: { "@types/node": "^22" } });
		expect(planBuild(baseFlags, tmpDir).runtime).toBe("node");
		writePackageJson({ devDependencies: { "@types/node": "^22", "@types/bun": "^1" } });
		expect(planBuild(baseFlags, tmpDir)).toMatchObject({
			runtime: "bun",
			runtimeSource: "default",
		});

		writeFileSync(join(tmpDir, "bun.lock"), "");
		writeFileSync(join(tmpDir, "deno.jsonc"), "{}");
		try {
			// deno.json wins over @types/node; the lockfile is not a signal.
			writePackageJson(nodeTypes);
			expect(planBuild(baseFlags, tmpDir)).toMatchObject({
				runtime: "deno",
				runtimeSource: "inferred from deno.jsonc",
			});
			// Explicit configuration beats inference.
			writePackageJson({ crust: { runtime: "bun" } });
			expect(planBuild(baseFlags, tmpDir)).toMatchObject({
				runtime: "bun",
				runtimeSource: "from package.json",
			});
			writePackageJson({});
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

	it("builds every bin entry under its command name, in declaration order", () => {
		writeFileSync(join(tmpDir, "src", "admin.ts"), "export {};\n");
		writePackageJson({
			name: "@scope/tool",
			bin: { greet: "./src/cli.ts", "admin-tool": "src/admin.ts" },
		});
		expect(planBuild(baseFlags, tmpDir).entries).toEqual([
			{ command: "greet", entryPath: join(tmpDir, "src", "cli.ts") },
			{ command: "admin-tool", entryPath: join(tmpDir, "src", "admin.ts") },
		]);
		// A string bin is the entry of a command named after the unscoped package name.
		writePackageJson({ name: "@scope/tool", bin: "src/admin.ts" });
		expect(planBuild(baseFlags, tmpDir).entries).toEqual([
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
	it("accepts the four documented keys and nothing else", () => {
		expect(readCrustConfig(undefined)).toEqual({});
		expect(readCrustConfig({ name: "x" })).toEqual({});
		expect(
			readCrustConfig({
				crust: {
					runtime: "node",
					targets: ["bun-linux-x64"],
					bunPlugins: ["./p.ts"],
					include: ["t"],
				},
			}),
		).toEqual({
			runtime: "node",
			targets: ["bun-linux-x64"],
			bunPlugins: ["./p.ts"],
			include: ["t"],
		});
		for (const key of ["bunPlugin", "entry", "target"]) {
			expect(() => readCrustConfig({ crust: { [key]: [] } })).toThrow(
				`Unknown package.json crust key "${key}". Allowed keys: runtime, targets, bunPlugins, include`,
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

describe("buildCommand error handling", () => {
	it("rejects unsupported runtime and flag combinations before compiling", async () => {
		expect(
			await executeBuildError("node-target", { crust: { runtime: "node" } }, [
				"--target",
				"bun-linux-x64",
				"--no-validate",
			]),
		).toContain("--target cannot be used with the node runtime");
		expect(
			await executeBuildError("deno-minify", { crust: { runtime: "deno" } }, [
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
				["--no-validate"],
			),
		).toContain("package.json crust.bunPlugins is not supported with the deno runtime");
		expect(
			await executeBuildError("unknown-key", { crust: { bunPlugin: [] } }, ["--no-validate"]),
		).toContain(
			'Unknown package.json crust key "bunPlugin". Allowed keys: runtime, targets, bunPlugins, include',
		);
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
					JSON.stringify({ ...identity, bin: { tool: "cli.ts" }, crust: { runtime: "node" } }),
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
				crust: { runtime: "node" },
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
					`const artifact = defineExtension(defineExtensionId("artifact"), { build: () => ["artifact.txt", "second.txt", "third.txt", "fourth.txt"].map((path) => ({ path, content: "built" })) });\n` +
					`const empty = defineExtension(defineExtensionId("empty-extension"), { build: () => [] });\n` +
					`await new Crust("artifact-cli").extend(artifact, empty).action(() => {}).execute();\n`,
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
					`const hook = defineExtension(defineExtensionId("hook"), { build: () => Object.entries(${JSON.stringify(files)}).map(([path, content]) => ({ path, content })) });\n` +
					`await new Crust(${JSON.stringify(name)}).extend(hook).action(() => {}).execute();\n`,
			);
		const build = (argv: string[]) =>
			captureExecute(new Crust("test").add(buildCommand), ["build", "--target", "host", ...argv]);

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
