import { Crust } from "@crustjs/core";

const app = new Crust("convert")
	.args({ name: "input", type: "string", required: true })
	.flags({ name: "format", type: "string", default: "html" })
	.action(({ args, flags, stdout }) => stdout(`Converting ${args.input} as ${flags.format}`));

await app.execute();
