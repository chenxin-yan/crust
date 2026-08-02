import { describe, expect, it } from "bun:test";

import { Crust, defineCommand, defineExtension, defineFlag } from "../index.ts";

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe("public beta API", () => {
	it("passes typed command context into inline commands", async () => {
		const calls: string[] = [];

		const app = new Crust("my-cli")
			.flags({ verbose: { type: "boolean", inherit: true } })
			.command("deploy", (cmd) =>
				cmd
					.args([{ name: "target", type: "string", required: true }])
					.flags({ env: { type: "string", default: "prod" } })
					.handle(({ args, flags }) => {
						type _target = Expect<Equal<typeof args.target, string>>;
						type _env = Expect<Equal<typeof flags.env, string>>;
						type _verbose = Expect<Equal<typeof flags.verbose, boolean | undefined>>;

						calls.push(`${args.target}:${flags.env}:${flags.verbose}`);
					}),
			);

		await app.execute({ argv: ["deploy", "api", "--verbose"] });

		expect(calls).toEqual(["api:prod:true"]);
	});

	it("passes typed command context into standalone definitions", async () => {
		const seen: string[] = [];
		const verbose = defineFlag({ type: "boolean", inherit: true });
		const deploy = defineCommand<{
			flags: { verbose: typeof verbose };
		}>((command) =>
			command
				.args([{ name: "target", type: "string", required: true }])
				.handle(({ args, flags }) => {
					type _target = Expect<Equal<typeof args.target, string>>;
					type _verbose = Expect<Equal<typeof flags.verbose, boolean | undefined>>;
					seen.push(`${args.target}:${flags.verbose}`);
				}),
		);
		const app = new Crust("my-cli").flags({ verbose }).mount("deploy", deploy);

		await app.execute({ argv: ["deploy", "api", "--verbose"] });

		expect(seen).toEqual(["api:true"]);
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

		const app = new Crust("my-cli").extend(version).handle(({ flags }) => {
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
