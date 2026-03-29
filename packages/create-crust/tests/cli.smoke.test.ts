import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const builtCliPath = resolve(import.meta.dir, "..", "dist", "index.js");
const smokeRoot = join(
	process.env.RUNNER_TEMP ?? tmpdir(),
	"create-crust-smoke",
);
const sampleDir = join(smokeRoot, "smoke-cli");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmCacheDir = join(smokeRoot, ".npm-cache");

let cleanupSmokeRoot = process.env.CREATE_CRUST_SMOKE !== "1";

async function run(
	command: string[],
	cwd: string,
	env?: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(command, {
		cwd,
		env: {
			...process.env,
			...env,
		},
		stdout: "pipe",
		stderr: "pipe",
	});

	return {
		exitCode: await proc.exited,
		stdout: await new Response(proc.stdout).text(),
		stderr: await new Response(proc.stderr).text(),
	};
}

afterAll(() => {
	if (cleanupSmokeRoot) {
		rmSync(smokeRoot, { recursive: true, force: true });
	}
});

describe.skipIf(process.env.CREATE_CRUST_SMOKE !== "1")(
	"create-crust smoke test",
	() => {
		it("scaffolds, installs, type-checks, and builds a generated project", async () => {
			cleanupSmokeRoot = false;
			rmSync(smokeRoot, { recursive: true, force: true });
			mkdirSync(smokeRoot, { recursive: true });

			if (!existsSync(builtCliPath)) {
				throw new Error(
					`Built CLI not found at ${builtCliPath}. Run the package build before test:smoke.`,
				);
			}

			const scaffold = await run(
				[
					process.execPath,
					builtCliPath,
					sampleDir,
					"--template",
					"minimal",
					"--distribution",
					"binary",
					"--install",
					"--no-git",
				],
				smokeRoot,
				{
					BUN_BE_BUN: "1",
					NPM_CONFIG_CACHE: npmCacheDir,
					npm_config_user_agent: "npm/10.0.0 node/v22.0.0",
				},
			);

			expect(scaffold.exitCode).toBe(0);
			expect(scaffold.stderr).not.toContain("npm error");
			expect(scaffold.stderr).not.toContain("Error:");
			expect(existsSync(join(sampleDir, "package.json"))).toBe(true);
			expect(existsSync(join(sampleDir, "tsconfig.json"))).toBe(true);
			expect(existsSync(join(sampleDir, "src", "cli.ts"))).toBe(true);
			expect(existsSync(join(sampleDir, "README.md"))).toBe(true);
			expect(existsSync(join(sampleDir, "node_modules"))).toBe(true);
			expect(existsSync(join(sampleDir, "package-lock.json"))).toBe(true);

			const checkTypes = await run(
				[npmCommand, "run", "check:types"],
				sampleDir,
			);
			expect(checkTypes.exitCode).toBe(0);

			const build = await run([npmCommand, "run", "build"], sampleDir);
			expect(build.exitCode).toBe(0);

			const binaryName = basename(sampleDir);
			const distEntries = readdirSync(join(sampleDir, "dist"));

			expect(distEntries.length).toBeGreaterThan(0);
			expect(
				distEntries.includes("cli") ||
					distEntries.includes("cli.cmd") ||
					distEntries.some((entry) => entry.startsWith(`${binaryName}-bun-`)),
			).toBe(true);

			cleanupSmokeRoot = true;
		}, 180_000);
	},
);
