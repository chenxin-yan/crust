//#region definitions
import { Crust, defineCommand, defineFlag } from "@crustjs/core";
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

await command.execute();
//#endregion

//#region required-defaulted
const publishCommand = new Crust("publish").flags(
  { name: "token", type: "string", required: true },
  { name: "registry", type: "string", default: "npm" },
);
//#endregion

//#region reuse
const format = defineFlag("format", { type: "string", default: "json" });
const print = defineCommand("print", (builder) => builder.flags(format));
const inspect = defineCommand("inspect", (builder) => builder.flags(format));

const tools = new Crust("tools").add(print, inspect);
//#endregion

void publishCommand;
void tools;
