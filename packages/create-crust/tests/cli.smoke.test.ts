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

interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

let cleanupSmokeRoot = false;

async function run(
	command: string[],
	cwd: string,
	env?: Record<string, string>,
): Promise<CommandResult> {
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

function formatFailure(
	label: string,
	command: string[],
	cwd: string,
	result: CommandResult,
): string {
	return [
		`${label} failed`,
		`command: ${command.join(" ")}`,
		`cwd: ${cwd}`,
		`exit code: ${result.exitCode}`,
		`stdout:\n${result.stdout.trim() || "<empty>"}`,
		`stderr:\n${result.stderr.trim() || "<empty>"}`,
	].join("\n\n");
}

function assertSuccess(
	label: string,
	command: string[],
	cwd: string,
	result: CommandResult,
): void {
	if (result.exitCode !== 0) {
		throw new Error(formatFailure(label, command, cwd, result));
	}
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
			rmSync(smokeRoot, { recursive: true, force: true });
			mkdirSync(smokeRoot, { recursive: true });

			if (!existsSync(builtCliPath)) {
				throw new Error(
					`Built CLI not found at ${builtCliPath}. Run the package build before test:smoke.`,
				);
			}

			const scaffoldCommand = [
				process.execPath,
				builtCliPath,
				sampleDir,
				"--template",
				"minimal",
				"--distribution",
				"binary",
				"--install",
				"--no-git",
			];
			const scaffold = await run(scaffoldCommand, smokeRoot, {
				BUN_BE_BUN: "1",
				npm_config_user_agent: "npm/10.0.0 node/v22.0.0",
			});

			assertSuccess(
				"create-crust scaffold",
				scaffoldCommand,
				smokeRoot,
				scaffold,
			);
			expect(existsSync(join(sampleDir, "package.json"))).toBe(true);
			expect(existsSync(join(sampleDir, "tsconfig.json"))).toBe(true);
			expect(existsSync(join(sampleDir, "src", "cli.ts"))).toBe(true);
			expect(existsSync(join(sampleDir, "README.md"))).toBe(true);
			expect(existsSync(join(sampleDir, "node_modules"))).toBe(true);
			expect(existsSync(join(sampleDir, "package-lock.json"))).toBe(true);

			expect(
				existsSync(
					join(
						sampleDir,
						"node_modules",
						"@crustjs",
						"crust",
						"bin",
						"crust.js",
					),
				),
			).toBe(true);

			const checkTypesCommand = ["npm", "run", "check:types"];
			const checkTypes = await run(checkTypesCommand, sampleDir);
			assertSuccess(
				"generated project type-check",
				checkTypesCommand,
				sampleDir,
				checkTypes,
			);

			// The published @crustjs/crust package currently does not materialize
			// a node_modules/.bin launcher under npm install, so smoke drives the
			// installed CLI entrypoint directly.
			const buildCommand = [
				"node",
				"./node_modules/@crustjs/crust/bin/crust.js",
				"build",
			];
			const build = await run(buildCommand, sampleDir);
			assertSuccess("generated project build", buildCommand, sampleDir, build);

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
