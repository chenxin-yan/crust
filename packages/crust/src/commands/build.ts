import { existsSync, rmSync } from "node:fs";
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
import { CRUST_DIR, type Distribution, runDistributeBuild } from "../utils/distribute.ts";

// ────────────────────────────────────────────────────────────────────────────
// package.json "crust" configuration
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_ENTRY = "src/cli.ts";
const CRUST_CONFIG_KEYS = ["runtime", "entry", "bunPlugins", "include"] as const;

/** The `crust` block of the user's package.json, shape-validated. */
export type CrustConfig = {
	runtime?: BuildRuntime;
	entry?: string;
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
	if (crust.entry !== undefined) {
		if (!isString(crust.entry)) {
			throw new Error(
				`package.json crust.entry must be a project-relative file path, e.g. ${JSON.stringify(DEFAULT_ENTRY)}.`,
			);
		}
		config.entry = crust.entry;
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
export type RuntimeSource =
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
export function resolveBuildRuntime(
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

function printBuildReport(report: BuildReport, stdout: InvocationIO["stdout"]): void {
	if (report.extensions.length === 0) return;
	stdout("Preparing Command Snapshot...");
	const idWidth = Math.max(...report.extensions.map(({ id }) => id.length));
	const countWidth = Math.max(
		0,
		...report.extensions.flatMap(({ files }) =>
			files === "unknown"
				? []
				: [`${files.length} ${files.length === 1 ? "file" : "files"}`.length],
		),
	);
	for (const { id, files } of report.extensions) {
		const prefix = `  ${id.padEnd(idWidth)}  `;
		if (files === "unknown") {
			stdout(`${prefix}ran (artifacts not reported)`);
			continue;
		}
		const count = `${files.length} ${files.length === 1 ? "file" : "files"}`;
		const listed = files.slice(0, 3);
		const paths = [...listed, ...(files.length > 3 ? [`+${files.length - 3} more`] : [])].join(
			", ",
		);
		stdout(`${prefix}${count.padEnd(countWidth)}${paths ? `  ${paths}` : ""}`);
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

/** `crust.entry` (default `src/cli.ts`) as an absolute path; must stay inside the project. */
function resolveEntryPath(cwd: string, entry: string | undefined): string {
	const configured = entry ?? DEFAULT_ENTRY;
	const entryPath = resolve(cwd, configured);
	if (isAbsolute(configured) || entryPath === cwd || !isWithin(cwd, entryPath)) {
		throw new Error(
			`package.json crust.entry ${JSON.stringify(configured)} must be a file inside the project root ${cwd}.`,
		);
	}
	if (!existsSync(entryPath)) {
		throw new Error(
			`Entry file not found: ${entryPath}\n  Set package.json crust.entry to your CLI entry (default ${DEFAULT_ENTRY}).`,
		);
	}
	return entryPath;
}

export type BuildFlags = {
	minify?: boolean;
	target?: string[];
	validate: boolean;
	"env-file"?: string[];
};

type CommonBuildPlan = {
	cwd: string;
	userPackageJson: JsonValue | undefined;
	runtimeSource: RuntimeSource;
	entryPath: string;
	envFiles: string[];
	bunPlugins: string[];
	include: string[];
	/** Where Extension build hooks write: `.crust/artifacts`. */
	outDir: string;
	stageDir: string;
	validate: boolean;
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
	const entryPath = resolveEntryPath(cwd, config.entry);
	const envFiles = resolveEnvFilePaths(cwd, flags["env-file"]);
	const bunPlugins = config.bunPlugins ?? [];

	if (runtime === "node" && flags.target?.length) {
		throw new Error(
			"--target cannot be used with the node runtime.\n  Node builds produce one portable JavaScript artifact.",
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
		entryPath,
		envFiles,
		bunPlugins,
		include: config.include ?? [],
		outDir: join(stageDir, "artifacts"),
		stageDir,
		validate: flags.validate,
		minify: runtime === "deno" ? false : (flags.minify ?? true),
	};

	if (runtime === "node") return { ...common, runtime };
	if (runtime === "bun") {
		const targets = resolveTargets(BUN_TARGETS, flags.target);
		assertTargetsBuildableWithoutBun(targets);
		return { ...common, runtime, targets };
	}
	return { ...common, runtime, targets: resolveTargets(DENO_TARGETS, flags.target) };
}

/** Bun and Deno stage platform packages behind a Node launcher; Node stages a root-only bundle. */
async function runStagedBuild(plan: BuildPlan, cwd: string, io: InvocationIO): Promise<void> {
	if (plan.runtime === "bun") {
		const distribution: Distribution<BunTarget> = {
			table: BUN_TARGETS,
			targets: plan.targets,
			execute: (entry, outfile, target) =>
				execBuild(entry, outfile, plan.minify, target, plan.envFiles, cwd, plan.bunPlugins),
		};
		return runDistributeBuild(plan, distribution, io);
	}
	if (plan.runtime === "deno") {
		const distribution: Distribution<DenoTarget> = {
			table: DENO_TARGETS,
			targets: plan.targets,
			execute: (entry, outfile, target) => execDenoBuild(entry, outfile, target, cwd),
		};
		return runDistributeBuild(plan, distribution, io);
	}
	return runDistributeBuild(
		plan,
		{
			execute: (entry, outfile) =>
				execNodeBuild(entry, outfile, plan.minify, plan.envFiles, cwd, plan.bunPlugins),
		},
		io,
	);
}

// ────────────────────────────────────────────────────────────────────────────
// Build command
// ────────────────────────────────────────────────────────────────────────────

/**
 * The `crust build` command.
 *
 * Stages the publishable npm tree in `.crust/`: a root package whose
 * `bin/<cmd>.js` is a Node launcher (Bun, Deno) or the bundle itself (Node),
 * plus one platform package per target for Bun and Deno. The runtime, entry,
 * Bun plugins, and extra directories come from package.json `crust`.
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
					description: `Canonical compiler target(s), or "${HOST_TARGET}" for this machine; repeatable. Omit to stage all Bun/Deno targets`,
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
				rmSync(plan.stageDir, { recursive: true, force: true });
				if (plan.validate) {
					const { build } = await buildEntrypoint(
						plan.entryPath,
						plan.outDir,
						plan.envFiles,
						io,
						cwd,
					);
					printBuildReport(build, stdout);
				}
				await runStagedBuild(plan, cwd, io);
			}),
);
