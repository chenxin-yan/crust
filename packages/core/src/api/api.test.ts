import { describe, expect, it } from "bun:test";

import type { Equal, Expect } from "../../tests/helpers.ts";
import {
	Crust,
	defineCommand,
	defineContext,
	defineExtension,
	defineExtensionId,
	defineFlag,
	type ContextBag,
} from "../index.ts";

describe("public beta API", () => {
	it("infers pulled Context values in added definitions", async () => {
		const calls: string[] = [];
		const verbose = defineFlag("verbose", { type: "boolean" });
		const db = defineContext("db", ({ options }: { options: { url: string } }) => ({
			url: options.url,
			query(sql: string) {
				calls.push(`${options.url}:${sql}`);
			},
		}));

		const logging = defineContext("logging", { flags: [verbose] }, ({ flags }) => ({
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

	it("adds one definition twice via .as()", async () => {
		const seen: string[] = [];
		const auth = defineContext("auth", () => ({ user: "chenxin" }));
		const deploy = defineCommand("deploy", (command) =>
			command
				.use(auth)
				.args({ name: "target", type: "string", required: true })
				.action(async ({ args, ctx }) => {
					const identity = await ctx.auth;
					type _target = Expect<Equal<typeof args.target, string>>;
					type _user = Expect<Equal<typeof identity.user, string>>;
					seen.push(`${identity.user}:${args.target}`);
				}),
		);
		const app = new Crust("my-cli").provide(auth()).add(deploy, deploy.as("ship"));

		await app.execute({ argv: ["deploy", "api"] });
		await app.execute({ argv: ["ship", "web"] });

		expect(seen).toEqual(["chenxin:api", "chenxin:web"]);
	});

	it("loads extensions separately from command context", async () => {
		let actionVersion: unknown;
		let wrapperCalled = false;
		const version = defineExtension(defineExtensionId("version"), {
			flags: [{ name: "version", type: "boolean" }],
			hooks: {
				preRun() {
					wrapperCalled = true;
				},
			},
		});

		const app = new Crust("my-cli").extend(version).action(({ flags, ctx }) => {
			type _ctx = Expect<Equal<typeof ctx, ContextBag>>;
			actionVersion = flags.version;
		});

		await app.execute({ argv: ["--version"] });

		expect(wrapperCalled).toBe(true);
		expect(actionVersion).toBe(true);
	});

	it("can execute repeatedly without freezing or accumulating extension setup on the source builder", async () => {
		let runCount = 0;
		const debug = defineExtension(defineExtensionId("debug"), {
			flags: [{ name: "debug", type: "boolean" }],
		});
		const app = new Crust("repeat").extend(debug).action(({ flags }) => {
			if (flags.debug) {
				runCount++;
			}
		});

		await app.execute({ argv: ["--debug"] });
		await app.execute({ argv: ["--debug"] });

		expect(runCount).toBe(2);
	});
});
