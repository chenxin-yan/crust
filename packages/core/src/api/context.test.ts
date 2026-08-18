import { describe, expect, it } from "bun:test";

import { Crust, defineCommand } from "../command/crust.ts";
import { CrustError } from "../errors.ts";
import type { NamedFlagDef } from "../types.ts";
import { defineContext, type ContextResolver } from "./context.ts";
import { defineExtension } from "./extension.ts";
import { defineFlag } from "./flags.ts";

type Assert<T extends true> = T;
type IsEqual<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe("defineContext()", () => {
	it("always returns a factory, including for zero-option setups", async () => {
		const auth = defineContext("auth", () => ({ user: "chenxin" }));

		// The definition itself is a factory, not an instance
		expect(typeof auth).toBe("function");
		expect(auth.contextName).toBe("auth");

		const instance = auth();
		expect(instance.kind).toBe("context");
		expect(instance.name).toBe("auth");
		await expect(
			Promise.resolve(
				instance.setup({
					flags: {},
					ctx: { use: async () => undefined as never },
					stdout: () => {},
					stderr: () => {},
				}),
			),
		).resolves.toEqual({ user: "chenxin" });
	});

	it("passes the factory argument as options", async () => {
		const db = defineContext("db", ({ options }: { options: { url: string } }) => ({
			url: options.url,
		}));

		const instance = db({ url: "memory://test" });
		await expect(
			Promise.resolve(
				instance.setup({
					flags: {},
					ctx: { use: async () => undefined as never },
					stdout: () => {},
					stderr: () => {},
				}),
			),
		).resolves.toEqual({ url: "memory://test" });
	});

	it(".of() produces an instance returning the precomputed value without running setup", async () => {
		const verbose = defineFlag("verbose", { type: "boolean" });
		const db = defineContext("db", { flags: [verbose] }, ({ flags }) => ({
			url: `real:${String(flags.verbose)}`,
		}));

		const fake = db.of({ url: "fake://db" });
		expect(fake.name).toBe("db");
		type _Name = Assert<IsEqual<(typeof fake)["name"], "db">>;
		// @ts-expect-error -- .of() takes the Context's value type
		db.of({ wrong: true });

		const seen: string[] = [];
		const app = new Crust("cli").provide(fake).action(async ({ ctx }) => {
			seen.push((await ctx.use(db)).url);
		});
		await app.run([]);
		expect(seen).toEqual(["fake://db"]);
	});
});

