import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import type { BuildReport, InvocationIO } from "@crustjs/core";
import { INSTALLED_COMMAND_NAME_RULE, isInstalledCommandName } from "@crustjs/core/tooling";
import { dim } from "@crustjs/style";
import { isErrnoException } from "@crustjs/utils/error";
import { isJsonObject, type JsonObject, type JsonValue } from "@crustjs/utils/json";
import { isWithin } from "@crustjs/utils/path";

import { type ArtifactOwner, mergeEntryArtifacts } from "./artifacts.ts";
import { execBuild, execDenoBuild, execDenoPackageBuild, execScriptBuild } from "./bundle.ts";
import {
	assertTargetsBuildableWithoutBun,
	type BuildCompiler,
	type BuildRunner,
	resolveBinaryCompiler,
	resolveBunBuildRunner,
	resolveDenoPackageBundler,
} from "./compilers.ts";
import {
	ARTIFACT_KINDS,
	type ArtifactKind,
	type BinEntry,
	type BuildArtifact,
	CRUST_DIR,
	type DistributeBuildPlan,
	type Distribution,
	assertPublishableRange,
	validatePackageIdentity,
	runDistributeBuild,
} from "./distribute.ts";
import {
	execNodeBinaryBuild,
	provisionNodeExeTargets,
	resolveNodeBinaryCompiler,
} from "./node-exe.ts";
import { buildEntrypoint } from "./snapshot.ts";
import {
	BUILD_RUNTIMES,
	type BuildRuntime,
	BUN_TARGETS,
	type BunTarget,
	DENO_TARGETS,
	type DenoTarget,
	NODE_TARGETS,
	type NodeTarget,
	resolveTargets,
} from "./targets.ts";

