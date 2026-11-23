import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust, defineCommand } from "@crustjs/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { reapBoundedProcesses, runBoundedProcess } from "../../../crust/tests/bounded-process.ts";
import type { CompletionCommand } from "../spec.ts";
import { walkCommand } from "../walker.ts";
import { renderBash } from "./bash.ts";
import { fixture, posFixture, valueTypeFixture } from "./test-fixtures.ts";

// Single-quote a value for bash, escaping embedded single quotes.
const shQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * Drive a generated bash completion function as bash itself would: source
 * the script (registers `fnName`), set `COMP_WORDS`/`COMP_CWORD` for the
 * cursor position, invoke `fnName`, then print `COMPREPLY` one per line.
 * Returns the candidates sorted so equality checks are order-stable.
 */
async function runBashCompletion(
	scriptPath: string,
	fnName: string,
	words: string[],
	cwd?: string,
	pathDir?: string,
): Promise<string[]> {
	const compWordsLines = words.map((w, i) => `COMP_WORDS[${i}]=${shQuote(w)}`).join("\n");
	const compCword = words.length - 1;
	const driver = `
set -e
${pathDir === undefined ? "" : `PATH=${shQuote(pathDir)}:"$PATH"`}
source ${shQuote(scriptPath)}
${compWordsLines}
COMP_CWORD=${compCword}
COMP_LINE=${shQuote(words.join(" "))}
COMP_POINT=${words.join(" ").length}
${fnName}
for r in "\${COMPREPLY[@]}"; do printf '%s\\n' "$r"; done
`;
	const {
		exitCode: code,
		stdout: out,
		stderr: err,
	} = await runBoundedProcess("bash", ["-c", driver], { cwd, timeout: 4_000 });
	if (code !== 0) {
		throw new Error(`bash exited ${code}\nstderr:\n${err}\nstdout:\n${out}`);
	}
	// Candidates are newline-delimited; do not trim — leading/trailing
	// whitespace in a filename candidate is meaningful.
	return out
		.split("\n")
		.filter((l) => l.length > 0)
		.sort();
}

afterEach(reapBoundedProcesses);

describe("renderBash", () => {
	it("sanitises bin names with hyphens to valid bash identifiers", () => {
		const script = renderBash(fixture, "my-cli", "0.1.0");
		// Function name must use underscores, but `complete -F` target
		// should remain the on-disk binary name.
		expect(script).toContain("_my_cli()");
		expect(script).toContain("__my_cli_init_completion()");
		expect(script).toContain("complete -o default -F _my_cli 'my-cli'");
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

	it("scenario 1 — top-level subcommand: `mycli <TAB>` lists build and deploy", async () => {
		const completions = await runBashCompletion(scriptPath, "_mycli", ["mycli", ""]);
		expect(completions).toContain("build");
		expect(completions).toContain("deploy");
		// Alias for deploy is also offered.
		expect(completions).toContain("dep");
	});

	it("scenario 3 — flag with choices: `mycli build --target <TAB>` lists target values", async () => {
		const completions = await runBashCompletion(scriptPath, "_mycli", [
			"mycli",
			"build",
			"--target",
			"",
		]);
		expect(completions.sort()).toEqual(["browser", "bun", "node"]);
	});
});

/**
 * Behavioural tests for per-slot positional-argument choices: bash offers
 * slot N's `choices` for the N-th positional, not just the first.
 */
describe("renderBash · multi-positional choices", () => {
	const multiPosFixture: CompletionCommand = {
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

	it.each<[string, string[], string[]]>([
		[
			"slot 1 of `mp two` offers the second arg's choices",
			["two", "alpha", ""],
			["delta", "gamma"],
		],
		[
			"intervening flags do not count toward the slot index",
			["two", "alpha", "--unknown=x", ""],
			["delta", "gamma"],
		],
		["slot 0 before a variadic", ["vary", ""], ["start", "stop"]],
		["slot 1 enters the variadic", ["vary", "start", ""], ["a", "b", "c"]],
		["slot 2 stays in the variadic", ["vary", "start", "a", ""], ["a", "b", "c"]],
	])("%s", async (_label, words, expected) => {
		expect(await runBashCompletion(scriptPath, "_mp", ["mp", ...words])).toEqual(expected);
	});
});

describe("renderBash — url/path/json value-flag handling", () => {
	/**
	 * `COMPREPLY=( $(compgen -f …) )` would word-split and glob-expand
	 * filenames, so `hello world.txt` would become two candidates and
	 * `star*.txt` would match other files. Each filesystem name must survive
	 * as exactly one candidate in both the separate and `--flag=` forms.
	 */
	describe("path candidates preserve whitespace and glob metacharacters", () => {
		let tmpDir: string;
		let scriptPath: string;
		let cwd: string;

		beforeAll(async () => {
			tmpDir = await mkdtemp(join(tmpdir(), "tp010-bash-spaced-"));
			scriptPath = join(tmpDir, "mycli-completion.bash");
			await writeFile(scriptPath, renderBash(valueTypeFixture, "mycli", "1.0.0"), "utf8");
			cwd = join(tmpDir, "cwd");
			await mkdir(cwd);
			for (const name of [
				"hello world.txt",
				"star*.txt",
				"starlight.txt",
				"$HOME.txt",
				"back\\slash",
			]) {
				await writeFile(join(cwd, name), "", "utf8");
			}
		});

		afterAll(async () => {
			await rm(tmpDir, { recursive: true, force: true });
		});

		const runCompletion = (words: string[]) => runBashCompletion(scriptPath, "_mycli", words, cwd);

		it("separate form: `mycli --out <TAB>` lists each file once", async () => {
			const completions = await runCompletion(["mycli", "--out", ""]);
			expect(completions).toEqual([
				"$HOME.txt",
				"back\\slash",
				"hello world.txt",
				"star*.txt",
				"starlight.txt",
			]);
		});

		it("equals form: `mycli --out=st<TAB>` keeps the literal `*` and the flag prefix", async () => {
			const completions = await runCompletion(["mycli", "--out=st"]);
			expect(completions).toEqual(["--out=star*.txt", "--out=starlight.txt"]);
		});
	});

	it("suppresses `complete -o default` for url/json positional slots; path positionals rely on the fallback", () => {
		const script = renderBash(posFixture, "mycli", "1.0.0");
		// Suppression case is emitted for the two non-path slots (1, 2).
		expect(script).toContain("compopt +o default 2>/dev/null");
		// Slot 0 (path) is NOT in the suppression case — only 1 and 2 are.
		expect(script).toMatch(/\b1\)\s*\n\s*compopt \+o default/);
		expect(script).toMatch(/\b2\)\s*\n\s*compopt \+o default/);
		expect(script).not.toMatch(/\b0\)\s*\n\s*compopt \+o default/);
	});
});