describe("Crust .provide()", () => {
	it("constructs Contexts for the resolved command and exposes them as ctx", async () => {
		const seen: string[] = [];
		const db = defineContext("db", ({ options }: { options: { url: string } }) => ({
			url: options.url,
		}));

		const app = new Crust("cli").provide(db({ url: "memory://x" })).action(async ({ ctx }) => {
			seen.push((await ctx.use(db)).url);
		});

		await app.run([]);
		expect(seen).toEqual(["memory://x"]);
	});

	it("accepts multiple instances in one variadic call", async () => {
		const seen: string[] = [];
		const a = defineContext("a", () => "value-a");
		const b = defineContext("b", () => "value-b");

		const app = new Crust("cli").provide(a(), b()).action(async ({ ctx }) => {
			const aValue = await ctx.use(a);
			const bValue = await ctx.use(b);
			seen.push(`${aValue}:${bValue}`);
			type _A = Assert<IsEqual<typeof aValue, string>>;
			type _B = Assert<IsEqual<typeof bValue, string>>;
		});

		await app.run([]);
		expect(seen).toEqual(["value-a:value-b"]);
	});

	it("throws DEFINITION on a duplicate Context name on the same command", () => {
		const a = defineContext("db", () => 1);
		const b = defineContext("db", () => 2);

		// @ts-expect-error -- name already provided in an earlier call (FIX_DUPLICATE_CONTEXT)
		expect(() => new Crust("cli").provide(a()).provide(b())).toThrow(CrustError);
		// @ts-expect-error -- name repeated within one call (FIX_DUPLICATE_CONTEXT)
		expect(() => new Crust("cli").provide(a(), b())).toThrow(/Context "db" is already provided/);
		try {
			// @ts-expect-error -- name already provided in an earlier call (FIX_DUPLICATE_CONTEXT)
			new Crust("cli").provide(a()).provide(b());
		} catch (error) {
			expect((error as CrustError).is("DEFINITION")).toBe(true);
		}
	});

	it("throws DEFINITION when a factory is provided without being invoked", () => {
		const db = defineContext("db", () => 1);

		expect(() => new Crust("cli").provide(db as never)).toThrow(/invoke the factory/);
	});

	it("throws DEFINITION when a child re-provides a name inherited from its path", () => {
		const parentDb = defineContext("db", () => "parent");
		const childDb = defineContext("db", () => "child");

		expect(() =>
			new Crust("cli")
				.provide(parentDb())
				.add(defineCommand("sub", (cmd) => cmd.provide(childDb()).action(() => {}))),
		).toThrow(CrustError);
	});

	it("throws DEFINITION when an added subtree re-provides a path name", () => {
		const parentDb = defineContext("db", () => "parent");
		const nestedDb = defineContext("db", () => "nested");
		const sub = defineCommand("sub", (command) =>
			command.add(defineCommand("g", (child) => child.provide(nestedDb()).action(() => {}))),
		);

		expect(() => new Crust("cli").provide(parentDb()).add(sub)).toThrow(CrustError);
	});

	it("seeds added descendants with the parent Context path", async () => {
		const seen: string[] = [];
		const db = defineContext("db", () => "root-db");
		const sub = defineCommand("sub", (command) =>
			command.add(
				defineCommand("g", (child) =>
					child.action(async ({ ctx }) => {
						seen.push(await ctx.use(db));
					}),
				),
			),
		);
		const root = new Crust("cli").provide(db()).add(sub);

		await root.run(["sub", "g"]);

		expect(seen).toEqual(["root-db"]);
	});

	it("does not construct inherited Contexts a command does not pull", async () => {
		let built = 0;
		const lazy = defineContext("lazy", () => {
			built++;
			return {};
		});

		const app = new Crust("cli")
			.provide(lazy())
			.add(defineCommand("a", (cmd) => cmd.action(() => {})))
			.add(defineCommand("b", (cmd) => cmd.action(() => {})));

		// "a" never pulls the inherited Context, so setup never runs.
		await app.run(["a"]);
		expect(built).toBe(0);

		// Unused providers remain lazy on every command path.
		await app.run(["b"]);
		expect(built).toBe(0);
	});

	it("constructs a transitive pull chain", async () => {
		const builtNames: string[] = [];
		const base = defineContext("base", () => {
			builtNames.push("base");
			return "base";
		});
		const mid = defineContext("mid", async ({ ctx }) => {
			const value = await ctx.use(base);
			builtNames.push("mid");
			return `mid(${value})`;
		});
		const db = defineContext("db", async ({ ctx }) => {
			const value = await ctx.use(mid);
			builtNames.push("db");
			return `db(${value})`;
		});
		const unrelated = defineContext("unrelated", () => {
			builtNames.push("unrelated");
			return "unrelated";
		});

		const seen: string[] = [];
		const app = new Crust("cli").provide(base(), mid(), db(), unrelated()).add(
			defineCommand("query", (cmd) =>
				cmd.action(async ({ ctx }) => {
					seen.push(await ctx.use(db));
				}),
			),
		);

		await app.run(["query"]);

		// A ≥3-node chain distinguishes true transitivity from a one-hop keep.
		expect(builtNames).toEqual(["base", "mid", "db"]);
		expect(seen).toEqual(["db(mid(base))"]);
	});

	it("constructs each Context in a pull diamond exactly once", async () => {
		const builtNames: string[] = [];
		const a = defineContext("a", () => {
			builtNames.push("a");
			return "a";
		});
		const b = defineContext("b", async ({ ctx }) => {
			await ctx.use(a);
			builtNames.push("b");
			return "b";
		});
		const c = defineContext("c", async ({ ctx }) => {
			await ctx.use(a);
			builtNames.push("c");
			return "c";
		});
		const d = defineContext("d", async ({ ctx }) => {
			await Promise.all([ctx.use(b), ctx.use(c)]);
			builtNames.push("d");
			return "d";
		});

		const app = new Crust("cli")
			.provide(a(), b(), c(), d())
			.add(defineCommand("go", (cmd) => cmd.action(async ({ ctx }) => void (await ctx.use(d)))));

		await app.run(["go"]);

		expect(builtNames.slice().sort()).toEqual(["a", "b", "c", "d"]);
		expect(builtNames[0]).toBe("a");
		expect(builtNames[3]).toBe("d");
	});

	it("constructs an inherited dependency of a self-provided Context", async () => {
		const builtNames: string[] = [];
		const session = defineContext("session", () => {
			builtNames.push("session");
			return "session";
		});
		const unrelated = defineContext("unrelated", () => {
			builtNames.push("unrelated");
			return "unrelated";
		});
		const user = defineContext("user", async ({ ctx }) => {
			const value = await ctx.use(session);
			builtNames.push("user");
			return `user(${value})`;
		});

		const seen: string[] = [];
		const app = new Crust("cli").provide(session(), unrelated()).add(
			defineCommand("account", (cmd) =>
				cmd.provide(user()).action(async ({ ctx }) => {
					seen.push(await ctx.use(user));
				}),
			),
		);

		await app.run(["account"]);

		expect(builtNames).toEqual(["session", "user"]);
		expect(seen).toEqual(["user(session)"]);
	});

	it("does not backfill added children with later parent provides", async () => {
		let lateProvided = false;
		const late = defineContext("late", () => {
			lateProvided = true;
			return "late";
		});
		const app = new Crust("cli")
			.add(defineCommand("status", (command) => command.action(() => {})))
			.provide(late());

		await app.run(["status"]);

		expect(lateProvided).toBe(false);
	});
});

