import { Crust, defineCommand } from "@crustjs/core";
import { nextSteps } from "@crustjs/extensions";

class NotLoggedInError extends Error {}

const logs = defineCommand("logs", { description: "Stream logs" }, (cmd) =>
	cmd.flags({ env: { type: "string" } }).action(({ stdout }) => stdout("…")),
);

const login = defineCommand("login", { description: "Log in" }, (cmd) =>
	cmd.flags({ sso: { type: "boolean" } }).action(({ stdout }) => stdout("Logged in")),
);

const deploy = defineCommand("deploy", { description: "Deploy the app" }, (cmd) =>
	cmd
		.use(nextSteps)
		.args({ name: "env", type: "string", required: true })
		.action(async ({ args, ctx, stdout }) => {
			if (!process.env.MY_CLI_TOKEN) throw new NotLoggedInError("Not logged in.");
			stdout(`Deployed to ${args.env}`);
			const steps = await ctx.nextSteps;
			steps.add(logs, { flags: { env: args.env } }, "Follow the logs");
		}),
);

const app = new Crust("my-cli")
	.extend(
		nextSteps({
			onError(error) {
				if (error instanceof NotLoggedInError) {
					return [{ command: login, input: { flags: { sso: true } }, description: "Log in" }];
				}
			},
		}),
	)
	.add(deploy, logs, login);

await app.execute();
