import { Crust, defineCommand } from "@crustjs/core";
import { confirm } from "@crustjs/extensions";

const drop = defineCommand("drop", { description: "Drop the database" }, (cmd) =>
	cmd.use(confirm).action(async ({ ctx, stdout }) => {
		await (
			await ctx.confirm
		)("Drop the database?");
		stdout("Dropped");
	}),
);

const app = new Crust("my-cli").extend(confirm()).add(drop);

await app.execute();