/**
 * One command mixing all three flag-value modes (choices, files,
 * suppression), each reachable via long/short/alias spellings under an
 * aliased subcommand, in both the separate and `--flag=` input forms.
 * `compopt` only works inside real completion, so the script is sourced
 * after a stub that records each call as a candidate line.
 */
describe("renderBash · mixed flag value modes", () => {
	const mixedFixture: CompletionCommand = {
		name: "mycli",
		flags: [],
		args: [],
		subCommands: [
			{
				name: "deploy",
				aliases: ["dep"],
				flags: [
					{
						name: "mode",
						spellings: ["-m", "--mode", "--flavor"],
						type: "string",
						takesValue: true,
						choices: ["fast", "slow"],
					},
					{
						name: "out",
						spellings: ["-o", "--out", "--output"],
						type: "string",
						takesValue: true,
						valueCompletion: "files",
					},
					{
						name: "endpoint",
						spellings: ["-e", "--endpoint", "--url"],
						type: "string",
						takesValue: true,
						valueCompletion: "none",
					},
				],
				args: [],
				subCommands: [],
			},
		],
	};

	let tmpDir: string;
	let scriptPath: string;
	let cwd: string;

	beforeAll(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "tp010-bash-mixed-"));
		scriptPath = join(tmpDir, "mycli-completion.bash");
		const compoptStub = `compopt() { printf '@compopt %s\\n' "$*"; }\n`;
		await writeFile(scriptPath, compoptStub + renderBash(mixedFixture, "mycli", "1.0.0"), "utf8");
		cwd = join(tmpDir, "cwd");
		await mkdir(cwd);
		for (const name of ["hello world.txt", "notes.md"]) {
			await writeFile(join(cwd, name), "", "utf8");
		}
	});

	afterAll(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it.each<[string, string[], string[]]>([
		["choices, short separate", ["dep", "-m", ""], ["fast", "slow"]],
		["choices, alias equals", ["deploy", "--flavor="], ["--flavor=fast", "--flavor=slow"]],
		[
			"files, short separate",
			["dep", "-o", ""],
			["@compopt -o filenames", "hello world.txt", "notes.md"],
		],
		[
			"files, alias equals",
			["deploy", "--output=hello"],
			["--output=hello world.txt", "@compopt -o filenames"],
		],
		["suppression, short separate", ["dep", "-e", ""], ["@compopt +o default"]],
		["suppression, alias equals", ["deploy", "--url=ht"], ["@compopt +o default"]],
	])("%s", async (_label, words, expected) => {
		const completions = await runBashCompletion(scriptPath, "_mycli", ["mycli", ...words], cwd);
		expect(completions).toEqual(expected);
	});
});