describe("Context-owned flags", () => {
	const apiKey = defineFlag("api-key", {
		type: "string",
		short: "k",
		aliases: ["token"],
	});

	it("installs a propagating cloned flag and exposes its validated value to setup", async () => {
		const seen: unknown[] = [];
		const auth = defineContext("auth", { flags: [apiKey] }, ({ flags }) => {
			type _ApiKey = Assert<IsEqual<(typeof flags)["api-key"], string | undefined>>;
			seen.push(flags["api-key"]);
			return { apiKey: flags["api-key"] };
		});
		const instance = auth();
		expect(instance.ownedFlags["api-key"]).toEqual({
			type: "string",
			short: "k",
			aliases: ["token"],
		});

		const app = new Crust("cli").provide(instance).action(async ({ flags, ctx }) => {
			type _ActionApiKey = Assert<IsEqual<(typeof flags)["api-key"], string | undefined>>;
			seen.push((await ctx.use(auth)).apiKey);
		});
		await app.run([], { flags: { "api-key": "secret" } } as never);

		expect(seen).toEqual(["secret", "secret"]);
	});

	it("passes parsed owned flag values to setup", async () => {
		const port = defineFlag("port", { type: "string", parse: Number });
		const seen: number[] = [];
		const server = defineContext("server", { flags: [port] }, ({ flags }) => {
			type _Port = Assert<IsEqual<typeof flags.port, number | undefined>>;
			if (flags.port !== undefined) seen.push(flags.port);
			return {};
		});

		await new Crust("cli")
			.provide(server())
			.action(async ({ ctx }) => void (await ctx.use(server)))
			.run([], { flags: { port: "8080" } });

		expect(seen).toEqual([8080]);
	});

	it("passes only each Context's owned flags to its setup", async () => {
		const region = defineFlag("region", { type: "string" });
		const seen: string[][] = [];
		const auth = defineContext("auth", { flags: [apiKey] }, ({ flags }) => {
			seen.push(Object.keys(flags));
			return {};
		});
		const location = defineContext("location", { flags: [region] }, ({ flags }) => {
			seen.push(Object.keys(flags));
			return {};
		});

		await new Crust("cli")
			.provide(auth(), location())
			.action(async ({ ctx }) => {
				await ctx.use(auth);
				await ctx.use(location);
			})
			.run([], { flags: { "api-key": "secret", region: "us" } });

		expect(seen).toEqual([["api-key"], ["region"]]);
	});

	it("builds behavior capabilities with the action's injected io", async () => {
		const verbose = defineFlag("verbose", { type: "boolean" });
		let setupStdout: ((text: string) => void) | undefined;
		let setupStderr: ((text: string) => void) | undefined;
		const logging = defineContext("logging", { flags: [verbose] }, ({ flags, stdout, stderr }) => {
			type _Stdout = Assert<IsEqual<typeof stdout, (text: string) => void>>;
			type _Stderr = Assert<IsEqual<typeof stderr, (text: string) => void>>;
			setupStdout = stdout;
			setupStderr = stderr;
			return {
				debug(message: string) {
					if (flags.verbose) stderr(message);
				},
			};
		});
		const messages: string[] = [];
		const stdout = (_message: string) => {};
		const stderr = (message: string) => messages.push(message);
		const app = new Crust("cli").provide(logging()).action(async ({ ctx, stdout, stderr }) => {
			const log = await ctx.use(logging);
			expect(setupStdout).toBe(stdout);
			expect(setupStderr).toBe(stderr);
			log.debug("debug");
		});

		await app.run([], { flags: { verbose: true } }, { stdout, stderr });
		expect(messages).toEqual(["debug"]);
	});

	it("exposes a provided capability to later added commands", async () => {
		const seen: string[] = [];
		const auth = defineContext("auth", { flags: [apiKey] }, ({ flags }) => ({
			apiKey: flags["api-key"],
		}));
		const deploy = defineCommand("deploy", (command) =>
			command.action(async ({ ctx }) => {
				seen.push(String((await ctx.use(auth)).apiKey));
			}),
		);

		await new Crust("cli")
			.provide(auth())
			.add(deploy)
			.run(["deploy"], { flags: { "api-key": "secret" } } as never);
		expect(seen).toEqual(["secret"]);
	});

	it("merges owned flag types from multiple Contexts in one provide call", () => {
		const auth = defineContext("auth", { flags: [apiKey] }, () => ({}));
		const format = defineFlag("format", { type: "string", choices: ["json", "text"] });
		const output = defineContext("output", { flags: [format] }, () => ({}));
		const app = new Crust("cli").provide(auth(), output());

		type _FlagKeys = Assert<IsEqual<keyof (typeof app)["_types"]["flags"], "api-key" | "format">>;
		type _ApiKey = Assert<IsEqual<(typeof app)["_types"]["flags"]["api-key"]["type"], "string">>;
		type _Format = Assert<IsEqual<(typeof app)["_types"]["flags"]["format"]["type"], "string">>;
	});

	it("keeps owned flags when later .flags() calls accumulate local flags", async () => {
		const auth = defineContext("auth", { flags: [apiKey] }, () => ({}));
		const app = new Crust("cli")
			.provide(auth())
			.flags({ name: "verbose", type: "boolean" })
			.action(({ flags }) => {
				expect(flags["api-key"]).toBe("secret");
				expect(flags.verbose).toBe(true);
			});

		await app.run([], { flags: { "api-key": "secret", verbose: true } });
	});

	it("allows one owning factory on sibling command branches", async () => {
		const seen: string[] = [];
		const auth = defineContext("auth", { flags: [apiKey] }, ({ flags }) => ({
			apiKey: flags["api-key"],
		}));
		const branch = <const Name extends string>(name: Name) =>
			defineCommand(name, (command) =>
				command.provide(auth()).action(async ({ ctx }) => {
					seen.push(`${name}:${(await ctx.use(auth)).apiKey}`);
				}),
			);
		const app = new Crust("cli").add(branch("first"), branch("second"));

		await app.run(["first"], { flags: { "api-key": "one" } });
		await app.run(["second"], { flags: { "api-key": "two" } });

		expect(seen).toEqual(["first:one", "second:two"]);
	});

	it("retains owned flags on .of() test doubles", async () => {
		const auth = defineContext("auth", { flags: [apiKey] }, () => ({ real: true }));
		const fake = auth.of({ real: false });
		expect(fake.ownedFlags["api-key"]).toBeDefined();

		await new Crust("cli")
			.provide(fake)
			.action(async ({ flags, ctx }) => {
				expect(flags["api-key"]).toBe("fake-key");
				expect((await ctx.use(auth)).real).toBe(false);
			})
			.run([], { flags: { "api-key": "fake-key" } });
	});

	it("rejects duplicate owned flag names at definition time", () => {
		const duplicates: readonly NamedFlagDef[] = [apiKey, apiKey];

		expect(() => defineContext("auth", { flags: duplicates }, () => ({}))).toThrow(
			/flag "--api-key" spelling "api-key" collides with flag "--api-key"/,
		);
	});

	it("rejects collisions between owned flag spellings at definition time", () => {
		const colliding: readonly NamedFlagDef[] = [
			{ name: "api-key", type: "string", short: "k" },
			{ name: "key-file", type: "string", aliases: ["k"] },
		];

		expect(() => defineContext("auth", { flags: colliding }, () => ({}))).toThrow(
			/Context "auth" flag "--key-file" spelling "k" collides with flag "--api-key"/,
		);
	});

	it("rejects application and Context-owned collisions in both fluent orders", () => {
		const auth = defineContext("auth", { flags: [apiKey] }, () => ({}));
		expect(() =>
			new Crust("cli").flags(apiKey).provide(
				// @ts-expect-error -- provided Context flag collides with an existing local flag
				auth(),
			),
		).toThrow(/collides/);
		expect(() =>
			new Crust("cli").provide(auth()).flags(
				// @ts-expect-error -- local flag collides with an existing Context-owned flag
				apiKey,
			),
		).toThrow(/collides/);
	});

	it("rejects collisions between different Contexts in one or separate provide calls", () => {
		const auth = defineContext("auth", { flags: [apiKey] }, () => ({}));
		const session = defineContext(
			"session",
			{ flags: [{ name: "session-key", type: "string", short: "k" }] },
			() => ({}),
		);
		expect(() => new Crust("cli").provide(auth(), session())).toThrow(/collides/);
		expect(() =>
			new Crust("cli").provide(auth()).provide(
				// @ts-expect-error -- Context-owned short alias collides across provide calls
				session(),
			),
		).toThrow(/collides/);
	});

	it("rejects Extension collisions regardless of fluent registration order", async () => {
		const auth = defineContext("auth", { flags: [apiKey] }, () => ({}));
		const extension = defineExtension("auth-extension", {
			flags: [{ name: "other", type: "string", aliases: ["api-key"] }],
		});

		await expect(new Crust("cli").extend(extension).provide(auth()).run([])).rejects.toThrow(
			/collides/,
		);
		await expect(new Crust("cli").provide(auth()).extend(extension).run([])).rejects.toThrow(
			/collides/,
		);
	});
});

