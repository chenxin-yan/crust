import { Crust, defineContext } from "@crustjs/core";

const api = defineContext(
	"api",
	// [!code highlight]
	{ flags: [{ name: "api-url", type: "string", default: "https://api.example.com" }] },
	({ flags }) => ({
		// ^?
		get: (path: string) => `${flags["api-url"]}${path}`,
	}),
);

const app = new Crust("app").provide(api()).command("deploy", (command) =>
	command.action(async ({ ctx, stdout }) => {
		stdout((await ctx.api).get("/deploy"));
	}),
);

await app.execute();
