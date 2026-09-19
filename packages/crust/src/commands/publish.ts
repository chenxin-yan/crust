import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { defineCommand, type InvocationIO } from "@crustjs/core";
import { bold, cyan, dim, green } from "@crustjs/style";
import { isJsonObject, type JsonObject, type JsonValue } from "@crustjs/utils/json";
import { isWithin } from "@crustjs/utils/path";
import {
	runProcess,
	type RunProcessOptions,
	type RunProcessResult,
	which,
} from "@crustjs/utils/process";

import { CRUST_DIR, validatePackageIdentity } from "../utils/distribute.ts";

/** Only the persisted fields publishing consumes; build reports remain informational. */
type PublishManifest = {
	version: string;
	root: { name: string; dir: string; bins: string[] };
	packages: Array<{
		name: string;
		dir: string;
		os: string;
		cpu: string;
		libc?: string;
		bins: Record<string, string>;
	}>;
	publishOrder: string[];
};

function isRecord(value: JsonValue | undefined): value is JsonObject {
	return value !== undefined && isJsonObject(value);
}

function isNonemptyString(value: JsonValue | undefined): value is string {
	return typeof value === "string" && value.trim() !== "";
}

function isStringArray(value: JsonValue | undefined): value is string[] {
	return Array.isArray(value) && value.every(isNonemptyString);
}

function isStringRecord(value: JsonValue | undefined): value is Record<string, string> {
	return isRecord(value) && Object.values(value).every(isNonemptyString);
}

function isRegistryKey(key: string): boolean {
	return key === "registry" || (key.startsWith("@") && key.endsWith(":registry"));
}

/** Only registry keys are interpreted; access, provenance, tag, ... pass through to npm. */
function isPublishConfig(value: JsonValue | undefined): value is JsonObject {
	return (
		isRecord(value) &&
		Object.entries(value).every(([key, entry]) => !isRegistryKey(key) || isNonemptyString(entry))
	);
}

function assertPublishManifest(value: JsonValue): asserts value is PublishManifest {
	if (
		!isRecord(value) ||
		!isNonemptyString(value.version) ||
		!isRecord(value.root) ||
		!isNonemptyString(value.root.name) ||
		!isNonemptyString(value.root.dir) ||
		!isStringArray(value.root.bins) ||
		!isStringArray(value.publishOrder) ||
		!Array.isArray(value.packages) ||
		!value.packages.every(
			(pkg: JsonValue) =>
				isRecord(pkg) &&
				isNonemptyString(pkg.name) &&
				isNonemptyString(pkg.dir) &&
				isNonemptyString(pkg.os) &&
				isNonemptyString(pkg.cpu) &&
				(pkg.libc === undefined || isNonemptyString(pkg.libc)) &&
				isStringRecord(pkg.bins),
		)
	) {
		throw new Error(
			"Invalid manifest.json: expected string identity and directory fields, root.bins and publishOrder arrays, and package os/cpu/bins metadata. Run `crust build` again.",
		);
	}
}

type PublishPackageJson = {
	name: string;
	version: string;
	bin?: Record<string, string>;
	os?: string[];
	cpu?: string[];
	libc?: string[];
	optionalDependencies?: Record<string, string>;
	publishConfig?: JsonObject;
};

/** One validated staged package in publish order. */
type StagedPackage = {
	dir: string;
	path: string;
	packageJson: PublishPackageJson;
};

type RunNpm = (
	dir: string,
	args: string[],
	options?: Pick<RunProcessOptions, "stdio">,
) => Promise<RunProcessResult>;

type PublishOptions = {
	stageDir: string;
	tag?: string;
	registry?: string;
	dryRun?: boolean;
	/** Runs npm with `args` in `dir`; used for both `npm view` and `npm publish`. */
	runNpm?: RunNpm;
};

export function readPublishManifest(stageDir: string): PublishManifest {
	const manifestPath = join(stageDir, "manifest.json");
	if (!existsSync(manifestPath)) {
		throw new Error(
			`Staged manifest not found at ${manifestPath}\n  Run \`crust build\` before \`crust publish\`.`,
		);
	}

	const manifest: JsonValue = JSON.parse(readFileSync(manifestPath, "utf-8"));
	assertPublishManifest(manifest);
	return manifest;
}