describe("Context setup dependencies", () => {
	it("types and resolves ctx.use() in two- and three-argument setups", async () => {
		const session = defineContext("session", () => ({ userId: "yan" }));
		const user = defineContext("user", async ({ ctx }) => {
			const value = await ctx.use(session);
			type _Session = Assert<IsEqual<typeof value, { userId: string }>>;
			// @ts-expect-error -- setup ctx is a resolver, not a value bag
			void ctx.session;
			// @ts-expect-error -- use() accepts Context factories only
			const invalidFactory: Parameters<typeof ctx.use>[0] = "session";
			void invalidFactory;
			return value.userId;
		});
		const configured = defineContext(
			"configured",
			{ flags: [] },
			async ({ ctx }) => await ctx.use(user),
		);

		await new Crust("cli")
			.provide(session(), user(), configured())
			.action(async ({ ctx }) => expect(await ctx.use(configured)).toBe("yan"))
			.run([]);
	});

	it("constructs a transitive chain lazily", async () => {
		const order: string[] = [];
		const base = defineContext("base", () => (order.push("base"), "base"));
		const mid = defineContext("mid", async ({ ctx }) => `mid(${await ctx.use(base)})`);
		const db = defineContext("db", async ({ ctx }) => {
			const value = `db(${await ctx.use(mid)})`;
			order.push("db");
			return value;
		});
		const unused = defineContext("unused", () => (order.push("unused"), "unused"));
		await new Crust("cli")
			.provide(db(), unused(), mid(), base())
			.action(async ({ ctx }) => expect(await ctx.use(db)).toBe("db(mid(base))"))
			.run([]);
		expect(order).toEqual(["base", "db"]);
	});

	it("only constructs conditionally pulled dependencies", async () => {
		let setups = 0;
		const remote = defineContext("remote", () => ({ id: ++setups }));
		const cache = defineContext(
			"cache",
			async ({ options, ctx }: { options: boolean; ctx: ContextResolver }) =>
				options ? await ctx.use(remote) : { id: 0 },
		);

		await new Crust("cli")
			.provide(remote(), cache(false))
			.action(async ({ ctx }) => void (await ctx.use(cache)))
			.run([]);
		expect(setups).toBe(0);
		await new Crust("cli")
			.provide(remote(), cache(true))
			.action(async ({ ctx }) => void (await ctx.use(cache)))
			.run([]);
		expect(setups).toBe(1);
	});

	it("shares dependencies in a concurrent diamond without reporting a cycle", async () => {
		let baseSetups = 0;
		const base = defineContext("base", async () => ({ id: ++baseSetups }));
		const left = defineContext("left", async ({ ctx }) => (await ctx.use(base)).id);
		const right = defineContext("right", async ({ ctx }) => (await ctx.use(base)).id);
		const top = defineContext("top", async ({ ctx }) =>
			Promise.all([ctx.use(left), ctx.use(right)]),
		);
		await new Crust("cli")
			.provide(top(), right(), base(), left())
			.action(async ({ ctx }) => {
				expect(await ctx.use(top)).toEqual([1, 1]);
			})
			.run([]);
		expect(baseSetups).toBe(1);
	});

	it("defers missing providers to pull time and identifies the requester", async () => {
		const missing = defineContext("missing", () => "missing");
		const service = defineContext("service", async ({ ctx }) => await ctx.use(missing));
		const app = new Crust("cli")
			.provide(service())
			.action(async ({ ctx }) => void (await ctx.use(service)));
		await expect(app.run([])).rejects.toMatchObject({
			details: { name: "missing", reason: "missing-context" },
		});
		await expect(app.run([])).rejects.toThrow('pulled while constructing Context "service"');
	});

	it("disposes constructed dependencies when a later nested pull is missing", async () => {
		const events: string[] = [];
		const resource = defineContext("resource", () => ({
			[Symbol.dispose]: () => events.push("disposed"),
		}));
		const missing = defineContext("missing", () => null);
		const service = defineContext("service", async ({ ctx }) => {
			await ctx.use(resource);
			return await ctx.use(missing);
		});
		await expect(
			new Crust("cli")
				.provide(resource(), service())
				.action(async ({ ctx }) => {
					await ctx.use(service);
				})
				.run([]),
		).rejects.toMatchObject({ details: { reason: "missing-context" } });
		expect(events).toEqual(["disposed"]);
	});

	it("detects self, two-node, concurrent, and three-node cycles", async () => {
		let self: any;
		self = defineContext("self", async ({ ctx }) => await ctx.use(self));
		await expect(
			new Crust("cli")
				.provide(self())
				.action(async ({ ctx }) => void (await ctx.use(self)))
				.run([]),
		).rejects.toMatchObject({ details: { reason: "context-cycle" } });

		let b: any;
		const a = defineContext("a", async ({ ctx }) => await ctx.use(b));
		b = defineContext("b", async ({ ctx }: any) => await ctx.use(a));
		await expect(
			new Crust("cli")
				.provide(a(), b())
				.action(async ({ ctx }) => void (await ctx.use(a)))
				.run([]),
		).rejects.toThrow(/"a" -> "b" -> "a"/);
		await expect(
			new Crust("cli")
				.provide(a(), b())
				.action(async ({ ctx }) => void (await Promise.all([ctx.use(a), ctx.use(b)])))
				.run([]),
		).rejects.toMatchObject({ details: { reason: "context-cycle" } });

		let c: any;
		const x = defineContext("x", async ({ ctx }) => await ctx.use(b));
		b = defineContext("y", async ({ ctx }: any) => await ctx.use(c));
		c = defineContext("z", async ({ ctx }: any) => await ctx.use(x));
		await expect(
			new Crust("cli")
				.provide(x(), b(), c())
				.action(async ({ ctx }) => void (await ctx.use(x)))
				.run([]),
		).rejects.toMatchObject({ details: { reason: "context-cycle" } });
	}, 500);

	it("continues after setup catches a missing provider", async () => {
		const missing = defineContext("missing", () => "missing");
		const unrelated = defineContext("unrelated", () => "ok");
		const service = defineContext("service", async ({ ctx }) => {
			await ctx.use(missing).catch(() => undefined);
			return await ctx.use(unrelated);
		});
		await new Crust("cli")
			.provide(service(), unrelated())
			.action(async ({ ctx }) => expect(await ctx.use(service)).toBe("ok"))
			.run([]);
	});

	it("removes cycle edges when setup catches a cycle and continues", async () => {
		const unrelated = defineContext("unrelated", () => "ok");
		let service: any;
		service = defineContext("service", async ({ ctx }) => {
			await ctx.use(service).catch(() => undefined);
			return await ctx.use(unrelated);
		});
		await new Crust("cli")
			.provide(service(), unrelated())
			.action(async ({ ctx }) => {
				expect(await ctx.use(service)).toBe("ok");
			})
			.run([]);
	});

	it("allows dependencies provided in any order and across provide calls", async () => {
		const base = defineContext("base", () => "base");
		const dependent = defineContext("dependent", async ({ ctx }) => await ctx.use(base));
		await new Crust("cli")
			.provide(dependent())
			.provide(base())
			.action(async ({ ctx }) => {
				expect(await ctx.use(dependent)).toBe("base");
			})
			.run([]);
	});

	it("lets .of() cut the dependency graph while retaining owned flags", async () => {
		const token = defineFlag("token", { type: "string" });
		const missing = defineContext("missing", () => "real");
		const db = defineContext("db", { flags: [token] }, async ({ ctx }) => await ctx.use(missing));
		const app = new Crust("cli").provide(db.of("fake")).action(async ({ ctx }) => {
			expect(await ctx.use(db)).toBe("fake");
		});
		await app.run([], { flags: { token: "x" } });
	});

	it("normalizes flags of a hand-written ContextInstance at provide time", () => {
		const rogue = {
			kind: "context",
			name: "rogue",
			ownedFlags: { mode: { type: "string", choices: ["a", "b"], default: "z" } },
			setup: () => ({}),
		} as unknown as Parameters<Crust["provide"]>[0];
		expect(() => new Crust("cli").provide(rogue)).toThrow(/Invalid default value/);
	});
});

