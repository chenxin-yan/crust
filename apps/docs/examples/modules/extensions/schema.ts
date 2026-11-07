import { Crust, defineCommand } from "@crustjs/core";
import { schema } from "@crustjs/extensions";
import { z } from "zod";

const app = new Crust("my-cli").extend(schema()).add(
	defineCommand("deploy", { description: "Deploy the app" }, (cmd) =>
		cmd
			.args({ name: "target", type: "string", required: true, choices: ["staging", "prod"] })
			.output(z.object({ id: z.string() }))
			.action(({ args }) => ({ id: `dep_${args.target}` })),
	),
);

await app.execute();
