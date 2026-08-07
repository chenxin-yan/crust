// Report gzipped runtime JS sizes (dist/**/*.js) for publishable library
// packages — CLI packages (with a bin field) are excluded since their size
// is install cost, not runtime code shipped to consumers.
// Usage:
//   bun scripts/package-size-report.mjs sizes [rootDir] > sizes.json
//   bun scripts/package-size-report.mjs compare base.json head.json > table.md
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const [mode, ...args] = process.argv.slice(2);

if (mode === "sizes") {
	const root = args[0] ?? ".";
	const out = {};
	for (const dir of readdirSync(join(root, "packages"))) {
		let pkg;
		try {
			pkg = JSON.parse(
				readFileSync(join(root, "packages", dir, "package.json"), "utf8"),
			);
		} catch {
			// not a package dir (no package.json)
			continue;
		}
		if (pkg.private || pkg.bin) continue;
		const dist = join(root, "packages", dir, "dist");
		let size = 0;
		for (const file of readdirSync(dist, { recursive: true })) {
			if (!/\.(js|mjs|cjs)$/.test(file)) continue;
			size += gzipSync(readFileSync(join(dist, file))).length;
		}
		out[pkg.name] = { size };
	}
	console.log(JSON.stringify(out, null, 2));
} else if (mode === "compare") {
	const [base, head] = args.map((f) => JSON.parse(readFileSync(f, "utf8")));
	const kb = (bytes) => `${(bytes / 1024).toFixed(2)} KB`;
	const names = [
		...new Set([...Object.keys(base), ...Object.keys(head)]),
	].sort();
	const lines = [
		"| Package | Base | Head | Δ (JS, gzip) |",
		"|---|---:|---:|---:|",
	];
	for (const name of names) {
		const b = base[name]?.size;
		const h = head[name]?.size;
		let delta;
		if (b == null) delta = "new";
		else if (h == null) delta = "removed";
		else if (h === b) delta = "±0";
		else {
			const d = h - b;
			delta = `${d > 0 ? "+" : "-"}${kb(Math.abs(d))} (${d > 0 ? "+" : ""}${((d / b) * 100).toFixed(1)}%)`;
		}
		lines.push(
			`| \`${name}\` | ${b == null ? "—" : kb(b)} | ${h == null ? "—" : kb(h)} | ${delta} |`,
		);
	}
	console.log(lines.join("\n"));
} else {
	console.error("usage: package-size-report.mjs sizes [rootDir] | compare <base.json> <head.json>");
	process.exit(1);
}
