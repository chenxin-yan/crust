import { Crust, defineCommand, defineContext, defineFlag } from "@crustjs/core";

//#region definitions
const command = new Crust("serve")
  .flags(
    { name: "color", type: "boolean", aliases: ["colour"] },
    { name: "target", type: "string", multiple: true, short: "t" },
    { name: "runtime", type: "string", choices: ["bun", "node"], default: "bun" },
    { name: "tag", type: "string" },
  )
  .action(({ flags, stdout }) =>
    stdout(
      `color=${flags.color ?? true} targets=${flags.target?.join(",") ?? ""} runtime=${flags.runtime} tag=${flags.tag ?? "none"}`,
    ),
  );
//#endregion

//#region contexts
const verbose = defineFlag("verbose", { type: "boolean" });
const logging = defineContext("logging", { flags: [verbose] }, ({ flags, stderr }) => ({
  debug(message: string) {
    if (flags.verbose) stderr(message);
  },
}));

const deploy = defineCommand("deploy", (command) =>
  command.use(logging).action(async ({ ctx }) => (await ctx.logging).debug("deploying")),
);

const app = new Crust("app").provide(logging()).add(deploy);
//#endregion

await command.execute();
void app;
