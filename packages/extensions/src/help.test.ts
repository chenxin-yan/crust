import { stripVTControlCharacters } from "node:util";

import {
	Crust,
	defineCommand,
	defineContext,
	defineExtension,
	defineExtensionId,
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
		const output = stripAnsi(await renderHelp(snapshot));
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
			.args({
				name: "dir",
				type: "string",
				description: "Output directory",
				default: ".",
			})
			.add(defineCommand("build", { description: "Build the project" }, (cmd) => cmd));

		const output = await renderHelp(await command.snapshot());
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

	it("renderHelp keeps stripped columns aligned with styled labels", async () => {
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
			.args({
				name: "dir",
				type: "string",
				description: "Output directory",
				default: ".",
			});

		const lines = stripAnsi(await renderHelp(await command.snapshot())).split("\n");

		const verboseLine = lines.find((line) => line.includes("--verbose"));
		const portLine = lines.find((line) => line.includes("--port"));

		expect(verboseLine).toBeDefined();
		expect(portLine).toBeDefined();
		expect(verboseLine?.indexOf("Enable verbose logging")).toBe(portLine?.indexOf("Port number"));
		expect(lines).toContain('  [dir]              Output directory [default: "."]');
	});

	it("renderHelp shows a value placeholder after value flags only", async () => {
		const command = new Crust("app").flags({
			count: { type: "number", short: "c", description: "Number of times", default: 1 },
			mode: { type: "string", choices: ["fast", "slow"], description: "Execution mode" },
			tag: { type: "string", short: "t", multiple: true, description: "Tag" },
			out: { type: "path", description: "Output file" },
			force: { type: "boolean", short: "f", description: "Force it" },
		});

		const lines = stripAnsi(await renderHelp(await command.snapshot())).split("\n");

		expect(lines).toContain("  -c, --count <number>         Number of times [default: 1]");
		expect(lines).toContain("  --mode <string>              Execution mode [choices: fast, slow]");
		expect(lines).toContain("  -t, --tag <string>           Tag");
		expect(lines).toContain("  --out <path>                 Output file");
		expect(lines).toContain("  -f, --force, --no-force      Force it");
	});

	it("renderHelp widens a column to fit its longest label", async () => {
		const command = new Crust("app").flags({
			"output-directory": {
				type: "string",
				short: "o",
				aliases: ["outdir"],
				description: "Where to write",
			},
			force: { type: "boolean", short: "f", description: "Force it" },
		});

		const lines = stripAnsi(await renderHelp(await command.snapshot())).split("\n");
		const long = lines.find((line) => line.includes("--output-directory"));
		const short = lines.find((line) => line.includes("--force"));

		expect(long).toBe("  -o, --output-directory, --outdir <string>  Where to write");
		expect(short?.indexOf("Force it")).toBe(long?.indexOf("Where to write"));
	});

	it("lists a Context's owned flags only on commands that parse them", async () => {
		const config = defineContext("config")
			.flags({ region: { type: "string", description: "API region" } })
			.setup(({ flags }) => flags.region);
		const api = defineContext("api")
			.use(config)
			.flags({ "api-url": { type: "string", description: "API base URL" } })
			.setup(({ flags }) => flags["api-url"]);
		const app = new Crust("app")
			.extend(help())
			.provide(config(), api())
			.add(
				defineCommand("status", (cmd) => cmd.use(api).action(() => {})),
				defineCommand("version", (cmd) => cmd.action(() => {})),
			)
			.command("deploy", (cmd) => cmd.action(() => {}));
		const helpFor = async (command: string) =>
			stripAnsi((await captureExecute(app, [command, "--help"])).stdout);

		for (const command of ["status", "deploy"]) {
			const output = await helpFor(command);
			expect(output).toContain("--api-url <string>");
			expect(output).toContain("--region <string>");
		}
		const version = await helpFor("version");
		expect(version).toContain("--help");
		expect(version).not.toContain("--api-url");
		expect(version).not.toContain("--region");
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

	it("lists every command without building any, even when a sibling recipe throws", async () => {
		const built: string[] = [];
		const app = new Crust("app").extend(help()).add(
			defineCommand("build", { description: "Build it", aliases: ["b"] }, (cmd) => {
				built.push("build");
				return cmd.action(() => {});
			}),
			defineCommand("broken", { description: "Broken recipe" }, () => {
				built.push("broken");
				throw new Error("broken recipe");
			}),
			defineCommand("secret", { hidden: true }, (cmd) => {
				built.push("secret");
				return cmd;
			}),
		);

		const { stdout, exitCode } = await captureExecute(app, ["--help"]);

		const output = stripAnsi(stdout);
		expect(exitCode).toBe(0);
		expect(output).toMatch(/build \(b\)\s+Build it/);
		expect(output).toMatch(/broken\s+Broken recipe/);
		expect(output).not.toContain("secret");
		expect(built).toEqual([]);
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

	it("help extension shows help instead of an invalid flag value from argv or env", async () => {
		const actions: string[] = [];
		const port = { type: "number", default: 3000, env: { name: "PORT" } } as const;
		const app = new Crust("app")
			.extend(help())
			.flags({ port })
			.add(
				defineCommand("serve", (cmd) =>
					cmd
						.flags({ port, mode: { type: "string", choices: ["fast", "safe"] } })
						.action(() => void actions.push("serve")),
				),
			)
			.action(() => void actions.push("root"));

		const cases = [
			["--port", "abc", "--help"],
			["--help", "--port", "abc"],
			["serve", "--port", "abc", "--help"],
			["serve", "--help", "--mode", "slow"],
		];
		for (const argv of cases) {
			const { stdout, stderr, exitCode } = await captureExecute(app, argv);
			expect(stripAnsi(stdout), argv.join(" ")).toContain("Usage:");
			expect(stderr).toBe("");
			expect(exitCode).toBe(0);
		}

		vi.stubEnv("PORT", "abc");
		for (const argv of [["--help"], ["serve", "--help"]]) {
			const { stdout, stderr, exitCode } = await captureExecute(app, argv);
			expect(stripAnsi(stdout), argv.join(" ")).toContain("Usage:");
			expect(stderr).toBe("");
			expect(exitCode).toBe(0);
		}

		const failed = await captureExecute(app, ["serve"]);
		expect(failed.stderr).toContain('Expected number for --port, got "abc"');
		expect(failed.exitCode).toBe(1);
		expect(actions).toEqual([]);
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

		const plain = stripAnsi(await renderHelp(await command.snapshot()));
		expect(plain).toContain("Commands:");
		expect(plain).toContain("issue (issues, i)");
		expect(plain).toContain("Manage issues");
	});

	it("renderHelp documents only direct children, never grandchildren", async () => {
		const snapshot = await new Crust("app")
			.add(
				defineCommand("remote", { description: "Manage remotes" }, (cmd) =>
					cmd.add(defineCommand("add", {}, (sub) => sub.action(() => {}))),
				),
			)
			.snapshot();
		const remote = snapshot.subCommands.remote!;
		const grandchildReads = vi.fn();
		const tracked = {
			...snapshot,
			subCommands: {
				remote: {
					...remote,
					subCommands: {
						get add() {
							grandchildReads();
							return remote.subCommands.add!;
						},
					},
				},
			},
		};

		const plain = stripAnsi(await renderHelp(tracked));
		expect(plain).toContain("Manage remotes");
		expect(grandchildReads).not.toHaveBeenCalled();
	});

	it("renderHelp omits the COMMANDS section when every subcommand is hidden", async () => {
		const command = new Crust("app")
			.add(
				defineCommand("__complete", { hidden: true, description: "Internal" }, (cmd) =>
					cmd.action(() => {}),
				),
			)
			.action(() => {});

		const plain = stripAnsi(await renderHelp(await command.snapshot()));
		expect(plain).not.toContain("Commands:");
		expect(plain).not.toContain("__complete");
	});

	it("renderHelp surfaces the `env` variable name after the description, never its value", async () => {
		const command = new Crust("app")
			.flags({
				token: {
					type: "string",
					env: { name: "HOME" },
					default: "anon",
					description: "API token",
				},
			})
			.action(() => {});
		const plain = stripAnsi(await renderHelp(await command.snapshot()));
		const tokenLine = plain.split("\n").find((l) => l.includes("--token"));
		expect(tokenLine).toContain('API token [env: HOME] [default: "anon"]');
		// HOME is set in every test environment; help must show the name only.
		expect(process.env.HOME).toBeTruthy();
		expect(plain).not.toContain(process.env.HOME as string);
	});
});
