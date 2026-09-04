import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

import type { InvocationIO } from "@crustjs/core";
import { bold, cyan, dim, green } from "@crustjs/style";
import { isJsonObject, type JsonValue } from "@crustjs/utils/json";
import { isWithin } from "@crustjs/utils/path";

import {
	binaryFilename,
	BUN_TARGETS,
	type BunTarget,
	execBuild,
	resolveBaseName,
	type TargetInfo,
} from "./build-helpers.ts";

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
type PlatformKey = (typeof BUN_TARGETS.info)[BunTarget]["platformKey"];
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
	optionalDependencies: Record<string, string>;
	os?: never;
	cpu?: never;
};

type PlatformPublishPackageJson = PublishPackageMetadata & {
	os: [NpmOs];
	cpu: [NpmCpu];
	optionalDependencies?: never;
};

type UserPackageJson = Omit<PublishPackageMetadata, "bin"> & {
	bin?: string | Record<string, string>;
	optionalDependencies?: Record<string, string>;
	os?: [NpmOs];
	cpu?: [NpmCpu];
};

type DistributionMetadata = {
	commandName: string;
	rootPackageName: string;
	version: string;
	baseName: string;
	rootPackageJson: PublishPackageMetadata;
};

type DistributionTarget = {
	target: BunTarget;
	platformKey: PlatformKey;
	targetAlias: string;
	packageName: string;
	packagePathSegment: string;
	packageDir: string;
	binaryRelativePath: string;
	binaryFilename: string;
	os: NpmOs;
	cpu: NpmCpu;
};

export type DistributionManifest = {
	version: string;
	root: {
		name: string;
		dir: string;
		bin: string;
	};
	packages: Array<{
		target: string;
		name: string;
		dir: string;
		os: NpmOs;
		cpu: NpmCpu;
		bin: string;
	}>;
	publishOrder: string[];
};

