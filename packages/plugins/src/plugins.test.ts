import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Crust, type CrustPlugin } from "@crustjs/core";
import { getGlobalColorMode, setGlobalColorMode } from "@crustjs/style";
import { autoCompletePlugin } from "./autocomplete.ts";
import { helpPlugin, renderHelp } from "./help.ts";
import { noColorPlugin } from "./no-color.ts";
import { versionPlugin } from "./version.ts";

let stdoutChunks: string[];
let stderrChunks: string[];
let originalLog: typeof console.log;
let originalError: typeof console.error;

beforeEach(() => {
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

afterEach(() => {
	console.log = originalLog;
	console.error = originalError;
	process.exitCode = 0;
	setGlobalColorMode(undefined);
});

function getStdout() {
	return stdoutChunks.join("\n");
}

function getStderr() {
	return stderrChunks.join("\n");
}

function stripAnsi(text: string) {
	return Bun.stripANSI(text);
}

function lateSkillPlugin(): CrustPlugin {
	return {
		name: "late-skill",
		setup(ctx, actions) {
			actions.addSubCommand(
				ctx.rootCommand,
				"skill",
				new Crust("skill")
					.meta({ description: "Manage agent skills" })
					.command("update", (cmd) =>
						cmd.meta({ description: "Update installed skills" }).run(() => {}),
					)
					.run(() => {})._node,
			);
		},
	};
}

describe("built-in plugins", () => {
	it("renderHelp styles sections and preserves plain-text structure", () => {
		// Force colors on so the ANSI assertion is deterministic in non-TTY
		// test environments (e.g. CI). Reset via afterEach.
		setGlobalColorMode("always");

		const command = new Crust("app")
			.meta({ description: "Test app" })
			.flags({
				verbose: {
					type: "boolean",
					short: "v",
					description: "Enable verbose logging",
					default: true,
				},
				port: {
					type: "number",
					description: "Port number",
					default: 3000,
				},
			})
			.args([
				{
					name: "dir",
					type: "string",
					description: "Output directory",
					default: ".",
				},
			] as const)
			.command("build", (cmd) =>
				cmd.meta({ description: "Build the project" }),
			)._node;

		const output = renderHelp(command);
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
			verbose: {
				type: "boolean",
				aliases: ["loud"],
			},
		})._node;

		const output = stripAnsi(renderHelp(command));
		expect(output).toContain("--verbose, --no-verbose");
		expect(output).not.toContain("--no-loud");
	});

	it("renderHelp hides negation labels when noNegate is set", () => {
		const command = new Crust("app").flags({
			help: {
				type: "boolean",
				short: "h",
				noNegate: true,
			},
		})._node;

		const output = stripAnsi(renderHelp(command));
		expect(output).toContain("-h, --help");
		expect(output).not.toContain("--no-help");
	});

	it("renderHelp keeps stripped columns aligned with styled labels", () => {
		const command = new Crust("app")
			.flags({
				verbose: {
					type: "boolean",
					short: "v",
					description: "Enable verbose logging",
					default: true,
				},
				port: {
					type: "number",
					short: "p",
					description: "Port number",
					default: 3000,
				},
			})
			.args([
				{
					name: "dir",
					type: "string",
					description: "Output directory",
					default: ".",
				},
			] as const)._node;

		const lines = stripAnsi(renderHelp(command)).split("\n");

		const verboseLine = lines.find((line) => line.includes("--verbose"));
		const portLine = lines.find((line) => line.includes("--port"));

		expect(verboseLine).toBeDefined();
		expect(portLine).toBeDefined();
		expect(verboseLine?.indexOf("Enable verbose logging")).toBe(
			portLine?.indexOf("Port number"),
		);
		expect(lines).toContain(
			'  [dir]              Output directory [default: "."]',
		);
	});

	it("renderHelp preserves non-finite numeric defaults", () => {
		const command = new Crust("app").flags({
			timeout: {
				type: "number",
				default: Infinity,
			},
		})._node;

		const output = stripAnsi(renderHelp(command));
		expect(output).toContain("[default: Infinity]");
		expect(output).not.toContain("[default: null]");
	});

	it("help plugin renders generated help for no-run command", async () => {
		const app = new Crust("app")
			.use(helpPlugin())
			.command("build", (cmd) => cmd.run(() => {}));

		await app.execute({ argv: ["--help"] });

		const output = stripAnsi(getStdout());
		expect(output).toContain("app");
		expect(output).toContain("USAGE:");
		expect(output).toContain("COMMANDS:");
		expect(output).toContain("build");
		expect(output).toContain("-h, --help");
		expect(output).not.toContain("--no-help");
	});

	it("noColorPlugin injects --color and --no-color into help output", async () => {
		const app = new Crust("app")
			.use(noColorPlugin())
			.use(helpPlugin())
			.command("build", (cmd) => cmd.run(() => {}));

		await app.execute({ argv: ["--help"] });

		const output = stripAnsi(getStdout());
		expect(output).toContain("--color, --no-color");
	});

	it("noColorPlugin disables color but preserves modifiers", async () => {
		const app = new Crust("app").use(noColorPlugin()).use(helpPlugin());

		await app.execute({ argv: ["--help", "--no-color"] });

		const output = getStdout();
		expect(output).not.toContain("\x1b[36m");
		expect(output).not.toContain("\x1b[33m");
		expect(output).toContain("\x1b[1mUSAGE:\x1b[22m");
	});

	it("noColorPlugin overrides NO_COLOR with --color", async () => {
		const previousNoColor = process.env.NO_COLOR;
		process.env.NO_COLOR = "1";

		try {
			const app = new Crust("app").use(noColorPlugin()).use(helpPlugin());

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

	it("noColorPlugin respects NO_COLOR without explicit --color flag", async () => {
		const previousNoColor = process.env.NO_COLOR;
		process.env.NO_COLOR = "1";

		try {
			const app = new Crust("app").use(noColorPlugin()).use(helpPlugin());

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

	it("noColorPlugin restores the prior global color override", async () => {
		setGlobalColorMode("always");

		const app = new Crust("app").use(noColorPlugin()).use(helpPlugin());

		await app.execute({ argv: ["--help", "--no-color"] });

		expect(getGlobalColorMode()).toBe("always");
	});

	it("noColorPlugin flag is inherited by subcommands", async () => {
		const app = new Crust("app")
			.use(noColorPlugin())
			.use(helpPlugin())
			.command("build", (cmd) => cmd.run(() => {}));

		await app.execute({ argv: ["build", "--help"] });

		const output = stripAnsi(getStdout());
		expect(output).toContain("--color, --no-color");
	});

	it("help plugin shows help instead of error when --help is used with missing required arg", async () => {
		const app = new Crust("app")
			.use(helpPlugin())
			.command("create", (cmd) =>
				cmd
					.args([{ name: "name", type: "string", required: true }] as const)
					.run(() => {}),
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
			.use(helpPlugin())
			.command("deploy", (cmd) =>
				cmd.flags({ target: { type: "string", required: true } }).run(() => {}),
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
			.use(helpPlugin())
			.command("build", (cmd) =>
				cmd.run((ctx) => {
					capturedRawArgs = [...ctx.rawArgs];
				}),
			);

		await app.execute({ argv: ["build", "--", "--help"] });

		expect(getStdout()).toBe("");
		expect(capturedRawArgs).toEqual(["--help"]);
	});

	it("help plugin supports subcommands injected after its setup", async () => {
		const app = new Crust("app")
			.use(helpPlugin())
			.use(lateSkillPlugin())
			.run(() => {});

		await app.execute({ argv: ["skill", "--help"] });

		expect(stripAnsi(getStdout())).toContain("Manage agent skills");
		expect(stripAnsi(getStdout())).toContain("--help");
		expect(getStderr()).toBe("");
		expect(process.exitCode).toBeFalsy();
	});

	it("help plugin supports nested subcommands injected after its setup", async () => {
		const app = new Crust("app")
			.use(helpPlugin())
			.use(lateSkillPlugin())
			.run(() => {});

		await app.execute({ argv: ["skill", "update", "--help"] });

		expect(stripAnsi(getStdout())).toContain("Update installed skills");
		expect(stripAnsi(getStdout())).toContain("--help");
		expect(getStderr()).toBe("");
		expect(process.exitCode).toBeFalsy();
	});

	it("help plugin supports subcommands injected before its setup", async () => {
		const app = new Crust("app")
			.use(lateSkillPlugin())
			.use(helpPlugin())
			.run(() => {});

		await app.execute({ argv: ["skill", "--help"] });

		expect(stripAnsi(getStdout())).toContain("Manage agent skills");
		expect(stripAnsi(getStdout())).toContain("--help");
		expect(getStderr()).toBe("");
		expect(process.exitCode).toBeFalsy();
	});

	it("version plugin handles --version", async () => {
		const app = new Crust("app").use(versionPlugin("1.2.3")).run(() => {});

		await app.execute({ argv: ["--version"] });

		expect(getStdout()).toContain("app v1.2.3");
	});

	it("version plugin handles -v alias", async () => {
		const app = new Crust("app").use(versionPlugin("2.0.0")).run(() => {});

		await app.execute({ argv: ["-v"] });

		expect(getStdout()).toContain("app v2.0.0");
	});

	it("version plugin ignores --version after -- separator", async () => {
		let ran = false;

		const app = new Crust("app").use(versionPlugin("1.0.0")).run(() => {
			ran = true;
		});

		await app.execute({ argv: ["--", "--version"] });

		expect(getStdout()).toBe("");
		expect(ran).toBe(true);
	});

	it("version plugin only triggers on root command", async () => {
		let ran = false;

		const app = new Crust("app")
			.use(versionPlugin("1.0.0"))
			.command("build", (cmd) =>
				cmd.run(() => {
					ran = true;
				}),
			);

		await app.execute({ argv: ["build"] });

		expect(getStdout()).toBe("");
		expect(ran).toBe(true);
	});

	it("version plugin flag appears in help output", async () => {
		const app = new Crust("app")
			.meta({ description: "Test app" })
			.use(versionPlugin("1.0.0"))
			.use(helpPlugin())
			.run(() => {});

		await app.execute({ argv: ["--help"] });

		const output = stripAnsi(getStdout());
		expect(output).toContain("--version");
		expect(output).toContain("Show version number");
	});

	it("version plugin with function value", async () => {
		const app = new Crust("app")
			.use(versionPlugin(() => "3.5.0"))
			.run(() => {});

		await app.execute({ argv: ["--version"] });

		expect(getStdout()).toContain("app v3.5.0");
	});

	it("autocomplete plugin handles command not found in error mode", async () => {
		const app = new Crust("app")
			.use(autoCompletePlugin())
			.command("build", (cmd) => cmd.run(() => {}));

		await app.execute({ argv: ["buld"] });

		expect(getStderr()).toContain('Unknown command "buld"');
		expect(getStderr()).toContain('Did you mean "build"?');
		expect(process.exitCode).toBe(1);
	});
});
