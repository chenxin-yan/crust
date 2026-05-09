import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CompletionSpec } from "../spec.ts";
import { renderZsh } from "./zsh.ts";

/**
 * Same fixture shape as the bash tests so the snapshots line up.
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
		expect(script).toContain(":target:(browser bun node)");
		expect(script).toContain(":env:(dev staging prod)");
	});

	it("emits a mutex group {-h,--help} for flags with a short alias", () => {
		const script = renderZsh(fixture, "mycli", "1.0.0");
		// Short + long form for `--help`. Spec format is
		// `'(-h --help)'{-h,--help}'[desc]'` — single-quote delimited.
		expect(script).toContain("'(-h --help)'{-h,--help}");
	});

	it("aliases (TP-016) are dispatched to the same child helper", () => {
		const script = renderZsh(fixture, "mycli", "1.0.0");
		// `deploy|dep) _mycli_deploy ;;` — both spellings hit the same helper.
		expect(script).toMatch(/deploy\|dep\)/);
		// Subcommand menu surfaces both spellings.
		expect(script).toContain("'deploy:Deploy'");
		expect(script).toContain("'dep:Deploy'");
	});

	it("derives helper function names from bin name with non-alpha mapped to _", () => {
		const script = renderZsh(fixture, "my-cli", "1.0.0");
		// Function is `_my_cli`, but `#compdef` and `compdef` retain the
		// real binary name.
		expect(script).toContain("_my_cli() {");
		expect(script).toContain("compdef _my_cli my-cli");
	});

	it("escapes special characters in descriptions", () => {
		const spec: CompletionSpec = {
			root: {
				name: "x",
				flags: [
					{
						name: "fancy",
						type: "string",
						takesValue: true,
						description: "value: do [thing] now",
					},
				],
				args: [],
				subCommands: [],
			},
		};
		const script = renderZsh(spec, "x", "1.0.0");
		// `[`, `]`, and `:` in descriptions are backslash-escaped so the
		// `_arguments` parser keeps the description intact.
		expect(script).toContain("[value\\: do \\[thing\\] now]");
	});
});

/**
 * Behavioural tests: parse the generated script under `zsh -n` (syntax
 * check) at minimum. If a richer behavioural check is feasible (sourcing
 * the script and asking compsys directly), we attempt it; otherwise the
 * syntax check is the gate.
 */
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

	it("sources cleanly under interactive zsh with compsys initialised", async () => {
		// Drive completion the way zsh does: load compinit, source the
		// generated function file, then probe the candidate list with
		// `_main_complete` is impractical without a TTY; the next-best
		// gate is to confirm the script `source`s without errors when
		// compinit is active.
		const driver = `
emulate -L zsh
autoload -Uz compinit
compinit -u -d $TMPDIR/zcompdump 2>/dev/null
fpath=(${shQuoteForZsh(tmpDir)} $fpath)
source ${shQuoteForZsh(scriptPath)}
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
			throw new Error(
				`zsh failed: code=${code}\nstdout:\n${out}\nstderr:\n${err}`,
			);
		}
		expect(out).toContain("OK");
	});
});

if (!zshAvailable) {
	describe("renderZsh · zsh behavioural tests", () => {
		it.skip("zsh not available on PATH — skipping behavioural tests", () => {});
	});
}

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
