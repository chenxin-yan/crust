import { defineCommand } from "@crustjs/core";

export const greetCommand = defineCommand("greet", { description: "Greet someone" }, (command) =>
	command
		.args({ name: "name", type: "string", default: "world" })
		.flags({ name: "greeting", type: "string", default: "Hello", short: "g" })
		.action(({ args, flags, stdout }) => {
			stdout(`${flags.greeting}, ${args.name}!`);
		}),
);
