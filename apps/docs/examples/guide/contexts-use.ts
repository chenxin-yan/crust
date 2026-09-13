//#region use
import { Crust, defineCommand, defineContext } from "@crustjs/core";

const api = defineContext("api", () => ({
  get: (path: string) => `https://api.example.com${path}`,
}));

const health = defineCommand("health", (command) =>
  command.use(api).action(async ({ ctx, stdout }) => {
    stdout((await ctx.api).get("/health"));
  }),
);

const app = new Crust("app").provide(api()).add(health);

await app.execute();
//#endregion

//#region compile-time
function misordered() {
  // @ts-expect-error `health` was added before `api` was provided on this path
  return new Crust("app").add(health).provide(api());
}
//#endregion
void misordered;
