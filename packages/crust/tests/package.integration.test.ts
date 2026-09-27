import { createHash, randomBytes } from "node:crypto";
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
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Crust } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { which } from "@crustjs/utils/process";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { buildCommand } from "../src/commands/build.ts";
import type { DistributionManifest } from "../src/utils/distribute.ts";
import { reapBoundedProcesses, runBoundedProcess } from "./bounded-process.ts";

const tmpDir = mkdtempSync(join(tmpdir(), "crust-package-integration-"));
const stageDir = join(tmpDir, ".crust");
const originalCwd = process.cwd;

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf-8")) as T;
}

async function runBuild(argv: string[]) {
	const app = new Crust("test").add(buildCommand);
	process.cwd = () => tmpDir;
	try {
		const result = await captureExecute(app, ["build", ...argv]);
		expect(result.exitCode, result.stderr).toBe(0);
		return result;
	} finally {
		process.cwd = originalCwd;
	}
}

beforeAll(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	mkdirSync(join(tmpDir, "src"), { recursive: true });
	writeFileSync(join(tmpDir, "src", "cli.ts"), 'console.log("hello from packaged test");\n');
	writeFileSync(
		join(tmpDir, "package.json"),
		JSON.stringify(
			{
				name: "@scope/test-cli",
				version: "0.1.0",
				bin: {
					"test-cli": "src/cli.ts",
				},
				crust: { artifact: "binary" },
			},
			null,
			2,
		),
	);
});

afterEach(reapBoundedProcesses);

