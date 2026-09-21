import { describe, expect, it } from "bun:test";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { unwrap } from "../../tests/helpers.ts";
import { Crust, defineCommand } from "../command/crust.ts";
import type { CaughtError } from "../errors.ts";
import { defineExtensionId } from "../identity.ts";
import {
	type ContextBag,
	type ContextSetup,
	contextSources,
	createContextResolver,
	defineContext,
	FallbackAsyncDisposableStack,
} from "./context.ts";
import { defineExtension } from "./extension.ts";
import { defineFlag } from "./flags.ts";
type MutableDisposable = Partial<Disposable>;

describe("defineContext()", () => {
	it("always returns a factory, including for zero-option setups", async () => {
		const auth = defineContext("auth", () => ({ user: "chenxin" }));

		// The definition itself is a factory, not an instance
		expect(auth).toBeInstanceOf(Function);
		expect(auth.contextName).toBe("auth");

		const instance = auth();
		expect(instance.name).toBe("auth");
		await expect(
			Promise.resolve(
				instance.setup({
					signal: new AbortController().signal,
					flags: {},
					ctx: {},
					defer: () => {},
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
					signal: new AbortController().signal,
					flags: {},
					ctx: {},
					defer: () => {},
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
		type _Name = Expect<Equal<(typeof fake)["name"], "db">>;
		// @ts-expect-error -- .of() takes the Context's value type
		db.of({ wrong: true });

		const seen: string[] = [];
		const app = new Crust("cli").provide(fake).action(async ({ ctx }) => {
			seen.push((await ctx.db).url);
		});
		await unwrap(app.run([]));
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

		await unwrap(app.run([]));
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
			type _A = Expect<Equal<typeof aValue, string>>;
			type _B = Expect<Equal<typeof bValue, string>>;
		});

		await unwrap(app.run([]));
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

		await unwrap(root.run(["sub", "g"]));

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
		await unwrap(app.run(["a"]));
		expect(built).toBe(0);

		// Unused providers remain lazy on every command path.
		await unwrap(app.run(["b"]));
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

		await unwrap(app.run(["query"]));

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

		await unwrap(app.run(["go"]));

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

		await unwrap(app.run(["account"]));

		expect(builtNames).toEqual(["session", "user"]);
		expect(seen).toEqual(["user(session)"]);
	});

	it("throws DEFINITION when .provide() owns a colliding flag", () => {
		const owner = defineContext("owner", { flags: [{ name: "mode", type: "string" }] }, () => ({}));
		const app = new Crust("cli").flags({ name: "mode", type: "string" });

		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		expect(() => app.provide(owner())).toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				details: { subject: "flag", name: "mode", reason: "flag-collision" },
			}),
		);
	});

	it("does not backfill added children with later parent provides", async () => {
		const late = defineContext("late", () => "late");
		const app = new Crust("cli")
			.add(defineCommand("status", (command) => command.action(({ ctx }) => "late" in ctx)))
			.provide(late());

		expect(await app.run(["status"])).toMatchObject({ status: "completed", result: false });
	});
});

const apiKey = defineFlag("api-key", { type: "string", short: "k", aliases: ["token"] });

