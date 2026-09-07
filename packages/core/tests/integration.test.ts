import { describe, expect, it } from "bun:test";

import type { StandardSchema } from "@crustjs/utils/schema";

import {
	Crust,
	defineArg,
	defineCommand,
	defineContext,
	defineExtension,
	defineExtensionId,
	defineFlag,
} from "../src/index.ts";
import { executeCrust } from "./helpers.ts";

// ────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ────────────────────────────────────────────────────────────────────────────

const rootBase = new Crust("myapp", { description: "Integration test app" }).flags({
	name: "help",
	type: "boolean",
	short: "h",
});

const serveCmd = defineCommand("serve", (command) =>
	command
		.args({ name: "dir", type: "string", default: "." })
		.flags({ name: "port", type: "number", default: 3000, short: "p" })
		.action(({ args, flags, stdout }) => {
			stdout(`serve ${args.dir} on ${flags.port}`);
		}),
);

const rootCmd = rootBase.add(serveCmd).action(({ flags, stdout }) => {
	if (flags.help) {
		stdout("help");
	}
});

// ────────────────────────────────────────────────────────────────────────────
// Core API integration tests (existing)
// ────────────────────────────────────────────────────────────────────────────

describe("integration: core APIs", () => {
	it("execute() runs using argv override", async () => {
		const result = await executeCrust(rootCmd, ["serve", "src", "--port", "4000"]);
		expect(result.stdout).toContain("serve src on 4000");
		expect(result.exitCode).toBe(0);
	});

	it("executeCrust captures failures even when the prior exit code is already nonzero", async () => {
		const failCmd = new Crust("fail").action(() => {
			throw new Error("boom");
		});

		const originalExitCode = process.exitCode;
		process.exitCode = 1;
		try {
			const result = await executeCrust(failCmd, []);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("boom");
			expect(process.exitCode).toBe(1);
		} finally {
			process.exitCode = originalExitCode ?? 0;
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Context-owned flag behavior — full pipeline integration tests
// ────────────────────────────────────────────────────────────────────────────

describe("integration: .execute() full pipeline with argv override", () => {
	it("full pipeline: root flags + args + subcommand routing + execution", async () => {
		const env = defineFlag("env", { type: "string", default: "staging" });
		const dryRun = defineFlag("dryRun", { type: "boolean" });
		const deployment = defineContext("deployment", { flags: [env, dryRun] }, ({ flags }) => flags);
		const app = new Crust("deploy").provide(deployment()).add(
			defineCommand("service", (cmd) =>
				cmd
					.use(deployment)
					.args(defineArg("name", { type: "string", required: true }))
					.action(async ({ args, ctx, stdout }) => {
						const config = await ctx.deployment;
						stdout(`deploy service=${args.name} env=${config.env} dryRun=${config.dryRun}`);
					}),
			),
		);

		const result = await executeCrust(app, ["service", "api", "--env", "production", "--dryRun"]);
		expect(result.stdout).toContain("deploy service=api env=production dryRun=true");
		expect(result.exitCode).toBe(0);
	});
});

describe("integration: Context-owned flag → derived Context and descendant", () => {
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
		const deploy = defineCommand("deploy", (command) =>
			command.use(auth).action(async ({ ctx, stdout }) => {
				const identity = await ctx.auth;
				stdout(`${identity.credential.constructor.name.toLowerCase()}:${identity.credential}`);
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
				defineCommand("group", (group) =>
					group
						.use(logging)
						.add(
							defineCommand("deploy", (deploy) =>
								deploy
									.use(logging)
									.action(async ({ ctx, stdout }) =>
										stdout(`verbose=${(await ctx.logging).verbose}`),
									),
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
				defineCommand("render", (command) =>
					command
						.use(outputConfig)
						.action(async ({ ctx, stdout }) =>
							stdout(`output=${(await ctx["output-config"]).output}`),
						),
				),
			);

		const result = await executeCrust(app, ["render", "--out", "json"]);
		expect(result.stdout).toContain("output=json");
		expect(result.exitCode).toBe(0);
	});

	it("accepts an owned flag of an unrequired Context without constructing it", async () => {
		let built = 0;
		const token = defineFlag("token", { type: "string" });
		const auth = defineContext("auth", { flags: [token] }, ({ flags }) => {
			built++;
			return flags;
		});
		const app = new Crust("cli").provide(auth()).add(
			defineCommand("deploy", (command) =>
				command.action(({ flags, stdout }) => {
					stdout(`token=${String((flags as { token?: string }).token)}`);
				}),
			),
		);

		const result = await executeCrust(app, ["deploy", "--token", "secret"]);
		expect(result.stdout).toContain("token=secret");
		expect(result.exitCode).toBe(0);
		expect(built).toBe(0);
	});
});

describe("integration: Extension adds flag visible to subcommand action", () => {
	it("Extension flag on root is parsed and available to root action", async () => {
		const versionFlag = defineExtension(defineExtensionId("version-extension"), {
			flags: [{ name: "version", type: "boolean", short: "V", recursive: false }],
		});

		const app = new Crust("cli").extend(versionFlag).action((ctx) => {
			if (ctx.flags.version) {
				ctx.stdout("v1.0.0");
			} else {
				ctx.stdout("running");
			}
		});

		const result = await executeCrust(app, ["--version"]);
		expect(result.stdout).toContain("v1.0.0");
		expect(result.exitCode).toBe(0);
	});

	it("Extension hooks run around subcommand execution", async () => {
		const order: string[] = [];
		const logging = defineExtension(defineExtensionId("logging"), {
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
	it("3-level nested definitions execute correctly", async () => {
		const verbose = defineFlag("verbose", { type: "boolean", short: "v" });
		const timeout = defineFlag("timeout", { type: "number", default: 30 });
		const logging = defineContext("logging", { flags: [verbose] }, ({ flags }) => flags);
		const remoteConfig = defineContext("remote-config", { flags: [timeout] }, ({ flags }) => flags);
		const app = new Crust("git").provide(logging()).add(
			defineCommand("remote", (cmd) =>
				cmd
					.use(logging)
					.provide(remoteConfig())
					.add(
						defineCommand("add", (cmd2) =>
							cmd2
								.use(logging)
								.use(remoteConfig)
								.args({ name: "name", type: "string", required: true })
								.action(async ({ args, ctx, stdout }) => {
									stdout(
										`add remote=${args.name} verbose=${(await ctx.logging).verbose} timeout=${(await ctx["remote-config"]).timeout}`,
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
				ctx.stdout(`root input=${ctx.args.input}`);
			})
			.add(
				defineCommand("sub", (cmd) =>
					cmd.action(({ stdout }) => {
						stdout("sub ran");
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
	const verbose = defineFlag("verbose", { type: "boolean" });
	const logging = defineContext("logging", { flags: [verbose] }, ({ flags }) => flags);
	const listCommand = defineCommand("list", (command) =>
		command
			.use(logging)
			.flags({ name: "format", type: "string", default: "table" })
			.args({ name: "resource", type: "string", required: true })
			.action(async ({ args, flags, ctx, stdout }) => {
				stdout(
					`list ${args.resource} format=${flags.format} verbose=${(await ctx.logging).verbose}`,
				);
			}),
	);
	const getCommand = defineCommand("get", (command) =>
		command
			.use(logging)
			.args(
				{ name: "resource", type: "string", required: true },
				{ name: "id", type: "string", required: true },
			)
			.action(async ({ args, ctx, stdout }) => {
				stdout(`get ${args.resource}/${args.id} verbose=${(await ctx.logging).verbose}`);
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
	const verbose = defineFlag("verbose", { type: "boolean" });

	it("adds nested definitions end-to-end", async () => {
		const env = defineFlag("env", { type: "string" });
		const logging = defineContext("logging", { flags: [verbose] }, ({ flags }) => flags);
		const deployment = defineContext("deployment", { flags: [env] }, ({ flags }) => flags);
		const status = defineCommand("status", (command) =>
			command
				.use(logging)
				.use(deployment)
				.action(async ({ ctx, stdout }) => {
					stdout(`verbose=${(await ctx.logging).verbose} env=${(await ctx.deployment).env}`);
				}),
		);
		const deploy = defineCommand("deploy", (command) =>
			command.use(logging).provide(deployment()).add(status),
		);
		const app = new Crust("cli").provide(logging()).add(deploy);

		const result = await executeCrust(app, ["deploy", "status", "--verbose", "--env", "staging"]);
		expect(result.stdout).toContain("verbose=true env=staging");
		expect(result.exitCode).toBe(0);
	});
});

describe("integration: Context-owned boolean flag negation", () => {
	it("--no-verbose negates a Context-owned boolean flag on a subcommand", async () => {
		const verbose = defineFlag("verbose", { type: "boolean", default: true });
		const logging = defineContext("logging", { flags: [verbose] }, ({ flags }) => flags);
		const app = new Crust("cli").provide(logging()).add(
			defineCommand("sub", (cmd) =>
				cmd.use(logging).action(async ({ ctx, stdout }) => {
					stdout(`verbose=${(await ctx.logging).verbose}`);
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
	it("Context-owned multiple-value flag collects values on a subcommand", async () => {
		const tag = defineFlag("tag", { type: "string", multiple: true });
		const tags = defineContext("tags", { flags: [tag] }, ({ flags }) => flags);
		const app = new Crust("cli").provide(tags()).add(
			defineCommand("sub", (cmd) =>
				cmd.use(tags).action(async ({ ctx, stdout }) => {
					stdout(`tags=${JSON.stringify((await ctx.tags).tag)}`);
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
	it("rawArgs captured correctly on a subcommand with Context-owned flags", async () => {
		const verbose = defineFlag("verbose", { type: "boolean" });
		const logging = defineContext("logging", { flags: [verbose] }, ({ flags }) => flags);
		const app = new Crust("cli").provide(logging()).add(
			defineCommand("sub", (cmd) =>
				cmd.use(logging).action(async ({ ctx, rawArgs, stdout }) => {
					stdout(`verbose=${(await ctx.logging).verbose}`);
					stdout(`rawArgs=${JSON.stringify(rawArgs)}`);
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
	it("full CLI with global flags, multiple subcommands, extensions, and lifecycle hooks", async () => {
		const order: string[] = [];

		const auditExtension = defineExtension(defineExtensionId("audit"), {
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
				defineCommand("deploy", (cmd) =>
					cmd
						.use(settings)
						.flags({ name: "env", type: "string", required: true })
						.action(async ({ flags, ctx, stdout }) => {
							const config = await ctx.settings;
							order.push("deploy:run");
							stdout(`deploy env=${flags.env} verbose=${config.verbose} config=${config.config}`);
						}),
				),
				defineCommand("status", (cmd) =>
					cmd.use(settings).action(async ({ ctx, stdout }) => {
						const config = await ctx.settings;
						order.push("status:run");
						stdout(`status verbose=${config.verbose} config=${config.config}`);
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
