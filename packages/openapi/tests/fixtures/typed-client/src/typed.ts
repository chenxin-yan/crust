// Typed by the mapper: the result's fields.
import { defineCommand } from "@crustjs/core";

import { acme } from "./app.ts";

export const show = defineCommand("show", {}, (command) =>
	command.use(acme.client).action(async ({ ctx, stdout }) => {
		const api = await ctx.api;
		const user = await api.call("getUser", { path: { id: "me" } });
		const name: string = user.name;
		const created = await api.call("createUser", { body: { name: "Ada" } });
		stdout(`${name} ${created.id}`);
	}),
);
