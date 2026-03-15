import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { bold, cyan, dim, green } from "@crustjs/style";
import {
	type BunTarget,
	execBuild,
	getBinaryFilename,
	resolveBaseName,
	resolveTargets,
	TARGET_INFO,
	type TargetInfo,
	validateEntrypoint,
} from "./build.ts";

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
] as const;

type NpmOs = TargetInfo["os"];
type NpmCpu = TargetInfo["cpu"];
type PlatformKey = (typeof TARGET_INFO)[BunTarget]["platformKey"];

type PublishPackageJson = {
	name: string;
	version: string;
	type?: "module";
	files?: string[];
	bin?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	os?: [NpmOs];
	cpu?: [NpmCpu];
	description?: string;
	license?: string;
	author?: string | Record<string, unknown>;
	homepage?: string;
	bugs?: string | Record<string, unknown>;
	repository?: string | Record<string, unknown>;
	keywords?: string[];
	publishConfig?: Record<string, unknown>;
	funding?: string | Record<string, unknown> | Array<Record<string, unknown>>;
};

type UserPackageJson = Omit<PublishPackageJson, "bin"> & {
	bin?: string | Record<string, string>;
};

type DistributionMetadata = {
	commandName: string;
	rootPackageName: string;
	version: string;
	baseName: string;
	rootPackageJson: PublishPackageJson;
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

function readPackageJson(cwd: string): UserPackageJson {
	const packageJsonPath = join(cwd, "package.json");
	if (!existsSync(packageJsonPath)) {
		throw new Error(
			`package.json not found in ${cwd}\n  crust build --package requires a package.json with name and version fields.`,
		);
	}

	try {
		return JSON.parse(
			readFileSync(packageJsonPath, "utf-8"),
		) as UserPackageJson;
	} catch (error) {
		throw new Error(
			`Failed to parse package.json in ${cwd}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export function derivePlatformPackageName(
	rootPackageName: string,
	targetAlias: string,
): string {
	const [scope, name] = rootPackageName.startsWith("@")
		? rootPackageName.split("/")
		: [undefined, rootPackageName];
	const suffixedName = `${name}-${targetAlias}`;
	return scope ? `${scope}/${suffixedName}` : suffixedName;
}

export function getPackagePathSegment(packageName: string): string {
	return packageName.startsWith("@")
		? (packageName.split("/")[1] ?? packageName)
		: packageName;
}

export function inferCommandName(
	rootPackageName: string,
	bin: UserPackageJson["bin"],
	baseName: string,
): string {
	if (!bin) return baseName;

	if (typeof bin === "string") {
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
		throw new Error(
			"Failed to resolve the bin command name from package.json.",
		);
	}

	return entry;
}

export function buildDistributionRootPackageJson(
	metadata: DistributionMetadata,
	targets: readonly DistributionTarget[],
): PublishPackageJson {
	const rootPackageJson: PublishPackageJson = {
		...metadata.rootPackageJson,
		name: metadata.rootPackageName,
		version: metadata.version,
		type: "module",
		files: ["bin"],
		bin: {
			[metadata.commandName]: `bin/${metadata.commandName}.js`,
		},
		optionalDependencies: Object.fromEntries(
			targets.map((target) => [target.packageName, metadata.version]),
		),
	};

	return rootPackageJson;
}

export function buildDistributionPlatformPackageJson(
	metadata: DistributionMetadata,
	target: DistributionTarget,
): PublishPackageJson {
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

function pickRootMetadata(pkgJson: UserPackageJson): PublishPackageJson {
	const metadata: PublishPackageJson = {
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
): DistributionMetadata {
	const pkgJson = readPackageJson(cwd);
	if (!pkgJson.name) {
		throw new Error("package.json is missing a name field.");
	}
	if (!pkgJson.version) {
		throw new Error("package.json is missing a version field.");
	}

	validatePackageNameLength(pkgJson.name);

	const baseName = resolveBaseName(name, entryPath, cwd);
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
	const info = TARGET_INFO[target];
	const packageName = derivePlatformPackageName(rootPackageName, info.alias);
	validatePackageNameLength(packageName);

	const binaryFilename = getBinaryFilename(baseName, target);
	const packageDir = resolve(stageDir, info.alias);

	return {
		target,
		platformKey: info.platformKey,
		targetAlias: info.alias,
		packageName,
		packagePathSegment: getPackagePathSegment(packageName),
		packageDir,
		binaryRelativePath: join("bin", binaryFilename),
		binaryFilename,
		os: info.os,
		cpu: info.cpu,
	};
}

export function generateDistributionJsResolver(
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
	const supportedPlatforms = targets
		.map((target) => target.targetAlias)
		.join(", ");

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

function writeJson(path: string, value: unknown): void {
	writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`);
}

function copyRootReadme(cwd: string, rootDir: string): void {
	const readmePath = join(cwd, "README.md");
	if (existsSync(readmePath)) {
		copyFileSync(readmePath, join(rootDir, "README.md"));
	}
}

export function writeDistributionManifest(
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
): void {
	rmSync(stageDir, { recursive: true, force: true });
	mkdirSync(stageDir, { recursive: true });

	const rootDir = join(stageDir, "root");
	const rootBinDir = join(rootDir, "bin");
	mkdirSync(rootBinDir, { recursive: true });

	writeJson(
		join(rootDir, "package.json"),
		buildDistributionRootPackageJson(metadata, targets),
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

	writeDistributionManifest(stageDir, metadata, targets);
}

export async function runDistributeBuild(options: {
	cwd?: string;
	entry: string;
	name?: string;
	minify: boolean;
	target?: string[];
	stageDir: string;
	envFiles?: readonly string[];
	validate: boolean;
}): Promise<void> {
	const cwd = options.cwd ?? process.cwd();
	const entryPath = resolve(cwd, options.entry);

	if (!existsSync(entryPath)) {
		throw new Error(
			`Entry file not found: ${entryPath}\n  Specify a valid entry file with --entry <path>`,
		);
	}

	if (options.validate) {
		await validateEntrypoint(entryPath, options.envFiles);
	}

	const stageDir = resolve(cwd, options.stageDir);
	const targets = resolveTargets(options.target);
	const metadata = resolveDistributionMetadata(cwd, entryPath, options.name);
	const distributionTargets = targets.map((target) =>
		resolveDistributionTarget(
			stageDir,
			metadata.baseName,
			metadata.rootPackageName,
			target,
		),
	);

	console.log(
		`Staging ${bold(`${targets.length}`)} distribution target(s) in ${dim(stageDir)}...`,
	);

	stageDistributionPackages(cwd, stageDir, metadata, distributionTargets);

	for (const targetPackage of distributionTargets) {
		const outfilePath = join(
			targetPackage.packageDir,
			targetPackage.binaryRelativePath,
		);
		console.log(
			`  ${cyan("→")} ${bold(targetPackage.targetAlias)}: ${dim(outfilePath)}`,
		);
		await execBuild(
			entryPath,
			outfilePath,
			options.minify,
			targetPackage.target,
			options.envFiles,
		);
	}

	const manifestPath = join(stageDir, "manifest.json");
	console.log(
		`\n${green("✓")} Staged ${bold(`${targets.length + 1}`)} npm package(s) successfully:`,
	);
	console.log(`  ${join(stageDir, "root")}`);
	for (const targetPackage of distributionTargets) {
		console.log(`  ${targetPackage.packageDir}`);
	}
	console.log(`\n${dim("Manifest:")} ${manifestPath}`);
}