function readStagedPackageJson(stageDir: string, dir: string): PublishPackageJson {
	const packageJsonPath = join(stageDir, dir, "package.json");
	if (!existsSync(packageJsonPath)) {
		throw new Error(`Missing staged package.json: ${packageJsonPath}`);
	}

	if (!isWithin(stageDir, realpathSync(packageJsonPath))) {
		throw new Error(
			`Staged package.json resolves outside the staging directory: ${packageJsonPath}`,
		);
	}
	const value: JsonValue = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
	validatePackageIdentity(value, packageJsonPath);
	if (
		(value.bin !== undefined && !isStringRecord(value.bin)) ||
		(value.optionalDependencies !== undefined && !isStringRecord(value.optionalDependencies)) ||
		(value.publishConfig !== undefined && !isPublishConfig(value.publishConfig)) ||
		[value.os, value.cpu, value.libc].some((field) => field !== undefined && !isStringArray(field))
	) {
		throw new Error(
			`Invalid staged package metadata in ${packageJsonPath}: expected string bin/dependency maps, os/cpu/libc arrays, and string publishConfig registry values.`,
		);
	}
	return value;
}

function assertUniqueDirs(dirs: string[]): void {
	const seen = new Set<string>();

	for (const dir of dirs) {
		if (seen.has(dir)) {
			throw new Error(`manifest.json contains duplicate staged directories: ${dir}`);
		}
		seen.add(dir);
	}
}

export function validatePublishManifest(
	stageDir: string,
	manifest: PublishManifest,
): StagedPackage[] {
	assertPublishManifest(manifest);
	// Resolve the explicitly selected root once; descendant links may not escape it.
	stageDir = realpathSync(stageDir);
	const listedDirs = manifest.packages.map((pkg) => pkg.dir);
	assertUniqueDirs([...listedDirs, manifest.root.dir]);
	assertUniqueDirs(manifest.publishOrder);

	if (manifest.publishOrder.at(-1) !== manifest.root.dir) {
		throw new Error("manifest.json must publish the root package last.");
	}

	const expectedPublishOrder = [...listedDirs, manifest.root.dir];
	if (manifest.publishOrder.length !== expectedPublishOrder.length) {
		throw new Error("manifest.json publishOrder does not match the staged packages.");
	}

	const canonicalDirs = new Map<string, string>();
	for (const dir of expectedPublishOrder) {
		if (!manifest.publishOrder.includes(dir)) {
			throw new Error(`manifest.json publishOrder is missing ${dir}.`);
		}
		const path = resolve(stageDir, dir);
		if (isAbsolute(dir) || path === stageDir || !isWithin(stageDir, path)) {
			throw new Error(`Staged package directory must be inside ${stageDir}: ${dir}`);
		}
		if (!existsSync(path)) {
			throw new Error(`Missing staged package directory: ${path}`);
		}
		const canonical = realpathSync(path);
		if (canonical === stageDir || !isWithin(stageDir, canonical)) {
			throw new Error(`Staged package directory resolves outside ${stageDir}: ${dir}`);
		}
		if (!statSync(canonical).isDirectory()) {
			throw new Error(`Staged package path is not a directory: ${dir}`);
		}
		canonicalDirs.set(dir, canonical);
	}
	assertUniqueDirs([...canonicalDirs.values()]);

	const rootPackageJson = readStagedPackageJson(stageDir, manifest.root.dir);
	if (rootPackageJson.name !== manifest.root.name) {
		throw new Error("Root staged package name does not match manifest.json.");
	}

	if (rootPackageJson.version !== manifest.version) {
		throw new Error("Root staged package version does not match manifest.json.");
	}

	const commands = manifest.root.bins;
	if (commands.length === 0) {
		throw new Error("manifest.json root.bins must list at least one command.");
	}
	if (new Set(commands).size !== commands.length) {
		throw new Error("manifest.json root.bins must contain unique command names.");
	}
	for (const command of commands) {
		if (rootPackageJson.bin?.[command] !== `bin/${command}.js`) {
			throw new Error(`Root staged package is missing correct bin metadata for ${command}.`);
		}
	}

	if (Object.keys(rootPackageJson.bin ?? {}).length !== commands.length) {
		throw new Error("Root staged package commands do not match manifest.json root.bins.");
	}

	const optionalDeps = rootPackageJson.optionalDependencies ?? {};
	const names = new Set([rootPackageJson.name]);
	const stagedPackageJsons = new Map([[manifest.root.dir, rootPackageJson]]);

	for (const pkg of manifest.packages) {
		if (names.has(pkg.name)) {
			throw new Error(`manifest.json contains duplicate package names: ${pkg.name}`);
		}
		names.add(pkg.name);
		const stagedPackageJson = readStagedPackageJson(stageDir, pkg.dir);
		stagedPackageJsons.set(pkg.dir, stagedPackageJson);

		if (stagedPackageJson.name !== pkg.name) {
			throw new Error(`Staged package name mismatch for ${pkg.dir}.`);
		}

		if (stagedPackageJson.version !== rootPackageJson.version) {
			throw new Error("All staged package versions must match.");
		}

		if (stagedPackageJson.os?.[0] !== pkg.os) {
			throw new Error(`Staged package ${pkg.dir} is missing correct os metadata.`);
		}

		if (stagedPackageJson.cpu?.[0] !== pkg.cpu) {
			throw new Error(`Staged package ${pkg.dir} is missing correct cpu metadata.`);
		}

		// glibc and musl packages share os/cpu; a wrong or missing libc makes npm pick an unrunnable binary.
		if (
			pkg.libc ? stagedPackageJson.libc?.[0] !== pkg.libc : stagedPackageJson.libc !== undefined
		) {
			throw new Error(`Staged package ${pkg.dir} is missing correct libc metadata.`);
		}

		for (const command of commands) {
			const binary = pkg.bins[command];
			if (binary === undefined || stagedPackageJson.bin?.[command] !== binary) {
				throw new Error(
					`Staged package ${pkg.dir} is missing correct bin metadata for ${command}.`,
				);
			}
		}

		if (
			Object.keys(pkg.bins).length !== commands.length ||
			Object.keys(stagedPackageJson.bin ?? {}).length !== commands.length
		) {
			throw new Error(`Staged package ${pkg.dir} commands do not match manifest.json root.bins.`);
		}

		if (optionalDeps[pkg.name] !== rootPackageJson.version) {
			throw new Error(
				`Root package optionalDependencies must include ${pkg.name}@${rootPackageJson.version}.`,
			);
		}
	}
	return manifest.publishOrder.map((dir) => ({
		dir,
		path: canonicalDirs.get(dir)!,
		packageJson: stagedPackageJsons.get(dir)!,
	}));
}

