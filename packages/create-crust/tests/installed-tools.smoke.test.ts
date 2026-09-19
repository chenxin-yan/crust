import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import {
	appendFileSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hostTarget } from "../../crust/tests/helpers.ts";

const repoRoot = realpathSync(resolve(import.meta.dir, "../../.."));
const enabled = process.env.CREATE_CRUST_INSTALLED_SMOKE === "1";
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

function isInside(parent: string, path: string): boolean {
	const rel = relative(parent, path);
	return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

describe.skipIf(!enabled)("installed create-crust and crust (Linux/npm)", () => {
	it("packs, installs, scaffolds, builds through the root shim, and runs", async () => {
		if (process.platform !== "linux") throw new Error("This opt-in smoke requires Linux.");
		const target = hostTarget()?.replace(/^bun-/, "");
		if (!target) throw new Error("Unsupported host for installed-tool smoke.");
		for (const tool of ["node", "npm", "bun", "git"]) {
			if (!Bun.which(tool)) throw new Error(`${tool} is required on PATH.`);
		}
		const base = realpathSync(process.env.RUNNER_TEMP ?? tmpdir());
		if (isInside(repoRoot, base)) throw new Error("Fixture base must be outside the workspace.");
		const root = mkdtempSync(join(base, "create-crust-installed-"));
		const consumer = join(root, "tool consumer");
		const project = join(consumer, "installed-cli");
		const packs = join(root, "packs");
		const diagnostics = join(root, "diagnostics");
		for (const dir of [consumer, packs, diagnostics, join(root, "home"), join(root, "tmp")]) {
			mkdirSync(dir, { recursive: true });
		}
		const env = { ...process.env };
		for (const key of Object.keys(env)) {
			if (/^(NODE_|BUN_|CRUST_INTERNAL_|npm_config_)/i.test(key)) delete env[key];
		}
		Object.assign(env, {
			PATH: (process.env.PATH ?? "")
				.split(delimiter)
				.filter(
					(path) =>
						path &&
						!path.endsWith(`${sep}node_modules${sep}.bin`) &&
						!isInside(repoRoot, resolve(path)),
				)
				.join(delimiter),
			HOME: join(root, "home"),
			XDG_CONFIG_HOME: join(root, "home", "config"),
			XDG_CACHE_HOME: join(root, "home", "cache"),
			XDG_DATA_HOME: join(root, "home", "data"),
			XDG_STATE_HOME: join(root, "home", "state"),
			TMPDIR: join(root, "tmp"),
			npm_config_cache: join(root, "npm cache"),
			npm_config_prefix: join(root, "npm prefix"),
			npm_config_userconfig: join(root, "npmrc"),
			npm_config_globalconfig: join(root, "global-npmrc"),
			NO_COLOR: "1",
		});
		// Leave headroom before bun:test's deadline to reap children and preserve diagnostics.
		const deadline = Date.now() + 240_000;
		async function run(command: string[], cwd: string, expectedExit = 0, timeout = 30_000) {
			const started = Date.now();
			const label = `command: ${JSON.stringify(command)}\ncwd: ${cwd}`;
			appendFileSync(join(diagnostics, "commands.log"), `${label}\n`);
			const child = spawn(command[0]!, command.slice(1), {
				cwd,
				env,
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdout = "";
			let stderr = "";
			let timedOut = false;
			child.stdout.on("data", (chunk) => {
				stdout += chunk;
			});
			child.stderr.on("data", (chunk) => {
				stderr += chunk;
			});
			const killGroup = () => {
				if (child.pid) {
					try {
						process.kill(-child.pid, "SIGKILL");
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
					}
				}
			};
			const timer = setTimeout(
				() => {
					timedOut = true;
					killGroup();
				},
				Math.max(1, Math.min(timeout, deadline - Date.now())),
			);
			try {
				const exit = await new Promise<number | null>((resolveExit, reject) => {
					child.on("error", reject);
					child.on("close", resolveExit);
				});
				const output = `exit: ${exit}; timeout: ${timedOut}; duration: ${Date.now() - started}ms\nstdout:\n${stdout}\nstderr:\n${stderr}\n`;
				appendFileSync(join(diagnostics, "commands.log"), `${output}\n`);
				if (timedOut || exit !== expectedExit) throw new Error(`${label}\n${output}`);
				return { stdout, stderr };
			} finally {
				clearTimeout(timer);
				killGroup();
			}
		}

		let passed = false;
		try {
			for (const tool of ["node", "npm", "bun"]) await run([tool, "--version"], consumer);
			const stage = join(repoRoot, "packages/crust/.crust");
			const manifest = readJson(join(stage, "manifest.json"));
			const stagedRoot = readJson(join(stage, "root/package.json"));
			// Host-only staging hides npm's handling of incompatible optional packages and their bins.
			if (!manifest.packages.some((pkg: { os: string }) => pkg.os !== process.platform)) {
				throw new Error("Build crust with all targets first; host-only staging is insufficient.");
			}
			expect(stagedRoot.optionalDependencies).toEqual(
				Object.fromEntries(
					manifest.packages.map((pkg: { name: string }) => [pkg.name, stagedRoot.version]),
				),
			);
			const host = manifest.packages.find((pkg: { target: string }) => pkg.target === target);
			if (!host) throw new Error(`Build crust for ${target} before running this test.`);
			const specs: Record<string, string> = {};
			const versions: Record<string, string> = {};
			// Read-only input: pack staged tools, never workspace source manifests.
			for (const dir of [
				join(repoRoot, "packages/create-crust/.crust/root"),
				join(stage, "root"),
				join(stage, host.dir),
			]) {
				const pkg = readJson(join(dir, "package.json"));
				const result = await run(
					["npm", "pack", dir, "--ignore-scripts", "--json", "--pack-destination", packs],
					consumer,
					0,
					60_000,
				);
				const [packed] = JSON.parse(result.stdout);
				specs[pkg.name] = pathToFileURL(join(packs, packed.filename)).href;
				versions[pkg.name] = pkg.version;
			}
			for (const name of ["core", "extensions", "style", "store"]) {
				const dir = join(repoRoot, "packages", name);
				if (!existsSync(join(dir, "dist/index.js"))) throw new Error(`Build ${name} first.`);
				const pkg = readJson(join(dir, "package.json"));
				// Bun rewrites workspace ranges; disabling lifecycle scripts avoids source-tree writes.
				const result = await run(
					["bun", "pm", "pack", "--ignore-scripts", "--quiet", "--destination", packs],
					dir,
					0,
					60_000,
				);
				specs[pkg.name] = pathToFileURL(resolve(dir, result.stdout.trim())).href;
				versions[pkg.name] = pkg.version;
			}
			async function install(dir: string) {
				await run(
					["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"],
					dir,
					0,
					120_000,
				);
			}
			function assertInstalled(dir: string, names: string[]) {
				const modules = realpathSync(join(dir, "node_modules"));
				const lock = readJson(join(dir, "package-lock.json"));
				for (const name of names) {
					const installed = realpathSync(join(modules, name));
					expect(isInside(modules, installed)).toBe(true);
					const pkg = readJson(join(installed, "package.json"));
					expect(pkg.name).toBe(name);
					expect(pkg.version).toBe(versions[name]);
					const resolved = lock.packages[`node_modules/${name}`].resolved;
					expect(resolved.startsWith("file:")).toBe(true);
					expect(realpathSync(resolve(dir, resolved.slice(5)))).toBe(
						realpathSync(fileURLToPath(specs[name]!)),
					);
				}
			}
			function shim(dir: string, name: string, pkg: string) {
				const path = join(dir, "node_modules/.bin", name);
				expect(realpathSync(path)).toBe(
					realpathSync(join(dir, "node_modules", pkg, "bin", `${name}.js`)),
				);
				return path;
			}
			writeFileSync(
				join(consumer, "package.json"),
				JSON.stringify({
					name: "tool-consumer",
					private: true,
					dependencies: { "create-crust": specs["create-crust"] },
				}),
			);
			await install(consumer);
			assertInstalled(consumer, ["create-crust"]);
			const create = shim(consumer, "create-crust", "create-crust");
			const scaffoldArgs = ["--runtime", "bun", "--no-install", "--no-git"];
			const templates = join(consumer, "node_modules/create-crust/templates");
			// Fixture-only red/green probe: source/staging templates must not rescue the installed bundle.
			renameSync(templates, `${templates}.hidden`);
			try {
				const red = await run(
					[create, join(consumer, "missing-templates"), ...scaffoldArgs],
					consumer,
					1,
				);
				expect(red.stderr).toContain("templates");
			} finally {
				renameSync(`${templates}.hidden`, templates);
			}
			const scaffold = await run([create, project, ...scaffoldArgs], consumer);
			expect(scaffold.stdout).toContain("Created installed-cli!");
			const pkg = readJson(join(project, "package.json"));
			expect(pkg.crust.runtime).toBe("bun");
			expect(pkg.bin).toEqual({ "installed-cli": "src/cli.ts" });
			expect(pkg.scripts.build).toBe("crust build");
			for (const name of ["core", "extensions"]) {
				expect(pkg.dependencies[`@crustjs/${name}`]).toBe(`^${versions[`@crustjs/${name}`]}`);
			}
			expect(pkg.devDependencies["@crustjs/crust"]).toBe(`^${versions["@crustjs/crust"]}`);
			for (const name of ["core", "extensions"])
				pkg.dependencies[`@crustjs/${name}`] = specs[`@crustjs/${name}`];
			for (const name of ["crust", "style", "store"])
				pkg.devDependencies[`@crustjs/${name}`] = specs[`@crustjs/${name}`];
			// Explicit unpublished host provision, not a test of registry optional-dependency selection.
			// Keep it optional/transitive so a direct platform bin cannot shadow the root shim.
			pkg.overrides = { [host.name]: specs[host.name] };
			writeFileSync(join(project, "package.json"), `${JSON.stringify(pkg, null, "\t")}\n`);
			await install(project);
			assertInstalled(project, [
				"@crustjs/core",
				"@crustjs/extensions",
				"@crustjs/style",
				"@crustjs/store",
				"@crustjs/crust",
				host.name,
			]);
			expect(existsSync(join(project, "node_modules/@crustjs/utils"))).toBe(false);
			expect(existsSync(join(project, "node_modules/@crustjs/crust/schema/package.json"))).toBe(
				true,
			);
			const crust = shim(project, "crust", "@crustjs/crust");
			const binary = join(project, "node_modules", host.name, host.bins.crust);
			await run([crust, "--help"], project);
			renameSync(binary, `${binary}.hidden`);
			try {
				const red = await run([crust, "--help"], project, 1);
				expect(red.stderr).toContain("Missing platform package");
			} finally {
				renameSync(`${binary}.hidden`, binary);
			}
			await run([crust, "--help"], project);
			expect(existsSync(join(project, ".crust"))).toBe(false);
			await run([crust, "build", "--target", "host"], project, 0, 120_000);
			const built = readJson(join(project, ".crust/manifest.json"));
			expect(built.root.bins).toEqual(["installed-cli"]);
			expect(built.packages).toHaveLength(1);
			expect(built.packages[0].target).toBe(target);
			expect(built.build["installed-cli"]).toBeDefined();
			expect(
				existsSync(
					join(project, ".crust", built.packages[0].dir, built.packages[0].bins["installed-cli"]),
				),
			).toBe(true);
			const launcher = join(project, ".crust/root/bin/installed-cli.js");
			for (const [args, output] of [
				[[], "Hello, world!"],
				[["Ada", "--greet", "Ahoy"], "Ahoy, Ada!"],
			] as const) {
				const result = await run([launcher, ...args], project);
				expect(result.stdout.trim()).toBe(output);
				expect(result.stderr).toBe("");
			}
			const help = await run([launcher, "--help"], project);
			expect(help.stdout).toContain("installed-cli");
			const invalid = await run([launcher, "--not-a-real-flag"], project, 1);
			expect(invalid.stderr).toContain("--not-a-real-flag");
			passed = true;
		} finally {
			if (passed) rmSync(root, { recursive: true, force: true });
			else {
				for (const [label, dir] of [
					["consumer", consumer],
					["project", project],
				] as const) {
					for (const file of ["package.json", "package-lock.json", ".crust/manifest.json"]) {
						if (existsSync(join(dir, file)))
							copyFileSync(
								join(dir, file),
								join(diagnostics, `${label}-${file.replaceAll("/", "-")}`),
							);
					}
				}
				console.error(`Installed-tool smoke failed; fixture and command logs retained at ${root}`);
			}
		}
	}, 300_000);
});
