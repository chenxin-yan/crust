import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CompletionCommand } from "../spec.ts";
import { renderZsh } from "./zsh.ts";

/**
 * Same fixture shape as the bash tests so the snapshots line up.
 */
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
				{ name: "release", type: "boolean", takesValue: false, negatable: false },
				{
					name: "target",
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

describe("renderZsh", () => {
	it("first line is `#compdef <bin>` (required by zsh autoload)", () => {
		const script = renderZsh(fixture, "mycli", "1.0.0");
		const firstLine = script.split("\n")[0];
		expect(firstLine).toBe("#compdef mycli");
	});

	it("emits a header comment with bin + version + regenerate hint on line 2", () => {
		const script = renderZsh(fixture, "mycli", "2.0.0-beta");
		const lines = script.split("\n");
		expect(lines[1]).toBe(
			"# completion script for mycli v2.0.0-beta — regenerate with: mycli completion zsh",
		);
	});

	it("uses _arguments -C with ->state routing for non-leaf commands", () => {
		const script = renderZsh(fixture, "mycli", "1.0.0");
		expect(script).toContain("_arguments -C");
		expect(script).toContain("'1: :->cmds'");
		expect(script).toContain("'*::arg:->args'");
		expect(script).toContain("_describe 'subcommand' subcmds");
	});

	it("emits choices via :NAME:(opt1 opt2 opt3) form on string flags", () => {
		const script = renderZsh(fixture, "mycli", "1.0.0");
		// Choice values are validated to a safe character set and emitted
		// bare inside the `(…)` action list.
		expect(script).toContain(":target:(browser bun node)");
		expect(script).toContain(":env:(dev staging prod)");
	});

	it("emits a mutex group {-h,--help} for flags with a short alias", () => {
		const script = renderZsh(fixture, "mycli", "1.0.0");
		// Short + long form for `--help`. Spec format is
		// `'(-h --help)'{-h,--help}'[desc]'` — single-quote delimited.
		expect(script).toContain("'(-h --help)'{-h,--help}");
	});

	it("aliases are dispatched to the same child helper", () => {
		const script = renderZsh(fixture, "mycli", "1.0.0");
		// Both spellings hit the same helper. Each alternative is single-
		// quoted so glob metacharacters in command names are matched
		// literally rather than as zsh `case` patterns.
		expect(script).toMatch(/'deploy'\|'dep'\)/);
		// Subcommand menu surfaces both spellings.
		expect(script).toContain("'deploy:Deploy'");
		expect(script).toContain("'dep:Deploy'");
	});

	it("encodes command path segments so distinct paths never share a helper name", () => {
		const script = renderZsh(fixture, "mycli", "1.0.0");
		expect(script).toContain("_mycli__deploy() {");
		expect(script).toContain("_mycli__deploy__prod() {");
		expect(script).toMatch(/'deploy'\|'dep'\)\n\s+_mycli__deploy\n/);
	});

	it("derives helper function names from bin name with non-alpha mapped to _", () => {
		const script = renderZsh(fixture, "my-cli", "1.0.0");
		// Function is `_my_cli`, but `#compdef` and `compdef` retain the
		// real binary name. The `compdef` argument is single-quoted as
		// defence-in-depth.
		expect(script).toContain("_my_cli() {");
		expect(script).toContain("compdef _my_cli 'my-cli'");
	});

	it("escapes special characters in descriptions", () => {
		const spec: CompletionCommand = {
			name: "x",
			flags: [
				{
					name: "fancy",
					type: "string",
					takesValue: true,
					negatable: false,
					description: "value: do [thing] now",
				},
			],
			args: [],
			subCommands: [],
		};
		const script = renderZsh(spec, "x", "1.0.0");
		// `[`, `]`, and `:` in descriptions are backslash-escaped so the
		// `_arguments` parser keeps the description intact.
		expect(script).toContain("[value\\: do \\[thing\\] now]");
	});
});

/** Syntax and registration smoke; candidate generation needs a real completion context. */
const zshAvailable = await isZshAvailable();
const describeIfZsh = zshAvailable ? describe : describe.skip;

