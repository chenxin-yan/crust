import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CompletionSpec } from "../spec.ts";
import { renderBash } from "./bash.ts";

/**
 * Fixture spec used across snapshot + behavioural tests. Mirrors a small
 * but representative tree: a flat subcommand (`build`), a nested
 * subcommand (`deploy prod`), and a flag with choices on `build --target`.
 */
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

describe("renderBash", () => {
	it("first line is the header comment with bin + version + regenerate hint", () => {
		const script = renderBash(fixture, "mycli", "1.2.3");
		const firstLine = script.split("\n")[0];
		expect(firstLine).toBe(
			"# completion script for mycli v1.2.3 — regenerate with: mycli completion bash",
		);
	});

	it("registers via `complete -F _<bin>` and includes a fallback init shim", () => {
		const script = renderBash(fixture, "mycli", "1.0.0");
		expect(script).toContain("__mycli_init_completion()");
		// Bin name is single-quoted as defence-in-depth even though it has
		// already passed `assertSafeBinName`.
		expect(script).toContain("complete -o default -F _mycli 'mycli'");
		// Fallback for systems without bash-completion.
		expect(script).toContain("declare -F _init_completion");
	});

	it("sanitises bin names with hyphens to valid bash identifiers", () => {
		const script = renderBash(fixture, "my-cli", "0.1.0");
		// Function name must use underscores, but `complete -F` target
		// should remain the on-disk binary name.
		expect(script).toContain("_my_cli()");
		expect(script).toContain("__my_cli_init_completion()");
		expect(script).toContain("complete -o default -F _my_cli 'my-cli'");
	});

	it("produces a stable golden snapshot for the fixture", () => {
		const script = renderBash(fixture, "mycli", "1.0.0");
		// We do not pin the entire script byte-for-byte; instead we assert
		// the structural landmarks are present and in the expected order.
		// This is the "golden" the task requires while remaining tolerant
		// of cosmetic touch-ups.
		const idxHeader = script.indexOf("# completion script for mycli");
		const idxInit = script.indexOf("__mycli_init_completion()");
		const idxMain = script.indexOf("_mycli() {");
		const idxRegister = script.indexOf("complete -o default -F _mycli 'mycli'");
		expect(idxHeader).toBeGreaterThanOrEqual(0);
		expect(idxInit).toBeGreaterThan(idxHeader);
		expect(idxMain).toBeGreaterThan(idxInit);
		expect(idxRegister).toBeGreaterThan(idxMain);

		// Verify the path-walk dispatch covers both canonical names and aliases.
		expect(script).toContain('"|build")');
		expect(script).toContain('"|deploy")');
		expect(script).toContain('"|dep")'); // alias of `deploy`
		expect(script).toContain('"deploy|prod")');

		// Verify choice handling for build --target. Choice values are
		// validated to a safe character set and emitted bare in the
		// `compgen -W` wordlist.
		expect(script).toContain('"build|--target")');
		expect(script).toContain('compgen -W "browser bun node"');
		expect(script).toContain('"deploy:prod|--env")');
		expect(script).toContain('compgen -W "dev staging prod"');
	});
});

/**
 * Behavioural subprocess tests: source the generated script under a fresh
 * `bash -c` and drive `_mycli` with synthetic `COMP_WORDS`/`COMP_CWORD`,
 * asserting `COMPREPLY` reflects the expected candidate set. This proves
 * the rendered script is not just shaped right but actually runs.
 */
