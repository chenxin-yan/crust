import { Crust, defineCommand, defineContext } from "@crustjs/core";

const database = defineContext("database", ({ stdout, defer }) => {
  stdout("database opened"); // [!code highlight]
  defer(() => stdout("database closed")); // [!code highlight]
  return { query: (sql: string) => `${sql}: ok` };
});

const query = defineCommand("query", (command) =>
  command.use(database).action(async ({ ctx, stdout }) => {
    stdout((await ctx.database).query("select 1"));
  }),
);

const work = new Crust("work")
  .provide(database())
  .command("ping", (command) => command.action(({ stdout }) => stdout("pong")))
  .add(query)
  .command("fail", (command) =>
    command.action(async ({ ctx }) => {
      await ctx.database;
      throw new Error("query failed");
    }),
  );

await work.execute();
