import { Crust, defineCommand, defineContext } from "@crustjs/core";

const database = defineContext("database", ({ stdout }) => {
  stdout("database opened"); // [!code highlight]
  return {
    query: (sql: string) => `${sql}: ok`,
    // [!code highlight]
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
