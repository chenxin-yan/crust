import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { which } from "@crustjs/utils/process";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import {
	reapBoundedProcesses,
	runBoundedProcess,
} from "../../../../crust/tests/bounded-process.ts";
import type { CompletionCommand } from "../spec.ts";
import { renderFish } from "./fish.ts";

const fixture: CompletionCommand = {
	name: "mycli",
	description: "Test CLI",
	flags: [
		{ name: "help", short: "h", type: "boolean", takesValue: false, negatable: false },
		{ name: "version", short: "v", type: "boolean", takesValue: false, negatable: false },
	],
	args: [],
	subCommands: [
		{
			name: "build",
			description: "Build artifact",
			flags: [
				{
					name: "release",
					short: "r",
					aliases: ["optimized"],
					type: "boolean",
					takesValue: false,
					negatable: true,
				},
				{
					name: "target",
					aliases: ["platform"],
					type: "string",
					takesValue: true,
					negatable: false,
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
							negatable: false,
							choices: ["dev", "staging", "prod"],
						},
					],
					args: [],
					subCommands: [],
				},
			],
		},
	],
};

afterEach(reapBoundedProcesses);

describe("renderFish", () => {
	it("disables global file completion before emitting rules", () => {
		const script = renderFish(fixture, "mycli", "1.0.0");
		// Sole guard that url/json/non-path values don't fall back to
		// filename completion. Bin name is single-quoted as defence-in-depth.
		expect(script).toContain("complete -c 'mycli' -f");
	});

	it("emits subcommand rules gated on __<ident>_path_at_arg at the top level", () => {
		const script = renderFish(fixture, "mycli", "1.0.0");
		// Top-level rules use the variadic zero offset before the root's
		// child spellings, matching the path at any non-child positional.
		expect(script).toContain("-n '__mycli_path_at_arg \\'*0\\' \\'build deploy dep\\''");
		// Build / deploy / deploy-alias rules each carry their own `-a`.
		expect(script).toMatch(/-f -a 'build' -d 'Build artifact'/);
		expect(script).toMatch(/-f -a 'deploy' -d 'Deploy'/);
		expect(script).toMatch(/-f -a 'dep' -d 'Deploy'/);
	});

	it("emits choice flags as one rule per candidate", () => {
		const script = renderFish(fixture, "mycli", "1.0.0");
		// We deliberately emit one `complete` rule per candidate — fish
		// accumulates them — so we never need to embed a multi-value
		// list inside a single shell-token (which would force
		// triple-nested fish quoting).
		expect(script).toMatch(/-x -l 'target' -a 'browser'/);
		expect(script).toMatch(/-x -l 'target' -a 'bun'/);
		expect(script).toMatch(/-x -l 'target' -a 'node'/);
		expect(script).toMatch(/-x -l 'platform' -a 'browser'/);
		expect(script).toMatch(/-x -l 'platform' -a 'bun'/);
		expect(script).toMatch(/-x -l 'platform' -a 'node'/);
	});

	it("gates prod-level flag rules on the full deploy-to-prod path", () => {
		const script = renderFish(fixture, "mycli", "1.0.0");
		expect(script).toContain(
			"-n '__mycli_path_at_arg \\'deploy dep\\' \\'prod\\' \\'*0\\' \\'\\''",
		);
	});

	it("negates deeper subcommand candidates via the helper's leaf-block list", () => {
		const script = renderFish(fixture, "mycli", "1.0.0");
		// At depth `[deploy]` the leaf-block list is `prod` (its only
		// child); the helper rejects when `prod` has already appeared.
		expect(script).toContain("-n '__mycli_path_at_arg \\'deploy dep\\' \\'*0\\' \\'prod\\''");
	});

	it("emits boolean flags without -r/-x", () => {
		const script = renderFish(fixture, "mycli", "1.0.0");
		const rules = script
			.split("\n")
			.filter((line) => /-l '(?:no-)?(?:release|optimized)'/.test(line));
		expect(rules.map((line) => line.match(/-l '([^']+)'/)?.[1])).toEqual([
			"release",
			"optimized",
			"no-release",
			"no-optimized",
		]);
		for (const [index, line] of rules.entries()) {
			expect(line).not.toMatch(/ -(?:r|x)\b/);
			if (index === 0) expect(line).toContain("-s 'r'");
			else expect(line).not.toContain("-s ");
		}
	});

	it("emits short alias on flags via -s", () => {
		const script = renderFish(fixture, "mycli", "1.0.0");
		const helpLine = script.split("\n").find((l) => l.includes("-l 'help'"));
		expect(helpLine).toBeDefined();
		expect(helpLine).toContain("-s 'h'");
	});

	it("emits per-slot positional choice rules gated on `__<ident>_path_at_arg`", () => {
		// Each fixed-slot positional choice should produce one rule per
		// candidate value, conditioned on the new per-arg-index helper.
		// Variadic-with-choices positionals use the `*<N>` spec.
		const spec: CompletionCommand = {
			name: "mp",
			flags: [],
			args: [],
			subCommands: [
				{
					name: "two",
					flags: [],
					args: [
						{
							name: "first",
							type: "string",
							required: true,
							variadic: false,
							choices: ["alpha", "beta"],
						},
						{
							name: "second",
							type: "string",
							required: true,
							variadic: false,
							choices: ["gamma", "delta"],
						},
					],
					subCommands: [],
				},
				{
					name: "vary",
					flags: [],
					args: [
						{
							name: "items",
							type: "string",
							required: false,
							variadic: true,
							choices: ["a", "b"],
						},
					],
					subCommands: [],
				},
			],
		};
		const script = renderFish(spec, "mp", "1.0.0");

		// The per-arg-index helper is emitted exactly once.
		expect(script).toContain("function __mp_path_at_arg");

		// Slot 0 of `two` -> exact spec `0`; one rule per choice value.
		expect(script).toContain("-n '__mp_path_at_arg \\'two\\' \\'0\\' \\'\\''");
		expect(
			script.split("\n").filter((l) => l.includes("__mp_path_at_arg \\'two\\' \\'0\\'")).length,
		).toBe(2); // one rule per choice value

		// Slot 1 of `two` -> exact spec `1`.
		expect(
			script.split("\n").filter((l) => l.includes("__mp_path_at_arg \\'two\\' \\'1\\'")).length,
		).toBe(2);

		// `vary`'s variadic arg lives at index 0 and is declared variadic
		// -> spec is `*0` (matches every slot >= 0).
		expect(
			script.split("\n").filter((l) => l.includes("__mp_path_at_arg \\'vary\\' \\'*0\\'")).length,
		).toBe(2);
	});

	it("escapes single quotes in descriptions", () => {
		const spec: CompletionCommand = {
			name: "x",
			flags: [
				{
					name: "fancy",
					type: "string",
					takesValue: true,
					negatable: false,
					description: "it's complicated",
				},
			],
			args: [],
			subCommands: [],
		};
		const script = renderFish(spec, "x", "1.0.0");
		// Description goes through `fishSingleQuote`, which produces
		// `'it\'s complicated'` — fish single-quote with `\'` for the
		// embedded apostrophe.
		expect(script).toContain("-d 'it\\'s complicated'");
	});
});

