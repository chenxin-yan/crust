//#region excess
import { Crust as ExcessCrust } from "@crustjs/core";

const oneInputCommand = new ExcessCrust("cli")
  .args({ name: "input", type: "string", required: true })
  .action(() => {});

if (import.meta.main) process.exit(await oneInputCommand.execute());
//#endregion

import { Crust, CrustError, type AnyCrust } from "@crustjs/core";

//#region definitions
const documentCommand = new Crust("convert")
  .args(
    { name: "input", type: "string", required: true },
    { name: "format", type: "string", default: "json" },
    { name: "label", type: "string" },
  )
  .action(({ args, stdout }) =>
    stdout(`${args.format}:${args.label ?? "<omitted>"}:${args.input}`),
  );
//#endregion

//#region defaults
const withDefaults = await documentCommand.run([], { args: { input: "data.csv" } });
if (withDefaults.status === "completed") console.log(withDefaults.stdout); // json:<omitted>:data.csv

const explicit = await documentCommand.run([], {
  args: { input: "data.csv", format: "yaml", label: "weekly" },
});
if (explicit.status === "completed") console.log(explicit.stdout); // yaml:weekly:data.csv
//#endregion

//#region choices
const runtimeCommand = new Crust("run")
  .args({ name: "runtime", type: "string", choices: ["bun", "node"] })
  .action(() => {});
const dynamicRuntime: AnyCrust = runtimeCommand;
const invalid = await dynamicRuntime.run([], { args: { runtime: "deno" } });
if (invalid.status === "failed" && invalid.error instanceof CrustError) {
  console.log(invalid.error.code); // PARSE
  console.log(invalid.error.message); // Invalid value "deno" for <runtime>. Expected one of: bun, node
}
//#endregion

//#region raw
const wrapper = new Crust("wrap").action(({ rawArgs, stdout }) => stdout(rawArgs.join(" ")));
const forwarded = await wrapper.run([], { raw: ["--watch", "src"] });
if (forwarded.status === "completed") console.log(forwarded.stdout); // --watch src
//#endregion
