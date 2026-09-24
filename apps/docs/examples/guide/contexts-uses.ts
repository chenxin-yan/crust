import { Crust, defineCommand, defineContext } from "@crustjs/core";

const config = defineContext("config", () => ({ region: "eu" }));
// [!code highlight]
const api = defineContext("api", { use: [config] }, async ({ ctx }) => {
	const { region } = await ctx.config; // [!code highlight]
	//      ^?
	return { get: (path: string) => `https://${region}.api.example.com${path}` };
});

const regions = defineCommand("regions", (command) =>
	command.use(api).action(async ({ ctx, stdout }) => {
		stdout((await ctx.api).get("/regions"));
	}),
);

const app = new Crust("app").provide(config(), api()).add(regions);

await app.execute();
