import { Crust, defineCommand } from "@crustjs/core";
import { confirm } from "@crustjs/extensions";

const drop = defineCommand("drop", { description: "Drop the database" }, (cmd) =>
	cmd.use(confirm).action(async ({ ctx, stdout }) => {
		const ask = await ctx.confirm;
		await ask("Drop the database?");
		stdout("Dropped");
	}),
);

const app = new Crust("my-cli").extend(confirm()).add(drop);

await app.execute();
