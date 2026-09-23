import {
	copyFileSync,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	realpathSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { BuildReport, InvocationIO } from "@crustjs/core";
import { bold, cyan, dim, green } from "@crustjs/style";
import { isJsonObject, type JsonObject, type JsonValue } from "@crustjs/utils/json";
import { isWithin } from "@crustjs/utils/path";

import type { TargetInfo, TargetTable } from "./build-helpers.ts";

/** Project-relative directory that `crust build` owns: wiped per build, read by `crust publish`. */
export const CRUST_DIR = ".crust";

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
	description?: string;
	license?: string;
	author?: JsonValue;
	homepage?: string;
	bugs?: JsonValue;
	repository?: JsonValue;
	keywords?: string[];
	publishConfig?: Record<string, JsonValue>;
	funding?: JsonValue;
	engines?: Record<string, string>;
};

type RootPublishPackageJson = PublishPackageMetadata & {
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

type UserPackageJson = Omit<PublishPackageMetadata, "bin" | "type"> & {
	type?: "module" | "commonjs";
	bin?: JsonValue;
	exports?: JsonValue;
	peerDependencies?: JsonValue;
	peerDependenciesMeta?: JsonValue;
	optionalDependencies?: Record<string, string>;
	os?: [NpmOs];
	cpu?: [NpmCpu];
	libc?: [NpmLibc];
};

/** Top-level directories and `man/` pages staged into the root package's `files`/`man` fields. */
type StagingOptions = { artifactDirs: readonly string[]; manPages: readonly string[] };

type DistributionMetadata = {
	rootPackageName: string;
	version: string;
	/** Metadata shared by the root and every platform package. */
	rootPackageJson: PublishPackageMetadata;
	/** The source scope for included library files; generated CLI files always use ESM. */
	sourceType: UserPackageJson["type"];
	/** The user's `exports`, root package only; validated against the staged tree. */
	exports?: JsonValue;
	/** The user's `peerDependencies`/`peerDependenciesMeta`, root package only; publishable ranges. */
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: JsonObject;
};

type DistributionTarget<T extends string = string> = {
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

function readPackageJson(cwd: string, packageJson: JsonValue | undefined): UserPackageJson {
	if (packageJson === undefined) {
		throw new Error(
			`package.json not found in ${cwd}\n  crust build requires a package.json with name and version fields.`,
		);
	}
	if (!isJsonObject(packageJson)) {
		throw new Error(`package.json in ${cwd} must contain a JSON object.`);
	}

	validatePackageIdentity(packageJson, "package.json");
	// Optional npm metadata is copied without interpretation.
	return packageJson;
}

/** Only identity is interpreted here; this is not a complete npm schema validator. */
export function validatePackageIdentity(
	value: JsonValue | undefined,
	source: string,
): asserts value is JsonObject & { name: string; version: string } {
	if (value === undefined || !isJsonObject(value)) {
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

/** Platform binary filename: `<command>-<target>`, `.exe` on Windows. */
function binaryFilename(command: string, target: DistributionTarget): string {
	return `${command}-${target.target}${target.os === "win32" ? ".exe" : ""}`;
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
	sourceType: UserPackageJson["type"],
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
 * Carries `peerDependencies` (and `peerDependenciesMeta`) into the root package
 * so a library `exports` entry can declare what its published types import.
 * Ranges must be publishable as written: the staged manifests go to npm
 * directly, so `workspace:` and `catalog:` ranges would leak into the registry.
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
		if (!isString(range) || /^(workspace|catalog):/.test(range)) {
			throw new Error(
				`package.json peerDependencies[${JSON.stringify(name)}] must be a publishable range, not ${JSON.stringify(range)}.\n  crust build publishes the staged root package as written; workspace: and catalog: ranges are never rewritten.`,
			);
		}
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

function pickRootMetadata(pkgJson: UserPackageJson): PublishPackageMetadata {
	const metadata: PublishPackageMetadata = {
		name: pkgJson.name,
		version: pkgJson.version,
	};

	for (const key of METADATA_KEYS) {
		const value = pkgJson[key];
		if (value !== undefined) {
			Object.assign(metadata, { [key]: value });
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

function resolveDistributionMetadata(
	cwd: string,
	userPackageJson: JsonValue | undefined,
): DistributionMetadata {
	const pkgJson = readPackageJson(cwd, userPackageJson);
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

function generateDistributionJsResolver(
	command: string,
	targets: readonly DistributionTarget[],
): string {
	const targetMap = Object.fromEntries(
		targets.map((target) => [
			target.platformKey,
			{
				packagePathSegment: target.packagePathSegment,
				packageName: target.packageName,
				targetAlias: target.targetAlias,
				binaryFilename: binaryFilename(command, target),
			},
		]),
	);
	const supportedPlatforms = targets.map((target) => target.targetAlias).join(", ");

	// The command name is validated by the build planner and embedded as a JSON
	// string literal, never spliced into code.
	return `#!/usr/bin/env node
// Auto-generated by crust build -- do not edit
import { spawn } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const NAME = ${JSON.stringify(command)};
const PLATFORMS = ${JSON.stringify(targetMap, null, "\t")};
const dir = dirname(fileURLToPath(import.meta.url));

// Same check as Bun's own npm installer: glibc reports its version, musl does not.
function isMusl() {
	try {
		const report = process.report?.getReport();
		if (report?.header) return report.header.glibcVersionRuntime === undefined;
	} catch {}
	return existsSync("/etc/alpine-release");
}

const platformKey =
	\`\${process.platform}-\${process.arch}\` + (process.platform === "linux" && isMusl() ? "-musl" : "");
const target = PLATFORMS[platformKey];

if (!target) {
\tconsole.error("[" + NAME + "] Unsupported platform: " + platformKey);
\tconsole.error("[" + NAME + "] Supported platforms: ${supportedPlatforms}");
\tprocess.exit(1);
}

const candidates = [
\t// Hoisted install: the platform package beside this one in node_modules.
\tresolve(dir, "..", "..", target.packagePathSegment, "bin", target.binaryFilename),
\t// Nested install: the platform package under this package's node_modules.
\tresolve(dir, "..", "node_modules", target.packageName, "bin", target.binaryFilename),
\t// In place: the .crust/ tree crust build staged, before any install.
\tresolve(dir, "..", "..", target.targetAlias, "bin", target.binaryFilename),
];
const binPath = candidates.find((candidate) => existsSync(candidate));

if (!binPath) {
\tconsole.error("[" + NAME + "] Missing platform package for " + platformKey);
\tconsole.error("[" + NAME + "] Tried:");
\tfor (const candidate of candidates) console.error("  " + candidate);
\tconsole.error(
\t\t"[" + NAME + "] Reinstall dependencies on this platform and ensure optional dependencies are enabled.",
\t);
\tprocess.exit(1);
}

if (process.platform !== "win32") {
\ttry {
\t\tchmodSync(binPath, 0o755);
\t} catch {
\t\t// Ignore permission adjustment failures and let spawn surface real errors.
\t}
}

const child = spawn(binPath, process.argv.slice(2), {
\tstdio: "inherit",
});

child.on("error", (error) => {
\tconsole.error("[" + NAME + "] Failed to launch binary: " + error.message);
\tprocess.exit(1);
});

child.on("exit", (code, signal) => {
\tif (signal) {
\t\ttry {
\t\t\tprocess.kill(process.pid, signal);
\t\t} catch {
\t\t\tprocess.exit(1);
\t\t}
\t\treturn;
\t}

\tprocess.exit(code ?? 0);
});
`;
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
	commands: readonly string[],
	targets: readonly DistributionTarget[],
	build: Record<string, BuildReport> | undefined,
): DistributionManifest {
	const manifest: DistributionManifest = {
		version: metadata.version,
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

	writeJson(join(stageDir, "manifest.json"), manifest);
	return manifest;
}

function stageDistributionPackages(
	cwd: string,
	stageDir: string,
	metadata: DistributionMetadata,
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
			buildDistributionPlatformPackageJson(metadata, commands, target),
		);
	}

	copyLicense(cwd, [rootDir, ...targets.map((target) => target.packageDir)]);
}

export type DistributeBuildPlan = {
	cwd: string;
	/** Validated package.json `bin` entries, in declaration order; never empty. */
	entries: readonly BinEntry[];
	stageDir: string;
	validate: boolean;
	/** Where Extension build hooks write: `.crust/artifacts`. */
	outDir: string;
	userPackageJson: JsonValue | undefined;
	/** Validated `crust.include` entries; directories staged like Extension artifacts. */
	include: readonly string[];
};

/**
 * How each staged root `bin/<command>.js` gets its content. With a target
 * table it is a generated launcher and `execute` compiles one binary per
 * command per platform package; without one the package is root-only and
 * `execute` writes the command's self-contained bundle to that path (Node).
 */
export type Distribution<T extends string> =
	| {
			table: TargetTable<T>;
			targets: readonly T[];
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
	const metadata = resolveDistributionMetadata(plan.cwd, plan.userPackageJson);
	const commands = plan.entries.map((entry) => entry.command);
	const table = distribution.table;
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
	stageDistributionPackages(plan.cwd, plan.stageDir, metadata, commands, distributionTargets, {
		artifactDirs: [...artifacts.names, ...includeDirs],
		manPages: artifacts.manPages,
	});

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
			writeFileSync(launcherPath, generateDistributionJsResolver(command, distributionTargets), {
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
	writeDistributionManifest(plan.stageDir, metadata, commands, distributionTargets, build);
	const manifestPath = join(plan.stageDir, "manifest.json");
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

/**
 * `crust.include` directories normalized to cwd-relative POSIX names. They are
 * staged exactly like Extension artifacts.
 */
function collectIncludeDirs(
	cwd: string,
	stageDir: string,
	include: readonly string[],
	artifactNames: readonly string[],
): string[] {
	const names = [...artifactNames];
	const includeDirs: string[] = [];
	for (const entry of include) {
		const dir = resolve(cwd, entry);
		const name = relative(cwd, dir);
		if (isAbsolute(entry) || name === "" || !isWithin(cwd, dir)) {
			throw new Error(
				`package.json crust.include entry ${JSON.stringify(entry)} must be a directory inside the project root ${cwd}.`,
			);
		}
		if (!existsSync(dir) || !statSync(dir).isDirectory()) {
			throw new Error(
				`package.json crust.include entry ${JSON.stringify(entry)} is not a directory: ${dir}`,
			);
		}
		// The lexical check above passes a symlink to anywhere, and the staged copy
		// dereferences every symlink it meets, so the directory and everything
		// reachable inside it must really live inside the project too.
		assertResolvesInsideProject(cwd, entry, dir);
		// The build wipes stageDir first, and copying a directory into itself fails midway.
		if (isWithin(stageDir, dir) || isWithin(dir, stageDir)) {
			throw new Error(
				`package.json crust.include entry ${JSON.stringify(entry)} overlaps the build output directory ${stageDir}, which crust build replaces.`,
			);
		}
		if (name.split(sep)[0] === "bin") {
			throw new Error(
				`package.json crust.include entry ${JSON.stringify(entry)} conflicts with the generated npm bin directory.\n  Include a directory with a different top-level name.`,
			);
		}
		const posixName = name.replaceAll(sep, "/");
		// A nested include under an artifact name (or vice versa) would silently merge into it.
		const overlap = names.find(
			(staged) =>
				staged === posixName ||
				staged.startsWith(`${posixName}/`) ||
				posixName.startsWith(`${staged}/`),
		);
		if (overlap !== undefined) {
			throw new Error(
				`package.json crust.include entry ${JSON.stringify(entry)} overlaps "${overlap}", which is already staged (duplicate include or Extension artifact directory).`,
			);
		}
		names.push(posixName);
		includeDirs.push(posixName);
	}
	return includeDirs;
}

/**
 * Walks `dir` the way the dereferencing copy will (through symlinked
 * directories) and rejects any path whose real location leaves the project.
 */
function assertResolvesInsideProject(cwd: string, entry: string, dir: string): void {
	const realCwd = realpathSync(cwd);
	const seen = new Set<string>();
	const walk = (path: string): void => {
		const real = realpathSync(path);
		if (!isWithin(realCwd, real)) {
			throw new Error(
				`package.json crust.include entry ${JSON.stringify(entry)} resolves outside the project root: ${relative(cwd, path)} -> ${real}`,
			);
		}
		// A symlink back to an ancestor would otherwise recurse forever.
		if (seen.has(real) || !statSync(path).isDirectory()) return;
		seen.add(real);
		for (const child of readdirSync(path)) walk(join(path, child));
	};
	walk(dir);
}

export type ArtifactOwner = { command: string; directory: boolean; path: string };

/**
 * Copies one entry's Extension build hook output into the shared artifact
 * directory. Identically spelled directories merge; case-only directory aliases
 * and a file or file/directory mismatch at a path
 * another entry already produced is an error, so no entry's hooks can replace
 * another's output. `owners` tracks case-folded POSIX-relative paths across
 * entries, including directories so file/ancestor conflicts are portable.
 */
export function mergeEntryArtifacts(
	entryOutDir: string,
	artifactDir: string,
	command: string,
	owners: Map<string, ArtifactOwner>,
): void {
	const merge = (relativeDir: string): void => {
		for (const dirent of readdirSync(join(entryOutDir, relativeDir), { withFileTypes: true })) {
			const relativePath = relativeDir ? `${relativeDir}/${dirent.name}` : dirent.name;
			if (!dirent.isDirectory() && !dirent.isFile()) {
				throw new Error(
					`Build artifact "${relativePath}" from bin ${JSON.stringify(command)} must use regular files and directories, not symlinks or other file types.`,
				);
			}
			const source = join(entryOutDir, relativePath);
			const destination = join(artifactDir, relativePath);
			const key = relativePath.toLowerCase();
			const owner = owners.get(key);
			const existing = lstatSync(destination, { throwIfNoEntry: false });
			if (
				(owner && !(dirent.isDirectory() && owner.directory && owner.path === relativePath)) ||
				(existing && !(dirent.isDirectory() && existing.isDirectory()))
			) {
				throw new Error(
					`Build artifact "${relativePath}" is written by both bin ${JSON.stringify(owner?.command ?? "an earlier bin")} and ${JSON.stringify(command)}.\n  Extension build hooks of different commands must write distinct paths under ${artifactDir}.`,
				);
			}
			if (!owner) owners.set(key, { command, directory: dirent.isDirectory(), path: relativePath });
			if (dirent.isDirectory()) {
				mkdirSync(destination, { recursive: true });
				merge(relativePath);
			} else {
				mkdirSync(dirname(destination), { recursive: true });
				copyFileSync(source, destination);
			}
		}
	};
	const root = lstatSync(entryOutDir, { throwIfNoEntry: false });
	if (root === undefined) return;
	if (!root.isDirectory()) {
		throw new Error(
			`Build artifact directory for bin ${JSON.stringify(command)} must be a directory, not a symlink or other file type: ${entryOutDir}`,
		);
	}
	merge("");
}

type CollectedArtifacts = { names: string[]; manPages: string[] };

function collectArtifacts(artifactOutDir: string | undefined): CollectedArtifacts {
	if (!artifactOutDir || !existsSync(artifactOutDir)) {
		return { names: [], manPages: [] };
	}

	// Hooks own unique top-level directories; loose files are ignored. Staged
	// builds clear previous output before hooks run.
	const names = readdirSync(artifactOutDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
	// Staged packages generate their own bin/ (resolver + platform binaries); a
	// hook artifact named bin would merge into it and could overwrite them.
	if (names.includes("bin")) {
		throw new Error(
			`Artifact directory "bin" in ${artifactOutDir} conflicts with the generated npm bin directory.\n  Emit build artifacts under a different top-level name.`,
		);
	}
	const manPages = names.includes("man")
		? readdirSync(join(artifactOutDir, "man"), { withFileTypes: true })
				.filter((entry) => entry.isFile())
				.map((entry) => entry.name)
				.sort()
		: [];

	return { names, manPages };
}
