#!/usr/bin/env bun
// @ts-check

import { glob, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const ROOT_DIR = resolve(import.meta.dir, "..");
const REGISTRY = "https://registry.npmjs.org";

/**
 * @typedef {object} WorkspacePackage
 * @property {string} name
 * @property {string} version
 * @property {string} dir
 * @property {boolean} [private]
 * @property {Record<string, string>} [scripts]
 * @property {Record<string, string>} [dependencies]
 * @property {Record<string, string>} [optionalDependencies]
 * @property {Record<string, string>} [peerDependencies]
 */

/** @typedef {{ name: string; version: string; file: string }} PackageEntry */

/**
 * @param {string} path
 * @returns {Promise<unknown>}
 */
async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

async function loadWorkspacePackages() {
	const { packages: patterns } = /** @type {{ packages?: unknown }} */ (
		Bun.YAML.parse(await readFile(join(ROOT_DIR, "pnpm-workspace.yaml"), "utf8"))
	);
	if (
		!Array.isArray(patterns) ||
		patterns.length === 0 ||
		// oxlint-disable-next-line anti-slop/no-runtime-typeof -- Validate workspace YAML at its I/O boundary.
		!patterns.every((pattern) => typeof pattern === "string" && pattern !== "")
	) {
		throw new Error("pnpm-workspace.yaml must list workspace package patterns.");
	}
	/** @type {WorkspacePackage[]} */
	const packages = [];
	for await (const file of glob(
		patterns.map((pattern) => `${pattern}/package.json`),
		{ cwd: ROOT_DIR },
	)) {
		const packageJson = /** @type {Omit<WorkspacePackage, "dir">} */ (
			await readJson(join(ROOT_DIR, file))
		);
		if (!packageJson.private) {
			packages.push({ ...packageJson, dir: join(ROOT_DIR, dirname(file)) });
		}
	}
	return packages;
}

/**
 * @param {WorkspacePackage[]} packages
 * @returns {WorkspacePackage[]}
 */
function sortPackagesForPublish(packages) {
	/** @type {Map<string, Set<string>>} */
	const dependents = new Map();
	/** @type {Map<string, number>} */
	const indegree = new Map();
	for (const pkg of packages) {
		dependents.set(pkg.name, new Set());
		indegree.set(pkg.name, 0);
	}
	for (const pkg of packages) {
		const dependencies = {
			...pkg.dependencies,
			...pkg.optionalDependencies,
			...pkg.peerDependencies,
		};
		for (const dependency of Object.keys(dependencies)) {
			const dependencyDependents = dependents.get(dependency);
			if (dependencyDependents) {
				dependencyDependents.add(pkg.name);
				indegree.set(pkg.name, (indegree.get(pkg.name) ?? 0) + 1);
			}
		}
	}
	const queue = packages
		.filter((pkg) => indegree.get(pkg.name) === 0)
		.map((pkg) => pkg.name)
		.sort();
	const orderedNames = [];
	for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
		orderedNames.push(current);
		for (const dependent of dependents.get(current) ?? []) {
			const remaining = (indegree.get(dependent) ?? 0) - 1;
			indegree.set(dependent, remaining);
			if (remaining === 0) {
				queue.push(dependent);
				queue.sort();
			}
		}
	}
	if (orderedNames.length !== packages.length) {
		throw new Error(
			"Unable to determine publish order due to a dependency cycle or duplicate package name.",
		);
	}
	const packagesByName = new Map(packages.map((pkg) => [pkg.name, pkg]));
	return orderedNames.flatMap((name) => packagesByName.get(name) ?? []);
}

/**
 * @param {string[]} args
 * @param {string} [cwd]
 * @param {boolean} [allowFailure]
 */
async function runCommand(args, cwd = ROOT_DIR, allowFailure = false) {
	const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	if (exitCode !== 0 && !allowFailure) {
		throw new Error(`${args.join(" ")} failed (${exitCode}): ${stderr || stdout}`);
	}
	return { exitCode, stdout, stderr };
}

/** @param {string} directory */
async function packPackages(directory) {
	await mkdir(directory, { recursive: true });
	if ((await readdir(directory)).length > 0) {
		throw new Error(`Pack directory must be empty: ${directory}`);
	}
	// Only the unprivileged pack job loads workspace code and runs lifecycle hooks.
	const { readPublishManifest, validatePublishManifest } =
		await import("../packages/crust/src/publish.ts");
	/** @type {PackageEntry[]} */
	const inventory = [];
	for (const pkg of sortPackagesForPublish(await loadWorkspacePackages())) {
		/** @type {Array<{ path: string; packageJson: { name: string; version: string } }>} */
		let entries = [{ path: pkg.dir, packageJson: pkg }];
		if (pkg.scripts?.release) {
			const stageDir = join(pkg.dir, ".crust");
			const manifest = readPublishManifest(stageDir);
			if (manifest.root.name !== pkg.name || manifest.version !== pkg.version) {
				throw new Error(
					`Staged identity does not match ${pkg.name}@${pkg.version}; rebuild before packing.`,
				);
			}
			entries = validatePublishManifest(stageDir, manifest);
		}
		for (const entry of entries) {
			const { name, version } = entry.packageJson;
			const file = `${inventory.length}.tgz`;
			console.log(`Packing ${name}@${version}`);
			// pnpm rewrites workspace/catalog ranges; prepack hooks include LICENSE files.
			await runCommand(["pnpm", "pack", "--out", join(directory, file)], entry.path);
			inventory.push({ name, version, file });
		}
	}
	if (inventory.length === 0) throw new Error("No public packages found.");
	// An incomplete pack must never leave an uploadable inventory.
	await writeFile(join(directory, "packages.json"), `${JSON.stringify(inventory, null, 2)}\n`);
}

