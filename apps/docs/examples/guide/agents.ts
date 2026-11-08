//#region deploy
import { defineCommand } from "@crustjs/core";
import { confirm, nextSteps } from "@crustjs/extensions";
import { z } from "zod";

const deploy = defineCommand("deploy", { description: "Deploy a release" }, (cmd) =>
	cmd
		.use(confirm, nextSteps)
		.args({ name: "target", type: "string", required: true, choices: ["staging", "prod"] })
		.flags({
			release: { type: "string", default: "latest", description: "Release to deploy" },
			"dry-run": { type: "boolean", description: "Print what would be deployed" },
		})
		// [!code highlight]
		.output(z.object({ target: z.string(), release: z.string(), dryRun: z.boolean() }))
		.action(async ({ args, flags, ctx, stdout, stderr }) => {
			const { target } = args;
			const { release } = flags;
			// Preview before confirming, so a dry run never prompts.
			if (flags["dry-run"]) {
				stdout(`Would deploy ${release} to ${target}`);
				return { target, release, dryRun: true };
			}
			if (target === "prod") {
				const ask = await ctx.confirm;
				await ask(`Deploy ${release} to prod?`);
			}
			// stderr() stays live under --json, where the result replaces stdout() text.
			stderr(`Deploying ${release} to ${target}`);
			const steps = await ctx.nextSteps;
			steps.add(status, { args: { target } }, "Watch the rollout");
			// [!code highlight]
			return { target, release, dryRun: false };
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
// `confirm` and `nextSteps` are imported with `deploy` above.
import { help, input, json, schema } from "@crustjs/extensions";

export const app = new Crust("my-cli", { description: "Deploy releases" })
	.extend(help(), input(), json(), schema(), confirm(), nextSteps())
	.add(deploy, status, init);
//#endregion

if (import.meta.main) await app.execute();
