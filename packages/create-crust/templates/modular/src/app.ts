import { Crust } from "@crustjs/core";

export const app = new Crust("{{name}}")
	.meta({ description: "A CLI built with Crust" })
	.flags({
		greet: {
			type: "string",
			description: "Greeting to use",
			default: "Hello",
			short: "g",
			inherit: true,
		},
	});
