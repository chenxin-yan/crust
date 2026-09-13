import { Crust } from "@crustjs/core";
import { z } from "zod";

//#region builtin
const inspect = new Crust("inspect")
  .args({ name: "file", type: "path", required: true })
  .flags({ name: "config", type: "json" }, { name: "retries", type: "number" })
  .action(({ args, flags }) => {
    args.file; // string, resolved against the working directory
    flags.config; // unknown
    flags.retries; // number | undefined
  });
//#endregion

//#region parse
const schedule = new Crust("schedule")
  .flags({ name: "date", type: "string", parse: (raw) => new Date(raw) })
  .action(({ flags }) => {
    flags.date; // Date | undefined
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
    args.port; // number
    flags.host; // string
    stdout(`listening on ${flags.host}:${args.port}`);
  });
//#endregion

void inspect;
void schedule;
const [name = "", ...argv] = process.argv.slice(2);
if (name === "serve") await serve.execute({ argv });
