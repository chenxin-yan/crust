import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust } from "@crustjs/core";

import { completionPlugin } from "./index.ts";
import type { CompletionSpec } from "./spec.ts";
import { renderBash } from "./templates/bash.ts";
import { renderFish } from "./templates/fish.ts";
import { renderZsh } from "./templates/zsh.ts";
import { walkCommandNode } from "./walker.ts";

/**
 * Adversarial test suite. These tests exercise the validation/escape
 * boundary that protects the generated shell scripts from injection,
 * the documented behaviour for `--`/`--name=value`/`--no-` in bash, the
 * order-sensitive fish path predicate, and `--output-dir` traversal.
 *
 * They are intentionally separate from the per-shell `*.test.ts` files
 * so the per-shell suites stay focused on the renderer's happy path.
 */

// ── Walker validation ────────────────────────────────────────────────────

describe("walker · validation", () => {
	it("rejects command names containing whitespace", () => {
		const cli = new Crust("bad")
			.command("two words" as string, (c) => c.run(() => {}))
			.run(() => {});
		expect(() => walkCommandNode(cli._node)).toThrow(/invalid command name/);
	});

	it("rejects flag names with shell metacharacters", () => {
		const cli = new Crust("bad").flags({ "a;rm": { type: "boolean" } } as never).run(() => {});
		expect(() => walkCommandNode(cli._node)).toThrow(/invalid flag name/);
	});

	it("rejects choice values containing spaces", () => {
		const cli = new Crust("bad")
			.flags({
				target: {
					type: "string",
					choices: ["a", "two words", "c"],
				},
			})
			.run(() => {});
		expect(() => walkCommandNode(cli._node)).toThrow(/unsupported choice value/);
	});

	it("rejects choice values containing single quotes", () => {
		const cli = new Crust("bad")
			.flags({
				target: { type: "string", choices: ["a", "it's", "c"] },
			})
			.run(() => {});
		expect(() => walkCommandNode(cli._node)).toThrow(/unsupported choice value/);
	});

	it("strips control characters from descriptions instead of throwing", () => {
		const cli = new Crust("safe")
			.meta({ description: "first line\nsecond line\rstill same line" })
			.run(() => {});
		const spec = walkCommandNode(cli._node);
		// Newlines and CR collapse to spaces during normalisation.
		expect(spec.root.description).toBe("first line second line still same line");
		// And the value never contains a raw newline that could break
		// out of an emitted comment line.
		expect(spec.root.description).not.toMatch(/[\r\n]/);
	});
});

// ── Comment/header injection ─────────────────────────────────────────────

describe("renderBash / renderZsh / renderFish · header injection", () => {
	const minimal: CompletionSpec = {
		root: { name: "x", flags: [], args: [], subCommands: [] },
	};

	it.each([
		["bash", renderBash],
		["zsh", renderZsh],
		["fish", renderFish],
	] as const)(
		"%s strips newlines from `version` so the header stays a single comment line",
		(_shell, render) => {
			// Without sanitisation, an embedded `\n` would terminate the
			// `# ...` comment line and turn the rest into executable shell
			// when the script is `eval`'d (the documented install path). The
			// invariant we care about is: the embedded text remains *inside*
			// the comment line, not that the textual payload disappears
			// (the textual payload is inert because it's commented out).
			const evil = "1.0\necho ATTACK #";
			const out = render(minimal, "x", evil);
			const headerLine = out.split("\n").find((l) => l.includes("v1.0"));
			expect(headerLine).toBeDefined();
			// The full payload is on the *same* line as `v1.0` (i.e. inside
			// the comment), not on a follow-up line.
			expect(headerLine).toContain("ATTACK");
			// And no second comment-less line containing `echo ATTACK` exists
			// (which would happen if the newline survived).
			const nonCommentLines = out
				.split("\n")
				.filter((l) => l.length > 0 && !l.startsWith("#"))
				.filter((l) => l.includes("ATTACK"));
			expect(nonCommentLines).toEqual([]);
		},
	);
});

