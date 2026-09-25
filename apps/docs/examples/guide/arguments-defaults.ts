import { Crust } from "@crustjs/core";

const convert = new Crust("convert")
	.args(
		// [!code highlight:3]
		{ name: "input", type: "string", required: true },
		{ name: "format", type: "string", default: "json" },
		{ name: "label", type: "string" },
	)
	.action(({ args, stdout }) => {
		const input = args.input;
		//    ^?
		const format = args.format;
		//    ^?
		const label = args.label;
		//    ^?
		stdout(`${input} -> ${format}${label ? ` (${label})` : ""}`);
	});

await convert.execute();
