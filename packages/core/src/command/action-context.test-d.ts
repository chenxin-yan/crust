import type { Equal, Expect } from "../../tests/helpers.ts";
import { defineContext } from "../api/context.ts";
import { defineExtension } from "../api/extension.ts";
import { defineExtensionId } from "../identity.ts";
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
		.flags({ verbose: { type: "boolean" } })
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

// Always-throwing actions infer a `never` result, which makes TypeScript match the recipe
// against `AnyCommandDefinitionBuilder` structurally instead of by variance.
root.command("sync-throw", (c) =>
	c.action(({ ctx }) => {
		void ctx.db;
		throw new Error("unavailable");
	}),
);
root.command("sync-throw-no-ctx", (c) =>
	c.action(() => {
		throw new Error("unavailable");
	}),
);
root.command("async-throw", (c) =>
	c.action(async ({ ctx }) => {
		await ctx.db;
		throw new Error("unavailable");
	}),
);
root.command("async-throw-no-ctx", (c) =>
	c.action(async () => {
		throw new Error("unavailable");
	}),
);

const throwingDefinition = defineCommand("throwing", (c) =>
	c.use(text).action(async ({ ctx }) => {
		await ctx.db;
		throw new Error("unavailable");
	}),
);
const syncThrowingDefinition = defineCommand("sync-throwing", (c) =>
	c.use(text).action(({ ctx }) => {
		void ctx.db;
		throw new Error("unavailable");
	}),
);
root.add(throwingDefinition, syncThrowingDefinition);
root.extend(defineExtension(defineExtensionId("throwing")).add(throwingDefinition));

// A never-returning action still binds its Context contract.
// @ts-expect-error -- db is not provided
new Crust("cli").add(throwingDefinition);
// @ts-expect-error -- db is provided with the wrong value type
new Crust("cli").provide(numeric()).add(throwingDefinition);
new Crust("cli").provide(numeric()).command("throwing", (c) =>
	// @ts-expect-error -- the inline .use(text) demand needs a string db
	c.use(text).action(async () => {
		throw new Error("unavailable");
	}),
);
root.command("throw-then-provide", (c) =>
	c
		.action(async ({ ctx }) => {
			(await ctx.db).toUpperCase();
			throw new Error("unavailable");
		})
		// @ts-expect-error The stored action still requires a string.
		.provide(numeric()),
);
