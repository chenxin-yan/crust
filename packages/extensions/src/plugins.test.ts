import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { stripVTControlCharacters } from "node:util";

import { Crust, defineCommand, defineExtension } from "@crustjs/core";
import { snapshotCommand } from "@crustjs/core/tooling";

import { helpExtension, renderHelp } from "./help.ts";
import { noColorExtension } from "./no-color.ts";
import { versionExtension } from "./version.ts";

let stdoutChunks: string[];
let stderrChunks: string[];
let originalLog: typeof console.log;
let originalError: typeof console.error;

beforeEach(() => {
	// Ambient NO_COLOR/FORCE_COLOR (e.g. CI runners) must not leak into the
	// color-flag tests; afterEach restores the ambient values.
	delete process.env.NO_COLOR;
	delete process.env.FORCE_COLOR;
	stdoutChunks = [];
	stderrChunks = [];
	originalLog = console.log;
	originalError = console.error;

	console.log = (...args: unknown[]) => {
		stdoutChunks.push(args.map((arg) => String(arg)).join(" "));
	};
	console.error = (...args: unknown[]) => {
		stderrChunks.push(args.map((arg) => String(arg)).join(" "));
	};
});

const originalForceColor = process.env.FORCE_COLOR;
const originalNoColor = process.env.NO_COLOR;
const originalStdoutIsTTY = process.stdout.isTTY;

