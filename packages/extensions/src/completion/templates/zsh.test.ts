import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust, defineCommand } from "@crustjs/core";
import { buildCommandDocumentation } from "@crustjs/core/tooling";
import { which } from "@crustjs/utils/process";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import {
	reapBoundedProcesses,
	runBoundedProcess,
} from "../../../../crust/tests/bounded-process.ts";
import type { CompletionCommand } from "../spec.ts";
import { walkCommand } from "../walker.ts";
import { fixture, posFixture, valueTypeFixture } from "./test-fixtures.ts";
import { renderZsh } from "./zsh.ts";

afterEach(reapBoundedProcesses);

describe("renderZsh", () => {
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
					spellings: ["--fancy"],
					type: "string",
					takesValue: true,
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

describeIfZsh("renderZsh · registration smoke", () => {
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
		const {
			exitCode: code,
			stdout: out,
			stderr: err,
		} = await runBoundedProcess("zsh", ["-c", driver], {
			env: {
				...process.env,
				TMPDIR: tmpDir,
			},
			timeout: 4_000,
		});
		if (code !== 0) {
			throw new Error(`zsh failed: code=${code}\nstdout:\n${out}\nstderr:\n${err}`);
		}
		expect(err).toBe("");
		expect(out.trim()).toBe("OK");
	});
});

/**
 * `foo-bar` and `foo_bar` (and nested `a b` vs flat `a_b`) are all valid
 * command paths. Flattened to the same `_<bin>_foo_bar` helper, the later
 * definition would silently replace the earlier one, so helper names must
 * be injective over command paths.
 */
