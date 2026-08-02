import { describe, expect, it } from "bun:test";

import { Crust, defineCommand } from "../command/crust.ts";
import { CrustError } from "../errors.ts";
import { defineContext } from "./context.ts";
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
		await expect(Promise.resolve(instance.setup({ flags: {}, ctx: {} }))).resolves.toEqual({
			user: "chenxin",
		});
	});

	it("passes the factory argument as options", async () => {
		const db = defineContext("db", ({ options }: { options: { url: string } }) => ({
			url: options.url,
		}));

		const instance = db({ url: "memory://test" });
		await expect(Promise.resolve(instance.setup({ flags: {}, ctx: {} }))).resolves.toEqual({
			url: "memory://test",
		});
	});

	it(".of() produces an instance returning the precomputed value with requirements absent", async () => {
		const verbose = defineFlag("verbose", { type: "boolean", inherit: true });
		const db = defineContext("db", { flags: [verbose] }, ({ flags }) => ({
			url: `real:${String(flags.verbose)}`,
		}));

		const fake = db.of({ url: "fake://db" });
		expect(fake.name).toBe("db");
		expect(fake.requiredFlags).toEqual({});
		expect(fake.requiredCtx).toEqual([]);
		type _Name = Assert<IsEqual<(typeof fake)["name"], "db">>;
		// @ts-expect-error -- .of() takes the Context's value type
		db.of({ wrong: true });

		const seen: string[] = [];
		// No verbose flag declared — .of() bypasses the flag requirement
		const app = new Crust("cli").provide(fake).handle(({ ctx }) => {
			seen.push(ctx.db.url);
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

		const app = new Crust("cli").provide(db({ url: "memory://x" })).handle(({ ctx }) => {
			seen.push(ctx.db.url);
		});

		await app.run([]);
		expect(seen).toEqual(["memory://x"]);
	});

	it("accepts multiple instances in one variadic call", async () => {
		const seen: string[] = [];
		const a = defineContext("a", () => "value-a");
		const b = defineContext("b", () => "value-b");

		const app = new Crust("cli").provide(a(), b()).handle(({ ctx }) => {
			seen.push(`${ctx.a}:${ctx.b}`);
			type _A = Assert<IsEqual<typeof ctx.a, string>>;
			type _B = Assert<IsEqual<typeof ctx.b, string>>;
		});

		await app.run([]);
		expect(seen).toEqual(["value-a:value-b"]);
	});

	it("throws DEFINITION on a duplicate Context name on the same command", () => {
		const a = defineContext("db", () => 1);
		const b = defineContext("db", () => 2);

		expect(() => new Crust("cli").provide(a()).provide(b())).toThrow(CrustError);
		expect(() => new Crust("cli").provide(a(), b())).toThrow(/Context "db" is already provided/);
		try {
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
				.mount(defineCommand("sub", (cmd) => cmd.provide(childDb()).handle(() => {}))),
		).toThrow(CrustError);
	});

	it("throws DEFINITION when a mounted subtree re-provides a path name", () => {
		const parentDb = defineContext("db", () => "parent");
		const nestedDb = defineContext("db", () => "nested");
		const sub = defineCommand("sub", { ctx: [parentDb] }, (command) =>
			command.mount(defineCommand("g", (child) => child.provide(nestedDb()).handle(() => {}))),
		);

		expect(() => new Crust("cli").provide(parentDb()).mount(sub)).toThrow(CrustError);
	});

	it("seeds mounted descendants with the parent Context path", async () => {
		const seen: string[] = [];
		const db = defineContext("db", () => "root-db");
		const sub = defineCommand("sub", { ctx: [db] }, (command) =>
			command.mount(
				defineCommand("g", { ctx: [db] }, (child) =>
					child.handle(({ ctx }) => {
						seen.push(ctx.db);
					}),
				),
			),
		);
		const root = new Crust("cli").provide(db()).mount(sub);

		await root.run(["sub", "g"]);

		expect(seen).toEqual(["root-db"]);
	});

	it("does not construct Contexts for commands off the resolved path", async () => {
		let built = 0;
		const lazy = defineContext("lazy", () => {
			built++;
			return {};
		});

		const app = new Crust("cli")
			.provide(lazy())
			.mount(defineCommand("a", (cmd) => cmd.handle(() => {})))
			.mount(defineCommand("b", (cmd) => cmd.handle(() => {})));

		// Resolving "a" builds the inherited context once; "b" not executed
		await app.run(["a"]);
		expect(built).toBe(1);
	});

	it("does not backfill mounted children with later parent provides", async () => {
		let lateProvided = false;
		const late = defineContext("late", () => {
			lateProvided = true;
			return "late";
		});
		const app = new Crust("cli")
			.mount(defineCommand("status", (command) => command.handle(() => {})))
			.provide(late());

		await app.run(["status"]);

		expect(lateProvided).toBe(false);
	});
});

