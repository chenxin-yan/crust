import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testRoot = join(tmpdir(), `package-size-report-${process.pid}`);
const fixtureRoot = join(testRoot, "fixture");
const fakeBin = join(testRoot, "bin");
const installArgs = join(testRoot, "install-args.json");
const reportScript = join(import.meta.dir, "package-size-report.mjs");

// Fake npm: `pack` reports the optional `x-unpacked` field of the cwd package
// (2 when absent) so tests can assert dependency accounting. `install` lays
// out the manifests in FAKE_NPM_TREE (relative path -> manifest) when set, so
// a test can shape a nested/hoisted node_modules tree.
const fakeNpm = `#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
if (args[0] === "pack") {
	if (process.env.FAKE_NPM_ERROR) {
		console.log(JSON.stringify({ error: { code: process.env.FAKE_NPM_ERROR } }));
		process.exit(1);
	}
	const spec = args.slice(1).find((arg) => !arg.startsWith("--"));
	const unpackedSize = spec ? 2 : (JSON.parse(readFileSync("package.json", "utf8"))["x-unpacked"] ?? 2);
	console.log(JSON.stringify([{ version: "1.0.0", size: 1, unpackedSize }]));
} else if (args[0] === "install") {
	writeFileSync(process.env.NPM_ARGS_FILE, JSON.stringify(args));
	const { dependencies } = JSON.parse(readFileSync("package.json", "utf8"));
	// These fixtures represent releases with incompatible peer requirements.
	if (Object.keys(dependencies).length > 1) {
		console.error("ERESOLVE: conflicting peer dependencies");
		process.exit(1);
	}
	const [[name, version]] = Object.entries(dependencies);
	if (version !== "1.0.0") {
		console.error("Expected the version measured by npm pack");
		process.exit(1);
	}
	const tree = process.env.FAKE_NPM_TREE
		? JSON.parse(process.env.FAKE_NPM_TREE)
		: { [join("node_modules", name, "package.json")]: { name, version, exports: {} } };
	for (const [path, manifest] of Object.entries(tree)) {
		mkdirSync(join(process.cwd(), path, ".."), { recursive: true });
		writeFileSync(join(process.cwd(), path), JSON.stringify(manifest));
	}
}
`;

// The package.json fields the report reads, plus the fake npm's `x-unpacked`.
type Manifest = {
	name: string;
	exports?: Record<string, { import: string }>;
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	"x-unpacked"?: number;
};

function writePackage(root: string, dir: string, manifest: Manifest) {
	const pkgDir = join(root, "packages", dir);
	mkdirSync(pkgDir, { recursive: true });
	writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ exports: {}, ...manifest }));
	return pkgDir;
}

// A stand-in @crustjs/core whose dist satisfies the consumer fixtures; `pad`
// changes the retained code so bundles from different roots are told apart.
function writeFakeCore(root: string, pad: number) {
	const pkgDir = writePackage(root, "core", {
		name: "@crustjs/core",
		exports: { ".": { import: "./dist/index.js" }, "./tooling": { import: "./dist/tooling.js" } },
	});
	const padding = JSON.stringify(Array.from({ length: pad }, (_, i) => i * 7919));
	mkdirSync(join(pkgDir, "dist"));
	writeFileSync(
		join(pkgDir, "dist", "index.js"),
		`export class Crust { flags() { return this; } action() { return this; } async execute() {} }
export const defineFlag = (name, spec) => ({ name, ...spec });
export class CrustError extends Error { hint = ${padding}; }
`,
	);
	writeFileSync(
		join(pkgDir, "dist", "tooling.js"),
		`export const buildCommandDocumentation = () => ${padding};\n`,
	);
}

beforeEach(() => {
	rmSync(testRoot, { recursive: true, force: true });
	mkdirSync(fakeBin, { recursive: true });
	writePackage(fixtureRoot, "fixture", { name: "@fixture/package" });
	const npm = join(fakeBin, "npm");
	writeFileSync(npm, fakeNpm);
	chmodSync(npm, 0o755);
});

afterAll(() => rmSync(testRoot, { recursive: true, force: true }));

function run(cmd: string[], errorCode?: string, tree?: Record<string, Manifest>) {
	return Bun.spawnSync({
		cmd: [process.execPath, reportScript, ...cmd],
		env: {
			...process.env,
			PATH: `${fakeBin}:${process.env.PATH}`,
			NPM_ARGS_FILE: installArgs,
			...(errorCode ? { FAKE_NPM_ERROR: errorCode } : {}),
			...(tree ? { FAKE_NPM_TREE: JSON.stringify(tree) } : {}),
		},
		stdout: "pipe",
		stderr: "pipe",
	});
}

function runJson(cmd: string[]) {
	const result = run(cmd);
	expect(result.stderr.toString()).toBe("");
	expect(result.exitCode).toBe(0);
	return JSON.parse(result.stdout.toString());
}

