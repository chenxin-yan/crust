import { beforeEach, describe, expect, it } from "bun:test";
import type {
	ArgDef,
	ArgsDef,
	CommandMeta,
	CommandRoute,
	FlagDef,
	FlagsDef,
	InferArgs,
	ParseResult,
} from "../src/index";
import { Crust, parseArgs, resolveCommand } from "../src/index";
import type { CrustPlugin } from "../src/plugins";
import { executeCrust } from "./helpers";

// ────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ────────────────────────────────────────────────────────────────────────────

const serveCmd = new Crust("serve")
	.args([{ name: "dir", type: "string", default: "." }] as const)
	.flags({
		port: { type: "number", default: 3000, short: "p" },
	} as const)
	.run(({ args, flags }) => {
		console.log(`serve ${args.dir} on ${flags.port}`);
	});

const rootCmd = new Crust("myapp")
	.meta({ description: "Integration test app" })
	.flags({
		help: { type: "boolean", short: "h" },
	} as const)
	.command("serve", () => serveCmd)
	.run(({ flags }) => {
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
		const result = parseArgs(serveCmd._node, ["public", "--port", "8080"]);
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
		const result = await executeCrust(rootCmd, [
			"serve",
			"src",
			"--port",
			"4000",
		]);
		expect(result.stdout).toContain("serve src on 4000");
		expect(result.exitCode).toBe(0);
	});

	it("execute() catches errors and sets exit code", async () => {
		const failCmd = new Crust("fail").run(() => {
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

		void meta;
		void argDef;
		void flagDef;
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

	it("subcommand handler receives inherited boolean flag value", async () => {
		const app = new Crust("cli")
			.flags({
				verbose: { type: "boolean", inherit: true },
			})
			.command("sub", (cmd) =>
				cmd.run((ctx) => {
					console.log(`verbose=${ctx.flags.verbose}`);
				}),
			);

		const result = await executeCrust(app, ["sub", "--verbose"]);
		expect(result.stdout).toContain("verbose=true");
		expect(result.exitCode).toBe(0);
	});

	it("inherited boolean flag defaults to undefined when not passed", async () => {
		const app = new Crust("cli")
			.flags({
				verbose: { type: "boolean", inherit: true },
			})
			.command("sub", (cmd) =>
				cmd.run((ctx) => {
					console.log(`verbose=${ctx.flags.verbose}`);
				}),
			);

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
		const app = new Crust("cli")
			.flags({
				output: { type: "string", inherit: true },
			})
			.command("sub", (cmd) =>
				cmd.flags({ output: { type: "number", default: 42 } }).run((ctx) => {
					console.log(`output=${ctx.flags.output}`);
					console.log(`type=${typeof ctx.flags.output}`);
				}),
			);

		const result = await executeCrust(app, ["sub"]);
		expect(result.stdout).toContain("output=42");
		expect(result.stdout).toContain("type=number");
		expect(result.exitCode).toBe(0);
	});

	it("child override replaces inherited flag and accepts new type value", async () => {
		const app = new Crust("cli")
			.flags({
				output: { type: "string", inherit: true },
			})
			.command("sub", (cmd) =>
				cmd.flags({ output: { type: "number" } }).run((ctx) => {
					console.log(`output=${ctx.flags.output}`);
				}),
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
		const app = new Crust("cli")
			.flags({
				verbose: { type: "boolean", inherit: true },
			})
			.command("level1", (cmd) =>
				cmd
					.flags({ format: { type: "string", inherit: true } })
					.command("level2", (cmd2) =>
						cmd2.command("level3", (cmd3) =>
							cmd3.run((ctx) => {
								console.log(`verbose=${ctx.flags.verbose}`);
								console.log(`format=${ctx.flags.format}`);
							}),
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
		const app = new Crust("cli")
			.flags({
				verbose: { type: "boolean", inherit: true },
				rootOnly: { type: "string" },
			})
			.command("level1", (cmd) =>
				cmd
					.flags({
						l1Inherit: { type: "string", inherit: true },
						l1Only: { type: "number" },
					})
					.command("level2", (cmd2) =>
						cmd2.command("level3", (cmd3) =>
							cmd3.run((ctx) => {
								console.log(`verbose=${ctx.flags.verbose}`);
								console.log(`l1Inherit=${ctx.flags.l1Inherit}`);
							}),
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
			.flags({
				verbose: { type: "boolean", inherit: true },
				rootOnly: { type: "string" },
			})
			.command("sub", (cmd) =>
				cmd.run(() => {
					console.log("should not reach here");
				}),
			);

		const result = await executeCrust(app, ["sub", "--rootOnly", "something"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Unknown flag");
	});

	it("non-inherited flag from level1 not visible to level2", async () => {
		const app = new Crust("cli")
			.flags({
				global: { type: "boolean", inherit: true },
			})
			.command("level1", (cmd) =>
				cmd
					.flags({
						l1Local: { type: "string" },
						l1Shared: { type: "string", inherit: true },
					})
					.command("level2", (cmd2) =>
						cmd2.run(() => {
							console.log("should not reach here");
						}),
					),
			);

		const result = await executeCrust(app, [
			"level1",
			"level2",
			"--l1Local",
			"val",
		]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Unknown flag");
	});
});

describe("integration: required inherited flag enforced on subcommand", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("missing required inherited flag on subcommand produces error", async () => {
		const app = new Crust("cli")
			.flags({
				token: { type: "string", required: true, inherit: true },
			})
			.command("sub", (cmd) =>
				cmd.run((ctx) => {
					console.log(`token=${ctx.flags.token}`);
				}),
			);

		const result = await executeCrust(app, ["sub"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Missing required");
	});

	it("providing required inherited flag on subcommand succeeds", async () => {
		const app = new Crust("cli")
			.flags({
				token: { type: "string", required: true, inherit: true },
			})
			.command("sub", (cmd) =>
				cmd.run((ctx) => {
					console.log(`token=${ctx.flags.token}`);
				}),
			);

		const result = await executeCrust(app, ["sub", "--token", "secret123"]);
		expect(result.stdout).toContain("token=secret123");
		expect(result.exitCode).toBe(0);
	});
});

describe("integration: inherited flag with default value on subcommand", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("subcommand receives inherited flag default when not explicitly passed", async () => {
		const app = new Crust("cli")
			.flags({
				port: { type: "number", default: 3000, inherit: true },
			})
			.command("sub", (cmd) =>
				cmd.run((ctx) => {
					console.log(`port=${ctx.flags.port}`);
				}),
			);

		const result = await executeCrust(app, ["sub"]);
		expect(result.stdout).toContain("port=3000");
		expect(result.exitCode).toBe(0);
	});

	it("subcommand inherits default and allows override", async () => {
		const app = new Crust("cli")
			.flags({
				port: { type: "number", default: 3000, inherit: true },
			})
			.command("sub", (cmd) =>
				cmd.run((ctx) => {
					console.log(`port=${ctx.flags.port}`);
				}),
			);

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
		const app = new Crust("cli")
			.flags({
				verbose: { type: "boolean", short: "v", inherit: true },
			})
			.command("sub", (cmd) =>
				cmd.run((ctx) => {
					console.log(`verbose=${ctx.flags.verbose}`);
				}),
			);

		const result = await executeCrust(app, ["sub", "-v"]);
		expect(result.stdout).toContain("verbose=true");
		expect(result.exitCode).toBe(0);
	});

	it("inherited multi-alias flag is recognized on subcommand", async () => {
		const app = new Crust("cli")
			.flags({
				output: {
					type: "string",
					short: "o",
					aliases: ["out"],
					inherit: true,
				},
			})
			.command("sub", (cmd) =>
				cmd.run((ctx) => {
					console.log(`output=${ctx.flags.output}`);
				}),
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
		const app = new Crust("deploy")
			.flags({
				env: { type: "string", default: "staging", inherit: true },
				dryRun: { type: "boolean", inherit: true },
			})
			.command("service", (cmd) =>
				cmd
					.args([{ name: "name", type: "string", required: true }] as const)
					.run((ctx) => {
						console.log(
							`deploy service=${ctx.args.name} env=${ctx.flags.env} dryRun=${ctx.flags.dryRun}`,
						);
					}),
			);

		const result = await executeCrust(app, [
			"service",
			"api",
			"--env",
			"production",
			"--dryRun",
		]);
		expect(result.stdout).toContain(
			"deploy service=api env=production dryRun=true",
		);
		expect(result.exitCode).toBe(0);
	});

	it("full pipeline: lifecycle hooks run in order through pipeline", async () => {
		const order: string[] = [];

		const app = new Crust("cli")
			.preRun(() => {
				order.push("preRun");
			})
			.run(() => {
				order.push("run");
			})
			.postRun(() => {
				order.push("postRun");
			});

		await executeCrust(app, []);
		expect(order).toEqual(["preRun", "run", "postRun"]);
	});
});

describe("integration: plugin adds flag visible to subcommand handler", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("plugin-added flag on root is parsed and available to root handler", async () => {
		const versionPlugin: CrustPlugin = {
			name: "version-plugin",
			setup: (ctx, actions) => {
				actions.addFlag(ctx.rootCommand, "version", {
					type: "boolean",
					short: "V",
				});
			},
		};

		const app = new Crust("cli").use(versionPlugin).run((ctx) => {
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

	it("plugin middleware wraps subcommand execution", async () => {
		const order: string[] = [];

		const loggingPlugin: CrustPlugin = {
			name: "logging",
			middleware: async (ctx, next) => {
				order.push(`middleware:before:${ctx.route?.command.meta.name}`);
				await next();
				order.push(`middleware:after:${ctx.route?.command.meta.name}`);
			},
		};

		const app = new Crust("cli").use(loggingPlugin).command("sub", (cmd) =>
			cmd.run(() => {
				order.push("sub:run");
			}),
		);

		await executeCrust(app, ["sub"]);
		expect(order).toEqual([
			"middleware:before:sub",
			"sub:run",
			"middleware:after:sub",
		]);
	});
});

describe("integration: inline nested .command() chains end-to-end", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("3-level inline chained commands execute correctly", async () => {
		const app = new Crust("git")
			.flags({
				verbose: { type: "boolean", short: "v", inherit: true },
			})
			.command("remote", (cmd) =>
				cmd
					.flags({ timeout: { type: "number", default: 30, inherit: true } })
					.command("add", (cmd2) =>
						cmd2
							.args([{ name: "name", type: "string", required: true }] as const)
							.run((ctx) => {
								console.log(
									`add remote=${ctx.args.name} verbose=${ctx.flags.verbose} timeout=${ctx.flags.timeout}`,
								);
							}),
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
		expect(result.stdout).toContain(
			"add remote=origin verbose=true timeout=60",
		);
		expect(result.exitCode).toBe(0);
	});

	it("parent with run handler falls back when unknown subcommand given as positional", async () => {
		const app = new Crust("cli")
			.args([{ name: "input", type: "string" }] as const)
			.run((ctx) => {
				console.log(`root input=${ctx.args.input}`);
			})
			.command("sub", (cmd) =>
				cmd.run(() => {
					console.log("sub ran");
				}),
			);

		// "unknown" is not a subcommand, so root handler runs with it as positional
		const result = await executeCrust(app, ["unknown"]);
		expect(result.stdout).toContain("root input=unknown");
		expect(result.exitCode).toBe(0);
	});
});

describe("integration: split-file .command() callback pattern end-to-end", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	// Simulate split-file pattern: subcommand definitions as separate const functions
	const defineListCommand = (
		// biome-ignore lint/complexity/noBannedTypes: testing empty initial local state
		cmd: Crust<{ verbose: { type: "boolean"; inherit: true } }, {}, []>,
	) =>
		cmd
			.flags({ format: { type: "string", default: "table" } } as const)
			.args([{ name: "resource", type: "string", required: true }] as const)
			.run((ctx) => {
				console.log(
					`list ${ctx.args.resource} format=${ctx.flags.format} verbose=${ctx.flags.verbose}`,
				);
			});

	const defineGetCommand = (
		// biome-ignore lint/complexity/noBannedTypes: testing empty initial local state
		cmd: Crust<{ verbose: { type: "boolean"; inherit: true } }, {}, []>,
	) =>
		cmd
			.args([
				{ name: "resource", type: "string", required: true },
				{ name: "id", type: "string", required: true },
			] as const)
			.run((ctx) => {
				console.log(
					`get ${ctx.args.resource}/${ctx.args.id} verbose=${ctx.flags.verbose}`,
				);
			});

	it("split-file defined subcommands work through full pipeline", async () => {
		const app = new Crust("kubectl")
			.flags({
				verbose: { type: "boolean", inherit: true },
			})
			.command("list", defineListCommand)
			.command("get", defineGetCommand);

		const listResult = await executeCrust(app, [
			"list",
			"pods",
			"--verbose",
			"--format",
			"json",
		]);
		expect(listResult.stdout).toContain("list pods format=json verbose=true");
		expect(listResult.exitCode).toBe(0);

		const getResult = await executeCrust(app, [
			"get",
			"service",
			"nginx",
			"--verbose",
		]);
		expect(getResult.stdout).toContain("get service/nginx verbose=true");
		expect(getResult.exitCode).toBe(0);
	});

	it("split-file subcommand without passing inherited flag gets default", async () => {
		const app = new Crust("kubectl")
			.flags({
				verbose: { type: "boolean", inherit: true },
			})
			.command("list", defineListCommand);

		const result = await executeCrust(app, ["list", "deployments"]);
		expect(result.stdout).toContain(
			"list deployments format=table verbose=undefined",
		);
		expect(result.exitCode).toBe(0);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Boolean negation with inherited flags
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// .sub() factory pattern — file-splitting integration tests
// ────────────────────────────────────────────────────────────────────────────

describe("integration: .sub() factory → .command(builder) pattern", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("basic .sub() → .command(builder) works end-to-end", async () => {
		// Simulate shared.ts
		const app = new Crust("my-cli").flags({
			verbose: { type: "boolean", inherit: true },
		});

		// Simulate commands/deploy.ts
		const deployCommand = app
			.sub("deploy")
			.meta({ description: "Deploy" })
			.flags({ env: { type: "string", required: true } })
			.run((ctx) => {
				console.log(`deploy env=${ctx.flags.env} verbose=${ctx.flags.verbose}`);
			});

		// Simulate cli.ts
		const result = await executeCrust(app.command(deployCommand), [
			"deploy",
			"--env",
			"production",
			"--verbose",
		]);
		expect(result.stdout).toContain("deploy env=production verbose=true");
		expect(result.exitCode).toBe(0);
	});

	it("inherited flags flow through .sub() without explicit passing", async () => {
		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
			port: { type: "number", default: 3000, inherit: true },
		});

		const sub = app.sub("sub").run((ctx) => {
			console.log(`verbose=${ctx.flags.verbose} port=${ctx.flags.port}`);
		});

		const result = await executeCrust(app.command(sub), ["sub"]);
		expect(result.stdout).toContain("verbose=undefined port=3000");
		expect(result.exitCode).toBe(0);
	});

	it("nested .sub().sub() chains work end-to-end", async () => {
		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
		});

		const deployCmd = app
			.sub("deploy")
			.flags({ env: { type: "string", inherit: true } });

		const statusCmd = deployCmd.sub("status").run((ctx) => {
			console.log(`verbose=${ctx.flags.verbose} env=${ctx.flags.env}`);
		});

		const result = await executeCrust(
			app.command(deployCmd.command(statusCmd)),
			["deploy", "status", "--verbose", "--env", "staging"],
		);
		expect(result.stdout).toContain("verbose=true env=staging");
		expect(result.exitCode).toBe(0);
	});

	it("non-inherit flags excluded from .sub() children", async () => {
		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
			rootOnly: { type: "string" },
		});

		const sub = app.sub("sub").run(() => {
			console.log("sub ran");
		});

		// rootOnly should not be recognized on the subcommand
		const result = await executeCrust(app.command(sub), [
			"sub",
			"--rootOnly",
			"val",
		]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Unknown flag");
	});

	it("mixing .command(name, cb) and .command(builder) works", async () => {
		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
		});

		const deployCmd = app.sub("deploy").run((ctx) => {
			console.log(`deploy verbose=${ctx.flags.verbose}`);
		});

		const cli = app
			.command("status", (cmd) =>
				cmd.run((ctx) => {
					console.log(`status verbose=${ctx.flags.verbose}`);
				}),
			)
			.command(deployCmd);

		const deployResult = await executeCrust(cli, ["deploy", "--verbose"]);
		expect(deployResult.stdout).toContain("deploy verbose=true");
		expect(deployResult.exitCode).toBe(0);

		const statusResult = await executeCrust(cli, ["status", "--verbose"]);
		expect(statusResult.stdout).toContain("status verbose=true");
		expect(statusResult.exitCode).toBe(0);
	});
});

describe("integration: standalone builder → .command(builder) pattern", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("registers a standalone `new Crust(name)` builder end-to-end", async () => {
		const app = new Crust("cli");
		const deploy = new Crust("deploy")
			.flags({
				env: { type: "string", required: true },
			})
			.run((ctx) => {
				console.log(`deploy env=${ctx.flags.env}`);
			});

		const result = await executeCrust(app.command(deploy), [
			"deploy",
			"--env",
			"production",
		]);
		expect(result.stdout).toContain("deploy env=production");
		expect(result.exitCode).toBe(0);
	});

	it("does not inherit parent flags when the builder was created with `new Crust(name)`", async () => {
		const app = new Crust("cli").flags({
			verbose: { type: "boolean", inherit: true },
		});
		const deploy = new Crust("deploy").run((ctx) => {
			console.log(`verbose=${ctx.flags.verbose}`);
		});

		const result = await executeCrust(app.command(deploy), [
			"deploy",
			"--verbose",
		]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Unknown flag");
	});
});

describe("integration: inherited boolean flag negation", () => {
	beforeEach(() => {
		process.exitCode = 0;
	});

	it("--no-verbose negates inherited boolean flag on subcommand", async () => {
		const app = new Crust("cli")
			.flags({
				verbose: { type: "boolean", default: true, inherit: true },
			})
			.command("sub", (cmd) =>
				cmd.run((ctx) => {
					console.log(`verbose=${ctx.flags.verbose}`);
				}),
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
		const app = new Crust("cli")
			.flags({
				tag: { type: "string", multiple: true, inherit: true },
			})
			.command("sub", (cmd) =>
				cmd.run((ctx) => {
					const tags = ctx.flags.tag;
					console.log(`tags=${JSON.stringify(tags)}`);
				}),
			);

		const result = await executeCrust(app, [
			"sub",
			"--tag",
			"a",
			"--tag",
			"b",
			"--tag",
			"c",
		]);
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
		const app = new Crust("cli")
			.flags({
				verbose: { type: "boolean", inherit: true },
			})
			.command("sub", (cmd) =>
				cmd.run((ctx) => {
					console.log(`verbose=${ctx.flags.verbose}`);
					console.log(`rawArgs=${JSON.stringify(ctx.rawArgs)}`);
				}),
			);

		const result = await executeCrust(app, [
			"sub",
			"--verbose",
			"--",
			"extra1",
			"extra2",
		]);
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

		const auditPlugin: CrustPlugin = {
			name: "audit",
			middleware: async (ctx, next) => {
				order.push(`audit:${ctx.route?.command.meta.name}`);
				await next();
			},
		};

		const app = new Crust("myctl")
			.flags({
				verbose: { type: "boolean", short: "v", inherit: true },
				config: {
					type: "string",
					default: "~/.myctl",
					inherit: true,
				},
			})
			.use(auditPlugin)
			.command("deploy", (cmd) =>
				cmd
					.flags({
						env: { type: "string", required: true },
					})
					.preRun(() => {
						order.push("deploy:preRun");
					})
					.run((ctx) => {
						order.push("deploy:run");
						console.log(
							`deploy env=${ctx.flags.env} verbose=${ctx.flags.verbose} config=${ctx.flags.config}`,
						);
					})
					.postRun(() => {
						order.push("deploy:postRun");
					}),
			)
			.command("status", (cmd) =>
				cmd.run((ctx) => {
					order.push("status:run");
					console.log(
						`status verbose=${ctx.flags.verbose} config=${ctx.flags.config}`,
					);
				}),
			);

		const deployResult = await executeCrust(app, [
			"deploy",
			"--env",
			"prod",
			"-v",
			"--config",
			"/etc/myctl",
		]);
		expect(deployResult.stdout).toContain(
			"deploy env=prod verbose=true config=/etc/myctl",
		);
		expect(deployResult.exitCode).toBe(0);
		expect(order).toEqual([
			"audit:deploy",
			"deploy:preRun",
			"deploy:run",
			"deploy:postRun",
		]);

		// Reset order for next test
		order.length = 0;

		const statusResult = await executeCrust(app, ["status", "-v"]);
		expect(statusResult.stdout).toContain(
			"status verbose=true config=~/.myctl",
		);
		expect(statusResult.exitCode).toBe(0);
		expect(order).toEqual(["audit:status", "status:run"]);
	});
});
