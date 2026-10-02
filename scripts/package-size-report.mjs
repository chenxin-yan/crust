// Measure what consumers actually pay for publishable library packages:
//   - bundle: each public `exports` entrypoint bundled with Bun.build
//     (tree-shaken, minified) and gzipped — the cost of importing that entry.
//   - consumers: small fixture apps (scripts/package-size-fixtures/) bundled
//     the same way against the measured tree — the cost of typical usage.
//   - install: tarball and unpacked size from `npm pack --dry-run`, plus the
//     runtime footprint: unpacked bytes of the package and its production
//     `dependencies` graph (each installed copy once; peers excluded).
// CLI packages (with a bin field) are excluded since their size is install
// cost, not runtime code shipped to consumers.
// Usage:
//   bun scripts/package-size-report.mjs sizes [rootDir] > sizes.json
//   bun scripts/package-size-report.mjs sizes-published [rootDir] > base.json
//   bun scripts/package-size-report.mjs compare base.json head.json > tables.md
// `sizes-published` measures the latest npm-published version of each
// workspace package (used on changeset release PRs, where the code diff
// against main is empty and the meaningful base is the last release).
// Each release is installed separately: latest versions across packages may
// require incompatible peers and need not form one valid dependency tree.
// Local runs: rm -rf packages/*/dist first — Vite Task cache hits don't prune
// stray dist files from other branches, which inflates install sizes.
// @ts-check
import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

/**
 * @typedef {object} PackageManifest
 * @property {string} name
 * @property {string} [version]
 * @property {boolean} [private]
 * @property {unknown} [bin]
 * @property {Record<string, any>} [exports] Entry targets are paths or condition objects.
 * @property {Record<string, string>} [dependencies]
 * @property {Record<string, string>} [peerDependencies]
 */

/**
 * @typedef {object} PackageSizes
 * @property {number} tarball
 * @property {number} unpacked
 * @property {Record<string, number>} [entries]
 * @property {Record<string, number>} [consumers]
 * @property {number} [footprint]
 */

/** @typedef {{ name: string; file: string; define?: Record<string, string> }} ConsumerFixture */

const [mode, ...args] = process.argv.slice(2);

const fixturesDir = join(import.meta.dirname, "package-size-fixtures");
// What `crust build` defines for finished Bun/Node bundles, so build-only
// branches in core are dead code for the CLI fixture as they are in real apps.
const finishedBuildDefine = { "process.env.CRUST_INTERNAL_BUILD": '"1"' };
// Consumer fixtures per package. Packages absent from the measured tree are
// simply never visited, so older base refs need no fixture support. They are
// unchecked .mjs because Bun bundles them against the measured tree, which may
// be an older release than the @crustjs/core scripts/ type-checks against.
/** @type {Record<string, ConsumerFixture[]>} */
const consumerFixtures = {
	"@crustjs/core": [
		{ name: "cli", file: "core-cli.mjs", define: finishedBuildDefine },
		{ name: "error-only", file: "core-error-only.mjs" },
		{ name: "tooling-docs", file: "core-tooling-docs.mjs" },
	],
};

/** @type {(dir: string) => PackageManifest} */
const readPackage = (dir) => JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));

// Every workspace package dir with a package.json, as [pkgDir, manifest].
/**
 * @param {string} root
 * @returns {Array<[string, PackageManifest]>}
 */
function packageDirs(root) {
	/** @type {Array<[string, PackageManifest]>} */
	const out = [];
	for (const dir of readdirSync(join(root, "packages"))) {
		const pkgDir = join(root, "packages", dir);
		try {
			out.push([pkgDir, readPackage(pkgDir)]);
		} catch {
			// not a package dir (no package.json)
		}
	}
	return out;
}

// Publishable subset of packageDirs() pairs.
/** @type {(packages: Array<[string, PackageManifest]>) => Array<[string, PackageManifest]>} */
const publishable = (packages) => packages.filter(([, pkg]) => !pkg.private && !pkg.bin);

