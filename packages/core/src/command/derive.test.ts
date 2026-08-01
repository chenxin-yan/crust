import { describe, expect, it } from "bun:test";

import { defineContext } from "../api/context.ts";
import { Crust, defineCommand } from "./crust.ts";

type Assert<T extends true> = T;
type IsEqual<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe("Crust .derive()", () => {
	it("constructs provided and derived Contexts in registration order", async () => {
		const order: string[] = [];
		const config = defineContext("config", () => ({ endpoint: "https://api.example.com" }));
		const app = new Crust("cli")
			.provide(config())
			.derive("client", ({ ctx }) => {
				order.push(`client:${ctx.config.endpoint}`);
				return { endpoint: ctx.config.endpoint };
			})
			.derive("workspace", ({ ctx }) => {
				order.push(`workspace:${ctx.client.endpoint}`);
				return "crust";
			})
			.handle(({ ctx }) => {
				order.push(`handler:${ctx.workspace}`);
			});

		await app.run([]);

		expect(order).toEqual([
			"client:https://api.example.com",
			"workspace:https://api.example.com",
			"handler:crust",
		]);
	});

	it("disposes constructed Contexts when a derived guard throws before the handler", async () => {
		const events: string[] = [];
		const resource = defineContext("resource", () => ({
			[Symbol.dispose]() {
				events.push("disposed");
			},
		}));
		const app = new Crust("cli")
			.provide(resource())
			.derive("user", () => {
				throw new Error("Unauthenticated");
			})
			.handle(() => {
				events.push("handled");
			});

		await expect(app.run([])).rejects.toThrow("Unauthenticated");
		expect(events).toEqual(["disposed"]);
	});

	it("rejects duplicate provided and derived Context names", () => {
		const shared = defineContext("shared", () => "provided");

		expect(() => new Crust("cli").provide(shared()).derive("shared", () => "derived")).toThrow(
			/Context "shared" is already provided/,
		);
		expect(() => new Crust("cli").derive("shared", () => "derived").provide(shared())).toThrow(
			/Context "shared" is already provided/,
		);
	});

	it("snapshots derived Contexts without backfilling later parent provides", async () => {
		let earlyDerived = false;
		let lateProvided = false;
		const late = defineContext("late", () => {
			lateProvided = true;
			return "late";
		});
		const app = new Crust("cli")
			.derive("early", () => {
				earlyDerived = true;
				return "early";
			})
			.command("status", (command) => command.handle(() => {}))
			.provide(late());

		await app.run(["status"]);

		expect(earlyDerived).toBe(true);
		expect(lateProvided).toBe(false);
	});

	it("satisfies a mounted definition's Context requirement before deriving local values", async () => {
		const session = defineContext("session", () => ({ userId: "yan" }));
		const account = defineCommand<{ ctx: { session: { userId: string } } }>()((command) =>
			command
				.derive("user", ({ ctx }) => ({ id: ctx.session.userId }))
				.handle(({ ctx }) => {
					type _User = Assert<IsEqual<typeof ctx.user, { id: string }>>;
					expect(ctx.user).toEqual({ id: "yan" });
				}),
		);

		await new Crust("cli").provide(session()).mount("account", account).run(["account"]);
	});

	it("disposes a derived value after the handler", async () => {
		const events: string[] = [];
		const app = new Crust("cli")
			.derive("db", () => ({
				async [Symbol.asyncDispose]() {
					events.push("closed");
				},
			}))
			.handle(() => {
				events.push("handled");
			});

		await app.run([]);

		expect(events).toEqual(["handled", "closed"]);
	});

	it("infers derived Contexts on roots and definition builders", () => {
		const root = new Crust("cli")
			.provide(defineContext("config", () => ({ url: "https://api.example.com" }))())
			.derive("client", ({ ctx }) => {
				type _Config = Assert<IsEqual<typeof ctx.config, { url: string }>>;
				// @ts-expect-error -- derived setup receives only Context values
				void ctx.args;
				return { url: ctx.config.url };
			});
		type _Root = Assert<
			IsEqual<(typeof root)["_types"]["ctx"], { config: { url: string }; client: { url: string } }>
		>;

		defineCommand<{ ctx: { session: { userId: string } } }>()((command) =>
			command.derive("user", ({ ctx }) => {
				type _Session = Assert<IsEqual<typeof ctx.session, { userId: string }>>;
				return { id: ctx.session.userId };
			}),
		);
	});
});
