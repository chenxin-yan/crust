import { Crust, defineCommand } from "@crustjs/core";
import { dryRun, dryRunContext } from "@crustjs/extensions";

const app = new Crust("my-cli").extend(dryRun()).add(
	defineCommand("deploy", { description: "Deploy the app" }, (cmd) =>
		cmd.use(dryRunContext).action(async ({ ctx, stdout }) => {
			if (await ctx.dryRun) return stdout("Would deploy v2");
			stdout("Deployed v2");
		}),
	),
	defineCommand("logs", { description: "Stream logs" }, (cmd) =>
		cmd.action(({ stdout }) => stdout("…")),
	),
);

await app.execute();
