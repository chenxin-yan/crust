import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { defineCommand, type InvocationIO } from "@crustjs/core";
import { bold, cyan, dim, green } from "@crustjs/style";
import { runProcess, which } from "@crustjs/utils/process";

import { CRUST_DIR, type DistributionManifest } from "../utils/distribute.ts";

type PublishPackageJson = {
	name?: string;
	version?: string;
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

export function readPublishManifest(stageDir: string): DistributionManifest {
	const manifestPath = join(stageDir, "manifest.json");
	if (!existsSync(manifestPath)) {
		throw new Error(
			`Staged manifest not found at ${manifestPath}\n  Run \`crust build\` before \`crust publish\`.`,
		);
	}

	// SAFETY: validatePublishManifest checks every manifest field used before publishing.
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

	const commands = manifest.root.bins;
	if (!Array.isArray(commands) || commands.length === 0) {
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

	for (const pkg of manifest.packages) {
		const stagedPackageJson = readStagedPackageJson(stageDir, pkg.dir);

		if (stagedPackageJson.name !== pkg.name) {
			throw new Error(`Staged package name mismatch for ${pkg.dir}.`);
		}

		if (stagedPackageJson.version !== rootPackageJson.version) {
			throw new Error("All staged package versions must match.");
		}

		if (!pkg.os || !pkg.cpu || !pkg.bins) {
			throw new Error(`Manifest entry for ${pkg.dir} is missing os/cpu/bins metadata.`);
		}

		if (!Array.isArray(stagedPackageJson.os) || stagedPackageJson.os[0] !== pkg.os) {
			throw new Error(`Staged package ${pkg.dir} is missing correct os metadata.`);
		}

		if (!Array.isArray(stagedPackageJson.cpu) || stagedPackageJson.cpu[0] !== pkg.cpu) {
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
	manifest: DistributionManifest,
	options: PublishOptions,
	io: InvocationIO,
): Promise<void> {
	validatePublishManifest(options.stageDir, manifest);

	const command = buildPublishCommand({ tag: options.tag, registry: options.registry });
	io.stdout(`${dim("Publish order:")} ${manifest.publishOrder.join(" -> ")}`);
	for (const relativeDir of manifest.publishOrder) {
		io.stdout(`  ${cyan("→")} ${relativeDir}: ${dim(command.join(" "))}`);
	}

	if (options.dryRun) {
		return;
	}

	const spawnPublish = options.spawnPublish ?? defaultSpawnPublish;

	for (const relativeDir of manifest.publishOrder) {
		const dir = join(options.stageDir, relativeDir);
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
