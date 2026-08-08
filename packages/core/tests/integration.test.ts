import { beforeEach, describe, expect, it } from "bun:test";

import type { StandardSchema } from "@crustjs/utils/schema";

import { createCommandNode } from "../src/command/node";
import type { CommandRoute } from "../src/command/router";
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
		.action(({ args, flags }) => {
			console.log(`serve ${args.dir} on ${flags.port}`);
		}),
);

const rootCmd = rootBase.add(serveCmd).action(({ flags }) => {
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

	it("execute() runs using argv override", async () => {
		const result = await executeCrust(rootCmd, ["serve", "src", "--port", "4000"]);
		expect(result.stdout).toContain("serve src on 4000");
		expect(result.exitCode).toBe(0);
	});

	it("execute() catches errors and sets exit code", async () => {
		const failCmd = new Crust("fail").action(() => {
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
			command: createCommandNode("typed-cmd"),
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
// Context-owned flag behavior — full pipeline integration tests
// ────────────────────────────────────────────────────────────────────────────

describe("integration: .execute() full pipeline with argv override", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("full pipeline: root flags + args + subcommand routing + execution", async () => {
		const env = defineFlag("env", { type: "string", default: "staging" });
		const dryRun = defineFlag("dryRun", { type: "boolean" });
		const deployment = defineContext("deployment", { flags: [env, dryRun] }, ({ flags }) => flags);
		const app = new Crust("deploy").provide(deployment()).add(
			defineCommand("service", { requires: [deployment] }, (cmd) =>
				cmd.args(defineArg("name", { type: "string", required: true })).action(({ args, ctx }) => {
					console.log(
						`deploy service=${args.name} env=${ctx.deployment.env} dryRun=${ctx.deployment.dryRun}`,
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

	it("routes before the subcommand and passes schema output to setup and action", async () => {
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
		const auth = defineContext("auth", { flags: [apiKey] }, ({ flags }) => ({
			credential: flags["api-key"],
		}));
		const deploy = defineCommand("deploy", { requires: [auth] }, (command) =>
			command.action(({ ctx }) => {
				console.log(`${typeof ctx.auth.credential}:${ctx.auth.credential}`);
			}),
		);
		const app = new Crust("cli").provide(auth()).add(deploy);

		const result = await executeCrust(app, ["--token=42", "deploy"]);
		expect(result.stdout).toContain("number:42");
		expect(result.exitCode).toBe(0);
	});

	it("routes Context-owned flags at a mid-path position without propagating parent locals", async () => {
		const verbose = defineFlag("verbose", { type: "boolean" });
		const logging = defineContext("logging", { flags: [verbose] }, ({ flags }) => ({
			verbose: flags.verbose === true,
		}));
		const app = new Crust("cli")
			.flags({ name: "root-only", type: "boolean" })
			.provide(logging())
			.add(
				defineCommand("group", { requires: [logging] }, (group) =>
					group.add(
						defineCommand("deploy", { requires: [logging] }, (deploy) =>
							deploy.action(({ ctx }) => console.log(`verbose=${ctx.logging.verbose}`)),
						),
					),
				),
			);

		expect((await executeCrust(app, ["group", "--verbose", "deploy"])).stdout).toContain(
			"verbose=true",
		);
		const localResult = await executeCrust(app, ["group", "deploy", "--root-only"]);
		expect(localResult.exitCode).toBe(1);
		expect(localResult.stderr).toContain("Unknown flag");
	});

	it("enforces a required Context-owned flag on a descendant", async () => {
		const token = defineFlag("token", { type: "string", required: true });
		const auth = defineContext("auth", { flags: [token] }, () => ({}));
		const app = new Crust("cli")
			.provide(auth())
			.add(defineCommand("deploy", (command) => command.action(() => {})));

		const result = await executeCrust(app, ["deploy"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('Missing required flag "--token"');
	});

	it("parses a Context-owned long alias on a descendant", async () => {
		const output = defineFlag("output", { type: "string", aliases: ["out"] });
		const outputConfig = defineContext("output-config", { flags: [output] }, ({ flags }) => flags);
		const app = new Crust("cli")
			.provide(outputConfig())
			.add(
				defineCommand("render", { requires: [outputConfig] }, (command) =>
					command.action(({ ctx }) => console.log(`output=${ctx["output-config"].output}`)),
				),
			);

		const result = await executeCrust(app, ["render", "--out", "json"]);
		expect(result.stdout).toContain("output=json");
		expect(result.exitCode).toBe(0);
	});
});

describe("integration: Extension adds flag visible to subcommand action", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("Extension flag on root is parsed and available to root action", async () => {
		const versionExtension = defineExtension("version-extension", {
			flags: {
				version: { type: "boolean", short: "V", recursive: false },
			},
		});

		const app = new Crust("cli").extend(versionExtension).action((ctx) => {
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
		const app = new Crust("cli").extend(logging).add(
			defineCommand("sub", (cmd) =>
				cmd.action(() => {
					order.push("sub:run");
				}),
			),
		);

		await executeCrust(app, ["sub"]);
		expect(order).toEqual(["pre:sub", "sub:run", "post:sub"]);
	});
});

describe("integration: nested added definitions end-to-end", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("3-level nested definitions execute correctly", async () => {
		const verbose = defineFlag("verbose", { type: "boolean", short: "v" });
		const timeout = defineFlag("timeout", { type: "number", default: 30 });
		const logging = defineContext("logging", { flags: [verbose] }, ({ flags }) => flags);
		const remoteConfig = defineContext("remote-config", { flags: [timeout] }, ({ flags }) => flags);
		const app = new Crust("git").provide(logging()).add(
			defineCommand("remote", { requires: [logging] }, (cmd) =>
				cmd.provide(remoteConfig()).add(
					defineCommand("add", { requires: [logging, remoteConfig] }, (cmd2) =>
						cmd2.args({ name: "name", type: "string", required: true }).action(({ args, ctx }) => {
							console.log(
								`add remote=${args.name} verbose=${ctx.logging.verbose} timeout=${ctx["remote-config"].timeout}`,
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

	it("parent with an action falls back when unknown subcommand given as positional", async () => {
		const app = new Crust("cli")
			.args({ name: "input", type: "string" })
			.action((ctx) => {
				console.log(`root input=${ctx.args.input}`);
			})
			.add(
				defineCommand("sub", (cmd) =>
					cmd.action(() => {
						console.log("sub ran");
					}),
				),
			);

		// "unknown" is not a subcommand, so root action runs with it as positional
		const result = await executeCrust(app, ["unknown"]);
		expect(result.stdout).toContain("root input=unknown");
		expect(result.exitCode).toBe(0);
	});
});

describe("integration: split-file definitions end-to-end", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	const verbose = defineFlag("verbose", { type: "boolean" });
	const logging = defineContext("logging", { flags: [verbose] }, ({ flags }) => flags);
	const listCommand = defineCommand("list", { requires: [logging] }, (command) =>
		command
			.flags({ name: "format", type: "string", default: "table" })
			.args({ name: "resource", type: "string", required: true })
			.action(({ args, flags, ctx }) => {
				console.log(`list ${args.resource} format=${flags.format} verbose=${ctx.logging.verbose}`);
			}),
	);
	const getCommand = defineCommand("get", { requires: [logging] }, (command) =>
		command
			.args(
				{ name: "resource", type: "string", required: true },
				{ name: "id", type: "string", required: true },
			)
			.action(({ args, ctx }) => {
				console.log(`get ${args.resource}/${args.id} verbose=${ctx.logging.verbose}`);
			}),
	);

	it("runs standalone definitions through the full pipeline", async () => {
		const app = new Crust("kubectl").provide(logging()).add(listCommand, getCommand);

		const listResult = await executeCrust(app, ["list", "pods", "--verbose", "--format", "json"]);
		expect(listResult.stdout).toContain("list pods format=json verbose=true");
		expect(listResult.exitCode).toBe(0);

		const getResult = await executeCrust(app, ["get", "service", "nginx", "--verbose"]);
		expect(getResult.stdout).toContain("get service/nginx verbose=true");
		expect(getResult.exitCode).toBe(0);
	});

	it("reuses a definition across satisfying parents, renamed via .as()", async () => {
		const first = new Crust("first").provide(logging()).add(listCommand);
		const defaultLogging = defineContext(
			"logging",
			{ flags: [{ ...verbose, default: true }] },
			({ flags }) => flags,
		);
		const second = new Crust("second").provide(defaultLogging()).add(listCommand.as("show"));

		expect((await executeCrust(first, ["list", "pods"])).stdout).toContain("verbose=undefined");
		expect((await executeCrust(second, ["show", "pods"])).stdout).toContain("verbose=true");
	});
});

describe("integration: added definitions", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	const verbose = defineFlag("verbose", { type: "boolean" });

	it("adds nested definitions end-to-end", async () => {
		const env = defineFlag("env", { type: "string" });
		const logging = defineContext("logging", { flags: [verbose] }, ({ flags }) => flags);
		const deployment = defineContext("deployment", { flags: [env] }, ({ flags }) => flags);
		const status = defineCommand("status", { requires: [logging, deployment] }, (command) =>
			command.action(({ ctx }) => {
				console.log(`verbose=${ctx.logging.verbose} env=${ctx.deployment.env}`);
			}),
		);
		const deploy = defineCommand("deploy", { requires: [logging] }, (command) =>
			command.provide(deployment()).add(status),
		);
		const app = new Crust("cli").provide(logging()).add(deploy);

		const result = await executeCrust(app, ["deploy", "status", "--verbose", "--env", "staging"]);
		expect(result.stdout).toContain("verbose=true env=staging");
		expect(result.exitCode).toBe(0);
	});

	it("excludes parent-local flags from added commands", async () => {
		const sub = defineCommand("sub", (command) => command.action(() => console.log("sub ran")));
		const app = new Crust("cli").flags({ name: "rootOnly", type: "string" }).add(sub);

		const result = await executeCrust(app, ["sub", "--rootOnly", "val"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Unknown flag");
	});

	it("adds multiple definitions in one call", async () => {
		const logging = defineContext("logging", { flags: [verbose] }, ({ flags }) => flags);
		const deploy = defineCommand("deploy", { requires: [logging] }, (command) =>
			command.action(({ ctx }) => console.log(`deploy verbose=${ctx.logging.verbose}`)),
		);
		const status = defineCommand("status", { requires: [logging] }, (command) =>
			command.action(({ ctx }) => console.log(`status verbose=${ctx.logging.verbose}`)),
		);
		const app = new Crust("cli").provide(logging()).add(status, deploy);

		expect((await executeCrust(app, ["deploy", "--verbose"])).stdout).toContain(
			"deploy verbose=true",
		);
		expect((await executeCrust(app, ["status", "--verbose"])).stdout).toContain(
			"status verbose=true",
		);
	});
});

describe("integration: Context-owned boolean flag negation", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("--no-verbose negates a Context-owned boolean flag on a subcommand", async () => {
		const verbose = defineFlag("verbose", { type: "boolean", default: true });
		const logging = defineContext("logging", { flags: [verbose] }, ({ flags }) => flags);
		const app = new Crust("cli").provide(logging()).add(
			defineCommand("sub", { requires: [logging] }, (cmd) =>
				cmd.action(({ ctx }) => {
					console.log(`verbose=${ctx.logging.verbose}`);
				}),
			),
		);

		const result = await executeCrust(app, ["sub", "--no-verbose"]);
		expect(result.stdout).toContain("verbose=false");
		expect(result.exitCode).toBe(0);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Multiple-value Context-owned flags
// ────────────────────────────────────────────────────────────────────────────

describe("integration: Context-owned multiple-value flag", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("Context-owned multiple-value flag collects values on a subcommand", async () => {
		const tag = defineFlag("tag", { type: "string", multiple: true });
		const tags = defineContext("tags", { flags: [tag] }, ({ flags }) => flags);
		const app = new Crust("cli").provide(tags()).add(
			defineCommand("sub", { requires: [tags] }, (cmd) =>
				cmd.action(({ ctx }) => {
					console.log(`tags=${JSON.stringify(ctx.tags.tag)}`);
				}),
			),
		);

		const result = await executeCrust(app, ["sub", "--tag", "a", "--tag", "b", "--tag", "c"]);
		expect(result.stdout).toContain('tags=["a","b","c"]');
		expect(result.exitCode).toBe(0);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Separator (--) with Context-owned flags
// ────────────────────────────────────────────────────────────────────────────

describe("integration: separator (--) with subcommand and Context-owned flags", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("rawArgs captured correctly on a subcommand with Context-owned flags", async () => {
		const verbose = defineFlag("verbose", { type: "boolean" });
		const logging = defineContext("logging", { flags: [verbose] }, ({ flags }) => flags);
		const app = new Crust("cli").provide(logging()).add(
			defineCommand("sub", { requires: [logging] }, (cmd) =>
				cmd.action(({ ctx, rawArgs }) => {
					console.log(`verbose=${ctx.logging.verbose}`);
					console.log(`rawArgs=${JSON.stringify(rawArgs)}`);
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

		const verbose = defineFlag("verbose", { type: "boolean", short: "v" });
		const config = defineFlag("config", { type: "string", default: "~/.myctl" });

		const settings = defineContext("settings", { flags: [verbose, config] }, ({ flags }) => flags);
		const app = new Crust("myctl")
			.provide(settings())
			.extend(auditExtension)
			.add(
				defineCommand("deploy", { requires: [settings] }, (cmd) =>
					cmd.flags({ name: "env", type: "string", required: true }).action(({ flags, ctx }) => {
						order.push("deploy:run");
						console.log(
							`deploy env=${flags.env} verbose=${ctx.settings.verbose} config=${ctx.settings.config}`,
						);
					}),
				),
				defineCommand("status", { requires: [settings] }, (cmd) =>
					cmd.action(({ ctx }) => {
						order.push("status:run");
						console.log(`status verbose=${ctx.settings.verbose} config=${ctx.settings.config}`);
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