/**
 * @param {string} entrypoint
 * @param {string[]} external
 * @param {Record<string, string> | undefined} define
 * @param {string} label
 */
async function gzippedBundle(entrypoint, external, define, label) {
	const result = await Bun.build({
		entrypoints: [entrypoint],
		target: "bun",
		minify: true,
		external,
		define,
	});
	if (!result.success) {
		throw new AggregateError(result.logs, `Bun.build failed for ${label}`);
	}
	let size = 0;
	for (const artifact of result.outputs) {
		size += gzipSync(Buffer.from(await artifact.arrayBuffer())).length;
	}
	return size;
}

// Peers are provided by the consumer and measured in their own row;
// inlining them would double-count and make this row churn on their PRs.
/** @type {(pkg: PackageManifest) => string[]} */
const peers = (pkg) => Object.keys(pkg.peerDependencies ?? {});

// Gzipped size of each public `exports` entrypoint, bundled from pkgDir.
/**
 * @param {string} pkgDir
 * @param {PackageManifest} pkg
 */
async function bundleEntries(pkgDir, pkg) {
	/** @type {Record<string, number>} */
	const entries = {};
	for (const [entry, target] of Object.entries(pkg.exports ?? {})) {
		const file = target?.import ?? target;
		if (!file || !/\.(js|mjs|cjs)$/.test(file)) continue;
		entries[entry] = await gzippedBundle(
			resolve(pkgDir, file),
			peers(pkg),
			undefined,
			`${pkg.name}${entry.slice(1)}`,
		);
	}
	return entries;
}

// Gzipped size of each consumer fixture for pkg. consumerRoot is a directory
// whose node_modules resolves pkg.name to the measured tree's artifacts, so
// measuring base never picks up head's dist by accident.
/**
 * @param {string} consumerRoot
 * @param {PackageManifest} pkg
 */
async function bundleConsumers(consumerRoot, pkg) {
	/** @type {Record<string, number>} */
	const consumers = {};
	for (const { name, file, define } of consumerFixtures[pkg.name] ?? []) {
		const entry = join(consumerRoot, file);
		copyFileSync(join(fixturesDir, file), entry);
		consumers[name] = await gzippedBundle(
			entry,
			peers(pkg),
			define,
			`${pkg.name} consumer ${name}`,
		);
	}
	return consumers;
}

// Runtime footprint: unpacked bytes of pkg plus its production `dependencies`
// graph. Keyed by resolved directory, not name: a published install can hold a
// nested and a hoisted copy of one package, and both are installed bytes. Peer
// and optional peer dependencies are excluded (consumers provide them).
// resolveDep(name, fromDir) returns the dependency's package dir or undefined;
// unpackedOf(dir) its unpacked bytes.
/**
 * @param {string} pkgDir
 * @param {PackageManifest} pkg
 * @param {(name: string, fromDir: string) => string | undefined} resolveDep
 * @param {(dir: string) => number} unpackedOf
 */
function footprint(pkgDir, pkg, resolveDep, unpackedOf) {
	/** @type {Set<string>} */
	const seen = new Set();
	/** @type {(dir: string, manifest: PackageManifest) => void} */
	const visit = (dir, manifest) => {
		if (seen.has(dir)) return;
		seen.add(dir);
		for (const name of Object.keys(manifest.dependencies ?? {})) {
			const depDir = resolveDep(name, dir);
			if (depDir) visit(depDir, readPackage(depDir));
		}
	};
	visit(pkgDir, pkg);
	let total = 0;
	for (const dir of seen) total += unpackedOf(dir);
	return total;
}

// Releases pack with `pnpm pack`, which only packs local directories;
// `sizes-published` also needs registry specs, so sizes come from npm.
/** @type {(extraArgs: string[], cwd: string) => [{ version: string; size: number; unpackedSize: number }]} */
const npmPack = (extraArgs, cwd) =>
	JSON.parse(
		execFileSync("npm", ["pack", "--dry-run", "--json", ...extraArgs], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}),
	);

