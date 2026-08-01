import { describe, expect, it } from "bun:test";

import { Crust, defineCommand } from "../command/crust.ts";
import { CrustError } from "../errors.ts";
import { defineContext } from "./context.ts";

describe("defineContext()", () => {
	it("always returns a factory, including for zero-option setups", async () => {
		const auth = defineContext("auth", () => ({ user: "chenxin" }));

		// The definition itself is a factory, not an instance
		expect(typeof auth).toBe("function");

		const instance = auth();
		expect(instance.kind).toBe("context");
		expect(instance.name).toBe("auth");
		await expect(Promise.resolve(instance.setup())).resolves.toEqual({ user: "chenxin" });
	});

	it("factories receive only their options", async () => {
		const db = defineContext("db", (options: { url: string }) => ({ url: options.url }));

		const instance = db({ url: "memory://test" });
		await expect(Promise.resolve(instance.setup())).resolves.toEqual({ url: "memory://test" });
	});
});

describe("Crust .provide()", () => {
	it("constructs Contexts for the resolved command and exposes them as ctx", async () => {
		const seen: string[] = [];
		const db = defineContext("db", (options: { url: string }) => ({ url: options.url }));

		const app = new Crust("cli").provide(db({ url: "memory://x" })).handle(({ ctx }) => {
			seen.push(ctx.db.url);
		});

		await app.run([]);
		expect(seen).toEqual(["memory://x"]);
	});

	it("throws DEFINITION on a duplicate Context name on the same command", () => {
		const a = defineContext("db", () => 1);
		const b = defineContext("db", () => 2);

		expect(() => new Crust("cli").provide(a()).provide(b())).toThrow(CrustError);
		try {
			new Crust("cli").provide(a()).provide(b());
		} catch (error) {
			expect((error as CrustError).is("DEFINITION")).toBe(true);
		}
	});

	it("throws DEFINITION when a child re-provides a name inherited from its path", () => {
		const parentDb = defineContext("db", () => "parent");
		const childDb = defineContext("db", () => "child");

		expect(() =>
			new Crust("cli")
				.provide(parentDb())
				.command("sub", (cmd) => cmd.provide(childDb()).handle(() => {})),
		).toThrow(CrustError);
	});

	it("throws DEFINITION when a mounted subtree re-provides a path name", () => {
		const parentDb = defineContext("db", () => "parent");
		const nestedDb = defineContext("db", () => "nested");
		const sub = defineCommand<{ ctx: { db: string } }>((command) =>
			command.command("g", (child) => child.provide(nestedDb()).handle(() => {})),
		);

		expect(() => new Crust("cli").provide(parentDb()).mount("sub", sub)).toThrow(CrustError);
	});

	it("seeds mounted descendants with the parent Context path", async () => {
		const seen: string[] = [];
		const db = defineContext("db", () => "root-db");
		const sub = defineCommand<{ ctx: { db: string } }>((command) =>
			command.command("g", (child) =>
				child.handle(({ ctx }) => {
					seen.push(ctx.db);
				}),
			),
		);
		const root = new Crust("cli").provide(db()).mount("sub", sub);

		await root.run(["sub", "g"]);

		expect(seen).toEqual(["root-db"]);
	});

	it("checks Context requirements at the mount call", () => {
		const db = defineContext("db", () => "root-db");
		const sub = defineCommand<{ ctx: { db: string } }>((command) => command);

		new Crust("cli").provide(db()).mount("sub", sub);
		// @ts-expect-error -- missing Contexts: db
		new Crust("cli").mount("sub", sub).provide(db());
	});

	it("does not construct Contexts for commands off the resolved path", async () => {
		let built = 0;
		const lazy = defineContext("lazy", () => {
			built++;
			return {};
		});

		const app = new Crust("cli")
			.provide(lazy())
			.command("a", (cmd) => cmd.handle(() => {}))
			.command("b", (cmd) => cmd.handle(() => {}));

		// Resolving "a" builds the inherited context once; "b" not executed
		await app.run(["a"]);
		expect(built).toBe(1);
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

	it("leaves non-disposable Context values alone", async () => {
		const plain = defineContext("plain", () => ({ value: 42 }));
		const app = new Crust("cli").provide(plain()).handle(({ ctx }) => {
			expect(ctx.plain.value).toBe(42);
		});

		await expect(app.run([])).resolves.toBeUndefined();
	});
});