// ── --no- negation ───────────────────────────────────────────────────────

describe("--no- negation", () => {
	const spec: CompletionSpec = {
		root: {
			name: "mycli",
			flags: [
				{ name: "force", type: "boolean", takesValue: false },
				{
					name: "color",
					type: "boolean",
					takesValue: false,
					noNegate: true,
				},
			],
			args: [],
			subCommands: [],
		},
	};

	it("bash: emits --no-<name> for negatable boolean flags", () => {
		const out = renderBash(spec, "mycli", "1");
		expect(out).toContain("--no-force");
		// `noNegate` flag has its negation suppressed.
		expect(out).not.toContain("--no-color");
	});

	it("zsh: emits --no-<name> as a separate spec", () => {
		const out = renderZsh(spec, "mycli", "1");
		expect(out).toContain("--no-force");
		expect(out).not.toContain("--no-color");
	});

	it("fish: emits --no-<name> as its own complete rule", () => {
		const out = renderFish(spec, "mycli", "1");
		expect(out).toMatch(/-l 'no-force'/);
		expect(out).not.toMatch(/-l 'no-color'/);
	});
});

// ── bash behaviour: -- terminator + --name=value + value-flag context ────

describe("renderBash · behavioural · -- and --name=value", () => {
	const spec: CompletionSpec = {
		root: {
			name: "mycli",
			flags: [],
			args: [],
			subCommands: [
				{
					name: "build",
					flags: [
						{
							name: "target",
							type: "string",
							takesValue: true,
							choices: ["browser", "node"],
						},
						{ name: "out", type: "string", takesValue: true },
					],
					args: [],
					subCommands: [],
				},
			],
		},
	};

	let scriptPath: string;
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "tp010-bash-adv-"));
		scriptPath = join(tmpDir, "mycli-completion.bash");
		await Bun.write(scriptPath, renderBash(spec, "mycli", "1"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	async function complete(words: string[]): Promise<string[]> {
		const compWords = words.map((w, i) => `COMP_WORDS[${i}]=${shq(w)}`).join("\n");
		const cword = words.length - 1;
		const driver = `
set -e
source ${shq(scriptPath)}
${compWords}
COMP_CWORD=${cword}
COMP_LINE=${shq(words.join(" "))}
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
			throw new Error(`bash exit ${code}\n${err}\n${out}`);
		}
		return out
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.length > 0)
			.sort();
	}
	function shq(value: string): string {
		return `'${value.replace(/'/g, `'\\''`)}'`;
	}

	it("`--name=value` form completes the value's choice list", async () => {
		const candidates = await complete(["mycli", "build", "--target=br"]);
		// Bash sees one current token `--target=br`; the script splits on
		// `=` and offers the choices that match prefix `br`.
		expect(candidates).toContain("--target=browser");
		expect(candidates).not.toContain("--target=node");
	});

	it("after `--`, no subcommand or flag candidates are offered", async () => {
		const candidates = await complete(["mycli", "build", "--", ""]);
		// Past the `--` terminator we return without setting COMPREPLY,
		// so the candidate set is empty (filename completion happens via
		// `complete -o default` at the bash level).
		expect(candidates).toEqual([]);
	});

	it("after a free-form value flag, no subcommand candidates are offered", async () => {
		// `--out` is a value-taking flag with no choices; the next word
		// is a free-form value, not a subcommand.
		const candidates = await complete(["mycli", "build", "--out", ""]);
		expect(candidates).toEqual([]);
	});
});

// ── --output-dir traversal ───────────────────────────────────────────────

