import { Crust } from "@crustjs/core";
import { z } from "zod";

// Any Standard Schema library works
const Port = z.coerce.number().max(65535).default(3000);

const serve = new Crust("serve")
	// The schema owns parsing, defaults, and validation
	.args({ name: "port", schema: Port })
	.action(({ args, stdout }) => {
		const port = args.port;
		stdout(`listening on port ${port}`);
	});

await serve.execute();
