//#region deploy
import { defineCommand } from "@crustjs/core";
import { nextStepsContext } from "@crustjs/extensions";
import { z } from "zod";

const deploy = defineCommand("deploy", { description: "Deploy a release" }, (cmd) =>
	cmd
		.use(nextStepsContext)
		.args({ name: "target", type: "string", required: true, choices: ["staging", "prod"] })
		.flags({
			release: { type: "string", default: "latest", description: "Release to deploy" },
			"dry-run": { type: "boolean", description: "Print what would be deployed" },
		})
		// [!code highlight]
		.output(z.object({ target: z.string(), release: z.string(), dryRun: z.boolean() }))
		.action(async ({ args, flags, ctx, stdout }) => {
			const dryRun = flags["dry-run"] === true;
			stdout(`${dryRun ? "Would deploy" : "Deploying"} ${flags.release} to ${args.target}`);
			if (!dryRun) {
				(await ctx.next).add(["status"], { args: { target: args.target } }, "Watch the rollout");
			}
			// [!code highlight]
			return { target: args.target, release: flags.release, dryRun };
		}),
);
//#endregion

//#region status
const status = defineCommand("status", { description: "Watch a rollout" }, (cmd) =>
	cmd
		.args({ name: "target", type: "string", required: true })
		// [!code highlight]
		.action(async function* ({ args, stdout }) {
			for (const step of ["build", "ship"]) {
				stdout(`${step}: done`);
				// [!code highlight]
				yield { step };
			}
			return { target: args.target, healthy: true };
		}),
);
//#endregion

//#region prompts
import { input as prompt } from "@crustjs/prompts";

const init = defineCommand("init", { description: "Create a project" }, (cmd) =>
	cmd
		.flags({ name: { type: "string", description: "Project name" } })
		.action(async ({ flags, stdout }) => {
			// [!code highlight:2]
			const name = await prompt({ message: "Project name?", initial: flags.name });
			const region = await prompt({ message: "Region?", default: "us-east-1" });
			stdout(`Created ${name} in ${region}`);
		}),
);
//#endregion

//#region app
import { Crust } from "@crustjs/core";
import { help, input, json, nextSteps, schema } from "@crustjs/extensions";

export const app = new Crust("my-cli", { description: "Deploy releases" })
	.extend(help(), input(), json(), schema(), nextSteps())
	.add(deploy, status, init);
//#endregion

if (import.meta.main) await app.execute();
