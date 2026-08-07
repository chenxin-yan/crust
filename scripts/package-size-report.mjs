// Measure what consumers actually pay for publishable library packages:
//   - bundle: each public `exports` entrypoint bundled with Bun.build
//     (tree-shaken, minified) and gzipped — the cost of importing that entry.
//   - install: tarball and unpacked size from `npm pack --dry-run`.
// CLI packages (with a bin field) are excluded since their size is install
// cost, not runtime code shipped to consumers.
// Usage:
//   bun scripts/package-size-report.mjs sizes [rootDir] > sizes.json
//   bun scripts/package-size-report.mjs compare base.json head.json > tables.md
// Local runs: rm -rf packages/*/dist first — turbo cache restore doesn't prune
// stray dist files from other branches, which inflates install sizes.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const [mode, ...args] = process.argv.slice(2);

async function measure(root) {
	const out = {};
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

		// TODO: switch to `bun pm pack` (the tool we publish with) once it has
		// machine-readable output — https://github.com/oven-sh/bun/issues/14155.
		// npm is safe meanwhile: file selection and unpacked bytes match bun's
		// exactly; only tarball gzip bytes differ slightly.
		const [packed] = JSON.parse(
			execFileSync("npm", ["pack", "--dry-run", "--json"], {
				cwd: pkgDir,
				stdio: ["ignore", "pipe", "ignore"],
			}),
		);
		out[pkg.name] = {
			entries,
			tarball: packed.size,
			unpacked: packed.unpackedSize,
		};
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
	console.error("usage: package-size-report.mjs sizes [rootDir] | compare <base.json> <head.json>");
	process.exit(1);
}