/** @param {string} root */
async function measure(root) {
	/** @type {Record<string, PackageSizes>} */
	const out = {};
	const all = packageDirs(root);
	const byName = new Map(all.map(([pkgDir, pkg]) => [pkg.name, pkgDir]));
	// Each package is packed once even when several footprints include it.
	/** @type {Map<string, { size: number; unpackedSize: number }>} */
	const packed = new Map();
	/** @type {(dir: string) => { size: number; unpackedSize: number }} */
	const packOnce = (dir) => {
		let result = packed.get(dir);
		if (!result) {
			[result] = npmPack([], dir);
			packed.set(dir, result);
		}
		return result;
	};
	// Consumer root: node_modules symlinks to this tree's package dirs. Bun
	// resolves through the symlink, so transitive workspace deps come from each
	// package's own node_modules, exactly as bundleEntries does.
	const consumerRoot = mkdtempSync(join(tmpdir(), "pkg-size-consumer-"));
	try {
		for (const [pkgDir, pkg] of all) {
			const link = join(consumerRoot, "node_modules", pkg.name);
			mkdirSync(dirname(link), { recursive: true });
			symlinkSync(resolve(pkgDir), link);
		}
		for (const [pkgDir, pkg] of publishable(all)) {
			const own = packOnce(pkgDir);
			out[pkg.name] = {
				entries: await bundleEntries(pkgDir, pkg),
				consumers: await bundleConsumers(consumerRoot, pkg),
				tarball: own.size,
				unpacked: own.unpackedSize,
				footprint: footprint(
					pkgDir,
					pkg,
					(name) => byName.get(name),
					(dir) => packOnce(dir).unpackedSize,
				),
			};
		}
	} finally {
		rmSync(consumerRoot, { recursive: true, force: true });
	}
	return out;
}

// Node-style lookup of an installed dependency, walking up from fromDir to root.
/**
 * @param {string} name
 * @param {string} fromDir
 * @param {string} root
 */
function resolveInstalled(name, fromDir, root) {
	for (let dir = fromDir; ; dir = dirname(dir)) {
		const candidate = join(dir, "node_modules", name);
		if (existsSync(join(candidate, "package.json"))) return candidate;
		if (dir === root || dirname(dir) === dir) return undefined;
	}
}

/** @param {string} root */
async function measurePublished(root) {
	/** @type {Record<string, PackageSizes>} */
	const out = {};
	for (const [, pkg] of publishable(packageDirs(root))) {
		let packed;
		try {
			[packed] = npmPack([`${pkg.name}@latest`], root);
		} catch (error) {
			const { stdout } = /** @type {{ stdout?: string }} */ (error);
			if (stdout && JSON.parse(stdout).error?.code === "E404") continue;
			throw error;
		}
		/** @type {PackageSizes} */
		const sizes = { tarball: packed.size, unpacked: packed.unpackedSize };
		out[pkg.name] = sizes;

		const tmp = mkdtempSync(join(tmpdir(), "pkg-size-published-"));
		try {
			writeFileSync(
				join(tmp, "package.json"),
				JSON.stringify({
					name: "published-size-probe",
					dependencies: { [pkg.name]: packed.version },
				}),
			);
			execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
				cwd: tmp,
				stdio: ["ignore", "ignore", "inherit"],
			});
			const pkgDir = join(tmp, "node_modules", pkg.name);
			const installed = readPackage(pkgDir);
			sizes.entries = await bundleEntries(pkgDir, installed);
			sizes.consumers = await bundleConsumers(tmp, installed);
			sizes.footprint = footprint(
				pkgDir,
				installed,
				(name, fromDir) => resolveInstalled(name, fromDir, tmp),
				// Installed dirs already hold prepack output (e.g. LICENSE), and
				// their prepack scripts would fail outside the monorepo anyway.
				(dir) => npmPack(["--ignore-scripts"], dir)[0].unpackedSize,
			);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	}
	return out;
}