afterAll(() => {
	process.cwd = originalCwd;
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("crust build integration", () => {
	it("stages root and platform packages in .crust with a JS launcher", async () => {
		await runBuild(["--target", "bun-linux-x64", "--target", "bun-darwin-arm64", "--no-validate"]);

		expect(existsSync(join(stageDir, "root", "bin", "test-cli.js"))).toBe(true);
		expect(existsSync(join(stageDir, "root", "bin", "test-cli"))).toBe(false);
		expect(existsSync(join(stageDir, "linux-x64", "bin"))).toBe(true);
		expect(existsSync(join(stageDir, "darwin-arm64", "bin"))).toBe(true);

		const rootPackageJson = readJson<{ bin: Record<string, string> }>(
			join(stageDir, "root", "package.json"),
		);
		expect(rootPackageJson.bin["test-cli"]).toBe("bin/test-cli.js");

		const manifest = readJson<{
			version: string;
			publishOrder: string[];
			packages: Array<{ target: string; dir: string }>;
		}>(join(stageDir, "manifest.json"));
		expect(manifest.version).toBe("0.1.0");
		expect(manifest.publishOrder).toEqual(["linux-x64", "darwin-arm64", "root"]);
		expect(manifest.packages.map((pkg) => pkg.target)).toEqual(["linux-x64", "darwin-arm64"]);
	}, 15_000);

	it("wipes .crust and stages only the selected target directories", async () => {
		mkdirSync(join(stageDir, "darwin-arm64"), { recursive: true });
		writeFileSync(join(stageDir, "stale.txt"), "from a previous build\n");
		await runBuild(["--target", "bun-linux-x64", "--no-validate"]);

		expect(existsSync(join(stageDir, "stale.txt"))).toBe(false);
		expect(existsSync(join(stageDir, "root"))).toBe(true);
		expect(existsSync(join(stageDir, "linux-x64"))).toBe(true);
		expect(existsSync(join(stageDir, "darwin-arm64"))).toBe(false);
	});
});

// Public build -> npm pack -> install -> execute for a Bun runtime package: the
// installed commands must run under the consumer's Bun, from an unrelated cwd,
// after the source project is gone.
describe.skipIf(!which("bun") || !which("npm"))("Bun runtime package", () => {
	// Created by the test, not at collection: a -t filter that skips it also skips afterAll.
	const root = join(tmpdir(), `crust-bun-package-${randomBytes(6).toString("hex")}`);
	const project = join(root, "project");
	const coreDist = resolve(import.meta.dirname, "../../core/dist/index.js");
	const extensionsDist = resolve(import.meta.dirname, "../../extensions/dist/index.js");
	// Windows shims: npm writes `<command>.cmd`, Bun writes `<command>.exe`.
	const bin = (dir: string, command: string) => {
		const base = join(dir, "node_modules", ".bin", command);
		if (process.platform !== "win32") return base;
		return existsSync(`${base}.exe`) ? `${base}.exe` : `${base}.cmd`;
	};

	afterAll(async () => {
		await reapBoundedProcesses();
		rmSync(root, { recursive: true, force: true });
	});

	it("installs with npm and bun, runs every command under Bun, and ships assets", async () => {
		mkdirSync(join(project, "src"), { recursive: true });
		mkdirSync(join(project, "assets"), { recursive: true });
		writeFileSync(join(project, "assets", "greeting.txt"), "hello from assets\n");
		// A bare-specifier application dependency that exists only in the source
		// project: the installed command works after the project is deleted only
		// if the bundle inlined it.
		const dependencyDir = join(project, "node_modules", "crust-greeting-dep");
		mkdirSync(dependencyDir, { recursive: true });
		writeFileSync(
			join(dependencyDir, "package.json"),
			JSON.stringify({
				name: "crust-greeting-dep",
				version: "1.0.0",
				type: "module",
				main: "index.js",
			}),
		);
		writeFileSync(join(dependencyDir, "index.js"), 'export const punctuation = "!";\n');
		// Real Crust commands: core and extensions are bundled from their dist by
		// absolute path, an Extension build hook generates man/, and crust.include
		// ships assets/.
		writeFileSync(
			join(project, "src", "greet.ts"),
			`import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Crust, defineExtension, defineExtensionId, resolveArtifactDir } from ${JSON.stringify(coreDist)};
import { help } from ${JSON.stringify(extensionsDist)};
import { punctuation } from "crust-greeting-dep";
const man = defineExtension(defineExtensionId("man")).build(() => [{ path: "man/bun-greet.1", content: ".Dd" }]);
await new Crust("bun-greet", { description: "Greets under Bun" })
	.extend(man, help())
	.args({ name: "name", type: "string", required: true })
	.flags({ name: "shout", type: "boolean" })
	.action(async ({ args, flags, stdout }) => {
		await new Promise((done) => setTimeout(done, 5));
		const greeting = \`hello \${args.name}\${punctuation}\`;
		stdout(JSON.stringify({
			greeting: flags.shout ? greeting.toUpperCase() : greeting,
			bun: process.versions.bun ?? null,
			asset: readFileSync(join(resolveArtifactDir("assets"), "greeting.txt"), "utf8").trim(),
			man: readFileSync(join(resolveArtifactDir("man"), "bun-greet.1"), "utf8"),
		}));
	})
	.execute();
`,
		);
		writeFileSync(
			join(project, "src", "admin.ts"),
			`import { Crust } from ${JSON.stringify(coreDist)};
await new Crust("bun-admin").action(({ stdout }) => {
	stdout("admin under " + (process.versions.bun ? "bun" : "node"));
	process.exitCode = 3;
}).execute();
`,
		);
		writeFileSync(
			join(project, "package.json"),
			JSON.stringify({
				name: "@scope/bun-package",
				version: "0.1.0",
				bin: { "bun-greet": "src/greet.ts", "bun-admin": "src/admin.ts" },
				crust: { include: ["assets"] },
				dependencies: { "crust-greeting-dep": "1.0.0" },
				engines: { bun: ">=1.0.0" },
			}),
		);

		const app = new Crust("test").add(buildCommand);
		process.cwd = () => project;
		try {
			const result = await captureExecute(app, ["build", "--artifact", "package"]);
			expect(result.exitCode, result.stderr).toBe(0);
			expect(result.stdout).toContain("Runtime: bun (default)");
			expect(result.stdout).toContain("Artifact: package");
		} finally {
			process.cwd = originalCwd;
		}
		const staged = join(project, ".crust");
		const manifest = readJson<DistributionManifest>(join(staged, "manifest.json"));
		expect(manifest).toMatchObject({
			runtime: "bun",
			artifact: "package",
			root: { name: "@scope/bun-package", bins: ["bun-greet", "bun-admin"] },
			packages: [],
			publishOrder: ["root"],
		});
		expect(manifest).not.toHaveProperty("embeddedRuntimeVersion");
		const stagedPackageJson = readJson<object>(join(staged, "root", "package.json"));
		expect(stagedPackageJson).toMatchObject({
			bin: { "bun-greet": "bin/bun-greet.js", "bun-admin": "bin/bun-admin.js" },
			files: ["bin", "man", "assets"],
			engines: { bun: ">=1.0.0" },
		});
		expect(stagedPackageJson).not.toHaveProperty("dependencies");
		expect(existsSync(join(staged, "root", "node_modules"))).toBe(false);

		const packDir = join(root, "packs");
		mkdirSync(packDir);
		const npm = which("npm")!;
		const packed = await runBoundedProcess(npm, ["pack", join(staged, "root")], {
			cwd: packDir,
			timeout: 25_000,
		});
		expect(packed.exitCode, packed.stderr).toBe(0);
		// Relative with forward slashes: both npm and Bun accept it on every OS.
		const tarball = `../packs/${packed.stdout.trim().split("\n").at(-1)!}`;

		const npmConsumer = join(root, "npm-consumer");
		const bunConsumer = join(root, "bun-consumer");
		for (const consumer of [npmConsumer, bunConsumer]) {
			mkdirSync(consumer);
			writeFileSync(
				join(consumer, "package.json"),
				JSON.stringify({
					name: "consumer",
					private: true,
					dependencies: { "@scope/bun-package": `file:${tarball}` },
				}),
			);
		}
		const npmInstall = await runBoundedProcess(npm, ["install", "--no-audit", "--no-fund"], {
			cwd: npmConsumer,
			timeout: 60_000,
		});
		expect(npmInstall.exitCode, npmInstall.stderr).toBe(0);
		const bunInstall = await runBoundedProcess(which("bun")!, ["install"], {
			cwd: bunConsumer,
			timeout: 60_000,
		});
		expect(bunInstall.exitCode, bunInstall.stderr).toBe(0);

		// Neither the source project nor its build output is needed any more.
		rmSync(project, { recursive: true, force: true });
		const elsewhere = join(root, "elsewhere");
		mkdirSync(elsewhere);
		const bunVersion = (
			await runBoundedProcess(which("bun")!, ["--version"], { timeout: 10_000 })
		).stdout.trim();

		for (const consumer of [npmConsumer, bunConsumer]) {
			const greet = await runBoundedProcess(bin(consumer, "bun-greet"), ["world", "--shout"], {
				cwd: elsewhere,
				timeout: 25_000,
			});
			expect(greet.exitCode, greet.stderr).toBe(0);
			expect(JSON.parse(greet.stdout.trim())).toEqual({
				greeting: "HELLO WORLD!",
				bun: bunVersion,
				asset: "hello from assets",
				man: ".Dd",
			});

			const help = await runBoundedProcess(bin(consumer, "bun-greet"), ["--help"], {
				cwd: elsewhere,
				timeout: 25_000,
			});
			expect(help.exitCode, help.stderr).toBe(0);
			expect(help.stdout).toContain("Greets under Bun");

			const missing = await runBoundedProcess(bin(consumer, "bun-greet"), [], {
				cwd: elsewhere,
				timeout: 25_000,
			});
			expect(missing.exitCode).toBe(1);
			expect(missing.stderr).toContain('Missing required argument "<name>"');

			const admin = await runBoundedProcess(bin(consumer, "bun-admin"), [], {
				cwd: elsewhere,
				timeout: 25_000,
			});
			expect(admin.exitCode, admin.stderr).toBe(3);
			expect(admin.stdout.trim()).toBe("admin under bun");
		}

		// Build-only protocol variables cannot turn the finished bundle into a snapshot run.
		const snapshotPath = join(root, "snapshot.json");
		const protocol = await runBoundedProcess(bin(npmConsumer, "bun-greet"), ["protocol"], {
			cwd: elsewhere,
			env: {
				...process.env,
				CRUST_INTERNAL_SNAPSHOT_PATH: snapshotPath,
				CRUST_INTERNAL_BUILD_OUT_DIR: join(root, "hooks"),
			},
			timeout: 25_000,
		});
		expect(protocol.exitCode, protocol.stderr).toBe(0);
		expect(JSON.parse(protocol.stdout.trim())).toMatchObject({ greeting: "hello protocol!" });
		expect(existsSync(snapshotPath)).toBe(false);
		expect(existsSync(join(root, "hooks"))).toBe(false);

		// Native Bun package execution resolves the installed bin, still under Bun.
		const bunRun = await runBoundedProcess(which("bun")!, ["run", "bun-greet", "bun"], {
			cwd: bunConsumer,
			timeout: 25_000,
		});
		expect(bunRun.exitCode, bunRun.stderr).toBe(0);
		expect(JSON.parse(bunRun.stdout.trim())).toMatchObject({
			greeting: "hello bun!",
			bun: bunVersion,
		});

		// A runtime package needs the consumer's Bun: without bun on PATH it cannot start.
		if (process.platform !== "win32") {
			const withoutBun = await runBoundedProcess(bin(npmConsumer, "bun-greet"), ["world"], {
				cwd: elsewhere,
				env: { PATH: "/nonexistent" },
				timeout: 25_000,
			});
			expect(withoutBun.exitCode).not.toBe(0);
			expect(withoutBun.stdout).not.toContain("hello");
		}
	}, 120_000);
});

// Public build -> npm pack -> loopback registry -> native `deno run npm:` and
// `deno install -g` for an experimental Deno runtime package. The project uses
// published-style dependencies (packed Crust tarballs installed by npm, registry
// ranges in package.json, a deno.json import map), bundles them with a dead npm
// registry, and is deleted before any consumer run. Consumers choose every
// grant; the registry serves only the staged tarball.
describe.skipIf(!which("deno") || !which("bun") || !which("npm") || !which("pnpm"))(
	"Deno runtime package",
	() => {
		// Created in beforeAll, not at collection: a -t filter that skips it also skips afterAll.
		// Real path: Deno checks --allow-read grants against resolved module and asset paths
		// (macOS tmpdir is a symlink; Windows may report an 8.3 short name).
		const root = join(
			realpathSync.native(tmpdir()),
			`crust-deno-package-${randomBytes(6).toString("hex")}`,
		);
		const project = join(root, "project");
		const packs = join(root, "packs");
		const elsewhere = join(root, "elsewhere");
		const denoDir = join(root, "deno-dir");
		const installRoot = join(root, "install-root");
		const snapshotPath = join(root, "snapshot.json");
		const hooksDir = join(root, "hooks");
		const spec = "npm:@crust-fixture/deno-package@0.1.0";
		let registry: Server | undefined;
		let registryUrl = "";
		let denoVersion = "";

		const run = async (command: string, args: readonly string[], cwd: string) => {
			const result = await runBoundedProcess(command, args, { cwd, timeout: 120_000 });
			expect(result.exitCode, `${command} ${args.join(" ")}\n${result.stderr}`).toBe(0);
			return result;
		};
		/** Consumer env: isolated Deno cache, the loopback registry, and build-only protocol values that must not take effect. */
		const consumerEnv = (): NodeJS.ProcessEnv => {
			const env = Object.fromEntries(
				Object.entries(process.env).filter(([key]) => !/^(npm_config_|deno_dir$)/i.test(key)),
			);
			return {
				...env,
				DENO_DIR: denoDir,
				NPM_CONFIG_REGISTRY: registryUrl,
				NO_COLOR: "1",
				CRUST_INTERNAL_SNAPSHOT_PATH: snapshotPath,
				CRUST_INTERNAL_BUILD_OUT_DIR: hooksDir,
			};
		};
		const deno = (args: readonly string[]) =>
			runBoundedProcess(which("deno")!, args, {
				cwd: elsewhere,
				env: consumerEnv(),
				timeout: 60_000,
			});
		const installed = (command: string, args: readonly string[]) =>
			runBoundedProcess(
				join(installRoot, "bin", process.platform === "win32" ? `${command}.cmd` : command),
				args,
				{ cwd: elsewhere, env: consumerEnv(), timeout: 60_000 },
			);
		const stopRegistry = async () => {
			if (!registry) return;
			const server = registry;
			registry = undefined;
			server.closeAllConnections();
			await new Promise((done) => server.close(done));
		};

		beforeAll(async () => {
			for (const dir of [packs, join(project, "src"), join(project, "assets"), elsewhere]) {
				mkdirSync(dir, { recursive: true });
			}
			const versions: Record<string, string> = {};
			for (const name of ["utils", "core", "style", "store", "extensions"]) {
				const dir = resolve(import.meta.dirname, "..", "..", name);
				if (!existsSync(join(dir, "dist"))) throw new Error(`Build ${dir} first.`);
				versions[name] = readJson<{ version: string }>(join(dir, "package.json")).version;
				// pnpm rewrites workspace ranges as on publish.
				await run(which("pnpm")!, ["pack", "--ignore-scripts", "--pack-destination", packs], dir);
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
			await run(which("npm")!, ["pack", dependency, "--pack-destination", packs], root);
			// Relative with forward slashes: npm accepts it on every OS.
			const tarball = (prefix: string) =>
				`file:../packs/${readdirSync(packs).find((file) => file.startsWith(prefix))!}`;
			writeFileSync(
				join(project, "package.json"),
				JSON.stringify({
					name: "install-only",
					dependencies: {
						...Object.fromEntries(
							Object.keys(versions).map((name) => [
								`@crustjs/${name}`,
								tarball(`crustjs-${name}-`),
							]),
						),
						"fixture-greeting": tarball("fixture-greeting-"),
					},
				}),
			);
			// --legacy-peer-deps: extensions' typescript peer is not needed and not offline.
			await run(
				which("npm")!,
				[
					"install",
					"--offline",
					"--no-audit",
					"--no-fund",
					"--ignore-scripts",
					"--legacy-peer-deps",
				],
				project,
			);
			// As if installed from the registry: Deno checks these ranges against node_modules.
			writeFileSync(
				join(project, "package.json"),
				JSON.stringify({
					name: "@crust-fixture/deno-package",
					version: "0.1.0",
					type: "module",
					bin: { "deno-greet": "src/greet.ts", "deno-admin": "src/admin.ts" },
					crust: { artifact: "package", include: ["assets"] },
					engines: { deno: ">=2.5.0" },
					dependencies: {
						"@crustjs/core": `^${versions.core}`,
						"@crustjs/extensions": `^${versions.extensions}`,
						"fixture-greeting": "^1.0.0",
					},
				}),
			);
			// Deno resolves the application dependency through the import map; the
			// Bun-run Command Snapshot resolves the same name from node_modules.
			writeFileSync(
				join(project, "deno.json"),
				JSON.stringify({ imports: { "fixture-greeting": "npm:fixture-greeting@^1.0.0" } }),
			);
			writeFileSync(join(project, "assets", "greeting.txt"), "hello from assets\n");
			writeFileSync(
				join(project, "src", "greet.ts"),
				`#!/usr/bin/env deno
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Crust, defineExtension, defineExtensionId, resolveArtifactDir } from "@crustjs/core";
import { help } from "@crustjs/extensions";
import { greet } from "fixture-greeting";
const man = defineExtension(defineExtensionId("man")).build(() => [{ path: "man/deno-greet.1", content: ".Dd" }]);
const app = new Crust("deno-greet", { description: "Greets under Deno" })
	.extend(man, help())
	.args({ name: "name", type: "string", required: true })
	.flags({ name: "shout", type: "boolean" })
	.action(async ({ args, flags, stdout, stderr }) => {
		await new Promise((done) => setTimeout(done, 5));
		stderr("note from deno-greet");
		const greeting = greet(args.name);
		stdout(JSON.stringify({
			greeting: flags.shout ? greeting.toUpperCase() : greeting,
			deno: typeof Deno === "undefined" ? null : Deno.version.deno,
			asset: readFileSync(join(resolveArtifactDir("assets"), "greeting.txt"), "utf8").trim(),
			man: readFileSync(join(resolveArtifactDir("man"), "deno-greet.1"), "utf8"),
		}));
	});
if (import.meta.main) await app.execute();
`,
			);
			writeFileSync(
				join(project, "src", "admin.ts"),
				`import { Crust } from "@crustjs/core";
await new Crust("deno-admin").action(({ stdout }) => {
	stdout("admin under " + (typeof Deno === "undefined" ? "not deno" : "deno"));
	process.exitCode = 3;
}).execute();
`,
			);

			denoVersion = /^deno (\S+)/.exec(
				(await run(which("deno")!, ["--version"], root)).stdout,
			)![1]!;
			// A cold Deno cache downloads the bundler's esbuild from npm once; do that
			// with a dependency-free file so the real build can run with no registry.
			const warm = join(root, "warm");
			mkdirSync(warm);
			writeFileSync(join(warm, "main.js"), "console.log(1);\n");
			await run(which("deno")!, ["bundle", "--output", join(warm, "out.js"), "main.js"], warm);
			const app = new Crust("test").add(buildCommand);
			const registryEnv = process.env.NPM_CONFIG_REGISTRY;
			process.cwd = () => project;
			// Dead registry: the installed node_modules must satisfy every bundled import.
			process.env.NPM_CONFIG_REGISTRY = "http://127.0.0.1:9/";
			let result: Awaited<ReturnType<typeof captureExecute>>;
			try {
				result = await captureExecute(app, ["build"]);
			} finally {
				process.cwd = originalCwd;
				if (registryEnv === undefined) delete process.env.NPM_CONFIG_REGISTRY;
				else process.env.NPM_CONFIG_REGISTRY = registryEnv;
			}
			expect(result.exitCode, result.stderr).toBe(0);
			expect(result.stdout).toContain("Runtime: deno (inferred from deno.json)");
			expect(result.stdout).toContain("Artifact: package");
			// The reported version, without build metadata (canary builds print `2.7.0+fb4db33`).
			expect(result.stdout).toContain(`Compiler: deno ${denoVersion.replace(/\+.*$/, "")} (`);
			expect(result.stderr).toContain("Deno runtime packages are experimental");

			const staged = join(project, ".crust");
			const manifest = readJson<DistributionManifest>(join(staged, "manifest.json"));
			expect(manifest).toMatchObject({
				runtime: "deno",
				artifact: "package",
				root: { name: "@crust-fixture/deno-package", bins: ["deno-greet", "deno-admin"] },
				packages: [],
				publishOrder: ["root"],
				build: { "deno-greet": { extensions: [{ id: "man", files: ["man/deno-greet.1"] }] } },
			});
			// A runtime package embeds no Deno, so the bundler's version is not recorded as one.
			expect(manifest).not.toHaveProperty("embeddedRuntimeVersion");
			const stagedPackageJson = readJson<object>(join(staged, "root", "package.json"));
			expect(stagedPackageJson).toMatchObject({
				bin: { "deno-greet": "bin/deno-greet.js", "deno-admin": "bin/deno-admin.js" },
				files: ["bin", "man", "assets"],
				engines: { deno: ">=2.5.0" },
			});
			expect(stagedPackageJson).not.toHaveProperty("dependencies");
			expect(stagedPackageJson).not.toHaveProperty("optionalDependencies");
			for (const command of ["deno-greet", "deno-admin"]) {
				// Plain JavaScript for the consumer's deno: the source shebang is stripped, no launcher or grants.
				const bundle = readFileSync(join(staged, "root", "bin", `${command}.js`), "utf8");
				expect(bundle).not.toMatch(/^#!/m);
				expect(bundle).not.toContain("--allow");
				expect(bundle).not.toContain(project);
			}

			const packed = await run(which("npm")!, ["pack", join(staged, "root")], packs);
			const data = readFileSync(join(packs, packed.stdout.trim().split("\n").at(-1)!));
			registry = createServer((request, response) => {
				if (request.url === "/tarball.tgz") return response.end(data);
				if (decodeURIComponent(request.url ?? "") !== "/@crust-fixture/deno-package") {
					response.statusCode = 404;
					return response.end("{}");
				}
				response.setHeader("content-type", "application/json");
				response.end(
					JSON.stringify({
						name: "@crust-fixture/deno-package",
						"dist-tags": { latest: "0.1.0" },
						versions: {
							"0.1.0": {
								...stagedPackageJson,
								dist: {
									tarball: `${registryUrl}tarball.tgz`,
									shasum: createHash("sha1").update(data).digest("hex"),
									integrity: `sha512-${createHash("sha512").update(data).digest("base64")}`,
								},
							},
						},
					}),
				);
			});
			await new Promise<void>((listening) => registry!.listen(0, "127.0.0.1", listening));
			// SAFETY: a TCP server listening on a host and port reports an AddressInfo.
			const { port } = registry.address() as AddressInfo;
			registryUrl = `http://127.0.0.1:${port}/`;

			// Consumers need neither the source project nor its build output.
			rmSync(project, { recursive: true, force: true });
			rmSync(packs, { recursive: true, force: true });
		}, 300_000);

		afterEach(reapBoundedProcesses);

		afterAll(async () => {
			await reapBoundedProcesses();
			await stopRegistry();
			rmSync(root, { recursive: true, force: true });
		});

		it("runs each declared bin through deno run npm: with caller-selected grants", async () => {
			const readCache = `--allow-read=${denoDir}`;
			const first = await deno([
				"run",
				"--no-prompt",
				readCache,
				`${spec}/deno-greet`,
				"world",
				"--shout",
			]);
			expect(first.exitCode, first.stderr).toBe(0);
			expect(JSON.parse(first.stdout)).toEqual({
				greeting: "HELLO WORLD",
				deno: denoVersion,
				asset: "hello from assets",
				man: ".Dd",
			});
			// Cached now: the application's own stderr is all that is left.
			const cached = await deno(["run", "--no-prompt", readCache, `${spec}/deno-greet`, "deno"]);
			expect(cached.stderr).toBe("note from deno-greet\n");
			expect(JSON.parse(cached.stdout)).toMatchObject({ greeting: "hello deno" });

			const admin = await deno(["run", "--no-prompt", `${spec}/deno-admin`]);
			expect(admin.stderr).toBe("");
			expect(admin.stdout).toBe("admin under deno\n");
			expect(admin.exitCode).toBe(3);

			const invalid = await deno(["run", "--no-prompt", `${spec}/deno-greet`, "world", "--bogus"]);
			expect(invalid.exitCode).toBe(1);
			expect(invalid.stderr).toContain('Unknown flag "--bogus"');
			const missing = await deno(["run", "--no-prompt", `${spec}/deno-greet`]);
			expect(missing.exitCode).toBe(1);
			expect(missing.stderr).toContain('Missing required argument "<name>"');

			// Grants are application-specific: this help() reads terminal color settings.
			const colorEnv = "--allow-env=NO_COLOR,FORCE_COLOR,COLORTERM,TERM";
			const help = await deno(["run", "--no-prompt", colorEnv, `${spec}/deno-greet`, "--help"]);
			expect(help.exitCode, help.stderr).toBe(0);
			expect(help.stdout).toContain("Greets under Deno");

			// No read grant: the packaged asset read is denied, never silently allowed.
			const denied = await deno(["run", "--no-prompt", `${spec}/deno-greet`, "world"]);
			expect(denied.exitCode).not.toBe(0);
			expect(denied.stderr).toContain("Requires read access");
			expect(denied.stderr).toContain("greeting.txt");

			expect(existsSync(snapshotPath)).toBe(false);
			expect(existsSync(hooksDir)).toBe(false);
		}, 120_000);

		it("installs natively with the requested grants and runs offline from the cache", async () => {
			const install = async (name: string, bin: string, grants: readonly string[]) => {
				const result = await deno([
					"install",
					"--global",
					"--root",
					installRoot,
					...grants,
					"--name",
					name,
					`${spec}/${bin}`,
				]);
				expect(result.exitCode, result.stderr).toBe(0);
			};
			// Deno 2.9 runs globally installed npm bins from the install root, 2.5 from its cache.
			await install("deno-greet", "deno-greet", [`--allow-read=${installRoot},${denoDir}`]);
			await install("deno-greet-ungranted", "deno-greet", []);
			await install("deno-admin", "deno-admin", []);
			await stopRegistry();

			const greet = await installed("deno-greet", ["world", "--shout"]);
			expect(greet.exitCode, greet.stderr).toBe(0);
			expect(greet.stderr).toBe("note from deno-greet\n");
			expect(JSON.parse(greet.stdout)).toEqual({
				greeting: "HELLO WORLD",
				deno: denoVersion,
				asset: "hello from assets",
				man: ".Dd",
			});
			const ungranted = await installed("deno-greet-ungranted", ["world"]);
			expect(ungranted.exitCode).not.toBe(0);
			expect(ungranted.stderr).toContain("Requires read access");
			const admin = await installed("deno-admin", []);
			expect(admin.exitCode, admin.stderr).toBe(3);
			expect(admin.stdout).toBe("admin under deno\n");

			const offline = await deno([
				"run",
				"--cached-only",
				"--no-prompt",
				`--allow-read=${denoDir}`,
				`${spec}/deno-greet`,
				"offline",
			]);
			expect(offline.exitCode, offline.stderr).toBe(0);
			expect(JSON.parse(offline.stdout)).toMatchObject({ greeting: "hello offline" });
			expect(existsSync(snapshotPath)).toBe(false);
			expect(existsSync(hooksDir)).toBe(false);
		}, 120_000);
	},
);
