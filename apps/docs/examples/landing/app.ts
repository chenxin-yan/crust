import { Crust, defineCommand } from "@crustjs/core";
import { help } from "@crustjs/extensions";
import { skill } from "@crustjs/skills";

const deploy = defineCommand(
	"deploy",
	{ description: "Deploy the app" },
	(command) => command.action(() => {}),
);

const app = new Crust("my-cli", {
	description: "Manage deployments",
	version: "1.2.3",
})
	// [!code highlight:2]
	.extend(help()) // --help for humans
	.extend(skill({})) // SKILL.md for agents
	.add(deploy);

await app.execute();
