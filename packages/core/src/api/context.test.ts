import { describe, expect, it } from "bun:test";

import { Crust, defineCommand } from "../command/crust.ts";
import { CrustError } from "../errors.ts";
import type { NamedFlagDef } from "../types.ts";
import { defineContext } from "./context.ts";
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
			Promise.resolve(instance.setup({ flags: {}, ctx: {}, stdout: () => {}, stderr: () => {} })),
		).resolves.toEqual({ user: "chenxin" });
	});

	it("passes the factory argument as options", async () => {
		const db = defineContext("db", ({ options }: { options: { url: string } }) => ({
			url: options.url,
		}));

		const instance = db({ url: "memory://test" });
		await expect(
			Promise.resolve(instance.setup({ flags: {}, ctx: {}, stdout: () => {}, stderr: () => {} })),
		).resolves.toEqual({ url: "memory://test" });
	});

	it(".of() produces an instance returning the precomputed value with requirements absent", async () => {
		const verbose = defineFlag("verbose", { type: "boolean" });
		const db = defineContext("db", { flags: [verbose] }, ({ flags }) => ({
			url: `real:${String(flags.verbose)}`,
		}));

		const fake = db.of({ url: "fake://db" });
		expect(fake.name).toBe("db");
		expect(fake.requiredCtx).toEqual([]);
		type _Name = Assert<IsEqual<(typeof fake)["name"], "db">>;
		// @ts-expect-error -- .of() takes the Context's value type
		db.of({ wrong: true });

		const seen: string[] = [];
		const app = new Crust("cli").provide(fake).action(({ ctx }) => {
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

		const app = new Crust("cli").provide(db({ url: "memory://x" })).action(({ ctx }) => {
			seen.push(ctx.db.url);
		});

		await app.run([]);
		expect(seen).toEqual(["memory://x"]);
	});

	it("accepts multiple instances in one variadic call", async () => {
		const seen: string[] = [];
		const a = defineContext("a", () => "value-a");
		const b = defineContext("b", () => "value-b");

		const app = new Crust("cli").provide(a(), b()).action(({ ctx }) => {
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
				.add(defineCommand("sub", (cmd) => cmd.provide(childDb()).action(() => {}))),
		).toThrow(CrustError);
	});

	it("throws DEFINITION when an added subtree re-provides a path name", () => {
		const parentDb = defineContext("db", () => "parent");
		const nestedDb = defineContext("db", () => "nested");
		const sub = defineCommand("sub", { requires: [parentDb] }, (command) =>
			command.add(defineCommand("g", (child) => child.provide(nestedDb()).action(() => {}))),
		);

		expect(() => new Crust("cli").provide(parentDb()).add(sub)).toThrow(CrustError);
	});

	it("seeds added descendants with the parent Context path", async () => {
		const seen: string[] = [];
		const db = defineContext("db", () => "root-db");
		const sub = defineCommand("sub", { requires: [db] }, (command) =>
			command.add(
				defineCommand("g", { requires: [db] }, (child) =>
					child.action(({ ctx }) => {
						seen.push(ctx.db);
					}),
				),
			),
		);
		const root = new Crust("cli").provide(db()).add(sub);

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
			.add(defineCommand("a", (cmd) => cmd.action(() => {})))
			.add(defineCommand("b", (cmd) => cmd.action(() => {})));

		// Resolving "a" builds the inherited context once; "b" not executed
		await app.run(["a"]);
		expect(built).toBe(1);
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

		const app = new Crust("cli").provide(instance).action(({ flags, ctx }) => {
			type _ActionApiKey = Assert<IsEqual<(typeof flags)["api-key"], string | undefined>>;
			seen.push(ctx.auth.apiKey);
		});
		await app.run(["--api-key", "secret"]);

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
			.action(() => {})
			.run(["--port", "8080"]);

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
			.action(() => {})
			.run(["--api-key", "secret", "--region", "us"]);

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
		const app = new Crust("cli").provide(logging()).action(({ ctx, stdout, stderr }) => {
			expect(setupStdout).toBe(stdout);
			expect(setupStderr).toBe(stderr);
			ctx.logging.debug("debug");
		});

		await app.run(["--verbose"], { stdout, stderr });
		expect(messages).toEqual(["debug"]);
	});

	it("exposes a provided capability to later added commands", async () => {
		const seen: string[] = [];
		const auth = defineContext("auth", { flags: [apiKey] }, ({ flags }) => ({
			apiKey: flags["api-key"],
		}));
		const deploy = defineCommand("deploy", { requires: [auth] }, (command) =>
			command.action(({ ctx }) => {
				seen.push(String(ctx.auth.apiKey));
			}),
		);

		await new Crust("cli").provide(auth()).add(deploy).run(["--api-key", "secret", "deploy"]);
		expect(seen).toEqual(["secret"]);
	});

	it("merges owned flag types from multiple Contexts in one provide call", () => {
		const auth = defineContext("auth", { flags: [apiKey] }, () => ({}));
		const format = defineFlag("format", { type: "string", choices: ["json", "text"] });
		const output = defineContext("output", { flags: [format] }, () => ({}));
		const app = new Crust("cli").provide(auth(), output());

		type _OwnedKeys = Assert<IsEqual<keyof (typeof app)["_types"]["owned"], "api-key" | "format">>;
		type _EffectiveApiKey = Assert<
			IsEqual<(typeof app)["_types"]["effective"]["api-key"]["type"], "string">
		>;
		type _EffectiveFormat = Assert<
			IsEqual<(typeof app)["_types"]["effective"]["format"]["type"], "string">
		>;
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

		await app.run(["--api-key", "secret", "--verbose"]);
	});

	it("allows one owning factory on sibling command branches", async () => {
		const seen: string[] = [];
		const auth = defineContext("auth", { flags: [apiKey] }, ({ flags }) => ({
			apiKey: flags["api-key"],
		}));
		const branch = (name: string) =>
			defineCommand(name, (command) =>
				command.provide(auth()).action(({ ctx }) => {
					seen.push(`${name}:${ctx.auth.apiKey}`);
				}),
			);
		const app = new Crust("cli").add(branch("first"), branch("second"));

		await app.run(["first", "--api-key", "one"]);
		await app.run(["second", "--api-key", "two"]);

		expect(seen).toEqual(["first:one", "second:two"]);
	});

	it("retains owned flags on .of() test doubles", async () => {
		const auth = defineContext("auth", { flags: [apiKey] }, () => ({ real: true }));
		const fake = auth.of({ real: false });
		expect(fake.ownedFlags["api-key"]).toBeDefined();

		await new Crust("cli")
			.provide(fake)
			.action(({ flags, ctx }) => {
				expect(flags["api-key"]).toBe("fake-key");
				expect(ctx.auth.real).toBe(false);
			})
			.run(["--api-key", "fake-key"]);
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
			flags: { other: { type: "string", aliases: ["api-key"] } },
		});

		await expect(new Crust("cli").extend(extension).provide(auth()).run([])).rejects.toThrow(
			/collides/,
		);
		await expect(new Crust("cli").provide(auth()).extend(extension).run([])).rejects.toThrow(
			/collides/,
		);
	});
});

