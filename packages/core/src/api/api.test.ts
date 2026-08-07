import { describe, expect, it } from "bun:test";

import { Crust, defineCommand, defineContext, defineExtension, defineFlag } from "../index.ts";

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe("public beta API", () => {
	it("passes typed command context into mounted definitions with requirements", async () => {
		const calls: string[] = [];
		const verbose = defineFlag("verbose", { type: "boolean" });
		const db = defineContext("db", ({ options }: { options: { url: string } }) => ({
			url: options.url,
			query(sql: string) {
				calls.push(`${options.url}:${sql}`);
			},
		}));

		const deploy = defineCommand("deploy", { requires: { flags: [verbose], ctx: [db] } }, (cmd) =>
			cmd
				.args({ name: "target", type: "string", required: true })
				.flags({ name: "env", type: "string", default: "prod" })
				.handle(({ args, flags, ctx }) => {
					type _target = Expect<Equal<typeof args.target, string>>;
					type _env = Expect<Equal<typeof flags.env, string>>;
					type _verbose = Expect<Equal<typeof flags.verbose, boolean | undefined>>;
					type _dbUrl = Expect<Equal<typeof ctx.db.url, string>>;

					ctx.db.query(`${args.target}:${flags.env}:${flags.verbose}`);
				}),
		);

		const globalFlags = defineContext("global-flags", { flags: [verbose] }, () => ({}));
		const app = new Crust("my-cli")
			.provide(globalFlags())
			.provide(db({ url: "memory://test" }))
			.mount(deploy);

		await app.execute({ argv: ["deploy", "api", "--verbose"] });

		expect(calls).toEqual(["memory://test:api:prod:true"]);
	});

	it("mounts one definition twice via .as()", async () => {
		const seen: string[] = [];
		const auth = defineContext("auth", () => ({ user: "chenxin" }));
		const deploy = defineCommand("deploy", { requires: { ctx: [auth] } }, (command) =>
			command.args({ name: "target", type: "string", required: true }).handle(({ args, ctx }) => {
				type _target = Expect<Equal<typeof args.target, string>>;
				type _user = Expect<Equal<typeof ctx.auth.user, string>>;
				seen.push(`${ctx.auth.user}:${args.target}`);
			}),
		);
		const app = new Crust("my-cli").provide(auth()).mount(deploy, deploy.as("ship"));

		await app.execute({ argv: ["deploy", "api"] });
		await app.execute({ argv: ["ship", "web"] });

		expect(seen).toEqual(["chenxin:api", "chenxin:web"]);
	});

	it("loads extensions separately from command context", async () => {
		let wrapperCalled = false;
		const version = defineExtension("version", {
			flags: {
				version: { type: "boolean" },
			},
			hooks: {
				preRun() {
					wrapperCalled = true;
				},
			},
		});

		const app = new Crust("my-cli").extend(version).handle(({ flags, ctx }) => {
			type _ctx = Expect<Equal<typeof ctx, Readonly<{}>>>;
			expect((flags as Record<string, unknown>).version).toBe(true);
		});

		await app.execute({ argv: ["--version"] });

		expect(wrapperCalled).toBe(true);
	});

	it("can execute repeatedly without freezing or accumulating extension setup on the source builder", async () => {
		let runCount = 0;
		const debug = defineExtension("debug", {
			flags: {
				debug: { type: "boolean" },
			},
		});
		const app = new Crust("repeat").extend(debug).handle(({ flags }) => {
			if ((flags as Record<string, unknown>).debug) {
				runCount++;
			}
		});

		await app.execute({ argv: ["--debug"] });
		await app.execute({ argv: ["--debug"] });

		expect(runCount).toBe(2);
		expect(app._node.effectiveFlags.debug).toBeUndefined();
	});
});
