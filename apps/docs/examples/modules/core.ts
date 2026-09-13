// #region quick
import { Crust } from "@crustjs/core";

const app = new Crust("hello")
  .flags({ name: "verbose", type: "boolean", short: "v" })
  .action(({ flags, stdout }) => stdout(flags.verbose ? "hello!" : "hello"))
  .command("wave", (command) => command.action(({ stdout }) => stdout("o/")));

const outcome = await app.run([], { flags: { verbose: true } });
console.log(outcome.stdout); // => hello!
// #endregion quick

// #region context
import { Crust as ContextApp, defineContext, defineFlag } from "@crustjs/core";

const apiKey = defineFlag("api-key", { type: "string", required: true });
const api = defineContext("api", { flags: [apiKey] }, ({ flags }) => ({
  apiKey: flags["api-key"],
}));

const contextApp = new ContextApp("my-cli")
  .provide(api())
  .action(async ({ ctx, stdout }) => stdout((await ctx.api).apiKey));

const contextOutcome = await contextApp.run([], { flags: { "api-key": "secret" } });
console.log(contextOutcome.stdout); // => secret
// #endregion context
