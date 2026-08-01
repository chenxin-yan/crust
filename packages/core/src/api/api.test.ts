import { describe, expect, it } from "bun:test";

import { Crust, defineCommand, defineContext, defineExtension, defineFlag } from "../index.ts";

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe("public beta API", () => {
	it("passes typed command context into inline commands", async () => {
		const calls: string[] = [];
		const db = defineContext("db", (options: { url: string }) => ({
			url: options.url,
			query(sql: string) {
				calls.push(`${options.url}:${sql}`);
			},
		}));

		const app = new Crust("my-cli")
			.provide(db({ url: "memory://test" }))
			.flags({ verbose: { type: "boolean", inherit: true } })
			.command("deploy", (cmd) =>
				cmd
					.args([{ name: "target", type: "string", required: true }])
					.flags({ env: { type: "string", default: "prod" } })
					.handle(({ args, flags, ctx }) => {
						type _target = Expect<Equal<typeof args.target, string>>;
						type _env = Expect<Equal<typeof flags.env, string>>;
						type _verbose = Expect<Equal<typeof flags.verbose, boolean | undefined>>;
						type _dbUrl = Expect<Equal<typeof ctx.db.url, string>>;

						ctx.db.query(`${args.target}:${flags.env}:${flags.verbose}`);
					}),
			);

		await app.execute({ argv: ["deploy", "api", "--verbose"] });

		expect(calls).toEqual(["memory://test:api:prod:true"]);
	});

	it("passes typed command context into standalone definitions", async () => {
		const seen: string[] = [];
		const verbose = defineFlag({ type: "boolean", inherit: true });
		const auth = defineContext("auth", () => ({
			user: "chenxin",
		}));
		const deploy = defineCommand<{
			flags: { verbose: typeof verbose };
			ctx: { auth: { user: string } };
		}>((command) =>
			command
				.args([{ name: "target", type: "string", required: true }])
				.handle(({ args, flags, ctx }) => {
					type _target = Expect<Equal<typeof args.target, string>>;
					type _verbose = Expect<Equal<typeof flags.verbose, boolean | undefined>>;
					type _user = Expect<Equal<typeof ctx.auth.user, string>>;
					seen.push(`${ctx.auth.user}:${args.target}:${flags.verbose}`);
				}),
		);
		const app = new Crust("my-cli").provide(auth()).flags({ verbose }).mount("deploy", deploy);

		await app.execute({ argv: ["deploy", "api", "--verbose"] });

		expect(seen).toEqual(["chenxin:api:true"]);
	});

	it("loads extensions separately from command context", async () => {
		let wrapperCalled = false;
		const version = defineExtension("version", {
			flags: {
				version: { type: "boolean" },
			},
			async intercept(_context, next) {
				wrapperCalled = true;
				await next();
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