describe("pull-based Context resolution", () => {
	it("reports an actionable error when a provider is missing", async () => {
		const api = defineContext("api", () => ({ ok: true }));
		const app = new Crust("cli").action(async ({ ctx }) => void (await ctx.use(api)));

		await expect(app.run([])).rejects.toMatchObject({
			code: "DEFINITION",
			details: { subject: "context", name: "api", reason: "missing-context" },
		});
		await expect(app.run([])).rejects.toThrow("Add .provide(api(...))");
	});

	it("memoizes one value across hooks and the action", async () => {
		let setups = 0;
		const service = defineContext("service", () => ({ id: ++setups }));
		const seen: number[] = [];
		const observer = defineExtension("observer", {
			hooks: {
				async preRun(ctx) {
					seen.push((await ctx.use(service)).id);
				},
				async postRun(ctx) {
					seen.push((await ctx.use(service)).id);
				},
			},
		});
		const app = new Crust("cli")
			.provide(service())
			.extend(observer)
			.action(async ({ ctx }) => void seen.push((await ctx.use(service)).id));

		await app.run([]);
		expect(setups).toBe(1);
		expect(seen).toEqual([1, 1, 1]);
	});

	it("shares one setup across concurrent pulls", async () => {
		let setups = 0;
		const service = defineContext("service", async () => ({ id: ++setups }));
		const app = new Crust("cli").provide(service()).action(async ({ ctx }) => {
			const [first, second] = await Promise.all([ctx.use(service), ctx.use(service)]);
			expect(first).toBe(second);
		});

		await app.run([]);
		expect(setups).toBe(1);
	});

	it("installs Extension providers for commands and other Extensions", async () => {
		const logger = defineContext("logger", () => ({ label: "extension" }));
		const events: string[] = [];
		const provider = defineExtension("provider", { provides: [logger()] });
		const consumer = defineExtension("consumer", {
			hooks: { preRun: async (ctx) => void events.push((await ctx.use(logger)).label) },
		});
		const command = defineCommand("run", (builder) =>
			builder.action(async ({ ctx }) => void events.push((await ctx.use(logger)).label)),
		);
		const app = new Crust("cli").add(command).extend(provider, consumer);

		await app.run(["run"]);
		expect(events).toEqual(["extension", "extension"]);
		expect(() => new Crust("cli").provide(logger()).extend(provider)).toThrow(
			/Context "logger" is already provided/,
		);
	});

	it("resolves dependencies across Extension providers regardless of order", async () => {
		const base = defineContext("base", () => "base");
		const service = defineContext("service", async ({ ctx }) => `service:${await ctx.use(base)}`);
		const serviceProvider = defineExtension("service-provider", { provides: [service()] });
		const baseProvider = defineExtension("base-provider", { provides: [base()] });
		await new Crust("cli")
			.extend(serviceProvider, baseProvider)
			.action(async ({ ctx }) => expect(await ctx.use(service)).toBe("service:base"))
			.run([]);
	});

	it("attributes nested preRun flag rejection to the flag-owning Context", async () => {
		const token = defineFlag("token", { type: "string" });
		const auth = defineContext("auth", { flags: [token] }, ({ flags }) => flags.token);
		const service = defineContext("service", async ({ ctx }) => await ctx.use(auth));
		const extension = defineExtension("consumer", {
			hooks: { preRun: async (ctx) => void (await ctx.use(service)) },
		});
		const app = new Crust("cli")
			.provide(auth(), service())
			.extend(extension)
			.action(() => {});

		await expect(app.run([], { flags: { token: "secret" } })).rejects.toMatchObject({
			details: { name: "auth", reason: "flags-before-validation" },
		});
	});

	it("retries only flag-validation failures after preRun", async () => {
		let serviceSetups = 0;
		const token = defineFlag("token", { type: "string" });
		const auth = defineContext("auth", { flags: [token] }, ({ flags }) => flags.token);
		const service = defineContext("service", async ({ ctx }) => {
			serviceSetups++;
			return await ctx.use(auth);
		});
		const extension = defineExtension("consumer", {
			hooks: { preRun: async (ctx) => void (await ctx.use(service).catch(() => undefined)) },
		});
		const app = new Crust("cli")
			.provide(auth(), service())
			.extend(extension)
			.action(async ({ ctx }) => expect(await ctx.use(service)).toBe("secret"));

		await app.run([], { flags: { token: "secret" } });
		expect(serviceSetups).toBe(2);
	});

	it("memoizes a replacement error after setup swallows flag rejection", async () => {
		let setups = 0;
		const token = defineFlag("token", { type: "string" });
		const auth = defineContext("auth", { flags: [token] }, ({ flags }) => flags.token);
		const replacement = new Error("replacement");
		const service = defineContext("service", async ({ ctx }) => {
			setups++;
			await ctx.use(auth).catch(() => undefined);
			throw replacement;
		});
		const extension = defineExtension("consumer", {
			hooks: {
				preRun: async (ctx) => {
					await ctx.use(service).catch(() => undefined);
				},
			},
		});
		const app = new Crust("cli")
			.provide(auth(), service())
			.extend(extension)
			.action(async ({ ctx }) => expect(ctx.use(service)).rejects.toBe(replacement));

		await app.run([], { flags: { token: "secret" } });
		expect(setups).toBe(1);
	});

	it("memoizes ordinary setup rejections", async () => {
		let setups = 0;
		const failure = new Error("failed");
		const service = defineContext("service", () => {
			setups++;
			throw failure;
		});
		await new Crust("cli")
			.provide(service())
			.action(async ({ ctx }) => {
				await expect(ctx.use(service)).rejects.toBe(failure);
				await expect(ctx.use(service)).rejects.toBe(failure);
			})
			.run([]);
		expect(setups).toBe(1);
	});

	it("allows nested flag-free pulls in preRun", async () => {
		const base = defineContext("base", () => "ok");
		const service = defineContext("service", async ({ ctx }) => await ctx.use(base));
		const extension = defineExtension("consumer", {
			hooks: { preRun: async (ctx) => expect(await ctx.use(service)).toBe("ok") },
		});
		await new Crust("cli").provide(base(), service()).extend(extension).run([]);
	});

	it("rejects flag-owning Contexts after finish skips validation", async () => {
		const token = defineFlag("token", { type: "string" });
		const auth = defineContext("auth", { flags: [token] }, ({ flags }) => flags.token);
		const extension = defineExtension("consumer", {
			hooks: {
				preRun: (ctx) => ctx.finish(),
				postRun: async (ctx) => void (await ctx.use(auth)),
			},
		});
		const app = new Crust("cli")
			.provide(auth())
			.extend(extension)
			.action(() => {});

		await expect(app.run([])).rejects.toMatchObject({
			details: { reason: "flags-before-validation" },
		});
	});
});

