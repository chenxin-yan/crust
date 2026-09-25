import { expect, it } from "vite-plus/test";

import { defineContext } from "../api/context.ts";
import { Crust, defineCommand } from "./crust.ts";

it("keeps safe pre-action shadowing, compatible bound replacement, and descendant locality", async () => {
	const text = defineContext("db", () => "parent");
	const numeric = defineContext("db", () => 42);
	const app = new Crust("cli")
		.provide(text())
		.action(async ({ ctx }) => (await ctx.db).toUpperCase())
		.command("before", (c) =>
			c.provide(numeric()).action(async ({ ctx }) => (await ctx.db).toFixed()),
		)
		.command("compatible", (c) =>
			c.action(async ({ ctx }) => (await ctx.db).toUpperCase()).provide(text.of("child")),
		)
		.command("nested", (c) =>
			c
				.action(async ({ ctx }) => (await ctx.db).toUpperCase())
				.add(
					defineCommand("leaf", (c) =>
						c.provide(numeric()).action(async ({ ctx }) => (await ctx.db).toFixed()),
					),
				),
		);
	expect(await app.run([])).toMatchObject({ status: "completed", result: "PARENT" });
	expect(await app.run(["before"])).toMatchObject({ status: "completed", result: "42" });
	expect(await app.run(["compatible"])).toMatchObject({ status: "completed", result: "CHILD" });
	expect(await app.run(["nested"])).toMatchObject({ status: "completed", result: "PARENT" });
	expect(await app.run(["nested", "leaf"])).toMatchObject({ status: "completed", result: "42" });
});

it("replaces the action on the new builder without mutating the prior action", async () => {
	const text = defineContext("db", () => "parent");
	const calls: string[] = [];
	const original = new Crust("cli").provide(text()).action(async ({ ctx }) => {
		calls.push("old");
		return (await ctx.db).toUpperCase();
	});
	const replaced = original.action(async ({ ctx }) => {
		calls.push("new");
		return (await ctx.db).length;
	});
	expect(await original.run([])).toMatchObject({ status: "completed", result: "PARENT" });
	expect(await replaced.run([])).toMatchObject({ status: "completed", result: 6 });
	expect(calls).toEqual(["old", "new"]);
});
