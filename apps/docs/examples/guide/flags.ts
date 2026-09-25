import { Crust } from "@crustjs/core";

const serve = new Crust("serve")
	.flags({ name: "color", type: "boolean" }, { name: "port", type: "number" })
	.action(({ flags, stdout }) => {
		//         ^?
		stdout(`color=${String(flags.color)} port=${String(flags.port)}`);
	});

await serve.execute();
