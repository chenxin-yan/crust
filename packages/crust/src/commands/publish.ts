import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { defineCommand } from "@crustjs/core";
import { bold, cyan, dim, green } from "@crustjs/style";
import { runProcess } from "@crustjs/utils/process";

import type { DistributionManifest } from "../utils/distribute.ts";

type PublishPackageJson = {
	name?: string;
	version?: string;
	bin?: Record<string, string>;
	os?: string[];
	cpu?: string[];
	optionalDependencies?: Record<string, string>;
};

type PublishOptions = {
	stageDir: string;
	access: string;
	tag?: string;
	registry?: string;
	dryRun?: boolean;
	verify?: boolean;
	spawnPublish?: (dir: string, command: string[]) => Promise<number>;
};

export function readPublishManifest(stageDir: string): DistributionManifest {
	const manifestPath = join(stageDir, "manifest.json");
	if (!existsSync(manifestPath)) {
		throw new Error(
			`Staged manifest not found at ${manifestPath}\n  Run \`crust build --package\` before \`crust publish\`.`,
		);
	}

	// SAFETY: validatePublishManifest checks every manifest field used before publishing unless verification is explicitly disabled.
	return JSON.parse(readFileSync(manifestPath, "utf-8")) as DistributionManifest;
}

function readStagedPackageJson(stageDir: string, dir: string): PublishPackageJson {
	const packageJsonPath = join(stageDir, dir, "package.json");
	if (!existsSync(packageJsonPath)) {
		throw new Error(`Missing staged package.json: ${packageJsonPath}`);
	}

	// SAFETY: validatePublishManifest checks each optional field before using it as publish metadata.
	return JSON.parse(readFileSync(packageJsonPath, "utf-8")) as PublishPackageJson;
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

export function validatePublishManifest(stageDir: string, manifest: DistributionManifest): void {
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

	for (const dir of expectedPublishOrder) {
		if (!manifest.publishOrder.includes(dir)) {
			throw new Error(`manifest.json publishOrder is missing ${dir}.`);
		}
		if (!existsSync(join(stageDir, dir))) {
			throw new Error(`Missing staged package directory: ${join(stageDir, dir)}`);
		}
		if (!existsSync(join(stageDir, dir, "package.json"))) {
			throw new Error(`Missing staged package.json: ${join(stageDir, dir, "package.json")}`);
		}
	}

	const rootPackageJson = readStagedPackageJson(stageDir, manifest.root.dir);
	if (rootPackageJson.name !== manifest.root.name) {
		throw new Error("Root staged package name does not match manifest.json.");
	}

	if (!rootPackageJson.version) {
		throw new Error("Root staged package is missing a version field.");
	}

	const optionalDeps = rootPackageJson.optionalDependencies ?? {};

	for (const pkg of manifest.packages) {
		const stagedPackageJson = readStagedPackageJson(stageDir, pkg.dir);

		if (stagedPackageJson.name !== pkg.name) {
			throw new Error(`Staged package name mismatch for ${pkg.dir}.`);
		}

		if (stagedPackageJson.version !== rootPackageJson.version) {
			throw new Error("All staged package versions must match.");
		}

		if (!pkg.os || !pkg.cpu || !pkg.bin) {
			throw new Error(`Manifest entry for ${pkg.dir} is missing os/cpu/bin metadata.`);
		}

		if (!Array.isArray(stagedPackageJson.os) || stagedPackageJson.os[0] !== pkg.os) {
			throw new Error(`Staged package ${pkg.dir} is missing correct os metadata.`);
		}

		if (!Array.isArray(stagedPackageJson.cpu) || stagedPackageJson.cpu[0] !== pkg.cpu) {
			throw new Error(`Staged package ${pkg.dir} is missing correct cpu metadata.`);
		}

		if (stagedPackageJson.bin?.[manifest.root.bin] !== pkg.bin) {
			throw new Error(`Staged package ${pkg.dir} is missing correct bin metadata.`);
		}

		if (optionalDeps[pkg.name] !== rootPackageJson.version) {
			throw new Error(
				`Root package optionalDependencies must include ${pkg.name}@${rootPackageJson.version}.`,
			);
		}
	}
}

export function buildPublishCommand(args: {
	access: string;
	tag?: string;
	registry?: string;
}): string[] {
	const command = [process.execPath, "publish", "--access", args.access, "--no-git-checks"];

	if (args.tag) {
		command.push("--tag", args.tag);
	}

	if (args.registry) {
		command.push("--registry", args.registry);
	}

	return command;
}

async function defaultSpawnPublish(dir: string, command: string[]): Promise<number> {
	const { exitCode } = await runProcess(command[0]!, command.slice(1), {
		cwd: dir,
		env: {
			...process.env,
			BUN_BE_BUN: "1",
		},
		stdio: "inherit",
	});

	return exitCode ?? 1;
}

export async function publishStagedPackages(
	manifest: DistributionManifest,
	options: PublishOptions,
): Promise<void> {
	if (options.verify !== false) {
		validatePublishManifest(options.stageDir, manifest);
	}

	const command = buildPublishCommand({
		access: options.access,
		tag: options.tag,
		registry: options.registry,
	});
	console.log(`${dim("Publish order:")} ${manifest.publishOrder.join(" -> ")}`);
	for (const relativeDir of manifest.publishOrder) {
		console.log(`  ${cyan("→")} ${relativeDir}: ${dim(command.join(" "))}`);
	}

	if (options.dryRun) {
		return;
	}

	const spawnPublish = options.spawnPublish ?? defaultSpawnPublish;

	for (const relativeDir of manifest.publishOrder) {
		const dir = join(options.stageDir, relativeDir);
		console.log(`\nPublishing ${bold(relativeDir)} from ${dim(dir)}...`);
		const exitCode = await spawnPublish(dir, command);
		if (exitCode !== 0) {
			throw new Error(`bun publish failed for ${relativeDir} (${dir}) with exit code ${exitCode}`);
		}
	}

	console.log(
		`\n${green("✓")} Published ${bold(String(manifest.publishOrder.length))} staged package(s).`,
	);
}

export const publishCommand = defineCommand(
	"publish",
	{ description: "Publish staged npm packages created by crust build --package" },
	(command) =>
		command
			.flags(
				{
					name: "stage-dir",
					type: "string",
					description: "Directory containing a staged manifest.json",
					default: "dist/npm",
				},
				{
					name: "tag",
					type: "string",
					description: "Override the npm dist-tag passed to bun publish",
				},
				{
					name: "access",
					type: "string",
					description: "npm access level passed to bun publish",
					default: "public",
				},
				{
					name: "dry-run",
					type: "boolean",
					description: "Print publish order and commands without publishing",
					default: false,
				},
				{
					name: "verify",
					type: "boolean",
					description: "Verify staged directories and metadata before publishing",
					default: true,
				},
				{
					name: "registry",
					type: "string",
					description: "Override the registry passed to bun publish",
				},
			)
			.action(async ({ flags }) => {
				const stageDir = resolve(process.cwd(), flags["stage-dir"]);
				const manifest = readPublishManifest(stageDir);

				await publishStagedPackages(manifest, {
					stageDir,
					access: flags.access,
					tag: flags.tag,
					registry: flags.registry,
					dryRun: flags["dry-run"],
					verify: flags.verify,
				});
			}),
);
