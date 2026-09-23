import { Crust } from "@crustjs/core";

const convert = new Crust("convert")
	// A missing input fails before the action runs
	.args({ name: "input", type: "string", required: true })
	.flags({
		name: "format",
		type: "string",
		default: "html",
	})
	.action(({ args, flags, stdout }) => {
		stdout(`Converting ${args.input} as ${flags.format}`);
	});

await convert.execute();
