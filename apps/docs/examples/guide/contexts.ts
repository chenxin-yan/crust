import { Crust, CrustError, defineCommand, defineContext, defineFlag } from "@crustjs/core";

//#region lazy
const cache = defineContext("cache", ({ stdout }) => {
  stdout("cache setup");
  return new Map<string, string>();
});

const lazyApp = new Crust("app").provide(cache()).action(({ stdout }) => {
  stdout("action");
  // ctx.cache is never read, so setup does not run.
});

const lazyOutcome = await lazyApp.run([]);
console.log(lazyOutcome.stdout); // => "action"
//#endregion

//#region owned-flags
const apiKey = defineFlag("api-key", { type: "string", required: true });
const api = defineContext("api", { flags: [apiKey] }, ({ flags }) => ({
  get: (path: string) => `${flags["api-key"]}:${path}`,
}));

const deploy = defineCommand("deploy", (command) =>
  command.use(api).action(async ({ ctx, stdout }) => {
    stdout((await ctx.api).get("/deploy"));
  }),
);

export const cli = new Crust("app").provide(api()).add(deploy);
// app --api-key secret deploy  => secret:/deploy
// app deploy --api-key secret  => secret:/deploy
//#endregion

//#region dependencies
const config = defineContext("config", ({ stdout }) => {
  stdout("config setup");
  return { url: "postgres://localhost/app" };
});
const database = defineContext("db", { uses: [config] }, async ({ ctx }) => {
  const { url } = await ctx.config;
  return { query: (sql: string) => `${sql} on ${url}` };
});

const databaseApp = new Crust("app")
  .provide(config(), database())
  .action(async ({ ctx, stdout }) => stdout((await ctx.db).query("select 1")));
// Output starts with "config setup" only when ctx.db pulls ctx.config.
//#endregion

//#region command-trees
const status = defineCommand("status", (command) =>
  command.use(database).action(async ({ ctx, stdout }) => {
    stdout((await ctx.db).query("select status"));
  }),
);

const commandTreeApp = new Crust("app").provide(config(), database()).add(status);
//#endregion

//#region dynamic
const aliases: string[] = ["t"];
const auth = defineContext("auth", { flags: [{ name: "token", type: "string", aliases }] }, () => ({
  authenticated: true,
}));
const child = defineCommand("child", (command) => command.use(auth));
const dynamicApp = new Crust("cli").provide(auth()).add(child);
//#endregion

//#region doubles
const fakeDatabase = database.of({ query: (sql: string) => `fake: ${sql}` });
const testApp = new Crust("app").provide(fakeDatabase).action(async ({ ctx, stdout }) => {
  stdout((await ctx.db).query("select 1"));
});

console.log((await testApp.run([])).stdout); // => "fake: select 1"
//#endregion

//#region cleanup
const first = defineContext("first", ({ stdout }) => ({
  [Symbol.dispose]() {
    stdout("dispose first");
  },
}));
const second = defineContext("second", ({ stdout }) => ({
  [Symbol.dispose]() {
    stdout("dispose second");
  },
}));

const cleanupApp = new Crust("app").provide(first(), second()).action(async ({ ctx, stdout }) => {
  await ctx.first;
  await ctx.second;
  stdout("action");
});

console.log((await cleanupApp.run([])).stdout);
// action
// dispose second
// dispose first
//#endregion

//#region collisions
const session = defineContext(
  "session",
  {
    flags: [{ name: "token", type: "string" }],
  },
  () => ({}),
);
const csrf = defineContext(
  "csrf",
  {
    flags: [{ name: "token", type: "string" }],
  },
  () => ({}),
);
const providers = [session(), csrf()];

try {
  new Crust("app").provide(...providers);
} catch (error) {
  if (error instanceof CrustError) console.log(error.code, error.message);
}
// DEFINITION Flag "token" collides with existing flag "token" on command "app"
//#endregion

void databaseApp;
void commandTreeApp;
void dynamicApp;
