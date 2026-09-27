import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { which } from "@crustjs/utils/process";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { execDenoPackageBuild, resolveDenoPackageBundler } from "../src/utils/build-helpers.ts";
import { reapBoundedProcesses, runBoundedProcess } from "./bounded-process.ts";

// ────────────────────────────────────────────────────────────────────────────
// execDenoPackageBuild against a published-style project: @crustjs/core and
// @crustjs/utils are real `pnpm pack` tarballs (workspace ranges rewritten as on
// publish), installed by npm next to an application dependency, with registry
// ranges in package.json and a deno.json import-map alias. Bundling runs with a
// dead npm registry, then the project is deleted before native Deno runs the
// bundles from an unrelated cwd with conflicting build-only env.
// ────────────────────────────────────────────────────────────────────────────

const workspacePackages = resolve(import.meta.dirname, "..", "..");
const deno = which("deno");
const npm = which("npm");
const pnpm = which("pnpm");

const GREET_SOURCE = `#!/usr/bin/env deno
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Crust, resolveArtifactDir } from "@crustjs/core";
import { greet } from "greeting";
const app = new Crust("deno-greet")
	.args({ name: "name", type: "string", required: true })
	.flags({ name: "shout", type: "boolean" })
	.action(async ({ args, flags, stdout }) => {
		await new Promise((done) => setTimeout(done, 5));
		console.error("note from deno-greet");
		const greeting = greet(args.name);
		stdout(JSON.stringify({
			greeting: flags.shout ? greeting.toUpperCase() : greeting,
			deno: typeof Deno === "undefined" ? null : Deno.version.deno,
			asset: readFileSync(join(resolveArtifactDir("assets"), "greeting.txt"), "utf8"),
		}));
	});
if (import.meta.main) await app.execute();
`;

const ADMIN_SOURCE = `import { Crust } from "@crustjs/core";
await new Crust("deno-admin").action(({ stdout }) => {
	stdout("admin");
	process.exitCode = 3;
}).execute();
`;

let root: string;
let elsewhere: string;
let marked: string;
let unmarked: string;
let denoVersion: string;
const snapshotPath = () => join(root, "snapshot.json");
const staleOutDir = () => join(root, "stale-build-output");

