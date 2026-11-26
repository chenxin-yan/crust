import { Crust, defineCommand } from "@crustjs/core";
import { help } from "@crustjs/extensions";

const deploy = defineCommand(
	"deploy",
	// [!code highlight]
	{ description: "Deploy a release", examples: ["my-cli deploy --memory 512M"] },
	(command) =>
		command
			.flags({ force: { type: "boolean", description: "Skip checks" } })
			// [!code highlight]
			.group("Resources", (g) =>
				g.flags({ memory: { type: "string", valueName: "bytes", description: "Memory limit" } }),
			)
			.action(() => {}),
);

const app = new Crust("my-cli")
	.extend(help())
	// [!code highlight]
	.group("Core commands", (g) => g.add(deploy))
	.command("doctor", { description: "Check the setup" }, (command) => command.action(() => {}));

await app.execute();
