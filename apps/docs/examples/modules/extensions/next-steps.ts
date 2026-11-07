import { Crust, defineCommand } from "@crustjs/core";
import { nextSteps, nextStepsContext } from "@crustjs/extensions";

class NotLoggedInError extends Error {}

const app = new Crust("my-cli")
	.extend(
		nextSteps({
			onError(error) {
				if (error instanceof NotLoggedInError) {
					return [{ command: ["login"], input: { flags: { sso: true } }, description: "Log in" }];
				}
			},
		}),
	)
	.add(
		defineCommand("deploy", { description: "Deploy the app" }, (cmd) =>
			cmd
				.use(nextStepsContext)
				.args({ name: "env", type: "string", required: true })
				.action(async ({ args, ctx, stdout }) => {
					if (!process.env.MY_CLI_TOKEN) throw new NotLoggedInError("Not logged in.");
					stdout(`Deployed to ${args.env}`);
					(await ctx.next).add(["logs"], { flags: { env: args.env } }, "Follow the logs");
				}),
		),
		defineCommand("logs", { description: "Stream logs" }, (cmd) =>
			cmd.flags({ env: { type: "string" } }).action(({ stdout }) => stdout("…")),
		),
		defineCommand("login", { description: "Log in" }, (cmd) =>
			cmd.flags({ sso: { type: "boolean" } }).action(({ stdout }) => stdout("Logged in")),
		),
	);

await app.execute();
