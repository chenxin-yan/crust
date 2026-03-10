#!/usr/bin/env bun

import { access, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT_DIR = resolve(import.meta.dir, "..");
const PACKAGES_DIR = join(ROOT_DIR, "packages");
const DEFAULT_REGISTRY = "https://registry.npmjs.org";

function parseArgs(argv) {
	let dryRun = false;

	for (const arg of argv) {
		if (arg === "--dry-run") {
			dryRun = true;
			continue;
		}

		throw new Error(`Unknown argument: ${arg}`);
	}

	return { dryRun };
}

function normalizeRegistry(registry) {
	return registry.replace(/\/+$/, "");
}

function getRegistryUrl() {
	return normalizeRegistry(
		process.env.npm_config_registry ??
			process.env.NPM_CONFIG_REGISTRY ??
			DEFAULT_REGISTRY,
	);
}

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

async function pathExists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function loadWorkspacePackages() {
	const entries = await readdir(PACKAGES_DIR, { withFileTypes: true });
	const packages = [];

	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}

		const relativeDir = `packages/${entry.name}`;
		const dir = join(ROOT_DIR, relativeDir);
		const packageJsonPath = join(dir, "package.json");
		if (!(await pathExists(packageJsonPath))) {
			continue;
		}

		const packageJson = await readJson(packageJsonPath);
		if (packageJson.private || !packageJson.scripts?.publish) {
			continue;
		}

		packages.push({
			name: packageJson.name,
			version: packageJson.version,
			dir,
			relativeDir,
			dependencies: packageJson.dependencies ?? {},
			optionalDependencies: packageJson.optionalDependencies ?? {},
		});
	}

	return packages.sort((a, b) => a.relativeDir.localeCompare(b.relativeDir));
}

function getInternalDependencyNames(pkg, workspaceNames) {
	const allDeps = {
		...pkg.dependencies,
		...pkg.optionalDependencies,
	};

	return new Set(
		Object.keys(allDeps).filter((dependency) => workspaceNames.has(dependency)),
	);
}

function sortPackagesForPublish(packages) {
	const workspaceNames = new Set(packages.map((pkg) => pkg.name));
	const dependents = new Map();
	const indegree = new Map();

	for (const pkg of packages) {
		dependents.set(pkg.name, new Set());
		indegree.set(pkg.name, 0);
	}

	for (const pkg of packages) {
		for (const dependency of getInternalDependencyNames(pkg, workspaceNames)) {
			dependents.get(dependency).add(pkg.name);
			indegree.set(pkg.name, indegree.get(pkg.name) + 1);
		}
	}

	const queue = packages
		.filter((pkg) => indegree.get(pkg.name) === 0)
		.map((pkg) => pkg.name)
		.sort();
	const orderedNames = [];

	while (queue.length > 0) {
		const current = queue.shift();
		orderedNames.push(current);

		for (const dependent of [...dependents.get(current)].sort()) {
			indegree.set(dependent, indegree.get(dependent) - 1);
			if (indegree.get(dependent) === 0) {
				queue.push(dependent);
				queue.sort();
			}
		}
	}

	if (orderedNames.length !== packages.length) {
		const unresolved = packages
			.filter((pkg) => !orderedNames.includes(pkg.name))
			.map((pkg) => pkg.name);
		throw new Error(
			`Unable to determine publish order due to a dependency cycle: ${unresolved.join(", ")}`,
		);
	}

	const packagesByName = new Map(packages.map((pkg) => [pkg.name, pkg]));
	return orderedNames.map((name) => packagesByName.get(name));
}

async function fetchPackageMetadata(pkgName, registryUrl) {
	const response = await fetch(
		`${registryUrl}/${encodeURIComponent(pkgName)}`,
		{
			headers: {
				accept: "application/vnd.npm.install-v1+json, application/json",
			},
		},
	);

	if (response.status === 404) {
		return null;
	}

	if (!response.ok) {
		throw new Error(
			`Failed to query ${pkgName} from ${registryUrl}: ${response.status} ${response.statusText}`,
		);
	}

	return response.json();
}

async function findPackagesToPublish(packages, registryUrl) {
	const metadataByName = new Map(
		await Promise.all(
			packages.map(async (pkg) => [
				pkg.name,
				await fetchPackageMetadata(pkg.name, registryUrl),
			]),
		),
	);

	return packages.filter((pkg) => {
		const metadata = metadataByName.get(pkg.name);
		return !metadata?.versions?.[pkg.version];
	});
}

async function runCommand(args, cwd) {
	const proc = Bun.spawn(args, {
		cwd,
		stdout: "inherit",
		stderr: "inherit",
		env: {
			...process.env,
			BUN_BE_BUN: "1",
		},
	});

	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(
			`${args.join(" ")} failed in ${cwd} with exit code ${exitCode}`,
		);
	}
}

async function tagExists(tag) {
	const proc = Bun.spawn(
		["git", "rev-parse", "-q", "--verify", `refs/tags/${tag}`],
		{
			cwd: ROOT_DIR,
			stdout: "ignore",
			stderr: "ignore",
		},
	);
	return (await proc.exited) === 0;
}

async function createTag(tag) {
	await runCommand(["git", "tag", tag], ROOT_DIR);
}

async function main() {
	const { dryRun } = parseArgs(process.argv.slice(2));
	const registryUrl = getRegistryUrl();
	const packages = sortPackagesForPublish(await loadWorkspacePackages());
	const packagesToPublish = await findPackagesToPublish(packages, registryUrl);

	console.log(`Registry: ${registryUrl}`);
	console.log(
		`Publish order: ${packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(" -> ")}`,
	);

	if (packagesToPublish.length === 0) {
		console.log("No unpublished package versions found.");
		return;
	}

	console.log("Packages to publish:");
	for (const pkg of packagesToPublish) {
		console.log(`- ${pkg.name}@${pkg.version} (${pkg.relativeDir})`);
	}

	if (dryRun) {
		console.log("Dry run enabled; skipping publish and tag creation.");
		return;
	}

	for (const pkg of packagesToPublish) {
		console.log(
			`\nPublishing ${pkg.name}@${pkg.version} from ${pkg.relativeDir}`,
		);
		await runCommand([process.execPath, "run", "publish"], pkg.dir);
	}

	for (const pkg of packagesToPublish) {
		const tag = `${pkg.name}@${pkg.version}`;
		if (await tagExists(tag)) {
			console.log(`Tag already exists: ${tag}`);
			continue;
		}

		console.log(`Creating tag ${tag}`);
		await createTag(tag);
	}
}

await main();
