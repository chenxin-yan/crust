import { Crust } from "@crustjs/core";
import { help, version } from "@crustjs/extensions";

import pkg from "../package.json";

const app = new Crust("{{name}}")
	.meta({ description: "A CLI built with Crust" })
	.extend(version(pkg.version), help())
	.args({
		name: "name",
		type: "string",
		description: "Your name",
		default: "world",
	})
	.flags({
		name: "greet",
		type: "string",
		description: "Greeting to use",
		default: "Hello",
		short: "g",
	})
	.action(({ args, flags, stdout }) => {
		stdout(`${flags.greet}, ${args.name}!`);
	});

await app.execute();