describe("Context capability requirements (topological construction)", () => {
	it("constructs dependencies before dependents in registration order among independents", async () => {
		const order: string[] = [];
		const config = defineContext("config", () => {
			order.push("config");
			return { endpoint: "https://api.example.com" };
		});
		const client = defineContext("client", { requires: [config] }, ({ ctx }) => {
			order.push(`client:${ctx.config.endpoint}`);
			return { endpoint: ctx.config.endpoint };
		});
		const workspace = defineContext("workspace", { requires: [client] }, ({ ctx }) => {
			order.push(`workspace:${ctx.client.endpoint}`);
			return "crust";
		});

		const app = new Crust("cli").provide(config(), client(), workspace()).action(({ ctx }) => {
			type _Workspace = Assert<IsEqual<typeof ctx.workspace, string>>;
			order.push(`action:${ctx.workspace}`);
		});

		await app.run([]);

		expect(order).toEqual([
			"config",
			"client:https://api.example.com",
			"workspace:https://api.example.com",
			"action:crust",
		]);
	});

	it("provide order is free — dependents may be provided before dependencies", async () => {
		const order: string[] = [];
		const config = defineContext("config", () => {
			order.push("config");
			return { url: "u" };
		});
		const client = defineContext("client", { requires: [config] }, ({ ctx }) => {
			order.push("client");
			return { url: ctx.config.url };
		});

		await new Crust("cli")
			.provide(client())
			.provide(config())
			.action(() => {
				order.push("action");
			})
			.run([]);

		expect(order).toEqual(["config", "client", "action"]);
	});

	it("types ctx in setup from the declared dependency factories", () => {
		const session = defineContext("session", () => ({ userId: "yan" }));
		defineContext("user", { requires: [session] }, ({ ctx }) => {
			type _Session = Assert<IsEqual<typeof ctx.session, { userId: string }>>;
			// @ts-expect-error -- only declared dependencies are visible
			void ctx.other;
			return { id: ctx.session.userId };
		});
	});

	it("throws DEFINITION at dispatch when a dependency is missing from the path", async () => {
		const config = defineContext("config", () => ({}));
		const client = defineContext("client", { requires: [config] }, () => ({}));

		const app = new Crust("cli").provide(client()).action(() => {});

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

		const app = new Crust("cli").provide(a, b).action(() => {});

		await expect(app.run([])).rejects.toMatchObject({
			code: "DEFINITION",
			message: expect.stringMatching(/dependency cycle/),
		});
	});

	it("satisfies an added definition's Context requirement before its dependents construct", async () => {
		const session = defineContext("session", () => ({ userId: "yan" }));
		const user = defineContext("user", { requires: [session] }, ({ ctx }) => ({
			id: ctx.session.userId,
		}));
		const account = defineCommand("account", { requires: [session] }, (command) =>
			command.provide(user()).action(({ ctx }) => {
				type _User = Assert<IsEqual<typeof ctx.user, { id: string }>>;
				expect(ctx.user).toEqual({ id: "yan" });
			}),
		);

		await new Crust("cli").provide(session()).add(account).run(["account"]);
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
			.action(() => {
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
		const derived = defineContext("derived", { requires: [base] }, () => ({
			[Symbol.dispose]() {
				log.push("dispose:derived");
			},
		}));

		// derived provided first, but base constructs first — so base disposes last
		await new Crust("cli")
			.provide(derived(), base())
			.action(() => {
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
			.action(() => {})
			.run([]);

		expect(log).toEqual(["dispose:sync"]);
	});

	it("disposes after an action failure and rethrows the original error", async () => {
		const log: string[] = [];
		const res = disposableContext("res", log);
		const boom = new Error("action failed");

		const app = new Crust("cli").provide(res()).action(() => {
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
			.action(() => {
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
		const guard = defineContext("guard", { requires: [resource] }, () => {
			throw new Error("Unauthenticated");
		});
		const app = new Crust("cli").provide(resource(), guard()).action(() => {
			events.push("handled");
		});

		await expect(app.run([])).rejects.toThrow("Unauthenticated");
		expect(events).toEqual(["disposed"]);
	});

	it("leaves non-disposable Context values alone", async () => {
		const plain = defineContext("plain", () => ({ value: 42 }));
		const app = new Crust("cli").provide(plain()).action(({ ctx }) => {
			expect(ctx.plain.value).toBe(42);
		});

		await expect(app.run([])).resolves.toBeUndefined();
	});
});
