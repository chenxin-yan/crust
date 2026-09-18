import {
	copyFileSync,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readlinkSync,
	realpathSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { InvocationIO } from "@crustjs/core";
import { bold, cyan, dim, green } from "@crustjs/style";
import { isJsonObject, type JsonValue } from "@crustjs/utils/json";
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

type UserPackageJson = Omit<PublishPackageMetadata, "bin"> & {
	bin?: JsonValue;
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
	rootPackageJson: PublishPackageMetadata;
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

	// SAFETY: required identity fields are validated before use; optional npm metadata is copied without interpretation.
	return packageJson as UserPackageJson;
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
	};

	return rootPackageJson;
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
	if (!pkgJson.name) {
		throw new Error("package.json is missing a name field.");
	}
	if (!pkgJson.version) {
		throw new Error("package.json is missing a version field.");
	}

	validatePackageNameLength(pkgJson.name);

	return {
		rootPackageName: pkgJson.name,
		version: pkgJson.version,
		rootPackageJson: pickRootMetadata(pkgJson),
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

export async function runDistributeBuild<T extends string>(
	plan: DistributeBuildPlan,
	distribution: Distribution<T>,
	io: InvocationIO,
): Promise<void> {
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

	const rootBinDir = join(rootDir, "bin");
	if (table) {
		for (const { command } of plan.entries) {
			writeFileSync(
				join(rootBinDir, `${command}.js`),
				generateDistributionJsResolver(command, distributionTargets),
				{ mode: 0o755 },
			);
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
			}
		}
	} else {
		for (const { command, entryPath } of plan.entries) {
			const rootBinPath = join(rootBinDir, `${command}.js`);
			io.stdout(`  ${cyan("→")} ${bold("root")}: ${dim(rootBinPath)}`);
			await distribution.execute(entryPath, rootBinPath);
		}
	}

	// Written last: `crust publish` treats manifest.json as proof of a complete
	// build, so a failed compile must not leave one behind.
	writeDistributionManifest(plan.stageDir, metadata, commands, distributionTargets);
	const manifestPath = join(plan.stageDir, "manifest.json");
	io.stdout(
		`\n${green("✓")} Staged ${bold(`${distributionTargets.length + 1}`)} npm package(s) successfully:`,
	);
	io.stdout(`  ${rootDir}`);
	for (const targetPackage of distributionTargets) {
		io.stdout(`  ${targetPackage.packageDir}`);
	}
	io.stdout(`\n${dim("Manifest:")} ${manifestPath}`);
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

/**
 * Copies one entry's Extension build hook output into the shared artifact
 * directory. Directories merge; a file, symlink, or file/directory mismatch at
 * a path another entry already produced is an error, so no entry's hooks can
 * replace another's output. `owners` maps merged POSIX-relative paths to the
 * command that wrote them and is shared across the entries of one build.
 *
 * Symlinks are copied as links, never followed. `entryOutDir` is deleted after
 * the merge, so a link's text must not point back into it: relative targets are
 * kept verbatim, absolute targets inside `entryOutDir` are rebased onto
 * `artifactDir`, and any other target is left exactly as the hook wrote it.
 */
export function mergeEntryArtifacts(
	entryOutDir: string,
	artifactDir: string,
	command: string,
	owners: Map<string, string>,
): void {
	const ownerOf = (path: string): string => {
		for (let current = path; ; current = current.slice(0, current.lastIndexOf("/"))) {
			const owner = owners.get(current);
			if (owner !== undefined || !current.includes("/")) return owner ?? "an earlier bin";
		}
	};
	const copyLink = (source: string, destination: string): void => {
		const target = readlinkSync(source);
		const rebased =
			isAbsolute(target) && isWithin(entryOutDir, target)
				? join(artifactDir, relative(entryOutDir, target))
				: target;
		// Windows distinguishes file and directory links; the type comes from what
		// the hook actually linked to, so a dangling link is created as a file link.
		const linked = statSync(source, { throwIfNoEntry: false });
		symlinkSync(rebased, destination, linked?.isDirectory() ? "dir" : "file");
	};
	const merge = (relativeDir: string): void => {
		for (const dirent of readdirSync(join(entryOutDir, relativeDir), { withFileTypes: true })) {
			const relativePath = relativeDir ? `${relativeDir}/${dirent.name}` : dirent.name;
			const source = join(entryOutDir, relativePath);
			const destination = join(artifactDir, relativePath);
			const existing = lstatSync(destination, { throwIfNoEntry: false });
			if (existing === undefined) {
				owners.set(relativePath, command);
				if (dirent.isDirectory()) {
					mkdirSync(destination, { recursive: true });
					merge(relativePath);
				} else if (dirent.isSymbolicLink()) {
					mkdirSync(dirname(destination), { recursive: true });
					copyLink(source, destination);
				} else {
					mkdirSync(dirname(destination), { recursive: true });
					copyFileSync(source, destination);
				}
			} else if (dirent.isDirectory() && existing.isDirectory()) {
				merge(relativePath);
			} else {
				throw new Error(
					`Build artifact "${relativePath}" is written by both bin ${JSON.stringify(ownerOf(relativePath))} and ${JSON.stringify(command)}.\n  Extension build hooks of different commands must write distinct paths under ${artifactDir}.`,
				);
			}
		}
	};
	if (existsSync(entryOutDir)) merge("");
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
