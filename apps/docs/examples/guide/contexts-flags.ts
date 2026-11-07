import { Crust, defineCommand, defineContext } from "@crustjs/core";

const api = defineContext("api")
	.flags({ "api-url": { type: "string", default: "https://api.example.com" } }) // [!code highlight]
	.setup(({ flags }) => ({
		//       ^?
		get: (path: string) => `${flags["api-url"]}${path}`,
	}));

const status = defineCommand("status", (command) =>
	command
		.use(api) // [!code highlight]
		.action(async ({ ctx, stdout }) => {
			stdout((await ctx.api).get("/status"));
		}),
);
const version = defineCommand("version", (command) =>
	command.action(({ stdout }) => stdout("1.0.0")),
);

const app = new Crust("app")
	.provide(api())
	.add(status, version)
	.command("deploy", (command) =>
		command.action(async ({ ctx, stdout }) => {
			stdout((await ctx.api).get("/deploy"));
		}),
	);

await app.execute();
