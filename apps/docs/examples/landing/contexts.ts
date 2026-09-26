import { Crust, defineContext } from "@crustjs/core";

const db = defineContext("db", ({ stdout, defer }) => {
	stdout("db opened");
	// [!code highlight]
	defer(() => stdout("db closed"));
	return { query: (sql: string) => `${sql}: ok` };
});

const work = new Crust("work")
	// [!code highlight]
	.provide(db())
	.command("query", (command) =>
		command.action(async ({ ctx, stdout }) => {
			stdout((await ctx.db).query("select 1"));
			//                ^?
		}),
	)
	.command("fail", (command) =>
		command.action(async ({ ctx }) => {
			await ctx.db;
			throw new Error("query failed");
		}),
	);

await work.execute();
