import { Crust } from "@crustjs/core";
import { z } from "zod";

//#region builtin
const inspect = new Crust("inspect")
  .args({ name: "file", type: "path", required: true })
  .flags({ name: "config", type: "json" }, { name: "retries", type: "number" })
  .action(({ args, flags, stdout }) => {
    const file = args.file; // string, resolved against the working directory
    const config = flags.config; // unknown
    const retries = flags.retries; // number | undefined
    stdout(`${file} config=${JSON.stringify(config)} retries=${retries ?? "not set"}`);
  });
//#endregion

//#region parse
const schedule = new Crust("schedule")
  .flags({ name: "date", type: "string", parse: (raw) => new Date(raw) })
  .action(({ flags, stdout }) => {
    const date = flags.date; // Date | undefined
    stdout(`scheduled: ${date?.toLocaleString() ?? "not set"}`);
  });
//#endregion

//#region compile-time
// @ts-expect-error parse must be synchronous
new Crust("fetch").args({
  name: "remote",
  type: "string",
  parse: async (raw) => raw.trim(),
});
//#endregion

//#region schema
const Port = z.coerce.number().int().min(1).max(65535);

const serve = new Crust("serve")
  .args({ name: "port", schema: Port })
  .flags({ name: "host", type: "string", schema: z.string().default("localhost") })
  .action(({ args, flags, stdout }) => {
    const port = args.port; // number
    const host = flags.host; // string
    stdout(`listening on ${host}:${port}`);
  });
//#endregion

void inspect;
void schedule;
const [name = "", ...argv] = process.argv.slice(2);
if (name === "serve") await serve.execute({ argv });
