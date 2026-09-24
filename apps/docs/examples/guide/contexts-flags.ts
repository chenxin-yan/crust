import { Crust, defineCommand, defineContext, defineFlag } from "@crustjs/core";

// [!code highlight]
const apiUrl = defineFlag("api-url", { type: "string", default: "https://api.example.com" });
// [!code highlight]
const api = defineContext("api", { flags: [apiUrl] }, ({ flags }) => ({
	//                                                      ^?
	get: (path: string) => `${flags["api-url"]}${path}`, // [!code highlight]
}));

const deploy = defineCommand("deploy", (command) =>
	command.use(api).action(async ({ ctx, stdout }) => {
		stdout((await ctx.api).get("/deploy"));
	}),
);

const app = new Crust("app").provide(api()).add(deploy);

await app.execute();
