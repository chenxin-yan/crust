import { Crust, defineCommand, defineContext, defineFlag } from "@crustjs/core";

//#region basic
const api = defineContext("api", () => ({
  get: (path: string) => `https://api.example.com${path}`,
}));

const app = new Crust("status").provide(api()).action(async ({ ctx, stdout }) => {
  stdout((await ctx.api).get("/status"));
});

await app.execute();
//#endregion

//#region setup-cleanup
const database = defineContext("database", ({ stdout }) => {
  stdout("database opened");
  return {
    [Symbol.dispose]() {
      stdout("database closed");
    },
  };
});

const failingApp = new Crust("work").provide(database()).action(async ({ ctx }) => {
  await ctx.database;
  throw new Error("query failed");
});

const failed = await failingApp.run([]);
console.log(failed.stdout);
// database opened
// database closed
console.log(failed.status); // => failed
//#endregion

//#region owned-flags
const apiKey = defineFlag("api-key", { type: "string", required: true });
const authenticatedApi = defineContext("authenticatedApi", { flags: [apiKey] }, ({ flags }) => ({
  get: (path: string) => `${flags["api-key"]}:${path}`,
}));

const deploy = defineCommand("deploy", (command) =>
  command.use(authenticatedApi).action(async ({ ctx, stdout }) => {
    stdout((await ctx.authenticatedApi).get("/deploy"));
  }),
);

export const cli = new Crust("app").provide(authenticatedApi()).add(deploy);
// app --api-key secret deploy  => secret:/deploy
// app deploy --api-key secret  => secret:/deploy
//#endregion

//#region dependencies
const config = defineContext("config", () => ({ url: "postgres://localhost/app" }));
const dependentDatabase = defineContext("db", { uses: [config] }, async ({ ctx }) => {
  const { url } = await ctx.config;
  return { query: (sql: string) => `${sql} on ${url}` };
});
//#endregion

//#region command-trees
const status = defineCommand("status", (command) =>
  command.use(dependentDatabase).action(async ({ ctx, stdout }) => {
    stdout((await ctx.db).query("select status"));
  }),
);

const commandTreeApp = new Crust("app").provide(config(), dependentDatabase()).add(status);
//#endregion

//#region doubles
const fakeDatabase = dependentDatabase.of({
  query: (sql: string) => `fake: ${sql}`,
});
const testApp = new Crust("app").provide(config(), fakeDatabase).add(status);

console.log((await testApp.run(["status"])).stdout); // => fake: select status
//#endregion

void app;
void commandTreeApp;