describe("Context flag requirements", () => {
	const verbose = defineFlag("verbose", { type: "boolean", inherit: true });

	it("passes the validated parsed flags of the resolved invocation to setup", async () => {
		const seen: unknown[] = [];
		const logger = defineContext("logger", { flags: [verbose] }, ({ flags }) => {
			type _Verbose = Assert<IsEqual<typeof flags.verbose, boolean | undefined>>;
			seen.push(flags.verbose);
			return { level: flags.verbose ? "debug" : "info" };
		});

		const app = new Crust("cli")
			.flags(verbose)
			.provide(logger())
			.handle(({ ctx }) => {
				seen.push(ctx.logger.level);
			});

		await app.run(["--verbose"]);
		expect(seen).toEqual([true, "debug"]);

		await app.run([]);
		expect(seen).toEqual([true, "debug", undefined, "info"]);
	});

	it("setups see schema-validated flag values, not raw tokens", async () => {
		const seen: unknown[] = [];
		const port = defineFlag("port", {
			type: "string",
			inherit: true,
			parse: (raw: string) => Number(raw),
		});
		const server = defineContext("server", { flags: [port] }, ({ flags }) => {
			seen.push(flags.port);
			return {};
		});

		await new Crust("cli")
			.flags(port)
			.provide(server())
			.handle(() => {})
			.run(["--port", "8080"]);

		expect(seen).toEqual([8080]);
	});

	it("throws DEFINITION at .provide() when a required flag is missing", () => {
		const logger = defineContext("logger", { flags: [verbose] }, () => ({}));

		expect(() => new Crust("cli").provide(logger() as never)).toThrow(/requires flag "--verbose"/);
	});

	it("throws DEFINITION at .provide() when the flag is declared without inherit: true", () => {
		const logger = defineContext("logger", { flags: [verbose] }, () => ({}));

		expect(() =>
			new Crust("cli").flags({ name: "verbose", type: "boolean" }).provide(logger() as never),
		).toThrow(/inherit: true/);
	});

	it("checks flag requirements at compile time at the .provide() call site", () => {
		const logger = defineContext("logger", { flags: [verbose] }, () => ({}));

		new Crust("cli").flags(verbose).provide(logger());
		// @ts-expect-error -- missing inherited flags: verbose
		expect(() => new Crust("cli").provide(logger())).toThrow(CrustError);
		expect(() =>
			new Crust("cli")
				.flags({ name: "verbose", type: "string", inherit: true })
				// @ts-expect-error -- incompatible inherited flags: verbose
				.provide(logger()),
		).not.toThrow();
	});
});

