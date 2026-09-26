import { Crust, defineContext } from "@crustjs/core";

const api = defineContext("api").setup(() => ({
	get: (path: string) => `https://api.example.com${path}`,
}));

const status = new Crust("status")
	.provide(api()) // [!code highlight]
	.action(async ({ ctx, stdout }) => {
		const client = await ctx.api; // [!code highlight]
		//    ^?
		stdout(client.get("/status"));
	});

await status.execute();
