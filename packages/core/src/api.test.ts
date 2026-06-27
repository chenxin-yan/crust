import { describe, expect, it } from "bun:test";

import { cli, context, extension } from "./api.ts";

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe("internal command wrapper API", () => {
	it("passes typed command context into inline commands", async () => {
		const calls: string[] = [];
		const db = context("db", (options: { url: string }) => ({
			url: options.url,
			query(sql: string) {
				calls.push(`${options.url}:${sql}`);
			},
		}));

		const app = cli("my-cli")
			.use(db({ url: "memory://test" }))
			.flag("verbose", { type: "boolean", inherit: true })
			.command("deploy", (cmd) =>
				cmd
					.arg({ name: "target", type: "string", required: true })
					.flag("env", { type: "string", default: "prod" })
					.run(({ args, flags, ctx }) => {
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

	it("passes typed command context into parent-typed split subcommands", async () => {
		const seen: string[] = [];
		const auth = context("auth", () => ({
			user: "chenxin",
		}));
		const app = cli("my-cli").use(auth).flag("verbose", { type: "boolean", inherit: true });

		const deploy = app
			.sub("deploy")
			.arg({ name: "target", type: "string", required: true })
			.run(({ args, flags, ctx }) => {
				type _target = Expect<Equal<typeof args.target, string>>;
				type _verbose = Expect<Equal<typeof flags.verbose, boolean | undefined>>;
				type _user = Expect<Equal<typeof ctx.auth.user, string>>;
				seen.push(`${ctx.auth.user}:${args.target}:${flags.verbose}`);
			});

		await app.command(deploy).execute({ argv: ["deploy", "api", "--verbose"] });

		expect(seen).toEqual(["chenxin:api:true"]);
	});

	it("loads extensions separately from command context", async () => {
		let wrapperCalled = false;
		const version = extension("version")
			.flag("version", {
				type: "boolean",
			})
			.wrapRun((run) => async (context) => {
				wrapperCalled = true;
				await run(context);
			});

		const app = cli("my-cli")
			.extend(version)
			.run(({ flags, ctx }) => {
				type _ctx = Expect<Equal<typeof ctx, Readonly<{}>>>;
				expect((flags as Record<string, unknown>).version).toBe(true);
			});

		await app.execute({ argv: ["--version"] });

		expect(wrapperCalled).toBe(true);
	});

	it("can execute repeatedly without freezing or accumulating extension setup on the source builder", async () => {
		let runCount = 0;
		const debug = extension("debug").flag("debug", {
			type: "boolean",
		});
		const app = cli("repeat")
			.extend(debug)
			.run(({ flags }) => {
				if ((flags as Record<string, unknown>).debug) {
					runCount++;
				}
			});

		await app.execute({ argv: ["--debug"] });
		await app.execute({ argv: ["--debug"] });

		expect(runCount).toBe(2);
		expect(app._crust._node.effectiveFlags.debug).toBeUndefined();
	});
});
