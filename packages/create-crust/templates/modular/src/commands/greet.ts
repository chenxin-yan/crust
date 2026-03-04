import { app } from "../app.ts";

export const greetCmd = app
	.sub("greet")
	.meta({ description: "Greet someone" })
	.args([
		{
			name: "name",
			type: "string",
			description: "Your name",
			default: "world",
		},
	])
	.run(({ args, flags }) => {
		console.log(`${flags.greet}, ${args.name}!`);
	});
