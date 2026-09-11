import { Crust, CrustError, type AnyCrust } from "@crustjs/core";

//#region intro
const greet = new Crust("greet", { description: "Print a greeting" })
  .args({ name: "name", type: "string", required: true })
  .flags({ name: "loud", type: "boolean", short: "l" })
  .action(({ args, flags, stdout }) => {
    const text = `Hello, ${args.name}!`;
    stdout(flags.loud ? text.toUpperCase() : text);
  });
//#endregion

//#region context
const inspect = new Crust("inspect")
  .args({ name: "file", type: "path" })
  .flags({ name: "verbose", type: "boolean" })
  .action(({ args, flags, ctx, rawArgs, command, rootCommand, stdout, stderr }) => {
    stdout(`${rootCommand.meta.name}/${command.meta.name}`);
    if (flags.verbose) stderr(`file=${args.file ?? "none"} raw=${rawArgs.join(",")}`);
    void ctx;
  });
//#endregion

const routingApp = new Crust("tool")
  .command("build", (command) => command.action(() => "built"))
  .command("dev", (command) => command.action(() => "started"));

//#region unknown
const dynamicApp: AnyCrust = routingApp;
const unknown = await dynamicApp.run(["deploy"]);
if (
  unknown.status === "failed" &&
  unknown.error instanceof CrustError &&
  unknown.error.is("COMMAND_NOT_FOUND")
) {
  console.log(unknown.error.code); // COMMAND_NOT_FOUND
  console.log(JSON.stringify(unknown.error.details.available)); // ["build","dev"]
}
//#endregion

//#region invocation
const outcome = await routingApp.run(["build"]); // captured programmatic invocation
if (outcome.status === "failed") throw outcome.error;
await routingApp.execute({ argv: ["build"] }); // streaming terminal invocation
//#endregion

void greet;
void inspect;