/** Core accepts a one-character alias with one dash (`-P`); completion reads that from the doc model. */
describe("renderBash · one-character alias spellings", () => {
	let tmpDir: string;
	let scriptPath: string;

	beforeAll(async () => {
		const app = new Crust("mycli")
			.flags({ port: { type: "number", short: "p", aliases: ["P", "listen"] } })
			.add(
				defineCommand("serve", (serve) =>
					serve.add(defineCommand("start", (start) => start.action(() => {}))),
				),
			);
		const spec = walkCommand(await app.snapshot());
		tmpDir = await mkdtemp(join(tmpdir(), "bash-one-char-"));
		scriptPath = join(tmpDir, "mycli-completion.bash");
		await writeFile(scriptPath, renderBash(spec, "mycli", "1.0.0"), "utf8");
	});

	afterAll(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("routes past the value of `-P`", async () => {
		expect(
			await runBashCompletion(scriptPath, "_mycli", ["mycli", "-P", "9090", "serve", ""]),
		).toEqual(["start"]);
	});
});

/** Core accepts any one-character short but whitespace and `-`; the script keeps each literal. */
describe("renderBash · punctuation shorts", () => {
	let tmpDir: string;
	let scriptPath: string;
	const shorts = [".", "$", "*", "'", "\\", "`"];

	beforeAll(async () => {
		const spec: CompletionCommand = {
			name: "mycli",
			flags: [
				...shorts.map((short, index) => ({
					name: `flag${index}`,
					spellings: [`-${short}`],
					type: "boolean" as const,
					takesValue: false as const,
				})),
				{
					name: "money",
					spellings: ["-+", "--money"],
					type: "string",
					takesValue: true,
					choices: ["cash", "card"],
				},
			],
			args: [],
			subCommands: [{ name: "serve", flags: [], args: [], subCommands: [] }],
		};
		tmpDir = await mkdtemp(join(tmpdir(), "bash-shorts-"));
		scriptPath = join(tmpDir, "mycli-completion.bash");
		await writeFile(scriptPath, renderBash(spec, "mycli", "1.0.0"), "utf8");
		// An unquoted `-*` would glob-match this file.
		await writeFile(join(tmpDir, "-zz"), "");
	});

	afterAll(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("offers every punctuation short as typed", async () => {
		expect(await runBashCompletion(scriptPath, "_mycli", ["mycli", "-"], tmpDir)).toEqual(
			[...shorts.map((short) => `-${short}`), "-+", "--money"].sort(),
		);
	});

	it("completes and routes past the value of a punctuation short", async () => {
		expect(await runBashCompletion(scriptPath, "_mycli", ["mycli", "-+", "c"], tmpDir)).toEqual([
			"card",
			"cash",
		]);
		expect(
			await runBashCompletion(scriptPath, "_mycli", ["mycli", "-*", "-+", "cash", ""], tmpDir),
		).toEqual(["serve"]);
	});
});

/** The script calls `<bin> __complete -- <address> <word>`; a stub on PATH answers here. */
describe("renderBash · complete functions", () => {
	let tmpDir: string;
	let scriptPath: string;
	const spec: CompletionCommand = {
		name: "mycli",
		flags: [],
		args: [],
		subCommands: [
			{
				name: "deploy",
				flags: [
					{
						name: "region",
						spellings: ["-r", "--region"],
						type: "string",
						takesValue: true,
						complete: "mycli deploy --region",
					},
				],
				args: [
					{
						name: "service",
						type: "string",
						required: true,
						variadic: false,
						complete: "mycli deploy service",
					},
				],
				subCommands: [],
			},
		],
	};

	beforeAll(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "bash-complete-"));
		scriptPath = join(tmpDir, "mycli-completion.bash");
		await writeFile(scriptPath, renderBash(spec, "mycli", "1.0.0"), "utf8");
		await mkdir(join(tmpDir, "bin"));
		const stub = join(tmpDir, "bin", "mycli");
		await writeFile(
			stub,
			`#!/bin/sh\n[ "$1" = __complete ] && [ "$2" = -- ] || exit 1\nprintf '%s\\n' "$4-one" "$4-two" "at $3" '$(x)'\n`,
		);
		await chmod(stub, 0o755);
	});

	afterAll(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	const complete = (words: string[]) =>
		runBashCompletion(scriptPath, "_mycli", words, tmpDir, join(tmpDir, "bin"));

	it("offers a flag's values that start with the word, quoted, in both spellings", async () => {
		expect(await complete(["mycli", "deploy", "--region", ""])).toEqual([
			"-one",
			"-two",
			"\\$\\(x\\)",
			"at\\ mycli\\ deploy\\ --region",
		]);
		expect(await complete(["mycli", "deploy", "-r", "us"])).toEqual(["us-one", "us-two"]);
		expect(await complete(["mycli", "deploy", "--region=us"])).toEqual([
			"--region=us-one",
			"--region=us-two",
		]);
	});

	it("offers an argument's values", async () => {
		expect(await complete(["mycli", "deploy", "api"])).toEqual(["api-one", "api-two"]);
	});

	it("offers nothing, silently, when the CLI cannot answer", async () => {
		expect(
			await runBashCompletion(scriptPath, "_mycli", ["mycli", "deploy", "--region", ""], tmpDir),
		).toEqual([]);
	});
});