// npm, not `bun publish`: only npm supports trusted publishing (OIDC) from CI
// (oven-sh/bun#15601). Staged package.json files carry no workspace: ranges,
// so npm can publish the directories directly. npm reads publishConfig.access
// from each staged package.json, copied from the project package.json.
export function buildPublishCommand(args: { tag?: string; registry?: string }): string[] {
	const command = ["npm", "publish"];

	if (args.tag) {
		command.push("--tag", args.tag);
	}

	if (args.registry) {
		command.push("--registry", args.registry);
	}

	return command;
}

function defaultRunNpm(): RunNpm {
	const npm = which("npm");
	if (!npm) {
		throw new Error("npm was not found on PATH; it is required to publish.");
	}
	return (dir, args, options) => runProcess(npm, args, { cwd: dir, ...options });
}

function printProcessOutput({ stdout, stderr }: RunProcessResult, io: InvocationIO): void {
	if (stdout) io.stdout(stdout.replace(/\r?\n$/, ""));
	if (stderr) io.stderr(stderr.replace(/\r?\n$/, ""));
}

function registryValue(publishConfig: JsonObject | undefined, key: string): string | undefined {
	const value = publishConfig?.[key];
	return isNonemptyString(value) ? value : undefined;
}

// `npm view` reads only flat CLI/npmrc options, while `npm publish` overlays the
// package's publishConfig onto them, dropping keys also given as CLI flags
// (npm/lib/commands/publish.js #getManifest); npm-registry-fetch's pickRegistry
// then prefers `<@scope>:registry` over `registry`. Replay that overlay as CLI
// flags so the lookup hits the same registry the upload would, including when
// .npmrc carries its own `<@scope>:registry` that only the scoped flag can beat.
function viewRegistryArgs(
	name: string,
	publishConfig: JsonObject | undefined,
	cliRegistry: string | undefined,
): string[] {
	const args: string[] = [];
	const scope = name.startsWith("@") ? name.slice(0, name.indexOf("/")) : undefined;
	const scoped = scope ? registryValue(publishConfig, `${scope}:registry`) : undefined;
	if (scoped) args.push(`--${scope}:registry=${scoped}`);
	const registry = cliRegistry ?? registryValue(publishConfig, "registry");
	if (registry) args.push("--registry", registry);
	return args;
}

function parseJson(text: string): JsonValue | undefined {
	try {
		return JSON.parse(text.trim());
	} catch {
		return undefined;
	}
}

/** Interprets `npm view <name>@<version> version --json`; anything but a clear yes/no aborts. */
function isVersionPublished(result: RunProcessResult, spec: string, version: string): boolean {
	const body = parseJson(result.stdout);
	if (result.exitCode === 0 && body === version) {
		return true;
	}
	const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
	if (result.exitCode !== 0 && error?.code === "E404") {
		return false;
	}
	const summary = error
		? `${String(error.code)}: ${String(error.summary ?? "")}`.trim()
		: result.stderr.trim() || result.stdout.trim() || "unrecognized npm view output";
	throw new Error(
		`Could not check whether ${spec} is already published (npm view exited ${result.exitCode ?? 1}): ${summary}\n  Nothing was published.`,
	);
}

