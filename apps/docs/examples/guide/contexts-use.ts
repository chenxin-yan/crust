import { Crust, defineCommand, defineContext } from "@crustjs/core";

const api = defineContext("api").setup(() => ({
	get: (path: string) => `https://api.example.com${path}`,
}));

//#region use
const health = defineCommand("health", (command) =>
	// [!code highlight]
	command.use(api).action(async ({ ctx, stdout }) => {
		stdout((await ctx.api).get("/health"));
	}),
);

const app = new Crust("app").provide(api()).add(health);

await app.execute();
//#endregion

//#region group
const tools = defineCommand("tools", (command) => command.add(health));

new Crust("app").provide(api()).add(tools);
//#endregion

// Checked but not rendered: the guide states this order is a type error.
function misordered() {
	// @ts-expect-error `health` was added before `api` was provided on this path
	return new Crust("app").add(health).provide(api());
}
function unprovided() {
	// @ts-expect-error `tools` forwards the `api` demand of `health`, and nothing provides it
	return new Crust("app").add(tools);
}
void unprovided;
void misordered;
