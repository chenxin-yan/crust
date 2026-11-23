import { Crust, defineCommand } from "@crustjs/core";
import { help } from "@crustjs/extensions";

const app = new Crust("my-cli", { description: "My CLI" })
	.extend(help({ command: true }))
	.group("Core commands", (g) =>
		g.add(
			defineCommand(
				"deploy",
				{ description: "Deploy the app", examples: ["my-cli deploy --memory 512M"] },
				(command) =>
					command
						.flags({ memory: { type: "string", valueName: "bytes", description: "Memory limit" } })
						.action(() => {}),
			),
		),
	)
	.add(
		defineCommand("doctor", { description: "Check the setup" }, (command) =>
			command.action(() => {}),
		),
	)
	.action(() => {});

await app.execute();
