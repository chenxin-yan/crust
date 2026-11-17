import { Crust, defineCommand } from "@crustjs/core";
import { quiet } from "@crustjs/extensions";

const deploy = defineCommand("deploy", { description: "Deploy the app" }, (cmd) =>
	cmd.use(quiet).action(async ({ ctx, stdout }) => {
		// [!code highlight]
		if (!(await ctx.quiet)) stdout("Uploading 3 files...");
		stdout("Deployed https://example.com");
	}),
);

const app = new Crust("my-cli").extend(quiet({ env: "MY_CLI_QUIET" })).add(deploy);

await app.execute();
