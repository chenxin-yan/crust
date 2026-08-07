import { beforeEach, describe, expect, it } from "bun:test";

import type { StandardSchema } from "@crustjs/utils/schema";

import { resolveCommand, type CommandRoute } from "../src/command/router";
import type {
	ArgDef,
	ArgsDef,
	CommandDefinition,
	CommandMeta,
	FlagDef,
	FlagsDef,
	NamedFlagDef,
} from "../src/index";
import {
	Crust,
	defineArg,
	defineCommand,
	defineContext,
	defineExtension,
	defineFlag,
} from "../src/index";
import { parseArgs } from "../src/parsing/parser";
import type { InferArgs, ParseResult } from "../src/types";
import { executeCrust } from "./helpers";

// ────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ────────────────────────────────────────────────────────────────────────────

const rootBase = new Crust("myapp")
	.meta({ description: "Integration test app" })
	.flags({ name: "help", type: "boolean", short: "h" });

const serveCmd = defineCommand("serve", (command) =>
	command
		.args({ name: "dir", type: "string", default: "." })
		.flags({ name: "port", type: "number", default: 3000, short: "p" })
		.handle(({ args, flags }) => {
			console.log(`serve ${args.dir} on ${flags.port}`);
		}),
);

const rootCmd = rootBase.mount(serveCmd).handle(({ flags }) => {
	if (flags.help) {
		console.log("help");
	}
});

// ────────────────────────────────────────────────────────────────────────────
// Core API integration tests (existing)
// ────────────────────────────────────────────────────────────────────────────

