import { Crust, defineCommand } from "@crustjs/core";
import { config } from "@crustjs/extensions";

// Compiles and runs, but `crust build` fails: one file cannot give `port` a number and a string.
const app = new Crust("acme")
	.extend(config({ name: "acme", project: "acme.config.json" }))
	.add(
		defineCommand("serve", (cmd) =>
			cmd.flags({ port: { type: "number", config: "port" } }).action(() => {}),
		),
	)
	.add(
		defineCommand("proxy", (cmd) =>
			cmd.flags({ port: { type: "string", config: "port" } }).action(() => {}),
		),
	);

await app.execute();
