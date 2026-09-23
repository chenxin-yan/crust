import { Crust } from "@crustjs/core";
import { z } from "zod";

// [!code highlight]
const Port = z.coerce.number().max(65535).default(3000);

const serve = new Crust("serve")
	// [!code highlight]
	.args({ name: "port", schema: Port })
	.action(({ args, stdout }) => {
		stdout(`listening on port ${args.port}`);
	});

await serve.execute();