describeIfZsh("renderZsh · zsh -n syntax check", () => {
	let scriptPath: string;
	let tmpDir: string;

	beforeAll(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "tp010-zsh-"));
		scriptPath = join(tmpDir, "_mycli");
		const script = renderZsh(fixture, "mycli", "1.0.0");
		await writeFile(scriptPath, script, "utf8");
	});

	afterAll(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("parses cleanly under `zsh -n`", async () => {
		const proc = Bun.spawn(["zsh", "-n", scriptPath], {
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

	it("sources and registers completion under noninteractive zsh with compsys initialised", async () => {
		const driver = `
emulate -L zsh || exit 1
setopt ERR_EXIT || exit 1
autoload -Uz compinit || exit 1
compinit -u -d "$TMPDIR/zcompdump" || exit 1
fpath=(${shQuoteForZsh(tmpDir)} $fpath)
source ${shQuoteForZsh(scriptPath)} || exit 1
(( $+functions[_mycli] )) || exit 1
[[ $_comps[mycli] == _mycli ]] || exit 1
echo OK
`;
		const proc = Bun.spawn(["zsh", "-c", driver], {
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				TMPDIR: tmpDir,
			},
		});
		const [out, err] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const code = await proc.exited;
		if (code !== 0) {
			throw new Error(`zsh failed: code=${code}\nstdout:\n${out}\nstderr:\n${err}`);
		}
		expect(err).toBe("");
		expect(out.trim()).toBe("OK");
	});
});

/**
 * INT-03 regression: `foo-bar` and `foo_bar` (and nested `a b` vs flat
 * `a_b`) are all valid command paths but previously flattened to the same
 * `_<bin>_foo_bar` helper, so the later definition silently replaced the
 * earlier one. Helper names must be injective over command paths.
 */
const collisionFixture: CompletionCommand = {
	name: "clash",
	flags: [],
	args: [],
	subCommands: [
		{
			name: "foo-bar",
			flags: [{ name: "first", type: "boolean", takesValue: false, negatable: false }],
			args: [],
			subCommands: [],
		},
		{
			name: "foo_bar",
			flags: [{ name: "second", type: "boolean", takesValue: false, negatable: false }],
			args: [],
			subCommands: [],
		},
		{
			name: "foo.bar",
			flags: [{ name: "third", type: "boolean", takesValue: false, negatable: false }],
			args: [],
			subCommands: [],
		},
		{
			name: "a_b",
			flags: [{ name: "flat", type: "boolean", takesValue: false, negatable: false }],
			args: [],
			subCommands: [],
		},
		{
			name: "a",
			flags: [],
			args: [],
			subCommands: [
				{
					name: "b",
					flags: [{ name: "nested", type: "boolean", takesValue: false, negatable: false }],
					args: [],
					subCommands: [],
				},
			],
		},
	],
};

describe("renderZsh · helper names are injective over command paths", () => {
	it("emits one distinct helper definition per command", () => {
		const script = renderZsh(collisionFixture, "clash", "1.0.0");
		const definitions = [...script.matchAll(/^(_clash\S*)\(\) \{$/gm)].map((m) => m[1]);
		// Root + 6 commands, no duplicates.
		expect(definitions).toHaveLength(7);
		expect(new Set(definitions).size).toBe(7);
		// Every helper name is a portable identifier.
		for (const name of definitions) expect(name).toMatch(/^[A-Za-z0-9_]+$/);
		expect(definitions).toContain("_clash__foo_2dbar");
		expect(definitions).toContain("_clash__foo_5fbar");
		expect(definitions).toContain("_clash__foo_2ebar");
		expect(definitions).toContain("_clash__a_5fb");
		expect(definitions).toContain("_clash__a__b");
	});
});

describeIfZsh("renderZsh · colliding command names dispatch to their own flags", () => {
	let scriptPath: string;
	let tmpDir: string;

	beforeAll(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "tp010-zsh-collide-"));
		scriptPath = join(tmpDir, "_clash");
		await writeFile(scriptPath, renderZsh(collisionFixture, "clash", "1.0.0"), "utf8");
	});

	afterAll(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	/**
	 * Source the script with `compdef`/`_describe` stubbed and `_arguments`
	 * replaced by a spec printer, then call the helper for `<command>` and
	 * return the printed specs. No TTY or compsys needed to prove which
	 * function body the dispatcher reaches.
	 */
	async function specsFor(helper: string): Promise<string> {
		const driver = `
compdef() { :; }
_describe() { :; }
_arguments() { print -rl -- "$@"; }
source ${shQuoteForZsh(scriptPath)} || exit 1
${helper}
`;
		const proc = Bun.spawn(["zsh", "-c", driver], { stdout: "pipe", stderr: "pipe" });
		const [out, err] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const code = await proc.exited;
		if (code !== 0) throw new Error(`zsh exited ${code}\nstderr:\n${err}\nstdout:\n${out}`);
		return out;
	}

	it("parses cleanly under `zsh -n`", async () => {
		const proc = Bun.spawn(["zsh", "-n", scriptPath], { stdout: "pipe", stderr: "pipe" });
		const err = await new Response(proc.stderr).text();
		expect(err).toBe("");
		expect(await proc.exited).toBe(0);
	});

	it("foo-bar, foo_bar and foo.bar each keep their own flag specs", async () => {
		expect(await specsFor("_clash__foo_2dbar")).toBe("--first[]\n");
		expect(await specsFor("_clash__foo_5fbar")).toBe("--second[]\n");
		expect(await specsFor("_clash__foo_2ebar")).toBe("--third[]\n");
	});

	it("flat `a_b` and nested `a b` keep their own flag specs", async () => {
		expect(await specsFor("_clash__a_5fb")).toBe("--flat[]\n");
		expect(await specsFor("_clash__a__b")).toBe("--nested[]\n");
	});

	it("the root dispatcher routes `foo-bar` and `foo_bar` to different helpers", async () => {
		// The root's `_arguments -C` call is stubbed to set `state`/`line` as
		// compsys would after routing; leaf `_arguments` calls still print.
		const routed = async (word: string) =>
			specsFor(
				`_arguments() { if [[ $1 == -C ]]; then state=args; line=(${shQuoteForZsh(word)}); else print -rl -- "$@"; fi; }; _clash`,
			);
		expect(await routed("foo-bar")).toBe("--first[]\n");
		expect(await routed("foo_bar")).toBe("--second[]\n");
	});
});

async function isZshAvailable(): Promise<boolean> {
	try {
		const proc = Bun.spawn(["zsh", "--version"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		await proc.exited;
		return proc.exitCode === 0;
	} catch {
		return false;
	}
}

function shQuoteForZsh(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

describe("renderZsh — url/path/json value-flag handling", () => {
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

	it("emits _files action for path flags", () => {
		const script = renderZsh(valueTypeFixture, "mycli", "1.0.0");
		// `:out:_files` — single-flag spec, value label is the flag name.
		expect(script).toContain(":out:_files");
	});

	it("emits empty action (no completion) for url and json flags", () => {
		const script = renderZsh(valueTypeFixture, "mycli", "1.0.0");
		// `:endpoint: ` and `:config: ` — trailing space marks "no action".
		expect(script).toContain(":endpoint: ");
		expect(script).toContain(":config: ");
		// And critically NOT `_files` for these.
		expect(script).not.toContain(":endpoint:_files");
		expect(script).not.toContain(":config:_files");
	});

	it("keeps _files action for plain string flags (no regression)", () => {
		const script = renderZsh(valueTypeFixture, "mycli", "1.0.0");
		expect(script).toContain(":name:_files");
	});

	it("applies the same path/url/json branches to positional args", () => {
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
		const script = renderZsh(posFixture, "mycli", "1.0.0");
		expect(script).toContain(":src:_files");
		expect(script).toContain(":endpoint: ");
		expect(script).toContain(":payload: ");
		expect(script).not.toContain(":endpoint:_files");
		expect(script).not.toContain(":payload:_files");
	});
});