describe("integration: core APIs", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("parseArgs parses args and flags using CommandNode", () => {
		const result = parseArgs(rootCmd._node.subCommands.serve!, ["public", "--port", "8080"]);
		expect((result.args as Record<string, unknown>).dir).toBe("public");
		expect((result.flags as Record<string, unknown>).port).toBe(8080);
	});

	it("resolveCommand resolves subcommands using CommandNode", () => {
		const result = resolveCommand(rootCmd._node, ["serve", "--port", "9000"]);
		expect(result.command.meta.name).toBe("serve");
		expect(result.argv).toEqual(["--port", "9000"]);
		expect(result.commandPath).toEqual(["myapp", "serve"]);
	});

	it("execute() runs using argv override", async () => {
		const result = await executeCrust(rootCmd, ["serve", "src", "--port", "4000"]);
		expect(result.stdout).toContain("serve src on 4000");
		expect(result.exitCode).toBe(0);
	});

	it("execute() catches errors and sets exit code", async () => {
		const failCmd = new Crust("fail").handle(() => {
			throw new Error("boom");
		});

		const result = await executeCrust(failCmd, []);
		expect(result.exitCode).toBe(1);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Exported types integration tests (existing)
// ────────────────────────────────────────────────────────────────────────────

describe("integration: exported types", () => {
	it("types are importable and usable", () => {
		const meta: CommandMeta = { name: "typed" };
		const argDef: ArgDef = { name: "name", type: "string" };
		const flagDef: FlagDef = { type: "boolean" };
		const namedFlagDef: NamedFlagDef = { name: "verbose", type: "boolean" };
		const argsDef: ArgsDef = [argDef];
		const flagsDef: FlagsDef = { verbose: flagDef };

		const parsed: ParseResult = {
			args: {},
			flags: {},
			rawArgs: [],
		};
		const resolved: CommandRoute = {
			command: new Crust("typed-cmd")._node,
			argv: [],
			commandPath: ["typed-cmd"],
		};

		type TestArgs = [{ name: "file"; type: "string"; required: true }];
		type ResolvedArgs = InferArgs<TestArgs>;
		const inferred: ResolvedArgs = { file: "index.ts" };
		const definition: CommandDefinition = defineCommand("typed", (command) => command);

		void definition;
		void meta;
		void argDef;
		void flagDef;
		void namedFlagDef;
		void argsDef;
		void flagsDef;
		void parsed;
		void resolved;
		expect(inferred.file).toBe("index.ts");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Inherited flag behavior — full pipeline integration tests
// ────────────────────────────────────────────────────────────────────────────

describe("integration: inherited boolean flag → subcommand receives it", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	const verbose = defineFlag("verbose", { type: "boolean", inherit: true });
	const app = new Crust("cli").flags(verbose).mount(
		defineCommand("sub", { flags: [verbose] }, (cmd) =>
			cmd.handle((ctx) => {
				console.log(`verbose=${ctx.flags.verbose}`);
			}),
		),
	);

	it("subcommand handler receives inherited boolean flag value", async () => {
		const result = await executeCrust(app, ["sub", "--verbose"]);
		expect(result.stdout).toContain("verbose=true");
		expect(result.exitCode).toBe(0);
	});

	it("inherited boolean flag defaults to undefined when not passed", async () => {
		const result = await executeCrust(app, ["sub"]);
		expect(result.stdout).toContain("verbose=undefined");
		expect(result.exitCode).toBe(0);
	});
});

describe("integration: inherited flag overridden by subcommand local flag", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("child override replaces inherited flag type (string → number)", async () => {
		const app = new Crust("cli").flags({ name: "output", type: "string", inherit: true }).mount(
			defineCommand("sub", (cmd) =>
				cmd.flags({ name: "output", type: "number", default: 42 }).handle((ctx) => {
					console.log(`output=${ctx.flags.output}`);
					console.log(`type=${typeof ctx.flags.output}`);
				}),
			),
		);

		const result = await executeCrust(app, ["sub"]);
		expect(result.stdout).toContain("output=42");
		expect(result.stdout).toContain("type=number");
		expect(result.exitCode).toBe(0);
	});

	it("child override replaces inherited flag and accepts new type value", async () => {
		const app = new Crust("cli").flags({ name: "output", type: "string", inherit: true }).mount(
			defineCommand("sub", (cmd) =>
				cmd.flags({ name: "output", type: "number" }).handle((ctx) => {
					console.log(`output=${ctx.flags.output}`);
				}),
			),
		);

		const result = await executeCrust(app, ["sub", "--output", "99"]);
		expect(result.stdout).toContain("output=99");
		expect(result.exitCode).toBe(0);
	});
});

describe("integration: deeply nested subcommand (3 levels) inherits flags", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("3-level deep subcommand receives root inherited flag", async () => {
		const verbose = defineFlag("verbose", { type: "boolean", inherit: true });
		const format = defineFlag("format", { type: "string", inherit: true });
		const app = new Crust("cli").flags(verbose).mount(
			defineCommand("level1", { flags: [verbose] }, (cmd) =>
				cmd.flags(format).mount(
					defineCommand("level2", { flags: [verbose, format] }, (cmd2) =>
						cmd2.mount(
							defineCommand("level3", { flags: [verbose, format] }, (cmd3) =>
								cmd3.handle((ctx) => {
									console.log(`verbose=${ctx.flags.verbose}`);
									console.log(`format=${ctx.flags.format}`);
								}),
							),
						),
					),
				),
			),
		);

		const result = await executeCrust(app, [
			"level1",
			"level2",
			"level3",
			"--verbose",
			"--format",
			"json",
		]);
		expect(result.stdout).toContain("verbose=true");
		expect(result.stdout).toContain("format=json");
		expect(result.exitCode).toBe(0);
	});

	it("3-level deep subcommand only inherits flags marked inherit: true", async () => {
		const verbose = defineFlag("verbose", { type: "boolean", inherit: true });
		const l1Inherit = defineFlag("l1Inherit", { type: "string", inherit: true });
		const app = new Crust("cli").flags(verbose, { name: "rootOnly", type: "string" }).mount(
			defineCommand("level1", { flags: [verbose] }, (cmd) =>
				cmd.flags(l1Inherit, { name: "l1Only", type: "number" }).mount(
					defineCommand("level2", { flags: [verbose, l1Inherit] }, (cmd2) =>
						cmd2.mount(
							defineCommand("level3", { flags: [verbose, l1Inherit] }, (cmd3) =>
								cmd3.handle((ctx) => {
									console.log(`verbose=${ctx.flags.verbose}`);
									console.log(`l1Inherit=${ctx.flags.l1Inherit}`);
								}),
							),
						),
					),
				),
			),
		);

		// verbose and l1Inherit should be recognized at level3
		const result = await executeCrust(app, [
			"level1",
			"level2",
			"level3",
			"--verbose",
			"--l1Inherit",
			"hello",
		]);
		expect(result.stdout).toContain("verbose=true");
		expect(result.stdout).toContain("l1Inherit=hello");
		expect(result.exitCode).toBe(0);
	});
});

describe("integration: non-inherit flag not visible to subcommand", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("passing non-inherited parent flag to subcommand causes error", async () => {
		const app = new Crust("cli")
			.flags(
				{ name: "verbose", type: "boolean", inherit: true },
				{ name: "rootOnly", type: "string" },
			)
			.mount(
				defineCommand("sub", (cmd) =>
					cmd.handle(() => {
						console.log("should not reach here");
					}),
				),
			);

		const result = await executeCrust(app, ["sub", "--rootOnly", "something"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Unknown flag");
	});

	it("non-inherited flag from level1 not visible to level2", async () => {
		const app = new Crust("cli").flags({ name: "global", type: "boolean", inherit: true }).mount(
			defineCommand("level1", (cmd) =>
				cmd
					.flags(
						{ name: "l1Local", type: "string" },
						{ name: "l1Shared", type: "string", inherit: true },
					)
					.mount(
						defineCommand("level2", (cmd2) =>
							cmd2.handle(() => {
								console.log("should not reach here");
							}),
						),
					),
			),
		);

		const result = await executeCrust(app, ["level1", "level2", "--l1Local", "val"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Unknown flag");
	});
});

describe("integration: required inherited flag enforced on subcommand", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	const token = defineFlag("token", { type: "string", required: true, inherit: true });
	const app = new Crust("cli").flags(token).mount(
		defineCommand("sub", { flags: [token] }, (cmd) =>
			cmd.handle((ctx) => {
				console.log(`token=${ctx.flags.token}`);
			}),
		),
	);

	it("missing required inherited flag on subcommand produces error", async () => {
		const result = await executeCrust(app, ["sub"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Missing required");
	});

	it("providing required inherited flag on subcommand succeeds", async () => {
		const result = await executeCrust(app, ["sub", "--token", "secret123"]);
		expect(result.stdout).toContain("token=secret123");
		expect(result.exitCode).toBe(0);
	});
});

describe("integration: inherited flag with default value on subcommand", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	const port = defineFlag("port", { type: "number", default: 3000, inherit: true });
	const app = new Crust("cli").flags(port).mount(
		defineCommand("sub", { flags: [port] }, (cmd) =>
			cmd.handle((ctx) => {
				console.log(`port=${ctx.flags.port}`);
			}),
		),
	);

	it("subcommand receives inherited flag default when not explicitly passed", async () => {
		const result = await executeCrust(app, ["sub"]);
		expect(result.stdout).toContain("port=3000");
		expect(result.exitCode).toBe(0);
	});

	it("subcommand inherits default and allows override", async () => {
		const result = await executeCrust(app, ["sub", "--port", "8080"]);
		expect(result.stdout).toContain("port=8080");
		expect(result.exitCode).toBe(0);
	});
});

describe("integration: inherited flag alias works on subcommand", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("inherited single-char alias is recognized on subcommand", async () => {
		const verbose = defineFlag("verbose", { type: "boolean", short: "v", inherit: true });
		const app = new Crust("cli").flags(verbose).mount(
			defineCommand("sub", { flags: [verbose] }, (cmd) =>
				cmd.handle((ctx) => {
					console.log(`verbose=${ctx.flags.verbose}`);
				}),
			),
		);

		const result = await executeCrust(app, ["sub", "-v"]);
		expect(result.stdout).toContain("verbose=true");
		expect(result.exitCode).toBe(0);
	});

	it("inherited multi-alias flag is recognized on subcommand", async () => {
		const output = defineFlag("output", {
			type: "string",
			short: "o",
			aliases: ["out"],
			inherit: true,
		});
		const app = new Crust("cli").flags(output).mount(
			defineCommand("sub", { flags: [output] }, (cmd) =>
				cmd.handle((ctx) => {
					console.log(`output=${ctx.flags.output}`);
				}),
			),
		);

		const resultO = await executeCrust(app, ["sub", "-o", "file.txt"]);
		expect(resultO.stdout).toContain("output=file.txt");
		expect(resultO.exitCode).toBe(0);

		const resultOut = await executeCrust(app, ["sub", "--out", "file.txt"]);
		expect(resultOut.stdout).toContain("output=file.txt");
		expect(resultOut.exitCode).toBe(0);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Full pipeline integration tests
// ────────────────────────────────────────────────────────────────────────────

describe("integration: .execute() full pipeline with argv override", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("full pipeline: root flags + args + subcommand routing + execution", async () => {
		const env = defineFlag("env", { type: "string", default: "staging", inherit: true });
		const dryRun = defineFlag("dryRun", { type: "boolean", inherit: true });
		const app = new Crust("deploy").flags(env, dryRun).mount(
			defineCommand("service", { flags: [env, dryRun] }, (cmd) =>
				cmd.args(defineArg("name", { type: "string", required: true })).handle((ctx) => {
					console.log(
						`deploy service=${ctx.args.name} env=${ctx.flags.env} dryRun=${ctx.flags.dryRun}`,
					);
				}),
			),
		);

		const result = await executeCrust(app, ["service", "api", "--env", "production", "--dryRun"]);
		expect(result.stdout).toContain("deploy service=api env=production dryRun=true");
		expect(result.exitCode).toBe(0);
	});
});

describe("integration: Context-owned flag → derived Context and descendant", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("routes before the subcommand and passes schema output to setup and handler", async () => {
		const schema: StandardSchema<string | undefined, number> = {
			"~standard": {
				version: 1,
				vendor: "test",
				validate: (value) => ({ value: Number(value) }),
			},
		};
		const apiKey = defineFlag("api-key", {
			type: "string",
			short: "k",
			aliases: ["token"],
			schema,
		});
		const auth = defineContext("auth", { ownFlags: [apiKey] }, ({ flags }) => ({
			credential: flags["api-key"],
		}));
		const deploy = defineCommand("deploy", { flags: [apiKey], ctx: [auth] }, (command) =>
			command.handle(({ flags, ctx }) => {
				console.log(`${typeof flags["api-key"]}:${ctx.auth.credential}`);
			}),
		);
		const app = new Crust("cli").provide(auth()).mount(deploy);

		const result = await executeCrust(app, ["--token=42", "deploy"]);
		expect(result.stdout).toContain("number:42");
		expect(result.exitCode).toBe(0);
	});
});

describe("integration: Extension adds flag visible to subcommand handler", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("Extension flag on root is parsed and available to root handler", async () => {
		const versionExtension = defineExtension("version-extension", {
			flags: {
				version: { type: "boolean", short: "V", recursive: false },
			},
		});

		const app = new Crust("cli").extend(versionExtension).handle((ctx) => {
			if ((ctx.flags as Record<string, unknown>).version) {
				console.log("v1.0.0");
			} else {
				console.log("running");
			}
		});

		const result = await executeCrust(app, ["--version"]);
		expect(result.stdout).toContain("v1.0.0");
		expect(result.exitCode).toBe(0);
	});

	it("Extension hooks run around subcommand execution", async () => {
		const order: string[] = [];
		const logging = defineExtension("logging", {
			hooks: {
				preRun: (ctx) => {
					order.push(`pre:${ctx.command.meta.name}`);
				},
				postRun: (ctx) => {
					order.push(`post:${ctx.command.meta.name}`);
				},
			},
		});
		const app = new Crust("cli").extend(logging).mount(
			defineCommand("sub", (cmd) =>
				cmd.handle(() => {
					order.push("sub:run");
				}),
			),
		);

		await executeCrust(app, ["sub"]);
		expect(order).toEqual(["pre:sub", "sub:run", "post:sub"]);
	});
});

describe("integration: nested mounted definitions end-to-end", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("3-level nested definitions execute correctly", async () => {
		const verbose = defineFlag("verbose", { type: "boolean", short: "v", inherit: true });
		const timeout = defineFlag("timeout", { type: "number", default: 30, inherit: true });
		const app = new Crust("git").flags(verbose).mount(
			defineCommand("remote", { flags: [verbose] }, (cmd) =>
				cmd.flags(timeout).mount(
					defineCommand("add", { flags: [verbose, timeout] }, (cmd2) =>
						cmd2.args({ name: "name", type: "string", required: true }).handle((ctx) => {
							console.log(
								`add remote=${ctx.args.name} verbose=${ctx.flags.verbose} timeout=${ctx.flags.timeout}`,
							);
						}),
					),
				),
			),
		);

		const result = await executeCrust(app, [
			"remote",
			"add",
			"origin",
			"--verbose",
			"--timeout",
			"60",
		]);
		expect(result.stdout).toContain("add remote=origin verbose=true timeout=60");
		expect(result.exitCode).toBe(0);
	});

	it("parent with run handler falls back when unknown subcommand given as positional", async () => {
		const app = new Crust("cli")
			.args({ name: "input", type: "string" })
			.handle((ctx) => {
				console.log(`root input=${ctx.args.input}`);
			})
			.mount(
				defineCommand("sub", (cmd) =>
					cmd.handle(() => {
						console.log("sub ran");
					}),
				),
			);

		// "unknown" is not a subcommand, so root handler runs with it as positional
		const result = await executeCrust(app, ["unknown"]);
		expect(result.stdout).toContain("root input=unknown");
		expect(result.exitCode).toBe(0);
	});
});

describe("integration: split-file definitions end-to-end", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	const verbose = defineFlag("verbose", { type: "boolean", inherit: true });
	const listCommand = defineCommand("list", { flags: [verbose] }, (command) =>
		command
			.flags({ name: "format", type: "string", default: "table" })
			.args({ name: "resource", type: "string", required: true })
			.handle(({ args, flags }) => {
				console.log(`list ${args.resource} format=${flags.format} verbose=${flags.verbose}`);
			}),
	);
	const getCommand = defineCommand("get", { flags: [verbose] }, (command) =>
		command
			.args(
				{ name: "resource", type: "string", required: true },
				{ name: "id", type: "string", required: true },
			)
			.handle(({ args, flags }) => {
				console.log(`get ${args.resource}/${args.id} verbose=${flags.verbose}`);
			}),
	);

	it("runs standalone definitions through the full pipeline", async () => {
		const app = new Crust("kubectl").flags(verbose).mount(listCommand, getCommand);

		const listResult = await executeCrust(app, ["list", "pods", "--verbose", "--format", "json"]);
		expect(listResult.stdout).toContain("list pods format=json verbose=true");
		expect(listResult.exitCode).toBe(0);

		const getResult = await executeCrust(app, ["get", "service", "nginx", "--verbose"]);
		expect(getResult.stdout).toContain("get service/nginx verbose=true");
		expect(getResult.exitCode).toBe(0);
	});

	it("reuses a definition across satisfying parents, renamed via .as()", async () => {
		const first = new Crust("first").flags(verbose).mount(listCommand);
		const second = new Crust("second")
			.flags({ ...verbose, default: true })
			.mount(listCommand.as("show"));

		expect((await executeCrust(first, ["list", "pods"])).stdout).toContain("verbose=undefined");
		expect((await executeCrust(second, ["show", "pods"])).stdout).toContain("verbose=true");
	});
});

describe("integration: mounted definitions", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	const verbose = defineFlag("verbose", { type: "boolean", inherit: true });

	it("mounts nested definitions end-to-end", async () => {
		const env = defineFlag("env", { type: "string", inherit: true });
		const status = defineCommand("status", { flags: [verbose, env] }, (command) =>
			command.handle(({ flags }) => {
				console.log(`verbose=${flags.verbose} env=${flags.env}`);
			}),
		);
		const deploy = defineCommand("deploy", { flags: [verbose] }, (command) =>
			command.flags(env).mount(status),
		);
		const app = new Crust("cli").flags(verbose).mount(deploy);

		const result = await executeCrust(app, ["deploy", "status", "--verbose", "--env", "staging"]);
		expect(result.stdout).toContain("verbose=true env=staging");
		expect(result.exitCode).toBe(0);
	});

	it("excludes non-inheritable flags from mounted commands", async () => {
		const sub = defineCommand("sub", (command) => command.handle(() => console.log("sub ran")));
		const app = new Crust("cli").flags({ name: "rootOnly", type: "string" }).mount(sub);

		const result = await executeCrust(app, ["sub", "--rootOnly", "val"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Unknown flag");
	});

	it("mounts multiple definitions in one call", async () => {
		const deploy = defineCommand("deploy", { flags: [verbose] }, (command) =>
			command.handle(({ flags }) => console.log(`deploy verbose=${flags.verbose}`)),
		);
		const status = defineCommand("status", { flags: [verbose] }, (command) =>
			command.handle(({ flags }) => console.log(`status verbose=${flags.verbose}`)),
		);
		const app = new Crust("cli").flags(verbose).mount(status, deploy);

		expect((await executeCrust(app, ["deploy", "--verbose"])).stdout).toContain(
			"deploy verbose=true",
		);
		expect((await executeCrust(app, ["status", "--verbose"])).stdout).toContain(
			"status verbose=true",
		);
	});
});

describe("integration: inherited boolean flag negation", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("--no-verbose negates inherited boolean flag on subcommand", async () => {
		const verbose = defineFlag("verbose", { type: "boolean", default: true, inherit: true });
		const app = new Crust("cli").flags(verbose).mount(
			defineCommand("sub", { flags: [verbose] }, (cmd) =>
				cmd.handle((ctx) => {
					console.log(`verbose=${ctx.flags.verbose}`);
				}),
			),
		);

		const result = await executeCrust(app, ["sub", "--no-verbose"]);
		expect(result.stdout).toContain("verbose=false");
		expect(result.exitCode).toBe(0);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Multiple value flags with inheritance
// ────────────────────────────────────────────────────────────────────────────

describe("integration: inherited multiple-value flag", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("inherited multiple-value flag collects values on subcommand", async () => {
		const tag = defineFlag("tag", { type: "string", multiple: true, inherit: true });
		const app = new Crust("cli").flags(tag).mount(
			defineCommand("sub", { flags: [tag] }, (cmd) =>
				cmd.handle((ctx) => {
					const tags = ctx.flags.tag;
					console.log(`tags=${JSON.stringify(tags)}`);
				}),
			),
		);

		const result = await executeCrust(app, ["sub", "--tag", "a", "--tag", "b", "--tag", "c"]);
		expect(result.stdout).toContain('tags=["a","b","c"]');
		expect(result.exitCode).toBe(0);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Separator (--) with inherited flags
// ────────────────────────────────────────────────────────────────────────────

describe("integration: separator (--) with subcommand and inherited flags", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("rawArgs captured correctly on subcommand with inherited flags", async () => {
		const verbose = defineFlag("verbose", { type: "boolean", inherit: true });
		const app = new Crust("cli").flags(verbose).mount(
			defineCommand("sub", { flags: [verbose] }, (cmd) =>
				cmd.handle((ctx) => {
					console.log(`verbose=${ctx.flags.verbose}`);
					console.log(`rawArgs=${JSON.stringify(ctx.rawArgs)}`);
				}),
			),
		);

		const result = await executeCrust(app, ["sub", "--verbose", "--", "extra1", "extra2"]);
		expect(result.stdout).toContain("verbose=true");
		expect(result.stdout).toContain('rawArgs=["extra1","extra2"]');
		expect(result.exitCode).toBe(0);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Complex real-world-like scenario
// ────────────────────────────────────────────────────────────────────────────

describe("integration: complex real-world CLI scenario", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("full CLI with global flags, multiple subcommands, plugins, and lifecycle hooks", async () => {
		const order: string[] = [];

		const auditExtension = defineExtension("audit", {
			hooks: {
				preRun: (ctx) => {
					order.push(`audit:${ctx.command.meta.name}`);
				},
			},
		});

		const verbose = defineFlag("verbose", { type: "boolean", short: "v", inherit: true });
		const config = defineFlag("config", { type: "string", default: "~/.myctl", inherit: true });

		const app = new Crust("myctl")
			.flags(verbose, config)
			.extend(auditExtension)
			.mount(
				defineCommand("deploy", { flags: [verbose, config] }, (cmd) =>
					cmd.flags({ name: "env", type: "string", required: true }).handle((ctx) => {
						order.push("deploy:run");
						console.log(
							`deploy env=${ctx.flags.env} verbose=${ctx.flags.verbose} config=${ctx.flags.config}`,
						);
					}),
				),
				defineCommand("status", { flags: [verbose, config] }, (cmd) =>
					cmd.handle((ctx) => {
						order.push("status:run");
						console.log(`status verbose=${ctx.flags.verbose} config=${ctx.flags.config}`);
					}),
				),
			);

		const deployResult = await executeCrust(app, [
			"deploy",
			"--env",
			"prod",
			"-v",
			"--config",
			"/etc/myctl",
		]);
		expect(deployResult.stdout).toContain("deploy env=prod verbose=true config=/etc/myctl");
		expect(deployResult.exitCode).toBe(0);
		expect(order).toEqual(["audit:deploy", "deploy:run"]);

		// Reset order for next test
		order.length = 0;

		const statusResult = await executeCrust(app, ["status", "-v"]);
		expect(statusResult.stdout).toContain("status verbose=true config=~/.myctl");
		expect(statusResult.exitCode).toBe(0);
		expect(order).toEqual(["audit:status", "status:run"]);
	});
});