describe("completionPlugin · --output-dir traversal", () => {
	let stdoutBuf: Buffer[];
	let originalWrite: typeof process.stdout.write;
	let originalError: typeof console.error;
	let originalExitCode: typeof process.exitCode;

	beforeEach(() => {
		stdoutBuf = [];
		originalWrite = process.stdout.write.bind(process.stdout);
		originalError = console.error;
		originalExitCode = process.exitCode;
		process.stdout.write = ((chunk: unknown) => {
			if (typeof chunk === "string") {
				stdoutBuf.push(Buffer.from(chunk, "utf8"));
			} else if (chunk instanceof Uint8Array) {
				stdoutBuf.push(Buffer.from(chunk));
			}
			return true;
		}) as typeof process.stdout.write;
		console.error = () => {};
	});

	afterEach(() => {
		process.stdout.write = originalWrite;
		console.error = originalError;
		process.exitCode = originalExitCode;
	});

	it("rejects a binName containing path separators at setup time", async () => {
		// `binName` validation runs during the plugin's `setup()`. Crust
		// catches setup errors and reports them via stderr + exitCode=1,
		// rather than rethrowing, so we observe both side-effects to
		// confirm the error fired before any file could be written.
		const stderrChunks: string[] = [];
		const origError = console.error;
		console.error = (...args: unknown[]) => {
			stderrChunks.push(args.map((a) => String(a)).join(" "));
		};
		try {
			const cli = new Crust("real").use(completionPlugin({ binName: "../pwn" })).run(() => {});
			await cli.execute({ argv: ["completion", "bash"] });
		} finally {
			console.error = origError;
		}
		expect(stderrChunks.join("\n")).toMatch(/invalid binName/);
		expect(process.exitCode).toBe(1);
	});

	it("does not write outside --output-dir", async () => {
		// Even if validation were bypassed, the plugin's resolved-path
		// check would refuse to write outside `targetDir`. We test the
		// happy path here: a normal binName lands inside the target dir
		// and nothing escapes.
		const tmp = await mkdtemp(join(tmpdir(), "tp010-traversal-"));
		try {
			const cli = new Crust("good").use(completionPlugin({ version: "1" })).run(() => {});
			await cli.execute({
				argv: ["completion", "bash", "--output-dir", tmp],
			});
			const entries = await readdir(tmp);
			// Exactly the per-shell files for `good`, nothing else.
			expect(entries.sort()).toEqual(["_good", "good", "good.fish"]);
			// Files are non-empty and contain the expected header.
			const head = await readFile(join(tmp, "good"), "utf8");
			expect(head).toContain("# completion script for good v1");
		} finally {
			await rm(tmp, { recursive: true, force: true });
		}
	});
});

// ── fish · ordered path predicate behaviour ───────────────────────────────

describe("renderFish · ordered subcommand predicate", () => {
	const spec: CompletionSpec = {
		root: {
			name: "mycli",
			flags: [],
			args: [],
			subCommands: [
				{
					name: "build",
					flags: [],
					args: [],
					subCommands: [
						{
							name: "deploy", // same word at depth 2 and depth 1 below
							flags: [{ name: "fast", type: "boolean", takesValue: false }],
							args: [],
							subCommands: [],
						},
					],
				},
				{
					name: "deploy", // depth-1 deploy
					flags: [{ name: "slow", type: "boolean", takesValue: false }],
					args: [],
					subCommands: [],
				},
			],
		},
	};

	it("emits a path-walking helper that only matches the in-order canonical path", () => {
		const out = renderFish(spec, "mycli", "1");
		// One helper, used by both the build subcmd and its child.
		expect(out).toContain("function __mycli_path_is");
		// build's `deploy` child is gated on the depth-2 path
		// `[build, deploy]`, NOT on `seen_subcommand_from deploy`. The
		// relevant rule includes `'build'` then `'deploy'` then a leaf
		// block (empty for the leaf).
		expect(out).toMatch(/-n '__mycli_path_is \\'build\\' \\'deploy\\' \\'\\''.*-l 'fast'/);
		// Top-level deploy's `slow` flag is gated on the depth-1 path
		// `[deploy]`. Its block is empty (no children).
		expect(out).toMatch(/-n '__mycli_path_is \\'deploy\\' \\'\\''.*-l 'slow'/);
	});
});
