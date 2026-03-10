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
			`package.json not found in ${cwd}\n  crust build --distribute requires a package.json with name and version fields.`,
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
			"crust build --distribute currently supports exactly one bin entry.\n  Use a single bin command in package.json for split-package publishing.",
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
			[metadata.commandName]: `bin/${metadata.commandName}`,
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

export function generateDistributionResolver(
	commandName: string,
	targets: readonly DistributionTarget[],
): string {
	const caseLines = targets
		.filter((target) => target.os !== "win32")
		.map(
			(target) => `\t${target.os === "darwin" ? "Darwin" : "Linux"}-${
				target.cpu === "arm64"
					? target.os === "linux"
						? "aarch64"
						: "arm64"
					: "x86_64"
			})
\t\tplatform_pkg=${JSON.stringify(target.packagePathSegment)}
\t\t		fallback_pkg=${JSON.stringify(target.packageName)}
\t\tbinary=${JSON.stringify(target.binaryFilename)}
\t\t;;`,
		)
		.join("\n");
	const supportedPlatforms = targets
		.filter((target) => target.os !== "win32")
		.map((target) => `${target.os}-${target.cpu}`)
		.join(", ");

	return `#!/usr/bin/env bash
# Auto-generated by crust build --distribute -- do not edit
set -e

source="$0"
while [ -L "$source" ]; do
\tlink_dir="$(cd "$(dirname "$source")" && pwd)"
\tsource="$(readlink "$source")"
\tcase "$source" in
\t\t/*) ;;
\t\t*) source="$link_dir/$source" ;;
\tesac
done

dir="$(cd "$(dirname "$source")" && pwd)"
platform="$(uname -s)-$(uname -m)"
platform_pkg=""
fallback_pkg=""
binary=""

case "$platform" in
${caseLines}
\t*)
\t\techo "[${commandName}] Unsupported platform: $platform" >&2
\t\techo "[${commandName}] Supported platforms: ${supportedPlatforms}" >&2
\t\texit 1
\t\t;;
esac

candidate_one="$dir/../../$platform_pkg/bin/$binary"
candidate_two="$dir/../node_modules/$fallback_pkg/bin/$binary"

if [ -f "$candidate_one" ]; then
\texec "$candidate_one" "$@"
fi

if [ -f "$candidate_two" ]; then
\texec "$candidate_two" "$@"
fi

echo "[${commandName}] Missing platform package for $platform" >&2
echo "[${commandName}] Tried:" >&2
echo "  $candidate_one" >&2
echo "  $candidate_two" >&2
echo "[${commandName}] Reinstall dependencies on this platform and ensure optional dependencies are enabled." >&2
exit 1
`;
}

export function generateDistributionCmdResolver(
	commandName: string,
	targets: readonly DistributionTarget[],
): string {
	const windowsTargets = targets.filter((target) => target.os === "win32");
	const archLines = windowsTargets.map((target) => {
		const arch = target.cpu === "arm64" ? "ARM64" : "AMD64";

		return `if /I "%host_arch%"=="${arch}" (
\tset "pkg_segment=${target.packagePathSegment}"
\tset "fallback_pkg=${target.packageName.replaceAll("/", "\\")}"
\tset "binary=${target.binaryFilename}"
)`;
	});

	if (windowsTargets.length === 0) {
		return `@echo off\r
echo [${commandName}] No Windows binary was staged for this package. >&2\r
exit /b 1\r
`;
	}

	return `@echo off\r
rem Auto-generated by crust build --distribute -- do not edit\r
setlocal\r
set "dir=%~dp0"\r
set "host_arch=%PROCESSOR_ARCHITECTURE%"\r
set "pkg_segment="\r
set "fallback_pkg="\r
set "binary="\r
\r
if /I "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "host_arch=ARM64"\r
\r
${archLines.join("\r\n")}\r
\r
if "%binary%"=="" (\r
\techo [${commandName}] Unsupported Windows architecture: %host_arch% >&2\r
\texit /b 1\r
)\r
\r
set "candidate_one=%dir%..\\..\\%pkg_segment%\\bin\\%binary%"\r
set "candidate_two=%dir%..\\node_modules\\%fallback_pkg%\\bin\\%binary%"\r
\r
if exist "%candidate_one%" (\r
\t"%candidate_one%" %*\r
\texit /b %ERRORLEVEL%\r
)\r
\r
if exist "%candidate_two%" (\r
\t"%candidate_two%" %*\r
\texit /b %ERRORLEVEL%\r
)\r
\r
echo [${commandName}] Missing platform package for Windows %host_arch% >&2\r
echo [${commandName}] Tried: %candidate_one% >&2\r
echo [${commandName}] Tried: %candidate_two% >&2\r
echo [${commandName}] Reinstall dependencies on this platform and ensure optional dependencies are enabled. >&2\r
exit /b 1\r
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
		join(rootBinDir, metadata.commandName),
		generateDistributionResolver(metadata.commandName, targets),
		{ mode: 0o755 },
	);
	writeFileSync(
		join(rootBinDir, `${metadata.commandName}.cmd`),
		generateDistributionCmdResolver(metadata.commandName, targets),
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
		await validateEntrypoint(entryPath);
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
