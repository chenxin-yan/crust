import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { defineCommand, type InvocationIO } from "@crustjs/core";
import { bold, cyan, dim, green } from "@crustjs/style";
import { isJsonObject, type JsonObject, type JsonValue } from "@crustjs/utils/json";
import { isWithin } from "@crustjs/utils/path";
import { runProcess, which } from "@crustjs/utils/process";

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
};

type PublishOptions = {
	stageDir: string;
	tag?: string;
	registry?: string;
	dryRun?: boolean;
	spawnPublish?: (dir: string, command: string[], io: InvocationIO) => Promise<number>;
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
		[value.os, value.cpu, value.libc].some((field) => field !== undefined && !isStringArray(field))
	) {
		throw new Error(
			`Invalid staged package metadata in ${packageJsonPath}: expected string bin/dependency maps and os/cpu/libc arrays.`,
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

export function validatePublishManifest(stageDir: string, manifest: PublishManifest): string[] {
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

	for (const pkg of manifest.packages) {
		if (names.has(pkg.name)) {
			throw new Error(`manifest.json contains duplicate package names: ${pkg.name}`);
		}
		names.add(pkg.name);
		const stagedPackageJson = readStagedPackageJson(stageDir, pkg.dir);

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
	return manifest.publishOrder.map((dir) => canonicalDirs.get(dir)!);
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

async function defaultSpawnPublish(
	dir: string,
	command: string[],
	io: InvocationIO,
): Promise<number> {
	const npm = which(command[0]!);
	if (!npm) {
		throw new Error(`${command[0]} was not found on PATH; it is required to publish.`);
	}
	const { exitCode, stdout, stderr } = await runProcess(npm, command.slice(1), { cwd: dir });
	if (stdout) io.stdout(stdout.replace(/\r?\n$/, ""));
	if (stderr) io.stderr(stderr.replace(/\r?\n$/, ""));

	return exitCode ?? 1;
}

export async function publishStagedPackages(
	manifest: PublishManifest,
	options: PublishOptions,
	io: InvocationIO,
): Promise<void> {
	const publishDirs = validatePublishManifest(options.stageDir, manifest);

	const command = buildPublishCommand({ tag: options.tag, registry: options.registry });
	io.stdout(`${dim("Publish order:")} ${manifest.publishOrder.join(" -> ")}`);
	for (const relativeDir of manifest.publishOrder) {
		io.stdout(`  ${cyan("→")} ${relativeDir}: ${dim(command.join(" "))}`);
	}

	if (options.dryRun) {
		return;
	}

	const spawnPublish = options.spawnPublish ?? defaultSpawnPublish;

	for (const [index, relativeDir] of manifest.publishOrder.entries()) {
		const dir = publishDirs[index]!;
		io.stdout(`\nPublishing ${bold(relativeDir)} from ${dim(dir)}...`);
		const exitCode = await spawnPublish(dir, command, io);
		if (exitCode !== 0) {
			throw new Error(`npm publish failed for ${relativeDir} (${dir}) with exit code ${exitCode}`);
		}
	}

	io.stdout(
		`\n${green("✓")} Published ${bold(String(manifest.publishOrder.length))} staged package(s).`,
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
