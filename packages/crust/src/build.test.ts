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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Crust, defineExtensionId } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import type { JsonObject, JsonValue } from "@crustjs/utils/json";
import { which } from "@crustjs/utils/process";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vite-plus/test";

const corePath = fileURLToPath(import.meta.resolve("@crustjs/core"));

import schema from "../schema/package.json";
import { runBoundedProcess } from "../tests/bounded-process.ts";
import {
	build,
	type BuildOptions,
	CRUST_CONFIG_KEYS,
	planBuild,
	readCrustConfig,
	resolveBinEntries,
	resolveEnvFilePaths,
} from "./build.ts";
import { buildCommand } from "./commands/build.ts";
import { ARTIFACT_KINDS, type DistributionManifest } from "./distribute.ts";
import { BUILD_RUNTIMES, BUN_TARGETS, DENO_TARGETS, hostTarget, NODE_TARGETS } from "./targets.ts";

const host = hostTarget(BUN_TARGETS);

afterEach(() => {
	vi.unstubAllEnvs();
});

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

	it("plans node standalone binaries over Node's own target table", () => {
		writePackageJson({ crust: { runtime: "node", artifact: "binary" } });
		expect(planBuild(baseFlags, tmpDir)).toMatchObject({
			runtime: "node",
			artifact: "binary",
			targets: [...NODE_TARGETS.targets],
		});
		// Inferred node runtime, --artifact binary, explicit targets deduplicated in order.
		writePackageJson({ devDependencies: { "@types/node": "^22" } });
		expect(
			planBuild({ ...binary, targets: ["win-x64", "linux-arm64", "win-x64"] }, tmpDir),
		).toMatchObject({
			runtime: "node",
			runtimeSource: "inferred from @types/node",
			targets: ["win-x64", "linux-arm64"],
		});
		expect(() => planBuild({ ...binary, targets: ["windows-x64"] }, tmpDir)).toThrow(
			'Unknown Node target "windows-x64". Targets must use canonical Node names. Did you mean "win-x64"?',
		);
		// Node publishes no musl builds, and Bun names are not Node names.
		for (const target of ["linux-x64-musl", "bun-linux-x64"]) {
			expect(() => planBuild({ ...binary, targets: [target] }, tmpDir)).toThrow(
				`Unknown Node target "${target}".`,
			);
		}
		// tsdown has no Bun plugin support; the same plugins still work for a Node runtime package.
		writePackageJson({ crust: { runtime: "node", bunPlugins: ["./plugin.ts"] } });
		expect(() => planBuild(binary, tmpDir)).toThrow(
			"package.json crust.bunPlugins is not supported for node standalone binaries.",
		);
		expect(planBuild(runtimePackage, tmpDir)).toMatchObject({
			runtime: "node",
			artifact: "package",
			bunPlugins: ["./plugin.ts"],
		});
	});

	it("reports runtime/artifact combinations that are not available yet", () => {
		writePackageJson({ crust: { runtime: "deno" } });
		expect(planBuild(runtimePackage, tmpDir)).toMatchObject({
			runtime: "deno",
			artifact: "package",
			minify: false,
		});
		expect(planBuild(runtimePackage, tmpDir)).not.toHaveProperty("targets");
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
		for (const runtime of ["node", "bun", "deno"]) {
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

	it("rejects a missing or non-object package.json before reading any field", () => {
		rmSync(join(tmpDir, "package.json"));
		expect(() => planBuild(binary, tmpDir)).toThrow(
			`package.json not found in ${tmpDir}\n  crust build requires a package.json with name and version fields.`,
		);
		writeFileSync(join(tmpDir, "package.json"), "[]");
		expect(() => planBuild(binary, tmpDir)).toThrow(
			`package.json in ${tmpDir} must contain a JSON object.`,
		);
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

	it("keeps crust.external names in order for Node and Bun runtime packages and defaults to none", () => {
		expect(planBuild(runtimePackage, tmpDir).external).toEqual([]);
		const dependencies = { "better-sqlite3": "^12.0.0", typescript: "7.0.2", unused: "^1.0.0" };
		for (const runtime of ["node", "bun"]) {
			writePackageJson({
				dependencies,
				crust: { runtime, external: ["typescript", "better-sqlite3"] },
			});
			expect(planBuild(runtimePackage, tmpDir)).toMatchObject({
				runtime,
				external: ["typescript", "better-sqlite3"],
			});
		}
		// An empty list is a no-op for every runtime and artifact.
		for (const runtime of ["bun", "node", "deno"]) {
			writePackageJson({ crust: { runtime, external: [] } });
			expect(planBuild(binary, tmpDir).external).toEqual([]);
			expect(planBuild(runtimePackage, tmpDir).external).toEqual([]);
		}
	});

	type ExternalRejectedCase = {
		name: string;
		pkg: Record<string, JsonValue>;
		flags?: BuildOptions;
		error: string;
	};
	const externalRejectedCases: ExternalRejectedCase[] = [
		...["bun", "node", "deno"].map((runtime): ExternalRejectedCase => ({
			name: `${runtime} binaries`,
			pkg: {
				dependencies: { "fake-native": "^1.0.0" },
				crust: { runtime, artifact: "binary", external: ["fake-native"] },
			},
			error:
				"package.json crust.external is not supported for standalone binaries (artifact binary)",
		})),
		{
			name: "--artifact binary overriding crust.artifact package",
			pkg: {
				dependencies: { "fake-native": "^1.0.0" },
				crust: { runtime: "node", artifact: "package", external: ["fake-native"] },
			},
			flags: { artifact: "binary" },
			error:
				"package.json crust.external is not supported for standalone binaries (artifact binary)",
		},
		{
			name: "Deno runtime packages",
			pkg: {
				dependencies: { "fake-native": "^1.0.0" },
				crust: { runtime: "deno", artifact: "package", external: ["fake-native"] },
			},
			error: "package.json crust.external is not supported with the deno runtime",
		},
		...["@crustjs/core", "@crustjs/style"].map((name): ExternalRejectedCase => ({
			name,
			pkg: {
				dependencies: { [name]: "^0.5.0" },
				crust: { runtime: "node", artifact: "package", external: [name] },
			},
			error: `package.json crust.external cannot name ${JSON.stringify(name)}`,
		})),
		{
			name: "an npm alias of a Crust package",
			pkg: {
				dependencies: { "crust-utils": "npm:@crustjs/utils@0.2.2" },
				crust: { runtime: "node", artifact: "package", external: ["crust-utils"] },
			},
			error: 'package.json crust.external cannot name "crust-utils" (an alias of @crustjs/utils)',
		},
		...["devDependencies", "optionalDependencies", "peerDependencies"].map(
			(section): ExternalRejectedCase => ({
				name: `a name only in ${section}`,
				pkg: {
					dependencies: { other: "^1.0.0" },
					[section]: { "fake-native": "^1.0.0" },
					crust: { runtime: "node", artifact: "package", external: ["fake-native"] },
				},
				error: `package.json crust.external entry "fake-native" is in ${section}, not dependencies.\n  Only dependencies ship with the staged package`,
			}),
		),
		{
			name: "a name in several non-dependencies sections",
			pkg: {
				devDependencies: { "fake-native": "^1.0.0" },
				peerDependencies: { "fake-native": "^1.0.0" },
				crust: { runtime: "bun", artifact: "package", external: ["fake-native"] },
			},
			error:
				'package.json crust.external entry "fake-native" is in devDependencies and peerDependencies, not dependencies.',
		},
		// Requiring a dependencies key also rejects subpaths and wildcards.
		...["missing", "fake-native/sub", "fake-*"].map((name): ExternalRejectedCase => ({
			name: `a name missing from dependencies (${name})`,
			pkg: {
				dependencies: { "fake-native": "^1.0.0" },
				crust: { runtime: "node", artifact: "package", external: ["fake-native", name] },
			},
			error: `package.json crust.external entry ${JSON.stringify(name)} is not in package.json dependencies.`,
		})),
		...[
			"workspace:^",
			"catalog:",
			"catalog:native",
			"file:../native",
			"link:../native",
			"portal:../native",
			"../native",
			"./native",
			"/opt/native",
			"~/native",
			"C:\\native",
			"native.tgz",
			1,
		].map((range): ExternalRejectedCase => ({
			name: `the dependency range ${JSON.stringify(range)}`,
			pkg: {
				dependencies: { "fake-native": range },
				crust: { runtime: "node", artifact: "package", external: ["fake-native"] },
			},
			error: `package.json dependencies["fake-native"] must be a publishable range, not ${JSON.stringify(range)}.`,
		})),
	];
	for (const testCase of externalRejectedCases) {
		it(`rejects crust.external for ${testCase.name}`, () => {
			writePackageJson(testCase.pkg);
			expect(() => planBuild({ ...baseFlags, ...testCase.flags }, tmpDir)).toThrow(testCase.error);
		});
	}

	// Planning never looks up a compiler: build() selects it once and judges the
	// host target against that runner (see the build() compiler-selection tests).
	it.skipIf(host === null)("plans every target when bun is not on PATH", () => {
		vi.stubEnv("PATH", "");
		const plan = planBuild(binary, tmpDir);
		expect(plan.runtime === "bun" && "targets" in plan && plan.targets.length).toBe(
			BUN_TARGETS.targets.length,
		);
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
	const entries = (pkg: JsonObject) => resolveBinEntries(tmpDir, pkg);

	beforeAll(() => {
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		writeFileSync(join(tmpDir, "src", "cli.ts"), "export {};\n");
		writeFileSync(join(tmpDir, "src", "admin.ts"), "export {};\n");
	});
	afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

	it("requires a package name when bin is absent or a string", () => {
		const nameless: JsonObject[] = [{}, { name: "" }, { name: 1 }, { bin: "src/cli.ts" }];
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
			"my~cli",
			"_tool",
		]) {
			expect(() => entries({ name: "x", bin: { [key]: "src/cli.ts" } })).toThrow(
				`package.json bin key ${JSON.stringify(key)} is not a valid command name`,
			);
		}
		for (const key of ["my-cli", "my.cli", "my_cli", "cli2", "MyCli2", "1up"]) {
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
	it("accepts the six documented keys and nothing else", () => {
		expect(readCrustConfig({ name: "x" })).toEqual({});
		expect(
			readCrustConfig({
				crust: {
					runtime: "node",
					artifact: "package",
					targets: ["bun-linux-x64"],
					bunPlugins: ["./p.ts"],
					include: ["t"],
					external: ["typescript"],
				},
			}),
		).toEqual({
			runtime: "node",
			artifact: "package",
			targets: ["bun-linux-x64"],
			bunPlugins: ["./p.ts"],
			include: ["t"],
			external: ["typescript"],
		});
		for (const key of ["bunPlugin", "entry", "target", "externals"]) {
			expect(() => readCrustConfig({ crust: { [key]: [] } })).toThrow(
				`Unknown package.json crust key "${key}". Allowed keys: runtime, artifact, targets, bunPlugins, include, external`,
			);
		}
		for (const external of ["typescript", ["typescript", 1], { typescript: true }]) {
			expect(() => readCrustConfig({ crust: { external } })).toThrow(
				"package.json crust.external must be an array of package names from dependencies",
			);
		}
		expect(() =>
			readCrustConfig({ crust: { external: ["typescript", "esbuild", "typescript"] } }),
		).toThrow('package.json crust.external lists "typescript" more than once.');
		expect(readCrustConfig({ crust: { external: [] } })).toEqual({ external: [] });
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
			const bunVersion = execFileSync(bunPath, ["--version"], {
				encoding: "utf8",
				timeout: 10_000,
			}).trim();

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

	it("rejects a build while another process owns the project, including through an alias", async () => {
		writeProject(
			{ name: "node-cli", crust: { runtime: "node", artifact: "package" } },
			'console.log("hi");\n',
		);
		mkdirSync(stageDir);
		const kept = join(stageDir, "kept.txt");
		writeFileSync(kept, "previous stage");
		const alias = join(tmpDir, "alias");
		symlinkSync(tmpDir, alias, "junction");
		const ready = join(tmpDir, "ready");
		const release = join(tmpDir, "release");
		const script = join(tmpDir, "hold-build.ts");
		writeFileSync(
			script,
			`import { existsSync, writeFileSync } from "node:fs";
import { build } from ${JSON.stringify(new URL("./build.ts", import.meta.url).href)};
await build({ cwd: ${JSON.stringify(tmpDir)}, validate: false, onLog() {
	if (existsSync(${JSON.stringify(ready)})) return;
	writeFileSync(${JSON.stringify(ready)}, "ready");
	const deadline = Date.now() + 15_000;
	const gate = new Int32Array(new SharedArrayBuffer(4));
	while (!existsSync(${JSON.stringify(release)})) {
		if (Date.now() > deadline) throw new Error("Build gate timed out");
		Atomics.wait(gate, 0, 0, 10);
	}
} });
`,
		);
		const holder = runBoundedProcess(which("bun")!, [script], { timeout: 25_000 });
		// The bounded child can reject while the parent is still waiting for readiness.
		void holder.catch(() => {});
		try {
			await vi.waitFor(() => expect(existsSync(ready)).toBe(true), { timeout: 10_000 });
			await expect(build({ cwd: alias, validate: false })).rejects.toThrow("already building");
			expect(readFileSync(kept, "utf8")).toBe("previous stage");
			expect(existsSync(join(tmpDir, ".crust.lock"))).toBe(true);
		} finally {
			writeFileSync(release, "release");
			const result = await holder;
			expect(result.exitCode, result.stderr).toBe(0);
		}
		expect(existsSync(join(tmpDir, ".crust.lock"))).toBe(false);
		await expect(build({ cwd: tmpDir, validate: false })).resolves.toHaveProperty("stageDir");
	}, 30_000);

	it("leaves an existing lock and stage untouched and explains manual recovery", async () => {
		writeProject(
			{ name: "node-cli", crust: { runtime: "node", artifact: "package" } },
			'console.log("hi");\n',
		);
		const lock = join(tmpDir, ".crust.lock");
		mkdirSync(lock);
		mkdirSync(stageDir);
		writeFileSync(join(stageDir, "kept.txt"), "previous stage");
		await expect(build({ cwd: tmpDir, validate: false })).rejects.toThrow(
			"only after confirming no build is running",
		);
		expect(existsSync(lock)).toBe(true);
		expect(readFileSync(join(stageDir, "kept.txt"), "utf8")).toBe("previous stage");
	});

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
		await expect(
			build({ cwd: tmpDir, artifact: "binary", targets: ["bun-linux-x64"], validate: false }),
		).rejects.toThrow('Unknown Node target "bun-linux-x64"');
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
			bun: execFileSync(bunPath, ["--version"], { encoding: "utf8", timeout: 10_000 }).trim(),
			marker: "1",
		});
	}, 30_000);

	it.skipIf(which("deno") === null)(
		"stages an experimental root-only Deno runtime package bundled by deno bundle",
		async () => {
			writeProject(
				{
					name: "deno-pkg",
					crust: { runtime: "deno", artifact: "package" },
					engines: { deno: ">=99" },
				},
				'console.log(JSON.stringify({ deno: typeof Deno === "undefined" ? null : Deno.version.deno }));\n',
			);
			const logged: Array<[string, string]> = [];
			const result = await build({
				cwd: tmpDir,
				validate: false,
				onLog: (line, stream) => logged.push([line, stream]),
			});
			const bundlePath = join(stageDir, "root", "bin", "deno-pkg.js");
			expect(result.artifacts).toEqual([
				{ kind: "package-json", path: join(stageDir, "root", "package.json") },
				{ kind: "bundle", path: bundlePath, command: "deno-pkg" },
			]);
			expect(readFileSync(bundlePath, "utf8").startsWith("#!")).toBe(false);
			const manifest = readManifest(join(stageDir, "manifest.json"));
			expect(manifest).toMatchObject({ runtime: "deno", artifact: "package", packages: [] });
			expect(manifest).not.toHaveProperty("embeddedRuntimeVersion");
			// engines.deno is the consumer's requirement; the bundler is not checked against it.
			expect(
				JSON.parse(readFileSync(join(stageDir, "root", "package.json"), "utf8")),
			).toMatchObject({ engines: { deno: ">=99" }, bin: { "deno-pkg": "bin/deno-pkg.js" } });
			const denoPath = which("deno")!;
			const denoVersion = /^deno (\S+)/.exec(
				execFileSync(denoPath, ["--version"], { encoding: "utf8", timeout: 10_000 }),
			)![1];
			expect(logged).toContainEqual([
				`Compiler: deno ${denoVersion} (${denoPath}, deno bundle)`,
				"stdout",
			]);
			expect(logged).toContainEqual([
				expect.stringContaining("Deno runtime packages are experimental"),
				"stderr",
			]);
			const run = execFileSync(denoPath, ["run", "--no-prompt", bundlePath], {
				encoding: "utf8",
				timeout: 30_000,
			});
			expect(JSON.parse(run)).toEqual({ deno: denoVersion });
		},
		60_000,
	);

	it.skipIf(process.platform === "win32")(
		"checks the Deno bundler before wiping the previous stage and writes no manifest when bundling fails",
		async () => {
			const shimDir = mkdtempSync(join(tmpdir(), "crust-deno-shim-"));
			vi.stubEnv("PATH", `${shimDir}:${process.env.PATH}`);
			const fakeDeno = (version: string) =>
				writeFileSync(
					join(shimDir, "deno"),
					`#!/bin/sh\nif [ "$1" = --version ]; then echo "deno ${version} (stable)"; exit 0; fi\necho "bundle exploded" >&2\nexit 1\n`,
					{ mode: 0o755 },
				);
			try {
				writeProject(
					{ name: "deno-pkg", crust: { runtime: "deno", artifact: "package" } },
					'console.log("hi");\n',
				);
				mkdirSync(stageDir);
				writeFileSync(join(stageDir, "kept.txt"), "kept\n");
				fakeDeno("2.4.0");
				await expect(build({ cwd: tmpDir, validate: false })).rejects.toThrow(
					`Deno 2.4.0 (${join(shimDir, "deno")}) cannot bundle a Deno runtime package; deno 2.5.0 or newer is required.`,
				);
				expect(existsSync(join(stageDir, "kept.txt"))).toBe(true);

				fakeDeno("2.9.0");
				await expect(build({ cwd: tmpDir, validate: false })).rejects.toThrow("bundle exploded");
				expect(existsSync(join(stageDir, "root", "package.json"))).toBe(true);
				expect(existsSync(join(stageDir, "manifest.json"))).toBe(false);
			} finally {
				rmSync(shimDir, { recursive: true, force: true });
			}
		},
		30_000,
	);

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
		vi.stubEnv("PATH", "");
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
		expect(existsSync(join(stageDir, "kept.txt"))).toBe(true);
		expect(existsSync(join(stageDir, "manifest.json"))).toBe(false);
	}, 30_000);

	// The shim is a POSIX script; the real Node binary builds run in tests/node-exe.integration.test.ts.
	it.skipIf(process.platform === "win32")(
		"selects and validates the node binary compiler and tsdown's requirements before wiping the previous stage",
		async () => {
			const nodePath = which("node")!;
			const bunDir = dirname(which("bun")!);
			const nodeBinary = {
				cwd: tmpDir,
				artifact: "binary",
				targets: ["linux-x64"],
				validate: false,
			} as const;
			const project = (engines?: Record<string, string>) => {
				writeProject(
					{ name: "node-exe-cli", crust: { runtime: "node" }, ...(engines ? { engines } : {}) },
					'console.log("hi");\n',
				);
				mkdirSync(stageDir);
				writeFileSync(join(stageDir, "kept.txt"), "kept\n");
			};

			project({ node: "0.0.1" });
			await expect(build(nodeBinary)).rejects.toThrow(
				`(${nodePath}) does not satisfy package.json engines.node "0.0.1"`,
			);
			expect(existsSync(join(stageDir, "kept.txt"))).toBe(true);

			// A node inside tsdown's package engines but below its executable minimum,
			// which is read from the installed tsdown under that node.
			project();
			const shimDir = mkdtempSync(join(tmpdir(), "crust-node-shim-"));
			writeFileSync(
				join(shimDir, "node"),
				`#!/bin/sh\nif [ "$1" = --version ]; then echo v24.11.0; exit 0; fi\nexec '${nodePath}' "$@"\n`,
				{ mode: 0o755 },
			);
			try {
				vi.stubEnv("PATH", `${shimDir}:${process.env.PATH}`);
				await expect(build(nodeBinary)).rejects.toThrow(
					/^Node 24\.11\.0 \(.*\) cannot build standalone executables: tsdown \S+'s executable builder requires Node \S+ or later\.\n  Binaries embed the selected node's version; crust does not install or upgrade it\./,
				);
				expect(existsSync(join(stageDir, "kept.txt"))).toBe(true);

				vi.stubEnv("PATH", "");
				await expect(build(nodeBinary)).rejects.toThrow(
					"Node is required for node standalone binaries but was not found on PATH.",
				);
			} finally {
				rmSync(shimDir, { recursive: true, force: true });
			}
			expect(existsSync(join(stageDir, "kept.txt"))).toBe(true);
			expect(existsSync(join(stageDir, "manifest.json"))).toBe(false);

			// Node runtime packages need neither tsdown's node nor tsdown: Bun bundles them.
			vi.stubEnv("PATH", bunDir);
			await expect(
				build({ cwd: tmpDir, artifact: "package", validate: false }),
			).resolves.toHaveProperty("stageDir", stageDir);
		},
		30_000,
	);

	// A version-manager shim picks the runtime from its working directory, so the
	// version probe must run in the project, where compilation runs, not in the caller's cwd.
	it.skipIf(host === null || process.platform === "win32")(
		"reads the compiler version in the project directory, like compilation",
		async () => {
			const bunPath = which("bun")!;
			const bunVersion = execFileSync(bunPath, ["--version"], {
				encoding: "utf8",
				timeout: 10_000,
			}).trim();
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
			vi.stubEnv("PATH", `${shimDir}:${process.env.PATH}`);
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
			'Unknown package.json crust key "bunPlugin". Allowed keys: runtime, artifact, targets, bunPlugins, include, external',
		);
	});

	it("rejects crust.external problems before wiping the previous stage", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "crust-external-guard-"));
		mkdirSync(join(tmpDir, ".crust"));
		writeFileSync(join(tmpDir, ".crust", "previous.txt"), "kept");
		writeFileSync(join(tmpDir, "cli.ts"), "export {};");
		try {
			for (const [range, error] of [
				["workspace:*", 'package.json dependencies["fake-native"] must be a publishable range'],
				[
					undefined,
					'package.json crust.external entry "fake-native" is not in package.json dependencies',
				],
			] as const) {
				writeFileSync(
					join(tmpDir, "package.json"),
					JSON.stringify({
						name: "tool",
						version: "1.0.0",
						bin: { tool: "cli.ts" },
						dependencies: range === undefined ? {} : { "fake-native": range },
						crust: { runtime: "node", artifact: "package", external: ["fake-native"] },
					}),
				);
				await expect(build({ cwd: tmpDir, validate: false })).rejects.toThrow(error);
				expect(readFileSync(join(tmpDir, ".crust", "previous.txt"), "utf8")).toBe("kept");
			}
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
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
				["--artifact", "binary", "--target", "bun-linux-x64", "--no-validate"],
			),
		).toContain('Unknown Node target "bun-linux-x64"');
	});

	it("rejects backend options a Deno runtime package cannot honor", async () => {
		const denoPackage = { crust: { runtime: "deno", artifact: "package" } };
		expect(
			await executeBuildError("deno-package-target", denoPackage, [
				"--target",
				"x86_64-unknown-linux-gnu",
				"--no-validate",
			]),
		).toContain("--target cannot be used with runtime packages");
		expect(
			await executeBuildError("deno-package-minify", denoPackage, ["--minify", "--no-validate"]),
		).toContain(
			"--minify is not supported with the deno runtime.\n  crust does not minify Deno runtime packages",
		);
		const envDir = mkdtempSync(join(tmpdir(), "crust-deno-package-env-file-"));
		const envFile = join(envDir, ".env");
		writeFileSync(envFile, "SECRET=x\n");
		try {
			expect(
				await executeBuildError("deno-package-env-file", denoPackage, [
					"--env-file",
					envFile,
					"--no-validate",
				]),
			).toContain(
				"--env-file is not supported with the deno runtime.\n  deno bundle has no PUBLIC_* build-time constants",
			);
		} finally {
			rmSync(envDir, { recursive: true, force: true });
		}
		expect(
			await executeBuildError(
				"deno-package-bun-plugin",
				{ crust: { ...denoPackage.crust, bunPlugins: ["./plugin.ts"] } },
				["--no-validate"],
			),
		).toContain("deno bundle has no Bun bundler");
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
