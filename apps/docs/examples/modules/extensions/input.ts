import { Crust } from "@crustjs/core";
import { input } from "@crustjs/extensions";

const app = new Crust("my-cli").extend(input()).command("deploy", (cmd) =>
	cmd
		.args({ name: "target", type: "string", required: true })
		.flags({ region: { type: "string", default: "us" } })
		.action(({ args, flags, stdout }) => {
			stdout(`Deploying ${args.target} to ${flags.region}`);
		}),
);

await app.execute();
