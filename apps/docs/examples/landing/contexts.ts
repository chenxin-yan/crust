import { Crust, defineContext } from "@crustjs/core";

const database = defineContext(
	"database",
	({ stdout, defer }) => {
		stdout("database opened");
		// Runs after the action, even when it throws
		defer(() => stdout("database closed"));
		return { query: (sql: string) => `${sql}: ok` };
	},
);

const work = new Crust("work")
	// Opened on first read, once per invocation
	.provide(database())
	.command("query", (command) =>
		command.action(async ({ ctx, stdout }) => {
			stdout((await ctx.database).query("select 1"));
		}),
	)
	.command("fail", (command) =>
		command.action(async ({ ctx }) => {
			await ctx.database;
			throw new Error("query failed");
		}),
	);

await work.execute();
