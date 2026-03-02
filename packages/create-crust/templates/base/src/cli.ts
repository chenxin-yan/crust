import { Crust } from "@crustjs/core";
import { helpPlugin, versionPlugin } from "@crustjs/plugins";
import pkg from "../package.json";

const main = new Crust("{{name}}")
	.meta({ description: "A CLI built with Crust" })
	.use(versionPlugin(pkg.version))
	.use(helpPlugin())
	.args([
		{
			name: "name",
			type: "string",
			description: "Your name",
			default: "world",
		},
	])
	.flags({
		greet: {
			type: "string",
			description: "Greeting to use",
			default: "Hello",
			alias: "g",
		},
	})
	.run(({ args, flags }) => {
		console.log(`${flags.greet}, ${args.name}!`);
	});

await main.execute();
