import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { stripVTControlCharacters } from "node:util";

import {
	Crust,
	defineCommand,
	defineContext,
	defineExtension,
	defineExtensionId,
	defineFlag,
} from "@crustjs/core";

import { completion } from "./completion/index.ts";
import { didYouMean } from "./did-you-mean.ts";
import { help, renderHelp } from "./help.ts";
import { noColor } from "./no-color.ts";
import { updateNotifier } from "./update-notifier.ts";
import { version } from "./version.ts";

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
	return defineExtension(defineExtensionId("late-skill"), {
		commands: [
			defineCommand("skill", { description: "Manage agent skills" }, (command) =>
				command
					.add(
						defineCommand("update", { description: "Update installed skills" }, (cmd) =>
							cmd.action(() => {}),
						),
					)
					.action(() => {}),
			),
		],
	});
}

describe("built-in extensions", () => {
	it("exposes reserved identities on official factories", async () => {
		expect(
			[help.id, version.id, completion.id, didYouMean.id, noColor.id, updateNotifier.id].map(
				String,
			),
		).toEqual([
			"crust:help",
			"crust:version",
			"crust:completion",
			"crust:did-you-mean",
			"crust:no-color",
			"crust:update-notifier",
		]);
		expect(help().id).toBe(help.id);
	});

	it("lets official help coexist with a user Extension named help", async () => {
		let userHelpRan = false;
		const app = new Crust("app")
			.extend(
				defineExtension(defineExtensionId("help"), {
					hooks: { preRun: () => void (userHelpRan = true) },
				}),
			)
			.extend(help());

		await app.execute({ argv: [] });

		expect(userHelpRan).toBe(true);
		expect(stripAnsi(getStdout())).toContain("Usage:");
	});

	it("renderHelp honors only and except audiences", async () => {
		const other = defineExtensionId("acme:other");
		const snapshot = await new Crust("demo", {
			sections: [
				{ title: "Help only", body: "visible", only: [help] },
				{ title: "Other only", body: "hidden", only: [other] },
				{ title: "Not help", body: "hidden", except: [help] },
			],
		}).snapshot();
		const output = stripAnsi(renderHelp(snapshot));
		expect(output).toContain("Help only:");
		expect(output).not.toContain("Other only:");
		expect(output).not.toContain("Not help:");
	});

	it("renderHelp styles sections and preserves plain-text structure", async () => {
		// Force colors on so the ANSI assertion is deterministic in non-TTY
		// test environments (e.g. CI). Reset via afterEach.
		process.env.FORCE_COLOR = "3";

		const command = new Crust("app", { description: "Test app" })
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
			.add(defineCommand("build", { description: "Build the project" }, (cmd) => cmd));

		const output = renderHelp(await command.snapshot());
		const plain = stripAnsi(output);

		expect(output).toContain("\x1b[");
		expect(plain).toContain("Usage:");
		expect(plain).toContain("Commands:");
		expect(plain).toContain("Arguments:");
		expect(plain).toContain("Options:");
		expect(plain).toContain("-v, --verbose, --no-verbose");
		expect(plain).toContain("[default: true]");
		expect(plain).toContain("[default: 3000]");
		expect(plain).toContain('[default: "."]');

		// Convention audit H3 keeps per-part usage coloring: path green,
		// placeholders cyan, args yellow (dim when optional) — not one span.
		const usageLine = output.split("\n").find((line) => stripAnsi(line).startsWith("  app"));
		expect(usageLine).toContain("\x1b[32mapp\x1b["); // green path
		expect(usageLine).toContain("\x1b[36m<command>\x1b["); // cyan placeholder
		expect(usageLine).toContain("\x1b[36m[options]\x1b["); // cyan placeholder
		expect(usageLine).toContain("[dir]"); // arg token present, yellow+dim
	});

	it("renderHelp shows every callable alias and negation", async () => {
		const command = new Crust("app").flags({
			name: "verbose",
			type: "boolean",
			aliases: ["loud"],
		});

		const output = stripAnsi(renderHelp(await command.snapshot()));
		// Convention audit H2: disclose every callable long-form negation.
		expect(output).toContain("--verbose, --loud, --no-verbose, --no-loud");
	});

	it("renderHelp hides negation labels when noNegate is set", async () => {
		const command = new Crust("app").flags({
			name: "help",
			type: "boolean",
			short: "h",
			noNegate: true,
		});

		const output = stripAnsi(renderHelp(await command.snapshot()));
		expect(output).toContain("-h, --help");
		expect(output).not.toContain("--no-help");
	});

	it("renderHelp keeps stripped columns aligned with styled labels", async () => {
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
			});

		const lines = stripAnsi(renderHelp(await command.snapshot())).split("\n");

		const verboseLine = lines.find((line) => line.includes("--verbose"));
		const portLine = lines.find((line) => line.includes("--port"));

		expect(verboseLine).toBeDefined();
		expect(portLine).toBeDefined();
		expect(verboseLine?.indexOf("Enable verbose logging")).toBe(portLine?.indexOf("Port number"));
		expect(lines).toContain('  [dir]              Output directory [default: "."]');
	});

	it("renderHelp preserves non-finite numeric defaults", async () => {
		const command = new Crust("app").flags({
			name: "timeout",
			type: "number",
			default: Infinity,
		});

		const output = stripAnsi(renderHelp(await command.snapshot()));
		expect(output).toContain("[default: Infinity]");
		expect(output).not.toContain("[default: null]");
	});

	it("help extension renders generated help for no-run command", async () => {
		const app = new Crust("app")
			.extend(help())
			.add(defineCommand("build", (cmd) => cmd.action(() => {})));

		await app.execute({ argv: ["--help"] });

		const output = stripAnsi(getStdout());
		expect(output).toContain("app");
		expect(output).toContain("Usage:");
		expect(output).toContain("Commands:");
		expect(output).toContain("build");
		expect(output).toContain("-h, --help");
		expect(output).not.toContain("--no-help");
	});

	it("help reaches nested subcommands", async () => {
		const app = new Crust("app")
			.extend(help())
			.add(
				defineCommand("group", (group) =>
					group.add(defineCommand("build", (build) => build.action(() => {}))),
				),
			);

		await app.execute({ argv: ["group", "build", "--help"] });

		const output = stripAnsi(getStdout());
		expect(output).toContain("app group build");
		expect(output).toContain("-h, --help");
	});

	it("renders the current command's metadata sections after Options", async () => {
		const app = new Crust("app", {
			sections: [{ title: "Root notes", body: "Root body" }],
		})
			.extend(
				defineExtension(defineExtensionId("docs"), {
					sections: () => [
						{
							command: ["build"],
							title: "Build notes",
							body: "Build body\nSecond line",
						},
					],
				}),
			)
			.extend(help())
			.add(defineCommand("build", (build) => build.action(() => {})));

		await app.run([]);
		const rootOutput = stripAnsi(getStdout());
		expect(rootOutput).toContain("Root notes:\n  Root body");
		expect(rootOutput).not.toContain("Build notes:");
		expect(rootOutput.indexOf("Root notes:")).toBeGreaterThan(rootOutput.indexOf("Options:"));

		stdoutChunks = [];
		await app.execute({ argv: ["build", "--help"] });
		const buildOutput = stripAnsi(getStdout());
		expect(buildOutput).toContain("Build notes:\n  Build body\n  Second line");
		expect(buildOutput).not.toContain("Root notes:");
		expect(buildOutput.indexOf("Build notes:")).toBeGreaterThan(buildOutput.indexOf("Options:"));
	});

	it("recursive false Extension flags stay root-only", async () => {
		const rootOnly = defineExtension(defineExtensionId("root-only"), {
			flags: [{ name: "root", type: "boolean", recursive: false }],
		});
		let rootSaw = false;
		const app = new Crust("app")
			.extend(rootOnly)
			.add(defineCommand("build", (build) => build.action(() => {})))
			.action(({ flags }) => {
				rootSaw = flags.root === true;
			});

		// Extension flags only exist on the prepared tree, so scoping must be
		// exercised through execute(): parsed on the root, unknown on the child.
		await app.execute({ argv: ["--root"] });
		expect(rootSaw).toBe(true);

		await app.execute({ argv: ["build", "--root"] });
		expect(getStderr()).toContain("--root");
	});

	it("noColor injects --color and --no-color into help output", async () => {
		const app = new Crust("app")
			.extend(noColor())
			.extend(help())
			.add(defineCommand("build", (cmd) => cmd.action(() => {})));

		await app.execute({ argv: ["--help"] });

		const output = stripAnsi(getStdout());
		expect(output).toContain("--color, --no-color");
	});

	it("noColor disables color but preserves modifiers on a TTY", async () => {
		// `--no-color` → NO_COLOR=1: colors off, modifiers keep following
		// TTY detection (no-color.org). Mock a TTY so the modifier half of
		// the contract is observable regardless of the test runner's stdout.
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: true,
		});
		const app = new Crust("app").extend(noColor()).extend(help());

		await app.execute({ argv: ["--help", "--no-color"] });

		const output = getStdout();
		expect(output).not.toContain("\x1b[36m");
		expect(output).not.toContain("\x1b[33m");
		expect(output).toContain("\x1b[1mUsage:\x1b[22m");
	});

	it("noColor overrides NO_COLOR with --color", async () => {
		const previousNoColor = process.env.NO_COLOR;
		process.env.NO_COLOR = "1";

		try {
			const app = new Crust("app").extend(noColor()).extend(help());

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

	it("noColor --color clears NO_COLOR during the run and restores it after", async () => {
		process.env.NO_COLOR = "1";
		let seenNoColor: string | undefined = "unset";

		const app = new Crust("app").extend(noColor()).action(() => {
			seenNoColor = process.env.NO_COLOR;
		});

		await app.execute({ argv: ["--color"] });

		expect(seenNoColor).toBeUndefined();
		expect(process.env.NO_COLOR).toBe("1");
	});

	it("noColor restores ambient env after overlapping runs with opposite flags", async () => {
		const ambientForceColor = process.env.FORCE_COLOR;
		const ambientNoColor = process.env.NO_COLOR;
		delete process.env.FORCE_COLOR;
		delete process.env.NO_COLOR;

		let releaseA: () => void = () => {};
		const blockA = new Promise<void>((resolve) => {
			releaseA = resolve;
		});

		const appA = new Crust("a").extend(noColor()).action(() => blockA);
		const appB = new Crust("b").extend(noColor()).action(() => {});

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

	it("noColor respects NO_COLOR without explicit --color flag", async () => {
		const previousNoColor = process.env.NO_COLOR;
		process.env.NO_COLOR = "1";

		try {
			const app = new Crust("app").extend(noColor()).extend(help());

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

	it("noColor restores the prior env after the command", async () => {
		process.env.FORCE_COLOR = "3";
		delete process.env.NO_COLOR;

		const app = new Crust("app").extend(noColor()).extend(help());

		await app.execute({ argv: ["--help", "--no-color"] });

		expect(process.env.FORCE_COLOR).toBe("3");
		expect(process.env.NO_COLOR).toBeUndefined();
	});

	it("noColor --no-color wins over ambient FORCE_COLOR", async () => {
		process.env.FORCE_COLOR = "3";

		const app = new Crust("app").extend(noColor()).extend(help());

		await app.execute({ argv: ["--help", "--no-color"] });

		const output = getStdout();
		expect(output).not.toContain("\x1b[36m");
		expect(output).not.toContain("\x1b[33m");
	});

	it("noColor flag is recursive on subcommands", async () => {
		const app = new Crust("app")
			.extend(noColor())
			.extend(help())
			.add(defineCommand("build", (cmd) => cmd.action(() => {})));

		await app.execute({ argv: ["build", "--help"] });

		const output = stripAnsi(getStdout());
		expect(output).toContain("--color, --no-color");
	});

	it("help extension shows help instead of error when --help is used with missing required arg", async () => {
		const app = new Crust("app")
			.extend(help())
			.add(
				defineCommand("create", (cmd) =>
					cmd.args({ name: "name", type: "string", required: true }).action(() => {}),
				),
			);

		await app.execute({ argv: ["create", "--help"] });

		const output = stripAnsi(getStdout());
		expect(output).toContain("create");
		expect(output).toContain("Usage:");
		expect(getStderr()).toBe("");
		expect(process.exitCode).toBeFalsy();
	});

	it("help extension shows help instead of error when --help is used with missing required flag", async () => {
		const app = new Crust("app")
			.extend(help())
			.add(
				defineCommand("deploy", (cmd) =>
					cmd.flags({ name: "target", type: "string", required: true }).action(() => {}),
				),
			);

		await app.execute({ argv: ["deploy", "--help"] });

		const output = stripAnsi(getStdout());
		expect(output).toContain("deploy");
		expect(output).toContain("Usage:");
		expect(getStderr()).toBe("");
		expect(process.exitCode).toBeFalsy();
	});

	it("help extension ignores help-like args after --", async () => {
		let capturedRawArgs: string[] = [];

		const app = new Crust("app", { description: "Test app" }).extend(help()).add(
			defineCommand("build", (cmd) =>
				cmd.action((ctx) => {
					capturedRawArgs = [...ctx.rawArgs];
				}),
			),
		);

		await app.execute({ argv: ["build", "--", "--help"] });

		expect(getStdout()).toBe("");
		expect(capturedRawArgs).toEqual(["--help"]);
	});

	it("help renders Context-owned flags on providers and descendants", async () => {
		const apiKey = defineFlag("api-key", {
			type: "string",
			description: "API credential",
		});
		const auth = defineContext("auth", { flags: [apiKey] }, () => ({}));
		const app = new Crust("app")
			.provide(auth())
			.extend(help())
			.add(defineCommand("deploy", (command) => command.action(() => {})));

		await app.execute({ argv: ["--help"] });
		const rootHelp = stripAnsi(getStdout());
		expect(rootHelp).toContain("--api-key");

		stdoutChunks = [];
		await app.execute({ argv: ["deploy", "--help"] });
		const childHelp = stripAnsi(getStdout());
		expect(childHelp).toContain("--api-key");
		expect(childHelp).toContain("API credential");
	});

	it("help extension supports subcommands injected after its setup", async () => {
		const app = new Crust("app")
			.extend(help())
			.extend(lateSkillExtension())
			.action(() => {});

		await app.execute({ argv: ["skill", "--help"] });

		expect(stripAnsi(getStdout())).toContain("Manage agent skills");
		expect(stripAnsi(getStdout())).toContain("--help");
		expect(getStderr()).toBe("");
		expect(process.exitCode).toBeFalsy();
	});

	it("help extension supports nested subcommands injected after its setup", async () => {
		const app = new Crust("app")
			.extend(help())
			.extend(lateSkillExtension())
			.action(() => {});

		await app.execute({ argv: ["skill", "update", "--help"] });

		expect(stripAnsi(getStdout())).toContain("Update installed skills");
		expect(stripAnsi(getStdout())).toContain("--help");
		expect(getStderr()).toBe("");
		expect(process.exitCode).toBeFalsy();
	});

	it("help extension supports subcommands injected before its setup", async () => {
		const app = new Crust("app")
			.extend(lateSkillExtension())
			.extend(help())
			.action(() => {});

		await app.execute({ argv: ["skill", "--help"] });

		expect(stripAnsi(getStdout())).toContain("Manage agent skills");
		expect(stripAnsi(getStdout())).toContain("--help");
		expect(getStderr()).toBe("");
		expect(process.exitCode).toBeFalsy();
	});

	it("version extension handles --version from root metadata", async () => {
		const app = new Crust("app", { version: "1.2.3" }).extend(version()).action(() => {});

		await app.execute({ argv: ["--version"] });

		expect(getStdout()).toContain("app v1.2.3");
	});

	it("version extension reports a missing version", async () => {
		const app = new Crust("app").extend(version()).action(() => {});

		await app.execute({ argv: ["--version"] });

		expect(getStderr()).toContain("version extension requires a version");
		expect(process.exitCode).toBe(1);
	});

	it("version extension handles -v alias", async () => {
		const app = new Crust("app").extend(version("2.0.0")).action(() => {});

		await app.execute({ argv: ["-v"] });

		expect(getStdout()).toContain("app v2.0.0");
	});

	it("version extension ignores --version after -- separator", async () => {
		let ran = false;

		const app = new Crust("app").extend(version("1.0.0")).action(() => {
			ran = true;
		});

		await app.execute({ argv: ["--", "--version"] });

		expect(getStdout()).toBe("");
		expect(ran).toBe(true);
	});

	it("version extension only triggers on root command", async () => {
		let ran = false;

		const app = new Crust("app").extend(version("1.0.0")).add(
			defineCommand("build", (cmd) =>
				cmd.action(() => {
					ran = true;
				}),
			),
		);

		await app.execute({ argv: ["build"] });

		expect(getStdout()).toBe("");
		expect(ran).toBe(true);
	});

	it("version extension flag appears in help output", async () => {
		const app = new Crust("app", { description: "Test app" })
			.extend(version("1.0.0"))
			.extend(help())
			.action(() => {});

		await app.execute({ argv: ["--help"] });

		const output = stripAnsi(getStdout());
		expect(output).toContain("--version");
		expect(output).toContain("Show version number");
	});

	it("version extension with function value", async () => {
		const app = new Crust("app").extend(version(() => "3.5.0")).action(() => {});

		await app.execute({ argv: ["--version"] });

		expect(getStdout()).toContain("app v3.5.0");
	});

	it("version extension supports plain format", async () => {
		const app = new Crust("app").extend(version("1.2.3", { format: "plain" })).action(() => {});

		await app.execute({ argv: ["--version"] });

		expect(getStdout()).toBe("1.2.3");
	});

	it("version extension supports a custom format function", async () => {
		const app = new Crust("app")
			.extend(
				version("1.2.3", {
					format: (version, context) => `${context.rootCommand.meta.name}/${version}`,
				}),
			)
			.action(() => {});

		await app.execute({ argv: ["--version"] });

		expect(getStdout()).toBe("app/1.2.3");
	});

	// ──────────────────────────────────────────────────────────────────────────────
	// help alias rendering
	// ──────────────────────────────────────────────────────────────────────────────

	it("renderHelp renders aliases inline next to the canonical command name", async () => {
		const command = new Crust("app").add(
			defineCommand(
				"issue",
				{
					description: "Manage issues",
					aliases: ["issues", "i"],
				},
				(cmd) => cmd.action(() => {}),
			),
		);

		const plain = stripAnsi(renderHelp(await command.snapshot()));
		expect(plain).toContain("Commands:");
		expect(plain).toContain("issue (issues, i)");
		expect(plain).toContain("Manage issues");
	});

	it("renderHelp renders unchanged for a command without aliases", async () => {
		const command = new Crust("app").add(
			defineCommand("build", { description: "Build the project" }, (cmd) => cmd.action(() => {})),
		);

		const plain = stripAnsi(renderHelp(await command.snapshot()));
		expect(plain).toContain("Commands:");
		expect(plain).toContain("build");
		// No parens means no aliases were rendered.
		expect(plain).not.toMatch(/build\s*\(/);
	});

	it("renderHelp keeps description column aligned when aliases overflow the column", async () => {
		const command = new Crust("app")
			.add(
				defineCommand(
					"issue",
					{
						description: "Manage issues",
						aliases: ["issues", "i"],
					},
					(cmd) => cmd.action(() => {}),
				),
			)
			.add(
				defineCommand("build", { description: "Build the project" }, (cmd) => cmd.action(() => {})),
			);

		const lines = stripAnsi(renderHelp(await command.snapshot())).split("\n");
		const issueLine = lines.find((line) => line.includes("issue (issues, i)"));
		const buildLine = lines.find((line) => line.match(/^\s+build\s+Build the project$/));

		expect(issueLine).toBeDefined();
		expect(buildLine).toBeDefined();
		// Description still appears on the same line, just after the overflowing label.
		expect(issueLine).toContain("Manage issues");
	});

	// ──────────────────────────────────────────────────────────────────────
	// help hidden subcommand filtering
	// ──────────────────────────────────────────────────────────────────────

	it("renderHelp omits subcommands marked meta.hidden: true", async () => {
		const command = new Crust("app")
			.add(
				defineCommand("build", { description: "Build the project" }, (cmd) => cmd.action(() => {})),
			)
			.add(
				defineCommand(
					"__complete",
					{
						description: "Internal completion entrypoint",
						hidden: true,
					},
					(cmd) => cmd.action(() => {}),
				),
			);

		const plain = stripAnsi(renderHelp(await command.snapshot()));
		expect(plain).toContain("Commands:");
		expect(plain).toContain("build");
		expect(plain).not.toContain("__complete");
		expect(plain).not.toContain("Internal completion entrypoint");
	});

	it("renderHelp omits the COMMANDS section when every subcommand is hidden", async () => {
		const command = new Crust("app")
			.add(
				defineCommand("__complete", { hidden: true, description: "Internal" }, (cmd) =>
					cmd.action(() => {}),
				),
			)
			.action(() => {});

		const plain = stripAnsi(renderHelp(await command.snapshot()));
		expect(plain).not.toContain("Commands:");
		expect(plain).not.toContain("__complete");
	});

	it("renderHelp omits the `<command>` USAGE token when every subcommand is hidden and parent has no action", async () => {
		// Regression: formatUsage previously counted hidden subcommands when
		// deciding whether to emit `<command>`, producing the incoherent
		// `Usage: app <command>` with no COMMANDS section below it.
		const command = new Crust("app").add(
			defineCommand("__complete", { hidden: true, description: "Internal" }, (cmd) =>
				cmd.action(() => {}),
			),
		);

		const plain = stripAnsi(renderHelp(await command.snapshot()));
		expect(plain).toContain("Usage:");
		expect(plain).not.toMatch(/Usage:\s+app\s+<command>/);
		expect(plain).not.toContain("Commands:");
		expect(plain).not.toContain("__complete");
	});

	it("hidden subcommands remain invocable by direct name", async () => {
		let didRun = false;
		const app = new Crust("app")
			.extend(help())
			.add(
				defineCommand("build", { description: "Build the project" }, (cmd) => cmd.action(() => {})),
			)
			.add(
				defineCommand("__complete", { hidden: true, description: "Internal" }, (cmd) =>
					cmd.action(() => {
						didRun = true;
					}),
				),
			);

		await app.execute({ argv: ["__complete"] });
		expect(didRun).toBe(true);
	});

	it("renderHelp surfaces flag `choices` as a `[choices: ...]` suffix", async () => {
		// The choices list is declared on the flag definition;
		// `help` must surface it so users can discover the valid
		// values from `--help` without resorting to shell completion or
		// reading the source.
		const command = new Crust("app", { description: "Build artifact" })
			.flags({
				name: "target",
				type: "string",
				choices: ["browser", "bun", "node"],
				description: "Build target",
			})
			.action(() => {});
		const plain = stripAnsi(renderHelp(await command.snapshot()));
		expect(plain).toContain("--target");
		expect(plain).toContain("Build target");
		expect(plain).toContain("[choices: browser, bun, node]");
	});

	it("renderHelp surfaces positional-arg `choices` in the ARGS section", async () => {
		const command = new Crust("app", { description: "Deploy to an env" })
			.args({
				name: "env",
				type: "string",
				required: true,
				choices: ["dev", "staging", "prod"],
				description: "Target environment",
			})
			.action(() => {});
		const plain = stripAnsi(renderHelp(await command.snapshot()));
		// The ARGS section heading is the marker the rest of the
		// assertions hang off; without it the test would silently miss
		// rendering bugs that drop the section entirely.
		expect(plain).toContain("Arguments:");
		expect(plain).toContain("<env>");
		expect(plain).toContain("[choices: dev, staging, prod]");
	});

	it("renderHelp composes `[default: ...]` and `[choices: ...]` when both are present", async () => {
		const command = new Crust("app")
			.flags({
				name: "target",
				type: "string",
				choices: ["a", "b"],
				default: "a",
				description: "Build target",
			})
			.action(() => {});
		const plain = stripAnsi(renderHelp(await command.snapshot()));
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
