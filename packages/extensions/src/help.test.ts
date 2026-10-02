import { stripVTControlCharacters } from "node:util";

import {
	Crust,
	defineCommand,
	defineContext,
	defineExtension,
	defineExtensionId,
	defineFlag,
} from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { help, renderHelp } from "./help.ts";

const stripAnsi = stripVTControlCharacters;

afterEach(() => {
	vi.unstubAllEnvs();
});

function lateSkillExtension() {
	return defineExtension(defineExtensionId("late-skill")).add(
		defineCommand("skill", { description: "Manage agent skills" }, (command) =>
			command
				.add(
					defineCommand("update", { description: "Update installed skills" }, (cmd) =>
						cmd.action(() => {}),
					),
				)
				.action(() => {}),
		),
	);
}

describe("help", () => {
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
		vi.stubEnv("NO_COLOR", undefined);
		vi.stubEnv("FORCE_COLOR", "3");

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

	it("renderHelp shows the single-dash spelling of a one-character alias", async () => {
		const command = new Crust("app").flags({
			name: "port",
			type: "number",
			short: "p",
			aliases: ["P", "listen"],
		});

		const output = stripAnsi(renderHelp(await command.snapshot()));
		expect(output).toContain("-p, -P, --port, --P, --listen");
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

		const { stdout } = await captureExecute(app, ["--help"]);

		const output = stripAnsi(stdout);
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

		const { stdout } = await captureExecute(app, ["group", "build", "--help"]);

		const output = stripAnsi(stdout);
		expect(output).toContain("app group build");
		expect(output).toContain("-h, --help");
	});

	it("renders the current command's metadata sections after Options", async () => {
		const app = new Crust("app", {
			sections: [{ title: "Root notes", body: "Root body" }],
		})
			.extend(
				defineExtension(defineExtensionId("docs")).sections(() => [
					{
						command: ["build"],
						title: "Build notes",
						body: "Build body\nSecond line",
					},
				]),
			)
			.extend(help())
			.add(
				defineCommand(
					"build",
					{ sections: [{ title: "Build notes", body: "Authored body" }] },
					(build) => build.action(() => {}),
				),
			);

		const outcome = await app.run([]);
		expect(outcome.status).toBe("handled");
		const rootOutput = stripAnsi(outcome.stdout);
		expect(rootOutput).toContain("Root notes:\n  Root body");
		expect(rootOutput).not.toContain("Build notes:");
		expect(rootOutput.indexOf("Root notes:")).toBeGreaterThan(rootOutput.indexOf("Options:"));

		const buildOutput = stripAnsi((await captureExecute(app, ["build", "--help"])).stdout);
		expect(buildOutput).toContain("Build notes:\n  Authored body\n  Build body\n  Second line");
		expect(buildOutput.match(/Build notes:/g)).toHaveLength(1);
		expect(buildOutput).not.toContain("Root notes:");
		expect(buildOutput.indexOf("Build notes:")).toBeGreaterThan(buildOutput.indexOf("Options:"));
	});

	it("renders Context sections only on the command where the Context is provided", async () => {
		const env = defineContext("env")
			.sections({ title: "Environment", body: "APP_TOKEN  API token" })
			.setup(() => ({}));
		const database = defineContext("database")
			.sections({ title: "Database", body: "DATABASE_URL  connection" })
			.setup(() => ({}));
		const app = new Crust("app")
			.extend(help())
			.provide(env())
			.add(
				defineCommand("db", (db) =>
					db
						.provide(database())
						.add(defineCommand("migrate", (migrate) => migrate.action(() => {}))),
				),
			);

		const root = stripAnsi((await app.run([])).stdout);
		expect(root).toContain("Environment:\n  APP_TOKEN  API token");
		expect(root).not.toContain("Database:");

		const db = stripAnsi((await captureExecute(app, ["db", "--help"])).stdout);
		expect(db).toContain("Database:\n  DATABASE_URL  connection");
		expect(db).not.toContain("Environment:");

		const migrate = stripAnsi((await captureExecute(app, ["db", "migrate", "--help"])).stdout);
		expect(migrate).toContain("app db migrate");
		expect(migrate).not.toContain("Database:");
		expect(migrate).not.toContain("Environment:");
	});

	it("help extension shows help instead of error when --help is used with missing required arg", async () => {
		const app = new Crust("app")
			.extend(help())
			.add(
				defineCommand("create", (cmd) =>
					cmd.args({ name: "name", type: "string", required: true }).action(() => {}),
				),
			);

		const { stdout, stderr, exitCode } = await captureExecute(app, ["create", "--help"]);

		const output = stripAnsi(stdout);
		expect(output).toContain("create");
		expect(output).toContain("Usage:");
		expect(stderr).toBe("");
		expect(exitCode).toBe(0);
	});

	it("help extension shows help instead of error when --help is used with missing required flag", async () => {
		const app = new Crust("app")
			.extend(help())
			.add(
				defineCommand("deploy", (cmd) =>
					cmd.flags({ name: "target", type: "string", required: true }).action(() => {}),
				),
			);

		const { stdout, stderr, exitCode } = await captureExecute(app, ["deploy", "--help"]);

		const output = stripAnsi(stdout);
		expect(output).toContain("deploy");
		expect(output).toContain("Usage:");
		expect(stderr).toBe("");
		expect(exitCode).toBe(0);
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

		const { stdout } = await captureExecute(app, ["build", "--", "--help"]);

		expect(stdout).toBe("");
		expect(capturedRawArgs).toEqual(["--help"]);
	});

	it("help renders Context-owned flags on providers and descendants", async () => {
		const apiKey = defineFlag("api-key", {
			type: "string",
			description: "API credential",
		});
		const auth = defineContext("auth")
			.flags(apiKey)
			.setup(() => ({}));
		const app = new Crust("app")
			.provide(auth())
			.extend(help())
			.add(defineCommand("deploy", (command) => command.action(() => {})));

		const rootHelp = stripAnsi((await captureExecute(app, ["--help"])).stdout);
		expect(rootHelp).toContain("--api-key");

		const childHelp = stripAnsi((await captureExecute(app, ["deploy", "--help"])).stdout);
		expect(childHelp).toContain("--api-key");
		expect(childHelp).toContain("API credential");
	});

	it("help extension supports subcommands injected after its setup", async () => {
		const app = new Crust("app")
			.extend(help())
			.extend(lateSkillExtension())
			.action(() => {});

		const { stdout, stderr, exitCode } = await captureExecute(app, ["skill", "--help"]);

		expect(stripAnsi(stdout)).toContain("Manage agent skills");
		expect(stripAnsi(stdout)).toContain("--help");
		expect(stderr).toBe("");
		expect(exitCode).toBe(0);
	});

	it("help extension supports nested subcommands injected after its setup", async () => {
		const app = new Crust("app")
			.extend(help())
			.extend(lateSkillExtension())
			.action(() => {});

		const { stdout, stderr, exitCode } = await captureExecute(app, ["skill", "update", "--help"]);

		expect(stripAnsi(stdout)).toContain("Update installed skills");
		expect(stripAnsi(stdout)).toContain("--help");
		expect(stderr).toBe("");
		expect(exitCode).toBe(0);
	});

	it("help extension supports subcommands injected before its setup", async () => {
		const app = new Crust("app")
			.extend(lateSkillExtension())
			.extend(help())
			.action(() => {});

		const { stdout, stderr, exitCode } = await captureExecute(app, ["skill", "--help"]);

		expect(stripAnsi(stdout)).toContain("Manage agent skills");
		expect(stripAnsi(stdout)).toContain("--help");
		expect(stderr).toBe("");
		expect(exitCode).toBe(0);
	});

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

	it("renderHelp keeps description on the same line when aliases overflow the column", async () => {
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

		await captureExecute(app, ["__complete"]);
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

	it("renderHelp surfaces the `env` variable name after the description, never its value", async () => {
		const command = new Crust("app")
			.flags({
				name: "token",
				type: "string",
				env: { name: "HOME" },
				default: "anon",
				description: "API token",
			})
			.action(() => {});
		const plain = stripAnsi(renderHelp(await command.snapshot()));
		const tokenLine = plain.split("\n").find((l) => l.includes("--token"));
		expect(tokenLine).toContain('API token [env: HOME] [default: "anon"]');
		// HOME is set in every test environment; help must show the name only.
		expect(process.env.HOME).toBeTruthy();
		expect(plain).not.toContain(process.env.HOME as string);
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
