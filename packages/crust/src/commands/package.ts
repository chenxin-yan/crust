import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Crust } from "@crustjs/core";
import { bold, cyan, dim, green } from "@crustjs/style";
import {
	type BunTarget,
	execBuild,
	getBinaryFilename,
	resolveBaseName,
	resolveTargets,
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

type PlatformKey =
	| "linux-x64"
	| "linux-arm64"
	| "darwin-x64"
	| "darwin-arm64"
	| "win32-x64"
	| "win32-arm64";

type NpmOs = "linux" | "darwin" | "win32";
type NpmCpu = "x64" | "arm64";

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

type PackageMetadata = {
	commandName: string;
	rootPackageName: string;
	version: string;
	baseName: string;
	rootPackageJson: PublishPackageJson;
};

type TargetPackageInfo = {
	target: BunTarget;
	platformKey: PlatformKey;
	targetAlias: string;
	packageName: string;
	packageDir: string;
	binaryRelativePath: string;
	binaryFilename: string;
	os: NpmOs;
	cpu: NpmCpu;
};

type PackageManifest = {
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

const TARGET_PACKAGE_INFO: Record<
	BunTarget,
	{ targetAlias: string; platformKey: PlatformKey; os: NpmOs; cpu: NpmCpu }
> = {
	"bun-linux-x64-baseline": {
		targetAlias: "linux-x64",
		platformKey: "linux-x64",
		os: "linux",
		cpu: "x64",
	},
	"bun-linux-arm64": {
		targetAlias: "linux-arm64",
		platformKey: "linux-arm64",
		os: "linux",
		cpu: "arm64",
	},
	"bun-darwin-x64": {
		targetAlias: "darwin-x64",
		platformKey: "darwin-x64",
		os: "darwin",
		cpu: "x64",
	},
	"bun-darwin-arm64": {
		targetAlias: "darwin-arm64",
		platformKey: "darwin-arm64",
		os: "darwin",
		cpu: "arm64",
	},
	"bun-windows-x64-baseline": {
		targetAlias: "windows-x64",
		platformKey: "win32-x64",
		os: "win32",
		cpu: "x64",
	},
	"bun-windows-arm64": {
		targetAlias: "windows-arm64",
		platformKey: "win32-arm64",
		os: "win32",
		cpu: "arm64",
	},
};

function readPackageJson(cwd: string): UserPackageJson {
	const packageJsonPath = join(cwd, "package.json");
	if (!existsSync(packageJsonPath)) {
		throw new Error(
			`package.json not found in ${cwd}\n  crust package requires a package.json with name and version fields.`,
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
			"crust package currently supports exactly one bin entry.\n  Use a single bin command in package.json for split-package publishing.",
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

export function buildRootPackageJson(
	metadata: PackageMetadata,
	targets: readonly TargetPackageInfo[],
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

export function buildPlatformPackageJson(
	metadata: PackageMetadata,
	target: TargetPackageInfo,
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

function resolveMetadata(
	cwd: string,
	entryPath: string,
	name: string | undefined,
): PackageMetadata {
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

function resolveTargetPackageInfo(
	stageDir: string,
	baseName: string,
	rootPackageName: string,
	target: BunTarget,
): TargetPackageInfo {
	const info = TARGET_PACKAGE_INFO[target];
	const packageName = derivePlatformPackageName(
		rootPackageName,
		info.targetAlias,
	);
	validatePackageNameLength(packageName);

	const binaryFilename = getBinaryFilename(baseName, target);
	const packageDir = resolve(stageDir, info.targetAlias);

	return {
		target,
		platformKey: info.platformKey,
		targetAlias: info.targetAlias,
		packageName,
		packageDir,
		binaryRelativePath: join("bin", binaryFilename),
		binaryFilename,
		os: info.os,
		cpu: info.cpu,
	};
}

export function generatePackageLauncher(
	commandName: string,
	targets: readonly TargetPackageInfo[],
): string {
	const packageMap = Object.fromEntries(
		targets.map((target) => [
			target.platformKey,
			{
				packageName: target.packageName,
				binaryRelativePath: target.binaryRelativePath.replaceAll("\\", "/"),
			},
		]),
	);

	return `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const commandName = ${JSON.stringify(commandName)};
const targetPackages = ${JSON.stringify(packageMap, null, 2)};
const platformKey = \`\${process.platform}-\${process.arch}\`;
const target = targetPackages[platformKey];

if (!target) {
\tconsole.error(\`[\${commandName}] Unsupported platform: \${platformKey}\`);
\tconsole.error(\`[\${commandName}] Supported platforms: \${Object.keys(targetPackages).join(", ")}\`);
\tprocess.exit(1);
}

let packageJsonPath;
try {
\tpackageJsonPath = require.resolve(\`\${target.packageName}/package.json\`);
} catch {
\tconsole.error(\`[\${commandName}] Missing platform package: \${target.packageName}\`);
\tconsole.error(\`[\${commandName}] Reinstall dependencies on this platform and ensure optional dependencies are enabled.\`);
\tprocess.exit(1);
}

const binaryPath = join(dirname(packageJsonPath), target.binaryRelativePath);
const result = spawnSync(binaryPath, process.argv.slice(2), { stdio: "inherit" });

if (result.error) {
\tconsole.error(\`[\${commandName}] Failed to start binary: \${result.error.message}\`);
\tprocess.exit(1);
}

if (typeof result.status === "number") {
\tprocess.exit(result.status);
}

if (result.signal) {
\tprocess.kill(process.pid, result.signal);
}

process.exit(1);
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

export function writePackageManifest(
	stageDir: string,
	metadata: PackageMetadata,
	targets: readonly TargetPackageInfo[],
): PackageManifest {
	const manifest: PackageManifest = {
		root: {
			name: metadata.rootPackageName,
			dir: "root",
			bin: metadata.commandName,
		},
		packages: targets.map((target) => ({
			target: target.targetAlias,
			name: target.packageName,
			dir: relative(stageDir, target.packageDir) || ".",
			os: target.os,
			cpu: target.cpu,
			bin: target.binaryRelativePath.replaceAll("\\", "/"),
		})),
		publishOrder: [
			...targets.map((target) => relative(stageDir, target.packageDir) || "."),
			"root",
		],
	};

	writeJson(join(stageDir, "manifest.json"), manifest);
	return manifest;
}

function stagePackages(
	cwd: string,
	stageDir: string,
	metadata: PackageMetadata,
	targets: readonly TargetPackageInfo[],
): void {
	rmSync(stageDir, { recursive: true, force: true });
	mkdirSync(stageDir, { recursive: true });

	const rootDir = join(stageDir, "root");
	const rootBinDir = join(rootDir, "bin");
	mkdirSync(rootBinDir, { recursive: true });

	writeJson(
		join(rootDir, "package.json"),
		buildRootPackageJson(metadata, targets),
	);
	writeFileSync(
		join(rootBinDir, `${metadata.commandName}.js`),
		generatePackageLauncher(metadata.commandName, targets),
		{ mode: 0o755 },
	);
	copyRootReadme(cwd, rootDir);

	for (const target of targets) {
		mkdirSync(join(target.packageDir, "bin"), { recursive: true });
		writeJson(
			join(target.packageDir, "package.json"),
			buildPlatformPackageJson(metadata, target),
		);
	}

	writePackageManifest(stageDir, metadata, targets);
}

// biome-ignore lint/suspicious/noExplicitAny: callback signature uses any for parent generics
export function packageCommand(cmd: Crust<any, any, any>) {
	return cmd
		.meta({
			description:
				"Stage platform-specific npm packages for optionalDependency distribution",
		})
		.flags({
			entry: {
				type: "string",
				description: "Entry file path",
				default: "src/cli.ts",
				short: "e",
			},
			name: {
				type: "string",
				description:
					"Binary name (defaults to package.json name or entry filename)",
				short: "n",
			},
			minify: {
				type: "boolean",
				description: "Minify the output",
				default: true,
			},
			target: {
				type: "string",
				multiple: true,
				description:
					"Target platform(s) to compile for (e.g. linux-x64, darwin-arm64). Omit to build all.",
				short: "t",
			},
			"stage-dir": {
				type: "string",
				description: "Directory to stage npm packages into",
				default: "dist/npm",
			},
			validate: {
				type: "boolean",
				description:
					"Validate command runtime rules before compiling (disable with --no-validate)",
				default: true,
			},
		} as const)
		.run(async ({ flags }) => {
			const cwd = process.cwd();
			const entryPath = resolve(cwd, flags.entry);

			if (!existsSync(entryPath)) {
				throw new Error(
					`Entry file not found: ${entryPath}\n  Specify a valid entry file with --entry <path>`,
				);
			}

			if (flags.validate) {
				await validateEntrypoint(entryPath);
			}

			const stageDir = resolve(cwd, flags["stage-dir"]);
			const targets = resolveTargets(flags.target);
			const metadata = resolveMetadata(cwd, entryPath, flags.name);
			const targetPackages = targets.map((target) =>
				resolveTargetPackageInfo(
					stageDir,
					metadata.baseName,
					metadata.rootPackageName,
					target,
				),
			);

			stagePackages(cwd, stageDir, metadata, targetPackages);

			console.log(
				`Staging ${bold(`${targets.length}`)} package target(s) in ${dim(stageDir)}...`,
			);

			for (const targetPackage of targetPackages) {
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
					flags.minify,
					targetPackage.target,
				);
			}

			const manifestPath = join(stageDir, "manifest.json");
			console.log(
				`\n${green("✓")} Staged ${bold(`${targets.length + 1}`)} npm package(s) successfully:`,
			);
			console.log(`  ${join(stageDir, "root")}`);
			for (const targetPackage of targetPackages) {
				console.log(`  ${targetPackage.packageDir}`);
			}
			console.log(`\n${dim("Manifest:")} ${manifestPath}`);
		});
}
