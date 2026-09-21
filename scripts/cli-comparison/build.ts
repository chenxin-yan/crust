import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { libraries } from "./catalog.ts";
import { fingerprint, here } from "./support.ts";

export type BundleRow = {
	id: string;
	target: "bun" | "node";
	file: string;
	bytes: number;
	gzipBytes: number;
	sha256: string;
	external: string[];
};
export type BuildManifest = {
	fingerprint: string;
	bun: string;
	local: unknown;
	versions: Record<string, string>;
	rows: BundleRow[];
};
const out = join(here, ".generated");
const versions: Record<string, string> = {};
const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
for (const [name, pinned] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
	const actual = JSON.parse(
		readFileSync(join(here, "node_modules", name, "package.json"), "utf8"),
	).version;
	if (actual !== pinned) throw new Error(`${name}: installed ${actual}, expected ${pinned}`);
	versions[name] = actual;
}
versions["@crustjs/core"] = JSON.parse(
	readFileSync(join(here, "node_modules/@crustjs/core/package.json"), "utf8"),
).version;
versions["@crustjs/utils"] = JSON.parse(
	readFileSync(join(here, "node_modules/@crustjs/utils/package.json"), "utf8"),
).version;
const local = JSON.parse(readFileSync(join(out, "local.json"), "utf8"));
if (!local.artifacts) throw new Error("Run prepare:local to record local artifact provenance");
for (const [file, expected] of Object.entries(local.artifacts)) {
	const actual = createHash("sha256")
		.update(readFileSync(join(out, "local", file)))
		.digest("hex");
	if (actual !== expected) throw new Error(`Local artifact changed: ${file}; run prepare:local`);
}
rmSync(join(out, "bundles"), { recursive: true, force: true });
mkdirSync(join(out, "entries"), { recursive: true });
const rows: BundleRow[] = [];
for (const { id } of libraries) {
	const entry = join(out, "entries", `${id}.ts`);
	writeFileSync(
		entry,
		`import { fileURLToPath } from "node:url";\nimport { resolve } from "node:path";\nimport { invoke } from "../../adapters/${id}.ts";\nexport { invoke };\nif (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {\n  try { console.log(JSON.stringify(await invoke(process.argv.slice(2)))); }\n  catch (error) { console.error(String(error)); process.exitCode = 1; }\n}\n`,
	);
	for (const target of ["node"] as const) {
		const result = await Bun.build({
			entrypoints: [entry],
			target,
			format: "esm",
			minify: true,
			sourcemap: "none",
			splitting: false,
			packages: "bundle",
			metafile: true,
		});
		if (!result.success) throw new AggregateError(result.logs, `Bundle failed: ${id}/${target}`);
		const [artifact] = result.outputs;
		if (!artifact || result.outputs.length !== 1)
			throw new Error(
				`${id}/${target}: companion artifacts detected; cannot report single-file size`,
			);
		const meta = result.metafile;
		if (!meta) throw new Error("Missing build metafile");
		const external = [
			...new Set(
				Object.values(meta.inputs).flatMap((input) =>
					input.imports.filter((i) => i.external).map((i) => i.path),
				),
			),
		];
		for (const specifier of external)
			if (!isBuiltin(specifier))
				throw new Error(`${id}/${target}: non-builtin external ${specifier}`);
		const data = Buffer.from(await artifact.arrayBuffer());
		const file = join(".generated/bundles", target, `${id}.mjs`);
		mkdirSync(join(here, ".generated/bundles", target), { recursive: true });
		writeFileSync(join(here, file), data);
		writeFileSync(join(here, `${file}.meta.json`), JSON.stringify(meta, null, 2));
		rows.push({
			id,
			target,
			file,
			bytes: data.length,
			gzipBytes: gzipSync(data, { level: 9 }).length,
			sha256: createHash("sha256").update(data).digest("hex"),
			external,
		});
	}
}
const manifest: BuildManifest = {
	fingerprint: fingerprint(),
	bun: Bun.version,
	local,
	versions,
	rows,
};
writeFileSync(join(out, "build.json"), JSON.stringify(manifest, null, 2));
console.log(`Built ${rows.length} standalone candidates; verify before trusting sizes or timing.`);