const fishAvailable = await isFishAvailable();
const describeIfFish = fishAvailable ? describe : describe.skip;

describeIfFish("renderFish · subprocess completion", () => {
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

	it("completes root commands, nested commands, and flag choices under fish", async () => {
		for (const [line, expected] of [
			["mycli ", ["build", "dep", "deploy"]],
			["mycli deploy ", ["prod"]],
			["mycli build --target ", ["browser", "bun", "node"]],
		] as const) {
			const driver = `source ${shQuoteForFish(scriptPath)}; complete -C ${shQuoteForFish(line)}`;
			const {
				exitCode,
				stdout: out,
				stderr: err,
			} = await runBoundedProcess("fish", ["-c", driver], { timeout: 4_000 });
			expect(exitCode).toBe(0);
			expect(err).toBe("");
			expect(
				out
					.trim()
					.split("\n")
					.map((candidate) => candidate.split("\t")[0]),
			).toEqual([...expected]);
		}
	});
});

async function isFishAvailable(): Promise<boolean> {
	// A missing fish skips; a hung one fails at the probe deadline instead of skipping.
	if (which("fish") === null) return false;
	return (await runBoundedProcess("fish", ["--version"], { timeout: 5_000 })).exitCode === 0;
}

function shQuoteForFish(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

describe("renderFish — url/path/json value-flag handling", () => {
	const valueTypeFixture: CompletionCommand = {
		name: "mycli",
		flags: [
			{
				name: "out",
				type: "string",
				takesValue: true,
				negatable: false,
				valueCompletion: "files",
			},
			{
				name: "endpoint",
				type: "string",
				takesValue: true,
				negatable: false,
				valueCompletion: "none",
			},
			{
				name: "config",
				type: "string",
				takesValue: true,
				negatable: false,
				valueCompletion: "none",
			},
			{ name: "name", type: "string", takesValue: true, negatable: false },
		],
		args: [],
		subCommands: [],
	};

	it("emits __fish_complete_path for path flags", () => {
		const script = renderFish(valueTypeFixture, "mycli", "1.0.0");
		const line = script.split("\n").find((l) => l.includes("-l 'out'"));
		expect(line).toBeDefined();
		expect(line).toContain("-a '(__fish_complete_path)'");
		expect(line).toContain("-r");
	});

	it("does not emit __fish_complete_path for url or json flags", () => {
		const script = renderFish(valueTypeFixture, "mycli", "1.0.0");
		const endpointLine = script.split("\n").find((l) => l.includes("-l 'endpoint'"));
		const configLine = script.split("\n").find((l) => l.includes("-l 'config'"));
		expect(endpointLine).toBeDefined();
		expect(configLine).toBeDefined();
		expect(endpointLine).not.toContain("__fish_complete_path");
		expect(configLine).not.toContain("__fish_complete_path");
	});

	it("keeps requireParameter on plain string flags (no regression)", () => {
		const script = renderFish(valueTypeFixture, "mycli", "1.0.0");
		const line = script.split("\n").find((l) => l.includes("-l 'name'"));
		expect(line).toBeDefined();
		expect(line).toContain("-r");
		expect(line).not.toContain("__fish_complete_path");
	});

	it("emits a positional rule for path args; url/json positionals rely on the global -f suppression", () => {
		const posFixture: CompletionCommand = {
			name: "mycli",
			flags: [],
			args: [
				{
					name: "src",
					type: "string",
					required: true,
					variadic: false,
					valueCompletion: "files",
				},
				{
					name: "endpoint",
					type: "string",
					required: true,
					variadic: false,
					valueCompletion: "none",
				},
				{
					name: "payload",
					type: "string",
					required: true,
					variadic: false,
					valueCompletion: "none",
				},
			],
			subCommands: [],
		};
		const script = renderFish(posFixture, "mycli", "1.0.0");
		// Path positional gets an explicit `(__fish_complete_path)` rule.
		expect(script).toContain("-a '(__fish_complete_path)'");
		// url/json positionals: no explicit rule — the global `-f` keeps
		// file completion off, so suppression is implicit.
		const pathRuleCount = script
			.split("\n")
			.filter((l) => l.includes("__fish_complete_path")).length;
		expect(pathRuleCount).toBe(1);
	});
});