const collisionFixture: CompletionCommand = {
	name: "clash",
	flags: [],
	args: [],
	subCommands: [
		{
			name: "foo-bar",
			flags: [{ name: "first", spellings: ["--first"], type: "boolean", takesValue: false }],
			args: [],
			subCommands: [],
		},
		{
			name: "foo_bar",
			flags: [{ name: "second", spellings: ["--second"], type: "boolean", takesValue: false }],
			args: [],
			subCommands: [],
		},
		{
			name: "foo.bar",
			flags: [{ name: "third", spellings: ["--third"], type: "boolean", takesValue: false }],
			args: [],
			subCommands: [],
		},
		{
			name: "a_b",
			flags: [{ name: "flat", spellings: ["--flat"], type: "boolean", takesValue: false }],
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
					flags: [{ name: "nested", spellings: ["--nested"], type: "boolean", takesValue: false }],
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
_arguments() { [[ $1 == -S ]] && shift; print -rl -- "$@"; }
source ${shQuoteForZsh(scriptPath)} || exit 1
${helper}
`;
		const {
			exitCode: code,
			stdout: out,
			stderr: err,
		} = await runBoundedProcess("zsh", ["-c", driver], { timeout: 4_000 });
		if (code !== 0) throw new Error(`zsh exited ${code}\nstderr:\n${err}\nstdout:\n${out}`);
		return out;
	}

	it("foo-bar, foo_bar and foo.bar each keep their own flag specs", async () => {
		expect(await specsFor("_clash__foo_2dbar")).toBe("--first[]\n");
		expect(await specsFor("_clash__foo_5fbar")).toBe("--second[]\n");
		expect(await specsFor("_clash__foo_2ebar")).toBe("--third[]\n");
	});

	it("the root dispatcher routes `foo-bar` and `foo_bar` to different helpers", async () => {
		// The root's `_arguments -C` call is stubbed to set `state`/`line` as
		// compsys would after routing; leaf `_arguments` calls still print.
		const routed = async (word: string) =>
			specsFor(
				`_arguments() { if [[ $1 == -C ]]; then state=args; line=(${shQuoteForZsh(word)}); else [[ $1 == -S ]] && shift; print -rl -- "$@"; fi; }; _clash`,
			);
		expect(await routed("foo-bar")).toBe("--first[]\n");
		expect(await routed("foo_bar")).toBe("--second[]\n");
	});
});

describeIfZsh("renderZsh · descriptions reach _arguments unchanged", () => {
	let tmpDir: string;

	beforeAll(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "zsh-desc-"));
	});

	afterAll(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("keeps apostrophes in single- and multi-spelling flag descriptions", async () => {
		const scriptPath = join(tmpDir, "_quote");
		const spec: CompletionCommand = {
			name: "quote",
			flags: [
				{
					name: "ex",
					spellings: ["--ex"],
					type: "boolean",
					takesValue: false,
					description: "it's",
				},
				{
					name: "yes",
					spellings: ["-y", "--yes", "--no-yes"],
					type: "boolean",
					takesValue: false,
					description: "Don't prompt",
				},
			],
			args: [],
			subCommands: [],
		};
		await writeFile(scriptPath, renderZsh(spec, "quote", "1.0.0"), "utf8");
		const driver = `
compdef() { :; }
_arguments() { [[ $1 == -S ]] && shift; print -rl -- "$@"; }
source ${shQuoteForZsh(scriptPath)} || exit 1
_quote
`;
		const { exitCode, stdout, stderr } = await runBoundedProcess("zsh", ["-c", driver], {
			timeout: 4_000,
		});
		if (exitCode !== 0) throw new Error(`zsh exited ${exitCode}\nstderr:\n${stderr}`);
		expect(stdout).toBe(
			[
				"--ex[it's]",
				"(-y --yes)-y[Don't prompt]",
				"(-y --yes)--yes[Don't prompt]",
				"--no-yes[disable\\: Don't prompt]",
				"",
			].join("\n"),
		);
	});
});

/**
 * Type `line` into an interactive zsh on a pty and press a widget bound to
 * compsys completion, collecting every match the completers add. The pty
 * echoes typed input, so the end marker is computed (`END$((1+1))`) and
 * never matches its own echo, and a newline first keeps the first match off
 * the echoed line.
 */
async function zshComplete(scriptPath: string, line: string): Promise<string[]> {
	const driver = `
zmodload zsh/zpty || exit 1
zpty -b z zsh -f -i
zpty -w z ${shQuoteForZsh(`PS1=''; autoload -Uz compinit; compinit -u -D; source ${shQuoteForZsh(scriptPath)}`)}
zpty -w z 'complete_print() { print >/dev/tty; compadd() { local -a m; builtin compadd -O m "$@"; (( $#m )) && print -rl -- \${(@)m/#/CAND:} >/dev/tty; builtin compadd "$@"; }; _main_complete; unfunction compadd; print -r -- END$((1+1)) >/dev/tty; }; zle -C complete-print complete-word complete_print; bindkey "^X" complete-print'
zpty -w -n z ${shQuoteForZsh(line)}$'\\x18'
local all='' chunk
for i in {1..150}; do
	if zpty -r -t z chunk; then all+=$chunk; [[ $all == *END2* ]] && break; else sleep 0.05; fi
done
zpty -d z
[[ $all == *END2* ]] || exit 1
print -rl -- \${(u)\${\${(M)\${(f)all//$'\\r'/}:#CAND:*}#CAND:}}
`;
	const { exitCode, stdout, stderr } = await runBoundedProcess("zsh", ["-f", "-c", driver], {
		timeout: 15_000,
	});
	if (exitCode !== 0)
		throw new Error(`zsh exited ${exitCode}\nstderr:\n${stderr}\nstdout:\n${stdout}`);
	return stdout
		.split("\n")
		.filter((candidate) => candidate !== "")
		.sort();
}

/** Core accepts a one-character alias with one dash (`-P`); completion reads that from the doc model. */
describeIfZsh("renderZsh · one-character alias spellings", () => {
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
		const spec = walkCommand(buildCommandDocumentation(await app.snapshot()));
		tmpDir = await mkdtemp(join(tmpdir(), "zsh-one-char-"));
		scriptPath = join(tmpDir, "_mycli");
		await writeFile(scriptPath, renderZsh(spec, "mycli", "1.0.0"), "utf8");
	});

	afterAll(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("routes past the value of `-P`", async () => {
		expect(await zshComplete(scriptPath, "mycli -P 9090 serve ")).toEqual(["start"]);
	});
});

/** Core never reads flags after `--`; later words fill argument slots, or only an `afterDoubleDash` argument. */
describeIfZsh("renderZsh · after `--`", () => {
	let tmpDir: string;
	let scriptPath: string;

	beforeAll(async () => {
		const app = new Crust("mycli").add(
			defineCommand("seek", (seek) =>
				seek
					.flags({ watch: { type: "boolean" } })
					.args(
						{ name: "task", type: "string", choices: ["lint"], required: true },
						{ name: "pkgs", type: "string", choices: ["cli"], variadic: true },
					)
					.action(() => {}),
			),
			defineCommand("run", (run) =>
				run
					.flags({ watch: { type: "boolean" } })
					.args(
						{ name: "task", type: "string", choices: ["lint"], required: true },
						{ name: "pkgs", type: "string", choices: ["cli"], variadic: true },
						{
							name: "extra",
							type: "string",
							choices: ["fix"],
							variadic: true,
							afterDoubleDash: true,
						},
					)
					.action(() => {}),
			),
			defineCommand("exec", (exec) =>
				exec
					.args(
						{ name: "pod", type: "string", choices: ["web"], required: true },
						{ name: "cmd", type: "string", choices: ["ls"], afterDoubleDash: true },
					)
					.action(() => {}),
			),
		);
		const spec = walkCommand(buildCommandDocumentation(await app.snapshot()));
		tmpDir = await mkdtemp(join(tmpdir(), "zsh-double-dash-"));
		scriptPath = join(tmpDir, "_mycli");
		await writeFile(scriptPath, renderZsh(spec, "mycli", "1.0.0"), "utf8");
	});

	afterAll(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	// Each pty completion takes ~0.7s, so each row is its own test.
	it.each<[string, string[]]>([
		// Keeps filling argument slots and offers no flags.
		["mycli seek -- ", ["lint"]],
		["mycli seek lint -- ", ["cli"]],
		["mycli seek lint --w", ["--watch"]],
		["mycli seek lint -- --w", []],
		// Offers the arguments before an afterDoubleDash argument only before `--`.
		["mycli run ", ["lint"]],
		["mycli run lint ", ["cli"]],
		["mycli run lint cli ", ["cli"]],
		["mycli exec web ", []],
		// Offers an afterDoubleDash argument only after `--`.
		["mycli run lint -- ", ["fix"]],
		["mycli run -- x ", ["fix"]],
		["mycli run lint -- --w", []],
		["mycli exec web -- ", ["ls"]],
		["mycli exec web -- ls ", []],
	])("completes %j", async (line, expected) => {
		expect(await zshComplete(scriptPath, line)).toEqual(expected);
	});
});

async function isZshAvailable(): Promise<boolean> {
	// A missing zsh skips; a hung one fails at the probe deadline instead of skipping.
	if (which("zsh") === null) return false;
	return (await runBoundedProcess("zsh", ["--version"], { timeout: 5_000 })).exitCode === 0;
}

function shQuoteForZsh(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

describe("renderZsh — url/path/json value-flag handling", () => {
	it("emits _files for path and plain string flags, and an empty action for url and json flags", () => {
		const script = renderZsh(valueTypeFixture, "mycli", "1.0.0");
		// `:out:_files` — single-flag spec, value label is the flag name.
		expect(script).toContain(":out:_files");
		expect(script).toContain(":name:_files");
		// `:endpoint: ` and `:config: ` — trailing space marks "no action".
		expect(script).toContain(":endpoint: ");
		expect(script).toContain(":config: ");
		expect(script).not.toContain(":endpoint:_files");
		expect(script).not.toContain(":config:_files");
	});

	it("applies the same path/url/json branches to positional args", () => {
		const script = renderZsh(posFixture, "mycli", "1.0.0");
		expect(script).toContain(":src:_files");
		expect(script).toContain(":endpoint: ");
		expect(script).toContain(":payload: ");
		expect(script).not.toContain(":endpoint:_files");
		expect(script).not.toContain(":payload:_files");
	});
});
