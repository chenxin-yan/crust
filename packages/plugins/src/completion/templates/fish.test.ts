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
		// Bin name is single-quoted as defence-in-depth.
		expect(script).toContain("complete -c 'mycli' -f");
	});

	it("emits a per-script ordered path-resolution helper", () => {
		const script = renderFish(fixture, "mycli", "1.0.0");
		// Replaces the order-insensitive `__fish_seen_subcommand_from`
		// chain with a helper that walks `commandline -opc` left-to-right.
		expect(script).toContain("function __mycli_path_is");
		expect(script).toContain("commandline -opc");
	});

	it("emits subcommand rules gated on __<ident>_path_is at the top level", () => {
		const script = renderFish(fixture, "mycli", "1.0.0");
		// Top-level rules call the helper with the leaf-block list (the
		// canonical+alias spellings of the root's children) as the only
		// argument — no consumed-path prefix. The condition is itself
		// fish-single-quoted, so embedded `'` from the helper args are
		// emitted as `\'` (fish's single-quote escape sequence).
		expect(script).toContain("-n '__mycli_path_is \\'build deploy dep\\''");
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
	});

	it("nested subcommand rules call __<ident>_path_is with the consumed path", () => {
		const script = renderFish(fixture, "mycli", "1.0.0");
		// `deploy prod --env` lives at depth 2; the helper receives the
		// depth-1 spelling list (`deploy dep`), then the leaf block
		// (empty here because `prod` has no children). Embedded `'`s in
		// the helper-call string are escaped as `\'` by fish.
		expect(script).toContain(
			"-n '__mycli_path_is \\'deploy dep\\' \\'prod\\' \\'\\''",
		);
	});

	it("negates deeper subcommand candidates via the helper's leaf-block list", () => {
		const script = renderFish(fixture, "mycli", "1.0.0");
		// At depth `[deploy]` the leaf-block list is `prod` (its only
		// child); the helper rejects when `prod` has already appeared.
		expect(script).toContain(
			"-n '__mycli_path_is \\'deploy dep\\' \\'prod\\''",
		);
	});

	it("emits boolean flags without -r/-x", () => {
		const script = renderFish(fixture, "mycli", "1.0.0");
		// `--release` is a boolean toggle on `build`. The canonical rule
		// (matching `-l 'release'` exactly) must not carry -r or -x.
		const releaseLine = script
			.split("\n")
			.find((l) => l.includes("-l 'release'"));
		expect(releaseLine).toBeDefined();
		expect(releaseLine).not.toMatch(/ -r\b/);
		expect(releaseLine).not.toMatch(/ -x\b/);
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
		const spec: CompletionSpec = {
			root: {
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
			},
		};
		const script = renderFish(spec, "mp", "1.0.0");

		// The per-arg-index helper is emitted exactly once.
		expect(script).toContain("function __mp_path_at_arg");

		// Slot 0 of `two` -> exact spec `0`; one rule per choice value.
		expect(script).toContain("-n '__mp_path_at_arg \\'two\\' \\'0\\' \\'\\''");
		expect(
			script
				.split("\n")
				.filter((l) => l.includes("__mp_path_at_arg \\'two\\' \\'0\\'")).length,
		).toBe(2); // one rule per choice value

		// Slot 1 of `two` -> exact spec `1`.
		expect(
			script
				.split("\n")
				.filter((l) => l.includes("__mp_path_at_arg \\'two\\' \\'1\\'")).length,
		).toBe(2);

		// `vary`'s variadic arg lives at index 0 and is declared variadic
		// -> spec is `*0` (matches every slot >= 0).
		expect(
			script
				.split("\n")
				.filter((l) => l.includes("__mp_path_at_arg \\'vary\\' \\'*0\\'"))
				.length,
		).toBe(2);
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
		// Description goes through `fishSingleQuote`, which produces
		// `'it\'s complicated'` — fish single-quote with `\'` for the
		// embedded apostrophe.
		expect(script).toContain("-d 'it\\'s complicated'");
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
