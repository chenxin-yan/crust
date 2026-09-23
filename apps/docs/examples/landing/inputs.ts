import { Crust } from "@crustjs/core";

const convert = new Crust("convert")
	// [!code highlight:2]
	.args({ name: "input", type: "string", required: true })
	.flags({ name: "to", type: "string", default: "html" })
	.action(({ args, flags, stdout }) => {
		stdout(`Converting ${args.input} as ${flags.to}`);
	});

await convert.execute();
