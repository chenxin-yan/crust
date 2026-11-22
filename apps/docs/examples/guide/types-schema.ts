//#region schema
import { Crust } from "@crustjs/core";
import { z } from "zod";

// [!code highlight]
const Port = z.coerce.number().int().min(1).max(65535).default(3000);

// [!code highlight]
const serve = new Crust("serve").args({ name: "port", schema: Port }).action(({ args, stdout }) => {
	const port = args.port;
	//    ^?
	stdout(`listening on port ${port}`);
});

await serve.execute();
//#endregion

//#region compile-time
// @ts-expect-error parse must be synchronous
new Crust("fetch").args({ name: "remote", type: "string", parse: async (raw) => raw.trim() });

// A schema flag keeps `type` so the parser knows whether a value token follows
new Crust("serve").flags({ port: { type: "string", schema: Port } });

// @ts-expect-error a schema argument owns conversion, so it cannot also set `type`
new Crust("serve").args({ name: "port", type: "string", schema: Port });

// @ts-expect-error a string flag hands its schema a string: write z.coerce.number()
new Crust("serve").flags({ port: { type: "string", schema: z.number() } });

// A json flag hands its schema the parsed JSON value
const User = z.object({ name: z.string(), role: z.enum(["admin", "member"]).optional() });
new Crust("create").flags({ body: { type: "json", schema: User } });

// @ts-expect-error a json flag's schema must accept JSON data, and a Date is not
new Crust("create").flags({ at: { type: "json", schema: z.date() } });
//#endregion
