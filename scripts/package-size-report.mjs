// Report npm-pack tarball sizes for publishable packages, and diff two reports.
// Usage:
//   bun scripts/package-size-report.mjs sizes [rootDir] > sizes.json
//   bun scripts/package-size-report.mjs compare base.json head.json > table.md
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
		if (pkg.private) continue;
		const [info] = JSON.parse(
			execFileSync("npm", ["pack", "--dry-run", "--json"], {
				cwd: join(root, "packages", dir),
				encoding: "utf8",
			}),
		);
		out[pkg.name] = { size: info.size, unpackedSize: info.unpackedSize };
	}
	console.log(JSON.stringify(out, null, 2));
} else if (mode === "compare") {
	const [base, head] = args.map((f) => JSON.parse(readFileSync(f, "utf8")));
	const kb = (bytes) => `${(bytes / 1024).toFixed(2)} KB`;
	const names = [
		...new Set([...Object.keys(base), ...Object.keys(head)]),
	].sort();
	const lines = [
		"| Package | Base | Head | Δ (tarball) |",
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