function restoreEnv(name: string, value: string | undefined) {
	if (value === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
}

afterEach(() => {
	console.log = originalLog;
	console.error = originalError;
	process.exitCode = 0;
	restoreEnv("FORCE_COLOR", originalForceColor);
	restoreEnv("NO_COLOR", originalNoColor);
	Object.defineProperty(process.stdout, "isTTY", {
		configurable: true,
		value: originalStdoutIsTTY,
	});
});

function getStdout() {
	return stdoutChunks.join("\n");
}

function getStderr() {
	return stderrChunks.join("\n");
}

const stripAnsi = stripVTControlCharacters;

function lateSkillExtension() {
	return defineExtension("late-skill", {
		commands: [
			defineCommand("skill", (command) =>
				command
					.meta({ description: "Manage agent skills" })
					.mount(
						defineCommand("update", (cmd) =>
							cmd.meta({ description: "Update installed skills" }).handle(() => {}),
						),
					)
					.handle(() => {}),
			),
		],
	});
}

describe("built-in plugins", () => {
	it("renderHelp styles sections and preserves plain-text structure", () => {
		// Force colors on so the ANSI assertion is deterministic in non-TTY
		// test environments (e.g. CI). Reset via afterEach.
		process.env.FORCE_COLOR = "3";

		const command = new Crust("app")
			.meta({ description: "Test app" })
			.flags(
				{
					name: "verbose",
					type: "boolean",
					short: "v",
					description: "Enable verbose logging",
					default: true,
				},
				{
					name: "port",
					type: "number",
					description: "Port number",
					default: 3000,
				},
			)
			.args({
				name: "dir",
				type: "string",
				description: "Output directory",
				default: ".",
			})
			.mount(defineCommand("build", (cmd) => cmd.meta({ description: "Build the project" })))._node;

		const output = renderHelp(snapshotCommand(command));
		const plain = stripAnsi(output);

		expect(output).toContain("\x1b[");
		expect(plain).toContain("USAGE:");
		expect(plain).toContain("COMMANDS:");
		expect(plain).toContain("ARGS:");
		expect(plain).toContain("OPTIONS:");
		expect(plain).toContain("-v, --verbose, --no-verbose");
		expect(plain).toContain("[default: true]");
		expect(plain).toContain("[default: 3000]");
		expect(plain).toContain('[default: "."]');
	});

	it("renderHelp shows canonical boolean negation instead of negated aliases", () => {
		const command = new Crust("app").flags({
			name: "verbose",
			type: "boolean",
			aliases: ["loud"],
		})._node;

		const output = stripAnsi(renderHelp(snapshotCommand(command)));
		expect(output).toContain("--verbose, --no-verbose");
		expect(output).not.toContain("--no-loud");
	});

	it("renderHelp hides negation labels when noNegate is set", () => {
		const command = new Crust("app").flags({
			name: "help",
			type: "boolean",
			short: "h",
			noNegate: true,
		})._node;

		const output = stripAnsi(renderHelp(snapshotCommand(command)));
		expect(output).toContain("-h, --help");
		expect(output).not.toContain("--no-help");
	});

	it("renderHelp keeps stripped columns aligned with styled labels", () => {
		const command = new Crust("app")
			.flags(
				{
					name: "verbose",
					type: "boolean",
					short: "v",
					description: "Enable verbose logging",
					default: true,
				},
				{
					name: "port",
					type: "number",
					short: "p",
					description: "Port number",
					default: 3000,
				},
			)
			.args({
				name: "dir",
				type: "string",
				description: "Output directory",
				default: ".",
			})._node;

		const lines = stripAnsi(renderHelp(snapshotCommand(command))).split("\n");

		const verboseLine = lines.find((line) => line.includes("--verbose"));
		const portLine = lines.find((line) => line.includes("--port"));

		expect(verboseLine).toBeDefined();
		expect(portLine).toBeDefined();
		expect(verboseLine?.indexOf("Enable verbose logging")).toBe(portLine?.indexOf("Port number"));
		expect(lines).toContain('  [dir]              Output directory [default: "."]');
	});

	it("renderHelp preserves non-finite numeric defaults", () => {
		const command = new Crust("app").flags({
			name: "timeout",
			type: "number",
			default: Infinity,
		})._node;

		const output = stripAnsi(renderHelp(snapshotCommand(command)));
		expect(output).toContain("[default: Infinity]");
		expect(output).not.toContain("[default: null]");
	});

	it("help plugin renders generated help for no-run command", async () => {
		const app = new Crust("app")
			.extend(helpExtension())
			.mount(defineCommand("build", (cmd) => cmd.handle(() => {})));

		await app.execute({ argv: ["--help"] });

		const output = stripAnsi(getStdout());
		expect(output).toContain("app");
		expect(output).toContain("USAGE:");
		expect(output).toContain("COMMANDS:");
		expect(output).toContain("build");
		expect(output).toContain("-h, --help");
		expect(output).not.toContain("--no-help");
	});

	it("noColorExtension injects --color and --no-color into help output", async () => {
		const app = new Crust("app")
			.extend(noColorExtension())
			.extend(helpExtension())
			.mount(defineCommand("build", (cmd) => cmd.handle(() => {})));

		await app.execute({ argv: ["--help"] });

		const output = stripAnsi(getStdout());
		expect(output).toContain("--color, --no-color");
	});

	it("noColorExtension disables color but preserves modifiers on a TTY", async () => {
		// `--no-color` → NO_COLOR=1: colors off, modifiers keep following
		// TTY detection (no-color.org). Mock a TTY so the modifier half of
		// the contract is observable regardless of the test runner's stdout.
		Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
		const app = new Crust("app").extend(noColorExtension()).extend(helpExtension());

		await app.execute({ argv: ["--help", "--no-color"] });

		const output = getStdout();
		expect(output).not.toContain("\x1b[36m");
		expect(output).not.toContain("\x1b[33m");
		expect(output).toContain("\x1b[1mUSAGE:\x1b[22m");
	});

	it("noColorExtension overrides NO_COLOR with --color", async () => {
		const previousNoColor = process.env.NO_COLOR;
		process.env.NO_COLOR = "1";

		try {
			const app = new Crust("app").extend(noColorExtension()).extend(helpExtension());

			await app.execute({ argv: ["--help", "--color"] });

			const output = getStdout();
			expect(output).toContain("\x1b[36m");
			expect(output).toContain("\x1b[1m");
		} finally {
			if (previousNoColor === undefined) {
				delete process.env.NO_COLOR;
			} else {
				process.env.NO_COLOR = previousNoColor;
			}
		}
	});

	it("noColorExtension --color clears NO_COLOR during the run and restores it after", async () => {
		process.env.NO_COLOR = "1";
		let seenNoColor: string | undefined = "unset";

		const app = new Crust("app").extend(noColorExtension()).handle(() => {
			seenNoColor = process.env.NO_COLOR;
		});

		await app.execute({ argv: ["--color"] });

		expect(seenNoColor).toBeUndefined();
		expect(process.env.NO_COLOR).toBe("1");
	});

	it("noColorExtension restores ambient env after overlapping runs with opposite flags", async () => {
		const ambientForceColor = process.env.FORCE_COLOR;
		const ambientNoColor = process.env.NO_COLOR;
		delete process.env.FORCE_COLOR;
		delete process.env.NO_COLOR;

		let releaseA: () => void = () => {};
		const blockA = new Promise<void>((resolve) => {
			releaseA = resolve;
		});

		const appA = new Crust("a").extend(noColorExtension()).handle(() => blockA);
		const appB = new Crust("b").extend(noColorExtension()).handle(() => {});

		// A (--color) starts and stays pending; B (--no-color) starts and
		// finishes while A is mid-run, then A completes.
		const runA = appA.execute({ argv: ["--color"] });
		await appB.execute({ argv: ["--no-color"] });
		releaseA();
		await runA;

		expect(process.env.FORCE_COLOR).toBeUndefined();
		expect(process.env.NO_COLOR).toBeUndefined();

		if (ambientForceColor !== undefined) process.env.FORCE_COLOR = ambientForceColor;
		if (ambientNoColor !== undefined) process.env.NO_COLOR = ambientNoColor;
	});

	it("noColorExtension respects NO_COLOR without explicit --color flag", async () => {
		const previousNoColor = process.env.NO_COLOR;
		process.env.NO_COLOR = "1";

		try {
			const app = new Crust("app").extend(noColorExtension()).extend(helpExtension());

			await app.execute({ argv: ["--help"] });

			const output = getStdout();
			expect(output).not.toContain("\x1b[36m");
			expect(output).not.toContain("\x1b[33m");
		} finally {
			if (previousNoColor === undefined) {
				delete process.env.NO_COLOR;
			} else {
				process.env.NO_COLOR = previousNoColor;
			}
		}
	});

	it("noColorExtension restores the prior env after the command", async () => {
		process.env.FORCE_COLOR = "3";
		delete process.env.NO_COLOR;

		const app = new Crust("app").extend(noColorExtension()).extend(helpExtension());

		await app.execute({ argv: ["--help", "--no-color"] });

		expect(process.env.FORCE_COLOR).toBe("3");
		expect(process.env.NO_COLOR).toBeUndefined();
	});

	it("noColorExtension --no-color wins over ambient FORCE_COLOR", async () => {
		process.env.FORCE_COLOR = "3";

		const app = new Crust("app").extend(noColorExtension()).extend(helpExtension());

		await app.execute({ argv: ["--help", "--no-color"] });

		const output = getStdout();
		expect(output).not.toContain("\x1b[36m");
		expect(output).not.toContain("\x1b[33m");
	});

	it("noColorExtension flag is inherited by subcommands", async () => {
		const app = new Crust("app")
			.extend(noColorExtension())
			.extend(helpExtension())
			.mount(defineCommand("build", (cmd) => cmd.handle(() => {})));

		await app.execute({ argv: ["build", "--help"] });

		const output = stripAnsi(getStdout());
		expect(output).toContain("--color, --no-color");
	});

	it("help plugin shows help instead of error when --help is used with missing required arg", async () => {
		const app = new Crust("app")
			.extend(helpExtension())
			.mount(
				defineCommand("create", (cmd) =>
					cmd.args({ name: "name", type: "string", required: true }).handle(() => {}),
				),
			);

		await app.execute({ argv: ["create", "--help"] });

		const output = stripAnsi(getStdout());
		expect(output).toContain("create");
		expect(output).toContain("USAGE:");
		expect(getStderr()).toBe("");
		expect(process.exitCode).toBeFalsy();
	});

	it("help plugin shows help instead of error when --help is used with missing required flag", async () => {
		const app = new Crust("app")
			.extend(helpExtension())
			.mount(
				defineCommand("deploy", (cmd) =>
					cmd.flags({ name: "target", type: "string", required: true }).handle(() => {}),
				),
			);

		await app.execute({ argv: ["deploy", "--help"] });

		const output = stripAnsi(getStdout());
		expect(output).toContain("deploy");
		expect(output).toContain("USAGE:");
		expect(getStderr()).toBe("");
		expect(process.exitCode).toBeFalsy();
	});

	it("help plugin ignores help-like args after --", async () => {
		let capturedRawArgs: string[] = [];

		const app = new Crust("app")
			.meta({ description: "Test app" })
			.extend(helpExtension())
			.mount(
				defineCommand("build", (cmd) =>
					cmd.handle((ctx) => {
						capturedRawArgs = [...ctx.rawArgs];
					}),
				),
			);

		await app.execute({ argv: ["build", "--", "--help"] });

		expect(getStdout()).toBe("");
		expect(capturedRawArgs).toEqual(["--help"]);
	});

	it("help plugin supports subcommands injected after its setup", async () => {
		const app = new Crust("app")
			.extend(helpExtension())
			.extend(lateSkillExtension())
			.handle(() => {});

		await app.execute({ argv: ["skill", "--help"] });

		expect(stripAnsi(getStdout())).toContain("Manage agent skills");
		expect(stripAnsi(getStdout())).toContain("--help");
		expect(getStderr()).toBe("");
		expect(process.exitCode).toBeFalsy();
	});

	it("help plugin supports nested subcommands injected after its setup", async () => {
		const app = new Crust("app")
			.extend(helpExtension())
			.extend(lateSkillExtension())
			.handle(() => {});

		await app.execute({ argv: ["skill", "update", "--help"] });

		expect(stripAnsi(getStdout())).toContain("Update installed skills");
		expect(stripAnsi(getStdout())).toContain("--help");
		expect(getStderr()).toBe("");
		expect(process.exitCode).toBeFalsy();
	});

	it("help plugin supports subcommands injected before its setup", async () => {
		const app = new Crust("app")
			.extend(lateSkillExtension())
			.extend(helpExtension())
			.handle(() => {});

		await app.execute({ argv: ["skill", "--help"] });

		expect(stripAnsi(getStdout())).toContain("Manage agent skills");
		expect(stripAnsi(getStdout())).toContain("--help");
		expect(getStderr()).toBe("");
		expect(process.exitCode).toBeFalsy();
	});

	it("version plugin handles --version", async () => {
		const app = new Crust("app").extend(versionExtension("1.2.3")).handle(() => {});

		await app.execute({ argv: ["--version"] });

		expect(getStdout()).toContain("app v1.2.3");
	});

	it("version plugin handles -v alias", async () => {
		const app = new Crust("app").extend(versionExtension("2.0.0")).handle(() => {});

		await app.execute({ argv: ["-v"] });

		expect(getStdout()).toContain("app v2.0.0");
	});

	it("version plugin ignores --version after -- separator", async () => {
		let ran = false;

		const app = new Crust("app").extend(versionExtension("1.0.0")).handle(() => {
			ran = true;
		});

		await app.execute({ argv: ["--", "--version"] });

		expect(getStdout()).toBe("");
		expect(ran).toBe(true);
	});

	it("version plugin only triggers on root command", async () => {
		let ran = false;

		const app = new Crust("app").extend(versionExtension("1.0.0")).mount(
			defineCommand("build", (cmd) =>
				cmd.handle(() => {
					ran = true;
				}),
			),
		);

		await app.execute({ argv: ["build"] });

		expect(getStdout()).toBe("");
		expect(ran).toBe(true);
	});

	it("version plugin flag appears in help output", async () => {
		const app = new Crust("app")
			.meta({ description: "Test app" })
			.extend(versionExtension("1.0.0"))
			.extend(helpExtension())
			.handle(() => {});

		await app.execute({ argv: ["--help"] });

		const output = stripAnsi(getStdout());
		expect(output).toContain("--version");
		expect(output).toContain("Show version number");
	});

	it("version plugin with function value", async () => {
		const app = new Crust("app").extend(versionExtension(() => "3.5.0")).handle(() => {});

		await app.execute({ argv: ["--version"] });

		expect(getStdout()).toContain("app v3.5.0");
	});

	// ──────────────────────────────────────────────────────────────────────────────
	// helpExtension alias rendering
	// ──────────────────────────────────────────────────────────────────────────────

	it("renderHelp renders aliases inline next to the canonical command name", () => {
		const command = new Crust("app").mount(
			defineCommand("issue", (cmd) =>
				cmd
					.meta({
						description: "Manage issues",
						aliases: ["issues", "i"],
					})
					.handle(() => {}),
			),
		)._node;

		const plain = stripAnsi(renderHelp(snapshotCommand(command)));
		expect(plain).toContain("COMMANDS:");
		expect(plain).toContain("issue (issues, i)");
		expect(plain).toContain("Manage issues");
	});

	it("renderHelp renders unchanged for a command without aliases", () => {
		const command = new Crust("app").mount(
			defineCommand("build", (cmd) =>
				cmd.meta({ description: "Build the project" }).handle(() => {}),
			),
		)._node;

		const plain = stripAnsi(renderHelp(snapshotCommand(command)));
		expect(plain).toContain("COMMANDS:");
		expect(plain).toContain("build");
		// No parens means no aliases were rendered.
		expect(plain).not.toMatch(/build\s*\(/);
	});

	it("renderHelp keeps description column aligned when aliases overflow the column", () => {
		const command = new Crust("app")
			.mount(
				defineCommand("issue", (cmd) =>
					cmd
						.meta({
							description: "Manage issues",
							aliases: ["issues", "i"],
						})
						.handle(() => {}),
				),
			)
			.mount(
				defineCommand("build", (cmd) =>
					cmd.meta({ description: "Build the project" }).handle(() => {}),
				),
			)._node;

		const lines = stripAnsi(renderHelp(snapshotCommand(command))).split("\n");
		const issueLine = lines.find((line) => line.includes("issue (issues, i)"));
		const buildLine = lines.find((line) => line.match(/^\s+build\s+Build the project$/));

		expect(issueLine).toBeDefined();
		expect(buildLine).toBeDefined();
		// Description still appears on the same line, just after the overflowing label.
		expect(issueLine).toContain("Manage issues");
	});

	// ──────────────────────────────────────────────────────────────────────
	// helpExtension hidden subcommand filtering
	// ──────────────────────────────────────────────────────────────────────

	it("renderHelp omits subcommands marked meta.hidden: true", () => {
		const command = new Crust("app")
			.mount(
				defineCommand("build", (cmd) =>
					cmd.meta({ description: "Build the project" }).handle(() => {}),
				),
			)
			.mount(
				defineCommand("__complete", (cmd) =>
					cmd
						.meta({
							description: "Internal completion entrypoint",
							hidden: true,
						})
						.handle(() => {}),
				),
			)._node;

		const plain = stripAnsi(renderHelp(snapshotCommand(command)));
		expect(plain).toContain("COMMANDS:");
		expect(plain).toContain("build");
		expect(plain).not.toContain("__complete");
		expect(plain).not.toContain("Internal completion entrypoint");
	});

	it("renderHelp omits the COMMANDS section when every subcommand is hidden", () => {
		const command = new Crust("app")
			.mount(
				defineCommand("__complete", (cmd) =>
					cmd.meta({ hidden: true, description: "Internal" }).handle(() => {}),
				),
			)
			.handle(() => {})._node;

		const plain = stripAnsi(renderHelp(snapshotCommand(command)));
		expect(plain).not.toContain("COMMANDS:");
		expect(plain).not.toContain("__complete");
	});

	it("renderHelp omits the `<command>` USAGE token when every subcommand is hidden and parent has no run handler", () => {
		// Regression: formatUsage previously counted hidden subcommands when
		// deciding whether to emit `<command>`, producing the incoherent
		// `USAGE: app <command>` with no COMMANDS section below it.
		const command = new Crust("app").mount(
			defineCommand("__complete", (cmd) =>
				cmd.meta({ hidden: true, description: "Internal" }).handle(() => {}),
			),
		)._node;

		const plain = stripAnsi(renderHelp(snapshotCommand(command)));
		expect(plain).toContain("USAGE:");
		expect(plain).not.toMatch(/USAGE:\s+app\s+<command>/);
		expect(plain).not.toContain("COMMANDS:");
		expect(plain).not.toContain("__complete");
	});

	it("renderHelp hidden filtering composes with alias rendering", () => {
		// A hidden subcommand with aliases should be entirely absent. A visible
		// subcommand with aliases should still render `name (a, b)`.
		const command = new Crust("app")
			.mount(
				defineCommand("issue", (cmd) =>
					cmd.meta({ description: "Manage issues", aliases: ["issues", "i"] }).handle(() => {}),
				),
			)
			.mount(
				defineCommand("__complete", (cmd) =>
					cmd
						.meta({
							description: "Internal",
							aliases: ["__c"],
							hidden: true,
						})
						.handle(() => {}),
				),
			)._node;

		const plain = stripAnsi(renderHelp(snapshotCommand(command)));
		expect(plain).toContain("issue (issues, i)");
		expect(plain).toContain("Manage issues");
		expect(plain).not.toContain("__complete");
		expect(plain).not.toContain("__c");
	});

	it("hidden subcommands remain invocable by direct name", async () => {
		let didRun = false;
		const app = new Crust("app")
			.extend(helpExtension())
			.mount(
				defineCommand("build", (cmd) =>
					cmd.meta({ description: "Build the project" }).handle(() => {}),
				),
			)
			.mount(
				defineCommand("__complete", (cmd) =>
					cmd.meta({ hidden: true, description: "Internal" }).handle(() => {
						didRun = true;
					}),
				),
			);

		await app.execute({ argv: ["__complete"] });
		expect(didRun).toBe(true);
	});

	it("renderHelp surfaces flag `choices` as a `[choices: ...]` suffix", () => {
		// The choices list is declared on the flag definition;
		// `helpExtension` must surface it so users can discover the valid
		// values from `--help` without resorting to shell completion or
		// reading the source.
		const command = new Crust("app")
			.meta({ description: "Build artifact" })
			.flags({
				name: "target",
				type: "string",
				choices: ["browser", "bun", "node"],
				description: "Build target",
			})
			.handle(() => {})._node;
		const plain = stripAnsi(renderHelp(snapshotCommand(command)));
		expect(plain).toContain("--target");
		expect(plain).toContain("Build target");
		expect(plain).toContain("[choices: browser, bun, node]");
	});

	it("renderHelp surfaces positional-arg `choices` in the ARGS section", () => {
		const command = new Crust("app")
			.meta({ description: "Deploy to an env" })
			.args({
				name: "env",
				type: "string",
				required: true,
				choices: ["dev", "staging", "prod"],
				description: "Target environment",
			})
			.handle(() => {})._node;
		const plain = stripAnsi(renderHelp(snapshotCommand(command)));
		// The ARGS section heading is the marker the rest of the
		// assertions hang off; without it the test would silently miss
		// rendering bugs that drop the section entirely.
		expect(plain).toContain("ARGS:");
		expect(plain).toContain("<env>");
		expect(plain).toContain("[choices: dev, staging, prod]");
	});

	it("renderHelp composes `[default: ...]` and `[choices: ...]` when both are present", () => {
		const command = new Crust("app")
			.flags({
				name: "target",
				type: "string",
				choices: ["a", "b"],
				default: "a",
				description: "Build target",
			})
			.handle(() => {})._node;
		const plain = stripAnsi(renderHelp(snapshotCommand(command)));
		// Both suffixes appear on the same flag line, in this order, so the
		// `[default: ...]` reads before `[choices: ...]`.
		const targetLine = plain.split("\n").find((l) => l.includes("--target"));
		expect(targetLine).toBeDefined();
		expect(targetLine).toContain('[default: "a"]');
		expect(targetLine).toContain("[choices: a, b]");
		expect((targetLine as string).indexOf("[default:")).toBeLessThan(
			(targetLine as string).indexOf("[choices:"),
		);
	});
});
