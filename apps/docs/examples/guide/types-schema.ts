//#region schema
import { Crust } from "@crustjs/core";
import { z } from "zod";

const Port = z.coerce.number().int().min(1).max(65535).default(3000);

const serve = new Crust("serve").args({ name: "port", schema: Port }).action(({ args, stdout }) => {
  const port = args.port; // number
  stdout(`listening on port ${port}`);
});

await serve.execute();
//#endregion

//#region compile-time
// @ts-expect-error parse must be synchronous
new Crust("fetch").args({ name: "remote", type: "string", parse: async (raw) => raw.trim() });

// A schema flag keeps `type` so the parser knows whether a value token follows
new Crust("serve").flags({ name: "port", type: "string", schema: Port });

// @ts-expect-error a schema argument owns conversion, so it cannot also set `type`
new Crust("serve").args({ name: "port", type: "string", schema: Port });
//#endregion
