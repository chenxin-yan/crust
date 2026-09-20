// Measure what consumers actually pay for publishable library packages:
//   - bundle: each public `exports` entrypoint bundled with Bun.build
//     (tree-shaken, minified) and gzipped — the cost of importing that entry.
//   - consumers: small fixture apps (scripts/package-size-fixtures/) bundled
//     the same way against the measured tree — the cost of typical usage.
//   - install: tarball and unpacked size from `npm pack --dry-run`, plus the
//     runtime footprint: unpacked bytes of the package and its production
//     `dependencies` graph (each package once; peers excluded).
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
// Local runs: rm -rf packages/*/dist first — turbo cache restore doesn't prune
// stray dist files from other branches, which inflates install sizes.
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

const [mode, ...args] = process.argv.slice(2);

const fixturesDir = join(import.meta.dirname, "package-size-fixtures");
// What `crust build` defines for finished Bun/Node bundles, so build-only
// branches in core are dead code for the CLI fixture as they are in real apps.
const finishedBuildDefine = { "process.env.CRUST_INTERNAL_BUILD": '"1"' };
// Consumer fixtures per package. Packages absent from the measured tree are
// simply never visited, so older base refs need no fixture support. They are
// .mjs because Bun bundles them against a chosen tree; @crustjs/core is not
// resolvable from scripts/, so `tsc -p scripts` must not type-check them.
const consumerFixtures = {
	"@crustjs/core": [
		{ name: "cli", file: "core-cli.mjs", define: finishedBuildDefine },
		{ name: "error-only", file: "core-error-only.mjs" },
		{ name: "tooling-docs", file: "core-tooling-docs.mjs" },
	],
};

const readPackage = (dir) => JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));

// Every workspace package dir with a package.json, as [pkgDir, manifest].
function packageDirs(root) {
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

// Publishable workspace packages: [pkgDir, parsed package.json] pairs.
const workspacePackages = (root) => packageDirs(root).filter(([, pkg]) => !pkg.private && !pkg.bin);

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
const peers = (pkg) => Object.keys(pkg.peerDependencies ?? {});

// Gzipped size of each public `exports` entrypoint, bundled from pkgDir.
async function bundleEntries(pkgDir, pkg) {
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
async function bundleConsumers(consumerRoot, pkg) {
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

// Consumer root for a workspace tree: node_modules symlinks to that tree's
// package dirs. Bun resolves through the symlink, so transitive workspace
// deps resolve from each package's own node_modules, exactly as bundleEntries does.
function workspaceConsumerRoot(packages) {
	const tmp = mkdtempSync(join(tmpdir(), "pkg-size-consumer-"));
	for (const [pkgDir, pkg] of packages) {
		const link = join(tmp, "node_modules", pkg.name);
		mkdirSync(dirname(link), { recursive: true });
		symlinkSync(resolve(pkgDir), link);
	}
	return tmp;
}

// Runtime footprint: unpacked bytes of pkg plus its production `dependencies`
// graph, each package counted once. Peer and optional peer dependencies are
// excluded (consumers provide them). resolveDep(name, fromDir) returns the
// dependency's package dir or undefined; unpackedOf(dir) its unpacked bytes.
function footprint(pkgDir, pkg, resolveDep, unpackedOf) {
	const seen = new Map();
	const visit = (dir, manifest) => {
		if (seen.has(manifest.name)) return;
		seen.set(manifest.name, dir);
		for (const name of Object.keys(manifest.dependencies ?? {})) {
			const depDir = resolveDep(name, dir);
			if (depDir) visit(depDir, readPackage(depDir));
		}
	};
	visit(pkgDir, pkg);
	let total = 0;
	for (const dir of seen.values()) total += unpackedOf(dir);
	return total;
}

// TODO: switch to `bun pm pack` (the tool we publish with) once it has
// machine-readable output — https://github.com/oven-sh/bun/issues/14155.
// npm is safe meanwhile: file selection and unpacked bytes match bun's
// exactly; only tarball gzip bytes differ slightly.
const npmPack = (extraArgs, cwd) =>
	JSON.parse(
		execFileSync("npm", ["pack", "--dry-run", "--json", ...extraArgs], {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
		}),
	);

async function measure(root) {
	const out = {};
	const all = packageDirs(root);
	const byName = new Map(all.map(([pkgDir, pkg]) => [pkg.name, pkgDir]));
	// Each package is packed once even when several footprints include it.
	const packed = new Map();
	const packOnce = (dir) => {
		if (!packed.has(dir)) packed.set(dir, npmPack([], dir)[0]);
		return packed.get(dir);
	};
	const publishable = workspacePackages(root);
	const consumerRoot = workspaceConsumerRoot(all);
	try {
		for (const [pkgDir, pkg] of publishable) {
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
function resolveInstalled(name, fromDir, root) {
	for (let dir = fromDir; ; dir = dirname(dir)) {
		const candidate = join(dir, "node_modules", name);
		if (existsSync(join(candidate, "package.json"))) return candidate;
		if (dir === root || dirname(dir) === dir) return undefined;
	}
}

async function measurePublished(root) {
	const out = {};
	for (const [, pkg] of workspacePackages(root)) {
		let packed;
		try {
			[packed] = npmPack([`${pkg.name}@latest`], root);
		} catch (error) {
			if (error.stdout && JSON.parse(error.stdout).error?.code === "E404") continue;
			throw error;
		}
		out[pkg.name] = { tarball: packed.size, unpacked: packed.unpackedSize };

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
			out[pkg.name].entries = await bundleEntries(pkgDir, installed);
			out[pkg.name].consumers = await bundleConsumers(tmp, installed);
			out[pkg.name].footprint = footprint(
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

const kb = (bytes) => `${(bytes / 1024).toFixed(2)} KB`;
const fmt = (bytes) => (bytes == null ? "—" : kb(bytes));
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
			"each package counted once. Peer and optional peer dependencies (e.g. `typescript`) are excluded. " +
			"These are npm unpacked bytes, not exact disk usage.",
		"",
		"| Package | Tarball | Unpacked | Δ unpacked | Runtime footprint | Δ footprint |",
		"|---|---:|---:|---:|---:|---:|",
	];
	// Union of a per-package map's keys across base and head, sorted.
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