describe("Context-owned flags", () => {
	it("installs a propagating cloned flag and exposes its validated value to setup", async () => {
		const seen: unknown[] = [];
		const auth = defineContext("auth", { flags: [apiKey] }, ({ flags }) => {
			type _ApiKey = Expect<Equal<(typeof flags)["api-key"], string | undefined>>;
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
			type _ActionApiKey = Expect<Equal<(typeof flags)["api-key"], string | undefined>>;
			seen.push((await ctx.auth).apiKey);
		});
		await unwrap(app.run([], { flags: { "api-key": "secret" } }));

		expect(seen).toEqual(["secret", "secret"]);
	});

	it("passes parsed owned flag values to setup", async () => {
		const port = defineFlag("port", { type: "string", parse: Number });
		const seen: number[] = [];
		const server = defineContext("server", { flags: [port] }, ({ flags }) => {
			type _Port = Expect<Equal<typeof flags.port, number | undefined>>;
			if (flags.port !== undefined) seen.push(flags.port);
			return {};
		});

		await unwrap(
			new Crust("cli")
				.provide(server())
				.action(async ({ ctx }) => void (await ctx.server))
				.run([], { flags: { port: "8080" } }),
		);

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

		await unwrap(
			new Crust("cli")
				.provide(auth(), location())
				.action(async ({ ctx }) => {
					await ctx.auth;
					await ctx.location;
				})
				.run([], { flags: { "api-key": "secret", region: "us" } }),
		);

		expect(seen).toEqual([["api-key"], ["region"]]);
	});

	it("builds behavior capabilities with the action's injected io", async () => {
		const verbose = defineFlag("verbose", { type: "boolean" });
		let setupStdout: ((text: string) => void) | undefined;
		let setupStderr: ((text: string) => void) | undefined;
		const logging = defineContext("logging", { flags: [verbose] }, ({ flags, stdout, stderr }) => {
			type _Stdout = Expect<Equal<typeof stdout, (text: string) => void>>;
			type _Stderr = Expect<Equal<typeof stderr, (text: string) => void>>;
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

		await unwrap(app.run([], { flags: { verbose: true } }, { stdout, stderr }));
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

		await unwrap(
			new Crust("cli")
				.provide(auth())
				.add(deploy)
				.run(["deploy"], { flags: { "api-key": "secret" } }),
		);
		expect(seen).toEqual(["secret"]);
	});

	it("keeps owned flags when later .flags() calls accumulate local flags", async () => {
		expect.assertions(2);
		const auth = defineContext("auth", { flags: [apiKey] }, () => ({}));
		const app = new Crust("cli")
			.provide(auth())
			.flags({ name: "verbose", type: "boolean" })
			.action(({ flags }) => {
				expect(flags["api-key"]).toBe("secret");
				expect(flags.verbose).toBe(true);
			});

		await unwrap(app.run([], { flags: { "api-key": "secret", verbose: true } }));
	});

	it("allows one owning factory on sibling command branches", async () => {
		const seen: string[] = [];
		const auth = defineContext("auth", { flags: [apiKey] }, ({ flags }) => ({
			apiKey: flags["api-key"],
		}));
		const branch = (name: "first" | "second") =>
			defineCommand(name, (command) =>
				command.provide(auth()).action(async ({ ctx }) => {
					seen.push(`${name}:${(await ctx.auth).apiKey}`);
				}),
			);
		const app = new Crust("cli").add(branch("first"), branch("second"));

		await unwrap(app.run(["first"], { flags: { "api-key": "one" } }));
		await unwrap(app.run(["second"], { flags: { "api-key": "two" } }));

		expect(seen).toEqual(["first:one", "second:two"]);
	});

	it("retains owned flags on .of() test doubles", async () => {
		expect.assertions(3);
		const auth = defineContext("auth", { flags: [apiKey] }, () => ({ real: true }));
		const fake = auth.of({ real: false });
		expect(fake.ownedFlags["api-key"]).toBeDefined();

		await unwrap(
			new Crust("cli")
				.provide(fake)
				.action(async ({ flags, ctx }) => {
					expect(flags["api-key"]).toBe("fake-key");
					expect((await ctx.auth).real).toBe(false);
				})
				.run([], { flags: { "api-key": "fake-key" } }),
		);
	});
});

describe("Context setup dependencies", () => {
	it("types and resolves declared Context bags in two- and three-argument setups", async () => {
		expect.assertions(1);
		const session = defineContext("session", () => ({ userId: "yan" }));
		const user = defineContext("user", { uses: [session] }, async ({ ctx }) => {
			const value = await ctx.session;
			type _Session = Expect<Equal<typeof value, { userId: string }>>;
			// @ts-expect-error -- undeclared Contexts are absent from the bag
			void ctx.missing;
			return value.userId;
		});
		const configured = defineContext(
			"configured",
			{ uses: [user], flags: [] },
			async ({ ctx }) => await ctx.user,
		);

		await unwrap(
			new Crust("cli")
				.provide(session(), user(), configured())
				.action(async ({ ctx }) => expect(await ctx.configured).toBe("yan"))
				.run([]),
		);
	});

	it("exposes the transitive dependency closure at runtime", async () => {
		expect.assertions(1);
		const base = defineContext("base", () => "base");
		const mid = defineContext("mid", { uses: [base] }, async ({ ctx }) => await ctx.base);
		const db = defineContext("db", { uses: [mid] }, async ({ ctx }) => await ctx.base);

		await unwrap(
			new Crust("cli")
				.provide(db(), mid(), base())
				.action(async ({ ctx }) => expect(await ctx.db).toBe("base"))
				.run([]),
		);
	});

	it("deduplicates repeated dependency names in a setup bag", async () => {
		expect.assertions(1);
		const base = defineContext("base", () => "base");
		const db = defineContext("db", { uses: [base, base] }, async ({ ctx }) => await ctx.base);
		await unwrap(
			new Crust("cli")
				.provide(base(), db())
				.action(async ({ ctx }) => expect(await ctx.db).toBe("base"))
				.run([]),
		);
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

		await unwrap(
			new Crust("cli")
				.provide(remote(), cache(false))
				.action(async ({ ctx }) => void (await ctx.cache))
				.run([]),
		);
		expect(setups).toBe(0);
		await unwrap(
			new Crust("cli")
				.provide(remote(), cache(true))
				.action(async ({ ctx }) => void (await ctx.cache))
				.run([]),
		);
		expect(setups).toBe(1);
	});

	it("shares dependencies in a concurrent diamond without reporting a cycle", async () => {
		expect.assertions(2);
		let baseSetups = 0;
		const base = defineContext("base", async () => ({ id: ++baseSetups }));
		const left = defineContext("left", { uses: [base] }, async ({ ctx }) => (await ctx.base).id);
		const right = defineContext("right", { uses: [base] }, async ({ ctx }) => (await ctx.base).id);
		const top = defineContext("top", { uses: [left, right] }, async ({ ctx }) =>
			Promise.all([ctx.left, ctx.right]),
		);
		await unwrap(
			new Crust("cli")
				.provide(top(), right(), base(), left())
				.action(async ({ ctx }) => {
					expect(await ctx.top).toEqual([1, 1]);
				})
				.run([]),
		);
		expect(baseSetups).toBe(1);
	});

	it("accepts dependencies in the same call in any order and across ordered calls", async () => {
		expect.assertions(2);
		const base = defineContext("base", () => "base");
		const dependent = defineContext(
			"dependent",
			{ uses: [base] },
			async ({ ctx }) => await ctx.base,
		);
		await unwrap(
			new Crust("cli")
				.provide(dependent(), base())
				.action(async ({ ctx }) => expect(await ctx.dependent).toBe("base"))
				.run([]),
		);
		await unwrap(
			new Crust("cli")
				.provide(base())
				.provide(dependent())
				.action(async ({ ctx }) => expect(await ctx.dependent).toBe("base"))
				.run([]),
		);
	});

	it("lets .of() cut the dependency graph while retaining owned flags", async () => {
		expect.assertions(1);
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
		await unwrap(app.run([], { flags: { token: "x" } }));
	});

	it("exposes the typed transitive closure above an .of() cut", async () => {
		expect.assertions(1);
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
		await unwrap(
			new Crust("cli")
				.provide(db.of({ url: "fake" }), config(), report())
				.action(async ({ ctx }) => expect(await ctx.report).toBe("report:memory://"))
				.run([]),
		);
	});

	it("fails loud when a transitive dependency above an .of() cut is unprovided", async () => {
		const config = defineContext("config", () => "config");
		const db = defineContext("db", { uses: [config] }, async ({ ctx }) => await ctx.config);
		const report = defineContext("report", { uses: [db] }, async ({ ctx }) => await ctx.config);
		expect(() => new Crust("cli").provide(db.of("fake"), report() as never)).toThrow(
			'No provider for Context "config"',
		);
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
		await unwrap(new Crust("cli").provide(db.of("fake"), config()).extend(observer).run([]));
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

		await expect(unwrap(app.run(["child"]))).rejects.toMatchObject({
			details: { name: "logger", reason: "missing-context" },
		});
		// The root path is healthy: logger was provided before .extend().
		await expect(app.run([])).resolves.toMatchObject({ status: "completed", result: undefined });
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

		await unwrap(app.run(["child"]));
		await unwrap(app.run([]));
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
		await unwrap(new Crust("cli").extend(providerExtension).extend(consumerExtension).run([]));
		expect(seen).toBe("logger");
	});

	it("keeps dynamic cycle detection for untyped Context instances", async () => {
		const aFactory = defineContext("a", () => "a");
		const bFactory = defineContext("b", () => "b");
		const a = defineContext("a", { uses: [bFactory] }, async ({ ctx }) => await ctx.b);
		const b = defineContext("b", { uses: [aFactory] }, async ({ ctx }) => await ctx.a);
		const app = new Crust("cli").provide(a(), b()).action(async ({ ctx }) => void (await ctx.a));

		await expect(unwrap(app.run([]))).rejects.toMatchObject({
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
				new AbortController().signal,
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
			process.off("unhandledRejection", onUnhandled);
		}
	});

	it("keeps missing and disposed guards on lazy bag getters", async () => {
		const service = defineContext("service", () => "service");
		await using missingDisposal = new AsyncDisposableStack();
		const missing = createContextResolver(
			[],
			{ stdout: () => {}, stderr: () => {} },
			missingDisposal,
			new AbortController().signal,
		).bag<{ service: string }>([service]);
		await expect(missing.service).rejects.toMatchObject({ details: { reason: "missing-context" } });

		let disposed: ContextBag<{ service: string }>;
		{
			await using disposal = new AsyncDisposableStack();
			disposed = createContextResolver(
				[service()],
				{ stdout: () => {}, stderr: () => {} },
				disposal,
				new AbortController().signal,
			).bag<{ service: string }>([service]);
		}
		await expect(disposed.service).rejects.toMatchObject({
			details: { reason: "context-after-disposal" },
		});
	});
});

describe("lazy Context bags", () => {
	it("exposes its sources under the contextSources symbol without pulling anything", async () => {
		let built = 0;
		const db = defineContext("db", () => {
			built += 1;
			return "db";
		});
		const instance = db();
		await using disposal = new AsyncDisposableStack();
		const bag = createContextResolver(
			[instance],
			{ stdout: () => {}, stderr: () => {} },
			disposal,
			new AbortController().signal,
		).bag<{ db: string }>([instance]);

		expect(instance.factory).toBe(db);
		expect(bag[contextSources]).toEqual([instance]);
		expect(Object.isFrozen(bag[contextSources])).toBe(true);
		expect(Object.keys(bag)).toEqual(["db"]);
		expect(Object.getOwnPropertyDescriptor(bag, contextSources)?.enumerable).toBe(false);
		expect(built).toBe(0);
	});

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
		await unwrap(
			new Crust("cli")
				.provide(gate(), wrapper())
				.extend(observer)
				.action(async ({ ctx }) => {
					expect(await ctx.wrapper).toBe("degraded");
				})
				.run([], { flags: { token: "x" } }),
		);
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

		await unwrap(app.run([]));
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

		await unwrap(app.run([]));
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

		await unwrap(app.run(["run"]));
		expect(events).toEqual(["extension", "extension"]);
	});

	it("resolves dependencies across Extension providers regardless of order", async () => {
		expect.assertions(1);
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
		await unwrap(
			new Crust("cli")
				.extend(serviceProvider, baseProvider)
				.action(async ({ ctx }) => expect(await ctx.service).toBe("service:base"))
				.run([]),
		);
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

		await expect(unwrap(app.run([], { flags: { token: "secret" } }))).rejects.toMatchObject({
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

		await unwrap(app.run([], { flags: { token: "secret" } }));
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

		await unwrap(app.run([], { flags: { token: "secret" } }));
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

		await expect(app.run([])).resolves.toMatchObject({ status: "failed", error: hostile });
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

		await unwrap(app.run([], { flags: { token: "secret" } }));
		expect(setups).toBe(1);
	});

	it("memoizes ordinary setup rejections", async () => {
		expect.assertions(3);
		let setups = 0;
		const failure = new Error("failed");
		const service = defineContext("service", () => {
			setups++;
			throw failure;
		});
		await unwrap(
			new Crust("cli")
				.provide(service())
				.action(async ({ ctx }) => {
					await expect(ctx.service).rejects.toBe(failure);
					await expect(ctx.service).rejects.toBe(failure);
				})
				.run([]),
		);
		expect(setups).toBe(1);
	});

	it("allows nested flag-free pulls in preRun", async () => {
		expect.assertions(1);
		const base = defineContext("base", () => "ok");
		const service = defineContext("service", { uses: [base] }, async ({ ctx }) => await ctx.base);
		const extension = defineExtension(defineExtensionId("consumer"), {
			uses: [service],
			hooks: { preRun: async (ctx) => expect(await ctx.ctx.service).toBe("ok") },
		});
		await unwrap(new Crust("cli").provide(base(), service()).extend(extension).run([]));
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

		await expect(unwrap(app.run([]))).rejects.toMatchObject({
			details: { reason: "flags-before-validation" },
		});
	});
});

describe("Context disposal", () => {
	function disposableContext<const Name extends string>(name: Name, log: string[]) {
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

		await unwrap(app.run([]));
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

		await expect(app.run([])).resolves.toMatchObject({ status: "failed", error: failure });
		expect(events).toEqual(["use", "dispose"]);
	});

	it("settle() drains dependencies started while it waits, then closes construction", async () => {
		const log: string[] = [];
		let freshSetups = 0;
		const gate = Promise.withResolvers<void>();
		const lateGate = Promise.withResolvers<void>();
		const late = defineContext("late", async ({ defer }) => {
			await lateGate.promise;
			defer(() => {
				log.push("defer:late");
			});
			return {
				[Symbol.asyncDispose]: async () => {
					log.push("dispose:late");
				},
			};
		});
		const slow = defineContext("slow", { uses: [late] }, async ({ ctx }) => {
			await gate.promise;
			return await ctx.late;
		});
		const fresh = defineContext("fresh", () => {
			freshSetups++;
			return "fresh";
		});
		const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

		{
			await using disposal = new AsyncDisposableStack();
			const resolver = createContextResolver(
				[late(), slow(), fresh()],
				{ stdout: () => {}, stderr: () => {} },
				disposal,
				new AbortController().signal,
			);
			const bag = resolver.bag<{ slow: unknown; late: unknown; fresh: string }>([slow, fresh]);
			const pulled = bag.slow;
			let settled = false;
			const draining = resolver.settle().then(() => {
				settled = true;
			});

			// `late` is pulled only after settle() started waiting on `slow`.
			gate.resolve();
			await flush();
			expect(settled).toBe(false);
			lateGate.resolve();
			await draining;
			expect(await pulled).toBe(await bag.late);

			await expect(bag.fresh).rejects.toMatchObject({
				code: "DEFINITION",
				details: { subject: "context", name: "fresh", reason: "context-during-disposal" },
			});
			expect(freshSetups).toBe(0);
		}
		expect(log).toEqual(["dispose:late", "defer:late"]);
	});

	it("rejects a cleanup callback that pulls a never-constructed Context", async () => {
		let created = 0;
		let closed = 0;
		const log: string[] = [];
		const dependent = defineContext("dependent", () => {
			created++;
			return {
				[Symbol.dispose]() {
					closed++;
				},
			};
		});
		const owner = defineContext("owner", { uses: [dependent] }, ({ ctx, defer }) => {
			defer(async () => {
				await ctx.dependent;
			});
			return "owner";
		});
		const sibling = disposableContext("sibling", log);
		const app = new Crust("cli")
			.provide(dependent(), owner(), sibling())
			.action(async ({ ctx }) => {
				await ctx.sibling;
				await ctx.owner;
			});

		await expect(app.run([])).resolves.toMatchObject({
			status: "failed",
			error: {
				code: "DEFINITION",
				details: { subject: "context", name: "dependent", reason: "context-during-disposal" },
			},
		});
		expect(created).toBe(0);
		expect(closed).toBe(0);
		expect(log).toEqual(["dispose:sibling"]);
	});

	it("lets a cleanup callback read an already-constructed dependency before it is disposed", async () => {
		const log: string[] = [];
		const dep = disposableContext("dep", log);
		const owner = defineContext("owner", { uses: [dep] }, async ({ ctx, defer }) => {
			await ctx.dep;
			defer(async () => {
				log.push(`read:${(await ctx.dep).name}`);
			});
			return "owner";
		});
		await unwrap(
			new Crust("cli")
				.provide(dep(), owner())
				.action(async ({ ctx }) => {
					await ctx.owner;
				})
				.run([]),
		);
		expect(log).toEqual(["read:dep", "dispose:dep"]);
	});

	it("never leaks a Context pulled by a fire-and-forget chain left behind by postRun", async () => {
		let created = 0;
		let closed = 0;
		let rejection: CaughtError;
		const first = defineContext("first", () => "first");
		const second = defineContext("second", () => {
			created++;
			return {
				[Symbol.dispose]() {
					closed++;
				},
			};
		});
		const observer = defineExtension(defineExtensionId("observer"), {
			uses: [first, second],
			hooks: {
				postRun(ctx) {
					void ctx.ctx.first
						.then(() => ctx.ctx.second)
						.catch((error: CaughtError) => {
							rejection = error;
						});
				},
			},
		});
		const app = new Crust("cli")
			.provide(first(), second())
			.extend(observer)
			.action(() => {});

		await unwrap(app.run([]));
		await new Promise((resolve) => setTimeout(resolve, 0));
		if (rejection !== undefined) {
			expect(rejection).toMatchObject({ details: { reason: "context-during-disposal" } });
		}
		expect(created).toBe(closed);
	});

	it("disposes a value once when an alias setup returns it", async () => {
		let disposals = 0;
		const db = defineContext("db", () => ({
			[Symbol.dispose]() {
				disposals++;
			},
		}));
		const alias = defineContext("alias", { uses: [db] }, async ({ ctx }) => await ctx.db);
		await unwrap(
			new Crust("cli")
				.provide(db(), alias())
				.action(async ({ ctx }) => {
					expect(await ctx.alias).toBe(await ctx.db);
				})
				.run([]),
		);
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
		await unwrap(
			new Crust("cli")
				.provide(bare(), decorated())
				.action(async ({ ctx }) => {
					await ctx.decorated;
				})
				.run([]),
		);
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

		await expect(unwrap(app.run([]))).rejects.toThrow("boom");
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

		await unwrap(app.run([]));

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
		await unwrap(
			new Crust("cli")
				.provide(derived(), base())
				.action(async ({ ctx }) => {
					await ctx.derived;
					log.push("run");
				})
				.run([]),
		);

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

		await expect(app.run([])).resolves.toMatchObject({ status: "failed", error: boom });
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

		await expect(unwrap(app.run([]))).rejects.toThrow("setup failed");
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

		await expect(unwrap(app.run([]))).rejects.toThrow("Unauthenticated");
		expect(events).toEqual(["disposed"]);
	});
});

describe("Context setup defer()", () => {
	const deferAfterSetupError = {
		code: "DEFINITION",
		message: 'Context "res" cannot register cleanup after its setup has finished.',
		details: { subject: "context", name: "res", reason: "context-defer-after-setup" },
	};

	it("runs deferred cleanup after the action succeeds", async () => {
		const log: string[] = [];
		const res = defineContext("res", async ({ defer }) => {
			await Promise.resolve();
			defer(() => {
				log.push("cleanup");
			});
			return "value";
		});
		await unwrap(
			new Crust("cli")
				.provide(res())
				.action(async ({ ctx }) => {
					await ctx.res;
					log.push("run");
				})
				.run([]),
		);
		expect(log).toEqual(["run", "cleanup"]);
	});

	it("runs deferred cleanup after a failed action and rethrows the original error", async () => {
		const log: string[] = [];
		const boom = new Error("action failed");
		const res = defineContext("res", ({ defer }) => {
			defer(() => {
				log.push("cleanup");
			});
			return "value";
		});
		const app = new Crust("cli").provide(res()).action(async ({ ctx }) => {
			await ctx.res;
			log.push("run");
			throw boom;
		});
		await expect(app.run([])).resolves.toMatchObject({ status: "failed", error: boom });
		expect(log).toEqual(["run", "cleanup"]);
	});

	it("runs multiple defers once each in reverse registration order", async () => {
		const log: string[] = [];
		const cleanup = () => {
			log.push("same");
		};
		const res = defineContext("res", ({ defer }) => {
			defer(() => {
				log.push("first");
			});
			defer(cleanup);
			defer(cleanup);
			defer(() => {
				log.push("last");
			});
			return "value";
		});
		await unwrap(
			new Crust("cli")
				.provide(res())
				.action(async ({ ctx }) => {
					await ctx.res;
				})
				.run([]),
		);
		expect(log).toEqual(["last", "same", "same", "first"]);
	});

	it("disposes the returned value before that setup's own defers", async () => {
		const log: string[] = [];
		const res = defineContext("res", ({ defer }) => {
			defer(() => {
				log.push("defer");
			});
			return {
				[Symbol.dispose]() {
					log.push("dispose");
				},
			};
		});
		await unwrap(
			new Crust("cli")
				.provide(res())
				.action(async ({ ctx }) => {
					await ctx.res;
				})
				.run([]),
		);
		expect(log).toEqual(["dispose", "defer"]);
	});

	it("runs defers registered before the setup throws", async () => {
		const log: string[] = [];
		const res = defineContext("res", ({ defer }) => {
			defer(() => {
				log.push("cleanup");
			});
			throw new Error("setup failed");
		});
		const app = new Crust("cli").provide(res()).action(async ({ ctx }) => {
			await ctx.res;
		});
		await expect(unwrap(app.run([]))).rejects.toThrow("setup failed");
		expect(log).toEqual(["cleanup"]);
	});

	it("rejects defer after the setup resolved", async () => {
		let late: ContextSetup<undefined>["defer"] | undefined;
		const res = defineContext("res", ({ defer }) => {
			late = defer;
			return "value";
		});
		await unwrap(
			new Crust("cli")
				.provide(res())
				.action(async ({ ctx }) => {
					await ctx.res;
					expect(() => late!(() => {})).toThrow(expect.objectContaining(deferAfterSetupError));
				})
				.run([]),
		);
		expect(late).toBeDefined();
	});

	it("rejects defer after the setup rejected", async () => {
		let late: ContextSetup<undefined>["defer"] | undefined;
		const res = defineContext("res", ({ defer }) => {
			late = defer;
			throw new Error("setup failed");
		});
		const app = new Crust("cli").provide(res()).action(async ({ ctx }) => {
			await ctx.res;
		});
		await expect(unwrap(app.run([]))).rejects.toThrow("setup failed");
		expect(() => late!(() => {})).toThrow(expect.objectContaining(deferAfterSetupError));
	});

	it("awaits async defers, runs the rest when one rejects, and chains the errors", async () => {
		const log: string[] = [];
		const first = new Error("first failed");
		const second = new Error("second failed");
		const res = defineContext("res", ({ defer }) => {
			defer(async () => {
				await Promise.resolve();
				log.push("first");
				throw first;
			});
			defer(async () => {
				// Slower than `first`: if callbacks ran concurrently, `first` would log first.
				await new Promise((resolve) => setTimeout(resolve, 5));
				log.push("second");
				throw second;
			});
			return "value";
		});
		const app = new Crust("cli").provide(res()).action(async ({ ctx }) => {
			await ctx.res;
		});
		// Bun has the native stack: the later-thrown error suppresses the earlier one.
		await expect(app.run([])).resolves.toMatchObject({
			status: "failed",
			error: { error: first, suppressed: second },
		});
		expect(log).toEqual(["second", "first"]);
	});

	it("keeps the lifecycle defer when injected io carries an extra defer property", async () => {
		const log: string[] = [];
		const res = defineContext("res", ({ defer }) => {
			defer(() => {
				log.push("cleanup");
			});
			return "value";
		});
		// Structural typing lets a pre-declared io object smuggle extra keys past
		// Partial<InvocationIO>; execute() spreads it through as-is (run() rebuilds it).
		const io = { stdout: () => {}, stderr: () => {}, defer: () => log.push("hijacked") };
		const app = new Crust("cli").provide(res()).action(async ({ ctx }) => {
			await ctx.res;
		});
		expect(await app.execute({ argv: [], io })).toBe(0);
		expect(log).toEqual(["cleanup"]);
	});

	it("skips setup and its defers for an .of() double", async () => {
		const log: string[] = [];
		const res = defineContext("res", ({ defer }) => {
			log.push("setup");
			defer(() => {
				log.push("cleanup");
			});
			return "real";
		});
		await unwrap(
			new Crust("cli")
				.provide(res.of("fake"))
				.action(async ({ ctx }) => {
					expect(await ctx.res).toBe("fake");
				})
				.run([]),
		);
		expect(log).toEqual([]);
	});

	it("tears down in registration order when each setup acquires then defers", async () => {
		const log: string[] = [];
		const base = defineContext("base", ({ defer }) => {
			defer(() => {
				log.push("cleanup:base");
			});
			return "base";
		});
		const derived = defineContext("derived", { uses: [base] }, async ({ ctx, defer }) => {
			await ctx.base;
			defer(() => {
				log.push("cleanup:derived");
			});
			return "derived";
		});
		// derived provided first, but base registers first, so base cleans up last
		await unwrap(
			new Crust("cli")
				.provide(derived(), base())
				.action(async ({ ctx }) => {
					await ctx.derived;
					log.push("run");
				})
				.run([]),
		);
		expect(log).toEqual(["run", "cleanup:derived", "cleanup:base"]);
	});

	it("tears down in registration order, not topology, when a setup defers before awaiting a dependency", async () => {
		const log: string[] = [];
		const base = defineContext("base", ({ defer }) => {
			defer(() => {
				log.push("cleanup:base");
			});
			return "base";
		});
		const derived = defineContext("derived", { uses: [base] }, async ({ ctx, defer }) => {
			defer(() => {
				log.push("cleanup:derived");
			});
			await ctx.base;
			return "derived";
		});
		await unwrap(
			new Crust("cli")
				.provide(base(), derived())
				.action(async ({ ctx }) => {
					await ctx.derived;
				})
				.run([]),
		);
		// derived registered first, so its dependency is torn down before it
		expect(log).toEqual(["cleanup:base", "cleanup:derived"]);
	});

	it("keeps defers from a flags-before-validation attempt and adds the retry's defers", async () => {
		const log: string[] = [];
		let attempts = 0;
		const token = defineFlag("token", { type: "string" });
		const auth = defineContext("auth", { flags: [token] }, ({ flags }) => flags.token);
		const service = defineContext("service", { uses: [auth] }, async ({ ctx, defer }) => {
			const attempt = ++attempts;
			defer(() => {
				log.push(`cleanup:${attempt}`);
			});
			return await ctx.auth;
		});
		const extension = defineExtension(defineExtensionId("consumer"), {
			uses: [service],
			hooks: { preRun: async (ctx) => void (await ctx.ctx.service.catch(() => undefined)) },
		});
		await unwrap(
			new Crust("cli")
				.provide(auth(), service())
				.extend(extension)
				.action(async ({ ctx }) => expect(await ctx.service).toBe("secret"))
				.run([], { flags: { token: "secret" } }),
		);
		expect(attempts).toBe(2);
		expect(log).toEqual(["cleanup:2", "cleanup:1"]);
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

	it("rejects use() and defer() after disposal like the native stack", async () => {
		const disposal = new FallbackAsyncDisposableStack();
		await disposal[Symbol.asyncDispose]();
		expect(() => disposal.defer(() => {})).toThrow(ReferenceError);
		expect(() => disposal.use({ [Symbol.dispose]() {} })).toThrow(ReferenceError);
	});

	it("runs callbacks once when disposed twice like the native stack", async () => {
		let calls = 0;
		const disposal = new FallbackAsyncDisposableStack();
		disposal.defer(() => {
			calls++;
		});
		await disposal[Symbol.asyncDispose]();
		await disposal[Symbol.asyncDispose]();
		expect(calls).toBe(1);
	});

	it("rejects a non-callable defer at registration like the native stack", () => {
		const disposal = new FallbackAsyncDisposableStack();
		expect(() => disposal.defer(null as never)).toThrow(TypeError);
		expect(() => new AsyncDisposableStack().defer(null as never)).toThrow(TypeError);
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
					type _Suffix = Expect<Equal<typeof args.suffix, string | undefined>>;
					type _Loud = Expect<Equal<typeof flags.loud, boolean | undefined>>;
					const identity = await ctx.auth;
					type _Auth = Expect<Equal<typeof identity, { user: string }>>;
					// @ts-expect-error -- undeclared Contexts are absent from the inline bag
					void ctx.missing;
					return `${identity.user}${args.suffix ?? ""}`;
				}),
		);

		const outcome = await app.run(["whoami"], { args: { suffix: "!" } });
		expect(outcome).toMatchObject({ status: "completed", result: "chenxin!" });
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

		expect(await app.run(["early"])).toMatchObject({ status: "completed", result: false });
		// The root path itself sees the Context it provided.
		expect(await app.run([])).toMatchObject({ status: "completed", result: "logger" });
	});

	it("demands the union of branch deps from a conditionally-returned recipe", async () => {
		const a = defineContext("a", () => "a-value");
		const b = defineContext("b", () => "b-value");
		const choose: boolean = false;
		const either = defineCommand("either", (cmd) =>
			choose
				? cmd.use(a).action(async ({ ctx }) => await ctx.a)
				: cmd.use(b).action(async ({ ctx }) => await ctx.b),
		);

		// Supplying both branches' demands composes cleanly.
		new Crust("cli").provide(a(), b()).add(either);

		const invalidCompositions = () => {
			// @ts-expect-error -- neither branch's demand is provided
			new Crust("cli").add(either);
			new Crust("cli").command("either", (cmd) =>
				// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
				choose
					? cmd.use(a).action(async ({ ctx }) => void (await ctx.a))
					: cmd.use(b).action(async ({ ctx }) => void (await ctx.b)),
			);
		};
		void invalidCompositions;

		// Automatic consumption rejects the selected missing demand without running its action.
		expect(() =>
			new Crust("cli")
				.provide(a())
				// @ts-expect-error -- deliberately supply only the unchosen branch's demand
				.add(either),
		).toThrow('No provider for Context "b"');
	});

	it("retains only selected declared demands and does not inspect trusted factory shapes", () => {
		let reads = 0;
		const logger = new Proxy(
			defineContext("logger", () => "logger"),
			{
				get(target, key, receiver) {
					if (key === "contextName") reads++;
					// oxlint-disable-next-line eslint/no-restricted-properties -- transparent Proxy forwarding preserves private symbols while observing validation reads.
					return Reflect.get(target, key, receiver);
				},
			},
		);
		const unused = defineContext("unused", () => "unused");
		const command = defineCommand("sub", (cmd) => {
			void cmd.use(unused);
			return cmd.use(logger).action(() => {});
		});
		new Crust("trusted").provide(logger()).add(command);
		expect(reads).toBe(0);
	});

	it("rejects an inline command name that is already registered", () => {
		expect(() =>
			new Crust("cli")
				.command("dup", (cmd) => cmd.action(() => {}))
				// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
				.command("dup", (cmd) => cmd.action(() => {})),
		).toThrow(/already registered/);
	});
});

describe("checked Context definitions", () => {
	it("consumes mutable flag configs locally without starting setup", () => {
		let setups = 0;
		const flags = [{ name: "token", type: "string" as const, aliases: ["t"] }];
		const config = { flags };
		flags.push({ name: "other", type: "string", aliases: ["t"] });
		expect(() => defineContext("auth", config, () => ++setups)).toThrow("collides");
		flags.pop();
		const auth = defineContext("auth", config, () => ++setups);
		flags[0]!.aliases.push("mutated");
		flags.length = 0;
		expect(auth().ownedFlags.token?.aliases).toEqual(["t"]);
		expect(Object.isFrozen(auth().ownedFlags)).toBe(true);
		expect(setups).toBe(0);
		expect(defineContext("empty", () => 1)().name).toBe("empty");
	});

	it("checks provider availability at consumption without eager setup", async () => {
		let setups = 0;
		const source = defineContext("source", () => {
			setups++;
			return 1;
		});
		const dependent = defineContext("dependent", { uses: [source] }, () => {
			setups++;
			return 2;
		});
		const instances = [dependent()];
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		expect(() => new Crust("missing").provide(...instances)).toThrow("source");
		const app = new Crust("present").provide(source()).provide(...instances);
		instances.length = 0;
		expect(setups).toBe(0);
		await unwrap(app.action(async ({ ctx }) => expect(await ctx.dependent).toBe(2)).run([]));
		expect(setups).toBe(1);
	});

	it("preserves value-only Context replacement but rejects overlapping owned flags", async () => {
		const source = defineContext("source", () => 1);
		const name: string = "source";
		const providers = [defineContext(name, () => 2)()];
		const app = new Crust("replace").provide(source()).provide(...providers);
		await unwrap(app.action(async ({ ctx }) => expect(await ctx.source).toBe(2)).run([]));
		const auth = defineContext(
			"auth",
			{ flags: [{ name: "token", type: "string", aliases: ["t"] }] },
			() => 1,
		);
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		expect(() => new Crust("same-owner").provide(auth()).provide(auth.of(2))).toThrow("collides");
		const other = defineContext(
			"auth",
			{ flags: [{ name: "other", type: "string", short: "t" }] },
			() => 2,
		);
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		expect(() => new Crust("same-owner-alias").provide(auth()).provide(other())).toThrow(
			"collides",
		);
	});

	it("consumes privately owned Context data through structural copies", async () => {
		const dep = defineContext("dep", () => 1);
		const real = defineContext(
			"real",
			{ uses: [dep], flags: [{ name: "token", type: "string" }] },
			() => 2,
		);
		const altered = {
			...real(),
			uses: [],
			setup: () => 99,
			ownedFlags: { fake: { type: "boolean" as const } },
		};
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		expect(() => new Crust("missing").provide(altered)).toThrow("dep");
		const app = new Crust("present")
			.provide(dep())
			.provide(altered)
			.action(async ({ ctx, flags }) => {
				expect(await ctx.real).toBe(2);
				expect(flags.token).toBe("original");
			});
		await unwrap(app.run([], { flags: { token: "original" } }));
		expect(Object.keys((await app.snapshot()).flags)).toEqual(["token"]);
	});
});
