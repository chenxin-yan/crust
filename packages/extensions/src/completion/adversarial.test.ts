import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust, defineCommand } from "@crustjs/core";
import { buildCommandDocumentation } from "@crustjs/core/tooling";
import { captureExecute } from "@crustjs/testing";
import { describe, expect, it } from "vite-plus/test";

import { completion } from "./index.ts";
import type { CompletionCommand } from "./spec.ts";
import { renderFish } from "./templates/fish.ts";
import { renderZsh } from "./templates/zsh.ts";
import { walkCommand } from "./walker.ts";

/**
 * Adversarial test suite. These tests exercise the validation/escape
 * boundary that protects the generated shell scripts from injection,
 * zsh `--no-` spellings, the order-sensitive fish path predicate, and
 * `--output-dir` traversal. Bash `--`/`--name=value` behaviour lives in
 * `templates/bash.test.ts`, beside the bash completion driver.
 */

// ── Walker validation ────────────────────────────────────────────────────

describe("walker · validation", () => {
	it("rejects command names containing whitespace", async () => {
		const cli = new Crust("bad")
			.add(defineCommand("ok", (c) => c.action(() => {})))
			.action(() => {});
		const snapshot = await cli.snapshot();
		const ok = snapshot.subCommands.ok!;
		// Core rejects this name; the walker still guards snapshots that come from elsewhere.
		const model = buildCommandDocumentation({
			...snapshot,
			subCommands: { "two words": { ...ok, meta: { ...ok.meta, name: "two words" } } },
		});
		expect(() => walkCommand(model)).toThrow(/invalid command name/);
	});

	it("rejects flag names with shell metacharacters", async () => {
		const cli = new Crust("bad").flags({ "a;rm": { type: "boolean" } }).action(() => {});
		const model = buildCommandDocumentation(await cli.snapshot());
		expect(() => walkCommand(model)).toThrow(/invalid flag name/);
	});

	it("rejects choice values containing spaces", async () => {
		const cli = new Crust("bad")
			.flags({
				target: {
					type: "string",
					choices: ["a", "two words", "c"],
				},
			})
			.action(() => {});
		const model = buildCommandDocumentation(await cli.snapshot());
		expect(() => walkCommand(model)).toThrow(/unsupported choice value/);
	});

	it("strips control characters from descriptions instead of throwing", async () => {
		const cli = new Crust("safe", {
			description: "first line\nsecond line\rstill same line",
		}).action(() => {});
		const spec = walkCommand(buildCommandDocumentation(await cli.snapshot()));
		// Newlines and CR collapse to spaces, so no raw newline can break
		// out of an emitted comment line.
		expect(spec.description).toBe("first line second line still same line");
	});
});

// ── --no- negation ───────────────────────────────────────────────────────

describe("--no- negation", () => {
	const spec: CompletionCommand = {
		name: "mycli",
		flags: [
			{ name: "force", spellings: ["--force", "--no-force"], type: "boolean", takesValue: false },
			{
				name: "color",
				spellings: ["--color"],
				type: "boolean",
				takesValue: false,
			},
		],
		args: [],
		subCommands: [],
	};

	it("zsh: emits --no-<name> as a separate spec", async () => {
		const out = renderZsh(spec, "mycli", "1");
		expect(out).toContain("--no-force");
		expect(out).not.toContain("--no-color");
	});
});

// ── --output-dir traversal ───────────────────────────────────────────────

describe("completion · --output-dir traversal", () => {
	it("rejects a root name containing path separators before rendering or writing files", async () => {
		const root = await mkdtemp(join(tmpdir(), "completion-traversal-"));
		const outputDir = join(root, "completions");
		try {
			const cli = new Crust("../pwn", { version: "1.0.0" }).extend(completion()).action(() => {});
			for (const argv of [
				["completion", "bash"],
				["completion", "bash", "--output-dir", outputDir],
			]) {
				const { stderr, exitCode } = await captureExecute(cli, argv);
				expect(stderr).toMatch(/invalid root command name/);
				expect(exitCode).toBe(1);
				// Neither the output directory nor a path-traversing sibling should be written.
				expect(await readdir(root)).toEqual([]);
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

// ── fish · ordered path predicate behaviour ───────────────────────────────

describe("renderFish · ordered subcommand predicate", () => {
	const spec: CompletionCommand = {
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
						flags: [{ name: "fast", spellings: ["--fast"], type: "boolean", takesValue: false }],
						args: [],
						subCommands: [],
					},
				],
			},
			{
				name: "deploy", // depth-1 deploy
				flags: [{ name: "slow", spellings: ["--slow"], type: "boolean", takesValue: false }],
				args: [],
				subCommands: [],
			},
		],
	};

	it("emits a path-walking helper that only matches the in-order canonical path", async () => {
		const out = renderFish(spec, "mycli", "1");
		// One helper, used by both the build subcmd and its child.
		expect(out).toContain("function __mycli_path_at_arg");
		// build's `deploy` child is gated on the depth-2 path
		// `[build, deploy]`, NOT on `seen_subcommand_from deploy`. The
		// relevant rule includes `'build'` then `'deploy'` then a leaf
		// block (empty for the leaf).
		expect(out).toMatch(
			/-n '__mycli_path_at_arg \\'build\\' \\'deploy\\' \\'\*0\\' \\'\\''.*-l 'fast'/,
		);
		// Top-level deploy's `slow` flag is gated on the depth-1 path
		// `[deploy]`. Its block is empty (no children).
		expect(out).toMatch(/-n '__mycli_path_at_arg \\'deploy\\' \\'\*0\\' \\'\\''.*-l 'slow'/);
	});
});
