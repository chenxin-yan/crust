import { Crust, defineCommand, defineContext } from "@crustjs/core";

const database = defineContext("database", ({ stdout }) => {
  stdout("database opened");
  return {
    query: (sql: string) => `${sql}: ok`,
    [Symbol.dispose]() {
      stdout("database closed");
    },
  };
});

const query = defineCommand("query", (command) =>
  command.use(database).action(async ({ ctx, stdout }) => {
    stdout((await ctx.database).query("select 1"));
  }),
);

const fakeDatabase = database.of({
  query: (sql: string) => `fake: ${sql}`,
  [Symbol.dispose]() {},
});
const testApp = new Crust("work").provide(fakeDatabase).add(query);

const outcome = await testApp.run(["query"]);
console.log(outcome.stdout); // => fake: select 1