async function run(command: string, args: readonly string[], cwd: string, env = process.env) {
	const result = await runBoundedProcess(command, args, { cwd, env, timeout: 120_000 });
	if (result.exitCode !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed (${result.exitCode}):\n${result.stderr}`);
	}
	return result;
}

/** `deno run` of an installed bundle, with build-only env that must not take effect. */
function runInstalled(args: readonly string[]) {
	return runBoundedProcess(deno!, ["run", "--no-prompt", ...args], {
		cwd: elsewhere,
		env: {
			...process.env,
			CRUST_INTERNAL_SNAPSHOT_PATH: snapshotPath(),
			CRUST_INTERNAL_BUILD_OUT_DIR: staleOutDir(),
		},
		timeout: 30_000,
	});
}

/** An installed package layout: `<dir>/bin/<command>.js` beside `<dir>/assets`. */
function installedPackage(name: string): string {
	const dir = join(root, name);
	mkdirSync(join(dir, "assets"), { recursive: true });
	writeFileSync(join(dir, "assets", "greeting.txt"), `from ${name}`);
	return dir;
}

describe.skipIf(deno === null || npm === null || pnpm === null)(
	"Deno runtime package bundle",
	() => {
		beforeAll(async () => {
			// Real path: Deno checks --allow-read grants against resolved paths (macOS tmpdir is a symlink).
			root = realpathSync.native(mkdtempSync(join(tmpdir(), "crust-deno-package-")));
			const packs = join(root, "packs");
			const project = join(root, "project");
			elsewhere = join(root, "elsewhere");
			mkdirSync(packs);
			mkdirSync(join(project, "src"), { recursive: true });
			mkdirSync(elsewhere);

			const versions: Record<string, string> = {};
			for (const name of ["utils", "core"]) {
				const dir = join(workspacePackages, name);
				if (!existsSync(join(dir, "dist"))) {
					throw new Error(`${dir}/dist is missing; build the workspace packages first.`);
				}
				versions[name] = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
				await run(pnpm!, ["pack", "--ignore-scripts", "--pack-destination", packs], dir);
			}
			const dependency = join(root, "fixture-greeting");
			mkdirSync(dependency);
			writeFileSync(
				join(dependency, "package.json"),
				JSON.stringify({
					name: "fixture-greeting",
					version: "1.0.0",
					type: "module",
					exports: "./index.js",
				}),
			);
			writeFileSync(
				join(dependency, "index.js"),
				'if (import.meta.main) throw new Error("dependency must not be main");\n' +
					'export const greet = (name) => "hello " + name;\n',
			);
			await run(npm!, ["pack", dependency, "--pack-destination", packs], root);
			// Relative with forward slashes: npm accepts it on every OS.
			const tarball = (prefix: string) =>
				`file:../packs/${readdirSync(packs).find((file) => file.startsWith(prefix))!}`;

			writeFileSync(join(project, "src", "greet.ts"), GREET_SOURCE);
			writeFileSync(join(project, "src", "admin.ts"), ADMIN_SOURCE);
			writeFileSync(
				join(project, "package.json"),
				JSON.stringify({
					name: "deno-package",
					type: "module",
					dependencies: {
						"@crustjs/core": tarball("crustjs-core-"),
						"@crustjs/utils": tarball("crustjs-utils-"),
						"fixture-greeting": tarball("fixture-greeting-"),
					},
				}),
			);
			await run(
				npm!,
				["install", "--offline", "--no-audit", "--no-fund", "--ignore-scripts"],
				project,
			);
			// As if installed from the registry: Deno checks these ranges against node_modules.
			writeFileSync(
				join(project, "package.json"),
				JSON.stringify({
					name: "deno-package",
					type: "module",
					dependencies: { "@crustjs/core": `^${versions.core}`, "fixture-greeting": "^1.0.0" },
				}),
			);
			writeFileSync(
				join(project, "deno.json"),
				JSON.stringify({ imports: { greeting: "npm:fixture-greeting@^1.0.0" } }),
			);

			// A cold Deno cache downloads the bundler's esbuild from npm once; do that
			// with a dependency-free file so the real bundles can run with no registry.
			const warm = join(root, "warm");
			mkdirSync(warm);
			writeFileSync(join(warm, "main.js"), "console.log(1);\n");
			await run(deno!, ["bundle", "--output", join(warm, "out.js"), join(warm, "main.js")], warm);

			const bundler = await resolveDenoPackageBundler(project);
			denoVersion = bundler.version;
			const offline = {
				command: bundler.runner.command,
				env: { ...bundler.runner.env, NPM_CONFIG_REGISTRY: "http://127.0.0.1:9/" },
			};
			marked = installedPackage("marked");
			for (const command of ["deno-greet", "deno-admin"]) {
				await execDenoPackageBuild(
					join("src", `${command.slice("deno-".length)}.ts`),
					join(marked, "bin", `${command}.js`),
					project,
					offline,
				);
			}
			// The regression: bundling the command entry itself, without the marker.
			unmarked = installedPackage("unmarked");
			await run(
				deno!,
				[
					"bundle",
					"--platform=deno",
					"--output",
					join(unmarked, "bin", "deno-greet.js"),
					"src/greet.ts",
				],
				project,
				offline.env,
			);

			expect(readdirSync(project).filter((name) => name.startsWith(".crust-build-"))).toEqual([]);
			// Installed execution must not reach back into the project or its tarballs.
			rmSync(project, { recursive: true, force: true });
			rmSync(packs, { recursive: true, force: true });
		}, 300_000);

		afterEach(reapBoundedProcesses);

		afterAll(async () => {
			await reapBoundedProcesses();
			if (root) rmSync(root, { recursive: true, force: true });
		});

		it("emits one bundle per command with no launcher, grants, or source paths", () => {
			for (const command of ["deno-greet", "deno-admin"]) {
				const output = readFileSync(join(marked, "bin", `${command}.js`), "utf8");
				expect(output.startsWith("#!")).toBe(false);
				expect(output).not.toContain(root);
				expect(output).not.toContain("--allow");
			}
			expect(readFileSync(join(marked, "bin", "deno-greet.js"), "utf8")).toContain(
				'"hello " + name',
			);
		});

		it("runs with only a read grant on the package, ignoring build-only env", async () => {
			const readPackage = `--allow-read=${marked}`;
			const greet = join(marked, "bin", "deno-greet.js");
			for (const attempt of [1, 2]) {
				const result = await runInstalled([readPackage, greet, "world", "--shout"]);
				expect(result.stderr, `attempt ${attempt}`).toBe("note from deno-greet\n");
				expect(result.exitCode).toBe(0);
				expect(JSON.parse(result.stdout)).toEqual({
					greeting: "HELLO WORLD",
					deno: denoVersion,
					asset: "from marked",
				});
			}

			const invalid = await runInstalled([readPackage, greet, "world", "--bogus"]);
			expect(invalid.exitCode).toBe(1);
			expect(invalid.stderr).toContain('Unknown flag "--bogus"');

			const admin = await runInstalled([join(marked, "bin", "deno-admin.js")]);
			expect(admin.stderr).toBe("");
			expect(admin.stdout).toBe("admin\n");
			expect(admin.exitCode).toBe(3);

			expect(existsSync(snapshotPath())).toBe(false);
			expect(existsSync(staleOutDir())).toBe(false);
		});

		it("leaves permissions to the caller: no grant denies the asset read", async () => {
			const greet = join(marked, "bin", "deno-greet.js");
			const denied = await runInstalled([greet, "world"]);
			expect(denied.exitCode).not.toBe(0);
			expect(denied.stderr).toContain("Requires read access");
			expect(denied.stderr).toContain("greeting.txt");
		});

		it("reproduces the unmarked bundle regression the prepended marker fixes", async () => {
			const greet = join(unmarked, "bin", "deno-greet.js");
			const denied = await runInstalled([`--allow-read=${unmarked}`, greet, "world"]);
			expect(denied.exitCode).not.toBe(0);
			expect(denied.stderr).toContain('Requires env access to "CRUST_INTERNAL_BUILD"');

			const granted = await runInstalled([
				"--allow-env",
				"--allow-read",
				`--allow-write=${root}`,
				greet,
				"world",
			]);
			expect(granted.exitCode).toBe(0);
			expect(granted.stdout).toBe("");
			expect(existsSync(snapshotPath())).toBe(true);
			rmSync(snapshotPath(), { force: true });
		});
	},
);
