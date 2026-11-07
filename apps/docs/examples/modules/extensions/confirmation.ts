import { Crust, defineCommand } from "@crustjs/core";
import { confirmation } from "@crustjs/extensions";

const app = new Crust("my-cli")
	.extend(confirmation())
	.add(
		defineCommand("drop", { description: "Drop the database", destructive: true }, (cmd) =>
			cmd.action(({ stdout }) => stdout("Dropped")),
		),
	);

await app.execute();
