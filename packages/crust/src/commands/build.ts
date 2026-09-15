import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { defineCommand, type BuildReport, type InvocationIO } from "@crustjs/core";
import { cyan, dim, green } from "@crustjs/style";
import { isJsonObject, type JsonValue } from "@crustjs/utils/json";

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
	hostTarget,
	readUserPackageJson,
	resolveTargets,
	buildEntrypoint,
	type TargetTable,
} from "../utils/build-helpers.ts";
import { CRUST_DIR, type Distribution, runDistributeBuild } from "../utils/distribute.ts";

function getConfiguredRuntime(pkg: JsonValue): JsonValue | undefined {
	if (!isJsonObject(pkg)) return undefined;
	const crust = pkg.crust;
	return crust !== undefined && isJsonObject(crust) ? crust.runtime : undefined;
}

function isBuildRuntime(value: JsonValue): value is BuildRuntime {
	return typeof value === "string" && BUILD_RUNTIMES.some((runtime) => runtime === value);
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
	| "from --runtime"
	| "from package.json"
	| `inferred from ${(typeof DENO_CONFIG_FILES)[number]}`
	| "inferred from @types/node"
	| "default";

type ResolvedRuntime = { runtime: BuildRuntime; source: RuntimeSource };

/**
 * `--runtime` > package.json `crust.runtime` > inference > Bun. Inference uses
 * only unambiguous signals: a Deno config file, or `@types/node` without
 * `@types/bun`. Lockfiles say which package manager installed dependencies,
 * not which runtime runs the CLI, so they are not consulted.
 */
export function resolveBuildRuntime(
	pkg: JsonValue | undefined,
	cwd: string,
	override?: BuildRuntime,
): ResolvedRuntime {
	// --runtime is validated by the flag's `choices`; no re-check needed here.
	if (override !== undefined) return { runtime: override, source: "from --runtime" };
	const configured = pkg === undefined ? undefined : getConfiguredRuntime(pkg);
	if (configured !== undefined) {
		if (isBuildRuntime(configured)) return { runtime: configured, source: "from package.json" };
		throw new Error(
			`Invalid package.json crust.runtime ${JSON.stringify(configured)}. Valid runtimes: ${BUILD_RUNTIMES.join(", ")}`,
		);
	}
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

export type BuildFlags = {
	entry: string;
	outfile?: string;
	minify?: boolean;
	runtime?: BuildRuntime;
	target?: string[];
	validate: boolean;
	"env-file"?: string[];
	"bun-plugin"?: string[];
};

type CommonBuildPlan = {
	cwd: string;
	userPackageJson: JsonValue | undefined;
	runtimeSource: RuntimeSource;
	entryPath: string;
	envFiles: string[];
	bunPlugins: string[];
	/** Where Extension build hooks write: `.crust/artifacts`. */
	outDir: string;
	validate: boolean;
	minify: boolean;
};

/** Default: the publishable `.crust/` tree (root package + platform packages for Bun/Deno). */
export type StagedBuildPlan = CommonBuildPlan & { stageDir: string } & (
		| { runtime: "bun"; targets: BunTarget[] }
		| { runtime: "deno"; targets: DenoTarget[] }
		| { runtime: "node" }
	);

/** `--outfile`: one artifact at an exact path, no staging. */
export type OutfileBuildPlan = CommonBuildPlan & { outfilePath: string } & (
		| { runtime: "bun"; target: BunTarget }
		| { runtime: "deno"; target: DenoTarget }
		| { runtime: "node" }
	);

export type BuildPlan = StagedBuildPlan | OutfileBuildPlan;

/** The single `--target`, or the host target when omitted. */
function resolveOutfileTarget<T extends string>(
	table: TargetTable<T>,
	targetFlags: string[] | undefined,
): T {
	if (!targetFlags?.length) {
		const host = hostTarget(table);
		if (host === null) {
			throw new Error(
				`No ${table.runtime} target matches this machine (${process.platform}-${process.arch}).\n  Pass --target <target> with --outfile.`,
			);
		}
		return host;
	}
	const targets = resolveTargets(table, targetFlags);
	if (targets.length > 1) {
		throw new Error(
			"--outfile builds exactly one target.\n  Pass a single --target, or omit --target to build for this machine.",
		);
	}
	return targets[0]!;
}

function withExecutableExtension<T extends string>(
	table: TargetTable<T>,
	target: T,
	outfilePath: string,
): string {
	return table.info[target].os === "win32" && !outfilePath.endsWith(".exe")
		? `${outfilePath}.exe`
		: outfilePath;
}

export function planBuild(flags: BuildFlags, cwd: string): BuildPlan {
	const userPackageJson = readUserPackageJson(cwd);
	const { runtime, source: runtimeSource } = resolveBuildRuntime(
		userPackageJson,
		cwd,
		flags.runtime,
	);
	const entryPath = resolve(cwd, flags.entry);
	const envFiles = resolveEnvFilePaths(cwd, flags["env-file"]);

	if (!existsSync(entryPath)) {
		throw new Error(
			`Entry file not found: ${entryPath}\n  Specify a valid entry file with --entry <path>`,
		);
	}
	if (runtime === "node" && flags.target?.length) {
		throw new Error(
			"--target cannot be used with --runtime node.\n  Node builds produce one portable JavaScript artifact.",
		);
	}
	if (runtime === "deno" && flags.minify) {
		throw new Error(
			"--minify is not supported with --runtime deno.\n  deno compile has no minification step; drop the flag.",
		);
	}
	if (runtime === "deno" && envFiles.length > 0) {
		throw new Error(
			"--env-file is not supported with --runtime deno.\n" +
				"  deno compile embeds every variable from the file into the binary — secrets included —\n" +
				"  with no PUBLIC_* filter. Load configuration at runtime instead (e.g. deno run --env-file).",
		);
	}
	const bunPlugins = flags["bun-plugin"] ?? [];
	if (runtime === "deno" && bunPlugins.length > 0) {
		throw new Error(
			"--bun-plugin is not supported with --runtime deno.\n  deno compile has no Bun bundler; drop the flag or build with --runtime bun.",
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
		outDir: join(stageDir, "artifacts"),
		validate: flags.validate,
		minify: runtime === "deno" ? false : (flags.minify ?? true),
	};

	if (flags.outfile !== undefined) {
		const outfilePath = resolve(cwd, flags.outfile);
		if (runtime === "node") return { ...common, runtime, outfilePath };
		if (runtime === "bun") {
			const target = resolveOutfileTarget(BUN_TARGETS, flags.target);
			assertTargetsBuildableWithoutBun([target]);
			return {
				...common,
				runtime,
				target,
				outfilePath: withExecutableExtension(BUN_TARGETS, target, outfilePath),
			};
		}
		const target = resolveOutfileTarget(DENO_TARGETS, flags.target);
		return {
			...common,
			runtime,
			target,
			outfilePath: withExecutableExtension(DENO_TARGETS, target, outfilePath),
		};
	}

	if (runtime === "node") return { ...common, runtime, stageDir };
	if (runtime === "bun") {
		const targets = resolveTargets(BUN_TARGETS, flags.target);
		assertTargetsBuildableWithoutBun(targets);
		return { ...common, runtime, targets, stageDir };
	}
	return { ...common, runtime, targets: resolveTargets(DENO_TARGETS, flags.target), stageDir };
}

/** Bun and Deno stage platform packages behind a Node launcher; Node stages a root-only bundle. */
async function runStagedBuild(plan: StagedBuildPlan, cwd: string, io: InvocationIO): Promise<void> {
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

async function runOutfileBuild(
	plan: OutfileBuildPlan,
	cwd: string,
	io: InvocationIO,
): Promise<void> {
	io.stdout(`Building ${dim(plan.entryPath)} ${cyan("→")} ${dim(plan.outfilePath)}...`);
	if (plan.runtime === "node") {
		await execNodeBuild(
			plan.entryPath,
			plan.outfilePath,
			plan.minify,
			plan.envFiles,
			cwd,
			plan.bunPlugins,
		);
	} else if (plan.runtime === "bun") {
		await execBuild(
			plan.entryPath,
			plan.outfilePath,
			plan.minify,
			plan.target,
			plan.envFiles,
			cwd,
			plan.bunPlugins,
		);
	} else {
		await execDenoBuild(plan.entryPath, plan.outfilePath, plan.target, cwd);
	}
	io.stdout(`${green("✓")} Built successfully: ${plan.outfilePath}`);
}

// ────────────────────────────────────────────────────────────────────────────
// Build command
// ────────────────────────────────────────────────────────────────────────────

/**
 * The `crust build` command.
 *
 * Stages the publishable npm tree in `.crust/`: a root package whose
 * `bin/<cmd>.js` is a Node launcher (Bun, Deno) or the bundle itself (Node),
 * plus one platform package per target for Bun and Deno. `--outfile` instead
 * writes one binary or bundle to an exact path.
 *
 * @example
 * ```sh
 * crust build                                  # Stage .crust/ for every target of the runtime
 * crust build --target bun-linux-x64           # Stage only Linux x64
 * crust build --entry src/main.ts              # Custom entry point
 * crust build --no-minify                      # Disable minification
 * crust build --outfile ./my-cli               # One binary for this machine
 * crust build --outfile ./my-cli --target bun-linux-x64
 * crust build --runtime deno --target aarch64-apple-darwin
 * crust build --runtime node --outfile out/cli.js
 * crust build --bun-plugin @opentui/solid/bun-plugin    # Bundle with a project Bun plugin
 * ```
 */
export const buildCommand = defineCommand(
	"build",
	{ description: "Build your CLI for Bun, Deno, or Node" },
	(command) =>
		command
			.flags(
				{
					name: "entry",
					type: "string",
					description: "Entry file path",
					default: "src/cli.ts",
					short: "e",
				},
				{
					name: "outfile",
					type: "string",
					description:
						"Write one binary or bundle to this path instead of staging .crust/ (one --target, or this machine's)",
					short: "o",
				},
				{
					name: "minify",
					type: "boolean",
					// No default: deno builds must distinguish an explicit --minify (error)
					// from the implicit bun/node default (true, applied below).
					description: "Minify the output (default for bun and node; unsupported for deno)",
				},
				{
					name: "runtime",
					type: "string",
					choices: BUILD_RUNTIMES,
					description:
						"Build runtime (overrides package.json crust.runtime; otherwise inferred from deno.json or @types/node, defaulting to bun)",
				},
				{
					name: "target",
					type: "string",
					multiple: true,
					description: "Canonical compiler target(s). Omit to build all platforms for Bun or Deno.",
					short: "t",
				},
				{
					name: "validate",
					type: "boolean",
					description:
						"Materialize command definitions before compiling; --no-validate also skips Extension build hooks",
					default: true,
				},
				{
					name: "env-file",
					type: "string",
					multiple: true,
					description: "Explicit env file(s) used for build-time constants; repeatable",
				},
				{
					name: "bun-plugin",
					type: "string",
					multiple: true,
					description:
						"Bun bundler plugin module(s) to apply (default export); repeatable. Bun and Node builds only",
				},
			)
			.action(async ({ flags, stdout, stderr }) => {
				const cwd = process.cwd();
				const io = { stdout, stderr };
				const plan = planBuild(flags, cwd);
				stdout(`${dim("Runtime:")} ${plan.runtime} ${dim(`(${plan.runtimeSource})`)}`);
				// Wipe once, before Extension hooks fill .crust/artifacts; staging only adds to the tree.
				if (!("outfilePath" in plan)) rmSync(plan.stageDir, { recursive: true, force: true });
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
				if ("outfilePath" in plan) await runOutfileBuild(plan, cwd, io);
				else await runStagedBuild(plan, cwd, io);
			}),
);
