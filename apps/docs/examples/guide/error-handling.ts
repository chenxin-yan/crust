import { mkdir, writeFile } from "node:fs/promises";

import { Crust, defineContext, defineExtension, defineExtensionId } from "@crustjs/core";
import { input } from "@crustjs/prompts";
import { captureExecute } from "@crustjs/testing";

//#region validation
const manual = new Crust("greet")
  .flags({ name: "name", type: "string" })
  .action(({ flags, stdout }) => {
    if (!flags.name) throw new Error("Missing name");
    if (!["Ada", "Grace"].includes(flags.name)) throw new Error("Unknown name");
    stdout(`Hello, ${flags.name}`);
  });

export const declared = new Crust("greet")
  .flags({
    name: "name",
    type: "string",
    required: true,
    choices: ["Ada", "Grace"],
  })
  .action(({ flags, stdout }) => stdout(`Hello, ${flags.name}`));
//#endregion

//#region cleanup
const database = defineContext("database", () => ({
  [Symbol.dispose]() {
    console.error("Closed database");
  },
}));
function deployRelease() {
  throw new Error("Deployment service is unavailable. Try again later.");
}
export const deploy = new Crust("deploy").provide(database()).action(async ({ ctx }) => {
  await ctx.database;
  deployRelease();
});
//#endregion

//#region cancellation
async function createProject() {
  const name = await input({ message: "Project name?" });
  await mkdir(name);
  await writeFile(`${name}/package.json`, "{}");
}

const prompted = new Crust("scaffold").action(createProject);
//#endregion

//#region custom-message
class ConfigError extends Error {}

const configErrors = defineExtension(defineExtensionId("config-errors"), {
  hooks: {
    onError(error, { stderr }) {
      if (!(error instanceof ConfigError)) return;
      stderr(`Error: ${error.message}`);
      stderr("Hint: Run init to create the config file.");
      return true;
    },
  },
});

const configured = new Crust("app").extend(configErrors).action(() => {
  throw new ConfigError("Config file not found.");
});
//#endregion

const cancelled = new Crust("app").action(() => {
  throw new DOMException("Cancelled", "AbortError");
});
//#region tests
const outcome = await deploy.run([]);
if (outcome.status === "failed" && outcome.error instanceof Error) {
  console.log(outcome.error.message); // Deployment service is unavailable. Try again later.
}

const terminal = await captureExecute(declared, []);
console.log(terminal.stderr); // Error: Missing required flag "--name"
console.log(terminal.exitCode); // 1

//#endregion

void manual;
if (import.meta.main) {
  const example = {
    validate: declared,
    cleanup: deploy,
    custom: configured,
    cancel: cancelled,
    prompt: prompted,
  }[process.argv[2] ?? ""];
  if (example) await example.execute({ argv: process.argv.slice(3) });
}