describe("Context disposal", () => {
	function disposableContext(name: string, log: string[]) {
		return defineContext(name, () => ({
			name,
			async [Symbol.asyncDispose]() {
				log.push(`dispose:${name}`);
			},
		}));
	}

	it("keeps values live through postRun and disposes afterwards", async () => {
		const events: string[] = [];
		const resource = defineContext("resource", () => ({
			use() {
				events.push("use");
			},
			[Symbol.dispose]() {
				events.push("dispose");
			},
		}));
		const observer = defineExtension("observer", {
			hooks: {
				async postRun(ctx) {
					(await ctx.use(resource)).use();
					events.push("postRun");
				},
			},
		});
		const app = new Crust("cli")
			.provide(resource())
			.extend(observer)
			.action(async ({ ctx }) => (await ctx.use(resource)).use());

		await app.run([]);
		expect(events).toEqual(["use", "use", "postRun", "dispose"]);
	});

	it("disposes values in reverse construction order after success", async () => {
		const log: string[] = [];
		const first = disposableContext("first", log);
		const second = disposableContext("second", log);

		const app = new Crust("cli")
			.provide(first())
			.provide(second())
			.action(async ({ ctx }) => {
				await ctx.use(first);
				await ctx.use(second);
				log.push("run");
			});

		await app.run([]);

		expect(log).toEqual(["run", "dispose:second", "dispose:first"]);
	});

	it("disposes in reverse topological order when construction was reordered", async () => {
		const log: string[] = [];
		const base = defineContext("base", () => ({
			[Symbol.dispose]() {
				log.push("dispose:base");
			},
		}));
		const derived = defineContext("derived", async ({ ctx }) => {
			await ctx.use(base);
			return {
				[Symbol.dispose]() {
					log.push("dispose:derived");
				},
			};
		});

		// derived provided first, but base constructs first — so base disposes last
		await new Crust("cli")
			.provide(derived(), base())
			.action(async ({ ctx }) => {
				await ctx.use(derived);
				log.push("run");
			})
			.run([]);

		expect(log).toEqual(["run", "dispose:derived", "dispose:base"]);
	});

	it("disposes after an action failure and rethrows the original error", async () => {
		const log: string[] = [];
		const res = disposableContext("res", log);
		const boom = new Error("action failed");

		const app = new Crust("cli").provide(res()).action(async ({ ctx }) => {
			await ctx.use(res);
			throw boom;
		});

		await expect(app.run([])).rejects.toBe(boom);
		expect(log).toEqual(["dispose:res"]);
	});

	it("disposes already-constructed Contexts when a later setup fails", async () => {
		const log: string[] = [];
		const ok = disposableContext("ok", log);
		const bad = defineContext("bad", () => {
			throw new Error("setup failed");
		});

		const app = new Crust("cli")
			.provide(ok())
			.provide(bad())
			.action(async ({ ctx }) => {
				await ctx.use(ok);
				await ctx.use(bad);
				log.push("run");
			});

		await expect(app.run([])).rejects.toThrow("setup failed");
		expect(log).toEqual(["dispose:ok"]);
	});

	it("disposes constructed dependencies when a dependent setup fails before the action", async () => {
		const events: string[] = [];
		const resource = defineContext("resource", () => ({
			[Symbol.dispose]() {
				events.push("disposed");
			},
		}));
		const guard = defineContext("guard", async ({ ctx }) => {
			await ctx.use(resource);
			throw new Error("Unauthenticated");
		});
		const app = new Crust("cli").provide(resource(), guard()).action(async ({ ctx }) => {
			await ctx.use(guard);
			events.push("handled");
		});

		await expect(app.run([])).rejects.toThrow("Unauthenticated");
		expect(events).toEqual(["disposed"]);
	});
});
