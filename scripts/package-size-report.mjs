// Measure what consumers actually pay for publishable library packages:
//   - bundle: each public `exports` entrypoint bundled with Bun.build
//     (tree-shaken, minified) and gzipped — the cost of importing that entry.
//   - install: tarball and unpacked size from `npm pack --dry-run`.
// CLI packages (with a bin field) are excluded since their size is install
// cost, not runtime code shipped to consumers.
// Usage:
//   bun scripts/package-size-report.mjs sizes [rootDir] > sizes.json
//   bun scripts/package-size-report.mjs sizes-published [rootDir] > base.json
//   bun scripts/package-size-report.mjs compare base.json head.json > tables.md
// `sizes-published` measures the latest npm-published version of each
// workspace package (used on changeset release PRs, where the code diff
// against main is empty and the meaningful base is the last release).
// Local runs: rm -rf packages/*/dist first — turbo cache restore doesn't prune
// stray dist files from other branches, which inflates install sizes.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const [mode, ...args] = process.argv.slice(2);

// Publishable workspace packages: [pkgDir, parsed package.json] pairs.
function workspacePackages(root) {
	const out = [];
	for (const dir of readdirSync(join(root, "packages"))) {
		const pkgDir = join(root, "packages", dir);
		let pkg;
		try {
			pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
		} catch {
			// not a package dir (no package.json)
			continue;
		}
		if (pkg.private || pkg.bin) continue;
		out.push([pkgDir, pkg]);
	}
	return out;
}

// Gzipped size of each public `exports` entrypoint, bundled from pkgDir.
async function bundleEntries(pkgDir, pkg) {
	const entries = {};
	for (const [entry, target] of Object.entries(pkg.exports ?? {})) {
		const file = typeof target === "string" ? target : target.import;
		if (!file || !/\.(js|mjs|cjs)$/.test(file)) continue;
		const result = await Bun.build({
			entrypoints: [resolve(pkgDir, file)],
			target: "bun",
			minify: true,
			// Peers are provided by the consumer and measured in their own row;
			// inlining them would double-count and make this row churn on their PRs.
			external: Object.keys(pkg.peerDependencies ?? {}),
		});
		if (!result.success) {
			throw new AggregateError(result.logs, `Bun.build failed for ${pkg.name}${entry.slice(1)}`);
		}
		let size = 0;
		for (const artifact of result.outputs) {
			size += gzipSync(Buffer.from(await artifact.arrayBuffer())).length;
		}
		entries[entry] = size;
	}
	return entries;
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
	for (const [pkgDir, pkg] of workspacePackages(root)) {
		const [packed] = npmPack([], pkgDir);
		out[pkg.name] = {
			entries: await bundleEntries(pkgDir, pkg),
			tarball: packed.size,
			unpacked: packed.unpackedSize,
		};
	}
	return out;
}

async function measurePublished(root) {
	const out = {};
	const published = [];
	for (const [, pkg] of workspacePackages(root)) {
		let packed;
		try {
			[packed] = npmPack([`${pkg.name}@latest`], root);
		} catch {
			// E404: not yet published — omit so compare renders it as "new"
			continue;
		}
		out[pkg.name] = { tarball: packed.size, unpacked: packed.unpackedSize };
		published.push(pkg.name);
	}
	if (published.length === 0) return out;

	// Install the published versions in a throwaway project so bundling
	// resolves real released code and dependency versions, not the workspace.
	const tmp = mkdtempSync(join(tmpdir(), "pkg-size-published-"));
	try {
		writeFileSync(
			join(tmp, "package.json"),
			JSON.stringify({
				name: "published-size-probe",
				dependencies: Object.fromEntries(published.map((n) => [n, "latest"])),
			}),
		);
		execFileSync("npm", ["install", "--no-audit", "--no-fund"], {
			cwd: tmp,
			stdio: ["ignore", "ignore", "inherit"],
		});
		for (const name of published) {
			const pkgDir = join(tmp, "node_modules", name);
			const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
			out[name].entries = await bundleEntries(pkgDir, pkg);
		}
	} finally {
		rmSync(tmp, { recursive: true, force: true });
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
	const install = [
		"",
		"### Install size (`npm pack`)",
		"",
		"| Package | Tarball | Unpacked | Δ unpacked |",
		"|---|---:|---:|---:|",
	];
	for (const name of names) {
		const entryNames = [
			...new Set([
				...Object.keys(base[name]?.entries ?? {}),
				...Object.keys(head[name]?.entries ?? {}),
			]),
		].sort();
		for (const entry of entryNames) {
			const b = base[name]?.entries?.[entry];
			const h = head[name]?.entries?.[entry];
			bundle.push(`| \`${name}${entry.slice(1)}\` | ${fmt(b)} | ${fmt(h)} | ${delta(b, h)} |`);
		}
		const b = base[name];
		const h = head[name];
		install.push(
			`| \`${name}\` | ${fmt(h?.tarball)} | ${fmt(h?.unpacked)} | ${delta(b?.unpacked, h?.unpacked)} |`,
		);
	}
	console.log([...bundle, ...install].join("\n"));
} else {
	console.error(
		"usage: package-size-report.mjs sizes|sizes-published [rootDir] | compare <base.json> <head.json>",
	);
	process.exit(1);
}