function readPackageJson(cwd: string, packageJson: JsonValue | undefined): UserPackageJson {
	if (packageJson === undefined) {
		throw new Error(
			`package.json not found in ${cwd}\n  crust build --package requires a package.json with name and version fields.`,
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

function isBinPath(bin: UserPackageJson["bin"]): bin is string {
	return typeof bin === "string";
}

function inferCommandName(
	rootPackageName: string,
	bin: UserPackageJson["bin"],
	baseName: string,
): string {
	if (!bin) return baseName;

	if (isBinPath(bin)) {
		return rootPackageName.replace(/^@[^/]+\//, "");
	}

	const entries = Object.keys(bin);
	if (entries.length !== 1) {
		throw new Error(
			"crust build --package currently supports exactly one bin entry.\n  Use a single bin command in package.json for split-package publishing.",
		);
	}

	const entry = entries[0];
	if (!entry) {
		throw new Error("Failed to resolve the bin command name from package.json.");
	}

	return entry;
}

function buildDistributionRootPackageJson(
	metadata: DistributionMetadata,
	targets: readonly DistributionTarget[],
	options?: { artifactDirs?: readonly string[]; manPages?: readonly string[] },
): RootPublishPackageJson {
	const artifactDirs = options?.artifactDirs ?? [];
	const manPages = options?.manPages ?? [];
	const rootPackageJson: RootPublishPackageJson = {
		...metadata.rootPackageJson,
		name: metadata.rootPackageName,
		version: metadata.version,
		type: "module",
		files: ["bin", ...artifactDirs],
		bin: {
			[metadata.commandName]: `bin/${metadata.commandName}.js`,
		},
		optionalDependencies: Object.fromEntries(
			targets.map((target) => [target.packageName, metadata.version]),
		),
		...(manPages.length > 0 ? { man: manPages.map((page) => `./man/${page}`) } : {}),
	};

	return rootPackageJson;
}

function buildDistributionPlatformPackageJson(
	metadata: DistributionMetadata,
	target: DistributionTarget,
): PlatformPublishPackageJson {
	return {
		...metadata.rootPackageJson,
		name: target.packageName,
		version: metadata.version,
		files: ["bin"],
		bin: {
			[metadata.commandName]: target.binaryRelativePath,
		},
		os: [target.os],
		cpu: [target.cpu],
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
	entryPath: string,
	name: string | undefined,
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

	const baseName = resolveBaseName(name, entryPath, cwd, userPackageJson);
	const commandName = inferCommandName(pkgJson.name, pkgJson.bin, baseName);
	const rootPackageJson = pickRootMetadata(pkgJson);

	return {
		commandName,
		rootPackageName: pkgJson.name,
		version: pkgJson.version,
		baseName,
		rootPackageJson,
	};
}

function resolveDistributionTarget(
	stageDir: string,
	baseName: string,
	rootPackageName: string,
	target: BunTarget,
): DistributionTarget {
	const info = BUN_TARGETS.info[target];
	const packageName = derivePlatformPackageName(rootPackageName, info.alias);
	validatePackageNameLength(packageName);

	const filename = binaryFilename(BUN_TARGETS, baseName, target);
	const packageDir = resolve(stageDir, info.alias);

	return {
		target,
		platformKey: info.platformKey,
		targetAlias: info.alias,
		packageName,
		packagePathSegment: getPackagePathSegment(packageName),
		packageDir,
		binaryRelativePath: join("bin", filename),
		binaryFilename: filename,
		os: info.os,
		cpu: info.cpu,
	};
}

function generateDistributionJsResolver(
	commandName: string,
	targets: readonly DistributionTarget[],
): string {
	const targetMap = Object.fromEntries(
		targets.map((target) => [
			target.platformKey,
			{
				packagePathSegment: target.packagePathSegment,
				packageName: target.packageName,
				binaryFilename: target.binaryFilename,
			},
		]),
	);
	const supportedPlatforms = targets.map((target) => target.targetAlias).join(", ");

	return `#!/usr/bin/env node
// Auto-generated by crust build --package -- do not edit
import { spawn } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PLATFORMS = ${JSON.stringify(targetMap, null, "\t")};
const dir = dirname(fileURLToPath(import.meta.url));
const platformKey = \`\${process.platform}-\${process.arch}\`;
const target = PLATFORMS[platformKey];

if (!target) {
\tconsole.error("[${commandName}] Unsupported platform: " + platformKey);
\tconsole.error("[${commandName}] Supported platforms: ${supportedPlatforms}");
\tprocess.exit(1);
}

const candidateOne = resolve(
\tdir,
\t"..",
\t"..",
\ttarget.packagePathSegment,
\t"bin",
\ttarget.binaryFilename,
);
const candidateTwo = resolve(
\tdir,
\t"..",
\t"node_modules",
\ttarget.packageName,
\t"bin",
\ttarget.binaryFilename,
);

const binPath = existsSync(candidateOne)
\t? candidateOne
\t: existsSync(candidateTwo)
\t\t? candidateTwo
\t\t: null;

if (!binPath) {
\tconsole.error("[${commandName}] Missing platform package for " + platformKey);
\tconsole.error("[${commandName}] Tried:");
\tconsole.error("  " + candidateOne);
\tconsole.error("  " + candidateTwo);
\tconsole.error(
\t\t"[${commandName}] Reinstall dependencies on this platform and ensure optional dependencies are enabled.",
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
\tconsole.error("[${commandName}] Failed to launch binary: " + error.message);
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
	targets: readonly DistributionTarget[],
): DistributionManifest {
	const manifest: DistributionManifest = {
		version: metadata.version,
		root: {
			name: metadata.rootPackageName,
			dir: "root",
			bin: metadata.commandName,
		},
		packages: targets.map((target) => ({
			target: target.targetAlias,
			name: target.packageName,
			dir: (relative(stageDir, target.packageDir) || ".").replaceAll("\\", "/"),
			os: target.os,
			cpu: target.cpu,
			bin: target.binaryRelativePath.replaceAll("\\", "/"),
		})),
		publishOrder: [
			...targets.map((target) =>
				(relative(stageDir, target.packageDir) || ".").replaceAll("\\", "/"),
			),
			"root",
		],
	};

	writeJson(join(stageDir, "manifest.json"), manifest);
	return manifest;
}

function stageDistributionPackages(
	cwd: string,
	stageDir: string,
	metadata: DistributionMetadata,
	targets: readonly DistributionTarget[],
	options?: { artifactDirs?: readonly string[]; manPages?: readonly string[] },
): void {
	rmSync(stageDir, { recursive: true, force: true });
	mkdirSync(stageDir, { recursive: true });

	const rootDir = join(stageDir, "root");
	const rootBinDir = join(rootDir, "bin");
	mkdirSync(rootBinDir, { recursive: true });

	writeJson(
		join(rootDir, "package.json"),
		buildDistributionRootPackageJson(metadata, targets, options),
	);
	writeFileSync(
		join(rootBinDir, `${metadata.commandName}.js`),
		generateDistributionJsResolver(metadata.commandName, targets),
		{ mode: 0o755 },
	);
	copyRootReadme(cwd, rootDir);

	for (const target of targets) {
		mkdirSync(join(target.packageDir, "bin"), { recursive: true });
		writeJson(
			join(target.packageDir, "package.json"),
			buildDistributionPlatformPackageJson(metadata, target),
		);
	}

	copyLicense(cwd, [rootDir, ...targets.map((target) => target.packageDir)]);
	writeDistributionManifest(stageDir, metadata, targets);
}

type DistributeBuildPlan = {
	cwd: string;
	entryPath: string;
	name?: string;
	minify: boolean;
	targets: BunTarget[];
	stageDir: string;
	envFiles: readonly string[];
	validate: boolean;
	outDir: string;
	userPackageJson: JsonValue | undefined;
};

type DistributeExecutor = (
	entryPath: string,
	outfilePath: string,
	minify: boolean,
	target: BunTarget,
	envFiles: readonly string[],
	cwd: string,
) => Promise<void>;

export async function runDistributeBuild(
	plan: DistributeBuildPlan,
	options: { io: InvocationIO; execute?: DistributeExecutor },
): Promise<void> {
	const metadata = resolveDistributionMetadata(
		plan.cwd,
		plan.entryPath,
		plan.name,
		plan.userPackageJson,
	);
	const distributionTargets = plan.targets.map((target) =>
		resolveDistributionTarget(plan.stageDir, metadata.baseName, metadata.rootPackageName, target),
	);

	options.io.stdout(
		`Staging ${bold(`${plan.targets.length}`)} distribution target(s) in ${dim(plan.stageDir)}...`,
	);

	const artifactOutDir = plan.validate ? plan.outDir : undefined;
	const artifacts = collectArtifacts(artifactOutDir, plan.stageDir);
	stageDistributionPackages(plan.cwd, plan.stageDir, metadata, distributionTargets, {
		artifactDirs: artifacts.names,
		manPages: artifacts.manPages,
	});

	if (artifactOutDir) {
		const rootDir = join(plan.stageDir, "root");
		for (const name of artifacts.names) {
			const artifactDir = join(artifactOutDir, name);
			cpSync(artifactDir, join(rootDir, name), { recursive: true });
			// Runtime source resolution (e.g. packaged skills) falls back to
			// dirname(process.execPath), which is a platform package's bin dir — the
			// root package is unreachable from there, so each platform package ships
			// its own copy of the artifacts.
			for (const targetPackage of distributionTargets) {
				cpSync(artifactDir, join(targetPackage.packageDir, "bin", name), { recursive: true });
			}
		}
	}

	const execute = options.execute ?? execBuild;
	for (const targetPackage of distributionTargets) {
		const outfilePath = join(targetPackage.packageDir, targetPackage.binaryRelativePath);
		options.io.stdout(`  ${cyan("→")} ${bold(targetPackage.targetAlias)}: ${dim(outfilePath)}`);
		await execute(
			plan.entryPath,
			outfilePath,
			plan.minify,
			targetPackage.target,
			plan.envFiles,
			plan.cwd,
		);
	}

	const manifestPath = join(plan.stageDir, "manifest.json");
	options.io.stdout(
		`\n${green("✓")} Staged ${bold(`${plan.targets.length + 1}`)} npm package(s) successfully:`,
	);
	options.io.stdout(`  ${join(plan.stageDir, "root")}`);
	for (const targetPackage of distributionTargets) {
		options.io.stdout(`  ${targetPackage.packageDir}`);
	}
	options.io.stdout(`\n${dim("Manifest:")} ${manifestPath}`);
}

type CollectedArtifacts = { names: string[]; manPages: string[] };

function collectArtifacts(
	artifactOutDir: string | undefined,
	stageDir: string,
): CollectedArtifacts {
	if (!artifactOutDir || !existsSync(artifactOutDir)) {
		return { names: [], manPages: [] };
	}

	// Staging wipes stageDir; artifacts inside it would be deleted before copy.
	if (isWithin(stageDir, artifactOutDir)) {
		throw new Error(
			`--stage-dir cannot contain the artifact output directory.\n  Staging replaces ${stageDir}, which would delete Extension build artifacts in ${artifactOutDir}.`,
		);
	}

	// ponytail: hooks own and clean unique top-level dirs in artifactOutDir; loose
	// files are ignored and stale dirs get packaged. Add a manifest when hooks need
	// file-level outputs, shared dirs, or conflict detection — hooks return declared
	// paths, core writes one manifest; no filesystem diff-scanning, no legacy+manifest dual mode.
	const names = readdirSync(artifactOutDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && !isWithin(join(artifactOutDir, entry.name), stageDir))
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
