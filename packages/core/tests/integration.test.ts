import type { StandardSchema } from "@crustjs/utils/schema";
import { describe, expect, it } from "vite-plus/test";

import {
	Crust,
	defineArg,
	defineCommand,
	defineContext,
	defineExtension,
	defineExtensionId,
	defineFlag,
	type ContextBag,
} from "../src/index.ts";
import { executeCrust, type Equal, type Expect } from "./helpers.ts";

// ────────────────────────────────────────────────────────────────────────────
// Context-owned flag behavior — full pipeline integration tests
// ────────────────────────────────────────────────────────────────────────────

describe("integration: .execute() full pipeline with argv override", () => {
	it("full pipeline: root flags + args + subcommand routing + execution", async () => {
		const env = defineFlag("env", { type: "string", default: "staging" });
		const dryRun = defineFlag("dryRun", { type: "boolean" });
		const deployment = defineContext("deployment")
			.flags(env, dryRun)
			.setup(({ flags }) => flags);
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
		const auth = defineContext("auth")
			.flags(apiKey)
			.setup(({ flags }) => ({
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
		const logging = defineContext("logging")
			.flags(verbose)
			.setup(({ flags }) => ({
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
		const auth = defineContext("auth")
			.flags(token)
			.setup(() => ({}));
		const app = new Crust("cli")
			.provide(auth())
			.add(defineCommand("deploy", (command) => command.action(() => {})));

		const result = await executeCrust(app, ["deploy"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('Missing required flag "--token"');
	});

	it("accepts an owned flag of an unrequired Context without constructing it", async () => {
		let built = 0;
		const token = defineFlag("token", { type: "string" });
		const auth = defineContext("auth")
			.flags(token)
			.setup(({ flags }) => {
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

describe("integration: Extension hooks around subcommand action", () => {
	it("Extension hooks run around subcommand execution", async () => {
		const order: string[] = [];
		const logging = defineExtension(defineExtensionId("logging"))
			.preRun((ctx) => {
				order.push(`pre:${ctx.command.meta.name}`);
			})
			.postRun((ctx) => {
				order.push(`post:${ctx.command.meta.name}`);
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
		const logging = defineContext("logging")
			.flags(verbose)
			.setup(({ flags }) => flags);
		const remoteConfig = defineContext("remote-config")
			.flags(timeout)
			.setup(({ flags }) => flags);
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
});

describe("integration: split-file definitions end-to-end", () => {
	const verbose = defineFlag("verbose", { type: "boolean" });
	const logging = defineContext("logging")
		.flags(verbose)
		.setup(({ flags }) => flags);
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

	it("reuses a definition across satisfying parents, renamed via .as()", async () => {
		const first = new Crust("first").provide(logging()).add(listCommand);
		const defaultLogging = defineContext("logging")
			.flags({ ...verbose, default: true })
			.setup(({ flags }) => flags);
		const second = new Crust("second").provide(defaultLogging()).add(listCommand.as("show"));

		expect((await executeCrust(first, ["list", "pods"])).stdout).toContain("verbose=undefined");
		expect((await executeCrust(second, ["show", "pods"])).stdout).toContain("verbose=true");
	});
});

describe("integration: public API", () => {
	it("infers pulled Context values in added definitions", async () => {
		const calls: string[] = [];
		const verbose = defineFlag("verbose", { type: "boolean" });
		const db = defineContext("db").setup((_input, options: { url: string }) => ({
			url: options.url,
			query(sql: string) {
				calls.push(`${options.url}:${sql}`);
			},
		}));

		const logging = defineContext("logging")
			.flags(verbose)
			.setup(({ flags }) => ({
				verbose: flags.verbose === true,
			}));
		const deploy = defineCommand("deploy", (cmd) =>
			cmd
				.use(logging)
				.use(db)
				.args({ name: "target", type: "string", required: true })
				.flags({ name: "env", type: "string", default: "prod" })
				.action(async ({ args, flags, ctx }) => {
					const log = await ctx.logging;
					const database = await ctx.db;
					type _target = Expect<Equal<typeof args.target, string>>;
					type _env = Expect<Equal<typeof flags.env, string>>;
					type _verbose = Expect<Equal<typeof log.verbose, boolean>>;
					type _dbUrl = Expect<Equal<typeof database.url, string>>;

					database.query(`${args.target}:${flags.env}:${log.verbose}`);
				}),
		);

		const app = new Crust("my-cli")
			.provide(logging())
			.provide(db({ url: "memory://test" }))
			.add(deploy);

		await app.execute({ argv: ["deploy", "api", "--verbose"] });

		expect(calls).toEqual(["memory://test:api:prod:true"]);
	});

	it("loads extensions separately from command context", async () => {
		let actionVersion: unknown;
		let wrapperCalled = false;
		const version = defineExtension(defineExtensionId("version"))
			.flags({ name: "version", type: "boolean" })
			.preRun(() => {
				wrapperCalled = true;
			});

		const app = new Crust("my-cli").extend(version).action(({ flags, ctx }) => {
			type _ctx = Expect<Equal<typeof ctx, ContextBag>>;
			actionVersion = flags.version;
		});

		await app.execute({ argv: ["--version"] });

		expect(wrapperCalled).toBe(true);
		expect(actionVersion).toBe(true);
	});
});
