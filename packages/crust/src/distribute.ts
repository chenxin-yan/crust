import { copyFileSync, cpSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { BuildReport, InvocationIO } from "@crustjs/core";
import { bold, cyan, dim, green } from "@crustjs/style";
import { isJsonObject, type JsonObject, type JsonValue } from "@crustjs/utils/json";
import { isWithin } from "@crustjs/utils/path";

import { collectArtifacts, collectIncludeDirs } from "./artifacts.ts";
import { binaryFilename, generateLauncher } from "./launcher.ts";
import type { BuildRuntime, TargetInfo, TargetTable } from "./targets.ts";

/** Project-relative directory that `crust build` owns: wiped per build, read by `crust publish`. */
export const CRUST_DIR = ".crust";

/**
 * What one build distributes: a runtime `package` (a root-only JavaScript
 * bundle that needs the runtime installed) or standalone `binary` executables
 * in platform packages behind a Node launcher.
 */
export const ARTIFACT_KINDS = ["package", "binary"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

const MAX_PACKAGE_NAME_LENGTH = 214;
const METADATA_KEYS = [
	"description",
	"license",
	"author",
	"homepage",
	"bugs",
	"repository",
	"keywords",
	"publishConfig",
	"funding",
	"engines",
] as const;

type NpmOs = TargetInfo["os"];
type NpmCpu = TargetInfo["cpu"];
type NpmLibc = NonNullable<TargetInfo["libc"]>;
type PlatformKey = TargetInfo["platformKey"];
type PublishPackageMetadata = {
	name: string;
	version: string;
	type?: "module";
	files?: string[];
	/** npm man field: paths to man pages, e.g. `./man/mycli.1` */
	man?: string[];
	bin?: Record<string, string>;
	// Optional npm metadata, copied from the user's package.json without interpretation.
} & { [K in (typeof METADATA_KEYS)[number]]?: JsonValue };

type RootPublishPackageJson = PublishPackageMetadata & {
	/** The `crust.external` packages, with the user's ranges; absent when there are none. */
	dependencies?: Record<string, string>;
	/** Absent for a root-only package: npm treats `{}` and a missing field alike, but the manifest stays honest. */
	optionalDependencies?: Record<string, string>;
	/** The user's `exports`, carried only when present and every target is staged; see `validateStagedExports`. */
	exports?: JsonValue;
	/** The user's peer contract for what `exports` references (types, re-exports); see `validatePeerDependencies`. */
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: JsonObject;
	os?: never;
	cpu?: never;
	libc?: never;
};

type PlatformPublishPackageJson = PublishPackageMetadata & {
	os: [NpmOs];
	cpu: [NpmCpu];
	/** Lets npm/pnpm skip the wrong-ABI Linux package; both share `os`/`cpu`. */
	libc?: [NpmLibc];
	optionalDependencies?: never;
};

/** A package.json whose npm identity passed {@link validatePackageIdentity}; other fields are uninterpreted. */
export type IdentifiedPackageJson = JsonObject & { name: string; version: string };

/** Top-level directories and `man/` pages staged into the root package's `files`/`man` fields. */
type StagingOptions = { artifactDirs: readonly string[]; manPages: readonly string[] };

type DistributionMetadata = {
	rootPackageName: string;
	version: string;
	/** Metadata shared by the root and every platform package. */
	rootPackageJson: PublishPackageMetadata;
	/** The source scope for included library files; generated CLI files always use ESM. */
	sourceType: JsonValue | undefined;
	/** The user's `exports`, root package only; validated against the staged tree. */
	exports?: JsonValue;
	/** The user's `peerDependencies`/`peerDependenciesMeta`, root package only; publishable ranges. */
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: JsonObject;
	/** `crust.external` names with their `dependencies` ranges, in `crust.external` order. */
	dependencies?: Record<string, string>;
};

export type DistributionTarget<T extends string = string> = {
	target: T;
	platformKey: PlatformKey;
	targetAlias: string;
	packageName: string;
	packagePathSegment: string;
	packageDir: string;
	os: NpmOs;
	cpu: NpmCpu;
	libc?: NpmLibc;
};

/** One package.json `bin` entry: the installed command name and the source file built for it. */
export type BinEntry = { command: string; entryPath: string };

export type DistributionManifest = {
	version: string;
	runtime: BuildRuntime;
	artifact: ArtifactKind;
	/**
	 * Binary builds only: the runtime version the selected compiler reported and
	 * embedded in every platform binary. Runtime packages embed no runtime.
	 */
	embeddedRuntimeVersion?: string;
	root: {
		name: string;
		dir: string;
		/** Installed command names; each is `bin/<command>.js` in the root package. */
		bins: string[];
	};
	packages: Array<{
		target: string;
		name: string;
		dir: string;
		os: NpmOs;
		cpu: NpmCpu;
		libc?: NpmLibc;
		/** Command name to the platform binary path inside the package. */
		bins: Record<string, string>;
	}>;
	publishOrder: string[];
	/** Extension build hook output per command; absent when `--no-validate` skipped the hooks. */
	build?: Record<string, BuildReport>;
};

/** Only identity is interpreted here; this is not a complete npm schema validator. */
export function validatePackageIdentity(
	value: JsonValue,
	source: string,
): asserts value is IdentifiedPackageJson {
	if (!isJsonObject(value)) {
		throw new Error(`${source} must contain a JSON object.`);
	}
	if (typeof value.name !== "string" || value.name.trim() === "") {
		throw new Error(`${source} name field must be a non-empty string.`);
	}
	if (typeof value.version !== "string" || value.version.trim() === "") {
		throw new Error(`${source} version field must be a non-empty string.`);
	}
}

function isString(value: JsonValue): value is string {
	return typeof value === "string";
}

function derivePlatformPackageName(rootPackageName: string, targetAlias: string): string {
	const [scope, name] = rootPackageName.startsWith("@")
		? rootPackageName.split("/")
		: [undefined, rootPackageName];
	const suffixedName = `${name}-${targetAlias}`;
	return scope ? `${scope}/${suffixedName}` : suffixedName;
}

function getPackagePathSegment(packageName: string): string {
	return packageName.startsWith("@") ? (packageName.split("/")[1] ?? packageName) : packageName;
}

function platformBinMap(
	commands: readonly string[],
	target: DistributionTarget,
): Record<string, string> {
	return Object.fromEntries(
		commands.map((command) => [command, `bin/${binaryFilename(command, target)}`]),
	);
}

function buildDistributionRootPackageJson(
	metadata: DistributionMetadata,
	commands: readonly string[],
	targets: readonly DistributionTarget[],
	{ artifactDirs, manPages }: StagingOptions,
): RootPublishPackageJson {
	const rootPackageJson: RootPublishPackageJson = {
		...metadata.rootPackageJson,
		name: metadata.rootPackageName,
		version: metadata.version,
		type: "module",
		files: ["bin", ...artifactDirs],
		bin: Object.fromEntries(commands.map((command) => [command, `bin/${command}.js`])),
		dependencies: metadata.dependencies,
		...(targets.length > 0
			? {
					optionalDependencies: Object.fromEntries(
						targets.map((target) => [target.packageName, metadata.version]),
					),
				}
			: {}),
		...(manPages.length > 0 ? { man: manPages.map((page) => `./man/${page}`) } : {}),
		exports: metadata.exports,
		peerDependencies: metadata.peerDependencies,
		peerDependenciesMeta: metadata.peerDependenciesMeta,
	};

	return rootPackageJson;
}

/**
 * Node rejects export targets whose segments are `.`, `..`, `node_modules`, or
 * empty (`ERR_INVALID_PACKAGE_TARGET`), also percent-encoded, even when the path
 * normalizes to a staged file, so filesystem checks alone would pass a target
 * consumers cannot import.
 */
function hasNodeInvalidSegment(target: string): boolean {
	return target
		.slice("./".length)
		.split(/[\\/]/)
		.some((segment) => {
			let decoded = segment;
			try {
				decoded = decodeURIComponent(segment);
			} catch {
				// Malformed escapes are compared as written.
			}
			return /^(\.\.?|node_modules|)$/i.test(decoded);
		});
}

/**
 * Checks a package.json `exports` map against the staged root package: every
 * target must be a `./`-relative path to a file that staging copied there (a
 * `crust.include` directory or Extension artifact), so the published root
 * package resolves exactly what the project's own `exports` promises. `null`
 * targets (blocked subpaths) and nested condition objects are allowed;
 * fallback arrays and `*` patterns are rejected rather than half-checked.
 */
function validateStagedExports(
	exports: JsonValue,
	rootDir: string,
	sourceType: JsonValue | undefined,
): void {
	const fail = (detail: string): never => {
		throw new Error(
			`package.json exports ${detail}\n  crust build stages only bin/, Extension artifacts, and crust.include directories into the root package; point exports at a crust.include directory or remove the field.`,
		);
	};
	const checkTarget = (target: JsonValue, at: string): void => {
		if (target === null) return;
		if (isString(target)) {
			const staged = resolve(rootDir, target);
			if (!target.startsWith("./") || !isWithin(rootDir, staged)) {
				fail(
					`target ${JSON.stringify(target)} (${at}) must be a ./-relative path inside the package.`,
				);
			}
			if (target.includes("*")) {
				fail(
					`target ${JSON.stringify(target)} (${at}) uses a pattern, which crust build does not support.`,
				);
			}
			if (hasNodeInvalidSegment(target)) {
				fail(
					`target ${JSON.stringify(target)} (${at}) contains a path segment Node rejects (".", "..", "node_modules", or empty).`,
				);
			}
			if (!existsSync(staged) || !statSync(staged).isFile()) {
				fail(`target ${JSON.stringify(target)} (${at}) is not a staged file: ${staged}`);
			}
			if (sourceType !== "module" && (target.endsWith(".js") || target.endsWith(".d.ts"))) {
				// Copied nested package scopes survive staging; the generated root scope does not.
				let scope = dirname(staged);
				while (scope !== rootDir && !existsSync(join(scope, "package.json"))) {
					scope = dirname(scope);
				}
				if (scope === rootDir) {
					fail(
						`target ${JSON.stringify(target)} (${at}) would change module format under the staged root's type: "module". Use .cjs/.d.cts for CommonJS, or include a nested package.json declaring the library's type.`,
					);
				}
			}
			return;
		}
		if (!isJsonObject(target)) {
			fail(`${at} must be a path, null, or a conditions object, not ${JSON.stringify(target)}.`);
		}
		for (const [condition, value] of Object.entries(target)) {
			if (condition.startsWith(".")) {
				fail(`${at} mixes subpath ${JSON.stringify(condition)} into a conditions object.`);
			}
			checkTarget(value, `${at} -> ${condition}`);
		}
	};

	if (isJsonObject(exports) && Object.keys(exports).some((key) => key.startsWith("."))) {
		for (const [subpath, target] of Object.entries(exports)) {
			if (!subpath.startsWith(".")) {
				fail(`mixes condition ${JSON.stringify(subpath)} with subpath keys.`);
			}
			checkTarget(target, subpath);
		}
		return;
	}
	checkTarget(exports, '"."');
}

/**
 * The staged manifests go to npm as written, so a range the registry cannot
 * resolve (a workspace, catalog, or local path protocol) would leak into it.
 * Bare paths and scheme-less tarball names are local too, except GitHub
 * owner/repo[#ref] shorthand: npm resolves hosted Git before its file fallback.
 */
export function assertPublishableRange(
	range: JsonValue | undefined,
	label: string,
): asserts range is string {
	if (
		range === undefined ||
		!isString(range) ||
		/^(?:(?:workspace|catalog|file|link|portal):|[.]|~[/\\]|[/\\]|[a-zA-Z]:)/.test(range) ||
		(!/^[a-z][a-z+]*:/i.test(range) &&
			!/^[^@\s/:#\\]+\/[^@\s/:#\\]+(?:#.*)?$/.test(range) &&
			/[.](?:tgz|tar\.gz|tar)$/i.test(range))
	) {
		throw new Error(
			`${label} must be a publishable range, not ${JSON.stringify(range)}.\n  crust build publishes the staged root package as written; workspace:, catalog:, file:, link:, portal:, and local path ranges are never rewritten.`,
		);
	}
}

/**
 * Carries `peerDependencies` (and `peerDependenciesMeta`) into the root package
 * so a library `exports` entry can declare what its published types import.
 */
function validatePeerDependencies(
	peerDependencies: JsonValue,
	peerDependenciesMeta: JsonValue | undefined,
): Pick<DistributionMetadata, "peerDependencies" | "peerDependenciesMeta"> {
	if (!isJsonObject(peerDependencies)) {
		throw new Error("package.json peerDependencies must be an object of package names to ranges.");
	}
	const ranges: Record<string, string> = {};
	for (const [name, range] of Object.entries(peerDependencies)) {
		assertPublishableRange(range, `package.json peerDependencies[${JSON.stringify(name)}]`);
		ranges[name] = range;
	}
	if (peerDependenciesMeta === undefined) return { peerDependencies: ranges };
	if (!isJsonObject(peerDependenciesMeta)) {
		throw new Error("package.json peerDependenciesMeta must be an object keyed by peer name.");
	}
	for (const name of Object.keys(peerDependenciesMeta)) {
		if (!Object.hasOwn(ranges, name)) {
			throw new Error(
				`package.json peerDependenciesMeta[${JSON.stringify(name)}] has no matching peerDependencies entry.`,
			);
		}
	}
	return { peerDependencies: ranges, peerDependenciesMeta };
}

function buildDistributionPlatformPackageJson(
	metadata: DistributionMetadata,
	commands: readonly string[],
	target: DistributionTarget,
): PlatformPublishPackageJson {
	return {
		...metadata.rootPackageJson,
		name: target.packageName,
		version: metadata.version,
		files: ["bin"],
		bin: platformBinMap(commands, target),
		os: [target.os],
		cpu: [target.cpu],
		...(target.libc ? { libc: [target.libc] } : {}),
	};
}

function pickRootMetadata(pkgJson: IdentifiedPackageJson): PublishPackageMetadata {
	const metadata: PublishPackageMetadata = {
		name: pkgJson.name,
		version: pkgJson.version,
	};

	for (const key of METADATA_KEYS) {
		const value = pkgJson[key];
		if (value !== undefined) {
			metadata[key] = value;
		}
	}

	return metadata;
}

function validatePackageNameLength(packageName: string): void {
	if (packageName.length > MAX_PACKAGE_NAME_LENGTH) {
		throw new Error(
			`Generated package name is too long for npm: ${packageName}\n  Keep package names at or below ${MAX_PACKAGE_NAME_LENGTH} characters after the platform suffix is added.`,
		);
	}
}

/** `crust.external` ranges, already validated by `planBuild`; re-asserted for their type. */
function externalDependencies(
	pkgJson: IdentifiedPackageJson,
	external: readonly string[],
): Record<string, string> {
	const dependencies =
		pkgJson.dependencies !== undefined && isJsonObject(pkgJson.dependencies)
			? pkgJson.dependencies
			: {};
	return Object.fromEntries(
		external.map((name) => {
			const range = dependencies[name];
			assertPublishableRange(range, `package.json dependencies[${JSON.stringify(name)}]`);
			return [name, range];
		}),
	);
}

function resolveDistributionMetadata(
	pkgJson: IdentifiedPackageJson,
	external: readonly string[],
): DistributionMetadata {
	validatePackageNameLength(pkgJson.name);

	return {
		rootPackageName: pkgJson.name,
		version: pkgJson.version,
		rootPackageJson: pickRootMetadata(pkgJson),
		sourceType: pkgJson.type,
		...(pkgJson.exports !== undefined ? { exports: pkgJson.exports } : {}),
		...(pkgJson.peerDependencies !== undefined
			? validatePeerDependencies(pkgJson.peerDependencies, pkgJson.peerDependenciesMeta)
			: {}),
		...(external.length > 0 ? { dependencies: externalDependencies(pkgJson, external) } : {}),
	};
}

function resolveDistributionTarget<T extends string>(
	table: TargetTable<T>,
	stageDir: string,
	rootPackageName: string,
	target: T,
): DistributionTarget<T> {
	const info = table.info[target];
	const packageName = derivePlatformPackageName(rootPackageName, info.alias);
	validatePackageNameLength(packageName);

	return {
		target,
		platformKey: info.platformKey,
		targetAlias: info.alias,
		packageName,
		packagePathSegment: getPackagePathSegment(packageName),
		packageDir: resolve(stageDir, info.alias),
		os: info.os,
		cpu: info.cpu,
		...(info.libc ? { libc: info.libc } : {}),
	};
}

function writeJson<T>(path: string, value: T): void {
	writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`);
}

function copyRootReadme(cwd: string, rootDir: string): void {
	const readmePath = join(cwd, "README.md");
	if (existsSync(readmePath)) {
		copyFileSync(readmePath, join(rootDir, "README.md"));
	}
}

function copyLicense(cwd: string, packageDirs: readonly string[]): void {
	const licenseName = ["LICENSE", "LICENSE.md", "LICENCE", "LICENCE.md"].find((name) =>
		existsSync(join(cwd, name)),
	);
	if (!licenseName) return;
	const licensePath = join(cwd, licenseName);

	for (const packageDir of packageDirs) {
		copyFileSync(licensePath, join(packageDir, licenseName));
	}
}

function writeDistributionManifest(
	stageDir: string,
	metadata: DistributionMetadata,
	identity: Pick<DistributionManifest, "runtime" | "artifact" | "embeddedRuntimeVersion">,
	commands: readonly string[],
	targets: readonly DistributionTarget[],
	build: Record<string, BuildReport> | undefined,
): string {
	const manifest: DistributionManifest = {
		version: metadata.version,
		...identity,
		root: {
			name: metadata.rootPackageName,
			dir: "root",
			bins: [...commands],
		},
		packages: targets.map((target) => ({
			target: target.targetAlias,
			name: target.packageName,
			dir: target.targetAlias,
			os: target.os,
			cpu: target.cpu,
			...(target.libc ? { libc: target.libc } : {}),
			bins: platformBinMap(commands, target),
		})),
		publishOrder: [...targets.map((target) => target.targetAlias), "root"],
		...(build ? { build } : {}),
	};

	const manifestPath = join(stageDir, "manifest.json");
	writeJson(manifestPath, manifest);
	return manifestPath;
}

/** `pkg` without `engines.node`, dropping `engines` once nothing else is left. */
function omitNodeEngine(pkg: PublishPackageMetadata): PublishPackageMetadata {
	const { engines, ...rest } = pkg;
	if (engines === undefined || !isJsonObject(engines) || engines.node === undefined) return pkg;
	const others = Object.entries(engines).filter(([runtime]) => runtime !== "node");
	return others.length > 0 ? { ...rest, engines: Object.fromEntries(others) } : rest;
}

function stageDistributionPackages(
	cwd: string,
	stageDir: string,
	metadata: DistributionMetadata,
	platformMetadata: DistributionMetadata,
	commands: readonly string[],
	targets: readonly DistributionTarget[],
	options: StagingOptions,
): void {
	// No wipe here: the build command clears stageDir before Extension hooks fill
	// stageDir/artifacts, which this function reads.
	const rootDir = join(stageDir, "root");
	const rootBinDir = join(rootDir, "bin");
	mkdirSync(rootBinDir, { recursive: true });

	writeJson(
		join(rootDir, "package.json"),
		buildDistributionRootPackageJson(metadata, commands, targets, options),
	);
	copyRootReadme(cwd, rootDir);

	for (const target of targets) {
		mkdirSync(join(target.packageDir, "bin"), { recursive: true });
		writeJson(
			join(target.packageDir, "package.json"),
			buildDistributionPlatformPackageJson(platformMetadata, commands, target),
		);
	}

	copyLicense(cwd, [rootDir, ...targets.map((target) => target.packageDir)]);
}

export type DistributeBuildPlan = {
	cwd: string;
	/** Validated package.json `bin` entries, in declaration order; never empty. */
	entries: readonly BinEntry[];
	stageDir: string;
	/** Application runtime recorded in `manifest.json`. */
	runtime: BuildRuntime;
	validate: boolean;
	/** Where Extension build hooks write: `.crust/artifacts`. */
	outDir: string;
	userPackageJson: IdentifiedPackageJson;
	/** Validated `crust.include` entries; directories staged like Extension artifacts. */
	include: readonly string[];
	/** Validated `crust.external` names, shipped as root `dependencies`; empty for binaries. */
	external: readonly string[];
};

/**
 * How each staged root `bin/<command>.js` gets its content. With a target
 * table (binary artifact) it is a generated launcher and `execute` compiles
 * one binary per command per platform package; without one (package
 * artifact) the package is root-only and `execute` writes the command's
 * self-contained bundle to that path.
 */
export type Distribution<T extends string> =
	| {
			table: TargetTable<T>;
			targets: readonly T[];
			/** Version the selected compiler embeds; recorded in `manifest.json`. */
			embeddedRuntimeVersion: string;
			execute: (entryPath: string, outfilePath: string, target: T) => Promise<void>;
	  }
	| {
			table?: undefined;
			execute: (entryPath: string, outfilePath: string) => Promise<void>;
	  };

/**
 * One file `crust build` generated or compiled into the staged tree. `target`
 * is the canonical compiler target of a platform package (`bun-linux-x64`),
 * absent for the root package. Extension build hook output is reported by
 * command in the `BuildReport`s instead, not repeated here.
 */
export type BuildArtifact =
	| { kind: "package-json"; path: string; target?: string }
	| { kind: "launcher"; path: string; command: string }
	| { kind: "executable"; path: string; command: string; target: string }
	| { kind: "bundle"; path: string; command: string };

/**
 * Stages the npm tree in `plan.stageDir`. `build` is each command's Extension
 * build hook report, recorded in `manifest.json`; omit it when the hooks did not run.
 * Returns every generated package.json, launcher, and compiled command in staging order.
 */
export async function runDistributeBuild<T extends string>(
	plan: DistributeBuildPlan,
	distribution: Distribution<T>,
	io: InvocationIO,
	build?: Record<string, BuildReport>,
): Promise<BuildArtifact[]> {
	const sourceMetadata = resolveDistributionMetadata(plan.userPackageJson, plan.external);
	const commands = plan.entries.map((entry) => entry.command);
	const table = distribution.table;
	// A Node binary embeds the Node that engines.node was checked against; its
	// users need only the launcher's Node. The root keeps engines.node for the
	// consumers of a staged library `exports`, which run on their own Node.
	const platformMetadata =
		plan.runtime === "node" && table
			? { ...sourceMetadata, rootPackageJson: omitNodeEngine(sourceMetadata.rootPackageJson) }
			: sourceMetadata;
	const metadata = sourceMetadata.exports === undefined ? platformMetadata : sourceMetadata;
	const distributionTargets = table
		? distribution.targets.map((target) =>
				resolveDistributionTarget(table, plan.stageDir, metadata.rootPackageName, target),
			)
		: [];

	io.stdout(
		table
			? `Staging ${bold(`${distributionTargets.length}`)} distribution target(s) in ${dim(plan.stageDir)}...`
			: `Staging a root-only npm package in ${dim(plan.stageDir)}...`,
	);

	const artifactOutDir = plan.validate ? plan.outDir : undefined;
	const artifacts = collectArtifacts(artifactOutDir);
	const includeDirs = collectIncludeDirs(plan.cwd, plan.stageDir, plan.include, artifacts.names);
	stageDistributionPackages(
		plan.cwd,
		plan.stageDir,
		metadata,
		platformMetadata,
		commands,
		distributionTargets,
		{
			artifactDirs: [...artifacts.names, ...includeDirs],
			manPages: artifacts.manPages,
		},
	);

	const rootDir = join(plan.stageDir, "root");
	const produced: BuildArtifact[] = [
		{ kind: "package-json", path: join(rootDir, "package.json") },
		...distributionTargets.map((targetPackage): BuildArtifact => ({
			kind: "package-json",
			path: join(targetPackage.packageDir, "package.json"),
			target: targetPackage.target,
		})),
	];
	// Only crust.include trees are dereferenced: collectIncludeDirs proved every
	// symlink inside them resolves into the project. Artifact trees are not
	// validated, so a symlink there is copied as a link rather than followed, with
	// its target text kept verbatim (cpSync would otherwise rewrite a relative
	// link into an absolute path back into .crust/artifacts).
	const copies = [
		...(artifactOutDir
			? artifacts.names.map((name) => ({
					name,
					sourceDir: join(artifactOutDir, name),
					dereference: false,
				}))
			: []),
		...includeDirs.map((name) => ({ name, sourceDir: join(plan.cwd, name), dereference: true })),
	];
	for (const { name, sourceDir, dereference } of copies) {
		const options = { recursive: true, dereference, verbatimSymlinks: !dereference };
		cpSync(sourceDir, join(rootDir, name), options);
		// resolveArtifactDir (core) computes `<root>/<name>` from a Node bundle but
		// `dirname(process.execPath)/<name>` from a compiled binary, which is a
		// platform package's bin dir — the root package is unreachable from there,
		// so each platform package ships its own copy of the artifacts.
		for (const targetPackage of distributionTargets) {
			cpSync(sourceDir, join(targetPackage.packageDir, "bin", name), options);
		}
	}
	// After the copies so targets can be checked against the staged files, before
	// compiling so a bad exports map fails without paying for the binaries.
	if (metadata.exports !== undefined) {
		validateStagedExports(metadata.exports, rootDir, metadata.sourceType);
	}

	const rootBinDir = join(rootDir, "bin");
	if (table) {
		for (const { command } of plan.entries) {
			const launcherPath = join(rootBinDir, `${command}.js`);
			writeFileSync(launcherPath, generateLauncher(command, distributionTargets), {
				mode: 0o755,
			});
			produced.push({ kind: "launcher", path: launcherPath, command });
		}
		for (const targetPackage of distributionTargets) {
			for (const { command, entryPath } of plan.entries) {
				const outfilePath = join(
					targetPackage.packageDir,
					"bin",
					binaryFilename(command, targetPackage),
				);
				io.stdout(`  ${cyan("→")} ${bold(targetPackage.targetAlias)}: ${dim(outfilePath)}`);
				await distribution.execute(entryPath, outfilePath, targetPackage.target);
				produced.push({
					kind: "executable",
					path: outfilePath,
					command,
					target: targetPackage.target,
				});
			}
		}
	} else {
		for (const { command, entryPath } of plan.entries) {
			const rootBinPath = join(rootBinDir, `${command}.js`);
			io.stdout(`  ${cyan("→")} ${bold("root")}: ${dim(rootBinPath)}`);
			await distribution.execute(entryPath, rootBinPath);
			produced.push({ kind: "bundle", path: rootBinPath, command });
		}
	}

	// Written last: `crust publish` treats manifest.json as proof of a complete
	// build, so a failed compile must not leave one behind.
	const manifestPath = writeDistributionManifest(
		plan.stageDir,
		metadata,
		table
			? {
					runtime: plan.runtime,
					artifact: "binary",
					embeddedRuntimeVersion: distribution.embeddedRuntimeVersion,
				}
			: { runtime: plan.runtime, artifact: "package" },
		commands,
		distributionTargets,
		build,
	);
	io.stdout(
		`\n${green("✓")} Staged ${bold(`${distributionTargets.length + 1}`)} npm package(s) successfully:`,
	);
	io.stdout(`  ${rootDir}`);
	for (const targetPackage of distributionTargets) {
		io.stdout(`  ${targetPackage.packageDir}`);
	}
	io.stdout(`\n${dim("Manifest:")} ${manifestPath}`);
	return produced;
}
