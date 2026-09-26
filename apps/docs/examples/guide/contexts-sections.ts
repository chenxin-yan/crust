import { Crust, defineCommand, defineContext } from "@crustjs/core";
import { help } from "@crustjs/extensions";

const api = defineContext(
	"api",
	{
		// [!code highlight]
		sections: [{ title: "Environment", body: "API_TOKEN  Token sent with every request" }],
	},
	() => ({ token: process.env.API_TOKEN }),
);

const deploy = defineCommand("deploy", (command) =>
	command.use(api).action(async ({ ctx, stdout }) => {
		stdout((await ctx.api).token ? "deploying" : "missing API_TOKEN");
	}),
);

const app = new Crust("app").extend(help()).provide(api()).add(deploy);

await app.execute();
