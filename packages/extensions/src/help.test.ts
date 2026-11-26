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
import { json } from "./json.ts";
import { noColor } from "./no-color.ts";

const stripAnsi = stripVTControlCharacters;

/** A Standard Schema for a string token: one of `values`, or `fallback` when missing; required without one. */
function stringSchema(values?: readonly string[], fallback?: string) {
	const json = () => ({ type: "string", ...(values && { enum: values }), default: fallback });
	return {
		"~standard": {
			version: 1 as const,
			vendor: "test",
			validate: (value: unknown) =>
				value === undefined && fallback === undefined
					? { issues: [{ message: "Required" }] }
					: { value: value ?? fallback },
			jsonSchema: { input: json, output: json },
		},
	};
}

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

		// Usage is colored per part: path green, placeholders cyan, args yellow
		// (dim when optional) — not one span.
		const usageLine = output.split("\n").find((line) => stripAnsi(line).startsWith("  app"));
		expect(usageLine).toContain("\x1b[32mapp\x1b["); // green path
		expect(usageLine).toContain("\x1b[36m<command>\x1b["); // cyan placeholder
		expect(usageLine).toContain("\x1b[36m[options]\x1b["); // cyan placeholder
		expect(usageLine).toContain("[dir]"); // arg token present, yellow+dim
	});

	it("renderHelp shows a value placeholder after value flags only, and ... after repeatable ones", async () => {
		const command = new Crust("app").flags({
			memory: { type: "string", valueName: "bytes", description: "Memory limit" },
			count: { type: "number", short: "c", description: "Number of times", default: 1 },
			mode: { type: "string", choices: ["fast", "slow"], description: "Execution mode" },
			tag: { type: "string", short: "t", multiple: true, description: "Tag" },
			out: { type: "path", description: "Output file" },
			force: { type: "boolean", short: "f", description: "Force it" },
			cache: { type: "boolean", default: true, description: "Use the cache" },
			verbose: { type: "count", short: "v", description: "More output" },
			port: { type: "integer", env: ["APP_PORT", "PORT"], description: "Port" },
		});

		const lines = stripAnsi(await renderHelp(await command.snapshot())).split("\n");

		expect(lines).toContain("  -c, --count <number>         Number of times [default: 1]");
		expect(lines).toContain("  --mode <string>              Execution mode [choices: fast, slow]");
		expect(lines).toContain("  --memory <bytes>             Memory limit");
		expect(lines).toContain("  -t, --tag <string>...        Tag");
		expect(lines).toContain("  --out <path>                 Output file");
		expect(lines).toContain("  -f, --force                  Force it");
		expect(lines).toContain("  --cache, --no-cache          Use the cache [default: true]");
		expect(lines).toContain("  -v, --verbose...             More output");
		expect(lines).toContain("  --port <integer>             Port [env: APP_PORT, PORT]");
	});

	it('renderHelp shows an "afterDoubleDash" argument after -- and [options]', async () => {
		const command = new Crust("run")
			.flags({ watch: { type: "boolean", description: "Watch" } })
			.args(
				{ name: "task", type: "string", required: true },
				{ name: "pkgs", type: "string", variadic: true },
				{ name: "extra", type: "string", variadic: "afterDoubleDash", description: "Extra" },
			);

		const lines = stripAnsi(await renderHelp(await command.snapshot())).split("\n");

		expect(lines).toContain("  run <task> [pkgs...] [options] [-- <extra>...]");
		expect(lines).toContain("  [-- <extra>...]    Extra");
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

	it("help extension prints a bare group's help, and checks any input typed to it", async () => {
		const app = new Crust("app")
			.extend(help())
			.flags({
				level: { type: "string", choices: ["debug", "info"] },
				token: { type: "string", required: true },
			})
			.add(defineCommand("build", (cmd) => cmd.action(() => {})));

		const bare = await captureExecute(app, []);
		expect(bare.exitCode).toBe(0);
		expect(stripAnsi(bare.stdout)).toContain("Commands:");

		const invalid = await captureExecute(app, ["--token", "t", "--level", "bogus"]);
		expect(invalid.exitCode).toBe(2);
		expect(invalid.stdout).toBe("");
		expect(invalid.stderr).toContain("--level");
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
		const port = { type: "number", default: 3000, env: "PORT" } as const;
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

		const env = { PORT: "abc" };
		for (const argv of [["--help"], ["serve", "--help"]]) {
			const { stdout, stderr, exitCode } = await captureExecute(app, argv, { env });
			expect(stripAnsi(stdout), argv.join(" ")).toContain("Usage:");
			expect(stderr).toBe("");
			expect(exitCode).toBe(0);
		}

		const failed = await captureExecute(app, ["serve"], { env });
		expect(failed.stderr).toContain("Expected a number for --port (from $PORT).");
		expect(failed.exitCode).toBe(2);
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

	it("renderHelp hides hidden flags, marks deprecated ones, and shows exclusive groups in usage", async () => {
		const command = new Crust("app")
			.flags({
				secret: { type: "string", hidden: true, description: "Internal" },
				old: { type: "string", deprecated: "Use --new.", description: "Old input" },
				scope: {
					type: "exclusive",
					required: true,
					flags: { "org-id": { type: "string" }, all: { type: "boolean", description: "All" } },
				},
			})
			.add(defineCommand("scan", { deprecated: "Use scout.", description: "Scan" }, (cmd) => cmd))
			.action(() => {});

		const plain = stripAnsi(await renderHelp(await command.snapshot()));
		const lines = plain.split("\n");
		expect(lines).toContain("  app (--org-id <string> | --all) [options]");
		expect(lines).toContain("  scan       Scan [deprecated: Use scout.]");
		expect(lines).toContain("  --old <string>               Old input [deprecated: Use --new.]");
		expect(lines).toContain("  --all                        All");
		expect(plain).not.toContain("secret");
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
					env: "HOME",
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

	it("renderHelp leads with examples and the command's own aliases, and shows a schema's choices and default", async () => {
		const snapshot = await new Crust("app")
			.add(
				defineCommand(
					"install",
					{ aliases: ["i"], examples: ["app install react", "app i -D vitest"] },
					(cmd) =>
						cmd
							.args({ name: "pkg", schema: stringSchema() })
							.flags({ save: { type: "string", schema: stringSchema(["prod", "dev"], "prod") } })
							.action(() => {}),
				),
			)
			.snapshot();
		const plain = stripAnsi(await renderHelp(snapshot.subCommands.install!, ["app", "install"]));
		expect(plain).toContain(
			[
				"Usage:",
				"  app install <pkg> [options]",
				"",
				"Examples:",
				"  app install react",
				"  app i -D vitest",
				"",
				"Aliases:",
				"  i",
			].join("\n"),
		);
		expect(plain).toContain('--save <string>              [default: "prod"] [choices: prod, dev]');
	});

	it("renderHelp marks a required flag and a schema-required flag [required]", async () => {
		const snapshot = await new Crust("app")
			.flags({
				token: { type: "string", required: true, description: "Token" },
				tag: { type: "string", schema: stringSchema() },
				opt: { type: "string", description: "Optional" },
			})
			.action(() => {})
			.snapshot();
		const plain = stripAnsi(await renderHelp(snapshot, ["app"]));
		expect(plain).toMatch(/ --token <string> +Token \[required\]$/m);
		expect(plain).toMatch(/ --tag <string> +\[required\]$/m);
		expect(plain).toMatch(/ --opt <string> +Optional$/m);
	});

	it("renderHelp lists .group() headings in code order, then Additional commands, Options, and Global options", async () => {
		const leaf = (name: string) =>
			defineCommand(name, { description: `The ${name} command` }, (cmd) => cmd.action(() => {}));
		const app = new Crust("app")
			.extend(help())
			.add(leaf("misc"))
			.group("Core commands", (g) => g.add(leaf("deploy"), leaf("logs")))
			.group("Resources", (g) => g.flags({ memory: { type: "string", description: "Memory" } }))
			.flags({ verbose: { type: "boolean", description: "Verbose" } })
			.action(() => {});
		const plain = stripAnsi((await captureExecute(app, ["--help"])).stdout);
		const headings = plain.split("\n").filter((line) => /^\S.*:$/.test(line));
		expect(headings).toEqual([
			"Usage:",
			"Core commands:",
			"Additional commands:",
			"Options:",
			"Resources:",
			"Global options:",
		]);
		expect(plain).toContain("Global options:\n  -h, --help                   Show help");
		expect(plain).toContain("Options:\n  --verbose                    Verbose");
	});

	it("renderHelp wraps descriptions to the given width, and --help to stdout's", async () => {
		const app = new Crust("app")
			.extend(help())
			.flags({ name: { type: "string", description: "one two three four five six seven" } })
			.action(() => {});
		const wrapped =
			"  --name <string>              one two three four\n                               five six seven";
		const plain = stripAnsi(await renderHelp(await app.snapshot(), undefined, { columns: 50 }));
		expect(plain).toContain(wrapped);
		const { stdout } = await captureExecute(app, ["--help"], { isTTY: true, columns: 50 });
		expect(stripAnsi(stdout)).toContain(wrapped);
	});

	it("drops an Extension section's own colors under NO_COLOR", async () => {
		vi.stubEnv("FORCE_COLOR", undefined);
		vi.stubEnv("NO_COLOR", "1");
		const snapshot = await new Crust("app")
			.extend(
				defineExtension(defineExtensionId("docs")).sections(() => [
					{ command: [], title: "Templates", body: "\x1b[34mvue-ts\x1b[39m" },
				]),
			)
			.snapshot();
		expect(await renderHelp(snapshot)).toContain("Templates:\n  vue-ts");
	});

	it("help wins over a mistyped flag when -h or --help is its own word before --", async () => {
		const app = new Crust("app")
			.extend(help())
			.command("deploy", { description: "Deploy" }, (cmd) =>
				cmd.flags({ force: { type: "boolean" } }).action(() => {}),
			);

		for (const argv of [
			["deploy", "--forc", "--help"],
			["deploy", "-h", "--forc"],
		]) {
			const { stdout, stderr, exitCode } = await captureExecute(app, argv);
			expect(stripAnsi(stdout), argv.join(" ")).toContain("app deploy - Deploy");
			expect(stderr).toBe("");
			expect(exitCode).toBe(2);
		}
		const afterSeparator = await captureExecute(app, ["deploy", "--forc", "--", "--help"]);
		expect(afterSeparator.stdout).toBe("");
		expect(afterSeparator.stderr).toContain("--forc");
		expect(afterSeparator.exitCode).toBe(2);
		const unknownCommand = await captureExecute(app, ["deplyo", "--help"]);
		expect(unknownCommand.stdout).toBe("");
		expect(unknownCommand.exitCode).toBe(2);
	});

	it("help that wins over a mistyped flag follows a typed --no-color or --color", async () => {
		const app = new Crust("app", { sections: [{ title: "Notes", body: "\x1b[31mred\x1b[39m" }] })
			.extend(help())
			.extend(noColor())
			.action(() => {});

		const plain = await captureExecute(app, ["--typo", "--no-color", "--help"], {
			env: { FORCE_COLOR: "1" },
			raw: true,
		});
		expect(plain.exitCode).toBe(2);
		expect(plain.stdout).toContain("Notes:");
		expect(plain.stdout).not.toContain("\x1b[");
		const colored = await captureExecute(app, ["--color", "--typo", "--help"], {
			env: { NO_COLOR: "1" },
			raw: true,
		});
		expect(colored.exitCode).toBe(2);
		expect(colored.stdout).toContain("\x1b[31mred");
	});

	it("help({ command: true }) adds help [command...], which prints what --help prints", async () => {
		const app = new Crust("app")
			.extend(help({ command: true }))
			.command("db", (db) =>
				db.command("migrate", { aliases: ["m"], description: "Run migrations" }, (cmd) =>
					cmd.action(() => {}),
				),
			);

		const viaCommand = await captureExecute(app, ["help", "db", "m"]);
		const viaFlag = await captureExecute(app, ["db", "migrate", "--help"]);
		expect(viaCommand.exitCode).toBe(0);
		expect(viaCommand.stdout).toBe(viaFlag.stdout);
		const root = stripAnsi((await captureExecute(app, ["help"])).stdout);
		expect(root).toBe(stripAnsi((await captureExecute(app, ["--help"])).stdout));
		expect(root).toMatch(/help\s+Show help for a command/);
		expect(stripAnsi((await captureExecute(app, ["help", "--help"])).stdout)).toContain(
			"app help [command...] [options]",
		);
		const unknown = await captureExecute(app, ["help", "nope"]);
		expect(unknown.stderr).toContain('Unknown command "nope"');
		expect(unknown.exitCode).toBe(2);

		const typed = await app.run(["help"], { args: { command: ["db"] } });
		expect(stripAnsi(typed.stdout)).toContain("app db");
		expect(typed.status === "completed" && stripAnsi(typed.result ?? "")).toContain("app db");
		const asJson = await captureExecute(app.extend(json()), ["help", "db", "--json"]);
		expect(asJson.stderr).toBe("");
		expect(stripAnsi(JSON.parse(asJson.stdout))).toContain("migrate (m)  Run migrations");
		const withoutCommand = await captureExecute(
			new Crust("app")
				.extend(help())
				.args({ name: "file", type: "string" })
				.action(() => {}),
			["help"],
		);
		expect(withoutCommand.exitCode).toBe(0);
		expect(withoutCommand.stdout).toBe("");
	});
});