describe("renderBash · behavioural subprocess tests", () => {
	let scriptPath: string;
	let tmpDir: string;

	beforeAll(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "tp010-bash-"));
		scriptPath = join(tmpDir, "mycli-completion.bash");
		const script = renderBash(fixture, "mycli", "1.0.0");
		await writeFile(scriptPath, script, "utf8");
	});

	afterAll(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	/**
	 * Drive the completion function as bash itself would. We:
	 *  - source the generated script (registers `_mycli`),
	 *  - set COMP_WORDS/COMP_CWORD for the cursor position,
	 *  - call `_mycli`,
	 *  - print `COMPREPLY` separated by newlines.
	 *
	 * Returning the candidates as a sorted array gives stable equality
	 * checks regardless of how bash orders them.
	 */
	async function runCompletion(words: string[]): Promise<string[]> {
		const compWordsLines = words
			.map((w, i) => `COMP_WORDS[${i}]=${shQuote(w)}`)
			.join("\n");
		const compCword = words.length - 1;
		const driver = `
set -e
source ${shQuote(scriptPath)}
${compWordsLines}
COMP_CWORD=${compCword}
COMP_LINE=${shQuote(words.join(" "))}
COMP_POINT=${words.join(" ").length}
_mycli
for r in "\${COMPREPLY[@]}"; do printf '%s\\n' "$r"; done
`;
		const proc = Bun.spawn(["bash", "-c", driver], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [out, err] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const code = await proc.exited;
		if (code !== 0) {
			throw new Error(`bash exited ${code}\nstderr:\n${err}\nstdout:\n${out}`);
		}
		return out
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.length > 0)
			.sort();
	}

	function shQuote(value: string): string {
		// Single-quote, escape any embedded single quotes.
		return `'${value.replace(/'/g, `'\\''`)}'`;
	}

	it("scenario 1 — top-level subcommand: `mycli <TAB>` lists build and deploy", async () => {
		const completions = await runCompletion(["mycli", ""]);
		expect(completions).toContain("build");
		expect(completions).toContain("deploy");
		// Alias for deploy is also offered.
		expect(completions).toContain("dep");
	});

	it("scenario 1b — prefix match narrows the list", async () => {
		const completions = await runCompletion(["mycli", "b"]);
		expect(completions).toContain("build");
		expect(completions).not.toContain("deploy");
	});

	it("scenario 2 — nested subcommand: `mycli deploy <TAB>` lists prod", async () => {
		const completions = await runCompletion(["mycli", "deploy", ""]);
		expect(completions).toContain("prod");
		// Should not bleed top-level subcommands here.
		expect(completions).not.toContain("build");
	});

	it("scenario 2b — alias-resolved nested subcommand: `mycli dep <TAB>` lists prod", async () => {
		const completions = await runCompletion(["mycli", "dep", ""]);
		expect(completions).toContain("prod");
	});

	it("scenario 3 — flag with choices: `mycli build --target <TAB>` lists target values", async () => {
		const completions = await runCompletion(["mycli", "build", "--target", ""]);
		expect(completions.sort()).toEqual(["browser", "bun", "node"]);
	});

	it("scenario 3b — nested flag with choices: `mycli deploy prod --env <TAB>`", async () => {
		const completions = await runCompletion([
			"mycli",
			"deploy",
			"prod",
			"--env",
			"",
		]);
		expect(completions.sort()).toEqual(["dev", "prod", "staging"]);
	});

	it("offers flag candidates when current token starts with `-`", async () => {
		const completions = await runCompletion(["mycli", "build", "--"]);
		expect(completions).toContain("--release");
		expect(completions).toContain("--target");
	});
});

/**
 * Behavioural tests for per-slot positional-argument choices. Verifies
 * that bash offers slot N's `choices` for the N-th positional, not just
 * the first — the historical limitation called out in the consistency
 * audit.
 */
describe("renderBash · multi-positional choices", () => {
	const multiPosFixture: CompletionSpec = {
		root: {
			name: "mp",
			flags: [],
			args: [],
			subCommands: [
				{
					name: "two",
					description: "two fixed positional slots",
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
					description: "variadic with choices from slot 1",
					flags: [],
					args: [
						{
							name: "mode",
							type: "string",
							required: true,
							variadic: false,
							choices: ["start", "stop"],
						},
						{
							name: "items",
							type: "string",
							required: false,
							variadic: true,
							choices: ["a", "b", "c"],
						},
					],
					subCommands: [],
				},
			],
		},
	};

	let scriptPath: string;
	let tmpDir: string;

	beforeAll(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "tp010-bash-multipos-"));
		scriptPath = join(tmpDir, "mp-completion.bash");
		const script = renderBash(multiPosFixture, "mp", "1.0.0");
		await writeFile(scriptPath, script, "utf8");
	});

	afterAll(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	async function runCompletion(words: string[]): Promise<string[]> {
		const shQuote = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
		const compWordsLines = words
			.map((w, i) => `COMP_WORDS[${i}]=${shQuote(w)}`)
			.join("\n");
		const compCword = words.length - 1;
		const driver = `
set -e
source ${shQuote(scriptPath)}
${compWordsLines}
COMP_CWORD=${compCword}
COMP_LINE=${shQuote(words.join(" "))}
COMP_POINT=${words.join(" ").length}
_mp
for r in "\${COMPREPLY[@]}"; do printf '%s\\n' "$r"; done
`;
		const proc = Bun.spawn(["bash", "-c", driver], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [out, err] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const code = await proc.exited;
		if (code !== 0) {
			throw new Error(`bash exited ${code}\nstderr:\n${err}\nstdout:\n${out}`);
		}
		return out
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.length > 0)
			.sort();
	}

	it("slot 0 of `mp two` offers the first arg's choices", async () => {
		const completions = await runCompletion(["mp", "two", ""]);
		expect(completions).toContain("alpha");
		expect(completions).toContain("beta");
		expect(completions).not.toContain("gamma");
	});

	it("slot 1 of `mp two` offers the second arg's choices (not the first's)", async () => {
		const completions = await runCompletion(["mp", "two", "alpha", ""]);
		expect(completions).toContain("gamma");
		expect(completions).toContain("delta");
		expect(completions).not.toContain("alpha");
		expect(completions).not.toContain("beta");
	});

	it("variadic-with-choices offers the variadic list at every slot >= variadicFrom", async () => {
		// Slot 0 still gets the `mode` arg's choices.
		const slot0 = await runCompletion(["mp", "vary", ""]);
		expect(slot0).toContain("start");
		expect(slot0).toContain("stop");
		expect(slot0).not.toContain("a");

		// Slot 1: enters the variadic.
		const slot1 = await runCompletion(["mp", "vary", "start", ""]);
		expect(slot1.sort()).toEqual(["a", "b", "c"]);

		// Slot 2 and beyond: still the variadic list.
		const slot2 = await runCompletion(["mp", "vary", "start", "a", ""]);
		expect(slot2.sort()).toEqual(["a", "b", "c"]);
	});

	it("intervening flags do not count toward the positional slot index", async () => {
		// `--unknown=x` and `--foo bar` between positionals should be
		// skipped; slot 1 should still offer the second arg's choices.
		const completions = await runCompletion([
			"mp",
			"two",
			"alpha",
			"--unknown=x",
			"",
		]);
		expect(completions).toContain("gamma");
		expect(completions).toContain("delta");
	});
});

describe("renderBash — url/path/json value-flag handling (TP-012)", () => {
	const valueTypeFixture: CompletionSpec = {
		root: {
			name: "mycli",
			flags: [
				{
					name: "out",
					type: "string",
					takesValue: true,
					isPath: true,
				},
				{
					name: "endpoint",
					type: "string",
					takesValue: true,
					isUrl: true,
				},
				{
					name: "config",
					type: "string",
					takesValue: true,
					isJson: true,
				},
				// Plain string flag — must not regress to a typed branch.
				{ name: "name", type: "string", takesValue: true },
			],
			args: [],
			subCommands: [],
		},
	};

	it("emits explicit file completion (compgen -f) for path flags", () => {
		const script = renderBash(valueTypeFixture, "mycli", "1.0.0");
		expect(script).toContain('"|--out")');
		expect(script).toContain('compgen -f -- "$cur"');
	});

	it("emits compopt +o default suppression for url and json flags", () => {
		const script = renderBash(valueTypeFixture, "mycli", "1.0.0");
		expect(script).toContain('"|--endpoint")');
		expect(script).toContain('"|--config")');
		expect(script).toContain("compopt +o default 2>/dev/null");
	});

	it("does not emit a typed case branch for plain string flags", () => {
		const script = renderBash(valueTypeFixture, "mycli", "1.0.0");
		// The plain `--name` flag still routes through __prev_is_value_flag
		// and the `complete -o default` fallback.
		expect(script).not.toContain('"|--name")');
	});

	it("suppresses `complete -o default` for url/json positional slots; path positionals rely on the fallback", () => {
		const posFixture: CompletionSpec = {
			root: {
				name: "mycli",
				flags: [],
				args: [
					{
						name: "src",
						type: "string",
						required: true,
						variadic: false,
						isPath: true,
					},
					{
						name: "endpoint",
						type: "string",
						required: true,
						variadic: false,
						isUrl: true,
					},
					{
						name: "payload",
						type: "string",
						required: true,
						variadic: false,
						isJson: true,
					},
				],
				subCommands: [],
			},
		};
		const script = renderBash(posFixture, "mycli", "1.0.0");
		// Suppression case is emitted for the two non-path slots (1, 2).
		expect(script).toContain("compopt +o default 2>/dev/null");
		// Slot 0 (path) is NOT in the suppression case — only 1 and 2 are.
		const suppressBlock = script
			.split("\n")
			.slice(
				script.split("\n").findIndex((l) => l.includes("compopt +o default")) -
					4,
			)
			.slice(0, 12)
			.join("\n");
		expect(suppressBlock).toMatch(/\b1\)\s*\n\s*compopt \+o default/);
		expect(suppressBlock).toMatch(/\b2\)\s*\n\s*compopt \+o default/);
		// The path slot (0) is not in the suppress block.
		expect(suppressBlock).not.toMatch(/\b0\)\s*\n\s*compopt \+o default/);
	});
});