describe("renderBash · behavioural · -- and --name=value", () => {
	const spec: CompletionCommand = {
		name: "mycli",
		flags: [],
		args: [],
		subCommands: [
			{
				name: "build",
				flags: [
					{
						name: "target",
						spellings: ["--target"],
						type: "string",
						takesValue: true,
						choices: ["browser", "node"],
					},
					{ name: "out", spellings: ["--out"], type: "string", takesValue: true },
				],
				args: [],
				subCommands: [{ name: "deploy", flags: [], args: [], subCommands: [] }],
			},
			{
				name: "seek",
				flags: [{ name: "watch", spellings: ["--watch"], type: "boolean", takesValue: false }],
				args: [
					{ name: "task", type: "string", required: true, variadic: false, choices: ["lint"] },
					{ name: "pkgs", type: "string", required: false, variadic: true, choices: ["cli"] },
				],
				subCommands: [],
			},
			{
				name: "run",
				flags: [{ name: "watch", spellings: ["--watch"], type: "boolean", takesValue: false }],
				args: [
					{ name: "task", type: "string", required: true, variadic: false, choices: ["lint"] },
					{ name: "pkgs", type: "string", required: false, variadic: true, choices: ["cli"] },
					{
						name: "extra",
						type: "string",
						required: false,
						variadic: "afterDoubleDash",
						choices: ["fix"],
					},
				],
				subCommands: [],
			},
			{
				name: "exec",
				flags: [],
				args: [
					{ name: "pod", type: "string", required: true, variadic: false, choices: ["web"] },
					{
						name: "cmd",
						type: "string",
						required: true,
						variadic: "afterDoubleDash",
						choices: ["ls"],
					},
				],
				subCommands: [],
			},
			{
				name: "docker",
				flags: [
					{ name: "rm", spellings: ["--rm"], type: "boolean", takesValue: false },
					{ name: "name", spellings: ["--name"], type: "string", takesValue: true },
				],
				args: [
					{ name: "image", type: "string", required: true, variadic: false, choices: ["alpine"] },
					{
						name: "command",
						type: "string",
						required: false,
						variadic: "passthrough",
						choices: ["sh"],
					},
				],
				subCommands: [],
			},
			{
				name: "box",
				flags: [
					{ name: "rm", spellings: ["--rm"], type: "boolean", takesValue: false },
					{ name: "name", spellings: ["--name"], type: "string", takesValue: true },
				],
				args: [
					{ name: "image", type: "string", required: true, variadic: false, choices: ["img"] },
					{ name: "command", type: "string", required: false, variadic: false, choices: ["cmd"] },
					{
						name: "tail",
						type: "string",
						required: false,
						variadic: "passthrough",
						choices: ["tail"],
					},
				],
				subCommands: [],
			},
			{
				name: "wrap",
				flags: [],
				args: [
					{
						name: "extra",
						type: "string",
						required: false,
						variadic: "afterDoubleDash",
						choices: ["fix"],
					},
				],
				subCommands: [{ name: "child", flags: [], args: [], subCommands: [] }],
			},
		],
	};

	let scriptPath: string;
	let tmpDir: string;

	beforeAll(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "tp010-bash-adv-"));
		scriptPath = join(tmpDir, "mycli-completion.bash");
		await writeFile(scriptPath, renderBash(spec, "mycli", "1"));
	});

	afterAll(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	const complete = (words: string[]) => runBashCompletion(scriptPath, "_mycli", words);

	it("`--name=value` form completes the value's choice list", async () => {
		const candidates = await complete(["mycli", "build", "--target=br"]);
		// Bash sees one current token `--target=br`; the script splits on
		// `=` and offers the choices that match prefix `br`.
		expect(candidates).toContain("--target=browser");
		expect(candidates).not.toContain("--target=node");
	});

	it("after `--`, no subcommand or flag candidates are offered", async () => {
		expect(await complete(["mycli", "build", ""])).toEqual(["deploy"]);
		expect(await complete(["mycli", "build", "--"])).toEqual(["--out", "--target"]);
		expect(await complete(["mycli", "build", "--", "--"])).toEqual([]);
		const candidates = await complete(["mycli", "build", "--", ""]);
		// Past the `--` terminator we return without setting COMPREPLY,
		// so the candidate set is empty (filename completion happens via
		// `complete -o default` at the bash level).
		expect(candidates).toEqual([]);
	});

	it("after `--`, positionals keep filling argument slots but flags are never offered", async () => {
		expect(await complete(["mycli", "seek", "--", ""])).toEqual(["lint"]);
		expect(await complete(["mycli", "seek", "lint", "--", ""])).toEqual(["cli"]);
		expect(await complete(["mycli", "seek", "--", "-x", ""])).toEqual(["cli"]);
		expect(await complete(["mycli", "seek", "lint", "--", "--"])).toEqual([]);
		expect(await complete(["mycli", "seek", "lint", "--w"])).toEqual(["--watch"]);
		// Core routes nothing after `--`.
		expect(await complete(["mycli", "--", ""])).toEqual([]);
	});

	it('offers an "afterDoubleDash" argument only after `--`, and the others only before', async () => {
		expect(await complete(["mycli", "run", ""])).toEqual(["lint"]);
		expect(await complete(["mycli", "run", "lint", ""])).toEqual(["cli"]);
		expect(await complete(["mycli", "run", "lint", "cli", "cli", ""])).toEqual(["cli"]);
		expect(await complete(["mycli", "run", "lint", "--", ""])).toEqual(["fix"]);
		expect(await complete(["mycli", "run", "--", "x", ""])).toEqual(["fix"]);
		expect(await complete(["mycli", "run", "--", "--w"])).toEqual([]);
		expect(await complete(["mycli", "exec", "web", ""])).toEqual([]);
		expect(await complete(["mycli", "exec", "web", "--", ""])).toEqual(["ls"]);
		expect(await complete(["mycli", "exec", "web", "--", "ls", ""])).toEqual(["ls"]);
	});

	it('offers no flags after the first positional of a command with a "passthrough" argument', async () => {
		expect(await complete(["mycli", "docker", "--"])).toEqual(["--name", "--rm"]);
		expect(await complete(["mycli", "docker", "--name", "x", ""])).toEqual(["alpine"]);
		expect(await complete(["mycli", "docker", "alpine", "--"])).toEqual([]);
		expect(await complete(["mycli", "docker", "alpine", ""])).toEqual(["sh"]);
		expect(await complete(["mycli", "docker", "--rm", "alpine", "-x", ""])).toEqual(["sh"]);

		// From the first positional on, every word fills a slot, as Core binds it.
		expect(await complete(["mycli", "box", "img", ""])).toEqual(["cmd"]);
		expect(await complete(["mycli", "box", "img", "--rm", ""])).toEqual(["tail"]);
		expect(await complete(["mycli", "box", "img", "--name", "x", ""])).toEqual(["tail"]);
		expect(await complete(["mycli", "box", "img", "--", ""])).toEqual(["tail"]);
		expect(await complete(["mycli", "box", "--", "img", "--", ""])).toEqual(["tail"]);
		expect(await complete(["mycli", "box", "--rm", "--name", "x", "img", ""])).toEqual(["cmd"]);
		// A lone `-` (stdin) is a positional.
		expect(await complete(["mycli", "box", "-", ""])).toEqual(["cmd"]);
		expect(await complete(["mycli", "box", "-", "--r"])).toEqual([]);
	});

	it('still offers subcommands before `--` when an "afterDoubleDash" argument is the only one', async () => {
		expect(await complete(["mycli", "wrap", ""])).toEqual(["child"]);
		expect(await complete(["mycli", "wrap", "--", ""])).toEqual(["fix"]);
	});

	it("after a free-form value flag, no subcommand candidates are offered", async () => {
		// `--out` is a value-taking flag with no choices; the next word
		// is a free-form value, not a subcommand.
		expect(await complete(["mycli", "build", ""])).toEqual(["deploy"]);
		const candidates = await complete(["mycli", "build", "--out", ""]);
		expect(candidates).toEqual([]);
	});
});
