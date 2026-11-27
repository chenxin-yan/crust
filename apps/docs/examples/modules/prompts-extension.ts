import { Crust, defineCommand } from "@crustjs/core";
import { prompts } from "@crustjs/prompts/extension";

const deploy = defineCommand("deploy", (command) =>
	command
		.args({ name: "service", type: "string", required: true, prompt: "Service" })
		.flags({
			region: { type: "string", choices: ["us", "eu"], required: true, prompt: "Region" },
			replicas: { type: "number", default: 1, prompt: "Replicas" },
			canary: { type: "boolean", prompt: "Canary release?" },
		})
		.action(({ args, flags, stdout }) => {
			stdout(
				`${args.service} → ${flags.region}, ${flags.replicas} replicas, canary: ${flags.canary}`,
			);
		}),
);

const app = new Crust("my-cli").extend(prompts()).add(deploy);

await app.execute();