describe("Context ctx requirements (topological construction)", () => {
	it("constructs dependencies before dependents in registration order among independents", async () => {
		const order: string[] = [];
		const config = defineContext("config", () => {
			order.push("config");
			return { endpoint: "https://api.example.com" };
		});
		const client = defineContext("client", { ctx: [config] }, ({ ctx }) => {
			order.push(`client:${ctx.config.endpoint}`);
			return { endpoint: ctx.config.endpoint };
		});
		const workspace = defineContext("workspace", { ctx: [client] }, ({ ctx }) => {
			order.push(`workspace:${ctx.client.endpoint}`);
			return "crust";
		});

		const app = new Crust("cli").provide(config(), client(), workspace()).handle(({ ctx }) => {
			type _Workspace = Assert<IsEqual<typeof ctx.workspace, string>>;
			order.push(`handler:${ctx.workspace}`);
		});

		await app.run([]);

		expect(order).toEqual([
			"config",
			"client:https://api.example.com",
			"workspace:https://api.example.com",
			"handler:crust",
		]);
	});

	it("provide order is free — dependents may be provided before dependencies", async () => {
		const order: string[] = [];
		const config = defineContext("config", () => {
			order.push("config");
			return { url: "u" };
		});
		const client = defineContext("client", { ctx: [config] }, ({ ctx }) => {
			order.push("client");
			return { url: ctx.config.url };
		});

		await new Crust("cli")
			.provide(client())
			.provide(config())
			.handle(() => {
				order.push("handler");
			})
			.run([]);

		expect(order).toEqual(["config", "client", "handler"]);
	});

	it("types ctx in setup from the declared dependency factories", () => {
		const session = defineContext("session", () => ({ userId: "yan" }));
		defineContext("user", { ctx: [session] }, ({ ctx }) => {
			type _Session = Assert<IsEqual<typeof ctx.session, { userId: string }>>;
			// @ts-expect-error -- only declared dependencies are visible
			void ctx.other;
			return { id: ctx.session.userId };
		});
	});

	it("throws DEFINITION at dispatch when a dependency is missing from the path", async () => {
		const config = defineContext("config", () => ({}));
		const client = defineContext("client", { ctx: [config] }, () => ({}));

		const app = new Crust("cli").provide(client()).handle(() => {});

		await expect(app.run([])).rejects.toMatchObject({
			code: "DEFINITION",
			message: expect.stringMatching(/Context "client" requires Context "config"/),
		});
	});

	it("throws DEFINITION at dispatch on a dependency cycle", async () => {
		// Cycles cannot be authored with real factory references (a factory
		// must exist to be depended on), so simulate two instances whose
		// declared requirements point at each other.
		const a = defineContext("a", () => "a")();
		const b = defineContext("b", () => "b")();
		(a as { requiredCtx: readonly string[] }).requiredCtx = ["b"];
		(b as { requiredCtx: readonly string[] }).requiredCtx = ["a"];

		const app = new Crust("cli").provide(a, b).handle(() => {});

		await expect(app.run([])).rejects.toMatchObject({
			code: "DEFINITION",
			message: expect.stringMatching(/dependency cycle/),
		});
	});

	it("satisfies a mounted definition's Context requirement before its dependents construct", async () => {
		const session = defineContext("session", () => ({ userId: "yan" }));
		const user = defineContext("user", { ctx: [session] }, ({ ctx }) => ({
			id: ctx.session.userId,
		}));
		const account = defineCommand("account", { ctx: [session] }, (command) =>
			command.provide(user()).handle(({ ctx }) => {
				type _User = Assert<IsEqual<typeof ctx.user, { id: string }>>;
				expect(ctx.user).toEqual({ id: "yan" });
			}),
		);

		await new Crust("cli").provide(session()).mount(account).run(["account"]);
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

	it("disposes values in reverse construction order after success", async () => {
		const log: string[] = [];
		const first = disposableContext("first", log);
		const second = disposableContext("second", log);

		const app = new Crust("cli")
			.provide(first())
			.provide(second())
			.handle(() => {
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
		const derived = defineContext("derived", { ctx: [base] }, () => ({
			[Symbol.dispose]() {
				log.push("dispose:derived");
			},
		}));

		// derived provided first, but base constructs first — so base disposes last
		await new Crust("cli")
			.provide(derived(), base())
			.handle(() => {
				log.push("run");
			})
			.run([]);

		expect(log).toEqual(["run", "dispose:derived", "dispose:base"]);
	});

	it("supports synchronous Symbol.dispose", async () => {
		const log: string[] = [];
		const sync = defineContext("sync", () => ({
			[Symbol.dispose]() {
				log.push("dispose:sync");
			},
		}));

		await new Crust("cli")
			.provide(sync())
			.handle(() => {})
			.run([]);

		expect(log).toEqual(["dispose:sync"]);
	});

	it("disposes after a handler failure and rethrows the original error", async () => {
		const log: string[] = [];
		const res = disposableContext("res", log);
		const boom = new Error("handler failed");

		const app = new Crust("cli").provide(res()).handle(() => {
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
			.handle(() => {
				log.push("run");
			});

		await expect(app.run([])).rejects.toThrow("setup failed");
		expect(log).toEqual(["dispose:ok"]);
	});

	it("disposes constructed dependencies when a dependent setup fails before the handler", async () => {
		const events: string[] = [];
		const resource = defineContext("resource", () => ({
			[Symbol.dispose]() {
				events.push("disposed");
			},
		}));
		const guard = defineContext("guard", { ctx: [resource] }, () => {
			throw new Error("Unauthenticated");
		});
		const app = new Crust("cli").provide(resource(), guard()).handle(() => {
			events.push("handled");
		});

		await expect(app.run([])).rejects.toThrow("Unauthenticated");
		expect(events).toEqual(["disposed"]);
	});

	it("leaves non-disposable Context values alone", async () => {
		const plain = defineContext("plain", () => ({ value: 42 }));
		const app = new Crust("cli").provide(plain()).handle(({ ctx }) => {
			expect(ctx.plain.value).toBe(42);
		});

		await expect(app.run([])).resolves.toBeUndefined();
	});
});
