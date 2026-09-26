import { Crust, defineCommand, defineContext } from "@crustjs/core";

const database = defineContext("database", ({ stdout, defer }) => {
	stdout("database opened");
	defer(() => stdout("database closed"));
	return { query: (sql: string) => `${sql}: ok` };
});

const query = defineCommand("query", (command) =>
	command.use(database).action(async ({ ctx, stdout }) => {
		stdout((await ctx.database).query("select 1"));
	}),
);

//#region replacement
// [!code highlight]
const fakeDatabase = database.of({ query: (sql: string) => `fake: ${sql}` });
const testApp = new Crust("work").provide(fakeDatabase).add(query);

const outcome = await testApp.run(["query"]);
console.log(outcome.stdout); // => fake: select 1
//#endregion
