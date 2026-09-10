import { Crust, type AnyCrust } from "@crustjs/core";

//#region strict
const app = new Crust("build")
  .flags({ name: "mode", type: "string", choices: ["safe", "fast"], required: true })
  .action(({ flags, stdout }) => {
    stdout(`Building in ${flags.mode} mode`);
    return { mode: flags.mode };
  });

const outcome = await app.run([], { flags: { mode: "safe" } });
if (outcome.status === "failed") throw outcome.error;
if (outcome.status === "completed") {
  console.log(outcome.stdout); // Building in safe mode
  console.log(outcome.result.mode); // typed as "safe" | "fast"
}
//#endregion

//#region narrowing
export async function build(mode: string) {
  if (mode !== "safe" && mode !== "fast") throw new Error("Unknown mode");
  return app.run([], { flags: { mode } }); // narrowed, not asserted
}
//#endregion

//#region dynamic
function generatedApp(name: string) {
  return new Crust(name)
    .args({ name: "file", type: "string", required: true })
    .action(({ args }) => args.file);
}
const generated = generatedApp("generated");
const result = await generated.run([], { args: { file: "input.txt" } });
if (result.status === "failed") throw result.error;
// The dynamic root name does not erase the known file input or string result.

export async function invokeDynamic(dynamicApp: AnyCrust, path: readonly string[]) {
  const dynamicOutcome = await dynamicApp.run(path, { flags: { mode: "safe" } });
  if (dynamicOutcome.status === "failed") throw dynamicOutcome.error;
  if (dynamicOutcome.status === "completed") return dynamicOutcome.result; // unknown
}
//#endregion

//#region raw
const parsed = new Crust("parse")
  .flags({ name: "count", type: "string", parse: (raw) => Number(raw), required: true })
  .action(({ flags }) => flags.count); // number
const parsedOutcome = await parsed.run([], { flags: { count: "3" } }); // raw string
if (parsedOutcome.status === "failed") throw parsedOutcome.error;

const schema = {
  "~standard": {
    version: 1 as const,
    vendor: "example",
    validate(value: unknown) {
      if (value === "safe" || value === "fast") return { value };
      return { issues: [{ message: "Expected safe or fast" }] };
    },
  },
};
const validated = new Crust("schema")
  .flags({ name: "mode", type: "string", schema })
  .action(({ flags }) => flags.mode); // unknown without Standard Schema type metadata
const rawMode: string = "safe";
const schemaOutcome = await validated.run([], { flags: { mode: rawMode } }); // raw string
if (schemaOutcome.status === "failed") throw schemaOutcome.error;
//#endregion
