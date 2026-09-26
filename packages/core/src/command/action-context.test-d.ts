import type { Equal, Expect } from "../../tests/helpers.ts";
import { defineContext } from "../api/context.ts";
import { Crust, defineCommand } from "./crust.ts";

const text = defineContext("db").setup(() => "text");
const numeric = defineContext("db").setup(() => 42);
const root = new Crust("cli").provide(text());

root.command("unsafe", (c) =>
	c
		.action(async ({ ctx }) => (await ctx.db).toUpperCase())
		// @ts-expect-error The stored action still requires a string.
		.provide(numeric()),
);
root.command("silent", (c) =>
	c
		.action(async ({ ctx }) => await ctx.db)
		// @ts-expect-error Replacement must not silently invalidate RunOutcome<string>.
		.provide(numeric()),
);
root.command("before", (c) =>
	c.provide(numeric()).action(async ({ ctx }) => {
		type _value = Expect<Equal<Awaited<typeof ctx.db>, number>>;
		return (await ctx.db).toFixed();
	}),
);
root.command("compatible", (c) =>
	c.action(async ({ ctx }) => (await ctx.db).toUpperCase()).provide(text.of("child")),
);
root.command("replace", (c) =>
	c
		.action(async ({ ctx }) => (await ctx.db).toUpperCase())
		.action(async ({ ctx }) => (await ctx.db).length)
		// @ts-expect-error Replacing the action still binds its current Context contract.
		.provide(numeric()),
);

// Local transitions must retain the action obligation; it is not an app-wide hook demand.
root.command("transitions", (c) =>
	c
		.action(async ({ ctx }) => (await ctx.db).toUpperCase())
		.args({ name: "input", type: "string" })
		.flags({ name: "verbose", type: "boolean" })
		.add(
			defineCommand("nested", (c) =>
				c.provide(numeric()).action(async ({ ctx }) => (await ctx.db).toFixed()),
			),
		)
		// @ts-expect-error Adding descendants must not erase this command's action requirement.
		.provide(numeric()),
);

new Crust("cli")
	.provide(text())
	.action(async ({ ctx }) => (await ctx.db).toUpperCase())
	.command("local", (c) =>
		c.provide(numeric()).action(async ({ ctx }) => (await ctx.db).toFixed()),
	);
