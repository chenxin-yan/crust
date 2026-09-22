import { existsSync, realpathSync, rmSync, statSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { defineCommand, type BuildReport, type InvocationIO } from "@crustjs/core";
import { dim } from "@crustjs/style";
import { isJsonObject, type JsonValue } from "@crustjs/utils/json";
import { isWithin } from "@crustjs/utils/path";

import {
	assertTargetsBuildableWithoutBun,
	BUILD_RUNTIMES,
	type BuildRuntime,
	BUN_TARGETS,
	type BunTarget,
	DENO_TARGETS,
	type DenoTarget,
	execBuild,
	execDenoBuild,
	execNodeBuild,
	HOST_TARGET,
	readUserPackageJson,
	resolveTargets,
	buildEntrypoint,
} from "../utils/build-helpers.ts";
import {
	type ArtifactOwner,
	type BinEntry,
	CRUST_DIR,
	type DistributeBuildPlan,
	type Distribution,
	mergeEntryArtifacts,
	validatePackageIdentity,
	runDistributeBuild,
} from "../utils/distribute.ts";

// ────────────────────────────────────────────────────────────────────────────
// package.json "crust" configuration
// ────────────────────────────────────────────────────────────────────────────

/** Also mirrored by `schema/package.json`; build.test.ts guards against drift. */
export const CRUST_CONFIG_KEYS = ["runtime", "targets", "bunPlugins", "include"] as const;

/** The `crust` block of the user's package.json, shape-validated. */
export type CrustConfig = {
	runtime?: BuildRuntime;
	targets?: string[];
	bunPlugins?: string[];
	include?: string[];
};

function isBuildRuntime(value: JsonValue): value is BuildRuntime {
	return typeof value === "string" && BUILD_RUNTIMES.some((runtime) => runtime === value);
}

function isString(value: JsonValue): value is string {
	return typeof value === "string";
}

function isStringArray(value: JsonValue): value is string[] {
	return Array.isArray(value) && value.every(isString);
}

export function readCrustConfig(pkg: JsonValue | undefined): CrustConfig {
	if (pkg === undefined || !isJsonObject(pkg) || pkg.crust === undefined) return {};
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
	if (crust.targets !== undefined) {
		if (!isStringArray(crust.targets)) {
			throw new Error(
				'package.json crust.targets must be an array of canonical compiler targets, e.g. ["bun-linux-x64", "bun-darwin-arm64"].',
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
	return config;
}

function hasDependency(pkg: JsonValue, name: string): boolean {
	if (!isJsonObject(pkg)) return false;
	return [pkg.dependencies, pkg.devDependencies].some(
		(deps) => deps !== undefined && isJsonObject(deps) && name in deps,
	);
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
function resolveBuildRuntime(
	pkg: JsonValue | undefined,
	config: CrustConfig,
	cwd: string,
): ResolvedRuntime {
	if (config.runtime !== undefined) return { runtime: config.runtime, source: "from package.json" };
	const denoConfig = DENO_CONFIG_FILES.find((file) => existsSync(join(cwd, file)));
	if (denoConfig) return { runtime: "deno", source: `inferred from ${denoConfig}` };
	if (pkg !== undefined && hasDependency(pkg, "@types/node") && !hasDependency(pkg, "@types/bun")) {
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

export function resolveEnvFilePaths(cwd: string, envFiles: string[] | undefined): string[] {
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
export const DEFAULT_ENTRY = "src/cli.ts";

/**
 * Command names become `bin/<command>.js`, `<command>-<target>` binary
 * filenames, and launcher text, so they are restricted to a filename-safe
 * subset of what npm accepts: no separators, dots-only names, or leading `.`/`-`.
 */
const COMMAND_NAME_PATTERN = /^[A-Za-z0-9_~][A-Za-z0-9._~-]*$/;

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
export function resolveBinEntries(cwd: string, pkg: JsonValue | undefined): BinEntry[] {
	const packageJson = pkg !== undefined && isJsonObject(pkg) ? pkg : {};
	const bin = packageJson.bin;
	let declared: Array<[command: string, source: JsonValue]>;
	if (bin === undefined || isString(bin)) {
		const name = packageJson.name;
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
		if (!COMMAND_NAME_PATTERN.test(command)) {
			throw new Error(
				`package.json bin key ${JSON.stringify(command)} is not a valid command name.\n  Use letters, digits, ".", "_", "~", and "-", not starting with "." or "-".`,
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

export type BuildFlags = {
	minify?: boolean;
	target?: string[];
	validate: boolean;
	"env-file"?: string[];
};

type CommonBuildPlan = DistributeBuildPlan & {
	runtimeSource: RuntimeSource;
	envFiles: string[];
	bunPlugins: string[];
	minify: boolean;
};

/** The publishable `.crust/` tree: root package plus platform packages for Bun/Deno. */
export type BuildPlan = CommonBuildPlan &
	(
		| { runtime: "bun"; targets: BunTarget[] }
		| { runtime: "deno"; targets: DenoTarget[] }
		| { runtime: "node" }
	);

export function planBuild(flags: BuildFlags, cwd: string): BuildPlan {
	const userPackageJson = readUserPackageJson(cwd);
	const config = readCrustConfig(userPackageJson);
	const { runtime, source: runtimeSource } = resolveBuildRuntime(userPackageJson, config, cwd);
	const entries = resolveBinEntries(cwd, userPackageJson);
	validatePackageIdentity(userPackageJson, "package.json");
	const envFiles = resolveEnvFilePaths(cwd, flags["env-file"]);
	const bunPlugins = config.bunPlugins ?? [];

	if (runtime === "node" && flags.target?.length) {
		throw new Error(
			"--target cannot be used with the node runtime.\n  Node builds produce one portable JavaScript artifact.",
		);
	}
	if (runtime === "node" && config.targets !== undefined) {
		throw new Error(
			"package.json crust.targets is not supported with the node runtime.\n  Node builds produce one portable JavaScript artifact; remove crust.targets or set crust.runtime to bun or deno.",
		);
	}
	if (runtime === "deno" && flags.minify) {
		throw new Error(
			"--minify is not supported with the deno runtime.\n  deno compile has no minification step; drop the flag.",
		);
	}
	if (runtime === "deno" && envFiles.length > 0) {
		throw new Error(
			"--env-file is not supported with the deno runtime.\n" +
				"  deno compile embeds every variable from the file into the binary — secrets included —\n" +
				"  with no PUBLIC_* filter. Load configuration at runtime instead (e.g. deno run --env-file).",
		);
	}
	if (runtime === "deno" && bunPlugins.length > 0) {
		throw new Error(
			"package.json crust.bunPlugins is not supported with the deno runtime.\n  deno compile has no Bun bundler; remove crust.bunPlugins or set crust.runtime to bun.",
		);
	}

	const stageDir = resolve(cwd, CRUST_DIR);
	const common = {
		cwd,
		userPackageJson,
		runtimeSource,
		entries,
		envFiles,
		bunPlugins,
		include: config.include ?? [],
		outDir: join(stageDir, "artifacts"),
		stageDir,
		validate: flags.validate,
		minify: runtime === "deno" ? false : (flags.minify ?? true),
	};

	if (runtime === "node") return { ...common, runtime };
	// --target flags override the package.json default; neither means every target.
	const targetInputs = flags.target?.length ? flags.target : config.targets;
	if (runtime === "bun") {
		const targets = resolveTargets(BUN_TARGETS, targetInputs);
		assertTargetsBuildableWithoutBun(targets);
		return { ...common, runtime, targets };
	}
	return { ...common, runtime, targets: resolveTargets(DENO_TARGETS, targetInputs) };
}

/** Bun and Deno stage platform packages behind a Node launcher; Node stages a root-only bundle. */
async function runStagedBuild(
	plan: BuildPlan,
	io: InvocationIO,
	build: Record<string, BuildReport> | undefined,
): Promise<void> {
	if (plan.runtime === "bun") {
		const distribution: Distribution<BunTarget> = {
			table: BUN_TARGETS,
			targets: plan.targets,
			execute: (entry, outfile, target) =>
				execBuild(entry, outfile, plan.minify, target, plan.envFiles, plan.cwd, plan.bunPlugins),
		};
		return runDistributeBuild(plan, distribution, io, build);
	}
	if (plan.runtime === "deno") {
		const distribution: Distribution<DenoTarget> = {
			table: DENO_TARGETS,
			targets: plan.targets,
			execute: (entry, outfile, target) => execDenoBuild(entry, outfile, target, plan.cwd),
		};
		return runDistributeBuild(plan, distribution, io, build);
	}
	return runDistributeBuild(
		plan,
		{
			execute: (entry, outfile) =>
				execNodeBuild(entry, outfile, plan.minify, plan.envFiles, plan.cwd, plan.bunPlugins),
		},
		io,
		build,
	);
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
): Promise<Record<string, BuildReport>> {
	const owners = new Map<string, ArtifactOwner>();
	const reports: Record<string, BuildReport> = {};
	for (const { command, entryPath } of plan.entries) {
		const entryOutDir = await mkdtemp(join(tmpdir(), "crust-artifacts-"));
		try {
			const { snapshot, build } = await buildEntrypoint(
				entryPath,
				entryOutDir,
				plan.envFiles,
				io,
				plan.cwd,
			);
			if (snapshot.meta.name !== command) {
				throw new Error(
					`package.json bin ${JSON.stringify(command)} builds ${entryPath}, whose root command is named ${JSON.stringify(snapshot.meta.name)}.\n` +
						"  The installed command, help, man pages, and skills use the root command name, so new Crust(name) must match the bin key; rename one of them.",
				);
			}
			printBuildReport(command, build, io.stdout);
			mergeEntryArtifacts(entryOutDir, plan.outDir, command, owners);
			reports[command] = build;
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
 * The `crust build` command.
 *
 * Stages the publishable npm tree in `.crust/`: a root package with one
 * `bin/<command>.js` per package.json `bin` entry, each a Node launcher (Bun,
 * Deno) or the bundle itself (Node), plus one platform package per target for
 * Bun and Deno holding one binary per command. Command names and source
 * entries come from `bin`; the runtime, Bun plugins, and extra directories
 * from package.json `crust`.
 *
 * @example
 * ```sh
 * crust build                                  # Stage .crust/ for every target of the runtime
 * crust build --target host                    # Stage only this machine's target
 * crust build --target bun-linux-x64           # Stage only Linux x64
 * crust build --no-minify                      # Disable minification
 * crust build --env-file .env.production       # Inline PUBLIC_* constants from a file
 * ```
 */
export const buildCommand = defineCommand(
	"build",
	{ description: "Build your CLI for Bun, Deno, or Node" },
	(command) =>
		command
			.flags(
				{
					name: "target",
					type: "string",
					multiple: true,
					description: `Canonical compiler target(s), or "${HOST_TARGET}" for this machine; repeatable. Omit to stage package.json crust.targets, or every Bun/Deno target`,
					short: "t",
				},
				{
					name: "env-file",
					type: "string",
					multiple: true,
					description: "Explicit env file(s) used for build-time constants; repeatable",
				},
				{
					name: "validate",
					type: "boolean",
					description:
						"Materialize command definitions before compiling; --no-validate also skips Extension build hooks",
					default: true,
				},
				{
					name: "minify",
					type: "boolean",
					// No default: deno builds must distinguish an explicit --minify (error)
					// from the implicit bun/node default (true, applied below).
					description: "Minify the output (default for bun and node; unsupported for deno)",
				},
			)
			.action(async ({ flags, stdout, stderr }) => {
				const cwd = process.cwd();
				const io = { stdout, stderr };
				const plan = planBuild(flags, cwd);
				stdout(`${dim("Runtime:")} ${plan.runtime} ${dim(`(${plan.runtimeSource})`)}`);
				// Wipe once, before Extension hooks fill .crust/artifacts; staging only adds to the tree.
				// Clean-by-producer would be a set diff against manifest.build if this wipe is ever dropped.
				rmSync(plan.stageDir, { recursive: true, force: true });
				// --no-validate skips the snapshots (and so the name check and hooks), not the bin validation above.
				const build = plan.validate ? await prepareEntries(plan, io) : undefined;
				await runStagedBuild(plan, io, build);
			}),
);