/** @type {(bytes: number) => string} */
const kb = (bytes) => `${(bytes / 1024).toFixed(2)} KB`;
/** @type {(bytes: number | undefined) => string} */
const fmt = (bytes) => (bytes == null ? "—" : kb(bytes));
/** @type {(b: number | undefined, h: number | undefined) => string} */
const delta = (b, h) => {
	if (b == null) return "new";
	if (h == null) return "removed";
	if (h === b) return "±0";
	const d = h - b;
	// sub-0.01 KB deltas render in bytes instead of a misleading "+0.00 KB"
	const abs = Math.abs(d);
	const size = abs < 5.12 ? `${abs} B` : kb(abs);
	return `${d > 0 ? "+" : "-"}${size} (${d > 0 ? "+" : ""}${((d / b) * 100).toFixed(1)}%)`;
};

if (mode === "sizes") {
	console.log(JSON.stringify(await measure(args[0] ?? "."), null, 2));
} else if (mode === "sizes-published") {
	console.log(JSON.stringify(await measurePublished(args[0] ?? "."), null, 2));
} else if (mode === "compare") {
	const [base, head] = args.map((f) => JSON.parse(readFileSync(f, "utf8")));
	const names = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort();

	const bundle = [
		"### Bundle cost (per entrypoint, minified + gzip)",
		"",
		"| Entry | Base | Head | Δ |",
		"|---|---:|---:|---:|",
	];
	const consumers = [
		"",
		"### Consumer bundles (minified + gzip)",
		"",
		"Fixture apps from `scripts/package-size-fixtures/`, bundled against the measured tree. " +
			"`cli` uses the finished-build define `crust build` applies (`process.env.CRUST_INTERNAL_BUILD`).",
		"",
		"| Fixture | Base | Head | Δ |",
		"|---|---:|---:|---:|",
	];
	const install = [
		"",
		"### Install size (`npm pack`)",
		"",
		"Runtime footprint = unpacked bytes of the package plus its production `dependencies` graph, " +
			"each installed copy counted once. Peer and optional peer dependencies (e.g. `typescript`) are excluded. " +
			"These are npm unpacked bytes, not exact disk usage.",
		"",
		"| Package | Tarball | Unpacked | Δ unpacked | Runtime footprint | Δ footprint |",
		"|---|---:|---:|---:|---:|---:|",
	];
	// Union of a per-package map's keys across base and head, sorted.
	/** @type {(name: string, key: "entries" | "consumers") => string[]} */
	const keysOf = (name, key) =>
		[
			...new Set([
				...Object.keys(base[name]?.[key] ?? {}),
				...Object.keys(head[name]?.[key] ?? {}),
			]),
		].sort();
	for (const name of names) {
		for (const entry of keysOf(name, "entries")) {
			const b = base[name]?.entries?.[entry];
			const h = head[name]?.entries?.[entry];
			bundle.push(`| \`${name}${entry.slice(1)}\` | ${fmt(b)} | ${fmt(h)} | ${delta(b, h)} |`);
		}
		for (const fixture of keysOf(name, "consumers")) {
			const b = base[name]?.consumers?.[fixture];
			const h = head[name]?.consumers?.[fixture];
			consumers.push(`| \`${name}\` ${fixture} | ${fmt(b)} | ${fmt(h)} | ${delta(b, h)} |`);
		}
		const b = base[name];
		const h = head[name];
		install.push(
			`| \`${name}\` | ${fmt(h?.tarball)} | ${fmt(h?.unpacked)} | ${delta(b?.unpacked, h?.unpacked)} | ${fmt(h?.footprint)} | ${delta(b?.footprint, h?.footprint)} |`,
		);
	}
	console.log([...bundle, ...consumers, ...install].join("\n"));
} else {
	console.error(
		"usage: package-size-report.mjs sizes|sizes-published [rootDir] | compare <base.json> <head.json>",
	);
	process.exit(1);
}
