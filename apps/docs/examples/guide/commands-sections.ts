import { Crust, defineCommand } from "@crustjs/core";
import { help } from "@crustjs/extensions";

const deploy = defineCommand(
	"deploy",
	{
		description: "Deploy a release",
		// [!code highlight]
		sections: [{ title: "Exit codes", body: "0  Deployed\n1  Deploy failed" }],
	},
	(command) => command.action(({ stdout }) => stdout("Deploying")),
);

const app = new Crust("my-cli", {
	// [!code highlight]
	sections: [{ title: "Environment", body: "DEPLOY_TOKEN  Token sent with every request" }],
})
	.extend(help())
	.add(deploy);

await app.execute();
