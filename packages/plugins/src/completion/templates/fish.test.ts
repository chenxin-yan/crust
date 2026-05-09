import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CompletionSpec } from "../spec.ts";
import { renderFish } from "./fish.ts";

const fixture: CompletionSpec = {
	root: {
		name: "mycli",
		description: "Test CLI",
		flags: [
			{ name: "help", short: "h", type: "boolean", takesValue: false },
			{ name: "version", short: "v", type: "boolean", takesValue: false },
		],
		args: [],
		subCommands: [
			{
				name: "build",
				description: "Build artifact",
				flags: [
					{ name: "release", type: "boolean", takesValue: false },
					{
						name: "target",
						type: "string",
						takesValue: true,
						choices: ["browser", "bun", "node"],
					},
				],
				args: [],
				subCommands: [],
			},
			{
				name: "deploy",
				aliases: ["dep"],
				description: "Deploy",
				flags: [],
				args: [],
				subCommands: [
					{
						name: "prod",
						description: "Production deploy",
						flags: [
							{
								name: "env",
								type: "string",
								takesValue: true,
								choices: ["dev", "staging", "prod"],
							},
						],
						args: [],
						subCommands: [],
					},
				],
			},
		],
	},
};

describe("renderFish", () => {
	it("first line is the header comment with bin + version + regenerate hint", () => {
		const script = renderFish(fixture, "mycli", "1.0.0");
		const firstLine = script.split("\n")[0];
		expect(firstLine).toBe(
			"# completion script for mycli v1.0.0 — regenerate with: mycli completion fish",
		);
	});

	it("disables global file completion before emitting rules", () => {
		const script = renderFish(fixture, "mycli", "1.0.0");
		expect(script).toContain("complete -c mycli -f");
	});

	it("emits subcommand rules gated on __fish_use_subcommand at the top level", () => {
		const script = renderFish(fixture, "mycli", "1.0.0");
		expect(script).toContain(
			"complete -c mycli -n '__fish_use_subcommand' -f -a 'build' -d 'Build artifact'",
		);
		// Aliases of `deploy` get their own rule.
		expect(script).toContain(
			"complete -c mycli -n '__fish_use_subcommand' -f -a 'deploy' -d 'Deploy'",
		);
		expect(script).toContain(
			"complete -c mycli -n '__fish_use_subcommand' -f -a 'dep' -d 'Deploy'",
		);
	});

	it("emits choice flags as `-x -a 'opt1 opt2 opt3'`", () => {
		const script = renderFish(fixture, "mycli", "1.0.0");
		// build --target choices, gated on the build subcommand chain.
		expect(script).toMatch(
			/complete -c mycli -n '__fish_seen_subcommand_from build[^']*' -x -l target -a 'browser bun node'/,
		);
	});

	it("nested subcommand rules use chained `seen_subcommand_from` predicates", () => {
		const script = renderFish(fixture, "mycli", "1.0.0");
		// deploy prod --env should be gated on the chain: seen deploy and seen prod.
		expect(script).toMatch(
			/seen_subcommand_from deploy dep.*seen_subcommand_from prod.*-x -l env -a 'dev staging prod'/,
		);
	});

	it("negates deeper subcommand candidates so flags do not bleed past depth", () => {
		const script = renderFish(fixture, "mycli", "1.0.0");
		// At `mycli deploy <here>` we should NOT show deploy's flags after
		// the user has typed `prod`, so the predicate carries
		// `not __fish_seen_subcommand_from prod`.
		expect(script).toContain("not __fish_seen_subcommand_from prod");
	});

	it("emits boolean flags without -r/-x", () => {
		const script = renderFish(fixture, "mycli", "1.0.0");
		// `--release` is a boolean toggle on `build`. Should not have -r or -x.
		const releaseLine = script
			.split("\n")
			.find((l) => l.includes("-l release"));
		expect(releaseLine).toBeDefined();
		expect(releaseLine).not.toMatch(/-r\b/);
		expect(releaseLine).not.toMatch(/-x\b/);
	});

	it("emits short alias on flags via -s", () => {
		const script = renderFish(fixture, "mycli", "1.0.0");
		const helpLine = script.split("\n").find((l) => l.includes("-l help"));
		expect(helpLine).toBeDefined();
		expect(helpLine).toContain("-s h");
	});

	it("escapes single quotes in descriptions", () => {
		const spec: CompletionSpec = {
			root: {
				name: "x",
				flags: [
					{
						name: "fancy",
						type: "string",
						takesValue: true,
						description: "it's complicated",
					},
				],
				args: [],
				subCommands: [],
			},
		};
		const script = renderFish(spec, "x", "1.0.0");
		expect(script).toContain("it\\'s complicated");
	});
});

const fishAvailable = await isFishAvailable();
const describeIfFish = fishAvailable ? describe : describe.skip;

describeIfFish("renderFish · fish -n parse check", () => {
	let scriptPath: string;
	let tmpDir: string;

	beforeAll(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "tp010-fish-"));
		scriptPath = join(tmpDir, "mycli.fish");
		const script = renderFish(fixture, "mycli", "1.0.0");
		await writeFile(scriptPath, script, "utf8");
	});

	afterAll(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("parses cleanly under `fish -n`", async () => {
		const proc = Bun.spawn(["fish", "-n", scriptPath], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [, err] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const code = await proc.exited;
		expect(err).toBe("");
		expect(code).toBe(0);
	});

	it("sources cleanly under fish and registers complete rules", async () => {
		const driver = `
source ${shQuoteForFish(scriptPath)}
complete -c mycli | head -3
echo SOURCE_OK
`;
		const proc = Bun.spawn(["fish", "-c", driver], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [out, err] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const code = await proc.exited;
		if (code !== 0) {
			throw new Error(`fish failed: ${err}\nstdout:\n${out}`);
		}
		expect(out).toContain("SOURCE_OK");
	});
});

if (!fishAvailable) {
	describe("renderFish · fish behavioural tests", () => {
		it.skip("fish not available on PATH — skipping behavioural tests", () => {});
	});
}

async function isFishAvailable(): Promise<boolean> {
	try {
		const proc = Bun.spawn(["fish", "--version"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		await proc.exited;
		return proc.exitCode === 0;
	} catch {
		return false;
	}
}

function shQuoteForFish(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