/* oxlint-disable anti-slop/no-runtime-typeof -- Validate artifact JSON at the upload boundary; the rule cannot see JSDoc type predicates. */
/**
 * @param {any} pkg
 * @returns {pkg is PackageEntry}
 */
function isPackageEntry(pkg) {
	return (
		pkg !== null &&
		typeof pkg === "object" &&
		typeof pkg.name === "string" &&
		/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(pkg.name) &&
		typeof pkg.version === "string" &&
		/^\d+\.\d+\.\d+$/.test(pkg.version) &&
		typeof pkg.file === "string" &&
		/^\d+\.tgz$/.test(pkg.file)
	);
}
/* oxlint-enable anti-slop/no-runtime-typeof */

/** @param {string} directory */
async function readInventory(directory) {
	const packages = await readJson(join(directory, "packages.json"));
	if (!Array.isArray(packages) || packages.length === 0 || !packages.every(isPackageEntry)) {
		throw new Error(
			"Invalid release inventory: expected named stable versions and local tarball filenames.",
		);
	}
	if (
		new Set(packages.map((pkg) => pkg.name)).size !== packages.length ||
		new Set(packages.map((pkg) => pkg.file)).size !== packages.length
	) {
		throw new Error("Duplicate package or tarball in release inventory.");
	}
	for (const pkg of packages) {
		// Basename-only paths plus lstat reject traversal, directories and symlinks.
		if (!(await lstat(join(directory, pkg.file))).isFile()) {
			throw new Error(`Release artifact must be a regular file: ${pkg.file}`);
		}
	}
	return packages;
}

/** @param {string} name */
function registryArgs(name) {
	// Repository releases target public npm, regardless of ambient npmrc settings.
	// Both commands get the same explicit scope/registry overrides.
	return [
		`--registry=${REGISTRY}`,
		"--scope=",
		...(name.startsWith("@") ? [`--${name.split("/")[0]}:registry=${REGISTRY}`] : []),
	];
}

/**
 * @param {string} directory
 * @param {boolean} dryRun
 */
async function publishPackages(directory, dryRun) {
	const packages = await readInventory(directory);
	/** @type {PackageEntry[]} */
	const missing = [];
	for (const pkg of packages) {
		const spec = `${pkg.name}@${pkg.version}`;
		const result = await runCommand(
			["npm", "view", spec, "version", "--json", ...registryArgs(pkg.name)],
			ROOT_DIR,
			true,
		);
		let body;
		try {
			body = JSON.parse(result.stdout);
		} catch {
			throw new Error(`Inconclusive npm lookup for ${spec}: ${result.stderr || result.stdout}`);
		}
		if (result.exitCode === 0 && body === pkg.version) {
			console.log(`Already published: ${spec}`);
		} else if (result.exitCode !== 0 && body?.error?.code === "E404") {
			missing.push(pkg);
		} else {
			throw new Error(`Could not check ${spec}: ${result.stderr || result.stdout}`);
		}
	}
	if (dryRun) {
		console.log(`Dry run: ${missing.length} package versions would be published.`);
		return;
	}
	for (const pkg of missing) {
		console.log(`Publishing ${pkg.name}@${pkg.version}`);
		await runCommand([
			"npm",
			"publish",
			join(directory, pkg.file),
			"--ignore-scripts",
			"--access",
			"public",
			...registryArgs(pkg.name),
		]);
	}
	console.log(
		`Published ${missing.length} package versions. Cohort is ready for Changesets tagging.`,
	);
}

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		"pack-dir": { type: "string" },
		"publish-dir": { type: "string" },
		"dry-run": { type: "boolean", default: false },
	},
});
const { "pack-dir": packDir, "publish-dir": publishDir, "dry-run": dryRun } = values;
if (packDir && !publishDir && !dryRun) {
	await packPackages(resolve(packDir));
} else if (publishDir && !packDir) {
	await publishPackages(resolve(publishDir), dryRun);
} else {
	throw new Error("Choose --pack-dir <empty directory> or --publish-dir <directory> [--dry-run].");
}