describe("sizes", () => {
	it("counts the workspace dependency graph once and excludes peers", () => {
		writePackage(fixtureRoot, "a", {
			name: "@fixture/a",
			"x-unpacked": 100,
			dependencies: { "@fixture/b": "workspace:^", "@fixture/d": "workspace:*" },
			peerDependencies: { "@fixture/c": "workspace:*" },
		});
		writePackage(fixtureRoot, "b", {
			name: "@fixture/b",
			"x-unpacked": 10,
			dependencies: { "@fixture/d": "workspace:^" },
		});
		writePackage(fixtureRoot, "c", { name: "@fixture/c", "x-unpacked": 1000 });
		writePackage(fixtureRoot, "d", { name: "@fixture/d", "x-unpacked": 1 });

		const sizes = runJson(["sizes", fixtureRoot]);
		expect(sizes["@fixture/a"]).toEqual({
			entries: {},
			consumers: {},
			tarball: 1,
			unpacked: 100,
			footprint: 111,
		});
		expect(sizes["@fixture/b"].footprint).toBe(11);
		expect(sizes["@fixture/c"].footprint).toBe(1000);
	});

	it("bundles consumer fixtures against the given root's artifacts", () => {
		const otherRoot = join(testRoot, "other");
		writeFakeCore(fixtureRoot, 1);
		writeFakeCore(otherRoot, 2000);

		const sizes = runJson(["sizes", fixtureRoot]);
		const small = sizes["@crustjs/core"].consumers;
		const large = runJson(["sizes", otherRoot])["@crustjs/core"].consumers;
		expect(Object.keys(small).sort()).toEqual(["cli", "error-only", "tooling-docs"]);
		for (const fixture of ["error-only", "tooling-docs"]) {
			expect(small[fixture]).toBeGreaterThan(0);
			expect(large[fixture]).toBeGreaterThan(small[fixture] + 1000);
		}
		expect(sizes["@fixture/package"].consumers).toEqual({});
	});
});

describe("sizes-published", () => {
	it("only treats npm E404 responses as unpublished", () => {
		const notFound = run(["sizes-published", fixtureRoot], "E404");
		expect(notFound.exitCode).toBe(0);
		expect(JSON.parse(notFound.stdout.toString())).toEqual({});
		expect(run(["sizes-published", fixtureRoot], "E503").exitCode).not.toBe(0);
	});

	it("measures releases with incompatible peers in separate installs", () => {
		writePackage(fixtureRoot, "other", { name: "@fixture/other" });
		const measured = { tarball: 1, unpacked: 2, entries: {}, consumers: {}, footprint: 2 };
		expect(runJson(["sizes-published", fixtureRoot])).toEqual({
			"@fixture/package": measured,
			"@fixture/other": measured,
		});
	});

	it("disables lifecycle scripts when installing published packages", () => {
		expect(run(["sizes-published", fixtureRoot]).exitCode).toBe(0);
		expect(JSON.parse(readFileSync(installArgs, "utf8"))).toContain("--ignore-scripts");
	});

	it("counts a nested and a hoisted copy of one dependency as separate installed bytes", () => {
		const manifest = (name: string, unpacked: number, dependencies?: Record<string, string>) => ({
			name,
			exports: {},
			"x-unpacked": unpacked,
			...(dependencies ? { dependencies } : {}),
		});
		// package -> b, d@1 (hoisted); b -> d@2 (nested under b). All four are installed.
		const result = run(["sizes-published", fixtureRoot], undefined, {
			"node_modules/@fixture/package/package.json": manifest("@fixture/package", 100, {
				"@fixture/b": "^1.0.0",
				"@fixture/d": "^1.0.0",
			}),
			"node_modules/@fixture/b/package.json": manifest("@fixture/b", 10, {
				"@fixture/d": "^2.0.0",
			}),
			"node_modules/@fixture/b/node_modules/@fixture/d/package.json": manifest("@fixture/d", 2),
			"node_modules/@fixture/d/package.json": manifest("@fixture/d", 1),
		});
		expect(result.stderr.toString()).toBe("");
		expect(JSON.parse(result.stdout.toString())["@fixture/package"].footprint).toBe(113);
	});
});

describe("compare", () => {
	it("reports consumer bundles and runtime footprint next to the old rows", () => {
		// base.json from a ref predating consumers/footprint still compares.
		const base = join(testRoot, "base.json");
		const head = join(testRoot, "head.json");
		writeFileSync(
			base,
			JSON.stringify({ "@x/core": { entries: { ".": 1024 }, tarball: 1, unpacked: 2048 } }),
		);
		writeFileSync(
			head,
			JSON.stringify({
				"@x/core": {
					entries: { ".": 1024 },
					consumers: { cli: 512 },
					tarball: 1,
					unpacked: 2048,
					footprint: 4096,
				},
			}),
		);
		const result = run(["compare", base, head]);
		expect(result.exitCode).toBe(0);
		const table = result.stdout.toString();
		expect(table).toContain("### Consumer bundles (minified + gzip)");
		expect(table).toContain("| `@x/core` cli | — | 0.50 KB | new |");
		expect(table).toContain("| `@x/core` | 0.00 KB | 2.00 KB | ±0 | 4.00 KB | new |");
	});
});
