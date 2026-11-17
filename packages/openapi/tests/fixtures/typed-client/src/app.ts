// Compiles with and without the mapper: calls only, no result read.
import { defineCommand } from "@crustjs/core";
import { defineApi } from "@crustjs/openapi";

export const acme = defineApi({
	spec: new URL("./acme.openapi.jsonc", import.meta.url),
	baseUrl: "https://api.acme.test",
});

export const whoami = defineCommand("whoami", {}, (command) =>
	command.use(acme.client).action(async ({ ctx }) => {
		const api = await ctx.api;
		await api.call("getUser", { path: { id: "me" }, query: { expand: true } });
		await api.call("createUser", { body: { name: "Ada" } });
	}),
);
