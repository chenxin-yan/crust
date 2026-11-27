// Commands in their own file. They import only core, never `@crustjs/prompts/extension`:
// the `prompt` key is known in every file of a project that imports the entry once. The exports
// are annotated for `isolatedDeclarations`; the definitions stay typed inside.
import { type CommandDefinition, defineCommand } from "@crustjs/core";

export const deploy: CommandDefinition<any, any, any, any> = defineCommand("deploy", (c) =>
	c
		.args({ name: "service", type: "string", required: true, prompt: "Service" })
		.flags({
			region: {
				type: "string",
				choices: ["us", "eu", "ap"],
				required: true,
				env: "DEPLOY_REGION",
				prompt: "Region",
			},
			replicas: { type: "number", default: 1, prompt: "Replicas" },
		})
		.action(({ args, flags, stdout }) => {
			const region: "us" | "eu" | "ap" = flags.region;
			const replicas: number = flags.replicas;
			stdout(`deploy ${args.service} region=${region} replicas=${replicas}`);
		}),
);

const migrate: CommandDefinition<any, any, any, any> = defineCommand("migrate", (c) =>
	c
		.flags({ to: { type: "string", required: true, prompt: "Target version" } })
		.action(({ flags, stdout }) => stdout(`db migrate to=${flags.to}`)),
);

// A group with one child inline and one added from a definition.
export const db: CommandDefinition<any, any, any, any> = defineCommand("db", (c) =>
	c
		.command("reset", (r) =>
			r
				.flags({ confirm: { type: "boolean", default: false, prompt: "Drop all tables?" } })
				.action(({ flags, stdout }) => stdout(`db reset confirm=${flags.confirm}`)),
		)
		.add(migrate),
);