function listDirs(dirs: string[]): string {
	return dirs.length > 0 ? dirs.join(", ") : "none";
}

export async function publishStagedPackages(
	manifest: PublishManifest,
	options: PublishOptions,
	io: InvocationIO,
): Promise<void> {
	const staged = validatePublishManifest(options.stageDir, manifest);

	const command = buildPublishCommand({ tag: options.tag, registry: options.registry });
	io.stdout(`${dim("Publish order:")} ${manifest.publishOrder.join(" -> ")}`);
	for (const relativeDir of manifest.publishOrder) {
		io.stdout(`  ${cyan("→")} ${relativeDir}: ${dim(command.join(" "))}`);
	}

	if (options.dryRun) {
		io.stdout(dim("Versions already on the registry are detected and skipped at publish time."));
		return;
	}

	const runNpm = options.runNpm ?? defaultRunNpm();
	const version = manifest.version;

	io.stdout(`\n${dim(`Checking ${version} on the registry:`)}`);
	const missing: StagedPackage[] = [];
	const skipped: string[] = [];
	for (const pkg of staged) {
		const spec = `${pkg.packageJson.name}@${version}`;
		const result = await runNpm(pkg.path, [
			"view",
			spec,
			"version",
			"--json",
			...viewRegistryArgs(pkg.packageJson.name, pkg.packageJson.publishConfig, options.registry),
		]);
		let published: boolean;
		try {
			published = isVersionPublished(result, spec, version);
		} catch (error) {
			printProcessOutput(result, io);
			throw error;
		}
		if (published) {
			skipped.push(pkg.dir);
			io.stdout(`  ${cyan("→")} ${pkg.dir}: ${dim(`skip: ${version} already published`)}`);
		} else {
			missing.push(pkg);
			io.stdout(`  ${cyan("→")} ${pkg.dir}: publish`);
		}
	}

	if (missing.length === 0) {
		io.stdout(
			`\n${green("✓")} All ${bold(String(staged.length))} staged package(s) are already published as ${version}.`,
		);
		return;
	}

	const published: string[] = [];
	for (const [index, pkg] of missing.entries()) {
		io.stdout(`\nPublishing ${bold(pkg.dir)} from ${dim(pkg.path)}...`);
		const failure = (reason: string, cause?: unknown): Error => {
			const notAttempted = missing.slice(index + 1).map((rest) => rest.dir);
			return new Error(
				`npm publish failed for ${pkg.dir} (${pkg.path}) ${reason}\n` +
					`  published: ${listDirs(published)}\n` +
					`  skipped (already published): ${listDirs(skipped)}\n` +
					`  not attempted: ${listDirs(notAttempted)}\n` +
					"  Fix the cause and rerun `crust publish`; already-published versions are skipped.",
				{ cause },
			);
		};
		let result: RunProcessResult;
		try {
			result = await runNpm(pkg.path, command.slice(1), {
				// npm needs the terminal for interactive browser/OTP authentication; the
				// version lookup above always collects because its stdout is parsed.
				stdio: process.stdin.isTTY ? "inherit" : "collect",
			});
		} catch (error) {
			throw failure(
				`before npm exited: ${error instanceof Error ? error.message : String(error)}`,
				error,
			);
		}
		printProcessOutput(result, io);
		if (result.exitCode !== 0) {
			throw failure(`with exit code ${result.exitCode ?? 1}`);
		}
		published.push(pkg.dir);
	}

	io.stdout(
		`\n${green("✓")} Published ${bold(String(published.length))} staged package(s), skipped ${bold(String(skipped.length))} already published.`,
	);
}

export const publishCommand = defineCommand(
	"publish",
	{ description: "Publish the npm packages staged in .crust/ by crust build" },
	(command) =>
		command
			.flags(
				{
					name: "tag",
					type: "string",
					description: "Override the npm dist-tag passed to npm publish",
				},
				{
					name: "dry-run",
					type: "boolean",
					description: "Print publish order and commands without publishing",
					default: false,
				},
				{
					name: "registry",
					type: "string",
					description: "Override the registry passed to npm publish",
				},
			)
			.action(async ({ flags, stdout, stderr }) => {
				const cwd = process.cwd();
				const stageDir = resolve(cwd, CRUST_DIR);
				const manifest = readPublishManifest(stageDir);

				await publishStagedPackages(
					manifest,
					{
						stageDir,
						tag: flags.tag,
						registry: flags.registry,
						dryRun: flags["dry-run"],
					},
					{ stdout, stderr },
				);
			}),
);
