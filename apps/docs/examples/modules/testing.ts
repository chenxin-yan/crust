import { Crust, defineCommand } from "@crustjs/core";
import { input } from "@crustjs/prompts";
import { captureExecute, runInteractive } from "@crustjs/testing";

const app = new Crust("my-cli").add(
  defineCommand("greet", (command) =>
    command.action(async ({ stdout }) => {
      const name = await input({ message: "Name?" });
      stdout(`Hello, ${name}`);
    }),
  ),
);

//#region execute
const captured = await captureExecute(app, ["unknown"]);
console.log(captured.exitCode); // 1
console.log(captured.stderr); // Error: Unknown command "unknown".
//#endregion

//#region interactive
const run = runInteractive(app, ["greet"]);
await run.waitFor(/Name/);
run.type("Ada");
run.keys("return");
await run.done;
console.log(run.screen()); // ✓ Name? Ada
//#endregion