function readUserPackageJson(cwd: string): JsonObject {
	const packageJsonPath = join(cwd, "package.json");
	if (!existsSync(packageJsonPath)) {
		throw new Error(
			`package.json not found in ${cwd}\n  crust build requires a package.json with name and version fields.`,
		);
	}

	let packageJson: JsonValue;
	try {
		packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
	} catch (error) {
		throw new Error(
			`Failed to parse package.json in ${cwd}: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}
	if (!isJsonObject(packageJson)) {
		throw new Error(`package.json in ${cwd} must contain a JSON object.`);
	}
	return packageJson;
}

// ────────────────────────────────────────────────────────────────────────────
// package.json "crust" configuration
// ────────────────────────────────────────────────────────────────────────────

/** Also mirrored by `schema/package.json`; build.test.ts guards against drift. */
export const CRUST_CONFIG_KEYS = [
	"runtime",
	"artifact",
	"targets",
	"bunPlugins",
	"include",
	"external",
] as const;

/** The `crust` block of the user's package.json, shape-validated. */
export type CrustConfig = {
	runtime?: BuildRuntime;
	artifact?: ArtifactKind;
	targets?: string[];
	bunPlugins?: string[];
	include?: string[];
	external?: string[];
};

function isBuildRuntime(value: JsonValue): value is BuildRuntime {
	return typeof value === "string" && BUILD_RUNTIMES.some((runtime) => runtime === value);
}

function isArtifactKind(value: JsonValue): value is ArtifactKind {
	return typeof value === "string" && ARTIFACT_KINDS.some((kind) => kind === value);
}

function isString(value: JsonValue): value is string {
	return typeof value === "string";
}

function isStringArray(value: JsonValue): value is string[] {
	return Array.isArray(value) && value.every(isString);
}

export function readCrustConfig(pkg: JsonObject): CrustConfig {
	if (pkg.crust === undefined) return {};
	const crust = pkg.crust;
	const allowed = `Allowed keys: ${CRUST_CONFIG_KEYS.join(", ")}`;
	if (!isJsonObject(crust)) {
		throw new Error(`package.json crust must be an object. ${allowed}`);
	}
	const unknown = Object.keys(crust).find(
		(key) => !CRUST_CONFIG_KEYS.some((allowedKey) => allowedKey === key),
	);
	if (unknown !== undefined) {
		throw new Error(`Unknown package.json crust key ${JSON.stringify(unknown)}. ${allowed}`);
	}

	const config: CrustConfig = {};
	if (crust.runtime !== undefined) {
		if (!isBuildRuntime(crust.runtime)) {
			throw new Error(
				`Invalid package.json crust.runtime ${JSON.stringify(crust.runtime)}. Valid runtimes: ${BUILD_RUNTIMES.join(", ")}`,
			);
		}
		config.runtime = crust.runtime;
	}
	if (crust.artifact !== undefined) {
		if (!isArtifactKind(crust.artifact)) {
			throw new Error(
				`Invalid package.json crust.artifact ${JSON.stringify(crust.artifact)}. Valid artifacts: ${ARTIFACT_KINDS.join(", ")}`,
			);
		}
		config.artifact = crust.artifact;
	}
	if (crust.targets !== undefined) {
		// An empty list would mean "every target" downstream, the opposite of what it says.
		if (!isStringArray(crust.targets) || crust.targets.length === 0) {
			throw new Error(
				'package.json crust.targets must be a non-empty array of canonical compiler targets, e.g. ["bun-linux-x64", "bun-darwin-arm64"].',
			);
		}
		config.targets = crust.targets;
	}
	if (crust.bunPlugins !== undefined) {
		if (!isStringArray(crust.bunPlugins)) {
			throw new Error(
				'package.json crust.bunPlugins must be an array of Bun plugin module specifiers, e.g. ["@opentui/solid/bun-plugin", "./build/plugin.ts"].',
			);
		}
		config.bunPlugins = crust.bunPlugins;
	}
	if (crust.include !== undefined) {
		if (!isStringArray(crust.include)) {
			throw new Error(
				'package.json crust.include must be an array of directory names relative to the project root, e.g. ["templates"].',
			);
		}
		config.include = crust.include;
	}
	const external = crust.external;
	if (external !== undefined) {
		if (!isStringArray(external)) {
			throw new Error(
				'package.json crust.external must be an array of package names from dependencies, e.g. ["better-sqlite3"].',
			);
		}
		const duplicate = external.find((name, index) => external.indexOf(name) !== index);
		if (duplicate !== undefined) {
			throw new Error(
				`package.json crust.external lists ${JSON.stringify(duplicate)} more than once.`,
			);
		}
		config.external = external;
	}
	return config;
}

function hasDependency(pkg: JsonObject, name: string): boolean {
	return [pkg.dependencies, pkg.devDependencies].some(
		(deps) => deps !== undefined && isJsonObject(deps) && name in deps,
	);
}

const NON_DEPENDENCY_SECTIONS = [
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
] as const;

/**
 * `crust.external` names ship as root `dependencies` of a Node or Bun runtime
 * package, so each needs a publishable `dependencies` range. Crust packages
 * stay bundled: core reads `process.env.CRUST_INTERNAL_BUILD`, which the
 * bundler defines only in bundled code, and an external `@crustjs/*` package
 * would load a second copy of core.
 */
function validateExternal(
	external: readonly string[],
	pkg: JsonObject,
	runtime: BuildRuntime,
	artifact: ArtifactKind,
): void {
	if (external.length === 0) return;
	if (artifact === "binary") {
		throw new Error(
			"package.json crust.external is not supported for standalone binaries (artifact binary).\n  A binary bundles every dependency; remove crust.external or use artifact package.",
		);
	}
	if (runtime === "deno") {
		throw new Error(
			"package.json crust.external is not supported with the deno runtime.\n  crust.external applies to Node and Bun runtime packages; remove crust.external or set crust.runtime to node or bun.",
		);
	}
	const dependencies =
		pkg.dependencies !== undefined && isJsonObject(pkg.dependencies) ? pkg.dependencies : {};
	for (const name of external) {
		const quoted = JSON.stringify(name);
		if (name.startsWith("@crustjs/")) {
			throw new Error(
				`package.json crust.external cannot name ${quoted}.\n  Crust packages must stay bundled: core detects a packaged build through a define the bundler injects, and an external Crust package would load a second copy of core.`,
			);
		}
		if (!Object.hasOwn(dependencies, name)) {
			const sections = NON_DEPENDENCY_SECTIONS.filter((section) => {
				const deps = pkg[section];
				return deps !== undefined && isJsonObject(deps) && Object.hasOwn(deps, name);
			});
			throw new Error(
				sections.length > 0
					? `package.json crust.external entry ${quoted} is in ${sections.join(" and ")}, not dependencies.\n  Only dependencies ship with the staged package; move ${quoted} to dependencies.`
					: `package.json crust.external entry ${quoted} is not in package.json dependencies.\n  crust.external names packages from dependencies, which ship with the staged package; add ${quoted} to dependencies.`,
			);
		}
		assertPublishableRange(dependencies[name], `package.json dependencies[${quoted}]`);
	}
}

const DENO_CONFIG_FILES = ["deno.json", "deno.jsonc"] as const;

/** Where the build runtime came from, printed as `Runtime: <runtime> (<source>)`. */
type RuntimeSource =
	| "from package.json"
	| `inferred from ${(typeof DENO_CONFIG_FILES)[number]}`
	| "inferred from @types/node"
	| "default";

type ResolvedRuntime = { runtime: BuildRuntime; source: RuntimeSource };

/**
 * package.json `crust.runtime` > inference > Bun. Inference uses only
 * unambiguous signals: a Deno config file, or `@types/node` without
 * `@types/bun`. Lockfiles say which package manager installed dependencies,
 * not which runtime runs the CLI, so they are not consulted.
 */
function resolveBuildRuntime(pkg: JsonObject, config: CrustConfig, cwd: string): ResolvedRuntime {
	if (config.runtime !== undefined) return { runtime: config.runtime, source: "from package.json" };
	const denoConfig = DENO_CONFIG_FILES.find((file) => existsSync(join(cwd, file)));
	if (denoConfig) return { runtime: "deno", source: `inferred from ${denoConfig}` };
	if (hasDependency(pkg, "@types/node") && !hasDependency(pkg, "@types/bun")) {
		return { runtime: "node", source: "inferred from @types/node" };
	}
	return { runtime: "bun", source: "default" };
}

function printBuildReport(
	command: string,
	report: BuildReport,
	stdout: InvocationIO["stdout"],
): void {
	if (report.extensions.length === 0) return;
	stdout(`Preparing Command Snapshot for ${command}...`);
	const fileCount = (files: readonly string[]) =>
		`${files.length} ${files.length === 1 ? "file" : "files"}`;
	const idWidth = Math.max(...report.extensions.map(({ id }) => id.length));
	const countWidth = Math.max(...report.extensions.map(({ files }) => fileCount(files).length));
	for (const { id, files } of report.extensions) {
		const listed = files.slice(0, 3);
		const paths = [...listed, ...(files.length > 3 ? [`+${files.length - 3} more`] : [])].join(
			", ",
		);
		stdout(
			`  ${id.padEnd(idWidth)}  ${fileCount(files).padEnd(countWidth)}${paths ? `  ${paths}` : ""}`,
		);
	}
}

export function resolveEnvFilePaths(
	cwd: string,
	envFiles: readonly string[] | undefined,
): string[] {
	if (!envFiles || envFiles.length === 0) {
		return [];
	}

	return envFiles.map((envFile) => {
		const envPath = resolve(cwd, envFile);
		if (!existsSync(envPath)) {
			throw new Error(
				`Env file not found: ${envPath}\n  Specify a valid env file with --env-file <path>`,
			);
		}
		return envPath;
	});
}

// ────────────────────────────────────────────────────────────────────────────
// package.json "bin": command names and their source entries
// ────────────────────────────────────────────────────────────────────────────

/** Entry built when package.json has no `bin`. */
const DEFAULT_ENTRY = "src/cli.ts";

const BIN_EXAMPLE = `{ "my-cli": ${JSON.stringify(DEFAULT_ENTRY)} }`;

/**
 * A `bin` value as an absolute path. The path must be relative and lexically
 * inside the project (a symlink may point elsewhere, as for `crust.include`),
 * and must name an existing file, not a directory.
 */
function resolveEntryPath(cwd: string, command: string, source: string): string {
	const entryPath = resolve(cwd, source);
	if (isAbsolute(source) || entryPath === cwd || !isWithin(cwd, entryPath)) {
		throw new Error(
			`package.json bin ${JSON.stringify(command)} entry ${JSON.stringify(source)} must be a file inside the project root ${cwd}.`,
		);
	}
	if (!existsSync(entryPath)) {
		throw new Error(
			`Entry file not found: ${entryPath}\n  Point package.json bin ${JSON.stringify(command)} at your CLI source entry (default ${DEFAULT_ENTRY}).`,
		);
	}
	if (!statSync(entryPath).isFile()) {
		throw new Error(
			`package.json bin ${JSON.stringify(command)} entry ${JSON.stringify(source)} is not a file: ${entryPath}`,
		);
	}
	return entryPath;
}

/**
 * package.json `bin` as build entries, in declaration order. Object values are
 * source files built for the command named by their key; a string `bin` is the
 * source of a command named after the unscoped package name, and no `bin` builds
 * `src/cli.ts` under that name.
 *
 * Two commands cannot share one entry file: entries are compared by real path,
 * so `./src/cli.ts`, `src/../src/cli.ts`, and a symlink to `src/cli.ts` all
 * collide. Command names are compared case-insensitively, because `Tool` and
 * `tool` would be the same `bin/` file on a case-insensitive filesystem.
 */
export function resolveBinEntries(cwd: string, pkg: JsonObject): BinEntry[] {
	const bin = pkg.bin;
	let declared: Array<[command: string, source: JsonValue]>;
	if (bin === undefined || isString(bin)) {
		const name = pkg.name;
		if (name === undefined || !isString(name) || name === "") {
			throw new Error(
				`package.json is missing a name field.\n  Without an object bin, the unscoped package name is the command name, e.g. "bin": ${BIN_EXAMPLE}.`,
			);
		}
		declared = [[name.replace(/^@[^/]+\//, ""), bin ?? DEFAULT_ENTRY]];
	} else if (isJsonObject(bin) && Object.keys(bin).length > 0) {
		declared = Object.entries(bin);
	} else {
		throw new Error(
			`package.json bin must be a source entry path or a non-empty object mapping command names to source entries, e.g. ${BIN_EXAMPLE}.`,
		);
	}

	const commandByLowerName = new Map<string, string>();
	const commandByRealPath = new Map<string, string>();
	return declared.map(([command, source]) => {
		if (!isInstalledCommandName(command)) {
			throw new Error(
				`package.json bin key ${JSON.stringify(command)} is not a valid command name.\n  Use ${INSTALLED_COMMAND_NAME_RULE}.`,
			);
		}
		const sameName = commandByLowerName.get(command.toLowerCase());
		if (sameName !== undefined) {
			throw new Error(
				`package.json bin keys ${JSON.stringify(sameName)} and ${JSON.stringify(command)} differ only by case.\n  Command names become bin/ file names, which collide on case-insensitive filesystems; rename one of them.`,
			);
		}
		commandByLowerName.set(command.toLowerCase(), command);
		if (!isString(source)) {
			throw new Error(
				`package.json bin ${JSON.stringify(command)} must be a project-relative source entry path, e.g. ${JSON.stringify(DEFAULT_ENTRY)}.`,
			);
		}
		const entryPath = resolveEntryPath(cwd, command, source);
		const realPath = realpathSync(entryPath);
		const other = commandByRealPath.get(realPath);
		if (other !== undefined) {
			throw new Error(
				`package.json bin ${JSON.stringify(other)} and ${JSON.stringify(command)} both build ${realPath}.\n  Each command needs its own entry file; aliases of one entry are not supported.`,
			);
		}
		commandByRealPath.set(realPath, command);
		return { command, entryPath };
	});
}

/** Options of the programmatic {@link build}; `crust build` maps its flags onto them. */
export type BuildOptions = {
	/** Project root whose package.json `bin` and `crust` are read. Default: `process.cwd()`. */
	cwd?: string;
	/**
	 * `"package"` for a runtime package (a root-only JavaScript bundle that runs
	 * on the installed runtime) or `"binary"` for standalone executables in
	 * platform packages. Overrides package.json `crust.artifact`; one of the two
	 * is required.
	 */
	artifact?: ArtifactKind;
	/**
	 * Canonical compiler targets, or `"host"` for this machine. Overrides
	 * package.json `crust.targets`; omit both to stage every target of the
	 * binary compiler. Rejected for runtime packages.
	 */
	targets?: readonly string[];
	/** Env files inlining `PUBLIC_*` build-time constants, resolved against `cwd`. Rejected for deno. */
	envFiles?: readonly string[];
	/** Minify the output. Default: true for bun and node; an explicit `true` is rejected for deno. */
	minify?: boolean;
	/** Materialize Command Snapshots and run Extension build hooks before compiling. Default: true. */
	validate?: boolean;
	/** Receives each progress line `crust build` would print; silent when omitted. Warnings arrive as `"stderr"`. */
	onLog?: (line: string, stream: "stdout" | "stderr") => void;
};

type PlanOptions = Omit<BuildOptions, "cwd" | "onLog">;

/** What {@link build} staged in `stageDir` (`<cwd>/.crust`). */
export type BuildResult = {
	stageDir: string;
	/** Generated package.json files, launchers, and compiled commands; see {@link BuildArtifact}. */
	artifacts: BuildArtifact[];
	/** Extension build hook output per command; absent when `validate` was false. */
	reports?: Record<string, BuildReport>;
};

type CommonBuildPlan = DistributeBuildPlan & {
	runtimeSource: RuntimeSource;
	envFiles: string[];
	bunPlugins: string[];
	minify: boolean;
};

/**
 * The publishable `.crust/` tree: a root-only runtime package, or a root
 * launcher package plus one platform package per binary target.
 */
export type BuildPlan = CommonBuildPlan &
	(
		| { runtime: "bun"; artifact: "binary"; targets: BunTarget[] }
		| { runtime: "deno"; artifact: "binary"; targets: DenoTarget[] }
		| { runtime: "node"; artifact: "binary"; targets: NodeTarget[] }
		| { runtime: BuildRuntime; artifact: "package" }
	);

/** What earlier releases built for each runtime without being asked; quoted in the migration error. */
const IMPLICIT_ARTIFACTS = {
	bun: "binary",
	deno: "binary",
	node: "package",
} as const satisfies Record<BuildRuntime, ArtifactKind>;

/** `option` (the `artifact` build option or `--artifact`) > package.json `crust.artifact`; no default. */
function resolveArtifact(
	option: ArtifactKind | undefined,
	config: CrustConfig,
	runtime: BuildRuntime,
): ArtifactKind {
	if (option !== undefined && !isArtifactKind(option)) {
		throw new Error(
			`Invalid artifact ${JSON.stringify(option)}. Valid artifacts: ${ARTIFACT_KINDS.join(", ")}`,
		);
	}
	const artifact = option ?? config.artifact;
	if (artifact === undefined) {
		const previous = IMPLICIT_ARTIFACTS[runtime];
		throw new Error(
			`crust build needs an artifact kind: pass --artifact package|binary or set package.json "crust": { "artifact": "package" | "binary" }.\n` +
				"  package: one JavaScript bundle per command that runs on the consumer's installed runtime.\n" +
				"  binary: standalone executables in per-platform npm packages behind a Node launcher.\n" +
				`  Earlier versions built a ${previous} for the ${runtime} runtime implicitly; set "artifact": "${previous}" to keep that output.`,
		);
	}

	return artifact;
}

export function planBuild(options: PlanOptions, cwd: string): BuildPlan {
	const userPackageJson = readUserPackageJson(cwd);
	const config = readCrustConfig(userPackageJson);
	const { runtime, source: runtimeSource } = resolveBuildRuntime(userPackageJson, config, cwd);
	const artifact = resolveArtifact(options.artifact, config, runtime);
	const entries = resolveBinEntries(cwd, userPackageJson);
	validatePackageIdentity(userPackageJson, "package.json");
	const envFiles = resolveEnvFilePaths(cwd, options.envFiles);
	const bunPlugins = config.bunPlugins ?? [];
	const external = config.external ?? [];

	if (artifact === "package" && options.targets?.length) {
		throw new Error(
			"--target cannot be used with runtime packages (artifact package).\n  A runtime package is one portable JavaScript bundle; drop --target or use artifact binary.",
		);
	}
	if (artifact === "package" && config.targets !== undefined) {
		throw new Error(
			'package.json crust.targets is not supported for runtime packages (artifact package).\n  A runtime package is one portable JavaScript bundle; remove crust.targets or set "artifact": "binary".',
		);
	}
	const denoTool = artifact === "binary" ? "deno compile" : "deno bundle";
	if (runtime === "deno" && options.minify) {
		throw new Error(
			artifact === "binary"
				? "--minify is not supported with the deno runtime.\n  deno compile has no minification step; drop the flag."
				: "--minify is not supported with the deno runtime.\n  crust does not minify Deno runtime packages; drop the flag.",
		);
	}
	if (runtime === "deno" && envFiles.length > 0) {
		throw new Error(
			artifact === "binary"
				? "--env-file is not supported with the deno runtime.\n" +
						"  deno compile embeds every variable from the file into the binary — secrets included —\n" +
						"  with no PUBLIC_* filter. Load configuration at runtime instead (e.g. deno run --env-file)."
				: "--env-file is not supported with the deno runtime.\n" +
						"  deno bundle has no PUBLIC_* build-time constants. Load configuration at runtime instead (e.g. deno run --env-file).",
		);
	}
	if (runtime === "deno" && bunPlugins.length > 0) {
		throw new Error(
			`package.json crust.bunPlugins is not supported with the deno runtime.\n  ${denoTool} has no Bun bundler; remove crust.bunPlugins or set crust.runtime to bun.`,
		);
	}
	if (runtime === "node" && artifact === "binary" && bunPlugins.length > 0) {
		throw new Error(
			"package.json crust.bunPlugins is not supported for node standalone binaries.\n  Remove crust.bunPlugins, or use artifact package or the bun runtime.",
		);
	}
	validateExternal(external, userPackageJson, runtime, artifact);

	const stageDir = resolve(cwd, CRUST_DIR);
	const common = {
		cwd,
		userPackageJson,
		runtimeSource,
		entries,
		envFiles,
		bunPlugins,
		include: config.include ?? [],
		external,
		outDir: join(stageDir, "artifacts"),
		stageDir,
		validate: options.validate ?? true,
		minify: runtime === "deno" ? false : (options.minify ?? true),
	};

	if (artifact === "package") return { ...common, runtime, artifact };
	const targetInputs = options.targets?.length ? options.targets : config.targets;
	if (runtime === "bun") {
		return {
			...common,
			runtime,
			artifact,
			targets: resolveTargets(BUN_TARGETS, targetInputs),
		};
	}
	if (runtime === "node") {
		return {
			...common,
			runtime,
			artifact,
			targets: resolveTargets(NODE_TARGETS, targetInputs),
		};
	}
	return {
		...common,
		runtime,
		artifact,
		targets: resolveTargets(DENO_TARGETS, targetInputs),
	};
}

type SelectedCompilers = {
	/** Bun runner for Command Snapshots; absent only when a Deno build skips them. */
	snapshotRunner: BuildRunner | undefined;
	/** Stages the distribution with the compilers selected here. */
	stage: (reports: Record<string, BuildReport> | undefined) => Promise<BuildArtifact[]>;
};

/**
 * Selects every compiler the build uses, once, before `.crust/` is wiped, so a
 * missing tool or an engines mismatch keeps the previous stage. Binaries use
 * the selected compiler's own version (`resolveBinaryCompiler`, or
 * `resolveNodeBinaryCompiler` with tsdown's requirements for node, whose
 * targets' embedded Node binaries are also provisioned here); runtime
 * packages are bundled by Bun (or, for Deno, by `deno bundle`) and embed no
 * runtime, so engines stay a consumer requirement there and are not checked
 * against the bundler.
 */
async function selectCompilers(plan: BuildPlan, io: InvocationIO): Promise<SelectedCompilers> {
	if (plan.artifact === "package" && plan.runtime === "deno") {
		const bundler = await resolveDenoPackageBundler(plan.cwd);
		io.stdout(
			`${dim("Compiler:")} deno ${bundler.version} ${dim(`(${bundler.runner.command}, deno bundle)`)}`,
		);
		io.stderr(
			"Deno runtime packages are experimental: they are bundled with deno bundle, which Deno marks experimental.",
		);
		return {
			// Command Snapshots always run under Bun, as for Deno binaries.
			snapshotRunner: plan.validate ? resolveBunBuildRunner() : undefined,
			stage: (reports) =>
				runDistributeBuild(
					plan,
					{
						execute: (entry, outfile) =>
							execDenoPackageBuild(entry, outfile, plan.cwd, bundler.runner),
					},
					io,
					reports,
				),
		};
	}
	if (plan.artifact === "package") {
		const runner = resolveBunBuildRunner();
		const target = plan.runtime === "bun" ? "bun" : "node";
		return {
			snapshotRunner: runner,
			stage: (reports) =>
				runDistributeBuild(
					plan,
					{
						execute: (entry, outfile) => execScriptBuild(target, entry, outfile, plan, runner),
					},
					io,
					reports,
				),
		};
	}

	const printCompiler = (compiler: BuildCompiler) =>
		io.stdout(
			`${dim("Compiler:")} ${compiler.runtime} ${compiler.version} ${dim(`(${compiler.runner.command})`)}`,
		);
	if (plan.runtime === "node") {
		const compiler = await resolveNodeBinaryCompiler(plan.userPackageJson, plan.cwd);
		printCompiler(compiler);
		// Downloads and unpacks each target's Node now, so a missing tar/xz/unzip keeps the stage.
		await provisionNodeExeTargets(plan.targets, plan.cwd, compiler);
		// Bun bundles every command before tsdown, even without Command Snapshots.
		const bunRunner = resolveBunBuildRunner();
		const distribution: Distribution<NodeTarget> = {
			table: NODE_TARGETS,
			targets: plan.targets,
			embeddedRuntimeVersion: compiler.version,
			execute: (entry, outfile, target) =>
				execNodeBinaryBuild(entry, outfile, target, plan, compiler, bunRunner, io.stderr),
		};
		return {
			snapshotRunner: bunRunner,
			stage: (reports) => runDistributeBuild(plan, distribution, io, reports),
		};
	}
	const compiler: BuildCompiler = await resolveBinaryCompiler(
		plan.runtime,
		plan.userPackageJson,
		plan.cwd,
	);
	printCompiler(compiler);
	if (plan.runtime === "bun") {
		assertTargetsBuildableWithoutBun(plan.targets, compiler.runner);
		const distribution: Distribution<BunTarget> = {
			table: BUN_TARGETS,
			targets: plan.targets,
			embeddedRuntimeVersion: compiler.version,
			execute: (entry, outfile, target) => execBuild(entry, outfile, target, plan, compiler.runner),
		};
		return {
			snapshotRunner: compiler.runner,
			stage: (reports) => runDistributeBuild(plan, distribution, io, reports),
		};
	}
	const distribution: Distribution<DenoTarget> = {
		table: DENO_TARGETS,
		targets: plan.targets,
		embeddedRuntimeVersion: compiler.version,
		execute: (entry, outfile, target) =>
			execDenoBuild(entry, outfile, target, plan.cwd, compiler.runner),
	};
	return {
		// Command Snapshots always run under Bun, even for Deno binaries.
		snapshotRunner: plan.validate ? resolveBunBuildRunner() : undefined,
		stage: (reports) => runDistributeBuild(plan, distribution, io, reports),
	};
}

/**
 * Prepares every entry's Command Snapshot and checks that its root command is
 * named after the bin key, then merges the Extension build hook output into
 * `plan.outDir`. Each entry's hooks write into their own temporary directory;
 * the merge fails on any path two entries both write. Returns each command's
 * Build Report.
 */
async function prepareEntries(
	plan: BuildPlan,
	io: InvocationIO,
	runner: BuildRunner | undefined,
): Promise<Record<string, BuildReport>> {
	const owners = new Map<string, ArtifactOwner>();
	const reports: Record<string, BuildReport> = {};
	for (const { command, entryPath } of plan.entries) {
		const entryOutDir = await mkdtemp(join(tmpdir(), "crust-artifacts-"));
		try {
			const { snapshot, build: report } = await buildEntrypoint(
				entryPath,
				entryOutDir,
				plan.envFiles,
				io,
				plan.cwd,
				runner,
			);
			if (snapshot.meta.name !== command) {
				throw new Error(
					`package.json bin ${JSON.stringify(command)} builds ${entryPath}, whose root command is named ${JSON.stringify(snapshot.meta.name)}.\n` +
						"  The installed command, help, man pages, and skills use the root command name, so new Crust(name) must match the bin key; rename one of them.",
				);
			}
			printBuildReport(command, report, io.stdout);
			mergeEntryArtifacts(entryOutDir, plan.outDir, command, owners);
			reports[command] = report;
		} finally {
			rmSync(entryOutDir, { recursive: true, force: true });
		}
	}
	return reports;
}

// ────────────────────────────────────────────────────────────────────────────
// Build command
// ────────────────────────────────────────────────────────────────────────────

/**
 * Stages the publishable npm tree in `<cwd>/.crust` for one runtime/artifact
 * combination: a root package with one `bin/<command>.js` per package.json
 * `bin` entry, each the command's bundle (artifact `package`) or a Node
 * launcher (artifact `binary`), plus for binaries one platform package per
 * target holding one executable per command. Command names and source entries
 * come from `bin`; the runtime, artifact, Bun plugins, extra directories, and
 * external dependencies from package.json `crust`. Bundling and Command
 * Snapshots run in bun subprocesses (bun on PATH, or the running Bun
 * executable), so this works under Node as well when Bun is installed; Deno
 * binaries and Deno runtime packages (experimental, deno 2.5.0 or newer) need
 * deno on PATH, and Node binaries a node on PATH that Crust's tsdown can build
 * executables with.
 *
 * Throws on any failure. Planning and compiler-selection failures (bad
 * options or package.json, a missing or hung compiler, an engines mismatch) leave the
 * previous `.crust/` stage untouched; later failures leave a wiped stage
 * without a completion `manifest.json`. Overlapping calls for the same real
 * project directory are rejected across processes before staging. An interrupted
 * process may leave `.crust.lock`; remove it only when no build is running.
 */
export async function build(options: BuildOptions = {}): Promise<BuildResult> {
	const cwd = resolve(options.cwd ?? process.cwd());
	const project = realpathSync(cwd);
	// Outside the stage so wiping .crust cannot release another process's exclusion.
	const lockDir = join(project, `${CRUST_DIR}.lock`);
	try {
		mkdirSync(lockDir);
	} catch (error) {
		if (!isErrnoException(error) || error.code !== "EEXIST") throw error;
		throw new Error(
			`crust build is already building ${project}, or an interrupted build left its lock.\n` +
				`  Remove ${lockDir} only after confirming no build is running.`,
			{ cause: error },
		);
	}
	try {
		const onLog = options.onLog ?? (() => {});
		const io: InvocationIO = {
			stdout: (line) => onLog(line, "stdout"),
			stderr: (line) => onLog(line, "stderr"),
		};
		const plan = planBuild(options, cwd);
		io.stdout(`${dim("Runtime:")} ${plan.runtime} ${dim(`(${plan.runtimeSource})`)}`);
		io.stdout(`${dim("Artifact:")} ${plan.artifact}`);
		const compilers = await selectCompilers(plan, io);
		// Wipe once, before Extension hooks fill .crust/artifacts; staging only adds to the tree.
		rmSync(plan.stageDir, { recursive: true, force: true });
		// validate: false skips the snapshots (and so the name check and hooks), not the bin validation above.
		const reports = plan.validate
			? await prepareEntries(plan, io, compilers.snapshotRunner)
			: undefined;
		const artifacts = await compilers.stage(reports);
		return { stageDir: plan.stageDir, artifacts, ...(reports ? { reports } : {}) };
	} finally {
		rmdirSync(lockDir);
	}
}
