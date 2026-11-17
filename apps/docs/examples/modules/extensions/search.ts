import { Crust, defineCommand } from "@crustjs/core";
import { json, search } from "@crustjs/extensions";

const app = new Crust("my-cli").extend(search(), json()).add(
	defineCommand("keys", { description: "Manage API keys" }, (cmd) =>
		cmd.add(
			defineCommand("rotate", { description: "Rotate an API key" }, (sub) => sub.action(() => {})),
			defineCommand("list", { description: "List API keys" }, (sub) => sub.action(() => {})),
		),
	),
	defineCommand("deploy", { description: "Deploy the app" }, (cmd) => cmd.action(() => {})),
);

await app.execute();
