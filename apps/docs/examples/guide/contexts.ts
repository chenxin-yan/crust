import { Crust, defineContext } from "@crustjs/core";

const database = defineContext("db", ({ options }: { options: { url: string } }) => ({
  query: (sql: string) => `${sql} on ${options.url}`,
}));

const app = new Crust("app")
  .provide(database({ url: "postgres://localhost/app" }))
  .action(async ({ ctx, stdout }) => {
    const db = await ctx.db;
    stdout(db.query("select 1"));
  });

await app.execute();
