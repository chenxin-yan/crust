import { describe, expect, it } from "bun:test";

import { Crust, defineCommand } from "../command/crust.ts";
import type { CaughtError } from "../errors.ts";
import { defineExtensionId } from "../identity.ts";
import {
	type AnyContextFactory,
	type ContextBag,
	type ContextInstance,
	type ContextSetup,
	createContextResolver,
	defineContext,
	FallbackAsyncDisposableStack,
} from "./context.ts";
import { defineExtension } from "./extension.ts";
import { defineFlag } from "./flags.ts";

type Assert<T extends true> = T;
type MutableDisposable = Partial<Disposable>;
type IsEqual<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe("defineContext()", () => {
	it("always returns a factory, including for zero-option setups", async () => {
		const auth = defineContext("auth", () => ({ user: "chenxin" }));

		// The definition itself is a factory, not an instance
		expect(auth).toBeInstanceOf(Function);
		expect(auth.contextName).toBe("auth");

		const instance = auth();
		expect(instance.kind).toBe("context");
		expect(instance.name).toBe("auth");
		await expect(
			Promise.resolve(
				instance.setup({
					flags: {},
					ctx: {},
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
					ctx: {},
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
			seen.push((await ctx.db).url);
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
			seen.push((await ctx.db).url);
		});

		await app.run([]);
		expect(seen).toEqual(["memory://x"]);
	});

	it("accepts multiple instances in one variadic call", async () => {
		const seen: string[] = [];
		const a = defineContext("a", () => "value-a");
		const b = defineContext("b", () => "value-b");

		const app = new Crust("cli").provide(a(), b()).action(async ({ ctx }) => {
			const aValue = await ctx.a;
			const bValue = await ctx.b;
			seen.push(`${aValue}:${bValue}`);
			type _A = Assert<IsEqual<typeof aValue, string>>;
			type _B = Assert<IsEqual<typeof bValue, string>>;
		});

		await app.run([]);
		expect(seen).toEqual(["value-a:value-b"]);
	});

	it("seeds added descendants with the parent Context path", async () => {
		const seen: string[] = [];
		const db = defineContext("db", () => "root-db");
		const sub = defineCommand("sub", (command) =>
			command.use(db).add(
				defineCommand("g", (child) =>
					child.use(db).action(async ({ ctx }) => {
						seen.push(await ctx.db);
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
		const mid = defineContext("mid", { uses: [base] }, async ({ ctx }) => {
			const value = await ctx.base;
			builtNames.push("mid");
			return `mid(${value})`;
		});
		const db = defineContext("db", { uses: [mid] }, async ({ ctx }) => {
			const value = await ctx.mid;
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
				cmd.use(db).action(async ({ ctx }) => {
					seen.push(await ctx.db);
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
		const b = defineContext("b", { uses: [a] }, async ({ ctx }) => {
			await ctx.a;
			builtNames.push("b");
			return "b";
		});
		const c = defineContext("c", { uses: [a] }, async ({ ctx }) => {
			await ctx.a;
			builtNames.push("c");
			return "c";
		});
		const d = defineContext("d", { uses: [b, c] }, async ({ ctx }) => {
			await Promise.all([ctx.b, ctx.c]);
			builtNames.push("d");
			return "d";
		});

		const app = new Crust("cli")
			.provide(a(), b(), c(), d())
			.add(defineCommand("go", (cmd) => cmd.use(d).action(async ({ ctx }) => void (await ctx.d))));

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
		const user = defineContext("user", { uses: [session] }, async ({ ctx }) => {
			const value = await ctx.session;
			builtNames.push("user");
			return `user(${value})`;
		});

		const seen: string[] = [];
		const app = new Crust("cli").provide(session(), unrelated()).add(
			defineCommand("account", (cmd) =>
				cmd
					.use(session)
					.provide(user())
					.action(async ({ ctx }) => {
						seen.push(await ctx.user);
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
			seen.push((await ctx.auth).apiKey);
		});
		await app.run([], { flags: { "api-key": "secret" } });

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
			.action(async ({ ctx }) => void (await ctx.server))
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
				await ctx.auth;
				await ctx.location;
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
			const log = await ctx.logging;
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
			command.use(auth).action(async ({ ctx }) => {
				seen.push(String((await ctx.auth).apiKey));
			}),
		);

		await new Crust("cli")
			.provide(auth())
			.add(deploy)
			.run(["deploy"], { flags: { "api-key": "secret" } });
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
					seen.push(`${name}:${(await ctx.auth).apiKey}`);
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
				expect((await ctx.auth).real).toBe(false);
			})
			.run([], { flags: { "api-key": "fake-key" } });
	});
});

describe("Context setup dependencies", () => {
	it("checks dependency graphs at every composition boundary", () => {
		const config = defineContext("config", () => ({ url: "memory://" }));
		const db = defineContext("db", { uses: [config] }, async ({ ctx }) => {
			// @ts-expect-error -- setup bags expose only declared Contexts
			void ctx.logger;
			return { url: (await ctx.config).url };
		});
		const fake = db.of({ url: "fake" });
		new Crust("cli").provide(fake);
		new Crust("cli").provide(db(), config());

		const command = defineCommand("run", (builder) =>
			builder.use(db).action(async ({ ctx }) => {
				void (await ctx.db);
				// @ts-expect-error -- action bags expose only declared Contexts
				void ctx.logger;
			}),
		);
		new Crust("cli").provide(config(), db()).add(command);

		const extension = defineExtension(defineExtensionId("typed-deps"), {
			uses: [db],
			hooks: { preRun: async ({ ctx }) => void (await ctx.db) },
		});
		new Crust("cli").provide(config(), db()).extend(extension);

		// A factory widened to AnyContextFactory opts out of the compile-time
		// dependency brand; wiring stays runtime-checked.
		const widened: AnyContextFactory = config;
		new Crust("cli").provide(widened(undefined));

		const invalidCompositions = () => {
			// @ts-expect-error -- db's transitive dependency closure is unsatisfied
			new Crust("cli").provide(db());
			// @ts-expect-error -- uses entries must be Context factories
			defineContext("bad", { uses: [42] }, () => 1);
			// @ts-expect-error -- command dependencies are checked by .add()
			new Crust("cli").add(command);
			// @ts-expect-error -- Extension dependencies are checked by .extend()
			new Crust("cli").extend(extension);
			const badProvides = defineExtension(defineExtensionId("bad-provides"), {
				provides: [db()],
			});
			// @ts-expect-error -- Extension provides with unmet transitive deps are checked by .extend()
			new Crust("cli").extend(badProvides);
			const badCommand = defineExtension(defineExtensionId("bad-command"), {
				commands: [command],
			});
			// @ts-expect-error -- Extension-contributed command deps are checked by .extend()
			new Crust("cli").extend(badCommand);
		};
		void invalidCompositions;
	});

	it("types and resolves declared Context bags in two- and three-argument setups", async () => {
		const session = defineContext("session", () => ({ userId: "yan" }));
		const user = defineContext("user", { uses: [session] }, async ({ ctx }) => {
			const value = await ctx.session;
			type _Session = Assert<IsEqual<typeof value, { userId: string }>>;
			// @ts-expect-error -- undeclared Contexts are absent from the bag
			void ctx.missing;
			return value.userId;
		});
		const configured = defineContext(
			"configured",
			{ uses: [user], flags: [] },
			async ({ ctx }) => await ctx.user,
		);

		await new Crust("cli")
			.provide(session(), user(), configured())
			.action(async ({ ctx }) => expect(await ctx.configured).toBe("yan"))
			.run([]);
	});

	it("exposes the transitive dependency closure at runtime", async () => {
		const base = defineContext("base", () => "base");
		const mid = defineContext("mid", { uses: [base] }, async ({ ctx }) => await ctx.base);
		const db = defineContext("db", { uses: [mid] }, async ({ ctx }) => await ctx.base);

		await new Crust("cli")
			.provide(db(), mid(), base())
			.action(async ({ ctx }) => expect(await ctx.db).toBe("base"))
			.run([]);
	});

	it("deduplicates repeated dependency names in a setup bag", async () => {
		const base = defineContext("base", () => "base");
		const db = defineContext("db", { uses: [base, base] }, async ({ ctx }) => await ctx.base);
		await new Crust("cli")
			.provide(base(), db())
			.action(async ({ ctx }) => expect(await ctx.db).toBe("base"))
			.run([]);
	});

	it("constructs a transitive chain lazily", async () => {
		const order: string[] = [];
		const base = defineContext("base", () => (order.push("base"), "base"));
		const mid = defineContext("mid", { uses: [base] }, async ({ ctx }) => `mid(${await ctx.base})`);
		const db = defineContext("db", { uses: [mid] }, async ({ ctx }) => {
			const value = `db(${await ctx.mid})`;
			order.push("db");
			return value;
		});
		const unused = defineContext("unused", () => (order.push("unused"), "unused"));
		await new Crust("cli")
			.provide(db(), unused(), mid(), base())
			.action(async ({ ctx }) => expect(await ctx.db).toBe("db(mid(base))"))
			.run([]);
		expect(order).toEqual(["base", "db"]);
	});

	it("only constructs conditionally pulled dependencies", async () => {
		let setups = 0;
		const remote = defineContext("remote", () => ({ id: ++setups }));
		const cache = defineContext(
			"cache",
			{ uses: [remote] },
			async ({ options, ctx }: ContextSetup<boolean, {}, { remote: { id: number } }>) =>
				options ? await ctx.remote : { id: 0 },
		);

		await new Crust("cli")
			.provide(remote(), cache(false))
			.action(async ({ ctx }) => void (await ctx.cache))
			.run([]);
		expect(setups).toBe(0);
		await new Crust("cli")
			.provide(remote(), cache(true))
			.action(async ({ ctx }) => void (await ctx.cache))
			.run([]);
		expect(setups).toBe(1);
	});

	it("shares dependencies in a concurrent diamond without reporting a cycle", async () => {
		let baseSetups = 0;
		const base = defineContext("base", async () => ({ id: ++baseSetups }));
		const left = defineContext("left", { uses: [base] }, async ({ ctx }) => (await ctx.base).id);
		const right = defineContext("right", { uses: [base] }, async ({ ctx }) => (await ctx.base).id);
		const top = defineContext("top", { uses: [left, right] }, async ({ ctx }) =>
			Promise.all([ctx.left, ctx.right]),
		);
		await new Crust("cli")
			.provide(top(), right(), base(), left())
			.action(async ({ ctx }) => {
				expect(await ctx.top).toEqual([1, 1]);
			})
			.run([]);
		expect(baseSetups).toBe(1);
	});

	it("accepts dependencies in the same call in any order and across ordered calls", async () => {
		const base = defineContext("base", () => "base");
		const dependent = defineContext(
			"dependent",
			{ uses: [base] },
			async ({ ctx }) => await ctx.base,
		);
		await new Crust("cli")
			.provide(dependent(), base())
			.action(async ({ ctx }) => expect(await ctx.dependent).toBe("base"))
			.run([]);
		await new Crust("cli")
			.provide(base())
			.provide(dependent())
			.action(async ({ ctx }) => expect(await ctx.dependent).toBe("base"))
			.run([]);
	});

	it("lets .of() cut the dependency graph while retaining owned flags", async () => {
		const token = defineFlag("token", { type: "string" });
		const missing = defineContext("missing", () => "real");
		const db = defineContext(
			"db",
			{ uses: [missing], flags: [token] },
			async ({ ctx }) => await ctx.missing,
		);
		const app = new Crust("cli").provide(db.of("fake")).action(async ({ ctx }) => {
			expect(await ctx.db).toBe("fake");
		});
		await app.run([], { flags: { token: "x" } });
	});

	it("exposes the typed transitive closure above an .of() cut", async () => {
		const config = defineContext("config", () => ({ url: "memory://" }));
		const db = defineContext("db", { uses: [config] }, async ({ ctx }) => ({
			url: (await ctx.config).url,
		}));
		const report = defineContext("report", { uses: [db] }, async ({ ctx }) => {
			// The type-level closure includes config even when db is provided as a
			// .of() double; the runtime bag must match it.
			const url = (await ctx.config).url;
			return `report:${url}`;
		});
		await new Crust("cli")
			.provide(db.of({ url: "fake" }), config(), report())
			.action(async ({ ctx }) => expect(await ctx.report).toBe("report:memory://"))
			.run([]);
	});

	it("fails loud when a transitive dependency above an .of() cut is unprovided", async () => {
		const config = defineContext("config", () => "config");
		const db = defineContext("db", { uses: [config] }, async ({ ctx }) => await ctx.config);
		const report = defineContext("report", { uses: [db] }, async ({ ctx }) => await ctx.config);
		const app = new Crust("cli")
			.provide(db.of("fake"), report() as never)
			.action(async ({ ctx }) => void (await (ctx as { report: Promise<string> }).report));
		await expect(app.run([])).rejects.toMatchObject({
			details: { name: "config", reason: "missing-context" },
		});
	});

	it("builds Extension hook bags from the declared factory graph across an .of() cut", async () => {
		const config = defineContext("config", () => "memory://");
		const db = defineContext("db", { uses: [config] }, async ({ ctx }) => await ctx.config);
		let seen: string | undefined;
		const observer = defineExtension(defineExtensionId("of-cut-observer"), {
			uses: [db],
			hooks: {
				preRun: async ({ ctx }) => {
					seen = await ctx.config;
				},
			},
		});
		await new Crust("cli").provide(db.of("fake"), config()).extend(observer).run([]);
		expect(seen).toBe("memory://");
	});
});

describe("Context dependency runtime boundaries", () => {
	it("rejects a hook dependency absent from a stale child path", async () => {
		const logger = defineContext("logger", () => "logger");
		const child = defineCommand("child", (builder) => builder.action(() => {}));
		const observer = defineExtension(defineExtensionId("observer"), {
			uses: [logger],
			hooks: { preRun: async ({ ctx }) => void (await ctx.logger) },
		});
		// .provide() is positional (flag scoping): the child added before it never
		// inherits logger, so the hook's pull on that path fails loud lazily even
		// though .extend() typechecked against the root's final Ctx.
		const app = new Crust("cli").add(child).provide(logger()).extend(observer);

		await expect(app.run(["child"])).rejects.toMatchObject({
			details: { name: "logger", reason: "missing-context" },
		});
		// The root path is healthy: logger was provided before .extend().
		await expect(app.run([])).resolves.toEqual({ status: "completed", result: undefined });
	});

	it("keeps a child's locally provided Context over a root Extension provider", async () => {
		const service = defineContext("service", () => "extension");
		const values: string[] = [];
		const child = defineCommand("child", (builder) =>
			builder
				.provide(service.of("local"))
				.action(async ({ ctx }) => void values.push(await ctx.service)),
		);
		const provider = defineExtension(defineExtensionId("provider"), { provides: [service()] });
		// ValidateExtensionProvides sees only the root Ctx (Tree carries no context
		// names), so this composition typechecks; the child's local provider is
		// more specific and must win on its own path.
		const app = new Crust("cli")
			.add(child)
			.extend(provider)
			.action(async ({ ctx }) => void values.push(await ctx.service));

		await app.run(["child"]);
		await app.run([]);
		expect(values).toEqual(["local", "extension"]);
	});

	it("accepts an Extension dependency provided by an earlier .extend() call", async () => {
		const logger = defineContext("logger", () => "logger");
		const providerExtension = defineExtension(defineExtensionId("provider"), {
			provides: [logger()],
		});
		let seen: string | undefined;
		const consumerExtension = defineExtension(defineExtensionId("consumer"), {
			uses: [logger],
			hooks: {
				preRun: async ({ ctx }) => {
					seen = await ctx.logger;
				},
			},
		});
		await new Crust("cli").extend(providerExtension).extend(consumerExtension).run([]);
		expect(seen).toBe("logger");
	});

	it("keeps dynamic cycle detection for untyped Context instances", async () => {
		const aFactory = defineContext("a", () => "a");
		const bFactory = defineContext("b", () => "b");
		const a: ContextInstance<"a"> = {
			kind: "context",
			name: "a",
			ownedFlags: {},
			uses: [bFactory],
			setup: async ({ ctx }) => {
				// SAFETY: this malformed dynamic cycle fixture declares b through uses.
				return await (ctx as ContextBag<{ b: string }>).b;
			},
		};
		const b: ContextInstance<"b"> = {
			kind: "context",
			name: "b",
			ownedFlags: {},
			uses: [aFactory],
			setup: async ({ ctx }) => {
				// SAFETY: this malformed dynamic cycle fixture declares a through uses.
				return await (ctx as ContextBag<{ a: string }>).a;
			},
		};
		const app = new Crust("cli").provide(a, b).action(async ({ ctx }) => void (await ctx.a));

		await expect(app.run([])).rejects.toMatchObject({
			details: { reason: "context-cycle" },
		});
	});

	it("pre-handles early bag rejections so enumeration cannot crash the process", async () => {
		const token = defineFlag("token", { type: "string" });
		const gate = defineContext("gate", { flags: [token] }, () => "gate");
		let unhandled: CaughtError;
		const onUnhandled = (error: CaughtError) => {
			unhandled = error;
		};
		process.on("unhandledRejection", onUnhandled);
		try {
			await using disposal = new AsyncDisposableStack();
			const resolver = createContextResolver(
				[gate()],
				{ stdout: () => {}, stderr: () => {} },
				disposal,
			);
			const bag = resolver.bag<{ gate: string }>([gate]);
			// Spread invokes every getter without awaiting; before flag validation the
			// getter returns a rejected promise that must arrive pre-handled.
			const spread = { ...bag };
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(unhandled).toBeUndefined();
			await expect(spread.gate).rejects.toMatchObject({
				details: { reason: "flags-before-validation" },
			});
		} finally {
			// TODO: drop cast once https://github.com/oven-sh/bun/issues/40003 is fixed.
			// Cast: bun-types 1.4.0's memoryPressure override shadows the generic overload.
			(process as NodeJS.EventEmitter).off("unhandledRejection", onUnhandled);
		}
	});

	it("keeps missing and disposed guards on lazy bag getters", async () => {
		const service = defineContext("service", () => "service");
		await using missingDisposal = new AsyncDisposableStack();
		const missing = createContextResolver(
			[],
			{ stdout: () => {}, stderr: () => {} },
			missingDisposal,
		).bag<{ service: string }>([service]);
		await expect(missing.service).rejects.toMatchObject({ details: { reason: "missing-context" } });

		let disposed: ContextBag<{ service: string }>;
		{
			await using disposal = new AsyncDisposableStack();
			disposed = createContextResolver(
				[service()],
				{ stdout: () => {}, stderr: () => {} },
				disposal,
			).bag<{ service: string }>([service]);
		}
		await expect(disposed.service).rejects.toMatchObject({
			details: { reason: "context-after-disposal" },
		});
	});
});

describe("lazy Context bags", () => {
	it("memoizes a degraded value a setup returned after catching the flag-phase rejection", async () => {
		const token = defineFlag("token", { type: "string" });
		const gate = defineContext("gate", { flags: [token] }, () => "real");
		let setups = 0;
		const wrapper = defineContext("wrapper", { uses: [gate] }, async ({ ctx }) => {
			setups += 1;
			try {
				return await ctx.gate;
			} catch {
				// Only the flag-phase *rejection* retries after validation; a setup that
				// swallows it memoizes the degraded value for the whole invocation.
				return "degraded";
			}
		});
		const observer = defineExtension(defineExtensionId("degraded-observer"), {
			uses: [wrapper],
			hooks: { preRun: async ({ ctx }) => void (await ctx.wrapper) },
		});
		await new Crust("cli")
			.provide(gate(), wrapper())
			.extend(observer)
			.action(async ({ ctx }) => {
				expect(await ctx.wrapper).toBe("degraded");
			})
			.run([], { flags: { token: "x" } });
		expect(setups).toBe(1);
	});

	it("memoizes one value across hooks and the action", async () => {
		let setups = 0;
		const service = defineContext("service", () => ({ id: ++setups }));
		const seen: number[] = [];
		const observer = defineExtension(defineExtensionId("observer"), {
			uses: [service],
			hooks: {
				async preRun(ctx) {
					seen.push((await ctx.ctx.service).id);
				},
				async postRun(ctx) {
					seen.push((await ctx.ctx.service).id);
				},
			},
		});
		const app = new Crust("cli")
			.provide(service())
			.extend(observer)
			.action(async ({ ctx }) => void seen.push((await ctx.service).id));

		await app.run([]);
		expect(setups).toBe(1);
		expect(seen).toEqual([1, 1, 1]);
	});

	it("shares one setup across concurrent pulls", async () => {
		let setups = 0;
		const service = defineContext("service", async () => ({ id: ++setups }));
		const app = new Crust("cli").provide(service()).action(async ({ ctx }) => {
			const [first, second] = await Promise.all([ctx.service, ctx.service]);
			expect(first).toBe(second);
		});

		await app.run([]);
		expect(setups).toBe(1);
	});

	it("installs Extension providers for commands and other Extensions", async () => {
		const logger = defineContext("logger", () => ({ label: "extension" }));
		const events: string[] = [];
		const provider = defineExtension(defineExtensionId("provider"), { provides: [logger()] });
		const consumer = defineExtension(defineExtensionId("consumer"), {
			uses: [logger],
			hooks: { preRun: async (ctx) => void events.push((await ctx.ctx.logger).label) },
		});
		const command = defineCommand("run", (builder) =>
			builder.use(logger).action(async ({ ctx }) => void events.push((await ctx.logger).label)),
		);
		const app = new Crust("cli").extend(provider, consumer).add(command);

		await app.run(["run"]);
		expect(events).toEqual(["extension", "extension"]);
	});

	it("resolves dependencies across Extension providers regardless of order", async () => {
		const base = defineContext("base", () => "base");
		const service = defineContext(
			"service",
			{ uses: [base] },
			async ({ ctx }) => `service:${await ctx.base}`,
		);
		const serviceProvider = defineExtension(defineExtensionId("service-provider"), {
			provides: [service()],
		});
		const baseProvider = defineExtension(defineExtensionId("base-provider"), {
			provides: [base()],
		});
		await new Crust("cli")
			.extend(serviceProvider, baseProvider)
			.action(async ({ ctx }) => expect(await ctx.service).toBe("service:base"))
			.run([]);
	});

	it("attributes nested preRun flag rejection to the flag-owning Context", async () => {
		const token = defineFlag("token", { type: "string" });
		const auth = defineContext("auth", { flags: [token] }, ({ flags }) => flags.token);
		const service = defineContext("service", { uses: [auth] }, async ({ ctx }) => await ctx.auth);
		const extension = defineExtension(defineExtensionId("consumer"), {
			uses: [service],
			hooks: { preRun: async (ctx) => void (await ctx.ctx.service) },
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
		const service = defineContext("service", { uses: [auth] }, async ({ ctx }) => {
			serviceSetups++;
			return await ctx.auth;
		});
		const extension = defineExtension(defineExtensionId("consumer"), {
			uses: [service],
			hooks: { preRun: async (ctx) => void (await ctx.ctx.service.catch(() => undefined)) },
		});
		const app = new Crust("cli")
			.provide(auth(), service())
			.extend(extension)
			.action(async ({ ctx }) => expect(await ctx.service).toBe("secret"));

		await app.run([], { flags: { token: "secret" } });
		expect(serviceSetups).toBe(2);
	});

	it("retries flag-validation failures the setup wrapped with a cause", async () => {
		let serviceSetups = 0;
		const token = defineFlag("token", { type: "string" });
		const auth = defineContext("auth", { flags: [token] }, ({ flags }) => flags.token);
		const service = defineContext("service", { uses: [auth] }, async ({ ctx }) => {
			serviceSetups++;
			try {
				return await ctx.auth;
			} catch (error) {
				throw new Error("auth unavailable", { cause: error });
			}
		});
		const extension = defineExtension(defineExtensionId("consumer"), {
			uses: [service],
			hooks: { preRun: async (ctx) => void (await ctx.ctx.service.catch(() => undefined)) },
		});
		const app = new Crust("cli")
			.provide(auth(), service())
			.extend(extension)
			.action(async ({ ctx }) => expect(await ctx.service).toBe("secret"));

		await app.run([], { flags: { token: "secret" } });
		expect(serviceSetups).toBe(2);
	});

	it("rejects with the setup error even when its cause getter throws", async () => {
		const hostile = new Error("setup failed");
		Object.defineProperty(hostile, "cause", {
			get() {
				throw new Error("trap");
			},
		});
		const broken = defineContext("broken", () => {
			throw hostile;
		});
		const app = new Crust("cli").provide(broken()).action(async ({ ctx }) => {
			await ctx.broken;
		});

		await expect(app.run([])).rejects.toBe(hostile);
	}, 500);

	it("memoizes a replacement error after setup swallows flag rejection", async () => {
		let setups = 0;
		const token = defineFlag("token", { type: "string" });
		const auth = defineContext("auth", { flags: [token] }, ({ flags }) => flags.token);
		const replacement = new Error("replacement");
		const service = defineContext("service", { uses: [auth] }, async ({ ctx }) => {
			setups++;
			await ctx.auth.catch(() => undefined);
			throw replacement;
		});
		const extension = defineExtension(defineExtensionId("consumer"), {
			uses: [service],
			hooks: {
				preRun: async (ctx) => {
					await ctx.ctx.service.catch(() => undefined);
				},
			},
		});
		const app = new Crust("cli")
			.provide(auth(), service())
			.extend(extension)
			.action(async ({ ctx }) => {
				await expect(ctx.service).rejects.toBe(replacement);
			});

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
				await expect(ctx.service).rejects.toBe(failure);
				await expect(ctx.service).rejects.toBe(failure);
			})
			.run([]);
		expect(setups).toBe(1);
	});

	it("allows nested flag-free pulls in preRun", async () => {
		const base = defineContext("base", () => "ok");
		const service = defineContext("service", { uses: [base] }, async ({ ctx }) => await ctx.base);
		const extension = defineExtension(defineExtensionId("consumer"), {
			uses: [service],
			hooks: { preRun: async (ctx) => expect(await ctx.ctx.service).toBe("ok") },
		});
		await new Crust("cli").provide(base(), service()).extend(extension).run([]);
	});

	it("rejects flag-owning Contexts after finish skips validation", async () => {
		const token = defineFlag("token", { type: "string" });
		const auth = defineContext("auth", { flags: [token] }, ({ flags }) => flags.token);
		const extension = defineExtension(defineExtensionId("consumer"), {
			uses: [auth],
			hooks: {
				preRun: (ctx) => ctx.finish(),
				postRun: async (ctx) => void (await ctx.ctx.auth),
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
		const observer = defineExtension(defineExtensionId("observer"), {
			uses: [resource],
			hooks: {
				async postRun(ctx) {
					(await ctx.ctx.resource).use();
					events.push("postRun");
				},
			},
		});
		const app = new Crust("cli")
			.provide(resource())
			.extend(observer)
			.action(async ({ ctx }) => (await ctx.resource).use());

		await app.run([]);
		expect(events).toEqual(["use", "use", "postRun", "dispose"]);
	});

	it("constructs a Context first pulled from postRun after a failed action", async () => {
		const events: string[] = [];
		const resource = defineContext("resource", () => ({
			use() {
				events.push("use");
			},
			[Symbol.dispose]() {
				events.push("dispose");
			},
		}));
		const observer = defineExtension(defineExtensionId("observer"), {
			uses: [resource],
			hooks: {
				async postRun(ctx) {
					(await ctx.ctx.resource).use();
				},
			},
		});
		const failure = new Error("action failed");
		const app = new Crust("cli")
			.provide(resource())
			.extend(observer)
			.action(() => {
				throw failure;
			});

		await expect(app.run([])).rejects.toBe(failure);
		expect(events).toEqual(["use", "dispose"]);
	});

	it("disposes a value once when an alias setup returns it", async () => {
		let disposals = 0;
		const db = defineContext("db", () => ({
			[Symbol.dispose]() {
				disposals++;
			},
		}));
		const alias = defineContext("alias", { uses: [db] }, async ({ ctx }) => await ctx.db);
		await new Crust("cli")
			.provide(db(), alias())
			.action(async ({ ctx }) => {
				expect(await ctx.alias).toBe(await ctx.db);
			})
			.run([]);
		expect(disposals).toBe(1);
	});

	it("disposes a shared value decorated with a disposer after first being returned bare", async () => {
		let disposals = 0;
		const shared: MutableDisposable = {};
		const bare = defineContext("bare", () => shared);
		const decorated = defineContext("decorated", { uses: [bare] }, async ({ ctx }) => {
			const value = await ctx.bare;
			value[Symbol.dispose] = () => {
				disposals++;
			};
			return value;
		});
		await new Crust("cli")
			.provide(bare(), decorated())
			.action(async ({ ctx }) => {
				await ctx.decorated;
			})
			.run([]);
		expect(disposals).toBe(1);
	});

	it("disposes a slow sibling setup that finishes after a failed invocation", async () => {
		let disposals = 0;
		const fast = defineContext("fast", () => {
			throw new Error("boom");
		});
		const slow = defineContext("slow", async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
			return {
				[Symbol.dispose]() {
					disposals++;
				},
			};
		});
		const app = new Crust("cli").provide(fast(), slow()).action(async ({ ctx }) => {
			await Promise.all([ctx.fast, ctx.slow]);
		});

		await expect(app.run([])).rejects.toThrow("boom");
		expect(disposals).toBe(1);
	});

	it("disposes values in reverse construction order after success", async () => {
		const log: string[] = [];
		const first = disposableContext("first", log);
		const second = disposableContext("second", log);

		const app = new Crust("cli")
			.provide(first())
			.provide(second())
			.action(async ({ ctx }) => {
				await ctx.first;
				await ctx.second;
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
		const derived = defineContext("derived", { uses: [base] }, async ({ ctx }) => {
			await ctx.base;
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
				await ctx.derived;
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
			await ctx.res;
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
				await ctx.ok;
				await ctx.bad;
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
		const guard = defineContext("guard", { uses: [resource] }, async ({ ctx }) => {
			await ctx.resource;
			throw new Error("Unauthenticated");
		});
		const app = new Crust("cli").provide(resource(), guard()).action(async ({ ctx }) => {
			await ctx.guard;
			events.push("handled");
		});

		await expect(app.run([])).rejects.toThrow("Unauthenticated");
		expect(events).toEqual(["disposed"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// FallbackAsyncDisposableStack (Node 22 lacks the AsyncDisposableStack global)
// ────────────────────────────────────────────────────────────────────────────

describe("FallbackAsyncDisposableStack", () => {
	it("disposes used resources and deferred callbacks in LIFO order", async () => {
		const order: string[] = [];
		{
			await using disposal = new FallbackAsyncDisposableStack();
			disposal.use({ [Symbol.dispose]: () => order.push("sync") });
			disposal.use({
				[Symbol.asyncDispose]: async () => {
					order.push("async");
				},
			});
			disposal.defer(() => {
				order.push("deferred");
			});
		}
		expect(order).toEqual(["deferred", "async", "sync"]);
	});

	it("prefers asyncDispose when a resource has both, and returns the resource", async () => {
		const order: string[] = [];
		const resource = {
			[Symbol.dispose]: () => order.push("sync"),
			[Symbol.asyncDispose]: async () => {
				order.push("async");
			},
		};
		{
			await using disposal = new FallbackAsyncDisposableStack();
			expect(disposal.use(resource)).toBe(resource);
		}
		expect(order).toEqual(["async"]);
	});

	it("disposes every resource even when one throws, then rethrows", async () => {
		const order: string[] = [];
		const run = async () => {
			await using disposal = new FallbackAsyncDisposableStack();
			disposal.defer(() => {
				order.push("first");
			});
			disposal.defer(() => {
				throw new Error("boom");
			});
			disposal.defer(() => {
				order.push("last");
			});
		};
		await expect(run()).rejects.toThrow("boom");
		expect(order).toEqual(["last", "first"]);
	});
});

describe("inline .command()", () => {
	it("seeds the recipe with call-site Contexts and types the inline action", async () => {
		const auth = defineContext("auth", () => ({ user: "chenxin" }));
		const app = new Crust("cli").provide(auth()).command("whoami", (cmd) =>
			cmd
				.flags({ name: "loud", type: "boolean" })
				.args({ name: "suffix", type: "string" })
				.action(async ({ args, flags, ctx }) => {
					type _Suffix = Assert<IsEqual<typeof args.suffix, string | undefined>>;
					type _Loud = Assert<IsEqual<typeof flags.loud, boolean | undefined>>;
					const identity = await ctx.auth;
					type _Auth = Assert<IsEqual<typeof identity, { user: string }>>;
					// @ts-expect-error -- undeclared Contexts are absent from the inline bag
					void ctx.missing;
					return `${identity.user}${args.suffix ?? ""}`;
				}),
		);

		const outcome = await app.run(["whoami"], { args: { suffix: "!" } });
		expect(outcome).toEqual({ status: "completed", result: "chenxin!" });
	});

	it("does not see Contexts provided after the .command() call site", async () => {
		const logger = defineContext("logger", () => "logger");
		const app = new Crust("cli")
			.command("early", (cmd) =>
				cmd.action(({ ctx }) => {
					// @ts-expect-error -- .provide() is positional; a later Context never reaches an earlier .command()
					void ctx.logger;
					// Runtime matches the types: the earlier child path never inherits
					// the later Context, so its bag has no such member.
					return "logger" in ctx;
				}),
			)
			.provide(logger())
			.action(async ({ ctx }) => "logger" in ctx && (await ctx.logger));

		expect(await app.run(["early"])).toEqual({ status: "completed", result: false });
		// The root path itself sees the Context it provided.
		expect(await app.run([])).toEqual({ status: "completed", result: "logger" });
	});

	it("brands inline .use() demands that the call site does not provide", () => {
		const config = defineContext("config", () => ({ url: "memory://" }));
		const db = defineContext("db", { uses: [config] }, async ({ ctx }) => await ctx.config);

		// Satisfied demand (including db's transitive closure) composes cleanly.
		new Crust("cli")
			.provide(config(), db())
			.command("query", (cmd) => cmd.use(db).action(async ({ ctx }) => void (await ctx.db)));

		const invalidCompositions = () => {
			// @ts-expect-error -- inline .use(db) demand is unmet at the call site
			new Crust("cli").command("query", (cmd) => cmd.use(db).action(() => {}));
			new Crust("cli")
				.provide(db.of({ url: "fake" }))
				// @ts-expect-error -- db's transitive config dependency is still unmet
				.command("query", (cmd) => cmd.use(db).action(() => {}));
		};
		void invalidCompositions;
	});

	it("keeps .use() brand parity for defineCommand at .add() and .extend()", () => {
		const config = defineContext("config", () => ({ url: "memory://" }));
		const db = defineContext("db", { uses: [config] }, async ({ ctx }) => await ctx.config);
		const query = defineCommand("query", (cmd) =>
			cmd.use(db).action(async ({ ctx }) => void (await ctx.db)),
		);
		const carrier = defineExtension(defineExtensionId("carrier"), { commands: [query] });

		new Crust("cli").provide(config(), db()).add(query);
		new Crust("cli").provide(config(), db()).extend(carrier);

		const invalidCompositions = () => {
			// @ts-expect-error -- db's transitive config dependency is unmet at .add()
			new Crust("cli").provide(db.of({ url: "fake" })).add(query);
			// @ts-expect-error -- db's transitive config dependency is unmet at .extend()
			new Crust("cli").provide(db.of({ url: "fake" })).extend(carrier);
		};
		void invalidCompositions;
	});

	it("rejects a Context instance passed to .use() at runtime", () => {
		const logger = defineContext("logger", () => "logger");
		expect(() =>
			new Crust("cli").command("sub", (cmd) =>
				// SAFETY: deliberately bypass the factory-only signature to verify the runtime guard.
				(cmd.use as (instance: ContextInstance) => never)(logger()),
			),
		).toThrow(/expects a Context factory/);
	});

	it("rejects an inline command name that is already registered", () => {
		expect(() =>
			new Crust("cli")
				.command("dup", (cmd) => cmd.action(() => {}))
				.command("dup", (cmd) => cmd.action(() => {})),
		).toThrow(/already registered/);
	});
});
